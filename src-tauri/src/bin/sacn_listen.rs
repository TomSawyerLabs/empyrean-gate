//! Receive-side sACN: decode E1.31 data packets actually on the wire and say what
//! they mean in this installation's terms.
//!
//! Everything else in this repo transmits. That leaves a whole class of question
//! unanswerable from inside the app, because sACN is fire-and-forget and a sender
//! can only ever report what it *believes* it sent:
//!
//! - Does our universe map match the controller patch, byte for byte? (Compare a
//!   capture of this app against the table in the controller software.)
//! - **Which physical spoke is our spoke 0, and which way round do they go?** Point
//!   this at the *previous* show software while it runs a chase, watch the order
//!   universes light up, and the rig's true spoke order falls out — without lighting
//!   anything or guessing. This is the intended use.
//! - Is something else transmitting the same universes? Two sources merge in the
//!   receiver and the symptoms are baffling; here they are two obvious CIDs.
//!
//! Read-only and passive: it joins multicast groups and listens. It never transmits,
//! so it is safe to run during a show, including from a laptop on the same switch.
//!
//! Packet offsets are fixed by E1.31-2016 and are duplicated here rather than shared
//! with `sacn.rs`, deliberately: a decoder that borrowed the encoder's constants
//! would agree with a mistake in them. These were checked against the spec, and the
//! round-trip test at the bottom builds a packet by hand from the spec layout and
//! asserts this parser reads it back.
//!
//! ```text
//! sacn-listen                         # summary table, universes from the config
//! sacn-listen --events                # log every dark->lit transition, in order
//! sacn-listen --dump 7 --channels 12  # raw slot values for one universe
//! sacn-listen --json --seconds 30     # one JSON line per frame, for diffing
//! ```

use empyrean_gate_lib::config::{self, AppConfig};
use empyrean_gate_lib::geometry;
use std::collections::BTreeMap;
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

const SACN_PORT: u16 = 5568;
const ACN_ID: [u8; 12] = *b"ASC-E1.17\0\0\0";

// E1.31-2016 field offsets within a data packet.
const ROOT_VECTOR: usize = 18;
const CID: usize = 22;
const FRAMING_VECTOR: usize = 40;
const SOURCE_NAME: usize = 44;
const PRIORITY: usize = 108;
const SYNC_ADDR: usize = 109;
const SEQUENCE: usize = 111;
const OPTIONS: usize = 112;
const UNIVERSE: usize = 113;
const PROP_COUNT: usize = 123;
const START_CODE: usize = 125;
const SLOTS: usize = 126;

const VECTOR_ROOT_E131_DATA: u32 = 0x0000_0004;
const VECTOR_E131_DATA_PACKET: u32 = 0x0000_0002;
/// Options bit 6 — the source is saying this universe's stream has ended.
const OPT_TERMINATED: u8 = 0x40;

fn multicast_group(universe: u16) -> Ipv4Addr {
    Ipv4Addr::new(239, 255, (universe >> 8) as u8, (universe & 0xff) as u8)
}

/// One decoded data packet. Borrows the receive buffer — nothing is copied on the
/// hot path, which matters at 384 universes × 60 fps (23k packets/s).
struct Packet<'a> {
    cid: [u8; 16],
    /// Raw 64-byte field. Kept as bytes on the hot path: stringifying every packet
    /// costs an allocation 6-12k times a second and the name only changes when a
    /// new source appears.
    source_name: &'a [u8],
    priority: u8,
    sync_universe: u16,
    sequence: u8,
    terminated: bool,
    universe: u16,
    slots: &'a [u8],
}

fn source_name(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw)
        .trim_end_matches('\0')
        .trim()
        .to_string()
}

