// Prevents an extra console window on Windows in release; keep console for logs in debug.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let headless = args.iter().any(|a| a == "--headless")
        || std::env::var("EMPYREAN_HEADLESS").is_ok_and(|v| v == "1");
    // Set by a self-update: the path we were launched from, which still holds
    // the OLD binary and must end up holding this one (see `updater`).
    let promote_to = args
        .iter()
        .position(|a| a == "--promote-to")
        .and_then(|i| args.get(i + 1))
        .map(std::path::PathBuf::from);
    empyrean_gate_lib::run(headless, promote_to);
}
