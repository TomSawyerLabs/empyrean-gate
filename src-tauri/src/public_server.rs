//! The public floor's listener: a second axum server, built to sit behind a
//! reverse proxy and be reached from the internet. It serves the public page
//! and a WebSocket that speaks the same JSON protocol as the operator
//! listener — but through `public::gate`'s allowlist, under per-connection
//! rate limits, with ephemeral in-memory sessions, and with no notion of a
//! privileged peer address. Nothing here can reach show control.
//!
//! Started, stopped, and re-bound live by [`supervise`], which follows
//! `config.public` (Settings → Public floor) so opening the floor never needs
//! a restart. The rules it applies live in `public.rs`; the threat model is in
//! `plans/public-floor.md`.

use crate::protocol::{ClientMsg, PublicSnapshot, ServerMsg};
use crate::public::{self, Gate, Refusal};
use crate::server::{Assets, PreviewSub, WsSink, decimated_count, encode_preview, mime_for, send_json};
use crate::state::SharedState;
use axum::Router;
use axum::extract::connect_info::ConnectInfo;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use std::collections::BTreeSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::watch;

#[derive(Clone)]
struct Ctx {
    state: Arc<SharedState>,
    /// Flipped when the listener is being taken down (disabled or re-bound);
    /// every connection task closes its socket.
    stop: watch::Receiver<bool>,
}

struct Running {
    bind: String,
    port: u16,
    stop: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

/// Follow `config.public`: bind when enabled, close when disabled, re-bind
/// when the address changes. A bind failure is reported in status and
/// retried every second (the port may be held by a previous instance that is
/// still exiting after a handover).
pub async fn supervise(state: Arc<SharedState>) {
    let mut running: Option<Running> = None;
    let mut bind_failures = 0u32;
    loop {
        if state.shutdown.load(Ordering::Relaxed) {
            if let Some(r) = running.take() {
                stop(r).await;
            }
            state.public_listening.store(false, Ordering::SeqCst);
            return;
        }
        let desired = {
            let cfg = &state.config.read().public;
            cfg.enabled.then(|| (cfg.bind.clone(), cfg.port))
        };
        let keep = match (&running, &desired) {
            (Some(r), Some((bind, port))) => r.bind == *bind && r.port == *port,
            (None, None) => true,
            _ => false,
        };
        if !keep {
            if let Some(r) = running.take() {
                log::info!("public floor listener on {}:{} closing", r.bind, r.port);
                stop(r).await;
                state.public_listening.store(false, Ordering::SeqCst);
            }
            if let Some((bind, port)) = desired.clone() {
                match tokio::net::TcpListener::bind(format!("{bind}:{port}")).await {
                    Ok(listener) => {
                        bind_failures = 0;
                        state.public_error.lock().clear();
                        state.public_listening.store(true, Ordering::SeqCst);
                        log::info!(
                            "public floor listener on http://{bind}:{port} ({})",
                            public::display_bind(&bind)
                        );
                        let (stop_tx, stop_rx) = watch::channel(false);
                        let ctx = Ctx {
                            state: state.clone(),
                            stop: stop_rx.clone(),
                        };
                        let task = tokio::spawn(serve(listener, ctx, stop_rx));
                        running = Some(Running {
                            bind,
                            port,
                            stop: stop_tx,
                            task,
                        });
                    }
                    Err(e) => {
                        bind_failures = bind_failures.saturating_add(1);
                        let message = format!("cannot bind {bind}:{port}: {e}");
                        if bind_failures == 1 || bind_failures.is_power_of_two() {
                            log::error!("public floor listener: {message}; retrying");
                        }
                        *state.public_error.lock() = message;
                    }
                }
            } else {
                state.public_error.lock().clear();
            }
        } else if let Some(r) = &running
            && r.task.is_finished()
        {
            // The serve task died (it should not); let the next tick rebind.
            log::warn!("public floor listener task ended unexpectedly; restarting");
            running = None;
            state.public_listening.store(false, Ordering::SeqCst);
        }
        // A game the floor started and then abandoned stops itself here —
        // whether or not the listener is up, so disabling the floor does not
        // strand its game either.
        state.expire_floor_game(public::FLOOR_GAME_IDLE);
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn stop(r: Running) {
    let _ = r.stop.send(true);
    // Connection tasks close on the signal; the server itself finishes once
    // they have. Bound the wait so a stuck socket cannot wedge the supervisor.
    let _ = tokio::time::timeout(Duration::from_secs(3), r.task).await;
}

async fn serve(listener: tokio::net::TcpListener, ctx: Ctx, mut stop: watch::Receiver<bool>) {
    let app = Router::new()
        .route("/", get(public_page))
        .route("/k/{secret}", get(public_page_with_key))
        .route("/health", get(health))
        .route("/ws", get(ws_upgrade))
        .fallback(get(public_asset))
        .with_state(ctx);
    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        while !*stop.borrow() {
            if stop.changed().await.is_err() {
                break;
            }
        }
    });
    if let Err(e) = server.await {
        log::error!("public floor listener error: {e}");
    }
}

/// `GET /health`: the floor is up, and what is on the gate. The site reads
/// it (empyreangate.org's `/api/live`) to show "Play it live" and what is
/// playing. Nothing here is private: whether the floor is open, how many
/// are playing, the running game, the patch on air and who it credits.
async fn health(State(ctx): State<Ctx>) -> Response {
    let (open, active_patch) = {
        let cfg = ctx.state.config.read();
        (cfg.public.open, cfg.active_patch.clone())
    };
    let (game, patch_active) = {
        let st = ctx.state.status.lock();
        (st.game.active, st.patch_active)
    };
    let players = ctx.state.public.lock().sessions_count();
    let now_playing = if patch_active { active_patch.and_then(|id| now_playing(&id)) } else { None };
    (
        [(header::CACHE_CONTROL, "no-store")],
        axum::Json(serde_json::json!({
            "ok": true,
            "open": open,
            "players": players,
            "game": game,
            "now_playing": now_playing,
        })),
    )
        .into_response()
}

/// The patch on air by name and credit, from its file. Held for a few
/// seconds: finding a patch reads the whole library, and the site asks from
/// every edge it answers from.
fn now_playing(id: &str) -> Option<serde_json::Value> {
    use crate::patch::store;
    static CACHE: std::sync::Mutex<Option<(Instant, String, serde_json::Value)>> = std::sync::Mutex::new(None);
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, cached_id, value)) = cache.as_ref()
        && cached_id == id
        && at.elapsed() < Duration::from_secs(5)
    {
        return Some(value.clone());
    }
    let doc = store::load(&store::patches_dir(), id).ok()?;
    let value = serde_json::json!({ "name": doc.name, "credit": doc.credit });
    *cache = Some((Instant::now(), id.to_string(), value.clone()));
    Some(value)
}

