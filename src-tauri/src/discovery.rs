//! Find the pixel controllers on the lighting network and reconcile them against
//! the ones this config expects.
//!
//! sACN is fire-and-forget: a receiver never acknowledges anything, so "output is
//! enabled and packets are leaving" tells you nothing about whether 16 PixLites
//! are actually out there listening. Advatek controllers do answer a vendor
//! discovery probe, though, and that is what this module speaks.
//!
//! Three probes, run together, all read-only — nothing here changes a controller
//! or touches the rig, so a scan is safe at any time, including during a show:
//!
//! 1. **Advatek legacy** (PixLite Mk1/Mk2, PixCon16) — UDP broadcast to
//!    `255.255.255.255:49150` carrying `"Advatech" 00 00 01 06`. Replies come back
//!    on the same port with `data[10] == 0x02` and a struct version in `data[11]`
//!    (4, 5, 6 or 8).
//! 2. **Advatek DiscProt** (Mk3 and Mk4 — what this installation uses) — a 34-byte
//!    request multicast to `239.255.251.1:49151`; replies arrive on the separate
//!    group `239.255.251.2:49151` as `"DiscProt" 21 02 <u16 version> <JSON>`.
//! 3. **Passive E1.31 source watch** — join the sACN universe-discovery group
//!    `239.255.250.214:5568` and note every source that is NOT us. A second
//!    console or a forgotten test source transmitting the same universes is
//!    otherwise completely invisible, and it is a miserable thing to debug from
//!    the symptoms.
//!
//! Wire formats for (1) and (2) were taken from the xLights implementation
//! (`src-core/controllers/Pixlite16.cpp`), which is the only public description of
//! them. Field offsets inside the legacy struct are therefore treated as
//! best-effort: **the controller's address comes from the reply's source address**,
//! not from the parsed body, so a wrong offset degrades the model/firmware text
//! rather than losing the controller.

use crate::config::AppConfig;
use serde::Serialize;
use std::collections::BTreeSet;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

const LEGACY_PORT: u16 = 49150;
const DISCPROT_PORT: u16 = 49151;
const DISCPROT_REQUEST_GROUP: Ipv4Addr = Ipv4Addr::new(239, 255, 251, 1);
const DISCPROT_REPLY_GROUP: Ipv4Addr = Ipv4Addr::new(239, 255, 251, 2);
const SACN_PORT: u16 = 5568;
const SACN_DISCOVERY_GROUP: Ipv4Addr = Ipv4Addr::new(239, 255, 250, 214);

/// Reply opcode of a legacy Advatek discovery packet (`0x01` is the request we
/// sent, which broadcast hosts see echoed back).
const LEGACY_REPLY: u8 = 0x02;

#[derive(Debug, Clone, Default, Serialize)]
pub struct FoundController {
    /// The reply's source address — authoritative, unlike the parsed body.
    pub ip: String,
    /// The address the controller believes it has, when it disagrees with the
    /// address it actually answered from. Normally `None`. A disagreement means
    /// something real: a static IP that did not take, a stale DHCP lease, or two
    /// boxes fighting over one address — all of which are invisible from the
    /// sACN side, because the lights simply go somewhere else.
    pub reported_ip: Option<String>,
    pub mac: String,
    pub model: String,
    pub nickname: String,
    pub firmware: String,
    /// Which probe found it, e.g. "DiscProt (Mk3+)" or "Advatek v6".
    pub protocol: String,
    /// Pixel outputs the controller reports (0 = not reported by this version).
    pub outputs: u32,
    pub temperature_c: Option<f32>,
    pub dhcp: Option<bool>,
    /// True when `ip` appears in `output.controllers`.
    pub expected: bool,
}

