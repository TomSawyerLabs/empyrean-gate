//! HTTP + WebSocket server: serves the built web UI (embedded in the binary) and the
//! control protocol used by every client — the Tauri webview, LAN browsers, phones.
//!
//! Also hosts:
//! - `/qr.svg?data=...` — QR rendering for the connect dialog.
//! - `POST /handover` (loopback only) — lets a freshly-started backend take over:
//!   this instance stops its sACN output, hands back config + layer phases, and
//!   exits shortly after, so the successor can continue with visual continuity.
//!
//! Access control: clients identify with a persistent id. Revoked ids are refused
//! and kicked live. With `server.require_token` on, unknown ids must present the
//! join token (from the QR); loopback clients are always allowed.
//!
//! The frame loop never blocks on this server: frames arrive over a broadcast
//! channel and slow clients simply lag (dropped preview frames), never
//! back-pressuring the engine.

use crate::audio::RemoteChains;
use crate::config::{
    AppConfig, ClientRecord, MediaApprovalMode, MediaSubmission, MediaSubmissionStatus, PublicMode,
};
use crate::media::{MediaResolver, ResolveRequest};
use crate::patch;
use crate::protocol::{
    BrowserAudioStream, ClientMsg, ClientRole, HandoverGrant, ServerMsg, PREVIEW_MAGIC,
    READY_PREVIEW_MAGIC, VIDEO_FRAME_MAGIC,
};
use crate::state::{PreviewFrame, SharedState};
use axum::extract::connect_info::ConnectInfo;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast::error::RecvError;
use tower_http::cors::{Any, CorsLayer};

#[derive(rust_embed::Embed)]
#[folder = "../dist"]
struct Assets;

#[derive(Clone)]
struct Ctx {
    state: Arc<SharedState>,
    remote: RemoteChains,
    media: Arc<MediaResolver>,
}

pub fn spawn(state: Arc<SharedState>, remote: RemoteChains) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new()
        .name("server".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("tokio runtime");
            rt.block_on(serve(state, remote));
        })
        .expect("spawn server thread")
}

async fn serve(state: Arc<SharedState>, remote: RemoteChains) {
    let (bind, port) = {
        let cfg = state.config.read();
        (cfg.server.bind.clone(), cfg.server.port)
    };
    let media = MediaResolver::new().expect("media resolver HTTP client");
    let cache_media = media.clone();
    let ctx = Ctx { state: state.clone(), remote, media };
    let app = Router::new()
        .route("/health", get(health))
        .route("/ws", get(ws_upgrade))
        .route("/qr.svg", get(qr_svg))
        .route("/handover/state", get(handover_state))
        .route("/handover", post(handover))
        .route("/media/resolve", post(resolve_media))
        .route("/media/stream/{id}", get(stream_media))
        .route("/patch/registry", get(patch_registry))
        .route("/patch/presets", get(patch_presets))
        .route("/media/file/{id}", get(serve_media_file))
        .route("/version", get(running_version))
        .route("/focus", post(focus_window))
        .route("/reports", get(list_reports))
        .route("/reports/{id}/{file}", get(serve_report_file))
        .route("/diagnostics/recent", post(recent_diagnostics))
        .fallback(get(serve_asset))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
                .allow_headers([header::CONTENT_TYPE, header::RANGE]),
        )
        .with_state(ctx);

    let addr = format!("{bind}:{port}");
    // Retry until shutdown: after a takeover the previous instance may need a
    // moment to exit. Giving up would leave the renderer/output alive but the
    // operator UI permanently unreachable.
    let mut attempt = 0u32;
    let listener = loop {
        match tokio::net::TcpListener::bind(&addr).await {
            Ok(listener) => break listener,
            Err(e) => {
                attempt = attempt.saturating_add(1);
                if attempt == 1 || attempt.is_power_of_two() {
                    log::error!("cannot bind web server on {addr}: {e}; retrying");
                }
                if state.shutdown.load(Ordering::Relaxed) {
                    return;
                }
                tokio::time::sleep(if attempt < 40 {
                    Duration::from_millis(250)
                } else {
                    Duration::from_secs(1)
                })
                .await;
            }
        }
    };
    state.server_bound.store(true, Ordering::SeqCst);
    // Only the process that owns the control port may mutate the shared media
    // cache/config. During hot takeover the old and new binaries overlap briefly.
    tokio::spawn(crate::videocache::run(state.clone(), cache_media));
    log::info!("web UI + control server on http://{addr}");
    let shutdown_state = state.clone();
    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        while !shutdown_state.shutdown.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
    if let Err(e) = server.await {
        log::error!("web server error: {e}");
    }
}

async fn health() -> StatusCode {
    StatusCode::NO_CONTENT
}

// ---------------------------------------------------------------------------
// Browser-decodable media proxy
// ---------------------------------------------------------------------------

fn client_authorized(
    state: &SharedState,
    addr: SocketAddr,
    client_id: &str,
    token: &str,
) -> bool {
    let cfg = state.config.read();
    if cfg
        .clients
        .iter()
        .any(|c| c.id == client_id && c.revoked)
    {
        return false;
    }
    if addr.ip().is_loopback() || !cfg.server.require_token {
        return true;
    }
    cfg.clients.iter().any(|c| c.id == client_id)
        || (!token.is_empty() && token == cfg.server.join_token)
}

fn media_authorized(state: &SharedState, addr: SocketAddr, req: &ResolveRequest) -> bool {
    client_authorized(state, addr, &req.client_id, &req.token)
}

#[derive(Default, serde::Deserialize)]
struct MediaAccessQuery {
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    token: String,
}

#[derive(serde::Deserialize)]
struct DiagnosticsRequest {
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    token: String,
}

fn diagnostics_authorized(
    state: &SharedState,
    addr: SocketAddr,
    client_id: &str,
    token: &str,
) -> bool {
    let cfg = state.config.read();
    if cfg.clients.iter().any(|client| client.id == client_id && client.revoked) {
        return false;
    }
    addr.ip().is_loopback() || (!token.is_empty() && token == cfg.server.join_token)
}

async fn recent_diagnostics(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    axum::Json(req): axum::Json<DiagnosticsRequest>,
) -> Response {
    if !diagnostics_authorized(&ctx.state, addr, &req.client_id, &req.token) {
        return (StatusCode::FORBIDDEN, "diagnostics access denied").into_response();
    }
    let join_token = ctx.state.config.read().server.join_token.clone();
    match crate::diagnostics::recent_text(&[&join_token, &req.token]) {
        Ok(text) => Response::builder()
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .header(
                header::CONTENT_DISPOSITION,
                "attachment; filename=empyrean-gate-diagnostics.txt",
            )
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::from(text))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("could not read diagnostics: {error}"),
        )
            .into_response(),
    }
}

async fn resolve_media(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    axum::Json(req): axum::Json<ResolveRequest>,
) -> Response {
    if !media_authorized(&ctx.state, addr, &req) {
        return (StatusCode::FORBIDDEN, "media access denied").into_response();
    }
    match ctx.media.resolve(&req.url).await {
        Ok(resolved) => axum::Json(resolved).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, format!("{e:#}")).into_response(),
    }
}

async fn stream_media(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Query(access): Query<MediaAccessQuery>,
    headers: HeaderMap,
) -> Response {
    if !client_authorized(&ctx.state, addr, &access.client_id, &access.token) {
        return (StatusCode::FORBIDDEN, "media access denied").into_response();
    }
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let upstream = match ctx.media.stream(&id, range).await {
        Ok(response) => response,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("media stream error: {e:#}")).into_response(),
    };
    let status = upstream.status();
    let mut builder = Response::builder().status(status);
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::CACHE_CONTROL,
        header::ETAG,
        header::LAST_MODIFIED,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            builder = builder.header(name, value);
        }
    }
    builder
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Serve a playlist entry's media from disk: the cached download for URL entries
/// or the file itself for local ones. Single-range requests are honored — the
/// browser <video> element requires them for seeking.
async fn serve_media_file(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Query(access): Query<MediaAccessQuery>,
    headers: HeaderMap,
) -> Response {
    if !client_authorized(&ctx.state, addr, &access.client_id, &access.token) {
        return (StatusCode::FORBIDDEN, "media access denied").into_response();
    }
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    serve_media_file_ranged(ctx, id, range).await
}

async fn serve_media_file_ranged_entry(
    ctx: &Ctx,
    id: &str,
) -> Option<(std::path::PathBuf, String)> {
    if let Some(hit) = crate::videocache::cached_file(id) {
        return Some(hit);
    }
    // Local-file entries stream straight from their configured path.
    let cfg = ctx.state.config.read();
    let entry = cfg.video.playlist.iter().find(|e| e.id == id)?;
    if entry.kind != crate::config::PlaylistKind::LocalFile {
        return None;
    }
    let path = std::path::PathBuf::from(&entry.source);
    path.is_file().then(|| {
        let content_type = match path.extension().and_then(|e| e.to_str()) {
            Some("webm") => "video/webm",
            Some("ogv") => "video/ogg",
            Some("mov") => "video/quicktime",
            _ => "video/mp4",
        };
        (path, content_type.to_string())
    })
}