/// Decode, or return None for anything that is not an E1.31 DMX data packet —
/// discovery packets, sync packets, and unrelated traffic on the port all land here.
fn parse(buf: &[u8]) -> Option<Packet<'_>> {
    if buf.len() < SLOTS || buf[4..16] != ACN_ID {
        return None;
    }
    if be32(buf, ROOT_VECTOR) != VECTOR_ROOT_E131_DATA
        || be32(buf, FRAMING_VECTOR) != VECTOR_E131_DATA_PACKET
    {
        return None;
    }
    // Property count includes the start code, so slots = count - 1. Trust the
    // smaller of that and what actually arrived: a truncated packet must not
    // produce an out-of-range slice.
    let prop_count = be16(buf, PROP_COUNT) as usize;
    let claimed = prop_count.saturating_sub(1);
    let available = buf.len() - SLOTS;
    let len = claimed.min(available);
    // Start code 0 is DMX. Anything else (RDM, text) is not pixel data.
    if buf[START_CODE] != 0x00 {
        return None;
    }
    let mut cid = [0u8; 16];
    cid.copy_from_slice(&buf[CID..CID + 16]);
    Some(Packet {
        cid,
        source_name: &buf[SOURCE_NAME..PRIORITY],
        priority: buf[PRIORITY],
        sync_universe: be16(buf, SYNC_ADDR),
        sequence: buf[SEQUENCE],
        terminated: buf[OPTIONS] & OPT_TERMINATED != 0,
        universe: be16(buf, UNIVERSE),
        slots: &buf[SLOTS..SLOTS + len],
    })
}

fn be16(b: &[u8], at: usize) -> u16 {
    u16::from_be_bytes([b[at], b[at + 1]])
}

