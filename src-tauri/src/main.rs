// Prevents an extra console window on Windows in release; keep console for logs in debug.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let headless = std::env::args().any(|a| a == "--headless")
        || std::env::var("EMPYREAN_HEADLESS").is_ok_and(|v| v == "1");
    empyrean_gate_lib::run(headless);
}