/// Another E1.31 source heard on the wire — i.e. something else driving lights.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SacnSourceSeen {
    pub cid: String,
    pub source_name: String,
    pub from_ip: String,
    pub universes: Vec<u16>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DiscoveryResult {
    /// The local interface the scan went out of ("default" when unset).
    pub scanned_interface: String,
    pub duration_ms: u32,
    pub found: Vec<FoundController>,
    /// Configured controller IPs that did not answer.
    pub missing: Vec<String>,
    /// Controllers that answered but are not in `output.controllers`.
    pub unexpected: Vec<String>,
    pub other_sources: Vec<SacnSourceSeen>,
    /// Non-fatal problems (a socket that would not bind, a blocked port). Shown
    /// to the operator, because "found nothing" and "could not look" are very
    /// different answers.
    pub errors: Vec<String>,
}

/// The 12-byte legacy Advatek discovery request.
pub fn legacy_request() -> [u8; 12] {
    let mut p = [0u8; 12];
    p[..8].copy_from_slice(b"Advatech");
    p[10] = 0x01; // opcode: discovery request
    p[11] = 0x06; // discovery protocol version we speak
    p
}

/// The 34-byte Mk3+ "DiscProt" request: every product family, every OEM, the
/// whole MAC range, no exclusions.
pub fn discprot_request() -> [u8; 34] {
    let mut p = [0u8; 34];
    p[..8].copy_from_slice(b"DiscProt");
    p[8] = 0x12; // message id: discovery request
    p[9] = 0x01;
    p[10] = 0x01; // protocol version 0x0101
    p[11] = 0x01;
    p[12..20].fill(0xFF); // product families, then OEM: all
    p[20..26].fill(0x00); // MAC range start
    p[26..32].fill(0xFF); // MAC range end
    p[32] = 0x00; // excluded MAC count
    p[33] = 0x00;
    p
}

/// Note a controller's own idea of its address, but only when it disagrees with
/// where the reply actually came from — an agreement is the normal case and not
/// worth showing.
fn disagreement(reported: String, from: Ipv4Addr) -> Option<String> {
    (!reported.is_empty() && reported != from.to_string()).then_some(reported)
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

fn mac_text(data: &[u8], at: usize) -> String {
    if at + 6 > data.len() {
        return String::new();
    }
    data[at..at + 6]
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

/// Parse a legacy Advatek discovery reply. Returns `None` for anything that is
/// not one — including the echo of our own broadcast request.
pub fn parse_legacy_reply(data: &[u8], from: Ipv4Addr) -> Option<FoundController> {
    if data.len() < 12 || &data[..8] != b"Advatech" || data[10] != LEGACY_REPLY {
        return None;
    }
    let version = data[11];
    let mut c = FoundController {
        ip: from.to_string(),
        protocol: format!("Advatek v{version}"),
        ..Default::default()
    };

    match version {
        // v4 has fixed-width fields, so the whole record is readable.
        4 => {
            let mut pos = 12;
            c.model = text(data, pos, 20);
            pos += 20;
            if let Some(ip) = data.get(pos..pos + 4) {
                c.reported_ip =
                    disagreement(format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]), from);
            }
            pos += 4;
            c.dhcp = data.get(pos).map(|&b| b != 0);
            pos += 2; // dhcp + one unused byte
            c.nickname = text(data, pos, 40);
            pos += 40;
            c.firmware = text(data, pos, 20);
            pos += 20;
            c.mac = mac_text(data, pos);
            pos += 6;
            if pos + 2 <= data.len() {
                c.temperature_c = Some(u16::from_be_bytes([data[pos], data[pos + 1]]) as f32 / 10.0);
            }
            c.outputs = if c.model.contains("16") { 16 } else { 4 };
        }
        // v5/v6/v8 are length-prefixed and diverge after the firmware string.
        // Only the leading fields are read — everything past them is per-output
        // configuration this tool has no use for.
        5 | 6 | 8 => {
            let mut pos = if version == 5 { 12 } else { 13 };
            c.mac = mac_text(data, pos);
            pos += 6;
            let model_len = *data.get(pos)? as usize;
            pos += 1;
            c.model = text(data, pos, model_len);
            pos += model_len;
            pos += 1 + 3; // hardware revision + minimum assistant version
            if version == 5 {
                c.firmware = text(data, pos, 20);
            } else {
                // Matches the xLights reader, which reads the string one byte
                // past the length prefix while advancing by the length itself.
                let fw_len = *data.get(pos)? as usize;
                pos += 1;
                c.firmware = text(data, pos + 1, fw_len);
            }
        }
        _ => c.protocol = format!("Advatek v{version} (unrecognised)"),
    }
    Some(c)
}

