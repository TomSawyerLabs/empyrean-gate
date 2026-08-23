//! Empyrean Gate backend. The frame-generation engine, audio analysis, sACN output,
//! and web/WS server all run here, independent of any UI. The Tauri window is an
//! optional shell (skipped in `--headless` mode) whose webview is just another
//! WebSocket client of the local server.

pub mod audio;
pub mod autostart;
pub mod config;
pub mod engine;
pub mod geometry;
pub mod layers;
pub mod logging;
pub mod media;
pub mod patch;
pub mod power;
pub mod protocol;
pub mod report;
pub mod rhythm;
pub mod sacn;
pub mod server;
pub mod state;
/// Windows-only: suppress the OS's touch feedback visuals on our windows.
#[cfg(target_os = "windows")]
pub mod touch;
pub mod updater;
pub mod videocache;
pub mod firewall;

use std::sync::atomic::Ordering;
use std::sync::Arc;
use state::SharedState;

pub struct Backend {
    pub state: Arc<SharedState>,
}

/// What the instance already holding our port reports, or `None` if it is too
/// old to say (pre-0.5.2) or unreachable.
fn running_instance_version(port: u16) -> Option<String> {
    let mut resp = handover_agent()
        .get(format!("http://127.0.0.1:{port}/version"))
        .call()
        .ok()?;
    let body: serde_json::Value = resp.body_mut().read_json().ok()?;
    body["version"].as_str().map(str::to_owned)
}

/// Ask the instance holding the port to bring its window forward. Best effort:
/// older instances have no such endpoint.
fn focus_running_instance(port: u16) {
    let _ = handover_agent()
        .post(format!("http://127.0.0.1:{port}/focus"))
        .send_empty();
}

/// True when the instance on our port is NEWER than us, in which case taking
/// over from it would be a silent downgrade of a possibly-live show.
///
/// This is the failure that was reported from the field: a self-update leaves the
/// updated binary running while the launcher path still holds the old one, so the
/// next double-click started the OLD version, which found the port busy, took
/// over, and put v0.4.0 back on the rig. Updates now also promote themselves over
/// the launcher path (see `updater`), but this guard is what makes the downgrade
/// impossible rather than merely unlikely.
fn running_instance_is_newer(port: u16) -> Option<String> {
    let running = running_instance_version(port)?;
    let ours = updater::effective_version();
    let parse = |v: &str| -> Option<(u32, u32, u32)> {
        let mut it = v.trim_start_matches('v').split('.').map(|p| p.parse::<u32>().ok());
        Some((it.next()??, it.next()??, it.next()??))
    };
    match (parse(&running), parse(&ours)) {
        (Some(theirs), Some(mine)) if theirs > mine => Some(running),
        _ => None,
    }
}

/// Start every backend subsystem. UI-independent; returns immediately.
///
/// If another instance is already running on our port, take over from it: warm the
/// GPU engine first (sACN gated), ask the old instance to stop and hand back its
/// running state (config + layer phases), then start sending — the structure sees
/// at most a few frames of hold, and patterns continue without a visual jump.
/// The exception is an instance NEWER than us, which we refuse to displace.
pub fn start_backend() -> Backend {
    let cfg = config::load();
    // Re-register at every launch so the Run key follows the current exe across
    // self-update binary swaps.
    autostart::sync(cfg.autostart);
    let port = cfg.server.port;
    let takeover = port_in_use(port);
    // Refuse to take the port from a NEWER instance — that is a downgrade, and
    // if a show is running it happens on the wire. Checked before any subsystem
    // starts, so the loser leaves nothing behind.
    if takeover
        && let Some(newer) = running_instance_is_newer(port)
    {
        log::warn!(
            "v{newer} is already running on port {port} and this binary is v{}; \
             refusing to take over — that would downgrade a running show. \
             Focusing the running instance and exiting.",
            updater::CURRENT_VERSION
        );
        focus_running_instance(port);
        std::process::exit(0);
    }
    let state = SharedState::new(cfg);
    {
        let mut st = state.status.lock();
        st.interfaces = list_interfaces();
        st.version = updater::effective_version();
        st.firewall_pending = firewall::rule_missing(port);
    }
    if takeover {
        log::info!("port {port} is busy — attempting takeover of the running instance");
        state.sacn_hold.store(true, Ordering::SeqCst);
    }
    let remote_chains = audio::spawn(state.clone());
    rhythm::spawn(state.clone());
    engine::spawn(state.clone());
    power::spawn(state.clone());

    if takeover {
        // Two-phase takeover. Phase 1 (old instance keeps sending): fetch its
        // running state and fully prepare — adopt config (sACN plan, buffers) and
        // phases, then let a few frames flow through the render+readback pipeline
        // so we could send *immediately*. Phase 2: commit — the old instance
        // quiesces (acked), returns fresh phases (drift correction), and exits;
        // we ungate sACN and the very next engine tick sends. Wire gap ≈ 1-2
        // frame periods.
        wait_for_engine(&state, std::time::Duration::from_secs(8));
        let t0 = std::time::Instant::now();
        let prepared = match fetch_handover_state(port) {
            Ok(grant) => {
                log::info!("takeover phase 1: adopted running state; warming pipeline");
                *state.layer_phases.lock() = grant.layer_phases;
                state.phases_transplanted.store(true, Ordering::SeqCst);
                state.update_config(|c| *c = grant.config);
                wait_frames(&state, 3, std::time::Duration::from_secs(2));
                true
            }
            Err(e) => {
                log::warn!("old instance has no prepare endpoint ({e}); single-phase takeover");
                false
            }
        };
        match commit_handover(port) {
            Ok(grant) => {
                *state.layer_phases.lock() = grant.layer_phases;
                state.phases_transplanted.store(true, Ordering::SeqCst);
                if !prepared {
                    state.update_config(|c| *c = grant.config);
                }
                // Only the COMMIT grant's sequence number is authoritative: it is
                // read after the old instance acked its final send, whereas the
                // phase-1 value goes stale while that instance keeps transmitting
                // through our warm-up. Set before `sacn_hold` is lifted below, and
                // consumed by the engine immediately before its first send.
                if let Some(seq) = grant.sacn_sequence {
                    state.sacn_resume_sequence.store(seq, Ordering::SeqCst);
                    state.sacn_resume_pending.store(true, Ordering::SeqCst);
                }
                log::info!(
                    "takeover committed in {:.0} ms total; resuming sACN",
                    t0.elapsed().as_secs_f32() * 1000.0
                );
            }
            Err(e) => {
                log::warn!(
                    "takeover commit failed ({e}); continuing anyway — the server will \
                     retry binding the port"
                );
            }
        }
        state.sacn_hold.store(false, Ordering::SeqCst);
    }

    server::spawn(state.clone(), remote_chains);
    updater::spawn(state.clone());
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

fn handover_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(5)))
        .build()
        .into()
}

