//! Where each pixel controller is on the network.
//!
//! Unicast sACN needs every controller's IP. An entry in `output.controllers` can
//! give it two ways, mixed freely in one list:
//!
//! - **An IPv4 address** — a static IP or a DHCP reservation. Used as written;
//!   discovery never second-guesses it.
//! - **A MAC address** — the box's permanent identity. Its current IP comes from
//!   Advatek discovery: a background resolver probes the lighting network, keeps
//!   the answer current as DHCP leases move, and remembers it across restarts
//!   (`controller-addresses.json` beside the config), so a restart sends to the
//!   last-known address at once instead of waiting on a scan.
//!
//! A MAC that has never been found does not go dark: the sender multicasts that
//! controller's universes until the resolver finds it (see `SacnSender::configure`).

use crate::config::OutputConfig;
use crate::discovery::FoundController;
use crate::state::SharedState;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub type Mac = [u8; 6];

/// How long one resolver probe listens for replies.
const PROBE_WINDOW: Duration = Duration::from_millis(1500);
/// Probe cadence while any MAC entry is still unresolved.
const SEARCH_INTERVAL: Duration = Duration::from_secs(5);
/// Probe cadence once every MAC entry has an address — just watching for moves.
const WATCH_INTERVAL: Duration = Duration::from_secs(30);
/// Status refresh cadence (the "seen N s ago" counters).
const PUBLISH_INTERVAL: Duration = Duration::from_secs(1);

/// What one `output.controllers` entry names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControllerRef {
    Empty,
    Ip(Ipv4Addr),
    Mac(Mac),
    Invalid,
}

pub fn parse_entry(entry: &str) -> ControllerRef {
    let entry = entry.trim();
    if entry.is_empty() {
        ControllerRef::Empty
    } else if let Ok(ip) = entry.parse::<Ipv4Addr>() {
        ControllerRef::Ip(ip)
    } else if let Some(mac) = parse_mac(entry) {
        ControllerRef::Mac(mac)
    } else {
        ControllerRef::Invalid
    }
}

/// Accepts `aa:bb:cc:dd:ee:ff`, `aa-bb-cc-dd-ee-ff`, `aabb.ccdd.eeff` and bare
/// `aabbccddeeff`, in any case — whatever a label, a router page or Advatek
/// Assistant happened to print.
pub fn parse_mac(text: &str) -> Option<Mac> {
    let text = text.trim();
    let hex: String = match text.len() {
        17 => {
            let sep = text.as_bytes()[2];
            if sep != b':' && sep != b'-' {
                return None;
            }
            let groups: Vec<&str> = text.split(sep as char).collect();
            if groups.len() != 6 || groups.iter().any(|g| g.len() != 2) {
                return None;
            }
            groups.concat()
        }
        14 => {
            let groups: Vec<&str> = text.split('.').collect();
            if groups.len() != 3 || groups.iter().any(|g| g.len() != 4) {
                return None;
            }
            groups.concat()
        }
        12 => text.to_string(),
        _ => return None,
    };
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut mac = [0u8; 6];
    for (i, byte) in mac.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(mac)
}

/// Canonical form, matching what the discovery parsers print.
pub fn mac_text(mac: &Mac) -> String {
    mac.iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct Known {
    ip: Ipv4Addr,
    /// Unix seconds when a probe last heard this MAC at this address.
    seen: u64,
    /// Loaded from the cache file and not heard from since this process started.
    #[serde(skip)]
    from_cache: bool,
}

/// MAC → last address it answered from.
#[derive(Debug, Clone, Default)]
pub struct AddressBook {
    known: BTreeMap<Mac, Known>,
}

#[derive(Serialize, Deserialize)]
struct CacheFile {
    /// Keyed by canonical MAC text, so the file is readable by a person.
    controllers: BTreeMap<String, Known>,
}

impl AddressBook {
    pub fn lookup(&self, mac: &Mac) -> Option<Ipv4Addr> {
        self.known.get(mac).map(|k| k.ip)
    }

    /// Note that `mac` answered from `ip`. True when that changes where sACN
    /// should go (a new controller, or one that moved).
    pub fn observe(&mut self, mac: Mac, ip: Ipv4Addr, now: u64) -> bool {
        let previous = self.known.insert(
            mac,
            Known {
                ip,
                seen: now,
                from_cache: false,
            },
        );
        previous.map(|k| k.ip) != Some(ip)
    }

    /// Feed a scan's answers in; true when any routing changed.
    pub fn observe_all(&mut self, found: &[FoundController], now: u64) -> bool {
        let mut changed = false;
        for c in found {
            if let (Some(mac), Ok(ip)) = (parse_mac(&c.mac), c.ip.parse::<Ipv4Addr>()) {
                changed |= self.observe(mac, ip, now);
            }
        }
        changed
    }

    pub fn load(path: &Path) -> Self {
        let Ok(text) = std::fs::read_to_string(path) else {
            return Self::default(); // first run, or nothing ever resolved
        };
        match serde_json::from_str::<CacheFile>(&text) {
            Ok(file) => Self {
                known: file
                    .controllers
                    .into_iter()
                    .filter_map(|(mac, k)| {
                        Some((
                            parse_mac(&mac)?,
                            Known {
                                from_cache: true,
                                ..k
                            },
                        ))
                    })
                    .collect(),
            },
            Err(e) => {
                // Only a hint for the first frames after a restart; the resolver
                // rebuilds it within seconds, so a bad file is not worth more.
                log::warn!("ignoring unreadable {}: {e}", path.display());
                Self::default()
            }
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let file = CacheFile {
            controllers: self
                .known
                .iter()
                .map(|(mac, k)| (mac_text(mac), *k))
                .collect(),
        };
        let text = serde_json::to_string_pretty(&file).map_err(std::io::Error::other)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, path)
    }
}

pub fn cache_path() -> PathBuf {
    crate::config::config_path().with_file_name("controller-addresses.json")
}

/// Where one controller entry's universes go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Destination {
    Unicast(Ipv4Addr),
    /// A MAC that has not been found yet: multicast its universes meanwhile.
    Fallback,
    /// Empty or unusable entry: nothing is sent for its spokes.
    Nowhere,
}

