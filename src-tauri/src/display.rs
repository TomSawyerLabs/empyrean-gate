//! Display-topology watcher: notices when Windows reconfigures the displays
//! under a running show and says so, loudly, while it is happening.
//!
//! Seen live (2026-09): someone plugged a second monitor into the show
//! machine over a poor USB-C cable. Every connect and disconnect made the
//! driver re-enumerate the outputs — a GPU reset that stalled the frame loop
//! for ~0.5 s each time — and the extra display cost base frames for the
//! rest of the night. Nothing in the app could stop Windows from doing that
//! (there is no supported way to refuse a display hot-plug), and nothing
//! showed the operator why the rig was stuttering.
//!
//! So this polls the topology — monitor count and the primary display's
//! size — a few times a second, logs every change with its shape, keeps the
//! recent ones for the status blob, and flags *flapping* (several changes in
//! a short window, the signature of a bad cable) so every UI can show a
//! warning that names the cause and the fix: pull the extra display.
//!
//! The topology poll is declared by hand (three calls); the link check and
//! the TDR count below use the `windows` crate, which the webview2 module
//! already pulls in.
//!
//! **Degraded link (2026-09-06 evidence, plans/show-feedback-2026-09.md
//! "USB-C evidence").** What was actually seen on the show machine was not
//! flapping but a *steady* USB-C DisplayPort link negotiated down: the
//! monitor's native mode is 2560×1080, yet Windows offered nothing above
//! 1920×1080 — the mode list of a two-lane link. That is readable offline at
//! any time: the monitor's own preferred mode is EDID detailed timing #1
//! (registry, no elevation), and `EnumDisplaySettingsEx` lists every mode
//! Windows will offer. Native larger than anything offered = degraded.
//!
//! **TDRs.** A display driver reset ("stopped responding and has
//! recovered") is System-log provider `Display`, event ID 4101. Counted for
//! the last hour and day via an XPath `timediff()` query — no XML parsing.

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::state::SharedState;

/// How long a change is kept for the status blob.
pub const EVENT_KEEP: Duration = Duration::from_secs(60 * 60);
/// This many changes inside `FLAP_WINDOW` is a flapping cable, not a setup.
pub const FLAP_COUNT: usize = 3;
pub const FLAP_WINDOW: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Topology {
    pub monitors: u32,
    pub primary_w: u32,
    pub primary_h: u32,
}

impl Topology {
    fn describe(&self) -> String {
        format!(
            "{} monitor{}, primary {}×{}",
            self.monitors,
            if self.monitors == 1 { "" } else { "s" },
            self.primary_w,
            self.primary_h
        )
    }
}

/// One observed change, for the status blob.
#[derive(Debug, Clone)]
pub struct DisplayEvent {
    pub at: Instant,
    pub detail: String,
}

/// Recent changes plus the flapping verdict, from the shared event list.
pub fn summarize(events: &[DisplayEvent], now: Instant) -> (Vec<crate::protocol::DisplayEventInfo>, bool) {
    let recent: Vec<_> = events
        .iter()
        .filter(|e| now.saturating_duration_since(e.at) < EVENT_KEEP)
        .collect();
    let flapping = recent
        .iter()
        .filter(|e| now.saturating_duration_since(e.at) < FLAP_WINDOW)
        .count()
        >= FLAP_COUNT;
    let infos = recent
        .iter()
        .rev()
        .take(10)
        .map(|e| crate::protocol::DisplayEventInfo {
            secs_ago: now.saturating_duration_since(e.at).as_secs_f32(),
            detail: e.detail.clone(),
        })
        .collect();
    (infos, flapping)
}

/// One active monitor's link health: what it asks for vs what it gets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkInfo {
    /// Monitor name as Windows reports it (e.g. "Generic PnP Monitor").
    pub name: String,
    /// Native mode from EDID detailed timing #1; None if no EDID was found.
    pub native: Option<(u32, u32)>,
    /// Largest mode Windows offers on that adapter.
    pub offered: (u32, u32),
    /// Physical size in cm from EDID, if present.
    pub size_cm: Option<(u32, u32)>,
}

