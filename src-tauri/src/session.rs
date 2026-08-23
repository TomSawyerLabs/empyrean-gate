//! Is this process's desktop owned by a remote (RDP) session?
//!
//! Connecting to the gate machine over RDP *takes over* the console session:
//! the physical show display drops to the logon screen, and every window is
//! re-laid-out into RDP's virtual display — a different resolution, a different
//! DPI, and the show window knocked out of fullscreen. Windows reports all of
//! that as ordinary move/resize events, so anything persisting window geometry
//! records the remote session's layout over the show's own, and the gate display
//! comes back windowed after a remote visit.
//!
//! Declared by hand rather than pulling in the `windows` crate — one call, the
//! same way `taskbar` does it.

/// `SM_REMOTESESSION` (winuser.h). Nonzero while the calling process is running
/// in a remote session.
#[cfg(target_os = "windows")]
const SM_REMOTESESSION: i32 = 0x1000;

/// True while an RDP client owns this session's desktop.
#[cfg(target_os = "windows")]
pub fn is_remote() -> bool {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetSystemMetrics(index: i32) -> i32;
    }

    // SAFETY: takes an index by value and has no failure mode beyond returning
    // 0 for an index it doesn't know.
    unsafe { GetSystemMetrics(SM_REMOTESESSION) != 0 }
}

/// Non-Windows targets — the headless Linux show machines — have no equivalent
/// takeover: nothing re-lays-out the window behind the app's back.
#[cfg(not(target_os = "windows"))]
pub fn is_remote() -> bool {
    false
}
