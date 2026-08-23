//! Self-update from GitHub Releases — no installer, no downtime.
//!
//! Standalone binaries make this simple: the new version is downloaded to a
//! VERSIONED SIBLING FILE next to the running exe (never overwriting it — Windows
//! locks running images anyway), then spawned. The successor performs the standard
//! two-phase takeover (warm GPU → /handover → old instance stops sACN and exits),
//! so an update is a ~one-frame hot-swap even mid-show. Old versioned binaries are
//! deleted on later startups.
//!
//! Auto-CHECK is on by default (every 6 h + at startup); auto-INSTALL is opt-in —
//! the swap is seamless, but whether to take an update mid-show is the operator's
//! call. Both are also triggerable from the UI.
//!
//! ## Promotion, and why it matters
//!
//! The successor runs from the versioned sibling, so without a further step the
//! path the operator actually launches (a desktop shortcut, the Start menu, the
//! downloaded `empyrean-gate-windows-x64.exe`) still holds the OLD binary. The
//! next double-click then starts the old version, which finds the port busy and
//! *takes over* — silently downgrading a running show, which is exactly what was
//! reported in the field after v0.4.0 -> v0.5.1.
//!
//! So the successor is told where it came from (`--promote-to <path>`) and, once
//! the takeover is committed and the old process has released the file, copies
//! itself over that path. Windows cannot overwrite a *running* image, but the
//! old process is gone by then; the copy is retried for a few seconds to cover
//! the gap. Launch-at-login is re-pointed at the same path afterwards.

use crate::state::SharedState;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

const REPO: &str = "cinderblock/empyrean-gate";
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 3600);

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The version this instance presents to everyone — status, `/version`, and the
/// downgrade guard. Honors the `EMPYREAN_FAKE_VERSION` test hook so the whole
/// update path can be exercised without cutting a release.
pub fn effective_version() -> String {
    // Test hook: fake a lower running version to exercise the full update path.
    std::env::var("EMPYREAN_FAKE_VERSION").unwrap_or_else(|_| CURRENT_VERSION.to_string())
}

fn asset_name() -> Option<&'static str> {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("empyrean-gate-windows-x64.exe")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("empyrean-gate-linux-x64")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("empyrean-gate-macos-arm64")
    } else {
        None
    }
}

fn parse_version(v: &str) -> Option<(u32, u32, u32)> {
    let v = v.trim_start_matches('v');
    let mut it = v.split('.').map(|p| p.parse::<u32>().ok());
    Some((it.next()??, it.next()??, it.next()??))
}

fn set_update_status(state: &SharedState, available: Option<String>, note: &str) {
    let mut st = state.status.lock();
    st.update_available = available;
    st.update_state = note.to_string();
    drop(st);
    // Nudge clients so the panel refreshes promptly (status also ticks at 2 Hz).
    state.broadcast_state();
}

pub fn spawn(state: Arc<SharedState>) {
    std::thread::Builder::new()
        .name("updater".into())
        .spawn(move || updater_thread(state))
        .expect("spawn updater thread");
}

fn updater_thread(state: Arc<SharedState>) {
    cleanup_old_binaries();

    // First auto-check shortly after startup, then every CHECK_INTERVAL.
    let mut next_check = Instant::now() + Duration::from_secs(30);
    let mut latest: Option<(String, String)> = None; // (version, download url)

    while !state.shutdown.load(Ordering::Relaxed) {
        let manual_check = state.update_check_requested.swap(false, Ordering::SeqCst);
        let install = state.update_install_requested.swap(false, Ordering::SeqCst);
        let auto_check = state.config.read().update.auto_check;

        if manual_check || (auto_check && Instant::now() >= next_check) {
            next_check = Instant::now() + CHECK_INTERVAL;
            match check_latest() {
                Ok(Some((version, url))) => {
                    if is_newer(&version) {
                        log::info!("update available: v{version} (running v{})", effective_version());
                        latest = Some((version.clone(), url));
                        set_update_status(&state, Some(version), "");
                        if state.config.read().update.auto_install {
                            state.update_install_requested.store(true, Ordering::SeqCst);
                        }
                    } else {
                        latest = None;
                        set_update_status(&state, None, "up to date");
                    }
                }
                Ok(None) => set_update_status(&state, None, "no release found"),
                Err(e) => {
                    log::warn!("update check failed: {e:#}");
                    set_update_status(&state, None, &format!("check failed: {e}"));
                }
            }
        }

        if install {
            if let Some((version, url)) = latest.clone() {
                set_update_status(&state, Some(version.clone()), "downloading…");
                match download_and_launch(&version, &url, &state) {
                    Ok(()) => {
                        // The successor's takeover will shut us down; just wait.
                        set_update_status(&state, Some(version), "handing over…");
                    }
                    Err(e) => {
                        log::error!("update install failed: {e:#}");
                        set_update_status(&state, Some(version), &format!("install failed: {e}"));
                    }
                }
            } else {
                set_update_status(&state, None, "no update staged — check first");
            }
        }

        std::thread::sleep(Duration::from_millis(500));
    }
}

