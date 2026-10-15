//! Show effects and live-draw pens: the serde-facing types clients send, which
//! the engine (and the patch runtime's Event effect node) turn into the GPU
//! records in [`crate::abi`].

use crate::abi::{GpuDab, GpuEffect};
use serde::{Deserialize, Serialize};

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
    /// Iris opening from the center outward, petal-modulated, with a trailing glow.
    Bloom,
    /// Spiral arms that whip up to speed and fade.
    Pinwheel,
    /// Glitter storm over the whole array, swelling then decaying.
    Twinkle,
    /// A straight bar sweeping across the disc, lit wake behind it.
    Wipe,
    // --- Shapes: recognizable figures stamped center-array. `angle` is the
    // shape's rotation rather than an origin, and `radius` is unused. ---
    /// Five-pointed star, slowly spinning.
    Star,
    /// Heart, pulsing twice as it fades.
    Heart,
    /// Six-petal rosette that opens from a circle as it lands.
    Flower,
    /// Rhombus.
    Diamond,
    /// Equilateral triangle, point up.
    Triangle,
    /// Crescent moon.
    Moon,
    /// Clean radial ring expanding from the center of the array.
    Ring,
    /// Spin the entire rendered Gate composition around its center.
    Rotate,
    /// An orange traffic cone with white bands, tip toward the rim. Always
    /// orange whatever color was picked (that is the joke); on the public
    /// floor it needs the `cone` perk. See plans/hidden-modes.md.
    Cone,
}

impl EffectKind {
    /// Order is the GPU id — the `case` arms in `gate.wgsl` are literal numbers.
    /// Append only.
    pub const ALL: [EffectKind; 17] = [
        EffectKind::Burst,
        EffectKind::Strobe,
        EffectKind::Swoosh,
        EffectKind::Collapse,
        EffectKind::Bloom,
        EffectKind::Pinwheel,
        EffectKind::Twinkle,
        EffectKind::Wipe,
        EffectKind::Star,
        EffectKind::Heart,
        EffectKind::Flower,
        EffectKind::Diamond,
        EffectKind::Triangle,
        EffectKind::Moon,
        EffectKind::Ring,
        EffectKind::Rotate,
        EffectKind::Cone,
    ];

    /// The figures — stamped center-array, `angle` is their rotation. Everything
    /// else is a motion effect that travels across the array.
    pub const SHAPES: [EffectKind; 7] = [
        EffectKind::Star,
        EffectKind::Heart,
        EffectKind::Flower,
        EffectKind::Diamond,
        EffectKind::Triangle,
        EffectKind::Moon,
        EffectKind::Cone,
    ];

    pub fn gpu_id(self) -> u32 {
        Self::ALL.iter().position(|k| *k == self).unwrap() as u32
    }

    pub fn is_shape(self) -> bool {
        Self::SHAPES.contains(&self)
    }

    pub fn default_duration(self) -> f32 {
        match self {
            EffectKind::Burst => 1.2,
            EffectKind::Strobe => 0.25,
            EffectKind::Swoosh => 1.0,
            EffectKind::Collapse => 1.5,
            EffectKind::Bloom => 1.4,
            EffectKind::Pinwheel => 1.6,
            EffectKind::Twinkle => 1.1,
            EffectKind::Wipe => 1.0,
            EffectKind::Ring => 1.0,
            // Rotate is consumed by the CPU before it reaches the transient
            // effect buffer; keep a nominal duration for the stable effect ABI.
            EffectKind::Rotate => 0.1,
            // Stamps hold long enough to be read across a dance floor.
            EffectKind::Star
            | EffectKind::Heart
            | EffectKind::Flower
            | EffectKind::Diamond
            | EffectKind::Triangle
            | EffectKind::Moon
            | EffectKind::Cone => 1.8,
        }
    }
}

