fn main() {
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
