fn main() {
    configure_macos_vulkan_loader();

    // rust-embed needs ../dist to exist at compile time; the real contents come from
    // `bun run build`. A placeholder keeps `cargo check`/CI working from a fresh clone.
    let dist = std::path::Path::new("../dist");
    if !dist.exists() {
        std::fs::create_dir_all(dist).expect("create dist dir");
        std::fs::write(
            dist.join("index.html"),
            "<!doctype html><title>Empyrean Gate</title><p>UI not built. Run <code>bun run build</code>.</p>",
        )
        .expect("write dist placeholder");
    }
    tauri_build::build()
}

/// `wgpu` loads Vulkan dynamically. Cargo replaces DYLD_* paths for programs run
/// through `cargo run`, so a Homebrew Vulkan loader can be installed and still be
/// invisible to `tauri dev`. Add its library directory to the binary's rpath.
/// Runtime startup separately points that loader at Homebrew's MoltenVK ICD.
fn configure_macos_vulkan_loader() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    println!("cargo:rerun-if-env-changed=VULKAN_SDK");

    let mut candidates = Vec::new();
    if let Some(sdk) = std::env::var_os("VULKAN_SDK") {
        candidates.push(std::path::PathBuf::from(sdk).join("lib"));
    }
    candidates.extend([
        std::path::PathBuf::from("/opt/homebrew/opt/vulkan-loader/lib"),
        std::path::PathBuf::from("/usr/local/opt/vulkan-loader/lib"),
    ]);

    if let Some(lib_dir) = candidates
        .into_iter()
        .find(|dir| dir.join("libvulkan.dylib").exists())
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib_dir.display());
    } else {
        println!(
            "cargo:warning=Vulkan loader not found; install vulkan-loader and molten-vk for macOS development"
        );
    }
}
