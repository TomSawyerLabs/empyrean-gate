//! Layer and effect definitions: the serde-facing config types edited by the UI,
//! and their packed `#[repr(C)]` GPU counterparts uploaded every frame.

use serde::{Deserialize, Serialize};

pub const MAX_LAYERS: usize = 24;
pub const MAX_EFFECTS: usize = 32;
pub const MAX_AUDIO_SOURCES: usize = 4;
/// Live-draw dabs (see `PenKind`). 512 supports several fingers drawing at once
/// across multiple clients with ~2 s trails.
pub const MAX_DABS: usize = 512;

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
}

impl LayerKind {
    pub const ALL: [LayerKind; 20] = [
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
            _ => &[],
        }
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectKind {
    /// Expanding circular shockwave from a point (click/tap position).
    Burst,
    /// Full-array white strobe flash.
    Strobe,
    /// A bright arm sweeping one full revolution.
    Swoosh,
    /// Wave collapsing from the outer edge to the center.
    Collapse,
}

impl EffectKind {
    pub const ALL: [EffectKind; 4] = [
        EffectKind::Burst,
        EffectKind::Strobe,
        EffectKind::Swoosh,
        EffectKind::Collapse,
    ];

    pub fn gpu_id(self) -> u32 {
        Self::ALL.iter().position(|k| *k == self).unwrap() as u32
    }

    pub fn default_duration(self) -> f32 {
        match self {
            EffectKind::Burst => 1.2,
            EffectKind::Strobe => 0.25,
            EffectKind::Swoosh => 1.0,
            EffectKind::Collapse => 1.5,
        }
    }
}

/// An effect trigger as sent by a client (keyboard, click/tap on the preview, remote phone).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct EffectCfg {
    pub kind: EffectKind,
    /// Origin angle in radians (e.g. from a preview click or phone yaw).
    pub angle: f32,
    /// Origin radius, normalized 0 (center) .. 1 (outer edge).
    pub radius: f32,
    pub intensity: f32,
    /// Width multiplier for effects with a spatial footprint (1 = default).
    pub size: f32,
    /// Hue in turns; negative = white.
    pub hue: f32,
    /// HSV saturation and value. Kept separate so custom RGB colors round-trip.
    pub saturation: f32,
    pub brightness: f32,
    /// Seconds; 0 = use the kind's default.
    pub duration: f32,
}

impl Default for EffectCfg {
    fn default() -> Self {
        Self {
            kind: EffectKind::Burst,
            angle: 0.0,
            radius: 1.0,
            intensity: 1.0,
            size: 1.0,
            hue: -1.0,
            saturation: 0.85,
            brightness: 1.0,
            duration: 0.0,
        }
    }
}

/// Live drawing "pens" — each pointer-move dab from a client renders as one of these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PenKind {
    /// Soft glowing blob that fades out.
    Glow,
    /// Small expanding ring from each dab.
    Ripple,
    /// Glitter spray around the dab.
    Sparkle,
    /// Teardrop streak elongated along the stroke's motion direction.
    Comet,
    /// A full hoop around the array at the dab's radius.
    Ring,
    /// Lights the whole spoke ray at the dab's angle.
    Beam,
    /// Glitter that drifts inward toward the center as it fades.
    Ember,
}

impl PenKind {
    pub fn gpu_id(self) -> u32 {
        match self {
            PenKind::Glow => 0,
            PenKind::Ripple => 1,
            PenKind::Sparkle => 2,
            PenKind::Comet => 3,
            PenKind::Ring => 4,
            PenKind::Beam => 5,
            PenKind::Ember => 6,
        }
    }

    pub fn lifetime(self) -> f32 {
        match self {
            PenKind::Glow => 1.5,
            PenKind::Ripple => 1.2,
            PenKind::Sparkle => 2.0,
            PenKind::Comet => 1.2,
            PenKind::Ring => 1.8,
            PenKind::Beam => 0.9,
            PenKind::Ember => 2.5,
        }
    }
}

/// One point of a live-draw stroke, as sent by a client.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DabPoint {
    /// Radians.
    pub angle: f32,
    /// 0 (center) .. 1 (outer edge).
    pub radius: f32,
    /// Direction of stroke motion in the array's cartesian frame, radians.
    /// Used by directional pens (Comet); 0 when unknown.
    #[serde(default)]
    pub dir: f32,
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
    pub _pad2: [f32; 3],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuDab {
    pub kind: u32,
    pub age: f32,
    pub angle: f32,
    pub radius: f32,
    pub hue: f32,
    pub size: f32,
    pub intensity: f32,
    /// Stroke motion direction (radians) for directional pens.
    pub dir: f32,
    pub saturation: f32,
    pub brightness: f32,
    pub _pad: [f32; 2],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuEffect {
    pub kind: u32,
    pub size: f32,
    pub age: f32,
    pub duration: f32,
    pub angle: f32,
    pub radius: f32,
    pub intensity: f32,
    pub hue: f32,
    pub saturation: f32,
    pub brightness: f32,
    pub _pad: [f32; 2],
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
    /// invisible; the other kinds are addressed in `plans/walk-phase-jitter.md`.
    pub fn phase_period(&self) -> Option<f64> {
        match self.kind {
            // case 7 — the only use is fract(h + phase).
            LayerKind::SpokeChase => Some(1.0),
            _ => None,
        }
    }

    pub fn to_gpu(&self, phase: f32) -> GpuLayer {
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
            _pad2: [0.0; 3],
        }
    }
}
