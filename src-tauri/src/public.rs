//! The public floor's rules, with no I/O: who is connected, what each
//! connection may do, how fast it may do it, and what a secret key unlocks.
//! `public_server.rs` is the listener that applies these; keeping the rules
//! here keeps them unit-testable and keeps the listener small.
//!
//! Vocabulary:
//! - a **session** is one public WebSocket connection after hello;
//! - a **capability** is one of the five things the floor can be opened for
//!   (`draw`, `effects`, `games`, `knobs`, `preview`);
//! - a **perk** is a string granted by a key; the five capability names are
//!   perks that override the floor's toggles, every other perk is for the UI.
//!
//! See `plans/public-floor.md` for the threat model this answers.

use crate::config::{PublicConfig, UnlockKey};
use crate::layers::EffectCfg;
use crate::protocol::ClientMsg;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

/// Largest text frame a public connection may send. The biggest legitimate
/// message is a paint batch of [`MAX_PAINT_POINTS`] dabs — well under 4 KiB.
pub const MAX_TEXT_FRAME: usize = 16 * 1024;
/// A connection that has not said hello by then is dropped.
pub const HELLO_DEADLINE: Duration = Duration::from_secs(5);
/// A session that has sent nothing at all for this long is dropped. The UI
/// sends nothing while idle (the server pushes state), so this is a phone in a
/// pocket with the page still open.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// Refused or malformed messages before the connection is closed. Refusals
/// are counted, not fatal, because a stale UI bundle may send a message the
/// current rules exclude — but a script probing the protocol goes away.
pub const STRIKE_LIMIT: u32 = 20;
/// Blocklist entries kept (ids and IPs each); oldest dropped beyond it.
pub const MAX_BLOCKLIST: usize = 1024;
/// Dabs per paint message and points per game-input message. The UIs batch
/// at ~30 Hz, so a finger produces a handful per message.
pub const MAX_PAINT_POINTS: usize = 64;
pub const MAX_GAME_POINTS: usize = 32;
/// Stroke radius as a fraction of the array radius, without and with the
/// `big_brush` perk.
pub const MAX_DAB_SIZE: f32 = 0.25;
pub const MAX_DAB_SIZE_BIG_BRUSH: f32 = 0.5;
/// Effects: footprint multiplier and lifetime (0 = the kind's default).
pub const MAX_EFFECT_SIZE: f32 = 2.5;
pub const MAX_EFFECT_DURATION: f32 = 8.0;
/// Key attempts per connection per minute. Keys can be short code words, so
/// guessing must be slow.
pub const UNLOCK_ATTEMPTS_PER_MINUTE: u32 = 6;
/// Players listed by name in the operator's status; the rest are counted.
pub const ROSTER_LIMIT: usize = 60;
/// Public preview ceilings regardless of configuration.
pub const MAX_PREVIEW_FPS: u32 = 10;
pub const MIN_PREVIEW_DECIMATE: u32 = 6;
/// Public client ids carry this prefix so they can never collide with a LAN
/// device's record (the admin roster's Block messages name ids).
pub const ID_PREFIX: &str = "pub-";

pub const CAPABILITY_PERKS: [&str; 5] = ["draw", "effects", "games", "knobs", "preview"];

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/// Classic token bucket: `rate` tokens per second refill, `burst` capacity.
#[derive(Debug, Clone)]
pub struct TokenBucket {
    capacity: f32,
    tokens: f32,
    refill_per_sec: f32,
    last: Instant,
}

impl TokenBucket {
    pub fn new(rate_per_sec: f32, burst: f32, now: Instant) -> Self {
        let capacity = burst.max(1.0);
        Self {
            capacity,
            tokens: capacity,
            refill_per_sec: rate_per_sec.max(0.0),
            last: now,
        }
    }

    /// Take one token if available.
    pub fn try_take(&mut self, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f32();
        self.last = now;
        self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// The per-connection message limiter from the configured sustained rate:
/// bursts of twice the rate are absorbed.
pub fn message_limiter(cfg: &PublicConfig, now: Instant) -> TokenBucket {
    let rate = cfg.messages_per_second.clamp(1, 1000) as f32;
    TokenBucket::new(rate, rate * 2.0, now)
}

pub fn unlock_limiter(now: Instant) -> TokenBucket {
    let per_min = UNLOCK_ATTEMPTS_PER_MINUTE as f32;
    TokenBucket::new(per_min / 60.0, per_min, now)
}

// ---------------------------------------------------------------------------
// Client address
// ---------------------------------------------------------------------------

fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|v4| v4.is_loopback() || v4.is_private() || v4.is_link_local())
        }
    }
}

/// The address the per-IP cap and the roster use. Forwarded headers are
/// believed only when the operator asked for it **and** the TCP peer is the
/// proxy (loopback or a private address): a direct connection from the
/// internet to a `0.0.0.0` bind cannot name a different IP to dodge the cap.
///
/// Cloudflare's `CF-Connecting-IP` is authoritative when present. Otherwise
/// the *last* `X-Forwarded-For` entry is the one our proxy appended (a client
/// can prepend its own entries; it cannot append after the proxy). Caddy with
/// no `trusted_proxies` replaces the header outright, so the last entry is
/// the client there too.
pub fn client_ip(peer: SocketAddr, headers: &axum::http::HeaderMap, trust_forwarded: bool) -> IpAddr {
    let peer_ip = canonical(peer.ip());
    if !trust_forwarded || !is_private(peer_ip) {
        return peer_ip;
    }
    let parse = |value: &str| value.trim().parse::<IpAddr>().ok().map(canonical);
    if let Some(ip) = headers
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
        .and_then(parse)
    {
        return ip;
    }
    if let Some(ip) = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit(',').next())
        .and_then(parse)
    {
        return ip;
    }
    if let Some(ip) = headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .and_then(parse)
    {
        return ip;
    }
    peer_ip
}

