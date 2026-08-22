//! Launch-at-login via the per-user Run registry key. Chosen over a Startup
//! shortcut or scheduled task because it needs no admin, no COM, and is trivial
//! to point at a new exe — which matters here: self-updates swap in a new
//! versioned binary, so the running exe re-registers ITSELF at every startup
//! (self-healing after an update or a manual move). Non-Windows: no-op.

#[cfg(windows)]
use std::sync::atomic::{AtomicU8, Ordering};

/// 0 = unknown, 1 = registered, 2 = unregistered. Saves run on every config
/// change (slider drags included); this keeps reg.exe spawns to actual edges.
#[cfg(windows)]
static SYNCED: AtomicU8 = AtomicU8::new(0);

pub fn sync(enabled: bool) {
    #[cfg(windows)]
    {
        // Isolated instances (tests, spare dev copies) must not claim the
        // machine-wide autostart entry.
        if std::env::var_os("EMPYREAN_CONFIG").is_some() {
            return;
        }
        let want = if enabled { 1 } else { 2 };
        if SYNCED.swap(want, Ordering::Relaxed) == want {
            return;
        }
        let Ok(exe) = std::env::current_exe() else { return };
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        const VALUE: &str = "Empyrean Gate";
        if enabled {
            let out = std::process::Command::new("reg")
                .args([
                    "add", KEY, "/v", VALUE, "/t", "REG_SZ", "/d",
                    &format!("\"{}\"", exe.display()),
                    "/f",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            match out {
                Ok(o) if o.status.success() => {
                    log::info!("autostart: registered {}", exe.display());
                }
                Ok(o) => {
                    log::error!(
                        "autostart: reg add failed: {}",
                        String::from_utf8_lossy(&o.stderr).trim()
                    );
                    SYNCED.store(0, Ordering::Relaxed); // retry on next save
                }
                Err(e) => {
                    log::error!("autostart: cannot run reg.exe: {e}");
                    SYNCED.store(0, Ordering::Relaxed);
                }
            }
        } else {
            // Deleting an absent value fails; that is the desired end state.
            let _ = std::process::Command::new("reg")
                .args(["delete", KEY, "/v", VALUE, "/f"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            log::info!("autostart: unregistered");
        }
    }
    #[cfg(not(windows))]
    let _ = enabled;
}