/// Parse a Mk3+ DiscProt reply: a fixed header followed by a JSON body.
pub fn parse_discprot_reply(data: &[u8], from: Ipv4Addr) -> Option<FoundController> {
    if data.len() < 13 || &data[..8] != b"DiscProt" || data[8] != 0x21 || data[9] != 0x02 {
        return None;
    }
    let version = u16::from_be_bytes([data[10], data[11]]);
    let body = &data[12..];
    // The payload is NUL-padded to the packet size on some firmwares.
    let end = body.iter().position(|&b| b == 0).unwrap_or(body.len());
    let json: serde_json::Value = serde_json::from_slice(&body[..end]).ok()?;

    let s = |k: &str| json.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    // The JSON carries the controller's own idea of its address; the source
    // address is what actually answered, so that is what we report — and a
    // disagreement between the two is itself worth reporting.
    Some(FoundController {
        ip: from.to_string(),
        reported_ip: disagreement(s("ipAddr"), from),
        mac: s("macAddr"),
        model: s("prodName"),
        nickname: s("nickname"),
        firmware: s("fwVer"),
        protocol: if version == 0x0101 {
            "DiscProt (Mk3+)".into()
        } else {
            format!("DiscProt 0x{version:04x}")
        },
        ..Default::default()
    })
}

/// Parse an E1.31 universe-discovery packet (the advertisement a transmitting
/// source sends every 10 s). Layout mirrors `sacn::build_discovery_pages`.
pub fn parse_sacn_discovery(data: &[u8], from: Ipv4Addr) -> Option<SacnSourceSeen> {
    if data.len() < 120
        || &data[4..16] != b"ASC-E1.17\0\0\0"
        || u32::from_be_bytes([data[18], data[19], data[20], data[21]]) != 0x0000_0008
        || u32::from_be_bytes([data[40], data[41], data[42], data[43]]) != 0x0000_0002
    {
        return None;
    }
    let cid = uuid::Uuid::from_slice(&data[22..38]).ok()?;
    let mut universes = Vec::new();
    let mut at = 120;
    while at + 2 <= data.len() {
        universes.push(u16::from_be_bytes([data[at], data[at + 1]]));
        at += 2;
    }
    Some(SacnSourceSeen {
        cid: cid.to_string(),
        source_name: text(data, 44, 64),
        from_ip: from.to_string(),
        universes,
    })
}

/// Bind a UDP socket for listening, with address reuse so this never fights a
/// diagnostic tool (or our own sender) for a well-known port.
fn listen_socket(interface: Ipv4Addr, port: u16, broadcast: bool) -> std::io::Result<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    if broadcast {
        socket.set_broadcast(true)?;
    }
    // Multicast groups must be joined on a socket bound to the wildcard address
    // on Windows, so bind INADDR_ANY and steer egress with set_multicast_if_v4.
    socket.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port).into())?;
    socket.set_multicast_if_v4(&interface)?;
    socket.set_multicast_ttl_v4(1)?;
    socket.set_read_timeout(Some(Duration::from_millis(40)))?;
    Ok(socket.into())
}