fn is_newer(candidate: &str) -> bool {
    match (parse_version(candidate), parse_version(&effective_version())) {
        (Some(c), Some(cur)) => c > cur,
        _ => false,
    }
}

/// Latest release's (version, asset download url) for this platform.
fn check_latest() -> anyhow::Result<Option<(String, String)>> {
    let Some(asset) = asset_name() else {
        anyhow::bail!("no release asset for this platform");
    };
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .into();
    let mut resp = agent
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("User-Agent", "empyrean-gate-updater")
        .call()?;
    let body: serde_json::Value = resp.body_mut().read_json()?;
    let tag = body["tag_name"].as_str().unwrap_or_default();
    let version = tag.trim_start_matches('v').to_string();
    if version.is_empty() {
        return Ok(None);
    }
    let url = body["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| a["name"].as_str() == Some(asset))
        .and_then(|a| a["browser_download_url"].as_str())
        .map(str::to_string);
    match url {
        Some(url) => Ok(Some((version, url))),
        None => anyhow::bail!("release v{version} has no asset '{asset}'"),
    }
}

fn versioned_path(version: &str) -> anyhow::Result<PathBuf> {
    let current = std::env::current_exe()?;
    let dir = current
        .parent()
        .ok_or_else(|| anyhow::anyhow!("current exe has no parent dir"))?;
    let ext = if cfg!(windows) { ".exe" } else { "" };
    Ok(dir.join(format!("empyrean-gate-v{version}{ext}")))
}

/// Download the new binary next to the current one and launch it; the successor
/// takes over via the standard two-phase handover and this process exits.
fn download_and_launch(version: &str, url: &str, state: &SharedState) -> anyhow::Result<()> {
    let target = versioned_path(version)?;
    let tmp = target.with_extension("download");

    log::info!("downloading v{version} from {url}");
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(600)))
        .build()
        .into();
    let mut resp = agent
        .get(url)
        .header("User-Agent", "empyrean-gate-updater")
        .call()?;
    let mut reader = resp.body_mut().as_reader();
    let mut file = std::fs::File::create(&tmp)
        .map_err(|e| anyhow::anyhow!("cannot write next to the current exe ({e}); is the directory writable?"))?;
    let bytes = std::io::copy(&mut reader, &mut file)?;
    drop(file);
    anyhow::ensure!(
        bytes > 1_000_000,
        "downloaded file is implausibly small ({bytes} bytes)"
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&tmp, &target)?;
    log::info!("downloaded {} ({bytes} bytes); launching successor", target.display());

    let mut cmd = std::process::Command::new(&target);
    if state.headless.load(Ordering::Relaxed) {
        cmd.arg("--headless");
    }
    // Hand the successor the path we were launched from, so it can take our
    // place there once we are gone (see the module docs).
    if let Ok(current) = std::env::current_exe() {
        cmd.arg("--promote-to").arg(current);
    }
    cmd.spawn()
        .map_err(|e| anyhow::anyhow!("failed to launch {}: {e}", target.display()))?;
    Ok(())
}