pub fn destination(entry: &str, book: &AddressBook) -> Destination {
    match parse_entry(entry) {
        ControllerRef::Ip(ip) => Destination::Unicast(ip),
        ControllerRef::Mac(mac) => book
            .lookup(&mac)
            .map(Destination::Unicast)
            .unwrap_or(Destination::Fallback),
        ControllerRef::Empty | ControllerRef::Invalid => Destination::Nowhere,
    }
}

/// One controller entry, as the UI shows it.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ControllerAddressStatus {
    /// Position in `output.controllers` (controller N drives spokes
    /// `N * strings_per_controller ..`).
    pub index: u32,
    pub entry: String,
    /// "empty" | "ip" | "mac" | "invalid".
    pub kind: String,
    /// Where its universes are sent now, when unicast.
    pub ip: Option<String>,
    /// "configured" (IP entry), "discovered" (heard this run), "cached" (last
    /// run's answer, not yet re-confirmed), "fallback" (MAC not found — sent
    /// multicast), "invalid", "empty".
    pub source: String,
    /// Seconds since a probe last heard this MAC (MAC entries only).
    pub seen_secs_ago: Option<u64>,
}

pub fn statuses(out: &OutputConfig, book: &AddressBook, now: u64) -> Vec<ControllerAddressStatus> {
    out.controllers
        .iter()
        .enumerate()
        .map(|(i, entry)| {
            let mut s = ControllerAddressStatus {
                index: i as u32,
                entry: entry.trim().to_string(),
                ..Default::default()
            };
            match parse_entry(entry) {
                ControllerRef::Empty => {
                    s.kind = "empty".into();
                    s.source = "empty".into();
                }
                ControllerRef::Invalid => {
                    s.kind = "invalid".into();
                    s.source = "invalid".into();
                }
                ControllerRef::Ip(ip) => {
                    s.kind = "ip".into();
                    s.ip = Some(ip.to_string());
                    s.source = "configured".into();
                }
                ControllerRef::Mac(mac) => {
                    s.kind = "mac".into();
                    match book.known.get(&mac) {
                        Some(k) => {
                            s.ip = Some(k.ip.to_string());
                            s.source = if k.from_cache { "cached" } else { "discovered" }.into();
                            s.seen_secs_ago = Some(now.saturating_sub(k.seen));
                        }
                        None => s.source = "fallback".into(),
                    }
                }
            }
            s
        })
        .collect()
}

/// MAC entries that matter right now: only unicast mode routes by them.
fn wanted_macs(out: &OutputConfig) -> Vec<Mac> {
    if out.multicast {
        return Vec::new();
    }
    out.controllers
        .iter()
        .filter_map(|e| match parse_entry(e) {
            ControllerRef::Mac(mac) => Some(mac),
            _ => None,
        })
        .collect()
}

/// Feed a scan's answers into the shared book: persist and tell the engine to
/// re-plan when anything moved. Called by the resolver and by a manual scan.
pub fn record(state: &SharedState, found: &[FoundController]) {
    let changed = {
        let mut book = state.addresses.write();
        let changed = book.observe_all(found, unix_now());
        if changed && let Err(e) = book.save(&cache_path()) {
            log::warn!("cannot save controller addresses: {e}");
        }
        changed
    };
    if changed {
        log::info!("controller addresses changed; re-planning sACN destinations");
        state.address_epoch.fetch_add(1, Ordering::SeqCst);
    }
    publish(state);
}

