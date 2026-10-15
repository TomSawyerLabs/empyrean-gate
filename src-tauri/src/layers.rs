//! Layer and effect definitions: the serde-facing config types edited by the UI,
//! and their packed `#[repr(C)]` GPU counterparts uploaded every frame.

use serde::{Deserialize, Serialize};

// The effect/dab types and their GPU records are shared with the patch
// runtime (and its browser build), so they live in `empyrean-patch`.
pub use empyrean_patch::abi::{GpuDab, GpuEffect, MAX_AUDIO_SOURCES, MAX_DABS, MAX_EFFECTS};
pub use empyrean_patch::effects::{DabPoint, EffectCfg, EffectKind, PenKind};

pub const MAX_LAYERS: usize = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerKind {
    /// Uniform color wash.
    Solid,
    /// Hue gradient along the radius, steerable by IMU tilt.
    GradientRadial,
    /// fBm simplex noise field mapped through hue range.
    NoiseField,
    /// Three independently-offset simplex fields driving R/G/B — multidimensional color noise.
    NoiseColor,
    /// Stack of harmonically related radial ring waves.
    RadialWaves,
    /// Rotating spiral arms.
    Spiral,
    /// Classic plasma (sum of sines in polar space).
    Plasma,
    /// Per-spoke comets running along the spokes (outer -> inner or reverse).
    SpokeChase,
    /// Random twinkles, density modulated by audio.
    Sparkle,
    /// Rings emitted on every beat, expanding along the radius.
    BeatRings,
    /// Multiplicative breathing envelope (beat- or time-synced).
    Breathe,
    /// Classic hue wheel: hue sweeps around the circle (and optionally the radius).
    Rainbow,
    /// Rotating pie slices, audio-flash on the beat.
    Wedges,
    /// Two orbiting wave sources creating moiré interference.
    Interference,
    /// Noise flames climbing inward from the outer rim, fire palette.
    Fire,
    /// Random radial shooting stars with trails.
    Meteors,
    /// Starfield streaming outward — warp speed.
    Warp,
    /// The raw waveform bent into a ring: a circular oscilloscope (MilkDrop-style).
    Waveform,
    /// Spoke-per-bin circular spectrum analyzer.
    Spectrum,
    /// Live video texture supplied by a browser client and mapped across the ring.
    Video,
    /// Six interlaced, slowly breathing color currents inspired by the Entheos mark.
    EntheosWeave,
    /// High-contrast Black Rock City street schematic designed for the radial LEDs.
    BrcMap,
    /// Literal 2026 plan trace with continuous blocks and luminous street lines.
    BrcPlan,
    /// Polar rose plus Vogel golden-angle phyllotaxis, designed for the radial array.
    GoldenRose,
}

impl LayerKind {
    pub const ALL: [LayerKind; 24] = [
        LayerKind::Solid,
        LayerKind::GradientRadial,
        LayerKind::NoiseField,
        LayerKind::NoiseColor,
        LayerKind::RadialWaves,
        LayerKind::Spiral,
        LayerKind::Plasma,
        LayerKind::SpokeChase,
        LayerKind::Sparkle,
        LayerKind::BeatRings,
        LayerKind::Breathe,
        LayerKind::Rainbow,
        LayerKind::Wedges,
        LayerKind::Interference,
        LayerKind::Fire,
        LayerKind::Meteors,
        LayerKind::Warp,
        LayerKind::Waveform,
        LayerKind::Spectrum,
        LayerKind::Video,
        LayerKind::EntheosWeave,
        LayerKind::BrcMap,
        LayerKind::BrcPlan,
        LayerKind::GoldenRose,
    ];

    pub fn gpu_id(self) -> u32 {
        Self::ALL.iter().position(|k| *k == self).unwrap() as u32
    }

