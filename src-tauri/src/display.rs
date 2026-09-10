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
//! Declared by hand rather than pulling in the `windows` crate — three calls.

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
fn run(state: Arc<SharedState>) {
    use std::sync::atomic::Ordering;
    let mut last = read_topology();
    log::info!("display watcher: {}", last.describe());
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
            last = now;
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
