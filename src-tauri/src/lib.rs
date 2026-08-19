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
pub fn start_backend() -> Backend {
    let cfg = config::load();
    let state = SharedState::new(cfg);
    state.status.lock().interfaces = list_interfaces();
    let remote_chains = audio::spawn(state.clone());
    engine::spawn(state.clone());
    server::spawn(state.clone(), remote_chains);
    Backend { state }
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
        // Park until Ctrl+C; the OS teardown stops the threads.
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
        }
    }

    tauri::Builder::default()
        .manage(backend)
        .invoke_handler(tauri::generate_handler![backend_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    state.shutdown.store(true, Ordering::SeqCst);
}