    /// Params this kind's shader quantizes, and the grid it quantizes them to.
    ///
    /// A walked value sitting near a cell boundary crosses it many times a
    /// second, so the pattern strobes between (say) five and six spiral arms.
    /// The autopilot uses this to step such params deliberately instead — see
    /// `walked_discrete` in `engine/mod.rs`. Keep in step with `gate.wgsl`.
    pub fn discrete_params(self) -> &'static [DiscreteParam] {
        match self {
            // arms = max(1, floor(param_a * 12))
            LayerKind::Spiral => &[DiscreteParam {
                index: 0,
                steps: 12.0,
                bias: 0.0,
            }],
            // dir = param_b > 0.5 — a flip reverses every comet at once
            LayerKind::SpokeChase => &[DiscreteParam {
                index: 1,
                steps: 2.0,
                bias: 0.0,
            }],
            // turns = max(1, floor(param_a * 4 + 0.5))
            LayerKind::Rainbow => &[DiscreteParam {
                index: 0,
                steps: 4.0,
                bias: 0.5,
            }],
            // n = 2 + floor(param_a * 14)
            LayerKind::Wedges => &[DiscreteParam {
                index: 0,
                steps: 14.0,
                bias: 0.0,
            }],
            // dir_r = param_c > 0.5 — inward vs outward streaks
            LayerKind::Meteors => &[DiscreteParam {
                index: 2,
                steps: 2.0,
                bias: 0.0,
            }],
            // mirrors = floor(param_b * 10 + 0.5)
            LayerKind::Video => &[DiscreteParam {
                index: 1,
                steps: 10.0,
                bias: 0.5,
            }],
            // petals = 3 + 2 * floor(param_a * 4): the odd rose families
            // 3, 5, 7, and 9 retain one petal per harmonic.
            LayerKind::GoldenRose => &[DiscreteParam {
                index: 0,
                steps: 4.0,
                bias: 0.0,
            }],
            _ => &[],
        }
    }

    /// Kinds whose shader reads phase as an integer index into a hash —
    /// `cell = u32(clock)` and friends — rather than as a smooth angle. They
    /// take their phase pre-split; see `LayerCfg::split_phase`. Keep in step
    /// with `gate.wgsl`.
    pub fn phase_uses_epoch(self) -> bool {
        matches!(
            self,
            // case 8 twinkle cells, case 15 meteor epochs, case 16 star cells.
            LayerKind::Sparkle | LayerKind::Meteors | LayerKind::Warp
        )
    }
}

/// One shader-quantized layer parameter. The shader's cell index is
/// `floor(value * steps + bias)`; `bias` is 0.5 where it rounds rather than
/// truncates.
#[derive(Debug, Clone, Copy)]
pub struct DiscreteParam {
    /// Which walked param: 0 = `param_a`, 1 = `param_b`, 2 = `param_c`.
    pub index: usize,
    pub steps: f32,
    pub bias: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlendMode {
    Add,
    Multiply,
    Screen,
    AlphaOver,
    Max,
}

impl BlendMode {
    pub fn gpu_id(self) -> u32 {
        match self {
            BlendMode::Add => 0,
            BlendMode::Multiply => 1,
            BlendMode::Screen => 2,
            BlendMode::AlphaOver => 3,
            BlendMode::Max => 4,
        }
    }
}

/// A layer as configured/edited in the UI and persisted in the config file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LayerCfg {
    pub kind: LayerKind,
    pub enabled: bool,
    pub name: String,
    pub blend: BlendMode,
    pub opacity: f32,
    /// Animation rate multiplier; the engine integrates this into a per-layer phase so
    /// changing speed live never causes a discontinuity.
    pub speed: f32,
    /// Spatial scale / frequency knob.
    pub scale: f32,
    /// Which audio source (index into config.audio.sources) drives this layer.
    pub audio_source: u32,
    /// 0 = ignore audio entirely, 1 = fully modulated.
    pub audio_amount: f32,
    /// Base hue in turns [0, 1).
    pub hue: f32,
    /// How far the pattern wanders around the hue wheel.
    pub hue_range: f32,
    pub saturation: f32,
    pub brightness: f32,
    /// React to IMU tilt from a connected phone (layers that support it).
    pub tilt_amount: f32,
    /// How far the autopilot random walk may push this layer's parameters away from
    /// the slider positions (0 = frozen, 1 = full wander). The slider value is the
    /// center of the walk, so it doubles as the limit.
    pub walk_amount: f32,
    /// Kind-specific parameters, labeled in the UI per kind.
    pub param_a: f32,
    pub param_b: f32,
    pub param_c: f32,
    pub param_d: f32,
}

impl Default for LayerCfg {
    fn default() -> Self {
        Self {
            kind: LayerKind::NoiseField,
            enabled: true,
            name: String::new(),
            blend: BlendMode::Add,
            opacity: 1.0,
            speed: 1.0,
            scale: 1.0,
            audio_source: 0,
            audio_amount: 0.5,
            hue: 0.6,
            hue_range: 0.2,
            saturation: 0.9,
            brightness: 1.0,
            tilt_amount: 0.0,
            walk_amount: 0.25,
            param_a: 0.5,
            param_b: 0.5,
            param_c: 0.5,
            param_d: 0.5,
        }
    }
}


// ---------------------------------------------------------------------------
// GPU-side packed structs. Layouts must match `engine/shaders/gate.wgsl`.
// ---------------------------------------------------------------------------