/// `::ffff:1.2.3.4` and `1.2.3.4` are the same phone.
fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        v4 => v4,
    }
}

/// Cross-site WebSocket hijacking guard: a page on another origin must not be
/// able to open a socket to the floor from a visitor's browser. Browsers always
/// send `Origin` on WebSocket upgrades; non-browser clients may omit it, which
/// is allowed (they are not the attack). When present it must name this host.
pub fn origin_allowed(headers: &axum::http::HeaderMap) -> bool {
    let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) else {
        return true;
    };
    if origin.eq_ignore_ascii_case("null") {
        return false;
    }
    let Some(host) = headers.get("host").and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let origin_host = origin
        .split("://")
        .nth(1)
        .unwrap_or(origin)
        .split('/')
        .next()
        .unwrap_or("");
    host_name(origin_host).eq_ignore_ascii_case(host_name(host))
}

/// Host without a port (`[::1]:9521` → `[::1]`, `play.example.com:443` →
/// `play.example.com`). Browsers put the same host in `Origin` and `Host`, and
/// the proxy forwards `Host` unchanged; comparing hostnames rather than the
/// full `host:port` tolerates a proxy that adds or drops the default port.
fn host_name(host: &str) -> &str {
    if host.starts_with('[') {
        host.split(']').next().map(|s| &host[..s.len() + 1]).unwrap_or(host)
    } else {
        host.split(':').next().unwrap_or(host)
    }
}

// ---------------------------------------------------------------------------
// What a message may do
// ---------------------------------------------------------------------------

/// The decision for one incoming message on the public listener.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    /// Housekeeping, always allowed.
    Allow,
    /// Allowed when the session holds the named capability.
    Needs(&'static str),
    /// Not part of the public protocol at all.
    Refuse,
}

/// Allowlist, not denylist: a message the public listener was not written for
/// is refused, whatever it is.
pub fn gate(msg: &ClientMsg) -> Gate {
    use ClientMsg as M;
    match msg {
        M::Hello { .. }
        | M::GetState
        | M::SetClientName { .. }
        | M::Unlock { .. }
        | M::PreviewAck { .. }
        | M::UnsubscribePreview => Gate::Allow,
        M::Paint { .. } => Gate::Needs("draw"),
        M::TriggerEffect { .. } => Gate::Needs("effects"),
        M::GameInput { .. } | M::GameCommand { .. } => Gate::Needs("games"),
        M::PatchParam { .. } => Gate::Needs("knobs"),
        M::SubscribePreview { .. } => Gate::Needs("preview"),
        _ => Gate::Refuse,
    }
}

/// The five switches, resolved for one session.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct Capabilities {
    pub draw: bool,
    pub effects: bool,
    pub games: bool,
    pub knobs: bool,
    pub preview: bool,
}

impl Capabilities {
    pub fn has(&self, cap: &str) -> bool {
        match cap {
            "draw" => self.draw,
            "effects" => self.effects,
            "games" => self.games,
            "knobs" => self.knobs,
            "preview" => self.preview,
            _ => false,
        }
    }

    pub fn any(&self) -> bool {
        self.draw || self.effects || self.games || self.knobs
    }
}

/// `open` is the floor's master switch for the general public; a capability
/// perk from a key overrides both it and the matching toggle, so a group can
/// keep drawing while the floor is closed to everyone else.
pub fn capabilities(cfg: &PublicConfig, perks: &BTreeSet<String>) -> Capabilities {
    let floor = |allowed: bool, perk: &str| (cfg.open && allowed) || perks.contains(perk);
    Capabilities {
        draw: floor(cfg.allow_draw, "draw"),
        effects: floor(cfg.allow_effects, "effects"),
        games: floor(cfg.allow_games, "games"),
        knobs: floor(cfg.allow_knobs, "knobs"),
        preview: floor(cfg.preview_fps > 0, "preview"),
    }
}

/// The public preview stream's shape: the operator's numbers, clamped to the
/// ceilings this listener enforces regardless. `fps` is 0 when there is no
/// stream for this session.
pub fn preview_limits(cfg: &PublicConfig, caps: &Capabilities) -> (u32, u32) {
    if !caps.preview {
        return (0, cfg.preview_decimate.max(MIN_PREVIEW_DECIMATE));
    }
    // A `preview` perk on a floor whose preview is 0 fps still gets a stream:
    // the smallest one.
    let fps = if cfg.preview_fps == 0 { 5 } else { cfg.preview_fps };
    (fps.clamp(1, MAX_PREVIEW_FPS), cfg.preview_decimate.max(MIN_PREVIEW_DECIMATE))
}

