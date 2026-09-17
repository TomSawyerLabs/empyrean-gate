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
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

// Moved from cinderblock/empyrean-gate on 2026-09-01. Binaries at or before
// v0.10.9 still poll the old path and depend on GitHub's transfer redirect —
// never create a new repo named `empyrean-gate` under the cinderblock account,
// or every fielded copy silently starts reading someone else's releases.
const REPO: &str = "TomSawyerLabs/empyrean-gate";
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
        // Linux ships two shapes of the same release: a bare binary, which needs
        // libwebkit2gtk already on the machine, and an AppImage that carries it.
        // Whichever one is running has to update to its OWN shape — promotion
        // copies the download over the launcher path, so handing an AppImage the
        // bare binary would strip the bundled libraries and leave behind a file
        // that is no longer an AppImage at all.
        //
        // The AppImage runtime exports APPIMAGE with the path to the bundle it
        // launched from; nothing else sets it.
        if std::env::var_os("APPIMAGE").is_some() {
            Some("empyrean-gate-linux-x64.AppImage")
        } else {
            Some("empyrean-gate-linux-x64")
        }
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
    set_update_status_staged(state, available, note, false);
}

fn set_update_status_staged(
    state: &SharedState,
    available: Option<String>,
    note: &str,
    staged: bool,
) {
    let mut st = state.status.lock();
    st.update_available = available;
    st.update_state = note.to_string();
    st.update_staged = staged;
    drop(st);
    // Nudge clients so the panel refreshes promptly (status also ticks at 2 Hz).
    state.broadcast_state();
}

/// Progress of the in-flight download, for the UI's bar. No broadcast: the
/// status stream ticks at 2 Hz, which is plenty for a progress bar.
fn set_download_progress(state: &SharedState, bytes: u64, total: u64) {
    let mut st = state.status.lock();
    st.update_download_bytes = bytes;
    st.update_download_total = total;
}

/// Everything needed to fetch and verify one release asset.
#[derive(Clone)]
struct Release {
    version: String,
    url: String,
    sha256: String,
    /// Asset size from the release metadata; drives the progress bar and the
    /// resume guard. 0 when the API didn't say (then there is no resume).
    size: u64,
    /// Download URL of the detached `.sig` beside the asset. Its presence is
    /// checked at check time — an unsigned release is refused before the
    /// operator is ever offered it — but the 128 bytes are not fetched until
    /// verification, so a 6-hourly check that finds nothing new costs one
    /// request as before.
    signature_url: String,
}

/// Ed25519 public key the Release workflow's signatures must verify against,
/// as 64 hex characters.
///
/// Committed in its own file rather than inlined so that `release.yml` can read
/// the same bytes: the workflow re-verifies its own signature against this file
/// before publishing, which turns "the CI secret and the shipped key disagree"
/// into a failed release instead of a fleet that refuses every future update.
const RELEASE_PUBLIC_KEY_HEX: &str = include_str!("../release-signing.pub");

/// The exact bytes a release signature is made over.
///
/// Binding the version and asset name alongside the digest — rather than signing
/// the digest alone — is what stops a valid signature being moved somewhere it
/// was not meant to go: an asset swapped between platforms (the Linux bare
/// binary's signature presented for the AppImage), or an old release's signed
/// pair replayed under a newer version number. The `v1` prefix is domain
/// separation, so these signatures can never be confused with a signature this
/// project might make over something else later.
///
/// `release.yml` builds this string with `printf` and no trailing newline. The
/// two must agree byte for byte, which is what `signature_vector_from_openssl`
/// pins down.
fn signing_message(version: &str, asset: &str, sha256: &str) -> String {
    format!("empyrean-gate-release-v1\n{version}\n{asset}\n{sha256}")
}

fn decode_hex(input: &str) -> Option<Vec<u8>> {
    let s = input.trim();
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Verify `signature_hex` over `(version, asset, sha256)` against the embedded key.
///
/// The digest passed in must be one this machine computed from the file on disk,
/// never the one the API reported — otherwise the whole check reduces to asking
/// the server to confirm its own claim.
fn verify_release_signature(
    version: &str,
    asset: &str,
    sha256: &str,
    signature_hex: &str,
) -> anyhow::Result<()> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let key_bytes: [u8; 32] = decode_hex(RELEASE_PUBLIC_KEY_HEX)
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| {
            anyhow::anyhow!("embedded release public key is not 32 bytes of hex — build is broken")
        })?;
    let key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|e| anyhow::anyhow!("embedded release public key is not a valid ed25519 key: {e}"))?;

    let sig_bytes: [u8; 64] = decode_hex(signature_hex)
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| anyhow::anyhow!("release signature is not 64 bytes of hex"))?;
    let signature = Signature::from_bytes(&sig_bytes);

    key.verify(signing_message(version, asset, sha256).as_bytes(), &signature)
        .map_err(|_| {
            anyhow::anyhow!(
                "release signature does not verify for {asset} v{version} — refusing to install it"
            )
        })
}

