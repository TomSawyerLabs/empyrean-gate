//! The follower/backup half of networked redundancy (plans/network-follower.md).
//!
//! When `peer.follow` names a leader, this task dials its WebSocket and
//! mirrors the show: adopting the leader's config (selectively — machine-local
//! facts stay local, see `config::adopt_show_config`), its layer phases, and
//! its active patch, while `peer_hold` keeps our own sACN output silent. The
//! result is a warm spare: GPU rendering the same show, sACN plan built for
//! the same universes under the leader's own persistent CID.
//!
//! With `peer.act_as_backup` on (and the leader's `peer.allow_backup`
//! granting it), losing the leader promotes that spare to the transmitter:
//! when pulses stop for `watchdog_ms` AND the shared CID has gone silent on
//! the wire, we continue the stream with `resume_after` — to every receiver
//! it is the same source that carried on. A leader that is alive but
//! unreachable over the control link (a partition, not a death) keeps
//! transmitting, we keep hearing its packets, and we deliberately never
//! preempt it.
//!
//! The leader always wins. A transmitting backup that hears the shared CID
//! from another machine, or whose reconnected leader reports transmitting,
//! yields SILENTLY (no E1.31 termination — the stream continues over there)
//! and goes back to standing by. The orderly path is the two-phase reclaim
//! (`ServerMsg::PeerReclaim`), the network mirror of the local takeover.
//!
//! Messages are hand-built/`Value`-parsed JSON rather than typed structs on
//! purpose: `ClientMsg` only derives Deserialize and `ServerMsg` only
//! Serialize (each end owns one direction), and a loose parse also tolerates
//! version skew between leader and backup across self-updates.

use crate::state::SharedState;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

/// How recently the shared CID must have been heard on the wire to count as
/// "the leader is alive out there". Data packets arrive at frame rate, so
/// even one lost 250 ms window leaves plenty of margin inside this.
const WIRE_LIVE_MS: u64 = 1500;
/// Dial/redial cadence while the leader is unreachable.
const REDIAL: Duration = Duration::from_secs(1);
/// Longer hold after an explicit denial (bad/rotated token, revoked id) —
/// hammering a leader that said no is noise, and the operator has to act.
const DENIED_BACKOFF: Duration = Duration::from_secs(10);
/// The housekeeping tick inside a live session.
const TICK: Duration = Duration::from_millis(250);

pub fn spawn(state: Arc<SharedState>) {
    std::thread::Builder::new()
        .name("peer".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("peer tokio runtime");
            rt.block_on(run(state));
        })
        .expect("spawn peer thread");
}

/// Everything the follower knows about its leader, across reconnects.
#[derive(Default)]
struct Link {
    /// Last `peer_pulse` arrival and payload.
    last_pulse: Option<Instant>,
    last_sequence: Option<u8>,
    leader_transmitting: bool,
    /// The leader granted the backup role (`peer_welcome.backup`).
    backup_granted: bool,
    leader_version: String,
    /// We are transmitting as the backup — the leader is lost.
    transmitting: bool,
    /// We yielded because the shared CID reappeared on the wire without a
    /// reclaim — bannered until the link looks orderly again.
    split_brain: bool,
}

/// The takeover decision, kept pure for tests: seize transmission only when
/// the backup role is armed, the mirrored show actually wants output, the
/// control link has been silent past the watchdog, and the shared CID is NOT
/// being transmitted by anyone (a partitioned-but-alive leader keeps the
/// wire alive and must never be preempted).
fn should_take_over(
    armed: bool,
    output_enabled: bool,
    last_pulse_age_ms: Option<u64>,
    watchdog_ms: u64,
    wire_live: bool,
) -> bool {
    if !armed || !output_enabled || wire_live {
        return false;
    }
    // No pulse ever heard means there is nothing to take over: a backup must
    // never start a show on its own, only continue one it watched run.
    last_pulse_age_ms.is_some_and(|age| age >= watchdog_ms)
}

