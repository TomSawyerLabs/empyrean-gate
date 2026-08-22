//! Windows touch-feedback suppression for the show window.
//!
//! Windows draws its own visuals under a contact: the translucent circle on tap,
//! the ring of dots for press-and-hold. They are painted by the OS *over* the
//! window, and on a transparent WebGL canvas the repaint they force shows the
//! canvas's own square backing for a frame — the "square background flashes when
//! I tap" artifact. They are also pure noise on a stage tool: the operator knows
//! where their finger is.
//!
//! `SetWindowFeedbackSetting` is per-HWND and does not inherit, so it has to be
//! applied to the top-level window *and* every child the webview creates
//! (WebView2 hosts its content in child HWNDs, which is where touch actually
//! lands). Non-Windows targets get a no-op.

/// Disable OS-drawn touch/pen feedback for `hwnd` and all of its descendants.
pub fn disable_feedback_visuals(hwnd: isize) {
    imp::disable_tree(hwnd as imp::Hwnd);
}

mod imp {
    use std::ffi::c_void;

    pub type Hwnd = *mut c_void;
    type Bool32 = i32;

    // FEEDBACK_TYPE values (winuser.h). The full set is listed deliberately:
    // leaving any one enabled leaves a visual we would then chase separately.
    const FEEDBACK_TYPES: [u32; 11] = [
        1,  // FEEDBACK_TOUCH_CONTACTVISUALIZATION — the circle under a finger
        2,  // FEEDBACK_PEN_BARRELVISUALIZATION
        3,  // FEEDBACK_PEN_TAP
        4,  // FEEDBACK_PEN_DOUBLETAP
        5,  // FEEDBACK_PEN_PRESSANDHOLD
        6,  // FEEDBACK_PEN_RIGHTTAP
        7,  // FEEDBACK_TOUCH_TAP
        8,  // FEEDBACK_TOUCH_DOUBLETAP
        9,  // FEEDBACK_TOUCH_PRESSANDHOLD — the ring of dots before a right-click
        10, // FEEDBACK_TOUCH_RIGHTTAP
        11, // FEEDBACK_GESTURE_PRESSANDTAP
    ];

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowFeedbackSetting(
            hwnd: Hwnd,
            feedback: u32,
            flags: u32,
            size: u32,
            configuration: *const Bool32,
        ) -> Bool32;
        fn EnumChildWindows(
            parent: Hwnd,
            callback: unsafe extern "system" fn(Hwnd, isize) -> Bool32,
            lparam: isize,
        ) -> Bool32;
    }

    fn disable_one(hwnd: Hwnd) {
        let off: Bool32 = 0;
        for feedback in FEEDBACK_TYPES {
            // SAFETY: `hwnd` comes from the window we own (or one of its live
            // children, inside the enumeration callback), and `configuration`
            // points at a BOOL that outlives the call.
            unsafe {
                SetWindowFeedbackSetting(
                    hwnd,
                    feedback,
                    0,
                    std::mem::size_of::<Bool32>() as u32,
                    &off,
                );
            }
        }
    }

    unsafe extern "system" fn child(hwnd: Hwnd, _lparam: isize) -> Bool32 {
        disable_one(hwnd);
        1 // keep enumerating
    }

    pub fn disable_tree(hwnd: Hwnd) {
        if hwnd.is_null() {
            return;
        }
        disable_one(hwnd);
        // SAFETY: enumerating the children of a window we own; the callback only
        // calls SetWindowFeedbackSetting on each handle it is given.
        unsafe {
            EnumChildWindows(hwnd, child, 0);
        }
    }
}