fn be32(b: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn hex_cid(cid: &[u8]) -> String {
    cid.iter().map(|b| format!("{b:02x}")).collect()
}

/// What a universe number means in this installation. The whole point of the tool:
/// turn "universe 7" into "spoke 1, pixels 0-169" using the same rules the sender
/// uses, so a capture can be read against the controller's patch table directly.
struct Map {
    start: u16,
    stride: u16,
    data_universes: u16,
    ppu: u32,
    pixels_per_spoke: u32,
    spokes: u32,
    /// Channels our config says each universe should carry (0 = should be dark).
    expected: Vec<usize>,
    /// Descriptions for every universe this config covers, precomputed. `describe`
    /// runs once per packet in `--json`; formatting one there put a `String`
    /// allocation on the hot path for no reason.
    cache: Vec<String>,
}

impl Map {
    fn new(cfg: &AppConfig) -> Self {
        let mut m = Self {
            start: cfg.output.start_universe,
            stride: geometry::universe_stride(&cfg.geometry, &cfg.output),
            data_universes: geometry::universes_per_spoke(&cfg.geometry, &cfg.output),
            ppu: cfg.output.pixels_per_universe.max(1) as u32,
            pixels_per_spoke: cfg.geometry.pixels_per_spoke,
            spokes: cfg.geometry.spokes,
            expected: Vec::new(),
            cache: Vec::new(),
        };
        let top = m.last().saturating_add(m.stride);
        m.cache = (0..=top).map(|u| m.compute(u)).collect();
        m.expected = (0..=top).map(|u| m.expected_channels(u)).collect();
        m
    }

    /// Channels this universe should carry if the wire matches our config.
    fn expected_channels(&self, universe: u16) -> usize {
        if universe < self.start {
            return 0;
        }
        let offset = universe - self.start;
        let spoke = (offset / self.stride) as u32;
        let within = offset % self.stride;
        if spoke >= self.spokes || within >= self.data_universes {
            return 0;
        }
        let first = within as u32 * self.ppu;
        (self.ppu.min(self.pixels_per_spoke - first) * 3) as usize
    }

    fn describe(&self, universe: u16) -> &str {
        self.cache
            .get(universe as usize)
            .map(|s| s.as_str())
            .unwrap_or("outside this config's universes")
    }

    /// Highest universe this config ever transmits on (inclusive).
    fn last(&self) -> u16 {
        self.start + (self.spokes as u16 - 1) * self.stride + self.data_universes - 1
    }

    fn compute(&self, universe: u16) -> String {
        if universe < self.start {
            return "below start universe".into();
        }
        let offset = universe - self.start;
        let spoke = (offset / self.stride) as u32;
        let within = offset % self.stride;
        if spoke >= self.spokes {
            return "beyond the configured spokes".into();
        }
        if within >= self.data_universes {
            return format!("reserved, expected dark (spoke {spoke} block)");
        }
        let first = within as u32 * self.ppu;
        let last = (first + self.ppu).min(self.pixels_per_spoke) - 1;
        format!("spoke {spoke}, px {first}-{last}")
    }
}

#[derive(Default)]
struct Stat {
    packets: u64,
    last_sequence: u8,
    gaps: u64,
    slots: usize,
    lit: usize,
    /// Highest channel ever seen non-zero. A single frame says little (black pixels
    /// are legitimately zero), but the high-water mark over a running show is a good
    /// estimate of how many channels the source actually uses — which is what gets
    /// compared against the pixel count our config expects.
    hi_channel: usize,
    first_lit: Option<usize>,
    peak: u8,
    source: String,
    priority: u8,
    terminated: bool,
    was_lit: bool,
}

/// Statistics are keyed by (universe, source CID) as raw bytes — hex-encoding a CID
/// per packet is an allocation 6-12k times a second, which is enough on its own to
/// make the receiver fall behind a full array and drop the tail of every frame's
/// burst. Formatting happens only when something is printed.
///
/// Keyed by (universe, source), never by universe alone.
/// Two sources on one universe is the normal case while commissioning — the old
/// console and this app both live — and folding them together makes a universe
/// appear to flicker dark between alternating packets, which is an artefact of the
/// bookkeeping rather than anything on the wire. Keeping them apart also makes the
/// comparison the tool exists for (old source vs ours, same universe) a subtraction
/// of two rows.
type Key = (u16, [u8; 16]);

struct Options {
    interface: Ipv4Addr,
    first: u16,
    last: u16,
    seconds: Option<u64>,
    mode: Mode,
    channels: usize,
    /// Multicast groups held at once. Conservative: NIC filter tables are commonly
    /// 32-64 entries and overflow is silent.
    window: usize,
    /// How long each sweep window is held.
    dwell: Duration,
}

#[derive(PartialEq)]
enum Mode {
    Summary,
    Events,
    Json,
    Dump(u16),
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print_help();
        return Ok(());
    }

    let cfg = config::load();
    let map = Map::new(&cfg);
    let opts = parse_args(&args, &map)?;

    let socket = bind(opts.interface)?;

    // Joining every universe's group at once does NOT work past a few dozen groups.
    // `join_multicast_v4` keeps returning Ok, but a NIC's multicast filter table
    // holds a limited number of addresses (commonly 32-64) and traffic for the rest
    // is dropped in hardware, silently. Measured on this machine: 400 "successful"
    // joins delivered ~58 universes and the remaining 130+ looked, convincingly,
    // like universes nobody was transmitting.
    //
    // So sweep instead: hold a window of groups, listen, drop them, advance. A
    // survey of 192 universes costs a few seconds more and is actually complete.
    // Ranges that fit in one window skip this entirely and listen continuously,
    // which is what you want when watching a handful of universes live.
    let range = opts.last as usize - opts.first as usize + 1;
    let sweeping = range > opts.window;

    eprintln!(
        "listening on {}:{SACN_PORT}, universes {}-{}",
        if opts.interface.is_unspecified() {
            "all interfaces".to_string()
        } else {
            opts.interface.to_string()
        },
        opts.first,
        opts.last,
    );
    if sweeping {
        eprintln!(
            "{range} universes is more than one multicast window ({}), so sweeping in \
             {} windows of {} at {:.1}s each — NICs silently drop groups beyond their \
             filter table. Narrow --universes to watch continuously.",
            opts.window,
            range.div_ceil(opts.window),
            opts.window,
            opts.dwell.as_secs_f32(),
        );
    }
    eprintln!(
        "config expects: {} spokes x {} px, {} px/universe, stride {}, universes {}-{}",
        map.spokes,
        map.pixels_per_spoke,
        map.ppu,
        map.stride,
        map.start,
        map.last(),
    );
    if opts.seconds.is_none() {
        eprintln!("Ctrl-C to stop.");
    }
    eprintln!();

    socket.set_read_timeout(Some(Duration::from_millis(200)))?;
    let started = Instant::now();
    let mut stats: BTreeMap<Key, Stat> = BTreeMap::new();
    let mut buf = [0u8; 1500];
    let mut next_report = started + Duration::from_secs(1);
    // Per-packet formatting straight to a line-buffered stdout cannot keep up with a
    // full array and becomes the bottleneck that drops packets. Buffer, flush on the
    // same 1 s tick as the summary.
    let mut out = std::io::BufWriter::with_capacity(1 << 20, std::io::stdout().lock());

    // Windows to sweep through. Not sweeping = one window covering everything, held
    // for the whole run.
    let mut window_start = opts.first;
    let mut covered: Vec<(u16, u16)> = Vec::new();
    'sweep: loop {
        let window_end = if sweeping {
            window_start.saturating_add(opts.window as u16 - 1).min(opts.last)
        } else {
            opts.last
        };
        let mut joined = 0usize;
        for u in window_start..=window_end {
            if socket
                .join_multicast_v4(&multicast_group(u), &opts.interface)
                .is_ok()
            {
                joined += 1;
            }
        }
        if joined == 0 {
            eprintln!("could not join any group in {window_start}-{window_end}");
        }
        covered.push((window_start, window_end));
        // None = hold this window for the whole run. (`Instant::now() + Duration::MAX`
        // panics with an overflow, so absence has to model "no deadline".)
        let window_deadline = sweeping.then(|| Instant::now() + opts.dwell);

        loop {
            if let Some(limit) = opts.seconds {
                if started.elapsed() >= Duration::from_secs(limit) {
                    break 'sweep;
                }
            }
            if window_deadline.is_some_and(|d| Instant::now() >= d) {
                break;
            }

            match socket.recv_from(&mut buf) {
                Ok((n, _from)) => {
                    if let Some(p) = parse(&buf[..n]) {
                        // A sweep can still catch stray traffic from groups we have
                        // left (the switch may keep forwarding briefly). Counting it
                        // is fine — it is real traffic, genuinely observed.
                        observe(&p, &mut stats, &map, &opts, started, &mut out)?;
                    }
                }
                Err(e) if would_block(&e) => {}
                Err(e) => return Err(e.into()),
            }

            if Instant::now() >= next_report {
                if opts.mode == Mode::Summary && !sweeping {
                    report(&stats, &map, started);
                } else {
                    out.flush()?;
                }
                next_report = Instant::now() + Duration::from_secs(1);
            }
        }

        for u in window_start..=window_end {
            let _ = socket.leave_multicast_v4(&multicast_group(u), &opts.interface);
        }
        if !sweeping || window_end >= opts.last {
            break;
        }
        window_start = window_end + 1;
    }

    out.flush()?;
    if opts.mode == Mode::Summary {
        report(&stats, &map, started);
    }
    if sweeping {
        let (lo, hi) = (
            covered.first().map(|w| w.0).unwrap_or(0),
            covered.last().map(|w| w.1).unwrap_or(0),
        );
        eprintln!(
            "\nswept {}-{} in {} windows; each universe was watched for ~{:.1}s, so pkt/s \
             above is averaged over the whole run and reads low by roughly the sweep factor.",
            lo,
            hi,
            covered.len(),
            opts.dwell.as_secs_f32(),
        );
    }
    if stats.is_empty() {
        eprintln!(
            "\nNothing received. Check --interface (multicast follows one NIC), that the \
             sender is transmitting, and that any switch between you does IGMP snooping."
        );
    }
    Ok(())
}