fn fetch_handover_state(port: u16) -> anyhow::Result<protocol::HandoverGrant> {
    let mut resp = handover_agent()
        .get(format!("http://127.0.0.1:{port}/handover/state"))
        .call()?;
    Ok(resp.body_mut().read_json::<protocol::HandoverGrant>()?)
}

fn commit_handover(port: u16) -> anyhow::Result<protocol::HandoverGrant> {
    let mut resp = handover_agent()
        .post(format!("http://127.0.0.1:{port}/handover"))
        .send_empty()?;
    Ok(resp.body_mut().read_json::<protocol::HandoverGrant>()?)
}

/// Wait until the engine has rendered `n` more frames (pipeline warm with the
/// adopted config) or the timeout passes.
fn wait_frames(state: &SharedState, n: u64, timeout: std::time::Duration) {
    let start = std::time::Instant::now();
    let base = state.frames_rendered.load(Ordering::Relaxed);
    while state.frames_rendered.load(Ordering::Relaxed) < base + n && start.elapsed() < timeout {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

/// Give the engine a moment to put E1.31 stream-termination packets on the wire
/// before the process goes away. Without this, `run` returns straight into process
/// teardown and the rig is left holding its last frame until the receivers time out.
fn await_sacn_terminate(state: &SharedState) {
    let start = std::time::Instant::now();
    while !state.sacn_terminated.load(Ordering::SeqCst)
        && start.elapsed() < std::time::Duration::from_millis(500)
    {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
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

pub fn run(headless: bool, promote_to: Option<std::path::PathBuf>) {
    logging::init();
    log::info!(
        "Empyrean Gate v{} starting from {}",
        updater::CURRENT_VERSION,
        std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "<unknown>".into())
    );
    let backend = start_backend();
    let state = backend.state.clone();
    state.headless.store(headless, Ordering::SeqCst);

    // A self-update spawned us from a versioned sibling; take the launcher's
    // place now that the takeover is done and the old process has let go of it.
    // Off the startup path — the copy retries for a few seconds.
    if let Some(target) = promote_to {
        std::thread::spawn(move || updater::promote_over(&target));
    }

    if headless {
        log::info!("headless mode: no desktop window; web UI only");
        // Park until Ctrl+C or a shutdown (e.g. a successor took over).
        while !state.shutdown.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        await_sacn_terminate(&state);
        return;
    }

    tauri::Builder::default()
        .manage(backend)
        // Persists per-label window geometry (position/size/maximized) across
        // restarts — and across versions, since the state file lives in the app
        // config dir. Combined with stable aux labels, a self-update handover
        // brings every window back where it was.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            backend_info,
            open_aux,
            confirm_close,
            cancel_close
        ])
        .setup(|app| {
            use tauri::Manager;
            // The show display is a touch screen: kill the OS contact visuals on
            // every window (again shortly after, once WebView2 has created the
            // child HWNDs that touch input actually lands on).
            harden_touch_visuals(app.handle());
            let touch_handle = app.handle().clone();
            std::thread::spawn(move || {
                for _ in 0..4 {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let handle = touch_handle.clone();
                    let _ = touch_handle.run_on_main_thread(move || harden_touch_visuals(&handle));
                }
            });
            // Recreate the aux windows that were open last run (their geometry is
            // restored by the window-state plugin via their stable labels).
            let aux: Vec<String> = {
                let backend = app.state::<Backend>();
                let cfg = backend.state.config.read();
                cfg.windows.aux_open.clone()
            };
            for tab in aux {
                if let Err(e) = open_aux_window(app.handle(), &tab) {
                    log::warn!("could not restore '{tab}' window: {e}");
                }
            }
            // The handover exit path is process::exit, which skips graceful window
            // teardown — save window state periodically so at most ~5 s of window
            // moves can be lost.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    let _ = handle.save_window_state(StateFlags::all());
                }
            });
            // A second launch that refused to take our port asks us to come
            // forward (POST /focus) — so a stale shortcut surfaces this window
            // instead of appearing to do nothing.
            let focus_handle = app.handle().clone();
            let focus_state = app.state::<Backend>().state.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    if focus_state.focus_requested.swap(false, Ordering::SeqCst) {
                        let handle = focus_handle.clone();
                        let _ = focus_handle.run_on_main_thread(move || {
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        });
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // A user closing an aux window removes it from the restore list;
            // process teardown fires Destroyed (not CloseRequested), so app exit
            // keeps the list intact.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                if let Some(tab) = window.label().strip_prefix("aux-") {
                    let tab = tab.to_string();
                    let backend = window.app_handle().state::<Backend>();
                    backend.state.update_config(|c| {
                        c.windows.aux_open.retain(|t| *t != tab);
                    });
                    return;
                }
                // Closing the main window kills the show: the engine stops, the
                // rig goes dark, and on a touch display the X is a few pixels
                // from the controls. While sACN is actually transmitting, the
                // close is refused and handed to the UI to confirm.
                use tauri::Emitter;
                let backend = window.app_handle().state::<Backend>();
                if backend.state.output_live() && !backend.state.close_confirmed() {
                    api.prevent_close();
                    if let Err(e) = window.emit("close-requested", ()) {
                        // If the UI cannot be reached to ask, refusing forever
                        // would trap the operator with no way to quit.
                        log::warn!("close confirmation could not reach the UI ({e}); closing");
                        backend.state.confirm_close();
                        let _ = window.close();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    state.shutdown.store(true, Ordering::SeqCst);
    await_sacn_terminate(&state);
}

/// Suppress the OS's touch feedback visuals on every window we own. Idempotent,
/// and called repeatedly at startup because the child HWNDs that WebView2 hosts
/// its content in (where touch input lands) appear after the window does.
#[cfg(target_os = "windows")]
fn harden_touch_visuals(app: &tauri::AppHandle) {
    use tauri::Manager;
    for window in app.webview_windows().values() {
        if let Ok(hwnd) = window.hwnd() {
            touch::disable_feedback_visuals(hwnd.0 as isize);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn harden_touch_visuals(_app: &tauri::AppHandle) {}

/// The operator confirmed closing a live show: let the next close through and
/// ask for it. Goes through the normal close path so the engine still sends
/// E1.31 stream termination rather than leaving the rig on its last look.
#[tauri::command]
fn confirm_close(app: tauri::AppHandle, state: tauri::State<'_, Backend>) {
    use tauri::Manager;
    state.state.confirm_close();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

/// They changed their mind — re-arm the guard for the next accidental tap.
#[tauri::command]
fn cancel_close(state: tauri::State<'_, Backend>) {
    state.state.cancel_close();
}

/// Create (or focus) the popped-out window for a tab, with a stable label so the
/// window-state plugin can restore its geometry. Records it for restore-on-start.
#[tauri::command]
fn open_aux(app: tauri::AppHandle, tab: String, state: tauri::State<'_, Backend>) -> Result<(), String> {
    use tauri::Manager;
    let label = format!("aux-{tab}");
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(());
    }
    open_aux_window(&app, &tab).map_err(|e| e.to_string())?;
    state.state.update_config(|c| {
        if !c.windows.aux_open.contains(&tab) {
            c.windows.aux_open.push(tab.clone());
        }
    });
    Ok(())
}

fn open_aux_window(app: &tauri::AppHandle, tab: &str) -> tauri::Result<()> {
    let label = format!("aux-{tab}");
    // The hash is applied by an init script (a fragment inside WebviewUrl::App
    // paths does not survive URL conversion reliably).
    let builder =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title(format!("Empyrean Gate — {tab}"))
            .inner_size(900.0, 900.0)
            .zoom_hotkeys_enabled(false)
            .initialization_script(format!("if (!location.hash) location.hash = '#{tab}';"));
    // Same gesture suppression the main window gets from tauri.conf.json (the
    // first group is wry's own default, which passing this option replaces).
    #[cfg(target_os = "windows")]
    let builder = builder.additional_browser_args(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
         --disable-pinch --overscroll-history-navigation=0",
    );
    builder.build()?;
    harden_touch_visuals(app);
    Ok(())
}
