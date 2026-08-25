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
    include_str!("presets/root-current.json"),
    include_str!("presets/deep-space-pulse.json"),
    include_str!("presets/dj-crunch-sparkles.json"),
    include_str!("presets/dj-cue-strike.json"),
    include_str!("presets/dj-loop-tunnel.json"),
    include_str!("presets/dj-link-spiral-performance.json"),
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
    use crate::engine::AudioUniform;
    use crate::layers::MAX_AUDIO_SOURCES;
    use crate::patch::codegen;
    use crate::patch::eval::{DjLinkInputs, EvalInputs, Runtime};

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

    #[test]
    fn link_performance_preserves_the_loop_tunnel_design() {
        let all = presets();
        let loop_tunnel = all
            .iter()
            .find(|doc| doc.id == "builtin-dj-loop-tunnel")
            .expect("DJ Loop Tunnel preset");
        let performance = all
            .iter()
            .find(|doc| doc.id == "builtin-dj-link-spiral-performance")
            .expect("DJ LINK Spiral Performance preset");

        for node_id in ["wrap_env", "tunnel", "ring", "handoff"] {
            let original = loop_tunnel
                .nodes
                .iter()
                .find(|node| node.id == node_id)
                .expect("original design node");
            let preserved = performance
                .nodes
                .iter()
                .find(|node| node.id == node_id)
                .expect("preserved design node");
            assert_eq!(preserved.kind, original.kind, "{node_id} node kind");
            assert_eq!(preserved.params, original.params, "{node_id} parameters");
        }
    }

    #[test]
    fn link_performance_tracks_level_immediately_and_bpm_proportionally() {
        let doc = presets()
            .iter()
            .find(|doc| doc.id == "builtin-dj-link-spiral-performance")
            .expect("DJ LINK Spiral Performance preset")
            .clone();
        let program = codegen::compile(&doc).expect("performance preset compiles");
        let master_slot = program
            .slots
            .iter()
            .find(|slot| {
                doc.nodes[slot.node].id == "out" && slot.param.as_deref() == Some("master")
            })
            .expect("wired output master")
            .slot;
        let speed_slot = program
            .slots
            .iter()
            .find(|slot| {
                doc.nodes[slot.node].id == "tunnel" && slot.param.as_deref() == Some("speed")
            })
            .expect("wired tunnel speed")
            .slot;
        let mut runtime = Runtime::new(doc, program);
        let mut quiet_audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        quiet_audio[0].level = 0.2;
        quiet_audio[0].bpm = 60.0;
        let mut loud_audio = quiet_audio;
        loud_audio[0].level = 0.9;
        loud_audio[0].bpm = 120.0;
        let mut inputs = EvalInputs {
            dt: 0.1,
            master_speed: 1.0,
            audio: &quiet_audio,
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            shake: 0.0,
            effect_seq: 0,
            dj_link: DjLinkInputs::default(),
        };
        let first = runtime.eval(&inputs).to_vec();
        assert!((first[master_slot] - 0.344).abs() < 1e-4);
        let slow_phase_step = first[speed_slot];

        inputs.audio = &loud_audio;
        let second = runtime.eval(&inputs).to_vec();
        assert!((second[master_slot] - 0.918).abs() < 1e-4);
        let fast_phase_step = second[speed_slot] - first[speed_slot];
        assert!(
            (fast_phase_step / slow_phase_step - 2.0).abs() < 1e-3,
            "60 BPM step {slow_phase_step}, 120 BPM step {fast_phase_step}"
        );
    }
}