fn observe(
    p: &Packet<'_>,
    stats: &mut BTreeMap<Key, Stat>,
    map: &Map,
    opts: &Options,
    started: Instant,
    out: &mut impl Write,
) -> std::io::Result<()> {
    let lit = p.slots.iter().filter(|&&v| v > 0).count();
    let first_lit = p.slots.iter().position(|&v| v > 0);
    let hi = p.slots.iter().rposition(|&v| v > 0).map(|i| i + 1).unwrap_or(0);
    let peak = p.slots.iter().copied().max().unwrap_or(0);
    let t = started.elapsed().as_secs_f32();

    let s = stats.entry((p.universe, p.cid)).or_default();
    let expected = s.last_sequence.wrapping_add(1);
    if s.packets > 0 && p.sequence != expected {
        s.gaps += 1;
    }
    let was_lit = s.was_lit;
    if s.packets == 0 {
        s.source = source_name(p.source_name); // once per (universe, source)
    }
    s.packets += 1;
    s.last_sequence = p.sequence;
    s.slots = p.slots.len();
    s.lit = lit;
    s.hi_channel = s.hi_channel.max(hi);
    s.first_lit = first_lit;
    s.peak = peak;
    s.priority = p.priority;
    s.terminated = p.terminated;
    s.was_lit = lit > 0;

    // Re-borrow immutably for the name rather than cloning it per packet.
    let source = stats
        .get(&(p.universe, p.cid))
        .map(|s| s.source.as_str())
        .unwrap_or_default();

    match opts.mode {
        // The spoke-order instrument: only transitions, so a chase on another
        // source prints one line per spoke, in the order the rig actually lights.
        Mode::Events => {
            if lit > 0 && !was_lit {
                writeln!(
                    out,
                    "{t:8.3}  universe {:>5}  LIT   peak {peak:>3}  first ch {:<4} {}  [{}]",
                    p.universe,
                    first_lit.map(|i| i + 1).unwrap_or(0),
                    map.describe(p.universe),
                    source,
                )?;
            } else if lit == 0 && was_lit {
                writeln!(
                    out,
                    "{t:8.3}  universe {:>5}  dark                            {}  [{}]",
                    p.universe,
                    map.describe(p.universe),
                    source,
                )?;
            }
        }
        Mode::Json => {
            writeln!(
                out,
                r#"{{"t":{t:.3},"universe":{},"seq":{},"priority":{},"sync":{},"slots":{},"lit":{lit},"first_lit_channel":{},"peak":{peak},"source":{:?},"cid":"{}","maps_to":{:?}}}"#,
                p.universe,
                p.sequence,
                p.priority,
                p.sync_universe,
                p.slots.len(),
                first_lit.map(|i| i as i64 + 1).unwrap_or(-1),
                source,
                hex_cid(&p.cid),
                map.describe(p.universe),
            )?;
        }
        Mode::Dump(u) if u == p.universe => {
            let n = opts.channels.min(p.slots.len());
            let vals: Vec<String> = p.slots[..n].iter().map(|v| format!("{v:>3}")).collect();
            writeln!(
                out,
                "{t:8.3}  u{} seq {:>3}  {} ch  ch1-{n}: {}  [{}]",
                p.universe,
                p.sequence,
                p.slots.len(),
                vals.join(" "),
                source,
            )?;
        }
        _ => {}
    }
    Ok(())
}

