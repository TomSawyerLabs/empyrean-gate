//! Windows only: the Evergreen WebView2 runtime that the desktop window needs.
//!
//! Windows 11 ships it. Windows 10 frequently does not — and because this app is
//! deliberately a portable exe with no installer (see the README's "Self-update"
//! section for why: the updater copies itself over the launcher path, which an
//! MSI in Program Files would turn into a UAC prompt mid-show), nothing
//! bootstraps the runtime for us the way an installer normally would.
//!
//! Before this module the failure was silent and baffling: the process started,
//! the backend came up, the lights ran — and no window ever appeared. Nothing in
//! the log said why, because from Tauri's point of view nothing had gone wrong
//! yet.
//!
//! The recovery leans on the thing that makes this app unusual: **the backend is
//! the app**. By the time we check, sACN is already running and the web UI is
//! already being served. A missing webview costs the operator the desktop
//! window, not the show — so the honest fallback is to carry on headless and say
//! where the UI is, never to exit.

#![cfg(windows)]

use std::path::PathBuf;
use std::time::Duration;

/// Microsoft's permanent short link to the Evergreen bootstrapper (~2 MB). It
/// installs per-user when run unelevated, which matters: the operator running a
/// portable exe is not necessarily an administrator.
const BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

pub enum Runtime {
    /// Version string as reported by the loader, e.g. "120.0.2210.91".
    Present(String),
    Missing,
}

/// Ask the WebView2 loader what runtime is available, if any.
///
/// This is the same call the webview itself makes on creation, so it agrees with
/// reality by construction — rather than us second-guessing the registry, where
/// the runtime can be registered per-user, per-machine, or under WOW6432Node,
/// and where a stale key outlives an uninstall.
pub fn detect() -> Runtime {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::core::{PCWSTR, PWSTR};

    let mut version = PWSTR::null();
    // SAFETY: a null browser-executable folder asks for the installed Evergreen
    // runtime, which is what we ship against. On success the loader hands back a
    // COM-allocated string that is ours to free.
    let hr = unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version) };

    if hr.is_err() || version.is_null() {
        return Runtime::Missing;
    }
    let text = unsafe { version.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(version.as_ptr() as *const _)) };

    if text.is_empty() {
        Runtime::Missing
    } else {
        Runtime::Present(text)
    }
}

/// Blocking Yes/No box. Deliberately a native dialog rather than anything of
/// ours: the entire problem is that we cannot render our own UI.
fn ask(title: &str, body: &str) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        IDYES, MB_ICONWARNING, MB_SETFOREGROUND, MB_SYSTEMMODAL, MB_YESNO, MessageBoxW,
    };
    use windows::core::HSTRING;

    let title = HSTRING::from(title);
    let body = HSTRING::from(body);
    // SAFETY: both strings outlive the call; a null owner window is valid and is
    // all we have, since the window we wanted to create is the thing that failed.
    let answer = unsafe {
        MessageBoxW(
            None,
            &body,
            &title,
            MB_YESNO | MB_ICONWARNING | MB_SETFOREGROUND | MB_SYSTEMMODAL,
        )
    };
    answer == IDYES
}

fn notify(title: &str, body: &str) {
    use windows::Win32::UI::WindowsAndMessaging::{
        MB_ICONINFORMATION, MB_SETFOREGROUND, MB_SYSTEMMODAL, MessageBoxW,
    };
    use windows::core::HSTRING;

    let title = HSTRING::from(title);
    let body = HSTRING::from(body);
    // SAFETY: as above.
    unsafe {
        MessageBoxW(
            None,
            &body,
            &title,
            MB_ICONINFORMATION | MB_SETFOREGROUND | MB_SYSTEMMODAL,
        )
    };
}

fn download_bootstrapper() -> anyhow::Result<PathBuf> {
    let target = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");
    log::info!("downloading the WebView2 bootstrapper to {}", target.display());

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(300)))
        .build()
        .into();
    let mut resp = agent
        .get(BOOTSTRAPPER_URL)
        .header("User-Agent", "empyrean-gate-webview2")
        .call()?;
    let mut reader = resp.body_mut().as_reader();
    let mut file = std::fs::File::create(&target)?;
    let bytes = std::io::copy(&mut reader, &mut file)?;
    drop(file);

    // The fwlink redirects; a captive portal or a proxy error page would land
    // here as a small HTML file and then "install" would fail with nothing
    // useful in the log. Same guard the updater uses on its own download.
    anyhow::ensure!(
        bytes > 100_000,
        "downloaded bootstrapper is implausibly small ({bytes} bytes) — check the network"
    );
    Ok(target)
}

