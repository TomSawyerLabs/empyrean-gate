// Prevents an extra console window on Windows in release; keep console for logs in debug.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    configure_macos_vulkan_icd();

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

/// Homebrew installs Vulkan ICD manifests outside the loader's standard macOS
/// search path. Point the Vulkan loader at MoltenVK unless the operator already
/// supplied an explicit driver list.
#[cfg(target_os = "macos")]
fn configure_macos_vulkan_icd() {
    if std::env::var_os("VK_DRIVER_FILES").is_some()
        || std::env::var_os("VK_ICD_FILENAMES").is_some()
    {
        return;
    }

    let mut candidates = Vec::new();
    if let Some(sdk) = std::env::var_os("VULKAN_SDK") {
        candidates.extend([
            std::path::PathBuf::from(&sdk).join("share/vulkan/icd.d/MoltenVK_icd.json"),
            std::path::PathBuf::from(&sdk).join("etc/vulkan/icd.d/MoltenVK_icd.json"),
        ]);
    }
    candidates.extend([
        std::path::PathBuf::from("/opt/homebrew/etc/vulkan/icd.d/MoltenVK_icd.json"),
        std::path::PathBuf::from("/usr/local/etc/vulkan/icd.d/MoltenVK_icd.json"),
        std::path::PathBuf::from("/opt/homebrew/opt/molten-vk/etc/vulkan/icd.d/MoltenVK_icd.json"),
        std::path::PathBuf::from("/usr/local/opt/molten-vk/etc/vulkan/icd.d/MoltenVK_icd.json"),
    ]);

    if let Some(manifest) = candidates.into_iter().find(|path| path.is_file()) {
        // SAFETY: this runs before any threads are spawned or Vulkan is loaded.
        unsafe { std::env::set_var("VK_DRIVER_FILES", &manifest) };
        eprintln!("using Vulkan ICD manifest: {}", manifest.display());
    }
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_vulkan_icd() {}