fn report(stats: &BTreeMap<Key, Stat>, map: &Map, started: Instant) {
    let elapsed = started.elapsed().as_secs_f64().max(0.001);
    print!("\x1b[2J\x1b[H"); // redraw in place; harmless when piped to a file
    println!(
        "{:>8}  {:>5}  {:>5}  {:>7}  {:>5}  {:>4}  {:<28}  {}",
        "universe", "pkt/s", "lit", "used/exp", "peak", "gaps", "maps to", "source"
    );
    let mut mismatched = 0usize;
    for ((u, _cid), s) in stats {
        let expected = map.expected.get(*u as usize).copied().unwrap_or(0);
        // Only flag a universe whose data runs PAST what we expect. Falling short is
        // ambiguous — the tail pixels may simply be black in the current look — but
        // exceeding it means the source is addressing channels our config does not
        // believe exist, which is a genuine disagreement about the patch.
        let over = s.hi_channel > expected;
        if over {
            mismatched += 1;
        }
        println!(
            "{u:>8}  {:>5.0}  {:>5}  {:>3}/{:<3}{}  {:>5}  {:>4}  {:<28}  {}{}",
            s.packets as f64 / elapsed,
            s.lit,
            s.hi_channel,
            expected,
            if over { "!" } else { " " },
            s.peak,
            s.gaps,
            map.describe(*u),
            s.source,
            if s.terminated { "  (TERMINATED)" } else { "" },
        );
    }
    if mismatched > 0 {
        println!(
            "\n{mismatched} universe(s) marked ! carry data past what this config expects — \
             the wire and Settings disagree about the patch. Check pixels/spoke, \
             pixels/universe and universes/spoke."
        );
    }

    // Two sources on one universe merge in the receiver; that is worth shouting about.
    let mut cids: BTreeMap<[u8; 16], (&str, u8)> = BTreeMap::new();
    let mut contested: BTreeMap<u16, usize> = BTreeMap::new();
    for ((u, cid), s) in stats {
        cids.insert(*cid, (&s.source, s.priority));
        *contested.entry(*u).or_default() += 1;
    }
    if cids.len() > 1 {
        println!("\n{} distinct sources seen:", cids.len());
        for (cid, (name, priority)) in &cids {
            println!("  {name:<24} priority {priority:<4} cid {}", hex_cid(cid));
        }
        let overlap: Vec<u16> = contested
            .iter()
            .filter(|(_, n)| **n > 1)
            .map(|(u, _)| *u)
            .collect();
        if !overlap.is_empty() {
            println!(
                "  {} universe(s) driven by more than one source, e.g. {:?}.",
                overlap.len(),
                &overlap[..overlap.len().min(8)]
            );
            // E1.31 does NOT blend across priorities: a receiver follows the highest
            // priority present and ignores the rest outright. Only sources at EQUAL
            // priority get merged (typically HTP). Saying "it's a blend" when one
            // source outranks the other sends you looking for merge artefacts that
            // cannot exist, while the real answer is that your output is being
            // dropped on the floor.
            let mut tied = 0usize;
            let mut outranked: BTreeMap<&str, (&str, u8, u8)> = BTreeMap::new();
            for u in &overlap {
                let here: Vec<(&str, u8)> = stats
                    .iter()
                    .filter(|((un, _), _)| un == u)
                    .map(|(_, s)| (s.source.as_str(), s.priority))
                    .collect();
                let top = here.iter().map(|(_, p)| *p).max().unwrap_or(0);
                let winners: Vec<&str> = here
                    .iter()
                    .filter(|(_, p)| *p == top)
                    .map(|(n, _)| *n)
                    .collect();
                if winners.len() > 1 {
                    tied += 1;
                } else if let Some((loser, lp)) =
                    here.iter().find(|(_, p)| *p != top).map(|(n, p)| (*n, *p))
                {
                    outranked.insert(loser, (winners[0], top, lp));
                }
            }
            for (loser, (winner, wp, lp)) in &outranked {
                println!(
                    "  '{winner}' (priority {wp}) OUTRANKS '{loser}' (priority {lp}) — \
                     receivers follow the higher priority and ignore the lower one \
                     entirely. '{loser}' is not reaching the rig at all."
                );
            }
            if tied > 0 {
                println!(
                    "  {tied} universe(s) have sources at EQUAL priority — those really do \
                     merge (typically HTP, brightest channel wins)."
                );
            }
        }
    }
    let _ = std::io::stdout().flush();
}