/// Bound a public effect: intensity scaled by the floor's input level,
/// footprint and lifetime capped, `strobe` only with its perk (it is the one
/// effect that can make a dance floor unpleasant from a distance) and the
/// traffic cone only with `cone` (it is a group's easter egg, see
/// plans/hidden-modes.md).
pub fn clamp_effect(effect: &mut EffectCfg, cfg: &PublicConfig, perks: &BTreeSet<String>) -> bool {
    let needs = match effect.kind {
        crate::layers::EffectKind::Strobe => Some("strobe"),
        crate::layers::EffectKind::Cone => Some("cone"),
        _ => None,
    };
    if let Some(perk) = needs
        && !perks.contains(perk)
    {
        return false;
    }
    let level = cfg.input_level.clamp(0.0, 1.0);
    effect.intensity = finite(effect.intensity, 1.0).clamp(0.0, 1.0) * level;
    effect.size = finite(effect.size, 1.0).clamp(0.1, MAX_EFFECT_SIZE);
    effect.duration = finite(effect.duration, 0.0).clamp(0.0, MAX_EFFECT_DURATION);
    effect.radius = finite(effect.radius, 0.5).clamp(0.0, 1.2);
    effect.angle = finite(effect.angle, 0.0);
    effect.rotation = finite(effect.rotation, 0.0);
    effect.grow = finite(effect.grow, 0.0).clamp(-1.0, 1.0);
    effect.edge = finite(effect.edge, 0.5).clamp(0.0, 1.0);
    effect.fill = finite(effect.fill, 0.35).clamp(0.0, 1.0);
    effect.saturation = finite(effect.saturation, 0.85).clamp(0.0, 1.0);
    effect.brightness = finite(effect.brightness, 1.0).clamp(0.0, 1.0);
    true
}

/// Bound a public stroke: size and intensity, the latter scaled by the floor's
/// input level. Returns `(size, intensity)`.
pub fn clamp_paint(size: f32, intensity: f32, cfg: &PublicConfig, perks: &BTreeSet<String>) -> (f32, f32) {
    let max_size = if perks.contains("big_brush") {
        MAX_DAB_SIZE_BIG_BRUSH
    } else {
        MAX_DAB_SIZE
    };
    let level = cfg.input_level.clamp(0.0, 1.0);
    (
        finite(size, 0.12).clamp(0.01, max_size),
        finite(intensity, 1.0).clamp(0.0, 1.0) * level,
    )
}

fn finite(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

/// A valid public client id: the UI's generated form (`pub-<uuid>`), and
/// nothing a LAN device would ever be recorded under.
pub fn valid_client_id(id: &str) -> bool {
    id.starts_with(ID_PREFIX)
        && id.len() > ID_PREFIX.len()
        && id.len() <= 96
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedeemError {
    /// No enabled key has that secret. Deliberately the same answer for
    /// "disabled" and "never existed".
    Unknown,
    /// The key's `max_uses` is spent.
    Exhausted,
}

/// What a redemption grants.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redeemed {
    pub id: String,
    pub name: String,
    pub perks: Vec<String>,
    pub flourish: bool,
}

/// Secrets are compared in constant time so a guesser learns nothing from
/// timing. Keys are few, so the scan over all of them is not a cost.
fn secret_matches(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

/// Look a secret up without spending a use. The listener calls this on hello
/// (keys the phone remembered) and on `Unlock`; `spend_use` follows through
/// the config mutation so the counter persists.
pub fn find_key<'a>(cfg: &'a PublicConfig, secret: &str) -> Result<&'a UnlockKey, RedeemError> {
    let secret = secret.trim();
    if secret.len() < 4 {
        return Err(RedeemError::Unknown);
    }
    let mut found: Option<&UnlockKey> = None;
    for key in &cfg.keys {
        // Scan every key even after a hit, so the cost does not depend on
        // where the matching key sits in the list.
        if key.enabled && !key.secret.is_empty() && secret_matches(&key.secret, secret) {
            found = found.or(Some(key));
        }
    }
    let key = found.ok_or(RedeemError::Unknown)?;
    if key.max_uses > 0 && key.uses >= key.max_uses {
        return Err(RedeemError::Exhausted);
    }
    Ok(key)
}

/// Count one redemption on the key with that id; returns what it grants, or
/// `None` if the key vanished or filled up between lookup and spend.
pub fn spend_use(cfg: &mut PublicConfig, id: &str) -> Option<Redeemed> {
    let key = cfg.keys.iter_mut().find(|k| k.id == id && k.enabled)?;
    if key.max_uses > 0 && key.uses >= key.max_uses {
        return None;
    }
    key.uses = key.uses.saturating_add(1);
    Some(Redeemed {
        id: key.id.clone(),
        name: key.name.clone(),
        perks: key.perks.clone(),
        flourish: key.flourish,
    })
}

/// A key written by the Settings page must keep its redemption counter: the
/// page sends the whole config, and a stale copy would otherwise reset `uses`
/// or let an unknown counter in.
pub fn preserve_key_uses(current: &PublicConfig, incoming: &mut PublicConfig) {
    for key in &mut incoming.keys {
        key.uses = current
            .keys
            .iter()
            .find(|k| k.id == key.id)
            .map_or(0, |k| k.uses);
    }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/// Why a connection or hello was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    Full,
    TooManyFromIp,
    Blocked,
}

