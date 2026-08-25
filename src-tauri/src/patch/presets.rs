//! Built-in starter patches, embedded in the binary and served read-only via
//! `GET /patch/presets`. The editor instantiates a COPY (blank id) into the
//! user's patch store — presets themselves are immutable templates, so they
//! update with the app and never fight user edits.

use super::PatchDoc;
use std::sync::OnceLock;

const SOURCES: &[&str] = &[
    include_str!("presets/beat-pulse.json"),
    include_str!("presets/lava-breathing.json"),
    include_str!("presets/rainbow-sparkle.json"),
    include_str!("presets/event-horizon.json"),
    include_str!("presets/ember-canvas.json"),
    include_str!("presets/dj-crunch-sparkles.json"),
    include_str!("presets/dj-cue-strike.json"),
    include_str!("presets/dj-loop-tunnel.json"),
    include_str!("presets/scope.json"),
    include_str!("presets/finger-paint.json"),
    include_str!("presets/video-kaleido.json"),
];

pub fn presets() -> &'static [PatchDoc] {
    static CACHE: OnceLock<Vec<PatchDoc>> = OnceLock::new();
    CACHE.get_or_init(|| {
        SOURCES
            .iter()
            .map(|s| serde_json::from_str(s).expect("built-in preset parses"))
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patch::codegen;

    /// Every shipped preset must parse, compile, and be activatable — a preset
    /// that errors in a fresh install would be the worst first impression.
    #[test]
    fn all_presets_compile_and_render() {
        let all = presets();
        assert_eq!(all.len(), SOURCES.len());
        for doc in all {
            assert!(!doc.name.is_empty());
            assert!(doc.id.starts_with("builtin-"), "{} id", doc.name);
            assert!(
                !doc.description.is_empty(),
                "{} needs a description",
                doc.name
            );
            assert!(
                !doc.exposed.is_empty(),
                "{} should expose play knobs",
                doc.name
            );
            let program = codegen::compile(doc)
                .unwrap_or_else(|e| panic!("preset \"{}\" fails to compile: {e}", doc.name));
            let module = naga::front::wgsl::parse_str(&program.wgsl)
                .unwrap_or_else(|e| panic!("preset \"{}\" emits invalid WGSL: {e}", doc.name));
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::all(),
            )
            .validate(&module)
            .unwrap_or_else(|e| panic!("preset \"{}\" fails WGSL validation: {e}", doc.name));
        }
    }

    #[test]
    fn preset_ids_are_unique() {
        let all = presets();
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a.id, b.id);
            }
        }
    }
}