impl LinkInfo {
    /// The monitor wants more than the link carries. Orientation-agnostic:
    /// a portrait-rotated display offers 1080×1920 for a 1920×1080 panel,
    /// and that is not a degraded link.
    pub fn degraded(&self) -> bool {
        let Some((nw, nh)) = self.native else {
            return false;
        };
        let (nlo, nhi) = (nw.min(nh), nw.max(nh));
        let (olo, ohi) = (self.offered.0.min(self.offered.1), self.offered.0.max(self.offered.1));
        nlo > olo || nhi > ohi
    }

    pub fn to_info(&self) -> crate::protocol::DisplayLinkInfo {
        crate::protocol::DisplayLinkInfo {
            name: self.name.clone(),
            native_w: self.native.map_or(0, |n| n.0),
            native_h: self.native.map_or(0, |n| n.1),
            offered_w: self.offered.0,
            offered_h: self.offered.1,
            degraded: self.degraded(),
        }
    }
}

/// Native mode from an EDID block: detailed timing descriptor #1 at bytes
/// 54..72 (h-active = byte 56 + high nibble of 58 << 4, v-active = byte 59 +
/// high nibble of 61 << 4). A descriptor whose pixel clock is zero is not a
/// timing (some monitors put a name string first) — reported as None.
pub fn edid_native(edid: &[u8]) -> Option<(u32, u32)> {
    if edid.len() < 72 || edid[..8] != [0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0] {
        return None;
    }
    let d = &edid[54..72];
    let clock = u16::from_le_bytes([d[0], d[1]]);
    if clock == 0 {
        return None;
    }
    let h = d[2] as u32 | ((d[4] as u32 & 0xF0) << 4);
    let v = d[5] as u32 | ((d[7] as u32 & 0xF0) << 4);
    (h > 0 && v > 0).then_some((h, v))
}

/// Physical size in cm from EDID bytes 21/22 (0 = unknown / projector).
pub fn edid_size_cm(edid: &[u8]) -> Option<(u32, u32)> {
    if edid.len() < 23 || edid[21] == 0 || edid[22] == 0 {
        return None;
    }
    Some((edid[21] as u32, edid[22] as u32))
}

pub fn spawn(state: Arc<SharedState>) {
    #[cfg(windows)]
    std::thread::Builder::new()
        .name("display-watch".into())
        .spawn(move || run(state))
        .expect("spawn display watcher");
    #[cfg(not(windows))]
    let _ = state;
}

#[cfg(windows)]
fn read_topology() -> Topology {
    const SM_CXSCREEN: i32 = 0;
    const SM_CYSCREEN: i32 = 1;
    const SM_CMONITORS: i32 = 80;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetSystemMetrics(index: i32) -> i32;
    }
    // SAFETY: GetSystemMetrics takes an index and has no preconditions.
    unsafe {
        Topology {
            monitors: GetSystemMetrics(SM_CMONITORS).max(0) as u32,
            primary_w: GetSystemMetrics(SM_CXSCREEN).max(0) as u32,
            primary_h: GetSystemMetrics(SM_CYSCREEN).max(0) as u32,
        }
    }
}