impl Refusal {
    pub fn message(self) -> &'static str {
        match self {
            Refusal::Full => "The floor is full right now — try again in a moment.",
            Refusal::TooManyFromIp => "Too many connections from this network.",
            Refusal::Blocked => "You have been blocked by the operator.",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Session {
    pub conn_id: u64,
    pub id: String,
    pub name: String,
    pub ip: IpAddr,
    pub joined: Instant,
    pub last_input: Option<(Instant, &'static str)>,
    pub perks: BTreeSet<String>,
    /// Names of the keys this session redeemed, for the roster and the toast.
    pub keys: Vec<String>,
    pub strikes: u32,
    /// Messages the limiter dropped.
    pub dropped: u32,
}

/// Every public connection the process has open, plus the blocklists. Lives
/// in `SharedState`; nothing here is persisted — a blocked phone stays blocked
/// for the show, which is what the Block button means.
#[derive(Debug, Default)]
pub struct Registry {
    /// Reserved at upgrade, before hello — so the cap counts sockets, not
    /// just sessions that got as far as identifying themselves.
    connections: HashMap<u64, IpAddr>,
    per_ip: HashMap<IpAddr, u32>,
    sessions: HashMap<u64, Session>,
    blocked_ids: HashSet<String>,
    blocked_ips: HashSet<IpAddr>,
    /// Insertion order for the bounded blocklists.
    block_order: Vec<(Option<String>, Option<IpAddr>)>,
    pub total_joined: u64,
    pub peak: u32,
    pub refused_full: u64,
    pub kicked: u64,
}

impl Registry {
    /// Count a new socket. Called at the HTTP upgrade so an over-cap request
    /// is answered with 503 before any WebSocket work is done.
    pub fn reserve(&mut self, conn_id: u64, ip: IpAddr, cfg: &PublicConfig) -> Result<(), Refusal> {
        if self.blocked_ips.contains(&ip) {
            return Err(Refusal::Blocked);
        }
        if self.connections.len() >= cfg.max_connections.max(1) as usize {
            self.refused_full += 1;
            return Err(Refusal::Full);
        }
        let from_ip = self.per_ip.get(&ip).copied().unwrap_or(0);
        if from_ip >= cfg.max_per_ip.max(1) {
            return Err(Refusal::TooManyFromIp);
        }
        self.connections.insert(conn_id, ip);
        *self.per_ip.entry(ip).or_insert(0) += 1;
        self.peak = self.peak.max(self.connections.len() as u32);
        Ok(())
    }

    /// The socket closed (with or without a session).
    pub fn release(&mut self, conn_id: u64) {
        if let Some(ip) = self.connections.remove(&conn_id) {
            if let Some(n) = self.per_ip.get_mut(&ip) {
                *n = n.saturating_sub(1);
                if *n == 0 {
                    self.per_ip.remove(&ip);
                }
            }
        }
        self.sessions.remove(&conn_id);
    }

    /// Hello landed: the socket becomes a session.
    pub fn admit(&mut self, conn_id: u64, id: &str, name: &str, now: Instant) -> Result<(), Refusal> {
        let Some(ip) = self.connections.get(&conn_id).copied() else {
            return Err(Refusal::Full);
        };
        if self.blocked_ids.contains(id) || self.blocked_ips.contains(&ip) {
            return Err(Refusal::Blocked);
        }
        self.total_joined += 1;
        self.sessions.insert(
            conn_id,
            Session {
                conn_id,
                id: id.to_owned(),
                name: name.to_owned(),
                ip,
                joined: now,
                last_input: None,
                perks: BTreeSet::new(),
                keys: Vec::new(),
                strikes: 0,
                dropped: 0,
            },
        );
        Ok(())
    }

    pub fn session(&self, conn_id: u64) -> Option<&Session> {
        self.sessions.get(&conn_id)
    }

    pub fn session_mut(&mut self, conn_id: u64) -> Option<&mut Session> {
        self.sessions.get_mut(&conn_id)
    }

    pub fn connections(&self) -> u32 {
        self.connections.len() as u32
    }

    pub fn sessions_count(&self) -> u32 {
        self.sessions.len() as u32
    }

    /// Whether the session's id or address has been blocked since it joined
    /// (the listener checks on its tick and closes it).
    pub fn is_blocked(&self, conn_id: u64) -> bool {
        self.sessions
            .get(&conn_id)
            .is_some_and(|s| self.blocked_ids.contains(&s.id) || self.blocked_ips.contains(&s.ip))
    }

    /// Operator action from the roster: block a public player by id. Every
    /// session with that id (a phone with two tabs) is affected, and so is
    /// every address those sessions came from — the id is the phone's own
    /// choice and a reload with cleared storage would mint a new one.
    pub fn block(&mut self, id: &str) -> usize {
        let ips: Vec<IpAddr> = self
            .sessions
            .values()
            .filter(|s| s.id == id)
            .map(|s| s.ip)
            .collect();
        self.push_block(Some(id.to_owned()), None);
        for ip in &ips {
            self.push_block(None, Some(*ip));
        }
        self.kicked += ips.len() as u64;
        ips.len()
    }

    pub fn unblock(&mut self, id: &str) {
        self.blocked_ids.remove(id);
        // Addresses blocked alongside this id are released too; another id
        // blocked from the same address keeps its own entry.
        let keep: HashSet<IpAddr> = self
            .block_order
            .iter()
            .filter_map(|(bid, ip)| match (bid, ip) {
                (Some(b), Some(ip)) if b != id => Some(*ip),
                _ => None,
            })
            .collect();
        self.block_order.retain(|(bid, _)| bid.as_deref() != Some(id));
        self.blocked_ips.retain(|ip| keep.contains(ip));
    }

    fn push_block(&mut self, id: Option<String>, ip: Option<IpAddr>) {
        if let Some(id) = &id {
            self.blocked_ids.insert(id.clone());
        }
        if let Some(ip) = ip {
            self.blocked_ips.insert(ip);
        }
        // One entry carries both halves of a Block so unblock can undo the
        // address with the id.
        if let (Some(id), Some(ip)) = (&id, ip) {
            self.block_order.push((Some(id.clone()), Some(ip)));
        } else {
            self.block_order.push((id, ip));
        }
        while self.block_order.len() > MAX_BLOCKLIST {
            let (old_id, old_ip) = self.block_order.remove(0);
            if let Some(id) = old_id {
                if !self.block_order.iter().any(|(b, _)| b.as_deref() == Some(id.as_str())) {
                    self.blocked_ids.remove(&id);
                }
            }
            if let Some(ip) = old_ip {
                if !self.block_order.iter().any(|(_, i)| *i == Some(ip)) {
                    self.blocked_ips.remove(&ip);
                }
            }
        }
    }

    pub fn blocked_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.blocked_ids.iter().cloned().collect();
        ids.sort();
        ids
    }

    pub fn note_input(&mut self, conn_id: u64, kind: &'static str, now: Instant) {
        if let Some(s) = self.sessions.get_mut(&conn_id) {
            s.last_input = Some((now, kind));
        }
    }

    /// The operator's view, bounded: the most recently active players by
    /// name, and counts for the rest.
    pub fn status(&self, cfg: &PublicConfig, listening: bool, error: &str, now: Instant) -> crate::protocol::PublicStatus {
        let mut players: Vec<&Session> = self.sessions.values().collect();
        // Most recently active first; never-active by arrival.
        players.sort_by(|a, b| {
            let ka = a.last_input.map(|(t, _)| t).unwrap_or(a.joined);
            let kb = b.last_input.map(|(t, _)| t).unwrap_or(b.joined);
            kb.cmp(&ka)
        });
        let total = players.len();
        let listed: Vec<crate::protocol::PublicPlayerInfo> = players
            .into_iter()
            .take(ROSTER_LIMIT)
            .map(|s| crate::protocol::PublicPlayerInfo {
                id: s.id.clone(),
                name: s.name.clone(),
                ip: s.ip.to_string(),
                connected_secs: now.saturating_duration_since(s.joined).as_secs_f32(),
                last_input: s.last_input.map(|(_, k)| k.to_owned()),
                last_input_secs: s
                    .last_input
                    .map(|(t, _)| now.saturating_duration_since(t).as_secs_f32()),
                keys: s.keys.clone(),
                dropped: s.dropped,
            })
            .collect();
        crate::protocol::PublicStatus {
            enabled: cfg.enabled,
            listening,
            error: error.to_owned(),
            address: format!("{}:{}", cfg.bind, cfg.port),
            url: cfg.url.clone(),
            open: cfg.open,
            connections: self.connections(),
            players: self.sessions_count(),
            peak: self.peak,
            total_joined: self.total_joined,
            refused_full: self.refused_full,
            kicked: self.kicked,
            blocked: self.blocked_ids.len() as u32 + self.blocked_ips.len() as u32,
            blocked_ids: self.blocked_ids(),
            roster: listed,
            roster_truncated: total.saturating_sub(ROSTER_LIMIT) as u32,
        }
    }
}

/// Helpers for the public listener's own loopback address when the
/// configured bind is unspecified.
pub fn display_bind(bind: &str) -> &str {
    match bind {
        "0.0.0.0" | "::" | "[::]" => "every interface",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    fn cfg() -> PublicConfig {
        PublicConfig::default()
    }

    fn key(id: &str, secret: &str, perks: &[&str], max_uses: u32) -> UnlockKey {
        UnlockKey {
            id: id.into(),
            name: format!("Key {id}"),
            secret: secret.into(),
            perks: perks.iter().map(|p| p.to_string()).collect(),
            enabled: true,
            max_uses,
            uses: 0,
            flourish: true,
        }
    }

    #[test]
    fn token_bucket_absorbs_a_burst_then_holds_the_rate() {
        let t0 = Instant::now();
        let mut b = TokenBucket::new(10.0, 20.0, t0);
        assert_eq!((0..20).filter(|_| b.try_take(t0)).count(), 20);
        assert!(!b.try_take(t0));
        // Half a second later: five more.
        let t1 = t0 + Duration::from_millis(500);
        assert_eq!((0..10).filter(|_| b.try_take(t1)).count(), 5);
        // Refill never exceeds the burst.
        let t2 = t0 + Duration::from_secs(60);
        assert_eq!((0..40).filter(|_| b.try_take(t2)).count(), 20);
    }

    #[test]
    fn limiter_follows_the_configured_rate() {
        let mut c = cfg();
        c.messages_per_second = 40;
        let t0 = Instant::now();
        let mut b = message_limiter(&c, t0);
        assert_eq!((0..100).filter(|_| b.try_take(t0)).count(), 80);
    }

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, v.parse().unwrap());
        }
        h
    }