fn bind(interface: Ipv4Addr) -> anyhow::Result<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    // Every sACN receiver on this machine shares port 5568, including the show
    // itself; without this the second one to start simply fails to bind.
    socket.set_reuse_address(true)?;
    // A full array is 192 universes at 30-60 fps — 6-12k packets/s, and they arrive
    // in a burst per frame rather than spread out. The default receive buffer
    // (~64 KB, about 40 packets) overflows inside a single frame's burst, and the
    // kernel drops the rest silently: the tool then reports a *subset* of the
    // universes as though the rest were not being transmitted. Ask for 8 MB.
    let _ = socket.set_recv_buffer_size(8 << 20);
    // Bind the wildcard, not the interface: on Windows, binding a specific address
    // silently drops multicast delivery for groups joined on that interface.
    socket.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, SACN_PORT).into())?;
    let _ = interface;
    Ok(socket.into())
}

fn would_block(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    )
}

fn parse_args(args: &[String], map: &Map) -> anyhow::Result<Options> {
    let mut opts = Options {
        interface: Ipv4Addr::UNSPECIFIED,
        first: map.start,
        last: map.last(),
        seconds: None,
        mode: Mode::Summary,
        channels: 24,
        window: 32,
        dwell: Duration::from_millis(1500),
    };
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--interface" => opts.interface = next(args, &mut i, "--interface")?.parse()?,
            "--universes" => {
                let spec = next(args, &mut i, "--universes")?;
                let (a, b) = spec
                    .split_once('-')
                    .ok_or_else(|| anyhow::anyhow!("--universes wants FIRST-LAST, got {spec}"))?;
                opts.first = a.trim().parse()?;
                opts.last = b.trim().parse()?;
            }
            "--seconds" => opts.seconds = Some(next(args, &mut i, "--seconds")?.parse()?),
            "--channels" => opts.channels = next(args, &mut i, "--channels")?.parse()?,
            "--window" => opts.window = next(args, &mut i, "--window")?.parse::<usize>()?.max(1),
            "--dwell" => {
                let ms: u64 = next(args, &mut i, "--dwell")?.parse()?;
                opts.dwell = Duration::from_millis(ms);
            }
            "--events" => opts.mode = Mode::Events,
            "--json" => opts.mode = Mode::Json,
            "--dump" => opts.mode = Mode::Dump(next(args, &mut i, "--dump")?.parse()?),
            other => anyhow::bail!("unknown argument {other} (try --help)"),
        }
        i += 1;
    }
    if opts.last < opts.first {
        anyhow::bail!("--universes range is backwards");
    }
    Ok(opts)
}