#[cfg(windows)]
fn wide_to_string(w: &[u16]) -> String {
    let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..end])
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The EDID block Windows cached for a monitor, found by the monitor's PnP
/// device id (`MONITOR\<PNPID>\{class-guid}\<n>`): the registry key
/// `HKLM\SYSTEM\CurrentControlSet\Enum\DISPLAY\<PNPID>\<instance>` whose
/// `Driver` value equals `{class-guid}\<n>` carries it under
/// `Device Parameters\EDID`. Readable without elevation.
#[cfg(windows)]
fn edid_for(device_id: &str) -> Option<Vec<u8>> {
    use windows::Win32::System::Registry::{
        HKEY, HKEY_LOCAL_MACHINE, KEY_READ, RegCloseKey, RegEnumKeyExW, RegOpenKeyExW,
    };
    use windows::core::{PCWSTR, PWSTR};
    let mut parts = device_id.split('\\');
    if parts.next()? != "MONITOR" {
        return None;
    }
    let pnp_id = parts.next()?;
    let driver: String = parts.collect::<Vec<_>>().join("\\");
    if driver.is_empty() {
        return None;
    }
    let base = wide(&format!("SYSTEM\\CurrentControlSet\\Enum\\DISPLAY\\{pnp_id}"));
    let mut hkey = HKEY::default();
    // SAFETY: valid NUL-terminated key path and out-pointer.
    if unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, PCWSTR(base.as_ptr()), None, KEY_READ, &mut hkey) }
        .is_err()
    {
        return None;
    }
    let mut found = None;
    let mut index = 0u32;
    loop {
        let mut name = [0u16; 256];
        let mut len = name.len() as u32;
        // SAFETY: buffer and length describe `name`.
        if unsafe {
            RegEnumKeyExW(hkey, index, Some(PWSTR(name.as_mut_ptr())), &mut len, None, None, None, None)
        }
        .is_err()
        {
            break;
        }
        index += 1;
        let instance = wide_to_string(&name[..len as usize]);
        let mut sub = HKEY::default();
        let sub_path = wide(&instance);
        if unsafe { RegOpenKeyExW(hkey, PCWSTR(sub_path.as_ptr()), None, KEY_READ, &mut sub) }.is_err() {
            continue;
        }
        let matches = read_reg_value(sub, "Driver")
            .map(|v| {
                let u16s: Vec<u16> = v.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                wide_to_string(&u16s) == driver
            })
            .unwrap_or(false);
        if matches {
            let mut params = HKEY::default();
            let params_path = wide("Device Parameters");
            if unsafe { RegOpenKeyExW(sub, PCWSTR(params_path.as_ptr()), None, KEY_READ, &mut params) }
                .is_ok()
            {
                found = read_reg_value(params, "EDID");
                unsafe {
                    let _ = RegCloseKey(params);
                }
            }
        }
        unsafe {
            let _ = RegCloseKey(sub);
        }
        if found.is_some() {
            break;
        }
    }
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    found
}

/// Raw bytes of a registry value (REG_SZ values come back as UTF-16LE).
#[cfg(windows)]
fn read_reg_value(key: windows::Win32::System::Registry::HKEY, name: &str) -> Option<Vec<u8>> {
    use windows::Win32::System::Registry::RegQueryValueExW;
    use windows::core::PCWSTR;
    let wname = wide(name);
    let mut len = 0u32;
    // SAFETY: size query with a null data pointer is the documented idiom.
    if unsafe { RegQueryValueExW(key, PCWSTR(wname.as_ptr()), None, None, None, Some(&mut len)) }
        .is_err()
        || len == 0
    {
        return None;
    }
    let mut buf = vec![0u8; len as usize];
    // SAFETY: `buf` has `len` bytes.
    if unsafe {
        RegQueryValueExW(
            key,
            PCWSTR(wname.as_ptr()),
            None,
            None,
            Some(buf.as_mut_ptr()),
            Some(&mut len),
        )
    }
    .is_err()
    {
        return None;
    }
    buf.truncate(len as usize);
    Some(buf)
}

/// Every active monitor: the largest mode Windows offers on its adapter vs
/// the mode its EDID asks for.
#[cfg(windows)]
pub fn link_report() -> Vec<LinkInfo> {
    use windows::Win32::Graphics::Gdi::{
        DEVMODEW, DISPLAY_DEVICE_ACTIVE, DISPLAY_DEVICEW, ENUM_DISPLAY_SETTINGS_FLAGS,
        ENUM_DISPLAY_SETTINGS_MODE, EnumDisplayDevicesW, EnumDisplaySettingsExW,
    };
    use windows::core::PCWSTR;
    let mut out = Vec::new();
    let mut adapter_index = 0u32;
    loop {
        // SAFETY: zeroed POD structs with `cb` set, as the API requires.
        let mut adapter: DISPLAY_DEVICEW = unsafe { std::mem::zeroed() };
        adapter.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
        if !unsafe { EnumDisplayDevicesW(PCWSTR::null(), adapter_index, &mut adapter, 0) }.as_bool() {
            break;
        }
        adapter_index += 1;
        if adapter.StateFlags.0 & DISPLAY_DEVICE_ACTIVE.0 == 0 {
            continue;
        }
        let adapter_name = adapter.DeviceName;
        let mut offered = (0u32, 0u32);
        let mut mode = 0u32;
        loop {
            let mut dm: DEVMODEW = unsafe { std::mem::zeroed() };
            dm.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
            if !unsafe {
                EnumDisplaySettingsExW(
                    PCWSTR(adapter_name.as_ptr()),
                    ENUM_DISPLAY_SETTINGS_MODE(mode),
                    &mut dm,
                    ENUM_DISPLAY_SETTINGS_FLAGS(0),
                )
            }
            .as_bool()
            {
                break;
            }
            mode += 1;
            if dm.dmPelsWidth * dm.dmPelsHeight > offered.0 * offered.1 {
                offered = (dm.dmPelsWidth, dm.dmPelsHeight);
            }
        }
        let mut monitor_index = 0u32;
        loop {
            let mut monitor: DISPLAY_DEVICEW = unsafe { std::mem::zeroed() };
            monitor.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            if !unsafe {
                EnumDisplayDevicesW(PCWSTR(adapter_name.as_ptr()), monitor_index, &mut monitor, 0)
            }
            .as_bool()
            {
                break;
            }
            monitor_index += 1;
            if monitor.StateFlags.0 & DISPLAY_DEVICE_ACTIVE.0 == 0 {
                continue;
            }
            let device_id = wide_to_string(&monitor.DeviceID);
            let edid = edid_for(&device_id);
            out.push(LinkInfo {
                name: wide_to_string(&monitor.DeviceString),
                native: edid.as_deref().and_then(edid_native),
                offered,
                size_cm: edid.as_deref().and_then(edid_size_cm),
            });
        }
    }
    out
}

