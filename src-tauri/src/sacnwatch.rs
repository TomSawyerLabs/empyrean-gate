//! Passive watch for OTHER sACN sources driving the universes we drive.
//!
//! Why this exists: sACN is fire-and-forget and multi-master by design. If a
//! console, a visualiser left running, or a second copy of this app transmits on
//! the same universes, the receiver applies E1.31's arbitration rules and the rig
//! stops doing what this app says — with nothing on our side to indicate it. The
//! three outcomes an operator needs to be able to tell apart:
//!
//! - **Higher priority than ours** — it wins outright; our frames are discarded.
//! - **Equal priority** — the receiver merges the two sources HTP, and the rig
//!   does what *neither* source asked for. This is the nastiest case and the one
//!   most likely to be mistaken for a bug in the show.
//! - **Lower priority** — harmless right now, but it is someone else's cable in
//!   our patch and worth knowing about before it changes.
//!
//! How: one thread, one socket on UDP 5568 with SO_REUSEADDR (it must never fight
//! sACNView, a second instance, or our own sender for the port), joined to
//!
//! - the E1.31 universe-discovery group, which every conformant source must
//!   advertise its universe list on every 10 s — this names sources and tells us
//!   *which* universes they claim, but carries no priority; and
//! - the multicast group of each universe we transmit on, up to `MAX_DATA_GROUPS`
//!   — data packets are the only place priority appears.
//!
//! Limits, stated here because the UI states them too: a source that **unicasts**
//! straight at the controllers is invisible to any passive listener on a switched
//! network, and multicast group memberships are a bounded OS resource, so a very
//! large patch is only sampled. "No peers" therefore means "none heard", not
//! "none exist".

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::geometry;
use crate::protocol::SacnPeer;
use crate::state::SharedState;

const SACN_PORT: u16 = 5568;
const ACN_ID: [u8; 12] = *b"ASC-E1.17\0\0\0";
/// Reserved universe for universe-discovery packets (239.255.250.214).
const DISCOVERY_UNIVERSE: u16 = 64214;
/// Root vector of a data packet.
const VECTOR_ROOT_DATA: u32 = 0x0000_0004;
/// Root vector of the extended (sync + discovery) packets.
const VECTOR_ROOT_EXTENDED: u32 = 0x0000_0008;
/// Framing vector of a data packet.
const VECTOR_FRAME_DATA: u32 = 0x0000_0002;
/// Framing vector of a universe-discovery packet.
const VECTOR_FRAME_DISCOVERY: u32 = 0x0000_0002;
/// Universe-discovery payload vector.
const VECTOR_DISCOVERY_LIST: u32 = 0x0000_0001;
/// Options bit 7: this is preview data, not a live level. A visualiser feed is
/// not competing for the rig.
const OPT_PREVIEW: u8 = 0x80;
/// Options bit 6: last packet of this source's stream for this universe.
const OPT_TERMINATED: u8 = 0x40;
/// E1.31's own source-loss timeout is 2.5 s. Double it before a peer disappears
/// from the UI, so a slow or bursty source does not make the banner flicker.
const PEER_TIMEOUT: Duration = Duration::from_secs(5);
/// Multicast memberships are a bounded OS resource (Linux defaults to 20 per
/// socket; Windows is larger but not unlimited). A 192-universe patch cannot be
/// watched in full, so watch a prefix of it and say so rather than failing.
const MAX_DATA_GROUPS: usize = 24;
/// How often the peer table is published into `RuntimeStatus`.
const PUBLISH_INTERVAL: Duration = Duration::from_millis(500);

fn multicast_group(universe: u16) -> Ipv4Addr {
    Ipv4Addr::new(239, 255, (universe >> 8) as u8, (universe & 0xff) as u8)
}

/// One E1.31 data packet, reduced to what contention analysis needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataPacket {
    pub cid: String,
    pub source_name: String,
    pub universe: u16,
    pub priority: u8,
    pub preview: bool,
    pub terminated: bool,
}