/// An effect trigger as sent by a client (keyboard, click/tap on the preview, remote phone).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// Shapes only: the figure's own rotation in radians. Separate from `angle`,
    /// which is where the figure is stamped — a tapped heart wants the tap's
    /// position and its own upright.
    pub rotation: f32,
    /// Shapes only: how the stamp's scale moves over its life — it is multiplied
    /// by `1 + grow * age/duration`. 0 holds the size it was tapped at, +1
    /// doubles it by the end, -1 collapses it to nothing. Clamped to ±1.
    pub grow: f32,
    /// Shapes only: how thick the figure's outline is, 0 (hairline) .. 1 (fat).
    /// 0.5 is the width figures had before this was adjustable. Below about 0.3
    /// the outline is thinner than the gap between spokes and will read as a
    /// dotted line where the boundary runs tangentially — that is a real limit of
    /// a 64-spoke array, and the control exposes it rather than hiding it.
    pub edge: f32,
    /// Shapes only: how brightly the figure's interior is lit, 0 (outline only)
    /// .. 1 (solid). Low values are what make a figure read as a figure rather
    /// than a blob; 0.35 is what they were fixed at before.
    pub fill: f32,
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
            rotation: 0.0,
            grow: 0.0,
            // Not the old look (0.5 / 0.35): that is the one being complained
            // about — a 0.11-wide outline plus a lit interior is most of a disc,
            // and the figures read as blobs. 0.3 puts the outline at ~0.077 of
            // the array radius, just inside the 0.078 gap between spokes at the
            // rim — the thinnest line 64 spokes can draw without it breaking up
            // — and 0.15 leaves the interior as a hint rather than a wash.
            // Verified with `bun scripts/shape-probe.ts`, not by eye over code.
            edge: 0.3,
            fill: 0.15,
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

impl EffectCfg {
    /// Seconds this effect lives: its own `duration`, or the kind's default.
    pub fn lifetime(&self) -> f32 {
        if self.duration > 0.0 {
            self.duration
        } else {
            self.kind.default_duration()
        }
    }

    /// The GPU record for this effect `age` seconds after it fired. `gain`
    /// scales intensity (the engine's overlay gain; 1.0 elsewhere).
    pub fn to_gpu(&self, age: f32, gain: f32) -> GpuEffect {
        GpuEffect {
            kind: self.kind.gpu_id(),
            size: self.size.clamp(0.1, 4.0),
            age,
            duration: self.lifetime(),
            angle: self.angle,
            radius: self.radius,
            intensity: self.intensity * gain,
            hue: self.hue,
            saturation: self.saturation.clamp(0.0, 1.0),
            brightness: self.brightness.clamp(0.0, 1.0),
            rotation: self.rotation,
            grow: self.grow.clamp(-1.0, 1.0),
            edge: self.edge.clamp(0.0, 1.0),
            fill: self.fill.clamp(0.0, 1.0),
        }
    }
}

/// Whole-composition rotation: an angle that coasts on a decaying velocity.
/// The Rotate effect never reaches the GPU effect buffer; it kicks this instead,
/// and every other effect and dab is stored in the rotated (composition) frame.
#[derive(Debug, Clone, Copy, Default)]
pub struct Spin {
    pub angle: f32,
    pub velocity: f32,
}

impl Spin {
    /// Kick from a Rotate effect: `angle`'s sign picks the direction and
    /// `intensity` the strength.
    pub fn impulse(&mut self, cfg: &EffectCfg) {
        let direction = if cfg.angle < 0.0 { -1.0 } else { 1.0 };
        self.velocity =
            (self.velocity + direction * cfg.intensity.clamp(0.05, 3.0) * 0.42).clamp(-12.0, 12.0);
    }

    /// Advance by `dt` seconds; returns the new angle.
    pub fn step(&mut self, dt: f32) -> f32 {
        self.angle = (self.angle + self.velocity * dt).rem_euclid(std::f32::consts::TAU);
        self.velocity *= (-1.15 * dt).exp();
        if self.velocity.abs() < 0.0005 {
            self.velocity = 0.0;
        }
        self.angle
    }
}