/// Display-driver resets (System log, provider `Display`, event 4101 —
/// "stopped responding and has successfully recovered") within the last
/// `within`. XPath `timediff()` does the time filter, so no XML is parsed.
#[cfg(windows)]
pub fn tdr_count(within: Duration) -> Option<u32> {
    use windows::Win32::System::EventLog::{EVT_HANDLE, EvtClose, EvtNext, EvtQuery, EvtQueryChannelPath};
    use windows::core::PCWSTR;
    let channel = wide("System");
    let query = wide(&format!(
        "*[System[Provider[@Name='Display'] and EventID=4101 and TimeCreated[timediff(@SystemTime) <= {}]]]",
        within.as_millis()
    ));
    // SAFETY: valid NUL-terminated strings; every handle is closed below.
    let result = unsafe {
        EvtQuery(None, PCWSTR(channel.as_ptr()), PCWSTR(query.as_ptr()), EvtQueryChannelPath.0)
    }
    .ok()?;
    let mut count = 0u32;
    loop {
        let mut batch = [0isize; 16];
        let mut returned = 0u32;
        let ok = unsafe { EvtNext(result, &mut batch, 1000, 0, &mut returned) }.is_ok();
        for handle in batch.iter().take(returned as usize) {
            unsafe {
                let _ = EvtClose(EVT_HANDLE(*handle));
            }
        }
        count += returned;
        if !ok || returned == 0 {
            break;
        }
    }
    unsafe {
        let _ = EvtClose(result);
    }
    Some(count)
}

#[cfg(windows)]
fn refresh_links(state: &SharedState) {
    let links = link_report();
    let previous = state.display_links.lock().clone();
    if links != previous {
        for link in &links {
            if link.degraded() {
                log::warn!(
                    "display link degraded: '{}' wants {}×{} but Windows offers at most {}×{} — a USB-C \
                     DisplayPort link on too few lanes (reseat/flip the plug, full-featured cable, no hub)",
                    link.name,
                    link.native.map_or(0, |n| n.0),
                    link.native.map_or(0, |n| n.1),
                    link.offered.0,
                    link.offered.1
                );
            } else {
                log::info!(
                    "display link: '{}' native {:?}, offered {}×{}",
                    link.name,
                    link.native,
                    link.offered.0,
                    link.offered.1
                );
            }
        }
        *state.display_links.lock() = links;
    }
}

#[cfg(windows)]
fn refresh_tdr(state: &SharedState) {
    use std::sync::atomic::Ordering;
    let hour = tdr_count(Duration::from_secs(3600)).unwrap_or(0);
    let day = tdr_count(Duration::from_secs(24 * 3600)).unwrap_or(0);
    let packed = ((hour as u64) << 32) | day as u64;
    let previous = state.tdr_counts.swap(packed, Ordering::Relaxed);
    if previous != packed && hour > 0 {
        log::warn!("display driver resets (TDR, System/Display 4101): {hour} in the last hour, {day} today");
    }
}