/// Parse an E1.31 data packet. `None` for anything else on the port — sync
/// packets, discovery packets, and whatever else a lighting network carries.
pub fn parse_data(data: &[u8]) -> Option<DataPacket> {
    // 126 = the smallest legal data packet: full headers, start code, no slots.
    if data.len() < 126
        || data[4..16] != ACN_ID
        || u32::from_be_bytes([data[18], data[19], data[20], data[21]]) != VECTOR_ROOT_DATA
        || u32::from_be_bytes([data[40], data[41], data[42], data[43]]) != VECTOR_FRAME_DATA
    {
        return None;
    }
    let options = data[112];
    Some(DataPacket {
        cid: uuid::Uuid::from_slice(&data[22..38]).ok()?.to_string(),
        source_name: text(data, 44, 64),
        universe: u16::from_be_bytes([data[113], data[114]]),
        priority: data[108],
        preview: options & OPT_PREVIEW != 0,
        terminated: options & OPT_TERMINATED != 0,
    })
}

/// Parse an E1.31 universe-discovery packet: "this CID transmits these
/// universes". Carries no priority — that only appears on data packets.
pub fn parse_discovery(data: &[u8]) -> Option<(String, String, Vec<u16>)> {
    if data.len() < 120
        || data[4..16] != ACN_ID
        || u32::from_be_bytes([data[18], data[19], data[20], data[21]]) != VECTOR_ROOT_EXTENDED
        || u32::from_be_bytes([data[40], data[41], data[42], data[43]]) != VECTOR_FRAME_DISCOVERY
        || u32::from_be_bytes([data[114], data[115], data[116], data[117]]) != VECTOR_DISCOVERY_LIST
    {
        return None;
    }
    let cid = uuid::Uuid::from_slice(&data[22..38]).ok()?.to_string();
    let universes = data[120..]
        .chunks_exact(2)
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .collect();
    Some((cid, text(data, 44, 64), universes))
}

/// Read a NUL-terminated (or length-bounded) ASCII field without panicking on a
/// short packet.
fn text(data: &[u8], at: usize, len: usize) -> String {
    let end = (at + len).min(data.len());
    if at >= end {
        return String::new();
    }
    let slice = &data[at..end];
    let stop = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    String::from_utf8_lossy(&slice[..stop]).trim().to_string()
}

#[derive(Default)]
struct Peer {
    source_name: String,
    from_ip: String,
    /// Universes we have heard DATA on, and the highest priority used there.
    heard: BTreeMap<u16, u8>,
    /// Universes the source ADVERTISES in its discovery packets. A source can
    /// claim far more than we are able to listen to.
    announced: BTreeSet<u16>,
    last_seen: Option<Instant>,
    /// Data packets in the bucket currently filling, and the last full bucket.
    packets: u32,
    pps: u32,
    /// True until a single non-preview data packet arrives. A visualiser feed
    /// does not drive lights and must not raise an alarm.
    preview_only: bool,
    /// Set once any data packet has been seen — `preview_only` is meaningless
    /// before that (discovery packets have no preview flag).
    saw_data: bool,
}

impl Peer {
    fn snapshot(&self, cid: &str, ours: &BTreeSet<u16>, our_priority: u8) -> SacnPeer {
        let overlapping: Vec<u16> = self
            .heard
            .keys()
            .copied()
            .chain(self.announced.iter().copied())
            .filter(|u| ours.contains(u))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        // Priority from the shared universes when we have heard any there;
        // otherwise the highest we have heard at all, so a source that overlaps
        // only on universes we could not join still reports something real.
        let shared_priority = self
            .heard
            .iter()
            .filter(|(u, _)| ours.contains(u))
            .map(|(_, p)| *p)
            .max();
        let priority = shared_priority.or_else(|| self.heard.values().copied().max());
        let contests = !overlapping.is_empty() && self.saw_data && !self.preview_only;
        SacnPeer {
            cid: cid.to_string(),
            source_name: self.source_name.clone(),
            from_ip: self.from_ip.clone(),
            universes: self.heard.keys().copied().collect(),
            announced: self.announced.iter().copied().collect(),
            overlapping,
            priority,
            our_priority,
            packets_per_sec: self.pps,
            preview_only: self.saw_data && self.preview_only,
            wins: contests && shared_priority.is_some_and(|p| p > our_priority),
            ties: contests && shared_priority.is_some_and(|p| p == our_priority),
        }
    }
}