/// True when `target` already holds a plausible copy of the release.
///
/// Survives a restart: the versioned sibling from a previous session's staging is
/// still there, so an operator who declined last night gets an instant install this
/// morning rather than a second 40 MB download. The size floor is the same guard
/// `stage` applies — a truncated or error-page download must not read as ready.
fn already_staged(target: &std::path::Path) -> bool {
    std::fs::metadata(target).is_ok_and(|m| m.is_file() && m.len() > 1_000_000)
}

pub fn spawn(state: Arc<SharedState>) {
    // A local debug bundle may contain fixes newer than the latest published
    // release even when its Cargo version is lower. Letting it auto-update can
    // silently replace that development binary with an older release build.
    if cfg!(debug_assertions) {
        set_update_status(&state, None, "development build — updates disabled");
        return;
    }

    std::thread::Builder::new()
        .name("updater".into())
        .spawn(move || updater_thread(state))
        .expect("spawn updater thread");
}

fn updater_thread(state: Arc<SharedState>) {
    // First auto-check shortly after startup, then every CHECK_INTERVAL.
    let mut next_check = Instant::now() + Duration::from_secs(30);
    let mut latest: Option<Release> = None;
    let mut successor_launched = false;

    while !state.shutdown.load(Ordering::Relaxed) {
        if successor_launched {
            // A double click or queued auto-install request must not launch a
            // second successor while the first one is warming up/taking over.
            state.update_check_requested.store(false, Ordering::SeqCst);
            state.update_install_requested.store(false, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(500));
            continue;
        }
        let manual_check = state.update_check_requested.swap(false, Ordering::SeqCst);
        let install = state.update_install_requested.swap(false, Ordering::SeqCst);
        let auto_check = state.config.read().update.auto_check;

        if manual_check || (auto_check && Instant::now() >= next_check) {
            next_check = Instant::now() + CHECK_INTERVAL;
            match check_latest() {
                Ok(Some(release)) => {
                    let version = release.version.clone();
                    if is_newer(&version) {
                        log::info!("update available: v{version} (running v{})", effective_version());
                        latest = Some(release.clone());
                        set_update_status(&state, Some(version.clone()), "");
                        if state.config.read().update.auto_install {
                            state.update_install_requested.store(true, Ordering::SeqCst);
                        } else {
                            // Stage it anyway. With auto-install off the operator
                            // still has to be able to take the update on one tap
                            // between sets — and downloading 40 MB at that moment
                            // is the part that would make them not bother.
                            set_update_status(&state, Some(version.clone()), "downloading…");
                            match stage(&release, &state) {
                                Ok(_) => set_update_status_staged(
                                    &state,
                                    Some(version),
                                    "ready to install",
                                    true,
                                ),
                                Err(e) => {
                                    // Not fatal: the install path downloads on demand.
                                    log::warn!("could not pre-stage v{version}: {e:#}");
                                    set_update_status(&state, Some(version), "update available");
                                }
                            }
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
            if let Some(release) = latest.clone() {
                let version = release.version.clone();
                set_update_status(&state, Some(version.clone()), "downloading…");
                match download_and_launch(&release, &state) {
                    Ok(()) => {
                        // The successor's takeover will shut us down; just wait.
                        successor_launched = true;
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
    match (
        parse_version(candidate),
        parse_version(&effective_version()),
    ) {
        (Some(c), Some(cur)) => c > cur,
        _ => false,
    }
}

/// The account the Release workflow publishes as. `gh release create` running
/// under the workflow's `GITHUB_TOKEN` is recorded by GitHub as this bot, and
/// every release this repo has ever cut carries it.
///
/// Write access to the repo also permits publishing a release BY HAND — UI or
/// API, with arbitrary binaries attached — which skips the checked build in
/// `release.yml` entirely. Refusing any other author closes that path.
///
/// Be clear about what this is NOT: it trusts an account name in a JSON body,
/// not a signature, and anyone who can make the Release workflow run can still
/// get the bot to publish for them. It raises the bar from "has write access"
/// to "can push a v* tag", which is why it is paired with the tag-protection
/// ruleset rather than standing on its own. Real authenticity needs a signature
/// over the asset — see `plans/ci-security-review.md`.
const RELEASE_AUTHOR: &str = "github-actions[bot]";

/// Latest release for this platform, as far as the GitHub API knows.
fn check_latest() -> anyhow::Result<Option<Release>> {
    let Some(asset) = asset_name() else {
        anyhow::bail!("no release asset for this platform");
    };
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .into();
    let mut resp = agent
        .get(format!(
            "https://api.github.com/repos/{REPO}/releases/latest"
        ))
        .header("User-Agent", "empyrean-gate-updater")
        .call()?;
    let body: serde_json::Value = resp.body_mut().read_json()?;
    let tag = body["tag_name"].as_str().unwrap_or_default();
    let version = tag.trim_start_matches('v').to_string();
    if version.is_empty() {
        return Ok(None);
    }
    // Hard refusal rather than a warning: an unexpected author means the release
    // did not come from the checked build, and there is no version of that worth
    // installing on a rig. The error reaches the operator as the update status.
    let author = body["author"]["login"].as_str().unwrap_or("<none>");
    if author != RELEASE_AUTHOR {
        anyhow::bail!(
            "refusing release v{version}: published by '{author}', not {RELEASE_AUTHOR} \
             — it did not come from the release workflow"
        );
    }
    let release_asset = body["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| a["name"].as_str() == Some(asset))
        .ok_or_else(|| anyhow::anyhow!("release v{version} has no asset '{asset}'"))?;
    let url = release_asset["browser_download_url"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("release asset '{asset}' has no download URL"))?
        .to_string();
    let digest = release_asset["digest"]
        .as_str()
        .and_then(|value| value.strip_prefix("sha256:"))
        .filter(|value| value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or_else(|| anyhow::anyhow!("release asset '{asset}' has no valid SHA-256 digest"))?
        .to_ascii_lowercase();
    let size = release_asset["size"].as_u64().unwrap_or(0);
    // Refuse an unsigned release here rather than at install time: the operator
    // should never be shown an update that cannot pass verification, least of all
    // as a button they can press between sets.
    let signature_asset = format!("{asset}.sig");
    let signature_url = body["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| a["name"].as_str() == Some(signature_asset.as_str()))
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or_else(|| {
            anyhow::anyhow!("release v{version} has no signature '{signature_asset}' — refusing it")
        })?
        .to_string();
    Ok(Some(Release { version, url, sha256: digest, size, signature_url }))
}

/// Fetch the detached signature for a release asset. 128 bytes of hex.
fn fetch_signature(release: &Release) -> anyhow::Result<String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .into();
    let body = agent
        .get(&release.signature_url)
        .header("User-Agent", "empyrean-gate-updater")
        .call()?
        .body_mut()
        .read_to_string()?;
    Ok(body.trim().to_string())
}

/// Confirm a file on disk is the release it claims to be, then that the release
/// was signed by the key this binary ships with.
///
/// Both halves matter and they are not the same check. The digest comparison
/// catches a truncated or corrupted transfer and says so usefully; the signature
/// is the only part that says anything about *who produced the bytes*, because
/// the expected digest and the download URL come from the same API response and
/// an attacker who controls one controls the other.
fn verify_staged_file(path: &std::path::Path, release: &Release) -> anyhow::Result<()> {
    let asset = asset_name().ok_or_else(|| anyhow::anyhow!("no release asset for this platform"))?;
    let actual = sha256_file(path)?;
    if actual != release.sha256 {
        anyhow::bail!(
            "binary failed SHA-256 verification (expected {}, got {actual})",
            release.sha256
        );
    }
    let signature = fetch_signature(release)?;
    verify_release_signature(&release.version, asset, &actual, &signature)
}

fn versioned_path(version: &str) -> anyhow::Result<PathBuf> {
    let current = std::env::current_exe()?;
    let dir = current
        .parent()
        .ok_or_else(|| anyhow::anyhow!("current exe has no parent dir"))?;
    let ext = if cfg!(windows) { ".exe" } else { "" };
    Ok(dir.join(format!("empyrean-gate-v{version}{ext}")))
}

/// Download the new binary next to the current one, then launch it; the successor
/// takes over via the standard two-phase handover and this process exits.
///
/// Two steps rather than one so that staging can happen at check time and the
/// install can be a spawn — see `stage`.
fn download_and_launch(release: &Release, state: &SharedState) -> anyhow::Result<()> {
    let target = stage(release, state)?;
    launch(&target, state)
}

/// Put the release on disk beside the running exe and return where it landed.
///
/// Idempotent: an existing plausible copy is left alone, so repeated checks and
/// restarts do not re-download it. Interrupted transfers leave their partial
/// `.download` file behind on purpose — the next attempt (immediate retry,
/// operator click, or 6-hourly check) resumes it instead of starting the
/// whole download over.
fn stage(release: &Release, state: &SharedState) -> anyhow::Result<PathBuf> {
    let target = versioned_path(&release.version)?;
    // A sibling left by a previous session takes the same verification as a fresh
    // download — signature included. Skipping it here would mean a binary that
    // landed on disk before signatures were enforced, or was tampered with while
    // it sat there overnight, could be launched without ever being checked.
    if already_staged(&target) && verify_staged_file(&target, release).is_ok() {
        log::info!("v{} is already staged at {}", release.version, target.display());
        return Ok(target);
    }
    let tmp = target.with_extension("download");

    // Venue internet drops mid-transfer; each retry picks up the partial.
    let mut attempt = 0;
    let downloaded = loop {
        attempt += 1;
        match download(&tmp, release, state) {
            Ok(bytes) => break Ok(bytes),
            Err(e) if attempt < 3 && !state.shutdown.load(Ordering::Relaxed) => {
                log::warn!("download attempt {attempt} failed ({e:#}); retrying");
                std::thread::sleep(Duration::from_secs(2));
            }
            Err(e) => break Err(e),
        }
    };
    set_download_progress(state, 0, 0);
    let bytes = downloaded?;

    anyhow::ensure!(
        bytes > 1_000_000,
        "downloaded file is implausibly small ({bytes} bytes)"
    );
    // Hash the finished file from disk rather than the stream — a resumed
    // transfer only ever saw the tail, so the stream hash would be meaningless.
    // Then check the signature over that locally computed digest.
    if let Err(e) = verify_staged_file(&tmp, release) {
        // A corrupt partial would fail every future resume the same way, and a
        // file that fails the signature has no business staying on the rig.
        let _ = std::fs::remove_file(&tmp);
        return Err(e.context("downloaded binary failed verification"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| {
            anyhow::anyhow!(
                "cannot replace previously downloaded {}: {e}",
                target.display()
            )
        })?;
    }
    std::fs::rename(&tmp, &target)?;
    log::info!("staged {} ({bytes} bytes)", target.display());
    Ok(target)
}

/// One transfer into `tmp`, resuming an existing partial via an HTTP Range
/// request when possible. Returns the file's total size on completion.
/// Progress is written into the status stream as it goes.
fn download(tmp: &std::path::Path, release: &Release, state: &SharedState) -> anyhow::Result<u64> {
    use std::io::{Read, Write};

    let existing = std::fs::metadata(tmp).map(|m| m.len()).unwrap_or(0);
    // Only a strict prefix of a known total is resumable. Anything else — no
    // size from the API, or a leftover that is somehow at/over the full size
    // yet failed verification — starts over.
    let resume_from = if existing > 0 && existing < release.size {
        existing
    } else {
        0
    };

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(600)))
        .build()
        .into();
    let mut req = agent
        .get(&release.url)
        .header("User-Agent", "empyrean-gate-updater");
    if resume_from > 0 {
        req = req.header("Range", format!("bytes={resume_from}-"));
    }
    let mut resp = req.call()?;

    // 206 = the range was honored, append to the partial. Anything else means
    // the server sent the whole file (or the Range header was lost across the
    // CDN redirect), so the partial is dead weight and the write starts over —
    // correctness never depends on the server supporting ranges.
    let (mut file, mut bytes) = if resume_from > 0 && resp.status() == 206 {
        log::info!(
            "resuming download of v{} at {resume_from} of {} bytes",
            release.version,
            release.size
        );
        (std::fs::OpenOptions::new().append(true).open(tmp)?, resume_from)
    } else {
        log::info!("downloading v{} from {}", release.version, release.url);
        let file = std::fs::File::create(tmp).map_err(|e| {
            anyhow::anyhow!("cannot write next to the current exe ({e}); is the directory writable?")
        })?;
        (file, 0u64)
    };

    set_download_progress(state, bytes, release.size);
    let mut reader = resp.body_mut().as_reader();
    let mut buffer = [0u8; 64 * 1024];
    let mut last_report = Instant::now();
    loop {
        if state.shutdown.load(Ordering::Relaxed) {
            // The partial stays behind; the next boot resumes it.
            anyhow::bail!("shutting down");
        }
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])?;
        bytes += read as u64;
        if last_report.elapsed() > Duration::from_millis(200) {
            last_report = Instant::now();
            set_download_progress(state, bytes, release.size);
        }
    }
    file.sync_all()?;
    set_download_progress(state, bytes, release.size);
    Ok(bytes)
}

fn sha256_file(path: &std::path::Path) -> anyhow::Result<String> {
    use sha2::Digest;
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = sha2::Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Start the staged successor. It takes the port via the two-phase handover and
/// this process exits when it commits.
fn launch(target: &std::path::Path, state: &SharedState) -> anyhow::Result<()> {
    log::info!("launching successor {}", target.display());
    let mut cmd = std::process::Command::new(target);
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
pub(crate) fn cleanup_old_binaries() {
    let Ok(current_exe) = std::env::current_exe() else { return };
    let Some(dir) = current_exe.parent() else { return };
    let Some(cur) = parse_version(&effective_version()) else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(rest) = name.strip_prefix("empyrean-gate-v") else {
            continue;
        };
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A real signature produced by the same `openssl pkeyutl -sign -rawin`
    /// invocation `release.yml` uses, over the canonical message for a made-up
    /// release. Its job is to pin the wire format down across two
    /// implementations: if `signing_message` ever changes shape, or the hex
    /// decoding is wrong, or the signature scheme drifts, this fails.
    ///
    /// Regenerating (only ever needed if the message format changes on purpose):
    ///   openssl genpkey -algorithm ed25519 -out k.pem
    ///   printf 'empyrean-gate-release-v1\n0.12.0\n<asset>\n<sha256>' > msg
    ///   openssl pkeyutl -sign -rawin -inkey k.pem -in msg | xxd -p -c 256
    ///   openssl pkey -in k.pem -pubout -outform DER | tail -c 32 | xxd -p -c 32
    const VECTOR_PUBKEY: &str =
        "83b9ef1ab72aaac997434bacf04199b95624aacddd1c5a65142da9d7e115b6a0";
    const VECTOR_SIG: &str = "54183ab4ab32b3fa52e3f19971b6f4e25f70595519df7c874fccfb7fa3ba6407\
                              200c26148daefac837981fcaf32c63e74aec875822002c57708893a119d25d0d";
    const VECTOR_VERSION: &str = "0.12.0";
    const VECTOR_ASSET: &str = "empyrean-gate-windows-x64.exe";
    const VECTOR_SHA: &str =
        "3b1f8e9c0a7d6542e1b0c9d8a7f6e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c";

    /// Verify with an explicitly supplied key, mirroring `verify_release_signature`
    /// but without the embedded one, so the vector does not depend on which key the
    /// repo currently ships.
    fn verify_with(
        pubkey_hex: &str,
        version: &str,
        asset: &str,
        sha256: &str,
        sig_hex: &str,
    ) -> bool {
        use ed25519_dalek::{Signature, Verifier, VerifyingKey};
        let Some(kb) = decode_hex(pubkey_hex).and_then(|b| <[u8; 32]>::try_from(b).ok()) else {
            return false;
        };
        let Ok(key) = VerifyingKey::from_bytes(&kb) else {
            return false;
        };
        let Some(sb) = decode_hex(sig_hex).and_then(|b| <[u8; 64]>::try_from(b).ok()) else {
            return false;
        };
        key.verify(
            signing_message(version, asset, sha256).as_bytes(),
            &Signature::from_bytes(&sb),
        )
        .is_ok()
    }

    #[test]
    fn signature_vector_from_openssl() {
        assert!(
            verify_with(
                VECTOR_PUBKEY,
                VECTOR_VERSION,
                VECTOR_ASSET,
                VECTOR_SHA,
                VECTOR_SIG
            ),
            "the canonical signing message no longer matches what release.yml signs"
        );
    }

    /// Each field is bound, so a signature cannot be moved to another version,
    /// another platform's asset, or another binary.
    #[test]
    fn a_signature_does_not_transfer_to_anything_else() {
        assert!(
            !verify_with(VECTOR_PUBKEY, "0.12.1", VECTOR_ASSET, VECTOR_SHA, VECTOR_SIG),
            "signature accepted under a different version"
        );
        assert!(
            !verify_with(
                VECTOR_PUBKEY,
                VECTOR_VERSION,
                "empyrean-gate-linux-x64",
                VECTOR_SHA,
                VECTOR_SIG
            ),
            "signature accepted for a different platform asset"
        );
        let other_sha = VECTOR_SHA.replace("3b1f", "4c20");
        assert!(
            !verify_with(
                VECTOR_PUBKEY,
                VECTOR_VERSION,
                VECTOR_ASSET,
                &other_sha,
                VECTOR_SIG
            ),
            "signature accepted for different content"
        );
    }

    #[test]
    fn a_wrong_key_rejects_a_good_signature() {
        let other = "5d1636371b31f07bb9e7c5153a8c97649b5cfa746536f9551f0bdf3447641dd4";
        assert_ne!(other, VECTOR_PUBKEY);
        assert!(!verify_with(
            other,
            VECTOR_VERSION,
            VECTOR_ASSET,
            VECTOR_SHA,
            VECTOR_SIG
        ));
    }

    /// The key that ships in this build has to be usable, or every update fails
    /// on the rig rather than here. Guards a truncated or mangled
    /// `release-signing.pub`.
    #[test]
    fn the_embedded_public_key_is_a_usable_ed25519_key() {
        let bytes = decode_hex(RELEASE_PUBLIC_KEY_HEX)
            .expect("release-signing.pub is not valid hex");
        let bytes: [u8; 32] = bytes
            .try_into()
            .expect("release-signing.pub is not 32 bytes");
        ed25519_dalek::VerifyingKey::from_bytes(&bytes)
            .expect("release-signing.pub is not a valid ed25519 public key");
    }

    /// The committed public key and the private key held in CI are a pair.
    ///
    /// `release.yml` asserts the same thing before publishing, but it can only do
    /// so once a release is already being cut — and the consequence of getting it
    /// wrong is a fleet that refuses every future update. This catches it on any
    /// `cargo test`, through the same `verify_release_signature` the rig uses.
    ///
    /// The signature is over a fixed synthetic triple (version `0.0.0-keycheck`,
    /// an all-zero digest) that can never name a real release, so it is useless
    /// as anything but this check. **Regenerate it whenever the signing key is
    /// rotated**, alongside `release-signing.pub`:
    ///
    ///   printf 'empyrean-gate-release-v1\n0.0.0-keycheck\nempyrean-gate-windows-x64.exe\n%s' \
    ///     0000000000000000000000000000000000000000000000000000000000000000 > msg
    ///   openssl pkeyutl -sign -rawin -inkey <key>.pem -in msg | xxd -p -c 256
    #[test]
    fn the_shipped_public_key_matches_the_signing_key_used_in_ci() {
        const PROBE_SIG: &str = "9e7392d42bd35f7ac1bcaa35275d5e5557e226d2e974b7616a39833d709fec36\
                                 cab47b1154388bdb1f5c57303da40919eb12c68dc938556a0554cc9abda4d506";
        verify_release_signature(
            "0.0.0-keycheck",
            "empyrean-gate-windows-x64.exe",
            "0000000000000000000000000000000000000000000000000000000000000000",
            PROBE_SIG,
        )
        .expect(
            "release-signing.pub is not the public half of the CI signing key — \
             releases signed in CI would be rejected by this build",
        );
    }

    #[test]
    fn garbage_signatures_are_rejected_without_panicking() {
        for bad in ["", "zz", "not hex at all", &"ab".repeat(63), &"ab".repeat(65)] {
            assert!(
                verify_release_signature(VECTOR_VERSION, VECTOR_ASSET, VECTOR_SHA, bad).is_err(),
                "accepted malformed signature {bad:?}"
            );
        }
    }

    #[test]
    fn decode_hex_rejects_odd_and_non_hex_input() {
        assert_eq!(decode_hex("00ff").unwrap(), vec![0x00, 0xff]);
        assert_eq!(decode_hex("  00ff\n").unwrap(), vec![0x00, 0xff]);
        assert!(decode_hex("abc").is_none());
        assert!(decode_hex("gg").is_none());
    }
}