#[repr(C)]
#[derive(Debug, Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuLayer {
    pub kind: u32,
    pub blend: u32,
    pub audio_source: u32,
    pub _pad: u32,
    pub opacity: f32,
    pub phase: f32,
    pub scale: f32,
    pub audio_amount: f32,
    pub hue: f32,
    pub hue_range: f32,
    pub saturation: f32,
    pub brightness: f32,
    pub tilt_amount: f32,
    pub param_a: f32,
    pub param_b: f32,
    pub param_c: f32,
    pub param_d: f32,
    /// Whole-number part of the phase, for the kinds that index a hash by it.
    /// Zero for every other kind — see `LayerCfg::split_phase`.
    pub phase_epoch: u32,
    pub _pad2: [f32; 2],
}


impl LayerCfg {
    /// Rate factor the engine folds into this layer's phase integration.
    ///
    /// Four kinds animate at a rate derived from a parameter. Written naively the
    /// shader computes `phase * rate`, so a change in `rate` moves the pattern by
    /// `phase * Δrate` — proportional to how long the layer has been up. With the
    /// autopilot nudging that param every frame the result is a pattern that
    /// vibrates instead of travelling, reverses direction at random, and gets
    /// worse the longer the show runs; audio does the same thing, harder. What
    /// the shader wants is ∫rate·dt, so the rate is integrated here and the
    /// shader uses `L.phase` unscaled. Every expression below is a mirror of one
    /// in `engine/shaders/gate.wgsl` and must be kept in step with it.
    pub fn phase_rate(&self, audio_level: f32) -> f32 {
        let aud = self.audio_amount * audio_level;
        match self.kind {
            // case 7 — comet travel along each spoke, either direction.
            LayerKind::SpokeChase => {
                let dir = if self.param_b > 0.5 { -1.0 } else { 1.0 };
                (0.2 + self.param_a * 1.5 + aud * 0.8) * 0.2 * dir
            }
            // case 8 — twinkle re-roll clock.
            LayerKind::Sparkle => 4.0 + self.param_b * 20.0,
            // case 15 — meteor launch epochs.
            LayerKind::Meteors => 0.15 + self.param_b * 1.2,
            // case 16 — starfield flow.
            LayerKind::Warp => (0.5 + self.param_b * 2.0) * (1.0 + aud),
            _ => 1.0,
        }
    }

    /// Period over which this kind's shader output is *exactly* invariant in
    /// phase, if it has one. Phase accumulates in f64 but crosses to the GPU as
    /// f32, which quantizes the per-frame step once the value gets large — so
    /// wrap wherever it costs nothing. Only claim a period here when the wrap is
    /// invisible.
    ///
    /// A kind qualifies when every use of phase is inside a trig function (or a
    /// `fract`) with a *constant* multiplier: the period is then the smallest
    /// value that turns each multiplier into a whole number of turns. Kinds that
    /// index a hash by phase are handled by `split_phase` instead; kinds that
    /// feed it to noise (Fire, NoiseField, NoiseColor) have no period at all and
    /// rely on the scheduled reset in `engine/mod.rs`.
    pub fn phase_period(&self) -> Option<f64> {
        use std::f64::consts::TAU;
        match self.kind {
            // case 7 — the only use is fract(h + phase).
            LayerKind::SpokeChase => Some(1.0),
            // case 5 — sin(arms·θ + twist·rn·TAU - phase).
            LayerKind::Spiral => Some(TAU),
            // case 4 — multipliers 1 + 0.2·h for h = 1..=7, i.e. 1.2 … 2.4.
            // TAU·5 turns every one of them into whole turns (6 … 12).
            LayerKind::RadialWaves => Some(TAU * 5.0),
            // case 6 — multipliers 1, 0.7, 1.3, -1. TAU·10 clears all four.
            LayerKind::Plasma => Some(TAU * 10.0),
            // case 13 — multipliers 0.31, 0.23, 1, 0.8. TAU·100 clears all four.
            LayerKind::Interference => Some(TAU * 100.0),
            // case 19 — the only use is a rotation of phase·0.08.
            LayerKind::Video => Some(TAU / 0.08),
            _ => None,
        }
    }

