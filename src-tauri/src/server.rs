//! HTTP + WebSocket server: serves the built web UI (embedded in the binary) and the
//! control protocol used by every client — the Tauri webview, LAN browsers, phones.
//!
//! The frame loop never blocks on this server: frames arrive over a broadcast channel
//! and slow clients simply lag (dropped preview frames), never back-pressuring the
//! engine.

use crate::audio::RemoteChains;
use crate::protocol::{ClientMsg, ServerMsg, PREVIEW_MAGIC};
use crate::state::{PreviewFrame, SharedState};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast::error::RecvError;

#[derive(rust_embed::Embed)]
#[folder = "../dist"]
struct Assets;

#[derive(Clone)]
struct Ctx {
    state: Arc<SharedState>,
    remote: RemoteChains,
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
    let ctx = Ctx { state: state.clone(), remote };
    let app = Router::new()
        .route("/ws", get(ws_upgrade))
        .fallback(get(serve_asset))
        .with_state(ctx);

    let addr = format!("{bind}:{port}");
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("cannot bind web server on {addr}: {e}");
            return;
        }
    };
    log::info!("web UI + control server on http://{addr}");
    let shutdown_state = state.clone();
    let server = axum::serve(listener, app).with_graceful_shutdown(async move {
        while !shutdown_state.shutdown.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
    if let Err(e) = server.await {
        log::error!("web server error: {e}");
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
        _ => "application/octet-stream",
    }
}

async fn ws_upgrade(State(ctx): State<Ctx>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| client_task(ctx, socket))
}

struct PreviewSub {
    min_interval: Duration,
    decimate: u32,
    last_sent: Instant,
}

async fn client_task(ctx: Ctx, socket: WebSocket) {
    let state = ctx.state.clone();
    let mut events_rx = state.events.subscribe();
    let mut preview_rx = state.preview.subscribe();
    let (mut tx, mut rx) = socket.split();

    state.status.lock().clients += 1;
    let mut client_id = String::new();
    let mut preview: Option<PreviewSub> = None;
    let mut announced_meta = (0u32, 0u32, 0u32);

    // Greet with full state immediately.
    let hello = ServerMsg::State {
        config: Box::new(state.config.read().clone()),
        status: state.status.lock().clone(),
    };
    let _ = send_json(&mut tx, &hello).await;

    loop {
        tokio::select! {
            msg = rx.next() => {
                let Some(Ok(msg)) = msg else { break };
                match msg {
                    Message::Text(text) => {
                        match serde_json::from_str::<ClientMsg>(&text) {
                            Ok(m) => {
                                let mut reset_meta = false;
                                if handle_msg(&ctx, m, &mut client_id, &mut preview, &mut reset_meta, &mut tx).await.is_err() {
                                    break;
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
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            ev = events_rx.recv() => {
                match ev {
                    Ok(ev) => { if send_json(&mut tx, &ev).await.is_err() { break; } }
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
                }
            }
            frame = preview_rx.recv() => {
                let frame = match frame {
                    Ok(f) => f,
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
                };
                let Some(sub) = preview.as_mut() else { continue };
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
            }
        }
    }

    state.status.lock().clients -= 1;
}

fn decimated_count(pixels: u32, decimate: u32) -> u32 {
    let d = decimate.max(1);
    pixels.div_ceil(d)
}

fn encode_preview(frame: &PreviewFrame, decimate: u32) -> Vec<u8> {
    let d = decimate.max(1);
    let out_pixels = decimated_count(frame.pixels_per_spoke, d);
    let mut bytes = Vec::with_capacity(12 + (frame.spokes * out_pixels * 3) as usize);
    bytes.extend_from_slice(&PREVIEW_MAGIC.to_le_bytes());
    bytes.extend_from_slice(&(frame.frame_number as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.spokes as u16).to_le_bytes());
    bytes.extend_from_slice(&(out_pixels as u16).to_le_bytes());
    if d == 1 {
        bytes.extend_from_slice(&frame.rgb);
    } else {
        for spoke in 0..frame.spokes {
            let base = (spoke * frame.pixels_per_spoke) as usize;
            for i in (0..frame.pixels_per_spoke as usize).step_by(d as usize) {
                let o = (base + i) * 3;
                bytes.extend_from_slice(&frame.rgb[o..o + 3]);
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

async fn handle_msg(
    ctx: &Ctx,
    msg: ClientMsg,
    client_id: &mut String,
    preview: &mut Option<PreviewSub>,
    reset_meta: &mut bool,
    tx: &mut WsSink,
) -> Result<(), ()> {
    let state = &ctx.state;
    match msg {
        ClientMsg::Hello { client_id: id, .. } => {
            // Note: server.auth_token is not enforced yet (trusted LAN stage); the
            // token field exists in the protocol so it can be without migration.
            *client_id = id;
        }
        ClientMsg::GetState => {
            state.broadcast_state();
        }
        ClientMsg::SetConfig { config } => {
            let port_changed = {
                let cur = state.config.read();
                cur.server.port != config.server.port || cur.server.bind != config.server.bind
            };
            state.update_config(|c| *c = *config);
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
        ClientMsg::TriggerEffect { effect } => {
            state.trigger_effect(effect);
        }
        ClientMsg::Paint {
            pen,
            points,
            hue,
            size,
            intensity,
        } => {
            state.paint(pen, &points, hue, size, intensity);
        }
        ClientMsg::SubscribePreview { fps, decimate } => {
            *preview = Some(PreviewSub {
                min_interval: Duration::from_secs_f32(1.0 / fps.clamp(1.0, 60.0)),
                decimate: decimate.clamp(1, 64),
                last_sent: Instant::now() - Duration::from_secs(1),
            });
            // Force a fresh PreviewMeta: the client may be a newly-mounted canvas
            // that never saw the one sent earlier on this connection.
            *reset_meta = true;
        }
        ClientMsg::UnsubscribePreview => {
            *preview = None;
        }
        ClientMsg::AudioFrame {
            level,
            bass,
            mid,
            treble,
            flux,
        } => {
            let chains = ctx.remote.lock();
            for (id, chain) in chains.iter() {
                if id == client_id {
                    chain
                        .lock()
                        .feed_remote(state, level, bass, mid, treble, flux);
                    break;
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