pub fn spawn(state: Arc<SharedState>) {
    std::thread::Builder::new()
        .name("sacn-watch".into())
        .spawn(move || run(state))
        .expect("spawn sacn-watch thread");
}

/// Bind the listen socket. Address reuse is mandatory: our own sender, sACNView,
/// and a second instance mid-takeover all legitimately want this port.
fn listen_socket(interface: Ipv4Addr) -> std::io::Result<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    // Multicast groups must be joined on a socket bound to the wildcard address
    // on Windows, so bind INADDR_ANY and steer membership with the interface arg.
    socket.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, SACN_PORT).into())?;
    socket.set_read_timeout(Some(Duration::from_millis(200)))?;
    let _ = socket.set_multicast_if_v4(&interface);
    Ok(socket.into())
}

fn run(state: Arc<SharedState>) {
    let mut socket: Option<UdpSocket> = None;
    let mut key = (Ipv4Addr::UNSPECIFIED, Vec::<u16>::new());
    let mut ours: BTreeSet<u16> = BTreeSet::new();
    let mut our_cid = String::new();
    let mut our_priority = 100u8;
    let mut watched = 0u16;
    let mut error: Option<String> = None;
    let mut peers: HashMap<String, Peer> = HashMap::new();
    let mut buf = [0u8; 2048];
    let mut bucket = Instant::now();
    let mut published = Instant::now() - PUBLISH_INTERVAL;
    let mut epoch = u32::MAX;

    while !state.shutdown.load(Ordering::Relaxed) {
        // Re-derive the watch list when geometry/output change. Cheap to check
        // (one atomic) and only does real work on an actual epoch bump.
        let current_epoch = state.epoch();
        if current_epoch != epoch {
            epoch = current_epoch;
            let cfg = state.config.read();
            let interface: Ipv4Addr = cfg.output.interface.parse().unwrap_or(Ipv4Addr::UNSPECIFIED);
            let universes = geometry::universe_list(&cfg.geometry, &cfg.output);
            our_cid = uuid::Uuid::parse_str(&cfg.output.cid)
                .map(|u| u.to_string())
                .unwrap_or_default();
            our_priority = cfg.output.priority;
            let next_key = (interface, universes.clone());
            drop(cfg);

            if next_key != key || socket.is_none() {
                key = next_key;
                ours = universes.iter().copied().collect();
                peers.clear();
                match listen_socket(interface) {
                    Ok(s) => {
                        let mut joined = 0u16;
                        let mut failures = Vec::new();
                        if let Err(e) = s.join_multicast_v4(
                            &multicast_group(DISCOVERY_UNIVERSE),
                            &interface,
                        ) {
                            failures.push(format!("universe discovery: {e}"));
                        }
                        for universe in universes.iter().take(MAX_DATA_GROUPS) {
                            match s.join_multicast_v4(&multicast_group(*universe), &interface) {
                                Ok(()) => joined += 1,
                                Err(e) => {
                                    // One message, not one per universe: the
                                    // cause is the same membership limit each time.
                                    if failures.len() < 2 {
                                        failures.push(format!("universe {universe}: {e}"));
                                    }
                                }
                            }
                        }
                        watched = joined;
                        error = (!failures.is_empty())
                            .then(|| format!("cannot watch some universes ({})", failures.join("; ")));
                        if let Some(e) = &error {
                            log::warn!("sACN watch: {e}");
                        } else {
                            log::info!(
                                "sACN watch: listening for other sources on {joined} of {} universes",
                                universes.len()
                            );
                        }
                        socket = Some(s);
                    }
                    Err(e) => {
                        watched = 0;
                        error = Some(format!("cannot listen on UDP {SACN_PORT}: {e}"));
                        log::warn!("sACN watch: {}", error.as_deref().unwrap_or_default());
                        socket = None;
                    }
                }
            }
        }

        let Some(s) = socket.as_ref() else {
            // No socket: surface the reason, then retry. The bind can start
            // working later (a NIC that came up, a tool that released the port),
            // so this must not be a one-shot.
            publish(&state, &peers, &ours, our_priority, watched, &error);
            std::thread::sleep(Duration::from_secs(5));
            epoch = u32::MAX; // force a rebind attempt
            continue;
        };

        // Drain whatever is waiting, then fall through on the read timeout.
        while let Ok((n, from)) = s.recv_from(&mut buf) {
            let std::net::SocketAddr::V4(from) = from else {
                continue;
            };
            let data = &buf[..n];
            if let Some(p) = parse_data(data) {
                if p.cid == our_cid {
                    continue; // multicast loops back; we are not our own rival
                }
                let peer = peers.entry(p.cid).or_default();
                peer.from_ip = from.ip().to_string();
                if !p.source_name.is_empty() {
                    peer.source_name = p.source_name;
                }
                if !peer.saw_data {
                    peer.saw_data = true;
                    peer.preview_only = true;
                }
                peer.preview_only &= p.preview;
                if p.terminated {
                    peer.heard.remove(&p.universe);
                } else {
                    // Latest wins, not the maximum ever seen: a source that drops
                    // its priority mid-show has stopped being a problem, and the
                    // banner should say so rather than remembering a grudge.
                    peer.heard.insert(p.universe, p.priority);
                }
                peer.packets += 1;
                peer.last_seen = Some(Instant::now());
            } else if let Some((cid, name, universes)) = parse_discovery(data) {
                if cid == our_cid {
                    continue;
                }
                let peer = peers.entry(cid).or_default();
                peer.from_ip = from.ip().to_string();
                if !name.is_empty() {
                    peer.source_name = name;
                }
                peer.announced = universes.into_iter().collect();
                peer.last_seen = Some(Instant::now());
            }
        }

        if bucket.elapsed() >= Duration::from_secs(1) {
            bucket = Instant::now();
            for peer in peers.values_mut() {
                peer.pps = peer.packets;
                peer.packets = 0;
            }
        }
        peers.retain(|_, p| p.last_seen.is_some_and(|t| t.elapsed() < PEER_TIMEOUT));

        if published.elapsed() >= PUBLISH_INTERVAL {
            published = Instant::now();
            publish(&state, &peers, &ours, our_priority, watched, &error);
        }
    }
}