    #[test]
    fn forwarded_ip_is_believed_only_from_the_proxy() {
        let proxy: SocketAddr = "127.0.0.1:40000".parse().unwrap();
        let lan_proxy: SocketAddr = "192.168.1.5:40000".parse().unwrap();
        let internet: SocketAddr = "203.0.113.7:40000".parse().unwrap();
        let h = headers(&[("x-forwarded-for", "198.51.100.2, 198.51.100.3")]);
        // Last entry wins: it is the one the trusted proxy appended.
        assert_eq!(client_ip(proxy, &h, true), "198.51.100.3".parse::<IpAddr>().unwrap());
        assert_eq!(client_ip(lan_proxy, &h, true), "198.51.100.3".parse::<IpAddr>().unwrap());
        // A direct internet peer cannot rename itself.
        assert_eq!(client_ip(internet, &h, true), internet.ip());
        // Trust off: the peer, always.
        assert_eq!(client_ip(proxy, &h, false), proxy.ip());
        // Cloudflare's header beats X-Forwarded-For.
        let h = headers(&[("cf-connecting-ip", "198.51.100.9"), ("x-forwarded-for", "198.51.100.2")]);
        assert_eq!(client_ip(proxy, &h, true), "198.51.100.9".parse::<IpAddr>().unwrap());
        // Garbage falls back to the peer.
        let h = headers(&[("x-forwarded-for", "not-an-ip")]);
        assert_eq!(client_ip(proxy, &h, true), proxy.ip());
    }