/// Copy this running binary over `target`, which is where the operator launches
/// from. Called after a takeover, once the process that held `target` has exited.
///
/// Retries: on Windows the file stays locked until the old process is fully gone,
/// and that happens a moment after it acknowledges the handover.
pub fn promote_over(target: &std::path::Path) {
    let Ok(running) = std::env::current_exe() else {
        return;
    };
    if running == target {
        return; // already the launcher
    }
    let mut last_err = None;
    for attempt in 0..30 {
        std::thread::sleep(Duration::from_millis(200));
        match std::fs::copy(&running, target) {
            Ok(_) => {
                log::info!(
                    "promoted v{CURRENT_VERSION} over {} after {} attempt(s)",
                    target.display(),
                    attempt + 1
                );
                // Launch-at-login must follow, or the machine boots the binary we
                // just replaced (which would then take over and downgrade).
                let autostart = crate::config::load().autostart;
                if autostart {
                    crate::autostart::sync_path(true, target);
                }
                return;
            }
            Err(e) => last_err = Some(e),
        }
    }
    log::error!(
        "could not promote over {} ({:?}) — the launcher still holds the old \
         version and will start it again on the next manual launch",
        target.display(),
        last_err
    );
}

/// True when the running image is the versioned file an update downloads, e.g.
/// `empyrean-gate-v0.5.3.exe`, rather than a launcher the operator double-clicks.
fn running_from_versioned_sibling() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .and_then(|name| {
            let ext = if cfg!(windows) { ".exe" } else { "" };
            Some(name == format!("empyrean-gate-v{}{ext}", effective_version()))
        })
        .unwrap_or(false)
}

/// Promote without having been told where to.
///
/// Binaries older than v0.5.2 don't pass `--promote-to`, so an update *from* one
/// of them would otherwise leave the launcher holding the old version forever —
/// the operator would have to install by hand once to escape. They don't: the new
/// binary can work out the launcher itself. It is a file next to us, named like
/// us, that isn't one of the versioned downloads.
///
/// Only called after taking over an instance that was OLDER than us, which is
/// what makes this safe: the launcher we are about to replace is by construction
/// the thing that started that older instance. A launcher NEWER than us can never
/// be a candidate, because we would have refused to take its port at all.
pub fn promote_over_discovered_launchers() {
    if !running_from_versioned_sibling() {
        return; // already the launcher; nothing to heal
    }
    let Ok(running) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = running.parent() else { return };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    let mut found = false;
    for entry in entries.flatten() {
        let path = entry.path();
        if path == running || !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        // The names an operator actually ends up with: `empyrean-gate.exe`,
        // `empyrean-gate-windows-x64.exe` straight from the release page, or a
        // rename like `EmpyreanGate.exe`. Never a `-v<version>` download, and
        // never something that merely shares the directory.
        if !lower.contains("empyrean") || lower.starts_with("empyrean-gate-v") {
            continue;
        }
        if cfg!(windows) && !lower.ends_with(".exe") {
            continue;
        }
        log::info!("no --promote-to given; promoting over discovered launcher {name}");
        promote_over(&path);
        found = true;
    }
    if !found {
        // Not fatal, but worth saying out loud: the operator will keep starting
        // the old version by hand until they replace it themselves.
        log::warn!(
            "running from a versioned download in {} but found no launcher to \
             promote over — a launcher named something without \"empyrean\" in \
             it cannot be recognised, so it will keep starting the old version",
            dir.display()
        );
    }
}

/// Delete versioned sibling binaries older than the running version. The running
/// image can't be deleted on Windows (locked) and is skipped anyway; failures are
/// ignored — cleanup is best-effort.
fn cleanup_old_binaries() {
    let Ok(current_exe) = std::env::current_exe() else { return };
    let Some(dir) = current_exe.parent() else { return };
    let Some(cur) = parse_version(&effective_version()) else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(rest) = name.strip_prefix("empyrean-gate-v") else { continue };
        let version_part = rest.trim_end_matches(".exe");
        if let Some(v) = parse_version(version_part) {
            // `<=`, not `<`: after promotion the versioned sibling we were
            // launched from is the same version as the running (promoted) image
            // and is now dead weight. The running image itself is skipped.
            if v <= cur && entry.path() != current_exe {
                match std::fs::remove_file(entry.path()) {
                    Ok(()) => log::info!("cleaned up old binary {name}"),
                    Err(_) => {} // probably still running (mid-handover); next boot
                }
            }
        }
    }
}