async fn run(state: Arc<SharedState>) {
    let mut link = Link {
        // A predecessor instance may have handed us an in-flight backup
        // transmission (self-update mid-failover) — lib.rs set this flag from
        // the handover grant before spawning us.
        transmitting: state.peer_transmitting.load(Ordering::SeqCst),
        ..Link::default()
    };
    let mut had_role = false;

    while !state.shutdown.load(Ordering::Relaxed) {
        let peer_cfg = state.config.read().peer.clone();
        let Some((host, port)) = peer_cfg.leader_addr() else {
            // Not following anyone. Release the hold and clear our status
            // once, so switching the role off in Settings takes effect live.
            if had_role {
                had_role = false;
                link = Link::default();
                state.peer_hold.store(false, Ordering::SeqCst);
                state.peer_transmitting.store(false, Ordering::SeqCst);
                state.status.lock().peer = Default::default();
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
            continue;
        };
        had_role = true;
        // Standing by = silent. (Re-asserted here, not only at startup, so a
        // takeover that later yields goes straight back to holding.)
        state.peer_hold.store(!link.transmitting, Ordering::SeqCst);
        state
            .peer_transmitting
            .store(link.transmitting, Ordering::SeqCst);

        let leader = format!("{host}:{port}");
        publish_status(&state, &link, &leader, false, "Connecting to the leader…");

        let url = format!("ws://{leader}/ws");
        let connect = tokio::time::timeout(
            Duration::from_secs(4),
            tokio_tungstenite::connect_async(&url),
        )
        .await;
        match connect {
            Ok(Ok((socket, _))) => {
                let outcome = session(&state, socket, &peer_cfg, &leader, &mut link).await;
                if outcome == SessionEnd::Denied {
                    publish_status(
                        &state,
                        &link,
                        &leader,
                        false,
                        "The leader refused this instance — check the join token in Settings → Redundancy.",
                    );
                    tokio::time::sleep(DENIED_BACKOFF).await;
                    continue;
                }
                log::info!("peer: link to {leader} closed");
            }
            Ok(Err(e)) => log::debug!("peer: cannot reach {leader}: {e}"),
            Err(_) => log::debug!("peer: connection to {leader} timed out"),
        }

        // Disconnected. This is where a dead leader is detected and covered.
        maybe_take_over(&state, &mut link, &peer_cfg, &leader);
        watch_split_brain(&state, &mut link, &leader);
        let detail = if link.transmitting {
            "TRANSMITTING as backup — leader lost. Reconnecting…"
        } else if state.own_cid_heard_within(WIRE_LIVE_MS) {
            "Leader unreachable on the control link but still transmitting; standing by."
        } else {
            "Leader unreachable. Reconnecting…"
        };
        publish_status(&state, &link, &leader, false, detail);
        tokio::time::sleep(REDIAL).await;
    }
}

#[derive(PartialEq)]
enum SessionEnd {
    Closed,
    Denied,
    ConfigChanged,
}

type PeerSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// One live connection to the leader: mirror state, answer reclaims, watch
/// the watchdog. Returns when the socket drops or the peer config changes.
async fn session(
    state: &Arc<SharedState>,
    mut socket: PeerSocket,
    peer_cfg: &crate::config::PeerConfig,
    leader: &str,
    link: &mut Link,
) -> SessionEnd {
    let hello = serde_json::json!({
        "type": "hello",
        "name": format!("Backup ({})", hostname()),
        "client_id": peer_client_id(),
        "token": peer_cfg.follow_token,
    });
    let follow = serde_json::json!({
        "type": "peer_follow",
        "backup": peer_cfg.act_as_backup,
        "version": crate::updater::effective_version(),
    });
    for msg in [hello, follow] {
        if socket
            .send(Message::Text(msg.to_string().into()))
            .await
            .is_err()
        {
            return SessionEnd::Closed;
        }
    }
    if send_peer_status(&mut socket, link).await.is_err() {
        return SessionEnd::Closed;
    }
    log::info!("peer: connected to leader {leader}");

    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut ticks: u64 = 0;
    // The config fields whose change requires a fresh session (re-hello).
    let session_key = (
        peer_cfg.follow.clone(),
        peer_cfg.follow_token.clone(),
        peer_cfg.act_as_backup,
    );

    loop {
        tokio::select! {
            msg = socket.next() => {
                let Some(Ok(msg)) = msg else { return SessionEnd::Closed };
                let Message::Text(text) = msg else { continue }; // previews are binary; we never subscribe
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
                match v["type"].as_str().unwrap_or_default() {
                    "state" => adopt_state(state, &mut socket, &v).await,
                    "peer_welcome" => {
                        link.backup_granted = v["backup"].as_bool().unwrap_or(false);
                        link.leader_version = v["version"].as_str().unwrap_or_default().to_string();
                        let ours = crate::updater::effective_version();
                        if !link.leader_version.is_empty() && link.leader_version != ours {
                            log::warn!(
                                "peer: version skew — leader v{} vs our v{ours}; \
                                 state mirroring is tolerant, but matching them is wise",
                                link.leader_version
                            );
                        }
                    }
                    "peer_pulse" => {
                        link.last_pulse = Some(Instant::now());
                        link.last_sequence = v["sacn_sequence"].as_u64().map(|s| s as u8);
                        let leader_tx = v["transmitting"].as_bool().unwrap_or(false);
                        link.leader_transmitting = leader_tx;
                        if leader_tx && link.transmitting {
                            // Both ends transmitting the same CID: the leader
                            // always wins. Yield silently right now; the
                            // orderly reclaim would have avoided this, so
                            // flag it for the operator too.
                            yield_transmission(state, link, "the leader is transmitting again");
                            link.split_brain = true;
                            let _ = send_peer_status(&mut socket, link).await;
                        }
                        if !link.transmitting {
                            // Track the leader's animation so our preview (and
                            // any takeover) continues its motion, not our own.
                            if let Some(phases) = v["layer_phases"].as_array() {
                                let phases: Vec<f64> =
                                    phases.iter().filter_map(|p| p.as_f64()).collect();
                                *state.layer_phases.lock() = phases;
                                state.phases_transplanted.store(true, Ordering::SeqCst);
                            }
                        }
                    }
                    "peer_reclaim" => {
                        let commit = v["commit"].as_bool().unwrap_or(false);
                        if handle_reclaim(state, &mut socket, link, commit).await.is_err() {
                            return SessionEnd::Closed;
                        }
                    }
                    "denied" => {
                        log::error!(
                            "peer: leader denied us: {}",
                            v["reason"].as_str().unwrap_or("(no reason)")
                        );
                        return SessionEnd::Denied;
                    }
                    "patch" => save_mirrored_patch(state, &v),
                    // status/beat/role/etc. — a UI's diet, not ours.
                    _ => {}
                }
            }
            _ = tick.tick() => {
                ticks += 1;
                {
                    let cfg = state.config.read().peer.clone();
                    if (cfg.follow.clone(), cfg.follow_token.clone(), cfg.act_as_backup) != session_key {
                        log::info!("peer: redundancy settings changed; reconnecting");
                        return SessionEnd::ConfigChanged;
                    }
                }
                state.peer_hold.store(!link.transmitting, Ordering::SeqCst);
                state.peer_transmitting.store(link.transmitting, Ordering::SeqCst);
                watch_split_brain(state, link, leader);
                // Connected + orderly clears a past split-brain flag.
                if !link.transmitting && !state.own_cid_heard_within(WIRE_LIVE_MS) {
                    link.split_brain = false;
                }
                if ticks % 4 == 0
                    && send_peer_status(&mut socket, link).await.is_err() {
                        return SessionEnd::Closed;
                    }
                let detail = if link.transmitting {
                    "TRANSMITTING as backup — waiting for the leader to reclaim."
                } else if link.split_brain {
                    "Yielded to another transmitter of our identity — standing by."
                } else if armed(state, link) {
                    "Following the leader; armed as its backup transmitter."
                } else {
                    "Following the leader."
                };
                publish_status(state, link, leader, true, detail);
            }
        }
    }
}

/// The backup role is live: the leader granted it and we still want it.
fn armed(state: &SharedState, link: &Link) -> bool {
    link.backup_granted && state.config.read().peer.act_as_backup
}

/// Adopt a `state` broadcast from the leader: the show halves of its config,
/// and the active patch document if we don't hold it yet.
async fn adopt_state(state: &Arc<SharedState>, socket: &mut PeerSocket, v: &serde_json::Value) {
    let Ok(remote) = serde_json::from_value::<crate::config::AppConfig>(v["config"].clone()) else {
        log::warn!("peer: leader state did not parse as a config; skipping");
        return;
    };
    let (candidate, current) = {
        let local = state.config.read();
        let mut candidate = local.clone();
        crate::config::adopt_show_config(&mut candidate, remote);
        (candidate, local.clone())
    };
    // Only write (disk + broadcast) when the show actually changed. Compare as
    // JSON: AppConfig deliberately does not implement PartialEq.
    let changed = serde_json::to_value(&candidate).ok() != serde_json::to_value(&current).ok();
    if changed {
        let adopted = candidate.clone();
        state.update_config(move |c| *c = adopted);
        log::info!("peer: adopted the leader's show state");
    }
    // Mirror the active patch's document too — an id referencing a file that
    // only exists on the leader would leave the engine with nothing to render.
    if let Some(id) = candidate.active_patch.clone()
        && crate::patch::store::load(&crate::patch::store::patches_dir(), &id).is_err()
    {
        let get = serde_json::json!({ "type": "patch_get", "id": id });
        let _ = socket.send(Message::Text(get.to_string().into())).await;
    }
}

/// A `patch` reply for the active patch we asked for: store it locally so the
/// engine can compile it.
fn save_mirrored_patch(state: &Arc<SharedState>, v: &serde_json::Value) {
    let Ok(mut doc) = serde_json::from_value::<crate::patch::PatchDoc>(v["patch"].clone()) else {
        log::warn!("peer: leader patch did not parse; skipping");
        return;
    };
    match crate::patch::store::save(&crate::patch::store::patches_dir(), &mut doc) {
        Ok(_) => {
            state.patch_epoch.fetch_add(1, Ordering::SeqCst);
            log::info!("peer: mirrored the leader's active patch");
        }
        Err(e) => log::warn!("peer: cannot store mirrored patch: {e}"),
    }
}

/// Answer the leader's two-phase reclaim. Phase 1 (`commit: false`) is a
/// side-effect-free snapshot; phase 2 quiesces our transmission SILENTLY (the
/// stream continues on the leader) and hands over the final sequence number.
async fn handle_reclaim(
    state: &Arc<SharedState>,
    socket: &mut PeerSocket,
    link: &mut Link,
    commit: bool,
) -> Result<(), ()> {
    if commit && link.transmitting {
        state.sacn_silent_stop.store(true, Ordering::SeqCst);
        state.peer_hold.store(true, Ordering::SeqCst);
        link.transmitting = false;
        state.peer_transmitting.store(false, Ordering::SeqCst);
        // Two rendered frames past the hold: the engine's send gate has
        // provably run with it, so the sequence below is our last word.
        wait_frames(state, 2, Duration::from_millis(500)).await;
        log::info!("peer: yielded transmission back to the leader (reclaim commit)");
    }
    let grant = crate::protocol::HandoverGrant {
        config: state.config.read().clone(),
        layer_phases: state.layer_phases.lock().clone(),
        sacn_sequence: Some(state.sacn_sequence.load(Ordering::Relaxed)),
        backup_transmitting: link.transmitting,
    };
    let reply = serde_json::json!({
        "type": "peer_grant",
        "grant": grant,
        "commit": commit,
    });
    socket
        .send(Message::Text(reply.to_string().into()))
        .await
        .map_err(|_| ())
}

/// Evaluate the watchdog while disconnected, and seize transmission when the
/// leader is provably gone (see `should_take_over`).
fn maybe_take_over(
    state: &Arc<SharedState>,
    link: &mut Link,
    peer_cfg: &crate::config::PeerConfig,
    leader: &str,
) {
    if link.transmitting {
        return;
    }
    let output_enabled = state.config.read().output.enabled;
    let armed = link.backup_granted && peer_cfg.act_as_backup;
    let age = link.last_pulse.map(|t| t.elapsed().as_millis() as u64);
    if should_take_over(
        armed,
        output_enabled,
        age,
        peer_cfg.watchdog_ms as u64,
        state.own_cid_heard_within(WIRE_LIVE_MS),
    ) {
        if let Some(seq) = link.last_sequence {
            state.sacn_resume_sequence.store(seq, Ordering::SeqCst);
            state.sacn_resume_pending.store(true, Ordering::SeqCst);
        }
        link.transmitting = true;
        link.split_brain = false;
        state.peer_transmitting.store(true, Ordering::SeqCst);
        state.peer_hold.store(false, Ordering::SeqCst);
        log::warn!(
            "peer: LEADER LOST ({leader}: no pulse for {} ms, its stream silent on the wire) — \
             taking over transmission as the backup",
            age.unwrap_or(0)
        );
    }
}

/// While transmitting, retreat the moment the shared CID is heard from
/// another machine: the leader (or something wearing its identity) is back,
/// and two interleaved sequence counters on one CID make receivers drop
/// whichever is behind. Losing our output beats corrupting theirs.
fn watch_split_brain(state: &Arc<SharedState>, link: &mut Link, leader: &str) {
    if link.transmitting && state.own_cid_heard_within(WIRE_LIVE_MS) {
        let from = state.own_cid_heard_from.lock().clone();
        yield_transmission(
            state,
            link,
            &format!("our CID reappeared on the wire from {from}"),
        );
        link.split_brain = true;
        log::warn!("peer: split brain with {leader} averted — yielded to {from}");
    }
}

fn yield_transmission(state: &SharedState, link: &mut Link, why: &str) {
    if !link.transmitting {
        return;
    }
    log::warn!("peer: stopping backup transmission — {why}");
    state.sacn_silent_stop.store(true, Ordering::SeqCst);
    state.peer_hold.store(true, Ordering::SeqCst);
    state.peer_transmitting.store(false, Ordering::SeqCst);
    link.transmitting = false;
}

async fn send_peer_status(socket: &mut PeerSocket, link: &Link) -> Result<(), ()> {
    let msg = serde_json::json!({
        "type": "peer_status",
        "armed": link.backup_granted,
        "transmitting": link.transmitting,
    });
    socket
        .send(Message::Text(msg.to_string().into()))
        .await
        .map_err(|_| ())
}

fn publish_status(state: &SharedState, link: &Link, leader: &str, connected: bool, detail: &str) {
    let mut status = state.status.lock();
    status.peer = crate::protocol::PeerStatusInfo {
        role: "follower".into(),
        connected,
        armed: link.backup_granted && state_config_act_as_backup(state),
        transmitting: link.transmitting,
        peer_name: leader.to_string(),
        peer_version: link.leader_version.clone(),
        last_seen_ms: link
            .last_pulse
            .map(|t| t.elapsed().as_secs_f32() * 1000.0)
            .unwrap_or(-1.0),
        split_brain: link.split_brain,
        detail: detail.to_string(),
    };
}

fn state_config_act_as_backup(state: &SharedState) -> bool {
    state.config.read().peer.act_as_backup
}

/// Async twin of `lib.rs::wait_frames`.
async fn wait_frames(state: &SharedState, n: u64, timeout: Duration) {
    let base = state.frames_rendered.load(Ordering::Relaxed);
    let start = Instant::now();
    while state.frames_rendered.load(Ordering::Relaxed) < base + n && start.elapsed() < timeout {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// A stable per-machine client id, so the leader remembers one device record
/// for this backup across every reconnect. NOT derived from the sACN CID —
/// following adopts the leader's CID, which would collide.
fn peer_client_id() -> String {
    format!("peer-{}", sanitize_id(&hostname()))
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "backup".into())
}

fn sanitize_id(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "backup".into()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takeover_needs_every_condition() {
        // The green path: armed, show wants output, watchdog expired, wire silent.
        assert!(should_take_over(true, true, Some(2500), 2000, false));

        // Any missing condition keeps us silent.
        assert!(
            !should_take_over(false, true, Some(2500), 2000, false),
            "not armed"
        );
        assert!(
            !should_take_over(true, false, Some(2500), 2000, false),
            "output off"
        );
        assert!(
            !should_take_over(true, true, Some(1500), 2000, false),
            "watchdog not expired"
        );
        assert!(
            !should_take_over(true, true, Some(60_000), 2000, true),
            "a partitioned-but-alive leader keeps its stream; never preempt it"
        );
        assert!(
            !should_take_over(true, true, None, 2000, false),
            "never seen a pulse: there is no show to continue"
        );
    }

    #[test]
    fn peer_client_ids_are_hello_safe() {
        for raw in ["Show PC #2", "", "café", "ok-name_1.local"] {
            let id = format!("peer-{}", sanitize_id(raw));
            assert!(!id.is_empty() && id.len() <= 128);
            assert!(
                id.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')),
                "{id:?} must satisfy the server's hello identity rules"
            );
        }
    }
}