#[cfg(windows)]
fn run(state: Arc<SharedState>) {
    use std::sync::atomic::Ordering;
    let mut last = read_topology();
    log::info!("display watcher: {}", last.describe());
    refresh_links(&state);
    refresh_tdr(&state);
    let mut last_slow = Instant::now();
    let mut was_flapping = false;
    while !state.shutdown.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(500));
        let now = read_topology();
        if now != last {
            let detail = format!("{} → {}", last.describe(), now.describe());
            log::warn!("display topology changed: {detail} (a GPU reset and a stall usually ride along)");
            let mut events = state.display_events.lock();
            events.push(DisplayEvent { at: Instant::now(), detail });
            let keep_from = Instant::now() - EVENT_KEEP;
            events.retain(|e| e.at >= keep_from);
            drop(events);
            last = now;
            // A hot-plug negotiates a new link: read it now, not in a minute.
            refresh_links(&state);
        }
        // Slow lane, once a minute: the link check (a monitor can renegotiate
        // without a topology change) and the TDR count.
        if last_slow.elapsed() >= Duration::from_secs(60) {
            last_slow = Instant::now();
            refresh_links(&state);
            refresh_tdr(&state);
        }
        let (_, flapping) = summarize(&state.display_events.lock(), Instant::now());
        if flapping != was_flapping {
            if flapping {
                log::warn!(
                    "display topology is FLAPPING: {FLAP_COUNT}+ changes in {} min — a bad cable, most likely",
                    FLAP_WINDOW.as_secs() / 60
                );
            } else {
                log::info!("display topology settled");
            }
            was_flapping = flapping;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edid_native_reads_detailed_timing_one() {
        // A 2560×1080 monitor: h = 0x00 + (0xA0 << 4) = 2560, v = 0x38 + (0x40 << 4) = 1080.
        let mut edid = vec![0u8; 128];
        edid[..8].copy_from_slice(&[0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0]);
        edid[21] = 37;
        edid[22] = 14;
        edid[54] = 0x10; // pixel clock low byte (non-zero: a timing)
        edid[56] = 0x00;
        edid[58] = 0xA0;
        edid[59] = 0x38;
        edid[61] = 0x40;
        assert_eq!(edid_native(&edid), Some((2560, 1080)));
        assert_eq!(edid_size_cm(&edid), Some((37, 14)));
        let link = LinkInfo {
            name: "TYPEC".into(),
            native: Some((2560, 1080)),
            offered: (1920, 1080),
            size_cm: Some((37, 14)),
        };
        assert!(link.degraded(), "native wider than anything offered");
        let fine = LinkInfo { offered: (2560, 1080), ..link.clone() };
        assert!(!fine.degraded());
        let rotated = LinkInfo { native: Some((1920, 1080)), offered: (1080, 1920), ..link.clone() };
        assert!(!rotated.degraded(), "a portrait-rotated panel is not a degraded link");
        // A descriptor with a zero pixel clock is a text descriptor, not a mode.
        edid[54] = 0;
        assert_eq!(edid_native(&edid), None);
        assert_eq!(edid_native(&[1, 2, 3]), None);
    }

    #[cfg(windows)]
    #[test]
    fn link_report_runs_on_this_machine() {
        // Real registry + user32 on the dev box; prints for `--nocapture`.
        for l in link_report() {
            eprintln!("{l:?} degraded={}", l.degraded());
        }
        eprintln!("tdr last day: {:?}", tdr_count(Duration::from_secs(86_400)));
    }

    #[test]
    fn three_changes_in_ten_minutes_is_flapping_and_old_ones_age_out() {
        let now = Instant::now();
        let ev = |secs_ago: u64| DisplayEvent {
            at: now - Duration::from_secs(secs_ago),
            detail: format!("{secs_ago}s ago"),
        };
        // The shared list is chronological (oldest first), as the watcher pushes it.
        let (infos, flapping) = summarize(&[ev(200), ev(30)], now);
        assert_eq!(infos.len(), 2);
        assert!(!flapping, "two changes are a setup, not a flap");
        let (_, flapping) = summarize(&[ev(400), ev(200), ev(30)], now);
        assert!(flapping);
        let (infos, flapping) = summarize(&[ev(4000), ev(700), ev(30)], now);
        assert_eq!(infos.len(), 2, "an hour-old change is gone");
        assert!(!flapping, "only two inside the ten-minute window");
        assert_eq!(infos[0].detail, "30s ago", "newest first");
    }
}