async fn serve_media_file_ranged(ctx: Ctx, id: String, range: Option<String>) -> Response {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let Some((path, content_type)) = serve_media_file_ranged_entry(&ctx, &id).await else {
        return (StatusCode::NOT_FOUND, "not cached or not a local file").into_response();
    };
    let Ok(mut file) = tokio::fs::File::open(&path).await else {
        return (StatusCode::NOT_FOUND, "media file unreadable").into_response();
    };
    let total = match file.metadata().await {
        Ok(m) => m.len(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "stat failed").into_response(),
    };

    let (start, end) = match range.as_deref().and_then(|r| parse_range(r, total)) {
        Some(r) => r,
        None if range.is_some() => {
            return (StatusCode::RANGE_NOT_SATISFIABLE, "bad range").into_response()
        }
        None => (0, total.saturating_sub(1)),
    };
    let len = end - start + 1;
    if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "seek failed").into_response();
    }
    let mut data = vec![0u8; len as usize];
    if file.read_exact(&mut data).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
    }

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len);
    if range.is_some() {
        builder = builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"));
    }
    builder
        .body(Body::from(data))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn parse_range(range: &str, total: u64) -> Option<(u64, u64)> {
    let spec = range.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start_s, end_s) = spec.split_once('-')?;
    if start_s.is_empty() {
        // Suffix range: last N bytes.
        let n: u64 = end_s.parse().ok()?;
        let start = total.saturating_sub(n);
        return (total > 0).then_some((start, total - 1));
    }
    let start: u64 = start_s.parse().ok()?;
    let end = if end_s.is_empty() {
        total.checked_sub(1)?
    } else {
        end_s.parse::<u64>().ok()?.min(total.saturating_sub(1))
    };
    (start <= end && start < total).then_some((start, end))
}

// ---------------------------------------------------------------------------
// Static assets, QR, handover
// ---------------------------------------------------------------------------

/// What version is running here. Deliberately tiny and unauthenticated: a
/// starting instance asks this BEFORE deciding whether to take the port, and it
/// must work even when the running instance is a different (older or newer)
/// build. Absent on instances older than v0.5.2, which the caller treats as
/// "unknown".
async fn running_version() -> Response {
    axum::Json(serde_json::json!({ "version": crate::updater::effective_version() })).into_response()
}

/// Bring the running instance's window forward. Called by a second launch that
/// refused to take over, so double-clicking a stale shortcut surfaces the app
/// the operator already has rather than appearing to do nothing.
async fn focus_window(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !addr.ip().is_loopback() {
        return (StatusCode::FORBIDDEN, "focus is local-only").into_response();
    }
    ctx.state.focus_requested.store(true, Ordering::SeqCst);
    StatusCode::NO_CONTENT.into_response()
}

// ---------------------------------------------------------------------------
// Feedback report bundles
// ---------------------------------------------------------------------------

/// Newest first. The UI lists these so a bundle can be pulled off the Gate
/// machine from any device instead of someone walking over with a USB stick.
async fn list_reports() -> Response {
    axum::Json(crate::report::list()).into_response()
}

/// Serve one file out of a bundle. Both path segments are validated: `id` must
/// look like an id we generated, and `file` must be one of the fixed names —
/// this endpoint is reachable by every LAN client.
async fn serve_report_file(Path((id, file)): Path<(String, String)>) -> Response {
    let content_type = match file.as_str() {
        "report.json" | "info.json" => "application/json",
        "frames.bin" => "application/octet-stream",
        "contact-sheet.png" => "image/png",
        _ => return (StatusCode::NOT_FOUND, "no such report file").into_response(),
    };
    if !crate::report::valid_id(&id) {
        return (StatusCode::BAD_REQUEST, "bad report id").into_response();
    }
    match tokio::fs::read(crate::report::reports_dir().join(&id).join(&file)).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, content_type)], bytes).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "no such report").into_response(),
    }
}

async fn serve_asset(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match Assets::get(path).or_else(|| Assets::get("index.html")) {
        Some(file) => {
            let mime = mime_for(path);
            ([(header::CONTENT_TYPE, mime)], file.data).into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            "UI assets not built into this binary. Run `bun run build` before `cargo build`, \
             or use the desktop app / vite dev server.",
        )
            .into_response(),
    }
}

fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

#[derive(serde::Deserialize)]
struct QrQuery {
    data: String,
}

async fn qr_svg(Query(q): Query<QrQuery>) -> Response {
    match qrcode::QrCode::new(q.data.as_bytes()) {
        Ok(code) => {
            let svg = code
                .render::<qrcode::render::svg::Color>()
                .min_dimensions(280, 280)
                .quiet_zone(true)
                .build();
            ([(header::CONTENT_TYPE, "image/svg+xml")], svg).into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, format!("QR error: {e}")).into_response(),
    }
}

/// Two-phase takeover, phase 1 (side-effect-free): a starting successor fetches the
/// running state early so it can fully prepare (adopt config, build its sACN plan,
/// fill its render pipeline) while THIS instance keeps sending.
async fn handover_state(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    if !handover_authorized(&ctx.state, addr, &headers) {
        return (StatusCode::FORBIDDEN, "handover authorization failed").into_response();
    }
    log::info!("handover state requested — a successor instance is preparing");
    let grant = HandoverGrant {
        config: ctx.state.config.read().clone(),
        layer_phases: ctx.state.layer_phases.lock().clone(),
        sacn_sequence: Some(ctx.state.sacn_sequence.load(Ordering::Relaxed)),
    };
    axum::Json(grant).into_response()
}

/// Phase 2 (commit): stop sACN NOW — and wait for the engine loop to ACK that it
/// skipped a send, so the wire provably never has two sources — then hand back
/// fresh layer phases (drift correction for the successor) and exit shortly.
fn handover_authorized(state: &SharedState, addr: SocketAddr, headers: &HeaderMap) -> bool {
    if !addr.ip().is_loopback() {
        return false;
    }
    let supplied = headers
        .get("x-empyrean-handover")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let expected = state.config.read().server.join_token.clone();
    !expected.is_empty() && supplied == expected
}

async fn handover(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    if !handover_authorized(&ctx.state, addr, &headers) {
        return (StatusCode::FORBIDDEN, "handover authorization failed").into_response();
    }
    let state = ctx.state.clone();
    log::info!("handover commit — stopping sACN output");
    let t0 = Instant::now();
    state.leaving.store(true, Ordering::SeqCst);
    // Wait for the engine's quiesce ack (~1 frame period; cap in case the engine
    // thread is down, e.g. GPU error — then it wasn't sending anyway).
    while !state.sacn_quiesced.load(Ordering::SeqCst) && t0.elapsed() < Duration::from_millis(150)
    {
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    log::info!(
        "sACN quiesced in {:.1} ms",
        t0.elapsed().as_secs_f32() * 1000.0
    );

    let grant = HandoverGrant {
        config: state.config.read().clone(),
        layer_phases: state.layer_phases.lock().clone(),
        // Read after the quiesce ack above, so this is provably the last sequence
        // number this instance will ever send.
        sacn_sequence: Some(state.sacn_sequence.load(Ordering::Relaxed)),
    };

    // Exit from a plain thread, not the tokio runtime: setting `shutdown` tears the
    // runtime down (graceful server exit), which would cancel a tokio task before
    // it ever reached `process::exit` — leaving a zombie process.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        log::info!("handover complete; this instance is exiting");
        state.shutdown.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(300));
        std::process::exit(0);
    });

    axum::Json(grant).into_response()
}

/// The node-type palette for the patch editor — generated from the Rust
/// registry so the frontend can never drift from what codegen understands.
async fn patch_registry() -> Response {
    axum::Json(patch::registry::palette_json()).into_response()
}

/// Built-in starter patches (immutable templates; the editor copies them).
async fn patch_presets() -> Response {
    axum::Json(patch::presets::presets()).into_response()
}

// ---------------------------------------------------------------------------
// WebSocket clients
// ---------------------------------------------------------------------------

async fn ws_upgrade(
    State(ctx): State<Ctx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.max_message_size(4 * 1024 * 1024)
        .max_frame_size(4 * 1024 * 1024)
        .on_upgrade(move |socket| client_task(ctx, socket, addr))
}

struct PreviewSub {
    min_interval: Duration,
    decimate: u32,
    include_ready: bool,
    last_sent: Instant,
}

struct ParticipationLimiter {
    window: Instant,
    effects: u32,
    paint_points: u32,
}

impl ParticipationLimiter {
    fn new() -> Self {
        Self { window: Instant::now(), effects: 0, paint_points: 0 }
    }

    fn refresh(&mut self) {
        if self.window.elapsed() >= Duration::from_secs(1) {
            self.window = Instant::now();
            self.effects = 0;
            self.paint_points = 0;
        }
    }

    fn effect(&mut self, limit: u32) -> bool {
        self.refresh();
        if self.effects >= limit.max(1) { return false; }
        self.effects += 1;
        true
    }

    fn paint(&mut self, points: usize, limit: u32) -> bool {
        self.refresh();
        let points = points.min(u32::MAX as usize) as u32;
        if self.paint_points.saturating_add(points) > limit.max(1) { return false; }
        self.paint_points = self.paint_points.saturating_add(points);
        true
    }
}