fn publish(
    state: &SharedState,
    peers: &HashMap<String, Peer>,
    ours: &BTreeSet<u16>,
    our_priority: u8,
    watched: u16,
    error: &Option<String>,
) {
    let mut list: Vec<SacnPeer> = peers
        .iter()
        .map(|(cid, peer)| peer.snapshot(cid, ours, our_priority))
        .collect();
    // Loudest problem first: outright winners, then merges, then bystanders.
    list.sort_by_key(|p| {
        (
            !p.wins,
            !p.ties,
            std::cmp::Reverse(p.overlapping.len()),
            p.source_name.clone(),
        )
    });
    let mut status = state.status.lock();
    status.sacn_peers = list;
    status.sacn_priority = our_priority;
    status.sacn_watched_universes = watched;
    status.sacn_watch_error = error.clone();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data_packet(cid: [u8; 16], universe: u16, priority: u8, options: u8) -> Vec<u8> {
        let mut p = vec![0u8; 126];
        p[0..2].copy_from_slice(&0x0010u16.to_be_bytes());
        p[4..16].copy_from_slice(&ACN_ID);
        p[18..22].copy_from_slice(&VECTOR_ROOT_DATA.to_be_bytes());
        p[22..38].copy_from_slice(&cid);
        p[40..44].copy_from_slice(&VECTOR_FRAME_DATA.to_be_bytes());
        p[44..51].copy_from_slice(b"Console");
        p[108] = priority;
        p[112] = options;
        p[113..115].copy_from_slice(&universe.to_be_bytes());
        p
    }

    #[test]
    fn reads_priority_and_universe_off_a_data_packet() {
        let parsed = parse_data(&data_packet([7; 16], 42, 150, 0)).expect("a data packet");
        assert_eq!(parsed.universe, 42);
        assert_eq!(parsed.priority, 150);
        assert_eq!(parsed.source_name, "Console");
        assert!(!parsed.preview);
        assert!(!parsed.terminated);
    }

    #[test]
    fn flags_preview_and_terminated_options() {
        let preview = parse_data(&data_packet([7; 16], 1, 100, OPT_PREVIEW)).unwrap();
        assert!(preview.preview);
        let done = parse_data(&data_packet([7; 16], 1, 100, OPT_TERMINATED)).unwrap();
        assert!(done.terminated);
    }

    #[test]
    fn rejects_short_and_foreign_packets() {
        assert!(parse_data(&[0u8; 32]).is_none());
        let mut wrong = data_packet([7; 16], 1, 100, 0);
        wrong[18..22].copy_from_slice(&VECTOR_ROOT_EXTENDED.to_be_bytes());
        assert!(parse_data(&wrong).is_none());
    }

    /// A source we share universes with, at a higher priority, wins outright —
    /// our frames are discarded by the receiver and the operator must be told.
    #[test]
    fn higher_priority_on_a_shared_universe_wins() {
        let mut peer = Peer {
            saw_data: true,
            ..Default::default()
        };
        peer.heard.insert(10, 150);
        let ours: BTreeSet<u16> = [10, 11].into_iter().collect();
        let snap = peer.snapshot("cid", &ours, 100);
        assert!(snap.wins);
        assert!(!snap.ties);
        assert_eq!(snap.overlapping, vec![10]);
        assert_eq!(snap.priority, Some(150));
    }

    /// Equal priority is the dangerous case: E1.31 receivers merge HTP, so the
    /// rig does what neither source asked for.
    #[test]
    fn equal_priority_on_a_shared_universe_ties() {
        let mut peer = Peer {
            saw_data: true,
            ..Default::default()
        };
        peer.heard.insert(10, 100);
        let snap = peer.snapshot("cid", &[10].into_iter().collect(), 100);
        assert!(snap.ties);
        assert!(!snap.wins);
    }

    #[test]
    fn a_source_on_other_universes_is_not_contending() {
        let mut peer = Peer {
            saw_data: true,
            ..Default::default()
        };
        peer.heard.insert(900, 200);
        let snap = peer.snapshot("cid", &[10].into_iter().collect(), 100);
        assert!(!snap.wins && !snap.ties);
        assert!(snap.overlapping.is_empty());
        // Still reported, with the priority we did hear — it is someone else's
        // cable in the same network, just not in our patch.
        assert_eq!(snap.priority, Some(200));
    }

    /// A visualiser sending Preview_Data is not driving lights.
    #[test]
    fn preview_only_sources_do_not_contend() {
        let mut peer = Peer {
            saw_data: true,
            preview_only: true,
            ..Default::default()
        };
        peer.heard.insert(10, 200);
        let snap = peer.snapshot("cid", &[10].into_iter().collect(), 100);
        assert!(snap.preview_only);
        assert!(!snap.wins && !snap.ties);
    }

    /// Discovery packets name a source and list its universes but carry no
    /// priority, so overlap is known and the verdict is not.
    #[test]
    fn announced_universes_count_as_overlap_without_a_verdict() {
        let peer = Peer {
            announced: [10, 11].into_iter().collect(),
            ..Default::default()
        };
        let snap = peer.snapshot("cid", &[10].into_iter().collect(), 100);
        assert_eq!(snap.overlapping, vec![10]);
        assert_eq!(snap.priority, None);
        assert!(!snap.wins && !snap.ties);
    }
}
