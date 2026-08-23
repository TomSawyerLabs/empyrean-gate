//! Windows taskbar identity.
//!
//! Self-updates run the app from a new file each time (`empyrean-gate-v0.5.5.exe`,
//! then `-v0.5.6.exe`, …). Windows derives a window's taskbar identity from the
//! executable path unless it is told otherwise, so every update produced a fresh
//! taskbar button — and a pinned shortcut stopped matching the running app.
//!
//! Declaring an explicit AppUserModelID makes the identity the *application*
//! rather than the file on disk: one button, kept across updates, and pinning
//! works. Must be set before any window exists, hence the call at the very top
//! of `run`.
//!
//! Declared by hand rather than pulling in the `windows` crate — one call.

/// Matches `identifier` in tauri.conf.json, which is also what the webview data
/// folder is keyed on; keeping them the same means one identity for the app.
#[cfg(target_os = "windows")]
const APP_ID: &str = "com.empyrean.gate";

#[cfg(target_os = "windows")]
pub fn set_app_identity() {
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }

    let wide: Vec<u16> = APP_ID.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 buffer that outlives the call.
    let hr = unsafe { SetCurrentProcessExplicitAppUserModelID(wide.as_ptr()) };
    if hr == 0 {
        log::info!("taskbar identity set to {APP_ID}");
    } else {
        // Not fatal: the app runs, it just gets a per-exe taskbar button again.
        log::warn!("could not set the taskbar identity (hr {hr:#x})");
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_app_identity() {}