fn publish(state: &SharedState) {
    let list = {
        let cfg = state.config.read();
        statuses(&cfg.output, &state.addresses.read(), unix_now())
    };
    state.status.lock().controller_addresses = list;
}

pub fn spawn(state: Arc<SharedState>) {
    std::thread::Builder::new()
        .name("controller-resolver".into())
        .spawn(move || run(state))
        .expect("spawn controller-resolver thread");
}

fn run(state: Arc<SharedState>) {
    let mut epoch = u32::MAX;
    let mut next_probe = Instant::now();
    let mut next_publish = Instant::now();

    while !state.shutdown.load(Ordering::Relaxed) {
        let now = Instant::now();
        // A config change (a new MAC typed in, unicast switched on) probes now
        // rather than at the next scheduled round.
        let current_epoch = state.epoch();
        if current_epoch != epoch {
            epoch = current_epoch;
            next_probe = now;
            next_publish = now;
        }

        if now >= next_probe {
            let (wanted, interface) = {
                let cfg = state.config.read();
                (wanted_macs(&cfg.output), cfg.output.interface.clone())
            };
            if wanted.is_empty() {
                next_probe = now + WATCH_INTERVAL;
            } else if let Some(_ports) = state.probe_lock.try_lock() {
                let (found, errors) = crate::discovery::probe_controllers(&interface, PROBE_WINDOW);
                for e in errors {
                    log::debug!("controller resolver: {e}");
                }
                record(&state, &found);
                let book = state.addresses.read();
                let all_found = wanted.iter().all(|m| book.lookup(m).is_some());
                next_probe = Instant::now()
                    + if all_found {
                        WATCH_INTERVAL
                    } else {
                        SEARCH_INTERVAL
                    };
            } else {
                // A manual scan holds the probe ports; it feeds the book itself.
                next_probe = now + Duration::from_secs(1);
            }
        }

        if now >= next_publish {
            next_publish = now + PUBLISH_INTERVAL;
            publish(&state);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAC: Mac = [0x00, 0x50, 0xC2, 0x1A, 0x2B, 0x3C];

    #[test]
    fn entries_classify_as_ip_mac_empty_or_invalid() {
        assert_eq!(parse_entry(""), ControllerRef::Empty);
        assert_eq!(parse_entry("   "), ControllerRef::Empty);
        assert_eq!(
            parse_entry("10.0.0.5"),
            ControllerRef::Ip(Ipv4Addr::new(10, 0, 0, 5))
        );
        assert_eq!(
            parse_entry(" 10.0.0.5 "),
            ControllerRef::Ip(Ipv4Addr::new(10, 0, 0, 5))
        );
        assert_eq!(parse_entry("00:50:c2:1a:2b:3c"), ControllerRef::Mac(MAC));
        assert_eq!(parse_entry("pixlite-3"), ControllerRef::Invalid);
        assert_eq!(parse_entry("10.0.0.256"), ControllerRef::Invalid);
    }

    #[test]
    fn mac_accepts_every_common_spelling() {
        for text in [
            "00:50:C2:1A:2B:3C",
            "00:50:c2:1a:2b:3c",
            "00-50-C2-1A-2B-3C",
            "0050.c21a.2b3c",
            "0050C21A2B3C",
        ] {
            assert_eq!(parse_mac(text), Some(MAC), "{text}");
        }
    }

    #[test]
    fn malformed_macs_are_rejected() {
        for text in [
            "00:50:C2:1A:2B",       // too short
            "00:50:C2:1A:2B:3C:4D", // too long
            "00:50-C2:1A:2B:3C",    // mixed separators
            "0:050:C2:1A:2B:3C",    // misplaced separator
            "00:50:C2:1A:2B:3G",    // not hex
            "0050C21A2B3",          // 11 digits
            "+050C21A2B3C",         // sign is not a digit
        ] {
            assert_eq!(parse_mac(text), None, "{text}");
        }
    }

    #[test]
    fn mac_text_is_the_canonical_round_trip() {
        assert_eq!(mac_text(&MAC), "00:50:C2:1A:2B:3C");
        assert_eq!(parse_mac(&mac_text(&MAC)), Some(MAC));
    }

    #[test]
    fn observe_reports_only_routing_changes() {
        let mut book = AddressBook::default();
        let a = Ipv4Addr::new(10, 0, 0, 5);
        let b = Ipv4Addr::new(10, 0, 0, 9);
        assert!(book.observe(MAC, a, 100), "new controller");
        assert!(
            !book.observe(MAC, a, 130),
            "same address again is not a change"
        );
        assert!(book.observe(MAC, b, 160), "a moved lease is");
        assert_eq!(book.lookup(&MAC), Some(b));
    }

    #[test]
    fn destinations_follow_the_entry_kind() {
        let mut book = AddressBook::default();
        let ip = Ipv4Addr::new(10, 0, 0, 7);
        assert_eq!(
            destination("10.0.0.3", &book),
            Destination::Unicast(Ipv4Addr::new(10, 0, 0, 3))
        );
        assert_eq!(
            destination("00:50:c2:1a:2b:3c", &book),
            Destination::Fallback
        );
        book.observe(MAC, ip, 0);
        assert_eq!(
            destination("00:50:c2:1a:2b:3c", &book),
            Destination::Unicast(ip)
        );
        assert_eq!(destination("", &book), Destination::Nowhere);
        assert_eq!(destination("nonsense", &book), Destination::Nowhere);
    }

    #[test]
    fn discovery_never_overrides_an_ip_entry() {
        let mut book = AddressBook::default();
        // Even if some box claims the MAC-looking identity of an IP entry's
        // controller, an IP entry is used exactly as written.
        book.observe(MAC, Ipv4Addr::new(10, 9, 9, 9), 0);
        assert_eq!(
            destination("10.0.0.3", &book),
            Destination::Unicast(Ipv4Addr::new(10, 0, 0, 3))
        );
    }

    #[test]
    fn scan_results_feed_the_book_by_mac() {
        let mut book = AddressBook::default();
        let found = vec![
            FoundController {
                ip: "10.0.0.20".into(),
                mac: "00:50:c2:1a:2b:3c".into(),
                ..Default::default()
            },
            // A reply with no parsable MAC (an old legacy struct) cannot be keyed.
            FoundController {
                ip: "10.0.0.21".into(),
                mac: String::new(),
                ..Default::default()
            },
        ];
        assert!(book.observe_all(&found, 5));
        assert_eq!(book.lookup(&MAC), Some(Ipv4Addr::new(10, 0, 0, 20)));
        assert_eq!(book.known.len(), 1);
        assert!(!book.observe_all(&found, 6), "nothing moved");
    }

    #[test]
    fn the_cache_round_trips_and_marks_entries_as_cached() {
        let dir = std::env::temp_dir().join(format!("empyrean-addr-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("controller-addresses.json");

        let mut book = AddressBook::default();
        book.observe(MAC, Ipv4Addr::new(10, 0, 0, 5), 1000);
        book.save(&path).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            text.contains("00:50:C2:1A:2B:3C"),
            "keyed by readable MAC: {text}"
        );

        let loaded = AddressBook::load(&path);
        assert_eq!(loaded.lookup(&MAC), Some(Ipv4Addr::new(10, 0, 0, 5)));
        assert!(loaded.known[&MAC].from_cache);

        std::fs::write(&path, "not json").unwrap();
        assert!(
            AddressBook::load(&path).known.is_empty(),
            "a bad cache is ignored"
        );
        assert!(
            AddressBook::load(&dir.join("missing.json"))
                .known
                .is_empty()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn statuses_describe_every_entry() {
        let mut out = OutputConfig::default();
        out.controllers = vec![
            "10.0.0.3".into(),
            "00:50:c2:1a:2b:3c".into(),
            "00:50:c2:00:00:01".into(),
            "".into(),
            "box 5".into(),
        ];
        let mut book = AddressBook::default();
        book.observe(MAC, Ipv4Addr::new(10, 0, 0, 40), 90);
        let s = statuses(&out, &book, 100);

        assert_eq!(
            (s[0].kind.as_str(), s[0].source.as_str()),
            ("ip", "configured")
        );
        assert_eq!(s[0].ip.as_deref(), Some("10.0.0.3"));
        assert_eq!(
            (s[1].kind.as_str(), s[1].source.as_str()),
            ("mac", "discovered")
        );
        assert_eq!(s[1].ip.as_deref(), Some("10.0.0.40"));
        assert_eq!(s[1].seen_secs_ago, Some(10));
        assert_eq!(
            (s[2].kind.as_str(), s[2].source.as_str()),
            ("mac", "fallback")
        );
        assert_eq!(s[2].ip, None);
        assert_eq!(s[3].kind, "empty");
        assert_eq!(s[4].kind, "invalid");
        assert_eq!(s[4].index, 4);
    }

    #[test]
    fn only_unicast_mode_wants_macs_resolved() {
        let mut out = OutputConfig::default();
        out.controllers = vec!["10.0.0.3".into(), "00:50:c2:1a:2b:3c".into()];
        out.multicast = true;
        assert!(wanted_macs(&out).is_empty());
        out.multicast = false;
        assert_eq!(wanted_macs(&out), vec![MAC]);
    }
}
