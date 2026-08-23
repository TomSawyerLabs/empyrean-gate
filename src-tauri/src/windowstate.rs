//! Keep a remote session from overwriting the show's window geometry on exit.
//!
//! `tauri-plugin-window-state` holds the geometry it will persist in an
//! in-memory cache, updated by its own move/resize listeners. An RDP session
//! re-lays-out every window into its virtual display, and Windows reports that
//! as ordinary move/resize events — so the cache fills with the remote layout
//! no matter what we do. `session::is_remote` lets the *periodic* save in `run`
//! decline to write that to disk, but the plugin also writes the cache once
//! itself, from its `RunEvent::Exit` handler, which the guard cannot reach.
//!
//! That leaves the worst case still open: quitting or restarting the app while
//! connected over RDP. Which is exactly what you do after an RDP visit has
//! knocked the show window around — so the one path most likely to be taken was
//! the one still corrupting the geometry.
//!
//! So: snapshot the file the moment a remote session appears — at which point
//! it still describes the show's own layout, because the periodic save has been
//! keeping it that way — and write it back after the plugin's exit-time save.
//! Tauri dispatches plugin `RunEvent` handlers *before* the app-level `run`
//! callback (`on_event_loop_event`, tauri's `app.rs`), so ours lands last.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// The window geometry as it stood while the desktop was still local, captured
/// on the transition into a remote session. `None` until that happens, which is
/// also the whole-lifetime state of a machine nobody ever remotes into.
#[derive(Clone, Default)]
pub struct LocalGeometry(Arc<Mutex<Option<Vec<u8>>>>);

impl LocalGeometry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Remember what is on disk right now. Called as a remote session appears,
    /// while the file still holds the show's layout.
    pub fn capture(&self, app: &tauri::AppHandle) {
        let Some(path) = state_path(app) else { return };
        match std::fs::read(&path) {
            Ok(bytes) => {
                *self.0.lock().unwrap() = Some(bytes);
                log::info!("captured the local window geometry before the remote session");
            }
            // Typically just a first run with no state file yet: nothing to
            // protect, and nothing to put back on the way out.
            Err(e) => log::debug!("no window geometry to capture ({e})"),
        }
    }

    /// Put the captured geometry back, over whatever the plugin just wrote from
    /// its remote-polluted cache. No-op if we never saw a remote session.
    pub fn restore(&self, app: &tauri::AppHandle) {
        let Some(bytes) = self.0.lock().unwrap().clone() else {
            return;
        };
        let Some(path) = state_path(app) else { return };
        match std::fs::write(&path, &bytes) {
            Ok(()) => {
                log::info!("exited from a remote session; restored the local window geometry")
            }
            // Not fatal: the app is on its way out either way, and the cost is
            // a window that comes back at the remote session's size.
            Err(e) => log::warn!("could not restore the local window geometry ({e})"),
        }
    }
}

/// Where the plugin keeps its state. The filename is asked of the plugin rather
/// than hard-coded, so changing it in one place cannot silently desync the two.
fn state_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    use tauri_plugin_window_state::AppHandleExt;

    match app.path().app_config_dir() {
        Ok(dir) => Some(dir.join(app.filename())),
        Err(e) => {
            log::warn!("no app config dir to find the window geometry in ({e})");
            None
        }
    }
}
