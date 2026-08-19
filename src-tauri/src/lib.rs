//! Empyrean Gate backend. The frame-generation engine, audio analysis, sACN output,
//! and web/WS server all run here, independent of any UI. The Tauri window is an
//! optional shell (skipped in `--headless` mode) whose webview is just another
//! WebSocket client of the local server.

pub mod audio;
pub mod config;
pub mod engine;
pub mod geometry;
pub mod layers;
pub mod protocol;
pub mod sacn;
pub mod server;
pub mod state;

use std::sync::atomic::Ordering;
use std::sync::Arc;
use state::SharedState;

pub struct Backend {
    pub state: Arc<SharedState>,
}

/// Start every backend subsystem. UI-independent; returns immediately.
///
/// If another instance is already running on our port, take over from it: warm the
/// GPU engine first (sACN gated), ask the old instance to stop and hand back its
/// running state (config + layer phases), then start sending — the structure sees
/// at most a few frames of hold, and patterns continue without a visual jump.
pub fn start_backend() -> Backend {
    let cfg = config::load();
    let port = cfg.server.port;
    let takeover = port_in_use(port);
    let state = SharedState::new(cfg);
    state.status.lock().interfaces = list_interfaces();
    if takeover {
        log::info!("port {port} is busy — attempting takeover of the running instance");
        state.sacn_hold.store(true, Ordering::SeqCst);
    }
    let remote_chains = audio::spawn(state.clone());
    engine::spawn(state.clone());

    if takeover {
        // Warm up before asking the old instance to stop, to minimize the gap.
        wait_for_engine(&state, std::time::Duration::from_secs(8));
        match request_handover(port) {
            Ok(grant) => {
                log::info!("handover granted; adopting running state");
                *state.layer_phases.lock() = grant.layer_phases;
                state.phases_transplanted.store(true, Ordering::SeqCst);
                state.update_config(|c| *c = grant.config);
            }
            Err(e) => {
                log::warn!(
                    "takeover failed ({e}); continuing anyway — the server will retry \
                     binding the port"
                );
            }
        }
        state.sacn_hold.store(false, Ordering::SeqCst);
    }

    server::spawn(state.clone(), remote_chains);
    Backend { state }
}

fn port_in_use(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

fn wait_for_engine(state: &SharedState, timeout: std::time::Duration) {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        {
            let st = state.status.lock();
            if !st.gpu_name.is_empty() || st.gpu_error.is_some() {
                return;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    log::warn!("engine warm-up timed out; proceeding with takeover anyway");
}

fn request_handover(port: u16) -> anyhow::Result<protocol::HandoverGrant> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(5)))
        .build()
        .into();
    let mut resp = agent
        .post(format!("http://127.0.0.1:{port}/handover"))
        .send_empty()?;
    Ok(resp.body_mut().read_json::<protocol::HandoverGrant>()?)
}

/// Local IPv4 interfaces as "name — ip" for the sACN interface picker.
fn list_interfaces() -> Vec<String> {
    match local_ip_address::list_afinet_netifas() {
        Ok(ifas) => ifas
            .into_iter()
            .filter(|(_, ip)| ip.is_ipv4() && !ip.is_loopback())
            .map(|(name, ip)| format!("{name} — {ip}"))
            .collect(),
        Err(e) => {
            log::warn!("cannot enumerate network interfaces: {e}");
            Vec::new()
        }
    }
}

/// The port the local web/WS server listens on — the webview client asks for this.
#[tauri::command]
fn backend_info(state: tauri::State<'_, Backend>) -> serde_json::Value {
    let cfg = state.state.config.read();
    serde_json::json!({ "wsPort": cfg.server.port })
}

pub fn run(headless: bool) {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let backend = start_backend();
    let state = backend.state.clone();

    if headless {
        log::info!("headless mode: no desktop window; web UI only");
        // Park until Ctrl+C or a shutdown (e.g. a successor took over).
        while !state.shutdown.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        return;
    }

    tauri::Builder::default()
        .manage(backend)
        .invoke_handler(tauri::generate_handler![backend_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    state.shutdown.store(true, Ordering::SeqCst);
}