/// Scan for controllers. Blocking for roughly `duration`; call it off the async
/// runtime (see `server.rs`).
pub fn scan(cfg: &AppConfig, duration: Duration) -> DiscoveryResult {
    let started = Instant::now();
    let interface: Ipv4Addr = cfg.output.interface.parse().unwrap_or(Ipv4Addr::UNSPECIFIED);
    let mut result = DiscoveryResult {
        scanned_interface: if cfg.output.interface.is_empty() {
            "default".into()
        } else {
            cfg.output.interface.clone()
        },
        ..Default::default()
    };

    // Our own CID, so we do not report ourselves as a competing source.
    let own_cid = uuid::Uuid::parse_str(&cfg.output.cid)
        .map(|u| u.to_string())
        .unwrap_or_default();

    let mut sockets: Vec<(&'static str, UdpSocket)> = Vec::new();

    match listen_socket(interface, LEGACY_PORT, true) {
        Ok(s) => {
            let dest = SocketAddrV4::new(Ipv4Addr::BROADCAST, LEGACY_PORT);
            if let Err(e) = s.send_to(&legacy_request(), dest) {
                result.errors.push(format!("Advatek broadcast probe failed: {e}"));
            }
            sockets.push(("legacy", s));
        }
        Err(e) => result
            .errors
            .push(format!("cannot open UDP {LEGACY_PORT} for Mk1/Mk2 discovery: {e}")),
    }

    match listen_socket(interface, DISCPROT_PORT, false) {
        Ok(s) => {
            if let Err(e) = s.join_multicast_v4(&DISCPROT_REPLY_GROUP, &interface) {
                result
                    .errors
                    .push(format!("cannot join {DISCPROT_REPLY_GROUP} for Mk3+ replies: {e}"));
            }
            let dest = SocketAddrV4::new(DISCPROT_REQUEST_GROUP, DISCPROT_PORT);
            if let Err(e) = s.send_to(&discprot_request(), dest) {
                result.errors.push(format!("Mk3+ discovery probe failed: {e}"));
            }
            sockets.push(("discprot", s));
        }
        Err(e) => result
            .errors
            .push(format!("cannot open UDP {DISCPROT_PORT} for Mk3+ discovery: {e}")),
    }

    match listen_socket(interface, SACN_PORT, false) {
        Ok(s) => {
            if let Err(e) = s.join_multicast_v4(&SACN_DISCOVERY_GROUP, &interface) {
                result
                    .errors
                    .push(format!("cannot join the sACN discovery group: {e}"));
            }
            sockets.push(("sacn", s));
        }
        Err(e) => result
            .errors
            .push(format!("cannot listen on UDP {SACN_PORT} for other sACN sources: {e}")),
    }

    // Round-robin the sockets with short read timeouts until the deadline. Three
    // short-lived sockets do not justify three threads.
    let deadline = started + duration;
    let mut by_ip: std::collections::BTreeMap<String, FoundController> = Default::default();
    let mut sources: std::collections::BTreeMap<String, SacnSourceSeen> = Default::default();
    let mut buf = [0u8; 2048];

    while Instant::now() < deadline {
        let mut idle = true;
        for (kind, socket) in &sockets {
            loop {
                let Ok((n, from)) = socket.recv_from(&mut buf) else {
                    break; // timeout or error: move to the next socket
                };
                idle = false;
                let std::net::SocketAddr::V4(from) = from else {
                    continue; // IPv4-only sockets; defensive, not expected
                };
                let data = &buf[..n];
                match *kind {
                    "legacy" => {
                        if let Some(c) = parse_legacy_reply(data, *from.ip()) {
                            by_ip.entry(c.ip.clone()).or_insert(c);
                        }
                    }
                    "discprot" => {
                        if let Some(c) = parse_discprot_reply(data, *from.ip()) {
                            // A Mk3+ reply is richer than a legacy one, so let it
                            // replace an entry the other probe already made.
                            by_ip.insert(c.ip.clone(), c);
                        }
                    }
                    _ => {
                        if let Some(s) = parse_sacn_discovery(data, *from.ip())
                            && s.cid != own_cid
                        {
                            sources.insert(s.cid.clone(), s);
                        }
                    }
                }
            }
        }
        if idle {
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    let expected: BTreeSet<String> = cfg
        .output
        .controllers
        .iter()
        .filter(|ip| !ip.is_empty())
        .cloned()
        .collect();

    result.found = by_ip
        .into_values()
        .map(|mut c| {
            c.expected = expected.contains(&c.ip);
            c
        })
        .collect();
    let seen: BTreeSet<String> = result.found.iter().map(|c| c.ip.clone()).collect();
    result.missing = expected.difference(&seen).cloned().collect();
    result.unexpected = result
        .found
        .iter()
        .filter(|c| !c.expected)
        .map(|c| c.ip.clone())
        .collect();
    result.other_sources = sources.into_values().collect();
    result.duration_ms = started.elapsed().as_millis() as u32;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const IP: Ipv4Addr = Ipv4Addr::new(10, 0, 0, 42);

    #[test]
    fn legacy_request_matches_the_advatek_probe() {
        let p = legacy_request();
        assert_eq!(&p[..8], b"Advatech");
        assert_eq!(&p[8..], &[0x00, 0x00, 0x01, 0x06]);
    }

    #[test]
    fn discprot_request_matches_the_mk3_probe() {
        let p = discprot_request();
        assert_eq!(&p[..8], b"DiscProt");
        assert_eq!(&p[8..12], &[0x12, 0x01, 0x01, 0x01]);
        assert!(p[12..20].iter().all(|&b| b == 0xFF), "all families, all OEMs");
        assert!(p[20..26].iter().all(|&b| b == 0x00), "MAC range start");
        assert!(p[26..32].iter().all(|&b| b == 0xFF), "MAC range end");
        assert_eq!(&p[32..], &[0x00, 0x00], "no excluded MACs");
    }

    #[test]
    fn our_own_broadcast_request_is_not_mistaken_for_a_controller() {
        // Every host on the segment sees the broadcast we just sent, including us.
        assert!(parse_legacy_reply(&legacy_request(), IP).is_none());
        assert!(parse_legacy_reply(b"not advatek at all", IP).is_none());
        assert!(parse_legacy_reply(&[], IP).is_none());
    }

    #[test]
    fn legacy_v4_reply_parses_and_prefers_the_source_address() {
        let mut p = vec![0u8; 12];
        p[..8].copy_from_slice(b"Advatech");
        p[10] = LEGACY_REPLY;
        p[11] = 4;
        let mut field = |bytes: &[u8], len: usize| {
            let mut v = bytes.to_vec();
            v.resize(len, 0);
            p.extend_from_slice(&v);
        };
        field(b"PixLite 16 MkII", 20);
        field(&[192, 168, 9, 9], 4); // the controller's own idea of its IP
        field(&[1], 1); // dhcp
        field(&[0], 1); // unused
        field(b"North rail", 40);
        field(b"4.4.1", 20);
        field(&[0xAA, 0xBB, 0xCC, 0x11, 0x22, 0x33], 6);
        p.extend_from_slice(&412u16.to_be_bytes()); // 41.2 C

        let c = parse_legacy_reply(&p, IP).expect("a v4 reply");
        assert_eq!(c.ip, "10.0.0.42", "the source address wins over the body");
        assert_eq!(c.reported_ip.as_deref(), Some("192.168.9.9"));
        assert_eq!(c.model, "PixLite 16 MkII");
        assert_eq!(c.nickname, "North rail");
        assert_eq!(c.firmware, "4.4.1");
        assert_eq!(c.mac, "AA:BB:CC:11:22:33");
        assert_eq!(c.dhcp, Some(true));
        assert_eq!(c.temperature_c, Some(41.2));
        assert_eq!(c.outputs, 16);
        assert_eq!(c.protocol, "Advatek v4");
    }

    #[test]
    fn legacy_v5_reply_reads_the_length_prefixed_model() {
        let mut p = vec![0u8; 12];
        p[..8].copy_from_slice(b"Advatech");
        p[10] = LEGACY_REPLY;
        p[11] = 5;
        p.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01]); // mac
        let model = b"PixLite 4 MkII";
        p.push(model.len() as u8);
        p.extend_from_slice(model);
        p.push(2); // hw revision
        p.extend_from_slice(&[1, 2, 3]); // minimum assistant version
        let mut fw = b"5.0.2".to_vec();
        fw.resize(20, 0);
        p.extend_from_slice(&fw);

        let c = parse_legacy_reply(&p, IP).expect("a v5 reply");
        assert_eq!(c.model, "PixLite 4 MkII");
        assert_eq!(c.firmware, "5.0.2");
        assert_eq!(c.mac, "DE:AD:BE:EF:00:01");
        assert_eq!(c.protocol, "Advatek v5");
    }

    #[test]
    fn a_truncated_legacy_reply_degrades_instead_of_panicking() {
        let mut p = vec![0u8; 12];
        p[..8].copy_from_slice(b"Advatech");
        p[10] = LEGACY_REPLY;
        p[11] = 6;
        p.extend_from_slice(&[1, 2, 3]); // cut off mid-MAC
        // Version 6 needs a length prefix it will never reach; the parser must
        // give up cleanly rather than index past the end.
        assert!(parse_legacy_reply(&p, IP).is_none());

        // A version we have never seen is still reported — an unknown controller
        // on the network is exactly the thing worth surfacing.
        let mut p = vec![0u8; 12];
        p[..8].copy_from_slice(b"Advatech");
        p[10] = LEGACY_REPLY;
        p[11] = 99;
        let c = parse_legacy_reply(&p, IP).expect("unknown versions still count");
        assert_eq!(c.ip, "10.0.0.42");
        assert!(c.protocol.contains("unrecognised"));
    }

    fn discprot_reply(json: &str) -> Vec<u8> {
        let mut p = b"DiscProt".to_vec();
        p.extend_from_slice(&[0x21, 0x02, 0x01, 0x01]);
        p.extend_from_slice(json.as_bytes());
        p
    }

    #[test]
    fn discprot_reply_parses_the_json_body() {
        let p = discprot_reply(
            r#"{"ipAddr":"192.168.1.50","prodName":"PixLite 16 Mk4-S",
                "fwVer":"1.2.3","nickname":"Spoke 1-4","macAddr":"00:1D:2E:3F:40:51"}"#,
        );
        let c = parse_discprot_reply(&p, IP).expect("a DiscProt reply");
        assert_eq!(c.ip, "10.0.0.42", "the source address wins over ipAddr");
        assert_eq!(
            c.reported_ip.as_deref(),
            Some("192.168.1.50"),
            "a controller answering from a different address than it claims is \
             a misconfiguration worth surfacing, not a detail to discard"
        );
        assert_eq!(c.model, "PixLite 16 Mk4-S");
        assert_eq!(c.firmware, "1.2.3");
        assert_eq!(c.nickname, "Spoke 1-4");
        assert_eq!(c.mac, "00:1D:2E:3F:40:51");
        assert_eq!(c.protocol, "DiscProt (Mk3+)");
    }

    #[test]
    fn discprot_tolerates_nul_padding_and_missing_keys() {
        let mut p = discprot_reply(r#"{"prodName":"PixLite 4 Mk3"}"#);
        p.resize(512, 0); // some firmwares pad the datagram
        let c = parse_discprot_reply(&p, IP).expect("padding must not break parsing");
        assert_eq!(c.model, "PixLite 4 Mk3");
        assert_eq!(c.nickname, "");

        // Our own request must never be read back as a reply.
        assert!(parse_discprot_reply(&discprot_request(), IP).is_none());
        assert!(parse_discprot_reply(&discprot_reply("not json"), IP).is_none());
    }

    /// Build a real E1.31 discovery packet with the app's own sender, then read
    /// it back — so the parser is checked against the actual wire format rather
    /// than against my reading of it.
    #[test]
    fn sacn_discovery_round_trips_through_our_own_sender() {
        let cid = uuid::Uuid::parse_str("01234567-89ab-cdef-0123-456789abcdef").unwrap();
        let packet = crate::sacn::test_support::discovery_packet(
            cid.as_bytes(),
            "Some Other Console",
            &[1, 2, 300],
        );
        let s = parse_sacn_discovery(&packet, IP).expect("our own format must parse");
        assert_eq!(s.cid, cid.to_string());
        assert_eq!(s.source_name, "Some Other Console");
        assert_eq!(s.universes, vec![1, 2, 300]);
        assert_eq!(s.from_ip, "10.0.0.42");

        // A data packet on the same port is not a discovery advertisement.
        assert!(parse_sacn_discovery(&[0u8; 638], IP).is_none());
    }
}