    /// Split accumulated phase for the GPU into `(fraction, epoch)`.
    ///
    /// Sparkle, Meteors and Warp turn phase into an integer index and hash it,
    /// so they cannot use `phase_period`: any wrap re-rolls every twinkle,
    /// meteor and star at the moment it happens. Splitting instead keeps the
    /// f32 in [0, 1) — full 24-bit resolution, forever — and hands the whole
    /// number over as its own `u32` field, which the shader adds back after it
    /// has applied its own small per-spoke offset. Exact until the epoch itself
    /// overflows: ~5.7 years at Sparkle's fastest rate.
    ///
    /// Every other kind gets its phase unchanged, and an epoch of zero.
    ///
    /// Negative phase — a layer whose speed the operator inverted — clamps to
    /// zero for the split kinds, which is what the shaders' `max(t, 0.0)` did
    /// before the epoch existed.
    pub fn split_phase(&self, phase: f64) -> (f32, u32) {
        if !self.kind.phase_uses_epoch() {
            return (phase as f32, 0);
        }
        let clamped = phase.max(0.0);
        let epoch = clamped.floor();
        (
            (clamped - epoch) as f32,
            (epoch % (u32::MAX as f64 + 1.0)) as u32,
        )
    }

    pub fn to_gpu(&self, phase: f32, phase_epoch: u32) -> GpuLayer {
        GpuLayer {
            kind: self.kind.gpu_id(),
            blend: self.blend.gpu_id(),
            audio_source: self.audio_source.min(MAX_AUDIO_SOURCES as u32 - 1),
            _pad: 0,
            opacity: self.opacity,
            phase,
            scale: self.scale,
            audio_amount: self.audio_amount,
            hue: self.hue,
            hue_range: self.hue_range,
            saturation: self.saturation,
            brightness: self.brightness,
            tilt_amount: self.tilt_amount,
            param_a: self.param_a,
            param_b: self.param_b,
            param_c: self.param_c,
            param_d: self.param_d,
            phase_epoch,
            _pad2: [0.0; 2],
        }
    }
}

#[cfg(test)]
mod patch_transient_abi_tests {
    use super::*;

    // Stable ids, shape membership and serde names are tested with the types
    // in `empyrean-patch`; what needs this crate is the gate.wgsl side.

    /// A kind with no shader arm is a silent no-op on the rig — the switch just
    /// falls through to `default`. Catch it here instead of at the show.
    #[test]
    fn every_effect_kind_has_a_shader_case() {
        for (name, src) in [
            ("gate", include_str!("engine/shaders/gate.wgsl")),
            ("patch", crate::patch::codegen::PATCH_LIB_WGSL),
        ] {
            let after = src
                .split_once("fn effect_color(")
                .unwrap_or_else(|| panic!("effect_color missing from {name} shader"))
                .1;
            let body = after.split_once("\nfn ").map_or(after, |(head, _)| head);
            for kind in EffectKind::ALL {
                let arm = format!("case {}u:", kind.gpu_id());
                assert!(
                    body.contains(&arm),
                    "{kind:?} has no `{arm}` arm in {name} effect_color"
                );
            }
        }
    }


}

#[cfg(test)]
mod tests {
    use super::{GpuDab, GpuEffect};

    /// `GpuEffect` and `GpuDab` are bytemuck'd straight into storage buffers
    /// read by TWO shaders — `gate.wgsl` and `patch_lib.wgsl`, which carry
    /// independent copies of the struct. A field added to one and not the other
    /// silently misreads every subsequent field rather than failing to compile,
    /// so the size is pinned here and both copies must move together.
    /// 56 = 14 f32: the 12 originals plus `edge` and `fill`.
    #[test]
    fn patch_transient_abi_keeps_full_color_records() {
        assert_eq!(std::mem::size_of::<GpuEffect>(), 56);
        assert_eq!(std::mem::size_of::<GpuDab>(), 48);

        // Both shader copies declare the two shape controls, in the same order.
        for shader in [
            include_str!("engine/shaders/gate.wgsl"),
            crate::patch::codegen::PATCH_LIB_WGSL,
        ] {
            let effect = shader
                .split_once("struct Effect {")
                .expect("Effect struct")
                .1
                .split_once('}')
                .expect("Effect struct end")
                .0;
            let rotation = effect.find("rotation:").expect("rotation");
            let grow = effect.find("grow:").expect("grow");
            let edge = effect.find("edge:").expect("edge field missing");
            let fill = effect.find("fill:").expect("fill field missing");
            assert!(rotation < grow && grow < edge && edge < fill, "field order");
        }

        let patch_shader = crate::patch::codegen::PATCH_LIB_WGSL;
        assert!(patch_shader.contains("col = hsv2rgb(E.hue, E.saturation, E.brightness);"));
        assert!(patch_shader.contains("col = hsv2rgb(D.hue, D.saturation, D.brightness);"));
    }
}