async fn client_task(ctx: Ctx, socket: WebSocket, addr: SocketAddr) {
    let state = ctx.state.clone();
    let mut events_rx = state.events.subscribe();
    let mut preview_rx = state.preview.subscribe();
    let (mut tx, mut rx) = socket.split();

    let conn_id = state.conn_seq.fetch_add(1, Ordering::SeqCst);
    state.status.lock().clients += 1;
    let is_local = addr.ip().is_loopback();
    let mut client_id = String::new();
    let mut role = if is_local { ClientRole::Operator } else { ClientRole::Participant };
    let mut participation_limiter = ParticipationLimiter::new();
    let mut authenticated = false;
    let mut preview: Option<PreviewSub> = None;
    let mut announced_meta = (0u32, 0u32, 0u32);
    let mut queued_notified: Option<u32> = None;
    // Loopback clients (the desktop window, aux windows, local browsers) are
    // exempt from preview-slot rationing: their frames never cross the NIC.
    let max_preview = |state: &SharedState| {
        state.config.read().server.max_preview_clients.max(1) as usize
    };

    loop {
        tokio::select! {
            msg = rx.next() => {
                let Some(Ok(msg)) = msg else { break };
                match msg {
                    Message::Text(text) => {
                        match serde_json::from_str::<ClientMsg>(&text) {
                            Ok(m) => {
                                let is_hello = matches!(&m, ClientMsg::Hello { .. });
                                if !authenticated && !is_hello {
                                    let _ = deny(&mut tx, "Authenticate with hello before sending controls.").await;
                                    break;
                                }
                                if authenticated && is_hello {
                                    let _ = deny(&mut tx, "This connection is already authenticated.").await;
                                    break;
                                }
                                let mut reset_meta = false;
                                if handle_msg(&ctx, m, &mut client_id, &mut role, &mut participation_limiter, conn_id, addr, &mut preview, &mut reset_meta, &mut tx).await.is_err() {
                                    break;
                                }
                                if is_hello {
                                    authenticated = true;
                                    if send_json(&mut tx, &ServerMsg::Role { role }).await.is_err() {
                                        break;
                                    }
                                    let hello = state_message_for(&state, role, &client_id);
                                    if send_json(&mut tx, &hello).await.is_err() {
                                        break;
                                    }
                                }
                                if reset_meta {
                                    announced_meta = (0, 0, 0);
                                }
                            }
                            Err(e) => {
                                let _ = send_json(&mut tx, &ServerMsg::Error {
                                    message: format!("bad message: {e}"),
                                }).await;
                            }
                        }
                    }
                    Message::Binary(bytes) => {
                        if authenticated && role == ClientRole::Operator {
                            handle_video_frame(&state, conn_id, &bytes);
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            ev = events_rx.recv() => {
                if !authenticated { continue; }
                // Live revocation: kicked within one event tick (status @2 Hz).
                if !client_id.is_empty() && is_revoked(&state, &client_id) {
                    let _ = send_json(&mut tx, &ServerMsg::Denied {
                        reason: "Access revoked by the operator.".into(),
                    }).await;
                    break;
                }
                // Queue position updates for clients waiting on a preview slot.
                if preview.is_some() && !is_local {
                    let pos = state.preview_gate.lock().position(conn_id);
                    if pos != queued_notified {
                        queued_notified = pos;
                        let msg = ServerMsg::PreviewQueue { position: pos.unwrap_or(0) };
                        if send_json(&mut tx, &msg).await.is_err() { break; }
                    }
                }
                match ev {
                    Ok(ServerMsg::State { .. }) => {
                        let ev = state_message_for(&state, role, &client_id);
                        if send_json(&mut tx, &ev).await.is_err() { break; }
                    }
                    Ok(ev) => {
                        let Some(ev) = event_for_role(ev, role) else { continue };
                        if send_json(&mut tx, &ev).await.is_err() { break; }
                    }
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
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
                // Bandwidth rationing: only slot holders stream frames (loopback
                // clients are always allowed — no NIC involved).
                if !is_local {
                    let max = max_preview(&state);
                    if !state.preview_gate.lock().is_active(conn_id, max) { continue; }
                }
                if sub.last_sent.elapsed() < sub.min_interval { continue; }
                sub.last_sent = Instant::now();
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
                if sub.include_ready && !frame.ready_rgb.is_empty() {
                    let bytes = encode_preview_rgb(&frame, &frame.ready_rgb, sub.decimate, READY_PREVIEW_MAGIC);
                    if tx.send(Message::Binary(bytes.into())).await.is_err() { break; }
                }
            }
        }
    }

    {
        let max = max_preview(&state);
        state.preview_gate.lock().release(conn_id, max);
    }
    state.connected_clients.lock().remove(&conn_id);
    if state.stop_video(Some(conn_id)) {
        deactivate_video_audio(&ctx);
    }
    state.status.lock().clients -= 1;
}

fn handle_video_frame(state: &SharedState, conn_id: u64, bytes: &[u8]) {
    if bytes.len() < 12 {
        return;
    }
    let magic = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    if magic != VIDEO_FRAME_MAGIC {
        return;
    }
    let width = u16::from_le_bytes(bytes[8..10].try_into().unwrap());
    let height = u16::from_le_bytes(bytes[10..12].try_into().unwrap());
    let _ = state.push_video_frame(conn_id, width, height, &bytes[12..]);
}

fn deactivate_video_audio(ctx: &Ctx) {
    let chains = ctx.remote.lock();
    for (key, chain) in chains.iter() {
        if matches!(key, crate::audio::BrowserAudioKey::Video) {
            chain.lock().deactivate(&ctx.state);
        }
    }
}

fn is_revoked(state: &SharedState, client_id: &str) -> bool {
    state
        .config
        .read()
        .clients
        .iter()
        .any(|c| c.id == client_id && c.revoked)
}

fn decimated_count(pixels: u32, decimate: u32) -> u32 {
    let d = decimate.max(1);
    pixels.div_ceil(d)
}

fn encode_preview(frame: &PreviewFrame, decimate: u32) -> Vec<u8> {
    encode_preview_rgb(frame, &frame.rgb, decimate, PREVIEW_MAGIC)
}

fn encode_preview_rgb(frame: &PreviewFrame, rgb: &[u8], decimate: u32, magic: u32) -> Vec<u8> {
    let d = decimate.max(1);
    let out_pixels = decimated_count(frame.pixels_per_spoke, d);
    let mut bytes = Vec::with_capacity(12 + (frame.spokes * out_pixels * 3) as usize);
    bytes.extend_from_slice(&magic.to_le_bytes());
    bytes.extend_from_slice(&(frame.frame_number as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.spokes as u16).to_le_bytes());
    bytes.extend_from_slice(&(out_pixels as u16).to_le_bytes());
    if d == 1 {
        bytes.extend_from_slice(rgb);
    } else {
        for spoke in 0..frame.spokes {
            let base = (spoke * frame.pixels_per_spoke) as usize;
            for i in (0..frame.pixels_per_spoke as usize).step_by(d as usize) {
                let o = (base + i) * 3;
                bytes.extend_from_slice(&rgb[o..o + 3]);
            }
        }
    }
    bytes
}

type WsSink = futures_util::stream::SplitSink<WebSocket, Message>;

async fn send_json(tx: &mut WsSink, msg: &ServerMsg) -> Result<(), axum::Error> {
    let text = serde_json::to_string(msg).expect("serialize ServerMsg");
    tx.send(Message::Text(text.into())).await
}

/// Refuse a patch mutation from a non-loopback client. Unlike [`deny`], the
/// connection stays up — the client keeps its play/preview surfaces.
async fn patch_edit_denied(tx: &mut WsSink) -> Result<(), ()> {
    let _ = send_json(
        tx,
        &ServerMsg::Error {
            message: "Patch editing is only available on the Gate machine.".into(),
        },
    )
    .await;
    Ok(())
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

async fn require_local_operator(tx: &mut WsSink, addr: SocketAddr, action: &str) -> bool {
    if addr.ip().is_loopback() {
        return true;
    }
    let _ = send_json(
        tx,
        &ServerMsg::Error {
            message: format!("{action} must be performed on the Gate machine."),
        },
    )
    .await;
    false
}

fn redacted_config(mut cfg: AppConfig, role: ClientRole, client_id: &str) -> AppConfig {
    if role == ClientRole::Operator {
        return cfg;
    }
    cfg.server.join_token.clear();
    cfg.server.auth_token = None;
    cfg.public_access.participant_token.clear();
    cfg.public_access.moderator_token.clear();
    cfg.clients.clear();
    cfg.output.controllers.clear();
    cfg.active_patch = None;
    cfg.ready_stack = None;
    cfg.saved_performances.clear();
    cfg.saved_playlists.clear();
    let allowed = cfg.public_access.public_scene_ids.clone();
    cfg.saved_stacks.retain(|stack| allowed.contains(&stack.id));
    if role == ClientRole::Participant {
        cfg.media_submissions.retain(|item| item.owner_id == client_id);
    }
    cfg
}

fn state_message_for(state: &SharedState, role: ClientRole, client_id: &str) -> ServerMsg {
    let config = redacted_config(state.config.read().clone(), role, client_id);
    let status = redacted_status(state.status.lock().clone(), role);
    ServerMsg::State {
        config: Box::new(config),
        status,
    }
}

fn redacted_status(
    status: crate::protocol::RuntimeStatus,
    role: ClientRole,
) -> crate::protocol::RuntimeStatus {
    if role == ClientRole::Operator {
        status
    } else {
        // Public clients render from preview frames and do not need machine,
        // network, DJ, controller, diagnostics, or source-owner telemetry.
        crate::protocol::RuntimeStatus::default()
    }
}

fn event_for_role(event: ServerMsg, role: ClientRole) -> Option<ServerMsg> {
    if role == ClientRole::Operator {
        return Some(event);
    }
    match event {
        ServerMsg::Status { status } => Some(ServerMsg::Status {
            status: redacted_status(status, role),
        }),
        ServerMsg::ProDjLinkDebug { .. }
        | ServerMsg::Error { .. }
        | ServerMsg::ReportSaved { .. }
        | ServerMsg::Patches { .. }
        | ServerMsg::Patch { .. }
        | ServerMsg::PatchParamChanged { .. }
        | ServerMsg::Discovery { .. }
        | ServerMsg::Role { .. } => None,
        other => Some(other),
    }
}

fn message_allowed(role: ClientRole, msg: &ClientMsg) -> bool {
    if role == ClientRole::Operator || matches!(msg, ClientMsg::Hello { .. }) {
        return true;
    }
    let participant = matches!(
        msg,
        ClientMsg::GetState
            | ClientMsg::SetClientName { .. }
            | ClientMsg::TriggerEffect { .. }
            | ClientMsg::Paint { .. }
            | ClientMsg::SubscribePreview { .. }
            | ClientMsg::UnsubscribePreview
            | ClientMsg::ActivatePublicScene { .. }
            | ClientMsg::SubmitMedia { .. }
    );
    participant
        || (role == ClientRole::Moderator
            && matches!(
                msg,
                ClientMsg::ModerateMedia { .. } | ClientMsg::RemoveMediaSubmission { .. }
            ))
}

async fn permission_denied(tx: &mut WsSink) -> Result<(), ()> {
    let _ = send_json(
        tx,
        &ServerMsg::Error {
            message: "That control is not available to this device.".into(),
        },
    )
    .await;
    Ok(())
}

fn trusted_media_url(raw: &str, domains: &[String]) -> Result<(String, bool), String> {
    let parsed = url::Url::parse(raw).map_err(|_| "Enter a valid http(s) URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only public http(s) URLs without embedded credentials are accepted.".into());
    }
    let host = parsed.host_str().ok_or_else(|| "The URL needs a public hostname.".to_string())?;
    let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized_host == "localhost" || normalized_host.ends_with(".local") {
        return Err("Local-network media URLs are not accepted.".into());
    }
    if let Ok(ip) = normalized_host.parse::<IpAddr>() {
        let private = match ip {
            IpAddr::V4(ip) => ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast(),
            IpAddr::V6(ip) => ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || (ip.segments()[0] & 0xffc0) == 0xfe80,
        };
        if private {
            return Err("Local-network media URLs are not accepted.".into());
        }
    }
    let trusted = domains.iter().any(|domain| {
        let domain = domain.trim().trim_start_matches('.').to_ascii_lowercase();
        !domain.is_empty()
            && (normalized_host == domain || normalized_host.ends_with(&format!(".{domain}")))
    });
    Ok((parsed.to_string(), trusted))
}

/// Friendly device name for the timeline; falls back to the raw id.
fn client_name(state: &SharedState, client_id: &str) -> String {
    if client_id.is_empty() {
        return "unknown".into();
    }
    state
        .config
        .read()
        .clients
        .iter()
        .find(|c| c.id == client_id)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| client_id.to_owned())
}

/// Map an incoming message onto a feedback-timeline entry. Messages that cannot
/// change the look of the array (hello, state queries, preview subscriptions,
/// client admin) deliberately produce nothing.
fn record_timeline(state: &SharedState, msg: &ClientMsg, client_id: &str) {
    use serde_json::json;
    let name = || client_name(state, client_id);
    let rec = &state.recorder;
    match msg {
        ClientMsg::TriggerEffect { effect } => rec.event(
            "effect",
            &name(),
            json!({
                "kind": effect.kind,
                "angle": effect.angle,
                "radius": effect.radius,
                "hue": effect.hue,
                "size": effect.size,
            }),
        ),
        ClientMsg::Paint {
            pen,
            points,
            hue,
            size,
            ..
        } => {
            let pen = serde_json::to_value(pen)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default();
            rec.paint_event(&name(), &pen, points.len() as u64, *hue, *size);
        }
        ClientMsg::SetMaster { brightness, speed } => rec.event(
            "master",
            &name(),
            json!({ "brightness": brightness, "speed": speed }),
        ),
        ClientMsg::SetSacnEnabled { enabled } => {
            rec.event("sacn", &name(), json!({ "enabled": enabled }))
        }
        ClientMsg::AddLayer { layer } => rec.event(
            "layer",
            &name(),
            json!({ "op": "add", "name": layer.name, "kind": layer.kind }),
        ),
        ClientMsg::UpdateLayer { index, layer } => rec.event(
            "layer",
            &name(),
            json!({ "op": "update", "index": index, "name": layer.name, "kind": layer.kind }),
        ),
        ClientMsg::RemoveLayer { index } => {
            rec.event("layer", &name(), json!({ "op": "remove", "index": index }))
        }
        ClientMsg::MoveLayer { from, to } => rec.event(
            "layer",
            &name(),
            json!({ "op": "move", "from": from, "to": to }),
        ),
        // A full-config write is the Settings page saving; the effective values
        // are captured by the 10 Hz snapshots either way.
        ClientMsg::SetConfig { config } => rec.event(
            "config",
            &name(),
            json!({
                "master_brightness": config.render.master_brightness,
                "master_speed": config.render.master_speed,
                "layers": config.layers.len(),
                "walk_enabled": config.render.walk_enabled,
            }),
        ),
        ClientMsg::StartVideo { title, source_url } => rec.event(
            "video",
            &name(),
            json!({ "op": "start", "title": title, "source_url": source_url }),
        ),
        ClientMsg::StopVideo { force } => {
            rec.event("video", &name(), json!({ "op": "stop", "force": force }))
        }
        // Game mode replaces the whole look of the array, so mode changes and
        // player injections belong on the timeline — a report captured during a
        // game should say plainly that the array was a game world.
        ClientMsg::SetGameMode { game } => {
            rec.event("game_mode", &name(), json!({ "game": game }))
        }
        ClientMsg::GameInput { species, points } => rec.event(
            "game_input",
            &name(),
            json!({ "species": species, "points": points.len() }),
        ),
        // Test mode replaces every pixel on the rig, so both the arming and the
        // pattern changes belong on the timeline — a report captured during
        // commissioning should say plainly that the array was under test.
        ClientMsg::SetTestMode { active } => {
            rec.event("test_mode", &name(), json!({ "active": active }))
        }
        ClientMsg::SetTestConfig { test } => rec.event(
            "test_pattern",
            &name(),
            json!({
                "pattern": test.pattern,
                "brightness": test.brightness,
                "index": test.index,
                "from_inner": test.from_inner,
                "spoke_select": test.spoke_select,
            }),
        ),
        // Continuous signals (phone IMU, audio) are NOT timeline entries: at tens
        // of packets a second they would bury the discrete actions. They ride
        // along in the 10 Hz snapshots instead.
        _ => {}
    }
}

fn stack_snapshot(
    cfg: &crate::config::AppConfig,
    id: String,
    name: String,
) -> crate::config::SavedStack {
    crate::config::SavedStack {
        id,
        name,
        layers: cfg.layers.clone(),
        master_speed: cfg.render.master_speed,
        walk_enabled: cfg.render.walk_enabled,
        walk_layers: cfg.render.walk_layers,
        walk_min_layers: cfg.render.walk_min_layers,
        walk_speed: cfg.render.walk_speed,
        walk_depth: cfg.render.walk_depth,
        dj_link_effects: cfg.rhythm.pro_dj_link_effects.clone(),
    }
}

/// Record replayable control metadata while an explicit performance capture is armed.
/// Continuous audio/video pixels are intentionally absent.
fn record_performance(state: &SharedState, msg: &ClientMsg, is_loopback: bool) {
    use crate::config::{PerformanceAction as A, PerformanceEvent};
    let patch_for_config = matches!(msg, ClientMsg::SetConfig { .. })
        .then(|| state.config.read().active_patch.clone())
        .flatten();
    let mut recording = state.performance_recording.lock();
    let Some(active) = recording.as_mut() else {
        return;
    };
    let action = match msg {
        ClientMsg::SetMaster { brightness, speed } => A::SetMaster {
            brightness: *brightness,
            speed: *speed,
        },
        ClientMsg::ActivateStack { stack } => A::SetLook {
            stack: stack.clone(),
            patch: None,
        },
        ClientMsg::SetConfig { config } => A::SetLook {
            stack: stack_snapshot(config, "recorded-look".into(), "Recorded look".into()),
            patch: patch_for_config,
        },
        ClientMsg::AddLayer { layer } => A::AddLayer { layer: layer.clone() },
        ClientMsg::UpdateLayer { index, layer } => A::UpdateLayer {
            index: *index,
            layer: layer.clone(),
        },
        ClientMsg::RemoveLayer { index } => A::RemoveLayer { index: *index },
        ClientMsg::MoveLayer { from, to } => A::MoveLayer {
            from: *from,
            to: *to,
        },
        ClientMsg::TriggerEffect { effect } => A::TriggerEffect {
            effect: effect.clone(),
        },
        ClientMsg::Paint {
            pen,
            points,
            hue,
            saturation,
            brightness,
            size,
            intensity,
        } => A::Paint {
            pen: *pen,
            points: points.clone(),
            hue: *hue,
            saturation: *saturation,
            brightness: *brightness,
            size: *size,
            intensity: *intensity,
        },
        ClientMsg::PatchActivate { id } if is_loopback => A::PatchActivate { id: id.clone() },
        ClientMsg::PatchParam { node, param, value } => A::PatchParam {
            node: node.clone(),
            param: param.clone(),
            value: *value,
        },
        _ => return,
    };
    active.events.push(PerformanceEvent {
        at_secs: active.started.elapsed().as_secs_f32(),
        action,
    });
}

#[allow(clippy::too_many_arguments)]
async fn handle_msg(
    ctx: &Ctx,
    msg: ClientMsg,
    client_id: &mut String,
    role: &mut ClientRole,
    participation_limiter: &mut ParticipationLimiter,
    conn_id: u64,
    addr: SocketAddr,
    preview: &mut Option<PreviewSub>,
    reset_meta: &mut bool,
    tx: &mut WsSink,
) -> Result<(), ()> {
    let state = &ctx.state;
    if !message_allowed(*role, &msg) {
        return permission_denied(tx).await;
    }
    // Feedback capture: every operator action that can change what the array
    // does, logged in one place so new message kinds can't quietly go unrecorded.
    record_timeline(state, &msg, client_id);
    record_performance(state, &msg, addr.ip().is_loopback());
    match msg {
        ClientMsg::Hello {
            name,
            client_id: id,
            token,
        } => {
            if id.is_empty()
                || id.len() > 128
                || !id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
            {
                return deny(tx, "Invalid client identity.").await;
            }
            let is_local = addr.ip().is_loopback();
            let (known, revoked, operator_token, moderator_token, participant_token, client_capacity_reached) = {
                let cfg = state.config.read();
                let rec = cfg.clients.iter().find(|c| c.id == id);
                (
                    rec.is_some(),
                    rec.is_some_and(|r| r.revoked),
                    !token.is_empty() && token == cfg.server.join_token,
                    !token.is_empty() && token == cfg.public_access.moderator_token,
                    !token.is_empty() && token == cfg.public_access.participant_token,
                    cfg.clients.len() >= crate::config::MAX_CLIENT_RECORDS,
                )
            };
            if revoked {
                return deny(tx, "Access revoked by the operator.").await;
            }
            if state.config.read().server.require_token
                && !is_local
                && !operator_token
                && !moderator_token
                && !participant_token
            {
                return deny(
                    tx,
                    "This system requires a join token — scan the Connect QR code in the app.",
                )
                .await;
            }
            *role = if is_local || operator_token {
                ClientRole::Operator
            } else if moderator_token {
                ClientRole::Moderator
            } else {
                ClientRole::Participant
            };
            if !known && client_capacity_reached {
                return deny(
                    tx,
                    "The remembered-client list is full; forget an old device on the Gate machine.",
                )
                .await;
            }
            if !id.is_empty() {
                state.connected_clients.lock().insert(conn_id, id.clone());
                if !known {
                    let display_name = if name.is_empty() {
                        format!("device-{}", &id[id.len().saturating_sub(4)..])
                    } else {
                        name.chars().take(80).collect()
                    };
                    state.update_config(|c| {
                        c.clients.push(ClientRecord {
                            id: id.clone(),
                            name: display_name,
                            revoked: false,
                        });
                    });
                }
            }
            *client_id = id;
        }
        ClientMsg::SetClientName { name } => {
            let id = client_id.clone();
            if !id.is_empty() && !name.is_empty() {
                let name: String = name.chars().take(80).collect();
                state.update_config(|c| {
                    if let Some(r) = c.clients.iter_mut().find(|r| r.id == id) {
                        r.name = name;
                    }
                });
            }
        }
        ClientMsg::RenameClient { id, name } => {
            if !require_local_operator(tx, addr, "Client administration").await {
                return Ok(());
            }
            let name: String = name.chars().take(80).collect();
            state.update_config(|c| {
                if let Some(r) = c.clients.iter_mut().find(|r| r.id == id) {
                    r.name = name;
                }
            });
        }
        ClientMsg::RevokeClient { id } => {
            if !require_local_operator(tx, addr, "Client administration").await {
                return Ok(());
            }
            state.update_config(|c| {
                if let Some(r) = c.clients.iter_mut().find(|r| r.id == id) {
                    r.revoked = true;
                }
            });
        }
        ClientMsg::UnrevokeClient { id } => {
            if !require_local_operator(tx, addr, "Client administration").await {
                return Ok(());
            }
            state.update_config(|c| {
                if let Some(r) = c.clients.iter_mut().find(|r| r.id == id) {
                    r.revoked = false;
                }
            });
        }
        ClientMsg::ForgetClient { id } => {
            if !require_local_operator(tx, addr, "Client administration").await {
                return Ok(());
            }
            state.update_config(|c| {
                c.clients.retain(|r| r.id != id);
            });
        }
        ClientMsg::RotateJoinToken => {
            if !require_local_operator(tx, addr, "Join-token rotation").await {
                return Ok(());
            }
            state.update_config(|c| {
                c.server.join_token = crate::config::generate_token();
            });
        }
        ClientMsg::SetRequireToken { require } => {
            if !require_local_operator(tx, addr, "Access-policy changes").await {
                return Ok(());
            }
            state.update_config(|c| {
                c.server.require_token = require;
            });
        }
        ClientMsg::GetState => {
            state.broadcast_state();
            // Replay the last controller scan to this client only, so reopening
            // the Test tab (or reloading a phone) keeps the table populated
            // without putting another round of probes on the network.
            // Cloned out of the lock first: the guard is not Send and this task
            // must stay Send across the await below.
            if *role == ClientRole::Operator {
                let cached = state.last_discovery.lock().clone();
                if let Some(result) = cached {
                    let _ = send_json(
                        tx,
                        &ServerMsg::Discovery {
                            result: Box::new(result),
                        },
                    )
                    .await;
                }
            }
        }
        ClientMsg::ActivatePublicScene { id } => {
            let stack = {
                let cfg = state.config.read();
                if *role != ClientRole::Operator
                    && (cfg.public_access.mode != PublicMode::Curated
                        || !cfg.public_access.public_scene_ids.contains(&id))
                {
                    None
                } else {
                    cfg.saved_stacks.iter().find(|stack| stack.id == id).cloned()
                }
            };
            let Some(stack) = stack else {
                return permission_denied(tx).await;
            };
            state.request_render_transition();
            state.update_config(|cfg| {
                cfg.active_patch = None;
                cfg.show_scheduler.enabled = false;
                cfg.layers = stack.layers;
                cfg.render.master_speed = stack.master_speed;
                cfg.render.walk_enabled = stack.walk_enabled;
                cfg.render.walk_layers = stack.walk_layers;
                cfg.render.walk_min_layers = stack.walk_min_layers;
                cfg.render.walk_speed = stack.walk_speed;
                cfg.render.walk_depth = stack.walk_depth;
                cfg.rhythm.pro_dj_link_effects = stack.dj_link_effects;
            });
        }
        ClientMsg::SubmitMedia { url } => {
            let (mode, enabled, approval, domains) = {
                let cfg = state.config.read();
                (
                    cfg.public_access.mode,
                    cfg.public_access.media_submissions_enabled,
                    cfg.public_access.media_approval,
                    cfg.public_access.trusted_media_domains.clone(),
                )
            };
            if mode != PublicMode::Curated || !enabled {
                return permission_denied(tx).await;
            }
            let (url, trusted) = match trusted_media_url(&url, &domains) {
                Ok(value) => value,
                Err(message) => {
                    let _ = send_json(tx, &ServerMsg::Error { message }).await;
                    return Ok(());
                }
            };
            let auto_approved = approval == MediaApprovalMode::Open
                || (approval == MediaApprovalMode::TrustedDomains && trusted);
            let owner_id = client_id.clone();
            state.update_config(|cfg| {
                if cfg.media_submissions.len() >= 200 {
                    cfg.media_submissions.remove(0);
                }
                cfg.media_submissions.push(MediaSubmission {
                    id: uuid::Uuid::new_v4().simple().to_string(),
                    owner_id,
                    url,
                    status: if auto_approved {
                        MediaSubmissionStatus::Approved
                    } else {
                        MediaSubmissionStatus::Pending
                    },
                    auto_approved,
                });
            });
        }
        ClientMsg::ModerateMedia { id, status } => {
            state.update_config(|cfg| {
                if let Some(item) = cfg.media_submissions.iter_mut().find(|item| item.id == id) {
                    item.status = status;
                    item.auto_approved = false;
                }
            });
        }
        ClientMsg::RemoveMediaSubmission { id } => {
            state.update_config(|cfg| cfg.media_submissions.retain(|item| item.id != id));
        }
        ClientMsg::SetConfig { config } => {
            if let Err(e) = config.validate() {
                let _ = send_json(
                    tx,
                    &ServerMsg::Error {
                        message: format!("Settings rejected: {e}"),
                    },
                )
                .await;
                return Ok(());
            }
            let port_changed = addr.ip().is_loopback() && {
                let cur = state.config.read();
                cur.server.port != config.server.port || cur.server.bind != config.server.bind
            };
            state.update_config(|c| {
                // Client management, tokens, and the active patch are edited
                // via their dedicated messages; don't let a stale full-config
                // write clobber them.
                let clients = c.clients.clone();
                let join_token = c.server.join_token.clone();
                let require_token = c.server.require_token;
                let active_patch = c.active_patch.clone();
                let launch_at_startup = c.windows.launch_at_startup;
                *c = *config;
                c.clients = clients;
                c.server.join_token = join_token;
                c.server.require_token = require_token;
                c.active_patch = active_patch;
                c.windows.launch_at_startup = launch_at_startup;
            });
            if port_changed {
                let _ = send_json(
                    tx,
                    &ServerMsg::Error {
                        message: "Server bind/port changes take effect on restart".into(),
                    },
                )
                .await;
            }
        }
        ClientMsg::SetMaster { brightness, speed } => {
            state.update_config(|c| {
                if let Some(b) = brightness {
                    c.render.master_brightness = b.clamp(0.0, 1.0);
                }
                if let Some(s) = speed {
                    c.render.master_speed = s.clamp(0.0, 8.0);
                }
            });
        }
        ClientMsg::ActivateStack { stack } => {
            state.request_render_transition();
            state.update_config(|c| {
                c.active_patch = None;
                c.show_scheduler.enabled = false;
                c.layers = stack.layers;
                c.render.master_speed = stack.master_speed;
                c.render.walk_enabled = stack.walk_enabled;
                c.render.walk_layers = stack.walk_layers;
                c.render.walk_min_layers = stack.walk_min_layers;
                c.render.walk_speed = stack.walk_speed;
                c.render.walk_depth = stack.walk_depth;
                c.rhythm.pro_dj_link_effects = stack.dj_link_effects;
            });
        }
        ClientMsg::PrepareStack { stack } => {
            state.update_config(|c| c.ready_stack = Some(stack));
        }
        ClientMsg::TakeReady { ready_id } => {
            let current_ready = state.config.read().ready_stack.as_ref().map(|stack| stack.id.clone());
            if current_ready.as_deref() != Some(ready_id.as_str()) {
                let _ = send_json(tx, &ServerMsg::Error {
                    message: "Ready changed before the take. Check Bus B and try again.".into(),
                }).await;
                return Ok(());
            }
            state.update_config(|c| {
                let old_program = stack_snapshot(
                    c,
                    format!("ready-program-{}", uuid::Uuid::new_v4().simple()),
                    "Previous program".into(),
                );
                let Some(next) = c.ready_stack.take() else { return };
                c.active_patch = None;
                c.show_scheduler.enabled = false;
                c.layers = next.layers;
                c.render.master_speed = next.master_speed;
                c.render.walk_enabled = next.walk_enabled;
                c.render.walk_layers = next.walk_layers;
                c.render.walk_min_layers = next.walk_min_layers;
                c.render.walk_speed = next.walk_speed;
                c.render.walk_depth = next.walk_depth;
                c.rhythm.pro_dj_link_effects = next.dj_link_effects;
                c.ready_stack = Some(old_program);
                // Publish the epochs while the config write lock is still held:
                // the render loop can observe neither half of the swap alone.
                state.request_ready_take();
                state.request_render_transition();
            });
        }
        ClientMsg::PerformanceRecordStart { name } => {
            if !require_local_operator(tx, addr, "Performance recording").await {
                return Ok(());
            }
            let cfg = state.config.read();
            let id = format!(
                "performance-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
            );
            let recording_name: String = if name.trim().is_empty() {
                "Untitled performance".into()
            } else {
                name.trim().chars().take(80).collect()
            };
            *state.performance_recording.lock() = Some(crate::state::ActivePerformanceRecording {
                id: id.clone(),
                name: recording_name.clone(),
                started: std::time::Instant::now(),
                initial_stack: stack_snapshot(&cfg, format!("{id}-initial"), "Opening look".into()),
                initial_patch: cfg.active_patch.clone(),
                events: Vec::new(),
            });
            drop(cfg);
            let mut status = state.status.lock();
            status.performance_recording = true;
            status.performance_recording_name = recording_name;
            status.performance_recording_secs = 0.0;
            drop(status);
            state.broadcast_state();
        }
        ClientMsg::PerformanceRecordStop { name } => {
            if !require_local_operator(tx, addr, "Performance recording").await {
                return Ok(());
            }
            let finished = state.performance_recording.lock().take();
            {
                let mut status = state.status.lock();
                status.performance_recording = false;
                status.performance_recording_name.clear();
                status.performance_recording_secs = 0.0;
            }
            if let Some(mut active) = finished {
                if !name.trim().is_empty() {
                    active.name = name.trim().chars().take(80).collect();
                }
                let duration_secs = active.started.elapsed().as_secs_f32().max(0.1);
                state.update_config(|config| {
                    config.saved_performances.push(crate::config::SavedPerformance {
                        id: active.id,
                        name: active.name,
                        initial_stack: active.initial_stack,
                        initial_patch: active.initial_patch,
                        duration_secs,
                        events: active.events,
                    });
                });
            } else {
                state.broadcast_state();
            }
        }
        ClientMsg::PerformancePlay { id } => {
            let performance = state
                .config
                .read()
                .saved_performances
                .iter()
                .find(|item| item.id == id)
                .cloned();
            let Some(performance) = performance else {
                let _ = send_json(
                    tx,
                    &ServerMsg::Error {
                        message: "Saved performance not found".into(),
                    },
                )
                .await;
                return Ok(());
            };
            let cue_id = format!(
                "performance-cue-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
            );
            let playlist = crate::config::SavedPlaylist {
                id: crate::config::PERFORMANCE_SCENE_PLAYLIST_ID.into(),
                name: format!("Now playing · {}", performance.name),
                entries: vec![crate::config::ShowPlaylistEntry {
                    id: cue_id,
                    name: performance.name.clone(),
                    stack: performance.initial_stack.clone(),
                    duration_secs: performance.duration_secs,
                    transition_secs: 0.0,
                    game: None,
                    performance: Some(performance.clone()),
                }],
                repeat: false,
            };
            state.request_render_transition();
            state.update_config(move |config| {
                config
                    .saved_playlists
                    .retain(|item| item.id != crate::config::PERFORMANCE_SCENE_PLAYLIST_ID);
                config.saved_playlists.push(playlist);
                config.active_patch = performance.initial_patch;
                config.show_scheduler.enabled = true;
                config.show_scheduler.active_playlist_id =
                    crate::config::PERFORMANCE_SCENE_PLAYLIST_ID.into();
                config.show_scheduler.current_index = 0;
            });
        }
        ClientMsg::SetSacnEnabled { enabled } => {
            state.update_config(|c| c.output.enabled = enabled);
        }
        ClientMsg::AddLayer { layer } => {
            state.update_config(|c| {
                if c.layers.len() < crate::layers::MAX_LAYERS {
                    c.layers.push(layer);
                }
            });
        }
        ClientMsg::UpdateLayer { index, layer } => {
            state.update_config(|c| {
                if let Some(slot) = c.layers.get_mut(index) {
                    *slot = layer;
                }
            });
        }
        ClientMsg::RemoveLayer { index } => {
            state.update_config(|c| {
                if index < c.layers.len() {
                    c.layers.remove(index);
                }
            });
        }
        ClientMsg::MoveLayer { from, to } => {
            state.update_config(|c| {
                if from < c.layers.len() && to < c.layers.len() {
                    let l = c.layers.remove(from);
                    c.layers.insert(to, l);
                }
            });
        }
        ClientMsg::PatchList => {
            let msg = ServerMsg::Patches {
                patches: patch::store::list(&patch::store::patches_dir()),
            };
            let _ = send_json(tx, &msg).await;
        }
        ClientMsg::PatchGet { id } => {
            let msg = match patch::store::load(&patch::store::patches_dir(), &id) {
                Ok(doc) => ServerMsg::Patch { patch: Box::new(doc) },
                Err(e) => ServerMsg::Error { message: e },
            };
            let _ = send_json(tx, &msg).await;
        }
        ClientMsg::PatchSave { patch: doc } => {
            if !addr.ip().is_loopback() {
                return patch_edit_denied(tx).await;
            }
            let dir = patch::store::patches_dir();
            let mut doc = *doc;
            // Saving never gates on graph validity — a half-wired patch mid-edit
            // is legitimate state to persist. Activation is where validity bites.
            match patch::store::save(&dir, &mut doc) {
                Ok(_) => {
                    // Only the active patch needs an engine rebuild. Saving a
                    // different draft must not interrupt the live renderer.
                    if state.config.read().active_patch.as_deref() == Some(doc.id.as_str()) {
                        state.patch_epoch.fetch_add(1, Ordering::SeqCst);
                    }
                    // Echo (the editor learns an assigned id), then refresh
                    // everyone's palette.
                    let _ = send_json(tx, &ServerMsg::Patch { patch: Box::new(doc) }).await;
                    let _ = state.events.send(ServerMsg::Patches {
                        patches: patch::store::list(&dir),
                    });
                }
                Err(e) => {
                    let _ = send_json(tx, &ServerMsg::Error { message: e }).await;
                }
            }
        }
        ClientMsg::PatchDelete { id } => {
            if !addr.ip().is_loopback() {
                return patch_edit_denied(tx).await;
            }
            let dir = patch::store::patches_dir();
            match patch::store::delete(&dir, &id) {
                Ok(()) => {
                    if state.config.read().active_patch.as_deref() == Some(id.as_str()) {
                        state.request_render_transition();
                        state.update_config(|c| c.active_patch = None);
                    }
                    let _ = state.events.send(ServerMsg::Patches {
                        patches: patch::store::list(&dir),
                    });
                }
                Err(e) => {
                    let _ = send_json(tx, &ServerMsg::Error { message: e }).await;
                }
            }
        }
        ClientMsg::PatchActivate { id } => {
            if !addr.ip().is_loopback() {
                return patch_edit_denied(tx).await;
            }
            // The full codegen check (validation + renderable node kinds +
            // Output node), so activation can never leave the engine unable to
            // build what the config points at.
            let refusal = match &id {
                None => None,
                Some(id) => match patch::store::load(&patch::store::patches_dir(), id) {
                    Err(e) => Some(e),
                    Ok(doc) => patch::codegen::compile(&doc).err(),
                },
            };
            match refusal {
                Some(message) => {
                    let _ = send_json(tx, &ServerMsg::Error { message }).await;
                }
                None => {
                    state.request_render_transition();
                    state.update_config(|c| c.active_patch = id);
                }
            }
        }
        ClientMsg::PatchParam { node, param, value } => {
            // The play surface: open to every client, but strictly limited to
            // params the patch author exposed, on the active patch only.
            let active = state.config.read().active_patch.clone();
            let Some(id) = active else {
                let _ = send_json(tx, &ServerMsg::Error { message: "no active patch".into() })
                    .await;
                return Ok(());
            };
            let dir = patch::store::patches_dir();
            let mut doc = match patch::store::load(&dir, &id) {
                Ok(d) => d,
                Err(e) => {
                    let _ = send_json(tx, &ServerMsg::Error { message: e }).await;
                    return Ok(());
                }
            };
            if !doc.exposed.iter().any(|x| x.node == node && x.param == param) {
                let _ = send_json(
                    tx,
                    &ServerMsg::Error {
                        message: format!("param {node}.{param} is not exposed"),
                    },
                )
                .await;
                return Ok(());
            }
            let clamped = doc
                .nodes
                .iter()
                .find(|n| n.id == node)
                .and_then(|n| patch::registry::lookup(&n.kind))
                .and_then(|t| t.param(&param))
                .map(|p| {
                    let finite = if value.is_finite() { value } else { p.default };
                    finite.clamp(p.min, p.max)
                })
                .unwrap_or(value);
            if let Some(n) = doc.nodes.iter_mut().find(|n| n.id == node) {
                n.params.insert(param.clone(), clamped);
            }
            // Persist, but WITHOUT a patch-epoch bump: the live value goes
            // through the runtime queue, no pipeline rebuild.
            if let Err(e) = patch::store::save(&dir, &mut doc) {
                log::warn!("persisting patch param: {e}");
            }
            state
                .patch_params
                .lock()
                .push((node.clone(), param.clone(), clamped));
            let _ = state.events.send(ServerMsg::PatchParamChanged {
                node,
                param,
                value: clamped,
            });
        }
        ClientMsg::SetGameMode { game } => {
            // Same trust model as patch editing: starting/stopping a game
            // replaces the whole look of the array — the Gate machine's call.
            if !addr.ip().is_loopback() {
                let _ = send_json(
                    tx,
                    &ServerMsg::Error {
                        message: "Game control is only available on the Gate machine.".into(),
                    },
                )
                .await;
            } else if let Err(message) = state.set_game_mode(game) {
                let _ = send_json(tx, &ServerMsg::Error { message }).await;
            }
        }
        ClientMsg::SetGameConfig {
            species,
            effects_overlay,
        } => {
            if !addr.ip().is_loopback() {
                let _ = send_json(
                    tx,
                    &ServerMsg::Error {
                        message: "Game control is only available on the Gate machine.".into(),
                    },
                )
                .await;
            } else {
                state.set_game_config(species, effects_overlay);
            }
        }
        ClientMsg::GameInput { species, points } => {
            state.game_input(species, &points);
        }
        ClientMsg::SetTestMode { active } => {
            if let Err(message) = state.set_test_mode(active) {
                let _ = send_json(tx, &ServerMsg::Error { message }).await;
            }
        }
        ClientMsg::SetTestConfig { test } => {
            state.set_test_config(test);
        }
        ClientMsg::DiscoverControllers => {
            // Read-only, but it does spend a few seconds on blocking sockets, so
            // it runs off the async runtime. One scan at a time: a second Scan
            // tap (or a second device) joins the running one rather than putting
            // another round of probes on a show network.
            if state
                .discovery_running
                .swap(true, Ordering::SeqCst)
            {
                let _ = send_json(
                    tx,
                    &ServerMsg::Error {
                        message: "A controller scan is already running.".into(),
                    },
                )
                .await;
            } else {
                let state2 = state.clone();
                state2.broadcast_state(); // light up the "scanning…" state now
                tokio::task::spawn_blocking(move || {
                    let cfg = state2.config.read().clone();
                    let result =
                        crate::discovery::scan(&cfg, std::time::Duration::from_secs(3));
                    log::info!(
                        "controller scan: {} found, {} missing, {} other sACN source(s)",
                        result.found.len(),
                        result.missing.len(),
                        result.other_sources.len()
                    );
                    *state2.last_discovery.lock() = Some(result.clone());
                    state2.discovery_running.store(false, Ordering::SeqCst);
                    let _ = state2.events.send(ServerMsg::Discovery {
                        result: Box::new(result),
                    });
                    state2.broadcast_state();
                });
            }
        }
        ClientMsg::AuthorizeFirewall => {
            if !require_local_operator(tx, addr, "Firewall authorization").await {
                return Ok(());
            }
            // Elevation blocks on the UAC dialog; run it off the async path.
            let state2 = state.clone();
            tokio::task::spawn_blocking(move || {
                let port = state2.config.read().server.port;
                match crate::firewall::authorize(port) {
                    Ok(()) => {
                        state2.status.lock().firewall_pending = false;
                        log::info!("firewall rule created for port {port}");
                    }
                    Err(e) => {
                        log::warn!("firewall authorization failed: {e:#}");
                        let _ = state2.events.send(ServerMsg::Error {
                            message: format!("Firewall authorization failed: {e}"),
                        });
                    }
                }
                state2.broadcast_state();
            });
        }
        ClientMsg::Report {
            description,
            seconds,
        } => {
            // Writing the bundle touches the disk (and renders a contact sheet);
            // keep it off the async runtime's worker threads.
            let state2 = state.clone();
            let who = client_name(state, client_id);
            tokio::task::spawn_blocking(move || {
                match crate::report::write_bundle(&state2, &description, seconds, &who) {
                    Ok(info) => {
                        let _ = state2.events.send(ServerMsg::ReportSaved { report: info });
                    }
                    Err(e) => {
                        log::warn!("could not write feedback report: {e:#}");
                        let _ = state2.events.send(ServerMsg::Error {
                            message: format!("Could not save the report: {e}"),
                        });
                    }
                }
            });
        }
        ClientMsg::CheckUpdate => {
            state.update_check_requested.store(true, Ordering::SeqCst);
        }
        ClientMsg::InstallUpdate => {
            if require_local_operator(tx, addr, "Updates").await {
                state.update_install_requested.store(true, Ordering::SeqCst);
            }
        }
        ClientMsg::SetLaunchAtStartup { enabled } => {
            let state2 = state.clone();
            tokio::task::spawn_blocking(move || {
                let headless = state2.headless.load(Ordering::SeqCst);
                let outcome = crate::startup::reconcile(enabled, headless);
                let applied = outcome.succeeded && outcome.enabled == enabled;
                outcome.publish(&mut state2.status.lock());
                if applied {
                    state2.update_config(|c| c.windows.launch_at_startup = enabled);
                } else {
                    state2.broadcast_state();
                }
            });
        }
        ClientMsg::TriggerEffect { effect } => {
            if *role != ClientRole::Operator {
                let access = state.config.read().public_access.clone();
                if access.mode == PublicMode::Private || !access.allowed_effects.contains(&effect.kind) {
                    return permission_denied(tx).await;
                }
                if !participation_limiter.effect(access.effects_per_second) {
                    return permission_denied(tx).await;
                }
            }
            let mut effect = effect;
            if *role != ClientRole::Operator {
                effect.intensity = effect.intensity.clamp(0.0, 1.0);
                effect.size = effect.size.clamp(0.25, 2.0);
                effect.duration = effect.duration.clamp(0.0, 3.0);
                effect.grow = effect.grow.clamp(-1.0, 1.0);
            }
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
            let (size, intensity) = if *role == ClientRole::Operator {
                (size, intensity)
            } else {
                let access = state.config.read().public_access.clone();
                if access.mode == PublicMode::Private || !access.drawing_enabled {
                    return permission_denied(tx).await;
                }
                if !participation_limiter.paint(points.len(), access.paint_points_per_second) {
                    return permission_denied(tx).await;
                }
                (
                    size.clamp(0.01, access.max_paint_size.clamp(0.01, 0.3)),
                    intensity.clamp(0.0, access.max_paint_intensity.clamp(0.0, 1.0)),
                )
            };
            state.paint(pen, &points, hue, saturation, brightness, size, intensity);
        }
        ClientMsg::SubscribePreview { fps, decimate, include_ready } => {
            *preview = Some(PreviewSub {
                min_interval: Duration::from_secs_f32(1.0 / fps.clamp(1.0, 60.0)),
                decimate: decimate.clamp(1, 64),
                include_ready,
                last_sent: Instant::now() - Duration::from_secs(1),
            });
            // Loopback clients bypass slot rationing (no NIC traffic).
            if !addr.ip().is_loopback() {
                let max = state.config.read().server.max_preview_clients.max(1) as usize;
                let active = state.preview_gate.lock().request(conn_id, max);
                if !active {
                    let position = state.preview_gate.lock().position(conn_id).unwrap_or(0);
                    let _ = send_json(tx, &ServerMsg::PreviewQueue { position }).await;
                }
            }
            // Force a fresh PreviewMeta: the client may be a newly-mounted canvas
            // that never saw the one sent earlier on this connection.
            *reset_meta = true;
        }
        ClientMsg::UnsubscribePreview => {
            *preview = None;
            let max = state.config.read().server.max_preview_clients.max(1) as usize;
            state.preview_gate.lock().release(conn_id, max);
        }
        ClientMsg::StartVideo { title, source_url } => {
            if !client_id.is_empty() {
                deactivate_video_audio(ctx);
                state.start_video(conn_id, client_id, title, source_url);
            }
        }
        ClientMsg::StopVideo { force } => {
            if !client_id.is_empty()
                && state.stop_video(if force { None } else { Some(conn_id) })
            {
                deactivate_video_audio(ctx);
            }
        }
        ClientMsg::AudioFrame {
            stream,
            level,
            bass,
            mid,
            treble,
            flux,
        } => {
            // A soundtrack is authoritative only while this connection owns the
            // live video. Microphone packets retain their client-id routing.
            if stream == BrowserAudioStream::Video {
                let video = state.video.lock();
                if !video.active || video.owner_conn_id != conn_id {
                    return Ok(());
                }
            }
            let chains = ctx.remote.lock();
            for (key, chain) in chains.iter() {
                if key.matches(stream, client_id) {
                    chain
                        .lock()
                        .feed_remote(state, level, bass, mid, treble, flux);
                }
            }
        }
        ClientMsg::Imu {
            yaw,
            pitch,
            roll,
            shake,
        } => {
            let mut c = state.control.lock();
            c.yaw = yaw;
            c.pitch = pitch;
            c.roll = roll;
            c.shake = (c.shake + shake).min(3.0);
        }
    }
    Ok(())
}

#[cfg(test)]
mod diagnostics_tests {
    use super::*;
    use crate::config::{AppConfig, ClientRecord};

    fn remote() -> SocketAddr {
        "192.0.2.10:1234".parse().unwrap()
    }

    #[test]
    fn diagnostics_require_the_join_token_remotely() {
        let mut config = AppConfig::default();
        config.server.join_token = "show-secret".into();
        config.clients.push(ClientRecord {
            id: "operator".into(),
            name: "Operator".into(),
            revoked: false,
        });
        let state = SharedState::new(config);

        assert!(!diagnostics_authorized(&state, remote(), "unknown", ""));
        assert!(!diagnostics_authorized(&state, remote(), "operator", ""));
        assert!(diagnostics_authorized(&state, remote(), "unknown", "show-secret"));
    }

    #[test]
    fn revoked_clients_cannot_download_diagnostics() {
        let mut config = AppConfig::default();
        config.server.join_token = "show-secret".into();
        config.clients.push(ClientRecord {
            id: "revoked".into(),
            name: "Revoked".into(),
            revoked: true,
        });
        let state = SharedState::new(config);
        assert!(!diagnostics_authorized(&state, remote(), "revoked", "show-secret"));
    }

    #[test]
    fn loopback_diagnostics_do_not_require_a_token() {
        let state = SharedState::new(AppConfig::default());
        let loopback = "127.0.0.1:1234".parse().unwrap();
        assert!(diagnostics_authorized(&state, loopback, "", ""));
    }

    #[test]
    fn participant_protocol_is_an_allowlist() {
        assert!(message_allowed(
            ClientRole::Participant,
            &ClientMsg::ActivatePublicScene { id: "scene".into() }
        ));
        assert!(message_allowed(
            ClientRole::Participant,
            &ClientMsg::SubmitMedia { url: "https://youtu.be/x".into() }
        ));
        assert!(!message_allowed(
            ClientRole::Participant,
            &ClientMsg::SetSacnEnabled { enabled: false }
        ));
        assert!(!message_allowed(
            ClientRole::Participant,
            &ClientMsg::SetConfig { config: Box::new(AppConfig::default()) }
        ));
    }

    #[test]
    fn media_domain_matching_cannot_be_suffix_spoofed() {
        let domains = vec!["youtube.com".to_string(), "instagram.com".to_string()];
        assert!(trusted_media_url("https://m.youtube.com/watch?v=x", &domains).unwrap().1);
        assert!(!trusted_media_url("https://youtube.com.evil.example/x", &domains).unwrap().1);
        assert!(trusted_media_url("file:///etc/passwd", &domains).is_err());
        assert!(trusted_media_url("http://localhost/video.mp4", &domains).is_err());
        assert!(trusted_media_url("http://127.0.0.1/video.mp4", &domains).is_err());
        assert!(trusted_media_url("http://192.168.1.20/video.mp4", &domains).is_err());
    }

    #[test]
    fn participant_events_hide_operator_telemetry() {
        let mut status = crate::protocol::RuntimeStatus::default();
        status.interfaces.push("Ethernet — 10.0.0.2".into());
        status.diagnostics_path = "/operator/private.log".into();
        let Some(ServerMsg::Status { status }) =
            event_for_role(ServerMsg::Status { status }, ClientRole::Participant)
        else {
            panic!("participant should receive a redacted status heartbeat");
        };
        assert!(status.interfaces.is_empty());
        assert!(status.diagnostics_path.is_empty());
        assert!(event_for_role(
            ServerMsg::Patches { patches: Vec::new() },
            ClientRole::Participant,
        ).is_none());
    }

    #[test]
    fn participant_state_redacts_credentials_and_other_submissions() {
        let mut config = AppConfig::default();
        config.server.join_token = "operator-secret".into();
        config.public_access.participant_token = "participant-secret".into();
        config.media_submissions.push(MediaSubmission {
            id: "mine".into(), owner_id: "phone-a".into(), url: "https://youtu.be/a".into(),
            status: MediaSubmissionStatus::Pending, auto_approved: false,
        });
        config.media_submissions.push(MediaSubmission {
            id: "theirs".into(), owner_id: "phone-b".into(), url: "https://youtu.be/b".into(),
            status: MediaSubmissionStatus::Pending, auto_approved: false,
        });
        let redacted = redacted_config(config, ClientRole::Participant, "phone-a");
        assert!(redacted.server.join_token.is_empty());
        assert!(redacted.public_access.participant_token.is_empty());
        assert_eq!(redacted.media_submissions.len(), 1);
        assert_eq!(redacted.media_submissions[0].id, "mine");
    }

    #[test]
    fn program_and_ready_previews_use_distinct_compatible_packets() {
        let frame = PreviewFrame {
            frame_number: 7,
            spokes: 2,
            pixels_per_spoke: 3,
            rgb: (0..18).collect(),
            ready_rgb: (20..38).collect(),
        };
        let program = encode_preview(&frame, 2);
        let ready = encode_preview_rgb(&frame, &frame.ready_rgb, 2, READY_PREVIEW_MAGIC);

        assert_eq!(u32::from_le_bytes(program[0..4].try_into().unwrap()), PREVIEW_MAGIC);
        assert_eq!(u32::from_le_bytes(ready[0..4].try_into().unwrap()), READY_PREVIEW_MAGIC);
        assert_eq!(&program[4..12], &ready[4..12], "bus packets share frame geometry");
        assert_eq!(u16::from_le_bytes(program[10..12].try_into().unwrap()), 2);
        assert_ne!(&program[12..], &ready[12..]);
    }
}