fn next(args: &[String], i: &mut usize, flag: &str) -> anyhow::Result<String> {
    *i += 1;
    args.get(*i)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("{flag} needs a value"))
}

fn print_help() {
    println!(
        "\
Passively decode sACN (E1.31) data packets and map them onto this installation.

  --interface <ip>     local NIC to join multicast groups on (default: all)
  --universes A-B      universe range (default: whatever the config transmits)
  --seconds N          stop after N seconds (default: until Ctrl-C)
  --window N           multicast groups held at once (default 32). Ranges larger
                       than this are SWEPT in windows, because a NIC's filter
                       table silently drops groups beyond it — joining 400 groups
                       appears to work and delivers about 58 of them.
  --dwell MS           how long each sweep window is held (default 1500)
  --events             log dark->lit transitions only, with timestamps.
                       Run a chase on another source to read off the true
                       physical spoke order.
  --dump <universe>    print raw channel values for one universe
  --channels N         how many channels --dump prints (default 24)
  --json               one JSON line per packet, for capture and diffing
  --help

Never transmits. Safe to run during a show."
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a packet from the E1.31 layout independently of `sacn.rs`, so this
    /// asserts the parser agrees with the spec rather than with our encoder.
    fn packet(universe: u16, sequence: u8, slots: &[u8]) -> Vec<u8> {
        let mut p = vec![0u8; SLOTS + slots.len()];
        p[0..2].copy_from_slice(&0x0010u16.to_be_bytes());
        p[4..16].copy_from_slice(&ACN_ID);
        p[ROOT_VECTOR..ROOT_VECTOR + 4].copy_from_slice(&VECTOR_ROOT_E131_DATA.to_be_bytes());
        p[CID..CID + 16].copy_from_slice(&[0xab; 16]);
        p[FRAMING_VECTOR..FRAMING_VECTOR + 4]
            .copy_from_slice(&VECTOR_E131_DATA_PACKET.to_be_bytes());
        p[SOURCE_NAME..SOURCE_NAME + 5].copy_from_slice(b"Rig 1");
        p[PRIORITY] = 100;
        p[SEQUENCE] = sequence;
        p[UNIVERSE..UNIVERSE + 2].copy_from_slice(&universe.to_be_bytes());
        p[PROP_COUNT..PROP_COUNT + 2].copy_from_slice(&(1 + slots.len() as u16).to_be_bytes());
        p[START_CODE] = 0x00;
        p[SLOTS..].copy_from_slice(slots);
        p
    }

    #[test]
    fn decodes_a_spec_shaped_packet() {
        let raw = packet(7, 42, &[10, 20, 30]);
        let p = parse(&raw).expect("valid data packet");
        assert_eq!(p.universe, 7);
        assert_eq!(p.sequence, 42);
        assert_eq!(p.priority, 100);
        assert_eq!(source_name(p.source_name), "Rig 1");
        assert_eq!(p.slots, &[10, 20, 30]);
        assert!(!p.terminated);
    }

    #[test]
    fn rejects_non_data_traffic() {
        assert!(parse(&[0u8; 200]).is_none(), "zeros are not E1.31");
        assert!(parse(&[]).is_none(), "empty");
        let mut short = packet(1, 0, &[1, 2, 3]);
        short.truncate(SLOTS - 1);
        assert!(parse(&short).is_none(), "truncated before the slots");

        // A lying property count must clamp to what arrived, not panic.
        let mut liar = packet(1, 0, &[1, 2, 3]);
        liar[PROP_COUNT..PROP_COUNT + 2].copy_from_slice(&600u16.to_be_bytes());
        assert_eq!(parse(&liar).expect("still parses").slots.len(), 3);

        // Non-zero start code is RDM or text, not pixel data.
        let mut rdm = packet(1, 0, &[1, 2, 3]);
        rdm[START_CODE] = 0xcc;
        assert!(parse(&rdm).is_none());
    }

    fn gate_map() -> Map {
        let cfg = AppConfig::default();
        Map::new(&cfg)
    }

    #[test]
    fn universes_map_back_onto_the_installed_patch() {
        let m = gate_map();
        // The patch: spoke 0 on 1-3, spoke 1 on 7-9, 4-6 reserved and dark.
        assert_eq!(m.describe(1), "spoke 0, px 0-169");
        assert_eq!(m.describe(2), "spoke 0, px 170-339");
        assert_eq!(m.describe(3), "spoke 0, px 340-377");
        assert!(m.describe(4).starts_with("reserved"));
        assert_eq!(m.describe(7), "spoke 1, px 0-169");
        assert_eq!(m.last(), 381);
        assert_eq!(m.describe(381), "spoke 63, px 340-377");
        // 382-384 are still inside the last spoke's 6-universe block, just the
        // reserved half of it. The array only truly ends after 384.
        assert!(m.describe(382).starts_with("reserved"), "{}", m.describe(382));
        assert!(m.describe(385).contains("beyond"), "{}", m.describe(385));
    }
}
