//! Log to a file as well as stderr.
//!
//! Release builds on Windows are `windows_subsystem = "windows"`: there is no
//! console, so everything env_logger wrote to stderr went nowhere. A self-update
//! spawns a *child* process, whose stderr is even more thoroughly lost — so when
//! an update failed in the field there was nothing to read afterwards, which is
//! exactly when you most want a log.
//!
//! Written next to the config, so it travels with the machine's state rather
//! than the (replaceable) binary.

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// Rotate at this size, keeping one previous file.
const MAX_BYTES: u64 = 5 * 1024 * 1024;

pub fn log_path() -> PathBuf {
    crate::config::config_path()
        .parent()
        .map(|p| p.join("logs"))
        .unwrap_or_else(|| PathBuf::from("logs"))
        .join("empyrean-gate.log")
}

/// Tees to the log file and stderr. stderr is still useful under `cargo run` and
/// on the headless Linux show machines, where the process has a terminal.
struct Tee {
    file: Mutex<Option<File>>,
}

impl Write for Tee {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if let Ok(mut guard) = self.file.lock()
            && let Some(file) = guard.as_mut()
        {
            let _ = file.write_all(buf);
        }
        // Never fail the logger on a broken stderr (no console on Windows).
        let _ = std::io::stderr().write(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        if let Ok(mut guard) = self.file.lock()
            && let Some(file) = guard.as_mut()
        {
            let _ = file.flush();
        }
        let _ = std::io::stderr().flush();
        Ok(())
    }
}

/// Install the logger. Safe to call once, at startup.
pub fn init() {
    let path = log_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // Keep one generation, so a long-running show cannot fill the disk and a
    // crash-then-restart still leaves the interesting file behind.
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::rename(&path, path.with_extension("log.1"));
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok();
    let opened = file.is_some();

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .target(env_logger::Target::Pipe(Box::new(Tee {
            file: Mutex::new(file),
        })))
        .init();

    if opened {
        log::info!("logging to {}", path.display());
    } else {
        log::warn!("could not open {} — logging to stderr only", path.display());
    }
}
