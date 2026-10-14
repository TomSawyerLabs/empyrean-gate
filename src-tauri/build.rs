fn main() {
    configure_macos_vulkan_loader();
    build_doom();

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

/// Compile the vendored DOOM engine (`doom/doomgeneric`, see `doom/README.md`)
/// into a static library when the `doom` feature is on. The engine runs in a
/// child process of this same binary (`--doom-host`, plans/doom.md); the Rust
/// side of that contract is `src/doom/host.rs`.
fn build_doom() {
    if std::env::var_os("CARGO_FEATURE_DOOM").is_none() {
        return;
    }
    let root = std::path::Path::new("doom");
    let src = root.join("doomgeneric");
    println!("cargo:rerun-if-changed={}", root.display());

    let mut build = cc::Build::new();
    let mut files: Vec<_> = std::fs::read_dir(&src)
        .expect("read doom/doomgeneric")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "c"))
        .collect();
    files.sort();
    for file in files {
        build.file(file);
    }
    build.file(root.join("shim.c"));
    build.include(root).include(&src);
    // Native 320x200, 8-bit indexed: the host reads the palette from the shim
    // and ships 64 KB frames instead of 256 KB.
    build
        .define("CMAP256", None)
        .define("DOOMGENERIC_RESX", "320")
        .define("DOOMGENERIC_RESY", "200");
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        // What upstream's doomgeneric.vcxproj defines, plus silence the
        // "unsafe CRT function" noise 1993 C produces by the hundred.
        build
            .define("WIN32", None)
            .define("_CONSOLE", None)
            .define("_CRT_SECURE_NO_WARNINGS", None)
            .define("_CRT_NONSTDC_NO_DEPRECATE", None);
    } else {
        // Upstream's Makefile (X11 target) minus the X11 bits.
        build
            .define("NORMALUNIX", None)
            .define("LINUX", None)
            .define("_DEFAULT_SOURCE", None);
    }
    // It is not our code and it is not going to be cleaned up: warnings here
    // are noise in every build log for no action anyone will take.
    build.warnings(false);
    build.compile("doomgeneric");
}