/// The public page. `/k/<secret>` serves the same page; the UI reads the key
/// out of its own location.
async fn public_page() -> Response {
    page_response()
}

async fn public_page_with_key(Path(_secret): Path<String>) -> Response {
    page_response()
}

fn page_response() -> Response {
    match Assets::get("public.html") {
        Some(file) => (
            [
                (header::CONTENT_TYPE, mime_for("public.html")),
                (header::CACHE_CONTROL, "no-store"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                (header::REFERRER_POLICY, "no-referrer"),
            ],
            file.data,
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            "The public page is not built into this binary. Run `bun run build` before `cargo build`.",
        )
            .into_response(),
    }
}

/// Only what the public page needs. The operator UI's `index.html` is not
/// served here — not because it would work (its messages would all be
/// refused) but because a surface should not advertise controls it does not
/// have.
fn public_asset_allowed(path: &str) -> bool {
    matches!(
        path,
        "public.html"
            | "play.webmanifest"
            | "sw.js"
            | "pwa-192.png"
            | "pwa-512.png"
            | "apple-touch-icon.png"
            | "favicon.ico"
    ) || (path.starts_with("assets/") && !path.contains(".."))
}

async fn public_asset(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if !public_asset_allowed(path) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match Assets::get(path) {
        Some(file) => {
            // Vite content-hashes everything under assets/, so those are
            // immutable; the rest is small and revalidates.
            let cache = if path.starts_with("assets/") {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            (
                [
                    (header::CONTENT_TYPE, mime_for(path)),
                    (header::CACHE_CONTROL, cache),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                file.data,
            )
                .into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn ws_upgrade(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !public::origin_allowed(&headers) {
        return (StatusCode::FORBIDDEN, "cross-origin WebSocket refused").into_response();
    }
    let cfg = ctx.state.config.read().public.clone();
    let ip = public::client_ip(addr, &headers, cfg.trust_forwarded_headers);
    let conn_id = ctx.state.conn_seq.fetch_add(1, Ordering::SeqCst);
    if let Err(refusal) = ctx.state.public.lock().reserve(conn_id, ip, &cfg) {
        return match refusal {
            Refusal::Full => (
                StatusCode::SERVICE_UNAVAILABLE,
                [(header::RETRY_AFTER, "15")],
                refusal.message(),
            )
                .into_response(),
            Refusal::TooManyFromIp => (StatusCode::TOO_MANY_REQUESTS, refusal.message()).into_response(),
            Refusal::Blocked => (StatusCode::FORBIDDEN, refusal.message()).into_response(),
        };
    }
    ws.max_message_size(public::MAX_TEXT_FRAME)
        .max_frame_size(public::MAX_TEXT_FRAME)
        .on_upgrade(move |socket| client_task(ctx, socket, conn_id, ip))
}

/// What one public connection does after the upgrade. Mirrors the operator
/// listener's loop in shape (hello first, preview fan-out, live revocation)
/// but with its own gates, and it never subscribes to `state.events`: a
/// public phone gets a 1 Hz snapshot of its own world, not the show's
/// broadcasts.
async fn client_task(ctx: Ctx, socket: WebSocket, conn_id: u64, ip: IpAddr) {
    let state = ctx.state.clone();
    let mut stop = ctx.stop.clone();
    let (mut tx, mut rx) = socket.split();
    let mut preview_rx = state.preview.subscribe();
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let started = Instant::now();
    let mut last_rx = started;
    let mut authenticated = false;
    let mut limiter = public::message_limiter(&state.config.read().public, started);
    let mut unlock_limiter = public::unlock_limiter(started);
    let mut strikes = 0u32;
    let mut preview: Option<PreviewSub> = None;
    let mut announced_meta = (0u32, 0u32, 0u32);
    let mut last_snapshot = String::new();

    loop {
        tokio::select! {
            msg = rx.next() => {
                let Some(Ok(msg)) = msg else { break };
                let now = Instant::now();
                last_rx = now;
                match msg {
                    Message::Text(text) => {
                        if !limiter.try_take(now) {
                            // Over the rate: dropped, counted, never answered
                            // (an answer per dropped message is itself a flood).
                            if let Some(s) = state.public.lock().session_mut(conn_id) {
                                s.dropped = s.dropped.saturating_add(1);
                            }
                            continue;
                        }
                        let parsed = serde_json::from_str::<ClientMsg>(&text);
                        let Ok(m) = parsed else {
                            strikes += 1;
                            if strikes > public::STRIKE_LIMIT {
                                let _ = deny(&mut tx, "Too many bad messages.").await;
                                break;
                            }
                            let _ = send_json(&mut tx, &ServerMsg::Error { message: "bad message".into() }).await;
                            continue;
                        };
                        let is_hello = matches!(&m, ClientMsg::Hello { .. });
                        if !authenticated && !is_hello {
                            let _ = deny(&mut tx, "Say hello first.").await;
                            break;
                        }
                        if authenticated && is_hello {
                            let _ = deny(&mut tx, "This connection already said hello.").await;
                            break;
                        }
                        let mut flow = Flow {
                            preview: &mut preview,
                            announced_meta: &mut announced_meta,
                            unlock_limiter: &mut unlock_limiter,
                            strikes: &mut strikes,
                        };
                        if handle(&ctx, m, conn_id, &mut flow, &mut tx).await.is_err() {
                            break;
                        }
                        if is_hello {
                            authenticated = true;
                            let snap = snapshot(&state, conn_id);
                            last_snapshot = serde_json::to_string(&snap).unwrap_or_default();
                            if send_json(&mut tx, &ServerMsg::PublicState { state: Box::new(snap) }).await.is_err() {
                                break;
                            }
                        }
                    }
                    Message::Binary(_) => {
                        // Nothing binary is part of the public protocol.
                        strikes += 1;
                        if strikes > public::STRIKE_LIMIT {
                            let _ = deny(&mut tx, "Too many bad messages.").await;
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            _ = tick.tick() => {
                if !authenticated {
                    if started.elapsed() > public::HELLO_DEADLINE {
                        let _ = deny(&mut tx, "No hello.").await;
                        break;
                    }
                    continue;
                }
                if last_rx.elapsed() > public::IDLE_TIMEOUT {
                    let _ = deny(&mut tx, "Disconnected after a long idle — reload to come back.").await;
                    break;
                }
                if state.public.lock().is_blocked(conn_id) {
                    let _ = deny(&mut tx, Refusal::Blocked.message()).await;
                    break;
                }
                // The world as this phone should see it. Only sent when it
                // changed, so an idle floor costs nothing per phone.
                let snap = snapshot(&state, conn_id);
                // A preview stream whose permission went away stops now.
                if preview.is_some() && snap.preview_fps == 0 {
                    preview = None;
                }
                let json = serde_json::to_string(&snap).unwrap_or_default();
                if json != last_snapshot {
                    last_snapshot = json;
                    if send_json(&mut tx, &ServerMsg::PublicState { state: Box::new(snap) }).await.is_err() {
                        break;
                    }
                }
            }
            frame = preview_rx.recv() => {
                if !authenticated { continue; }
                let frame = match frame {
                    Ok(f) => f,
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
                };
                let Some(sub) = preview.as_mut() else { continue };
                if sub.last_sent.elapsed() < sub.min_interval { continue; }
                if !sub.ack_gate_open(false, Instant::now()) { continue; }
                sub.last_sent = Instant::now();
                sub.in_flight = sub.in_flight.saturating_add(1);
                let meta = (frame.spokes, frame.pixels_per_spoke, sub.decimate);
                if meta != announced_meta {
                    announced_meta = meta;
                    let (outer, inner) = {
                        let g = &state.config.read().geometry;
                        (g.outer_radius_ft, g.inner_radius_ft)
                    };
                    let m = ServerMsg::PreviewMeta {
                        spokes: frame.spokes,
                        pixels: decimated_count(frame.pixels_per_spoke, sub.decimate),
                        decimate: sub.decimate,
                        outer_radius_ft: outer,
                        inner_radius_ft: inner,
                    };
                    if send_json(&mut tx, &m).await.is_err() { break; }
                }
                let bytes = encode_preview(&frame, sub.decimate);
                if tx.send(Message::Binary(bytes.into())).await.is_err() { break; }
            }
            _ = stop.changed() => {
                let _ = deny(&mut tx, "The floor is closing.").await;
                break;
            }
        }
    }

    state.public.lock().release(conn_id);
    state.release_touches(public::touch_source(conn_id));
    let _ = ip;
}

/// Per-connection mutable bits `handle` touches, so its signature stays flat.
struct Flow<'a> {
    preview: &'a mut Option<PreviewSub>,
    announced_meta: &'a mut (u32, u32, u32),
    unlock_limiter: &'a mut public::TokenBucket,
    strikes: &'a mut u32,
}

async fn deny(tx: &mut WsSink, reason: &str) -> Result<(), ()> {
    let _ = send_json(
        tx,
        &ServerMsg::Denied {
            reason: reason.into(),
        },
    )
    .await;
    Err(())
}

async fn error(tx: &mut WsSink, message: impl Into<String>) {
    let _ = send_json(
        tx,
        &ServerMsg::Error {
            message: message.into(),
        },
    )
    .await;
}

fn perks_of(state: &SharedState, conn_id: u64) -> BTreeSet<String> {
    state
        .public
        .lock()
        .session(conn_id)
        .map(|s| s.perks.clone())
        .unwrap_or_default()
}

fn name_of(state: &SharedState, conn_id: u64) -> String {
    state
        .public
        .lock()
        .session(conn_id)
        .map(|s| s.name.clone())
        .unwrap_or_else(|| "someone".into())
}

/// A display name the roster and the timeline can show: trimmed, bounded,
/// never empty.
fn clean_name(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect::<String>()
        .trim()
        .to_owned();
    if name.is_empty() { "Someone".into() } else { name }
}

/// The public UI's world, for one session. Locks are taken one at a time:
/// the engine's status tick holds `status` while it reads `public`, so this
/// must never hold `public` while asking for `status`.
pub(crate) fn snapshot(state: &SharedState, conn_id: u64) -> PublicSnapshot {
    let (title, public_cfg, spokes, pixels, inner, outer) = {
        let cfg = state.config.read();
        (
            cfg.output.source_name.clone(),
            cfg.public.clone(),
            cfg.geometry.spokes,
            cfg.geometry.pixels_per_spoke,
            cfg.geometry.inner_radius_ft,
            cfg.geometry.outer_radius_ft,
        )
    };
    let game = state.status.lock().game.clone();
    let (perks, unlocked, you, players) = {
        let reg = state.public.lock();
        let s = reg.session(conn_id);
        (
            s.map(|s| s.perks.clone()).unwrap_or_default(),
            s.map(|s| s.keys.clone()).unwrap_or_default(),
            s.map(|s| s.name.clone()).unwrap_or_default(),
            reg.sessions_count(),
        )
    };
    let caps = public::capabilities(&public_cfg, &perks);
    let (preview_fps, preview_decimate) = public::preview_limits(&public_cfg, &caps);
    let max_dab_size = if perks.contains("big_brush") {
        public::MAX_DAB_SIZE_BIG_BRUSH
    } else {
        public::MAX_DAB_SIZE
    };
    PublicSnapshot {
        title,
        open: public_cfg.open,
        caps,
        perks: perks.into_iter().collect(),
        unlocked,
        players,
        you,
        game,
        spokes,
        pixels,
        inner_radius_ft: inner,
        outer_radius_ft: outer,
        preview_fps,
        preview_decimate,
        max_dab_size,
        patch_touch: state.status.lock().patch_touch,
    }
}

/// Redeem one secret for this session. `quiet` is for keys replayed from the
/// phone's storage on hello: an unknown or spent one is simply not applied.
async fn redeem(state: &SharedState, conn_id: u64, secret: &str, quiet: bool, tx: &mut WsSink) {
    let found = {
        let cfg = state.config.read();
        public::find_key(&cfg.public, secret).map(|k| k.id.clone())
    };
    let id = match found {
        Ok(id) => id,
        Err(e) => {
            if !quiet {
                error(
                    tx,
                    match e {
                        public::RedeemError::Unknown => "That code does not unlock anything.",
                        public::RedeemError::Exhausted => "That code has been used up.",
                    },
                )
                .await;
            }
            return;
        }
    };
    // Already holding it (a reload replays the stored keys): nothing to
    // spend, nothing to announce.
    let already = state
        .public
        .lock()
        .session(conn_id)
        .is_some_and(|s| s.keys.iter().any(|k| k == &id) || s.perks.contains(&format!("key:{id}")));
    if already {
        return;
    }
    let mut redeemed = None;
    state.update_config(|c| {
        redeemed = public::spend_use(&mut c.public, &id);
    });
    let Some(r) = redeemed else {
        if !quiet {
            error(tx, "That code has been used up.").await;
        }
        return;
    };
    {
        let mut reg = state.public.lock();
        if let Some(s) = reg.session_mut(conn_id) {
            s.perks.extend(r.perks.iter().cloned());
            // Remember the id too, so a replayed secret is recognised even
            // if the operator renames the key.
            s.perks.insert(format!("key:{}", r.id));
            s.keys.push(r.name.clone());
        }
    }
    let who = name_of(state, conn_id);
    state.recorder.event(
        "unlock",
        &who,
        serde_json::json!({ "key": r.name, "perks": r.perks }),
    );
    log::info!("public floor: {who} unlocked \"{}\" ({})", r.name, r.perks.join(", "));
    if r.flourish {
        state.trigger_effect(crate::layers::EffectCfg {
            kind: crate::layers::EffectKind::Bloom,
            angle: 0.0,
            radius: 0.0,
            intensity: 1.0,
            size: 1.6,
            hue: -1.0,
            ..crate::layers::EffectCfg::default()
        });
    }
    let _ = send_json(
        tx,
        &ServerMsg::Unlocked {
            name: r.name,
            perks: r.perks,
        },
    )
    .await;
}

async fn handle(ctx: &Ctx, msg: ClientMsg, conn_id: u64, flow: &mut Flow<'_>, tx: &mut WsSink) -> Result<(), ()> {
    let state = &ctx.state;
    let now = Instant::now();
    match public::gate(&msg) {
        Gate::Allow => {}
        Gate::Needs(cap) => {
            let caps = {
                let cfg = state.config.read();
                public::capabilities(&cfg.public, &perks_of(state, conn_id))
            };
            if !caps.has(cap) {
                // Not a strike: the operator may have closed the floor
                // mid-gesture, and the UI's next snapshot will tell it so.
                error(tx, format!("The floor is closed for {cap} right now.")).await;
                return Ok(());
            }
        }
        Gate::HiddenGame(game) => {
            let perks = perks_of(state, conn_id);
            let holds = |kind: crate::game::GameKind| kind.floor_perk().is_some_and(|p| perks.contains(p));
            let allowed = match game {
                Some(kind) => holds(kind),
                None => state.floor_game().is_some_and(holds),
            };
            if !allowed {
                // Not a strike: a stale page may offer a Start its key no
                // longer carries; the next snapshot corrects it.
                error(tx, "That game needs a key.").await;
                return Ok(());
            }
        }
        Gate::Refuse => {
            *flow.strikes += 1;
            if *flow.strikes > public::STRIKE_LIMIT {
                return deny(tx, "Too many messages this floor does not accept.").await;
            }
            error(tx, "Not available on the public floor.").await;
            return Ok(());
        }
    }
    let cfg = state.config.read().public.clone();
    let perks = perks_of(state, conn_id);
    match msg {
        ClientMsg::Hello {
            name,
            client_id,
            surface,
            keys,
            ..
        } => {
            if surface != "public" {
                return deny(
                    tx,
                    "This is the public floor. Open its own page (the public URL), not the operator UI.",
                )
                .await;
            }
            if !public::valid_client_id(&client_id) {
                return deny(tx, "Invalid client identity.").await;
            }
            let name = clean_name(&name);
            let admitted = state.public.lock().admit(conn_id, &client_id, &name, now);
            if let Err(refusal) = admitted {
                return deny(tx, refusal.message()).await;
            }
            for key in keys.iter().take(8) {
                redeem(state, conn_id, key, true, tx).await;
            }
        }
        ClientMsg::GetState => {
            let snap = snapshot(state, conn_id);
            let _ = send_json(tx, &ServerMsg::PublicState { state: Box::new(snap) }).await;
        }
        ClientMsg::SetClientName { name } => {
            let name = clean_name(&name);
            if let Some(s) = state.public.lock().session_mut(conn_id) {
                s.name = name;
            }
        }
        ClientMsg::Unlock { key } => {
            if !flow.unlock_limiter.try_take(now) {
                error(tx, "Too many tries — wait a minute.").await;
                return Ok(());
            }
            redeem(state, conn_id, &key, false, tx).await;
        }
        ClientMsg::TriggerEffect { mut effect } => {
            if !public::clamp_effect(&mut effect, &cfg, &perks) {
                error(tx, "That one needs a key.").await;
                return Ok(());
            }
            let who = name_of(state, conn_id);
            state.recorder.event(
                "effect",
                &who,
                serde_json::json!({
                    "kind": effect.kind,
                    "angle": effect.angle,
                    "radius": effect.radius,
                    "hue": effect.hue,
                    "size": effect.size,
                    "public": true,
                }),
            );
            crate::server::record_performance(state, &ClientMsg::TriggerEffect { effect: effect.clone() }, false);
            state.public.lock().note_input(conn_id, "tap", now);
            state.trigger_effect(effect);
        }
        ClientMsg::Paint {
            pen,
            points,
            hue,
            saturation,
            brightness,
            size,
            intensity,
        } => {
            let (size, intensity) = public::clamp_paint(size, intensity, &cfg, &perks);
            let points: Vec<crate::layers::DabPoint> = points
                .into_iter()
                .rev()
                .take(public::MAX_PAINT_POINTS)
                .rev()
                .filter(|p| p.angle.is_finite() && p.radius.is_finite())
                .map(|p| crate::layers::DabPoint {
                    angle: p.angle,
                    radius: p.radius.clamp(0.0, 1.2),
                    dir: if p.dir.is_finite() { p.dir } else { 0.0 },
                })
                .collect();
            if points.is_empty() {
                return Ok(());
            }
            let hue = if hue.is_finite() { hue } else { -1.0 };
            let saturation = if saturation.is_finite() { saturation.clamp(0.0, 1.0) } else { 0.85 };
            let brightness = if brightness.is_finite() { brightness.clamp(0.0, 1.0) } else { 1.0 };
            let who = name_of(state, conn_id);
            let pen_name = serde_json::to_value(pen)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default();
            state.recorder.paint_event(&who, &pen_name, points.len() as u64, hue, size);
            crate::server::record_performance(
                state,
                &ClientMsg::Paint {
                    pen,
                    points: points.clone(),
                    hue,
                    saturation,
                    brightness,
                    size,
                    intensity,
                },
                false,
            );
            state.public.lock().note_input(conn_id, "draw", now);
            state.paint(pen, &points, hue, saturation, brightness, size, intensity);
        }
        ClientMsg::Touch { points, color } => {
            let points: Vec<empyrean_patch::touch::TouchInput> = points
                .into_iter()
                .take(public::MAX_TOUCH_POINTS)
                .filter(|p| p.angle.is_finite() && p.radius.is_finite())
                .collect();
            if points.is_empty() {
                return Ok(());
            }
            let finite = |v: f32, d: f32| if v.is_finite() { v } else { d };
            let color = empyrean_patch::touch::TouchColor {
                hue: finite(color.hue, -1.0),
                saturation: finite(color.saturation, 0.85).clamp(0.0, 1.0),
                brightness: finite(color.brightness, 1.0).clamp(0.0, 1.0)
                    * cfg.input_level.clamp(0.0, 1.0),
            };
            state.public.lock().note_input(conn_id, "draw", now);
            state.touch(public::touch_source(conn_id), &points, color, Some(public::MAX_PUBLIC_FINGERS));
        }
        ClientMsg::GameInput { species, points } => {
            let points: Vec<crate::layers::DabPoint> = points
                .into_iter()
                .rev()
                .take(public::MAX_GAME_POINTS)
                .rev()
                .filter(|p| p.angle.is_finite() && p.radius.is_finite())
                .collect();
            if points.is_empty() {
                return Ok(());
            }
            let who = name_of(state, conn_id);
            state.recorder.event(
                "game_input",
                &who,
                serde_json::json!({ "species": species, "points": points.len(), "public": true }),
            );
            state.public.lock().note_input(conn_id, "play", now);
            state.game_input(species, &points);
        }
        ClientMsg::GameCommand { command, species } => {
            let who = name_of(state, conn_id);
            state.recorder.event(
                "game_command",
                &who,
                serde_json::json!({ "command": command, "species": species, "public": true }),
            );
            state.public.lock().note_input(conn_id, "game", now);
            state.game_command(command, species);
        }
        ClientMsg::SetGameMode { game, .. } => {
            // A hidden game, by a key holder (the gate above checked the
            // perk). Starting opens with the game's own color count;
            // stopping is only for a game the floor started.
            let who = name_of(state, conn_id);
            let result = match game {
                Some(kind) => state.start_floor_game(kind),
                None => state.stop_floor_game(),
            };
            match result {
                Ok(()) => {
                    state.recorder.event(
                        "game_mode",
                        &who,
                        serde_json::json!({ "game": game, "public": true }),
                    );
                    log::info!(
                        "public floor: {who} {}",
                        match game {
                            Some(kind) => format!("started {}", kind.label()),
                            None => "stopped the game".to_owned(),
                        }
                    );
                    state.public.lock().note_input(conn_id, "game", now);
                }
                Err(message) => error(tx, message).await,
            }
        }
        ClientMsg::PatchParam { node, param, value } => {
            if node.len() > 64 || param.len() > 64 {
                error(tx, "bad param").await;
                return Ok(());
            }
            let who = name_of(state, conn_id);
            match crate::server::apply_patch_param(state, node.clone(), param.clone(), value) {
                Ok(()) => {
                    state.recorder.event(
                        "knob",
                        &who,
                        serde_json::json!({ "node": node, "param": param, "value": value, "public": true }),
                    );
                    state.public.lock().note_input(conn_id, "knob", now);
                }
                Err(message) => error(tx, message).await,
            }
        }
        ClientMsg::SubscribePreview { .. } => {
            let caps = public::capabilities(&cfg, &perks);
            let (fps, decimate) = public::preview_limits(&cfg, &caps);
            if fps == 0 {
                error(tx, "No preview on the public floor right now.").await;
                return Ok(());
            }
            *flow.preview = Some(PreviewSub {
                min_interval: Duration::from_secs_f32(1.0 / fps as f32),
                decimate,
                include_ready: false,
                last_sent: Instant::now() - Duration::from_secs(1),
                in_flight: 0,
                acking: false,
                last_ack: Instant::now(),
            });
            *flow.announced_meta = (0, 0, 0);
        }
        ClientMsg::UnsubscribePreview => {
            *flow.preview = None;
        }
        ClientMsg::PreviewAck { .. } => {
            if let Some(sub) = flow.preview.as_mut() {
                sub.note_ack(now);
            }
        }
        // Everything else was refused by the gate above.
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_public_pages_assets_are_served() {
        assert!(public_asset_allowed("public.html"));
        assert!(public_asset_allowed("assets/public-abc123.js"));
        assert!(public_asset_allowed("play.webmanifest"));
        assert!(public_asset_allowed("sw.js"));
        assert!(!public_asset_allowed("index.html"));
        assert!(!public_asset_allowed("manifest.webmanifest"));
        assert!(!public_asset_allowed("poster.html"));
        assert!(!public_asset_allowed("restart.html"));
        assert!(!public_asset_allowed("assets/../index.html"));
        assert!(!public_asset_allowed(""));
    }

    #[test]
    fn names_are_cleaned_and_never_empty() {
        assert_eq!(clean_name("  Dusty Badger "), "Dusty Badger");
        assert_eq!(clean_name(""), "Someone");
        assert_eq!(clean_name("\u{7}\n"), "Someone");
        assert_eq!(clean_name(&"x".repeat(100)).len(), 40);
    }

    #[test]
    fn floor_games_start_with_their_defaults_and_idle_out() {
        use crate::game::{GameCommand, GameKind};
        let state = SharedState::new(crate::config::AppConfig::default());
        // Only hidden games are the floor's to start.
        assert!(state.start_floor_game(GameKind::Flak).is_err());
        assert_eq!(state.floor_game(), None);
        state.start_floor_game(GameKind::Perimeter).unwrap();
        {
            let g = state.game.lock();
            assert_eq!(g.active, Some(GameKind::Perimeter));
            assert!(g.from_floor);
            assert_eq!(g.species, GameKind::Perimeter.floor_species());
            assert!(g.last_input.is_some());
        }
        assert_eq!(state.floor_game(), Some(GameKind::Perimeter));
        // A long idle allowance keeps it; input refreshes it; zero ends it.
        assert_eq!(state.expire_floor_game(Duration::from_secs(3600)), None);
        state.game_command(GameCommand::HardDrop, 0);
        assert_eq!(state.expire_floor_game(Duration::from_secs(3600)), None);
        assert_eq!(state.expire_floor_game(Duration::ZERO), Some(GameKind::Perimeter));
        assert_eq!(state.game.lock().active, None);
        assert!(!state.game.lock().from_floor);
        // The floor may stop what it started…
        state.start_floor_game(GameKind::Perimeter).unwrap();
        state.stop_floor_game().unwrap();
        assert_eq!(state.game.lock().active, None);
        // …but not what the operator started, which never expires either,
        // and the operator's start of the same game is still the operator's.
        state.set_game_mode(Some(GameKind::Perimeter), None, None).unwrap();
        assert_eq!(state.floor_game(), None);
        assert!(state.stop_floor_game().is_err());
        assert_eq!(state.expire_floor_game(Duration::ZERO), None);
        state.start_floor_game(GameKind::Perimeter).unwrap();
        assert_eq!(state.floor_game(), None, "a floor start must not take over the operator's game");
        state.set_game_mode(None, None, None).unwrap();
        assert!(state.stop_floor_game().is_ok(), "stopping nothing is fine");
    }

    #[test]
    fn snapshot_reflects_perks_and_the_floor() {
        let state = SharedState::new(crate::config::AppConfig::default());
        let now = Instant::now();
        {
            let cfg = state.config.read().public.clone();
            let mut reg = state.public.lock();
            reg.reserve(7, "198.51.100.1".parse().unwrap(), &cfg).unwrap();
            reg.admit(7, "pub-a", "Dusty Badger", now).unwrap();
        }
        let snap = snapshot(&state, 7);
        assert_eq!(snap.you, "Dusty Badger");
        assert_eq!(snap.players, 1);
        assert!(snap.caps.draw && snap.caps.effects && snap.caps.games);
        assert!(!snap.caps.knobs && !snap.caps.preview);
        assert_eq!(snap.preview_fps, 0);
        assert_eq!(snap.max_dab_size, public::MAX_DAB_SIZE);
        assert_eq!(snap.spokes, 64);
        // Close the floor; give the session a key with a brush.
        state.config.write().public.open = false;
        state
            .public
            .lock()
            .session_mut(7)
            .unwrap()
            .perks
            .extend(["draw".to_string(), "big_brush".to_string()]);
        let snap = snapshot(&state, 7);
        assert!(!snap.open);
        assert!(snap.caps.draw && !snap.caps.effects && !snap.caps.games);
        assert_eq!(snap.max_dab_size, public::MAX_DAB_SIZE_BIG_BRUSH);
        assert_eq!(snap.perks, vec!["big_brush", "draw"]);
        // A session the registry does not know gets an empty, closed view.
        let snap = snapshot(&state, 99);
        assert_eq!(snap.you, "");
        assert!(!snap.caps.any());
    }
}