fn run_bootstrapper(path: &PathBuf) -> anyhow::Result<()> {
    log::info!("running the WebView2 bootstrapper");
    // `/silent /install` is the documented unattended pair. Unelevated it does a
    // per-user install, which is what we want — asking a portable app's operator
    // for admin is exactly the friction we avoided by not shipping an installer.
    let status = std::process::Command::new(path)
        .args(["/silent", "/install"])
        .status()?;
    anyhow::ensure!(status.success(), "bootstrapper exited with {status}");
    Ok(())
}

/// Returns `true` when a desktop window can be created.
///
/// On a miss this offers to install the runtime and, if that succeeds, reports
/// success so the caller can carry on. Every other path returns `false`, and the
/// caller is expected to continue headless rather than exit — the show is
/// already running by this point.
pub fn ensure_runtime(web_ui_url: &str) -> bool {
    match detect() {
        Runtime::Present(version) => {
            log::info!("WebView2 runtime {version} available");
            return true;
        }
        Runtime::Missing => log::error!(
            "no WebView2 runtime: the desktop window cannot be created. \
             The backend and the web UI are unaffected and are running at {web_ui_url}"
        ),
    }

    let wants_install = ask(
        "Empyrean Gate — desktop window unavailable",
        &format!(
            "Empyrean Gate needs Microsoft's WebView2 runtime to draw its desktop \
             window. Windows 11 includes it; this machine does not have it.\n\n\
             The lights and the web interface are already running, and are not \
             affected — open {web_ui_url} in any browser to control the show.\n\n\
             Install the WebView2 runtime now? (about a 2 MB download from \
             Microsoft; no administrator rights needed)",
        ),
    );

    if !wants_install {
        log::info!("operator declined the WebView2 install; continuing headless");
        return false;
    }

    match download_bootstrapper().and_then(|path| {
        let outcome = run_bootstrapper(&path);
        // Best-effort tidy-up; a leftover in %TEMP% is not worth failing over.
        let _ = std::fs::remove_file(&path);
        outcome
    }) {
        Ok(()) => match detect() {
            Runtime::Present(version) => {
                log::info!("WebView2 runtime {version} installed");
                notify(
                    "Empyrean Gate — WebView2 installed",
                    "The WebView2 runtime is installed. Restart Empyrean Gate to \
                     get the desktop window.\n\n\
                     The show is still running in the meantime.",
                );
                // Deliberately NOT returning true. The runtime landed after this
                // process started, and creating a webview in a process that
                // already probed and missed is not a path worth trusting on a
                // show machine. A restart is one click and is known-good.
                false
            }
            Runtime::Missing => {
                log::error!("bootstrapper reported success but no runtime is available");
                notify(
                    "Empyrean Gate — install did not take",
                    &format!(
                        "The WebView2 installer finished but the runtime still is not \
                         available.\n\nThe show is unaffected — control it at {web_ui_url}",
                    ),
                );
                false
            }
        },
        Err(error) => {
            log::error!("WebView2 install failed: {error:#}");
            notify(
                "Empyrean Gate — install failed",
                &format!(
                    "Could not install the WebView2 runtime: {error}\n\n\
                     You can install it by hand from\n\
                     https://developer.microsoft.com/microsoft-edge/webview2/\n\n\
                     The show is unaffected — control it at {web_ui_url}",
                ),
            );
            false
        }
    }
}

#[cfg(test)]
mod tests {
    /// Exercises the loader binding for real. A wrong signature or a bad free
    /// would crash or return nonsense here rather than on an operator's machine
    /// at the one moment they have no window to read an error in.
    ///
    /// `Missing` is NOT a failure: a dev box or a CI image legitimately might
    /// not have the runtime, and that is the case this module exists to handle.
    /// What is asserted is that a reported version looks like a version.
    #[test]
    fn detect_returns_a_plausible_version_or_a_clean_miss() {
        match super::detect() {
            super::Runtime::Present(version) => {
                eprintln!("detected WebView2 runtime {version}");
                assert!(
                    version.split('.').count() >= 3
                        && version.starts_with(|c: char| c.is_ascii_digit()),
                    "loader reported an implausible version string: {version:?}"
                );
            }
            super::Runtime::Missing => eprintln!("no WebView2 runtime on this machine"),
        }
    }
}