    #[test]
    fn mapped_ipv4_is_the_same_phone() {
        let peer: SocketAddr = "[::ffff:127.0.0.1]:1".parse().unwrap();
        let h = headers(&[("x-forwarded-for", "::ffff:198.51.100.2")]);
        assert_eq!(client_ip(peer, &h, true), "198.51.100.2".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn origin_must_match_host_when_present() {
        assert!(origin_allowed(&headers(&[("host", "play.example.com")])));
        assert!(origin_allowed(&headers(&[
            ("host", "play.example.com"),
            ("origin", "https://play.example.com"),
        ])));
        assert!(origin_allowed(&headers(&[
            ("host", "Play.Example.com:443"),
            ("origin", "https://play.example.com"),
        ])));
        assert!(origin_allowed(&headers(&[
            ("host", "127.0.0.1:9521"),
            ("origin", "http://127.0.0.1:9521"),
        ])));
        assert!(!origin_allowed(&headers(&[
            ("host", "play.example.com"),
            ("origin", "https://evil.example.net"),
        ])));
        assert!(!origin_allowed(&headers(&[("host", "play.example.com"), ("origin", "null")])));
        assert!(!origin_allowed(&headers(&[("origin", "https://play.example.com")])));
    }

    #[test]
    fn the_allowlist_refuses_everything_it_was_not_written_for() {
        use crate::layers::{DabPoint, PenKind};
        assert_eq!(gate(&ClientMsg::GetState), Gate::Allow);
        assert_eq!(gate(&ClientMsg::Unlock { key: "x".into() }), Gate::Allow);
        assert_eq!(
            gate(&ClientMsg::Paint {
                pen: PenKind::Glow,
                points: vec![DabPoint { angle: 0.0, radius: 0.5, dir: 0.0 }],
                hue: 0.0,
                saturation: 1.0,
                brightness: 1.0,
                size: 0.1,
                intensity: 1.0,
            }),
            Gate::Needs("draw")
        );
        assert_eq!(gate(&ClientMsg::GameInput { species: 0, points: vec![] }), Gate::Needs("games"));
        assert_eq!(
            gate(&ClientMsg::PatchParam { node: "n".into(), param: "p".into(), value: 0.0 }),
            Gate::Needs("knobs")
        );
        assert_eq!(gate(&ClientMsg::SubscribePreview { fps: 5.0, decimate: 12, include_ready: false }), Gate::Needs("preview"));
        // Show control, telemetry inputs, disk writers, process control.
        assert_eq!(gate(&ClientMsg::SetSacnEnabled { enabled: false }), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::SetMaster { brightness: Some(0.0), speed: None, floor: None }), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::Imu { yaw: 0.0, pitch: 0.0, roll: 0.0, shake: 0.0 }), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::Report { description: String::new(), seconds: 1.0 }), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::CheckUpdate), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::InstallUpdate), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::SetGameMode { game: None }), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::SetTestMode { active: true }), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::SubscribeMiniPreviews { fps: 1.0 }), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::PatchList), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::RotateJoinToken), Gate::Refuse);
        assert_eq!(gate(&ClientMsg::PeerFollow { backup: true, version: String::new() }), Gate::Refuse);
    }

    #[test]
    fn capabilities_follow_the_toggles_and_perks_override_them() {
        let mut c = cfg();
        let none = BTreeSet::new();
        let caps = capabilities(&c, &none);
        assert!(caps.draw && caps.effects && caps.games && !caps.knobs && !caps.preview);
        c.open = false;
        let caps = capabilities(&c, &none);
        assert!(!caps.any() && !caps.preview);
        // A key holder keeps drawing on a closed floor, and only drawing.
        let perks: BTreeSet<String> = ["draw".to_string()].into_iter().collect();
        let caps = capabilities(&c, &perks);
        assert!(caps.draw && !caps.effects && !caps.games);
        // Preview: the perk on a 0 fps floor gets the smallest stream.
        let perks: BTreeSet<String> = ["preview".to_string()].into_iter().collect();
        let caps = capabilities(&c, &perks);
        assert!(caps.preview);
        assert_eq!(preview_limits(&c, &caps), (5, 12));
        c.preview_fps = 30;
        c.preview_decimate = 1;
        assert_eq!(preview_limits(&c, &caps), (MAX_PREVIEW_FPS, MIN_PREVIEW_DECIMATE));
        assert_eq!(preview_limits(&c, &Capabilities::default()).0, 0);
    }

    #[test]
    fn effects_are_scaled_and_strobe_needs_its_perk() {
        let mut c = cfg();
        c.input_level = 0.5;
        let none = BTreeSet::new();
        let mut e = EffectCfg {
            kind: crate::layers::EffectKind::Burst,
            intensity: 9.0,
            size: 40.0,
            duration: 600.0,
            ..EffectCfg::default()
        };
        assert!(clamp_effect(&mut e, &c, &none));
        assert_eq!(e.intensity, 0.5);
        assert_eq!(e.size, MAX_EFFECT_SIZE);
        assert_eq!(e.duration, MAX_EFFECT_DURATION);
        let mut strobe = EffectCfg { kind: crate::layers::EffectKind::Strobe, ..EffectCfg::default() };
        assert!(!clamp_effect(&mut strobe, &c, &none));
        let perks: BTreeSet<String> = ["strobe".to_string()].into_iter().collect();
        assert!(clamp_effect(&mut strobe, &c, &perks));
        // The cone is the same deal under its own perk.
        let mut cone = EffectCfg { kind: crate::layers::EffectKind::Cone, ..EffectCfg::default() };
        assert!(!clamp_effect(&mut cone, &c, &perks));
        let perks: BTreeSet<String> = ["cone".to_string()].into_iter().collect();
        assert!(clamp_effect(&mut cone, &c, &perks));
        // NaN never reaches the engine.
        let mut nan = EffectCfg { intensity: f32::NAN, angle: f32::INFINITY, ..EffectCfg::default() };
        assert!(clamp_effect(&mut nan, &c, &none));
        assert!(nan.intensity.is_finite() && nan.angle == 0.0);
    }

    #[test]
    fn strokes_are_bounded_and_big_brush_raises_the_cap() {
        let c = cfg();
        let none = BTreeSet::new();
        assert_eq!(clamp_paint(0.9, 3.0, &c, &none), (MAX_DAB_SIZE, 1.0));
        let perks: BTreeSet<String> = ["big_brush".to_string()].into_iter().collect();
        assert_eq!(clamp_paint(0.9, 1.0, &c, &perks), (MAX_DAB_SIZE_BIG_BRUSH, 1.0));
        assert_eq!(clamp_paint(f32::NAN, f32::NAN, &c, &none), (0.12, 1.0));
    }

    #[test]
    fn public_ids_are_namespaced() {
        assert!(valid_client_id("pub-5f1c4a2e-9b4d-4c3e-8f1a-2b3c4d5e6f70"));
        assert!(!valid_client_id("client-5f1c4a2e"));
        assert!(!valid_client_id("pub-"));
        assert!(!valid_client_id("pub-has space"));
        assert!(!valid_client_id(&format!("pub-{}", "x".repeat(200))));
    }

    #[test]
    fn keys_redeem_until_spent_and_disabled_keys_do_not_exist() {
        let mut c = cfg();
        c.keys = vec![key("camp", "FIREFLY", &["draw", "big_brush"], 2), key("off", "SECRET", &["knobs"], 0)];
        c.keys[1].enabled = false;
        assert_eq!(find_key(&c, "nope").err(), Some(RedeemError::Unknown));
        assert_eq!(find_key(&c, "SECRET").err(), Some(RedeemError::Unknown));
        assert_eq!(find_key(&c, "firefly").err(), Some(RedeemError::Unknown), "case-sensitive");
        assert_eq!(find_key(&c, "abc").err(), Some(RedeemError::Unknown), "too short to be a key");
        let found = find_key(&c, " FIREFLY ").unwrap();
        assert_eq!(found.id, "camp");
        let r = spend_use(&mut c, "camp").unwrap();
        assert_eq!(r.perks, vec!["draw", "big_brush"]);
        assert!(r.flourish);
        assert!(spend_use(&mut c, "camp").is_some());
        assert_eq!(c.keys[0].uses, 2);
        assert_eq!(find_key(&c, "FIREFLY").err(), Some(RedeemError::Exhausted));
        assert!(spend_use(&mut c, "camp").is_none());
    }

    #[test]
    fn a_settings_write_cannot_reset_redemption_counters() {
        let mut current = cfg();
        current.keys = vec![key("camp", "FIREFLY", &["draw"], 0)];
        current.keys[0].uses = 7;
        let mut incoming = cfg();
        incoming.keys = vec![key("camp", "CHANGED", &["draw", "effects"], 0), key("new", "FRESH", &[], 0)];
        incoming.keys[0].uses = 0;
        incoming.keys[1].uses = 99;
        preserve_key_uses(&current, &mut incoming);
        assert_eq!(incoming.keys[0].uses, 7);
        assert_eq!(incoming.keys[0].secret, "CHANGED");
        assert_eq!(incoming.keys[1].uses, 0);
    }

    #[test]
    fn registry_caps_connections_and_per_ip() {
        let mut c = cfg();
        c.max_connections = 3;
        c.max_per_ip = 2;
        let mut r = Registry::default();
        let a: IpAddr = "198.51.100.1".parse().unwrap();
        let b: IpAddr = "198.51.100.2".parse().unwrap();
        assert!(r.reserve(1, a, &c).is_ok());
        assert!(r.reserve(2, a, &c).is_ok());
        assert_eq!(r.reserve(3, a, &c), Err(Refusal::TooManyFromIp));
        assert!(r.reserve(4, b, &c).is_ok());
        assert_eq!(r.reserve(5, b, &c), Err(Refusal::Full));
        assert_eq!(r.refused_full, 1);
        assert_eq!(r.peak, 3);
        r.release(1);
        assert!(r.reserve(6, a, &c).is_ok());
        r.release(2);
        r.release(4);
        r.release(6);
        assert_eq!(r.connections(), 0);
    }

    #[test]
    fn block_kicks_the_id_and_its_addresses_and_unblock_undoes_both() {
        let c = cfg();
        let now = Instant::now();
        let mut r = Registry::default();
        let ip: IpAddr = "198.51.100.1".parse().unwrap();
        let other: IpAddr = "198.51.100.2".parse().unwrap();
        r.reserve(1, ip, &c).unwrap();
        r.admit(1, "pub-a", "Dusty Badger", now).unwrap();
        r.reserve(2, other, &c).unwrap();
        r.admit(2, "pub-b", "Neon Raven", now).unwrap();
        assert_eq!(r.block("pub-a"), 1);
        assert!(r.is_blocked(1));
        assert!(!r.is_blocked(2));
        // The same phone back with a fresh id from the same address: still out.
        r.release(1);
        assert_eq!(r.reserve(3, ip, &c), Err(Refusal::Blocked));
        // Another phone that shares the address is blocked too — that is the
        // trade the Block button makes, and unblock gives it back.
        r.unblock("pub-a");
        assert!(r.reserve(3, ip, &c).is_ok());
        assert!(r.admit(3, "pub-a", "Dusty Badger", now).is_ok());
        assert_eq!(r.blocked_ids(), Vec::<String>::new());
    }

    #[test]
    fn blocked_id_is_refused_at_hello_even_from_a_new_address() {
        let c = cfg();
        let now = Instant::now();
        let mut r = Registry::default();
        r.reserve(1, "198.51.100.1".parse().unwrap(), &c).unwrap();
        r.admit(1, "pub-a", "x", now).unwrap();
        r.block("pub-a");
        r.release(1);
        r.reserve(2, "198.51.100.50".parse().unwrap(), &c).unwrap();
        assert_eq!(r.admit(2, "pub-a", "x", now), Err(Refusal::Blocked));
    }

    #[test]
    fn blocklist_is_bounded() {
        let mut r = Registry::default();
        for i in 0..(MAX_BLOCKLIST + 10) {
            r.push_block(Some(format!("pub-{i}")), None);
        }
        assert_eq!(r.blocked_ids.len(), MAX_BLOCKLIST);
        assert!(!r.blocked_ids.contains("pub-0"));
        assert!(r.blocked_ids.contains(&format!("pub-{}", MAX_BLOCKLIST + 9)));
    }

    #[test]
    fn status_lists_recent_players_first_and_counts_the_rest() {
        let c = cfg();
        let t0 = Instant::now();
        let mut r = Registry::default();
        for i in 0..(ROSTER_LIMIT + 5) {
            let ip: IpAddr = format!("198.51.{}.{}", i / 200, i % 200 + 1).parse().unwrap();
            r.reserve(i as u64, ip, &c).unwrap();
            r.admit(i as u64, &format!("pub-{i}"), &format!("p{i}"), t0).unwrap();
        }
        r.note_input(3, "draw", t0 + Duration::from_secs(5));
        let st = r.status(&c, true, "", t0 + Duration::from_secs(10));
        assert_eq!(st.players as usize, ROSTER_LIMIT + 5);
        assert_eq!(st.roster.len(), ROSTER_LIMIT);
        assert_eq!(st.roster_truncated, 5);
        assert_eq!(st.roster[0].id, "pub-3");
        assert_eq!(st.roster[0].last_input.as_deref(), Some("draw"));
        assert!((st.roster[0].last_input_secs.unwrap() - 5.0).abs() < 0.01);
        assert!(st.listening);
    }

    #[test]
    fn secret_comparison_is_exact() {
        assert!(secret_matches("abc", "abc"));
        assert!(!secret_matches("abc", "abd"));
        assert!(!secret_matches("abc", "abcd"));
        assert!(!secret_matches("", "a"));
    }
}