/// One live-draw dab, already in composition space (see [`Dab::new`]).
#[derive(Debug, Clone, Copy)]
pub struct Dab {
    pub kind: PenKind,
    pub angle: f32,
    pub radius: f32,
    pub hue: f32,
    pub saturation: f32,
    pub brightness: f32,
    pub size: f32,
    pub intensity: f32,
    pub dir: f32,
}

impl Dab {
    /// A dab from a stroke point in physical/display space. The shader samples
    /// the composition at `physical angle - rotation`, so the point (and its
    /// direction, for directional pens) is moved into that frame here;
    /// otherwise a dab lands one global rotation away from the finger.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        kind: PenKind,
        point: DabPoint,
        rotation: f32,
        hue: f32,
        saturation: f32,
        brightness: f32,
        size: f32,
        intensity: f32,
    ) -> Self {
        Self {
            kind,
            angle: point.angle - rotation,
            radius: point.radius.clamp(0.0, 1.2),
            hue,
            saturation: saturation.clamp(0.0, 1.0),
            brightness: brightness.clamp(0.0, 1.0),
            size: size.clamp(0.01, 1.0),
            intensity: intensity.clamp(0.0, 2.0),
            dir: point.dir - rotation,
        }
    }

    /// The GPU record `age` seconds after the dab was drawn (the shader wants
    /// age as a 0..1 fraction of the pen's lifetime).
    pub fn to_gpu(&self, age: f32, gain: f32) -> GpuDab {
        GpuDab {
            kind: self.kind.gpu_id(),
            age: age / self.kind.lifetime(),
            angle: self.angle,
            radius: self.radius,
            hue: self.hue,
            size: self.size,
            intensity: self.intensity * gain,
            dir: self.dir,
            saturation: self.saturation,
            brightness: self.brightness,
            _pad: [0.0; 2],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The position in `ALL` is the GPU id, and both shaders match on it as a
    /// literal. Reordering would silently repaint every effect as another one.
    #[test]
    fn effect_gpu_ids_are_stable_and_dense() {
        assert_eq!(EffectKind::Burst.gpu_id(), 0);
        assert_eq!(EffectKind::Strobe.gpu_id(), 1);
        assert_eq!(EffectKind::Swoosh.gpu_id(), 2);
        assert_eq!(EffectKind::Collapse.gpu_id(), 3);
        for (i, kind) in EffectKind::ALL.iter().enumerate() {
            assert_eq!(kind.gpu_id(), i as u32, "{kind:?} moved in ALL");
            assert!(kind.default_duration() > 0.0, "{kind:?} has no duration");
        }
    }

    #[test]
    fn shapes_are_a_subset_of_all_kinds() {
        for kind in EffectKind::SHAPES {
            assert!(EffectKind::ALL.contains(&kind), "{kind:?} missing from ALL");
            assert!(kind.is_shape());
        }
        assert!(!EffectKind::Burst.is_shape());
    }

    /// Serde names are what reports, the WebSocket protocol and the UI all speak.
    #[test]
    fn effect_kinds_round_trip_through_snake_case_json() {
        for kind in EffectKind::ALL {
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, json.to_lowercase(), "{kind:?} is not snake_case");
            assert_eq!(serde_json::from_str::<EffectKind>(&json).unwrap(), kind);
        }
    }

    #[test]
    fn lifetime_falls_back_to_the_kind_default() {
        let mut cfg = EffectCfg::default();
        assert_eq!(cfg.lifetime(), EffectKind::Burst.default_duration());
        cfg.duration = 3.0;
        assert_eq!(cfg.lifetime(), 3.0);
        assert_eq!(cfg.to_gpu(0.5, 1.0).duration, 3.0);
    }

    #[test]
    fn spin_coasts_to_a_stop() {
        let mut spin = Spin::default();
        spin.impulse(&EffectCfg {
            kind: EffectKind::Rotate,
            intensity: 1.0,
            ..Default::default()
        });
        assert!(spin.velocity > 0.0);
        for _ in 0..2000 {
            spin.step(1.0 / 60.0);
        }
        assert_eq!(spin.velocity, 0.0);
        assert!((0.0..std::f32::consts::TAU).contains(&spin.angle));
    }
}
