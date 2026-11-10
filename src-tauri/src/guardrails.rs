//! Guardrail levels (plans/guardrail-modes.md): how much a device's changes are
//! smoothed and limited before they reach the lights.
//!
//! One mechanism: every continuous control has a **rate limit**, its d/dt cap in
//! units per second (`None` = instant). The engine moves each rendered value
//! toward its configured value no faster than the rate of whoever last wrote
//! it. A level is a preset of those rates, plus (Guided only) narrower ranges
//! and a minimum scene transition.
//!
//! - **Guided** (beginners): every change fades, ranges are narrowed, scene
//!   changes never cut.
//! - **Standard** (the in-between): patterns fade in and out; live controls such
//!   as master brightness (Blackout) and the layer sliders act at once.
//! - **Expert**: nothing is smoothed unless the expert sets their own per-slider
//!   rate limits.
//!
//! Changes with no device behind them (the show scheduler, performance replay)
//! use the Standard rates.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::layers::LayerCfg;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Guided,
    #[default]
    Standard,
    Expert,
}

/// A control a guardrail can limit. The serialized name is what the UI and the
/// per-slider rate overrides use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Control {
    MasterBrightness,
    MasterSpeed,
    FloorLevel,
    MasterHueAmount,
    /// A layer's on/off toggle: the rate is how fast its fade envelope moves.
    LayerEnable,
    LayerOpacity,
    LayerSpeed,
    LayerScale,
    LayerAudioAmount,
    LayerHue,
    LayerHueRange,
    LayerSaturation,
    LayerBrightness,
    LayerTiltAmount,
    LayerWalkAmount,
    LayerParamA,
    LayerParamB,
    LayerParamC,
    LayerParamD,
}

/// The continuous per-layer fields, in `LayerSlew` order.
pub const LAYER_FIELDS: [Control; 14] = [
    Control::LayerOpacity,
    Control::LayerSpeed,
    Control::LayerScale,
    Control::LayerAudioAmount,
    Control::LayerHue,
    Control::LayerHueRange,
    Control::LayerSaturation,
    Control::LayerBrightness,
    Control::LayerTiltAmount,
    Control::LayerWalkAmount,
    Control::LayerParamA,
    Control::LayerParamB,
    Control::LayerParamC,
    Control::LayerParamD,
];

impl Control {
    pub const ALL: [Control; 19] = [
        Control::MasterBrightness,
        Control::MasterSpeed,
        Control::FloorLevel,
        Control::MasterHueAmount,
        Control::LayerEnable,
        Control::LayerOpacity,
        Control::LayerSpeed,
        Control::LayerScale,
        Control::LayerAudioAmount,
        Control::LayerHue,
        Control::LayerHueRange,
        Control::LayerSaturation,
        Control::LayerBrightness,
        Control::LayerTiltAmount,
        Control::LayerWalkAmount,
        Control::LayerParamA,
        Control::LayerParamB,
        Control::LayerParamC,
        Control::LayerParamD,
    ];

    /// The width of the control's slider: a rate is "a full swing in N seconds".
    fn span(self) -> f32 {
        match self {
            Control::MasterSpeed => 4.0,
            Control::LayerSpeed => 8.0,
            Control::LayerScale => 5.0,
            Control::LayerBrightness => 2.0,
            _ => 1.0,
        }
    }

    /// Hue is a circle: it slews the short way round.
    pub fn wraps(self) -> bool {
        self == Control::LayerHue
    }

    pub fn get(self, l: &LayerCfg) -> f32 {
        match self {
            Control::LayerOpacity => l.opacity,
            Control::LayerSpeed => l.speed,
            Control::LayerScale => l.scale,
            Control::LayerAudioAmount => l.audio_amount,
            Control::LayerHue => l.hue,
            Control::LayerHueRange => l.hue_range,
            Control::LayerSaturation => l.saturation,
            Control::LayerBrightness => l.brightness,
            Control::LayerTiltAmount => l.tilt_amount,
            Control::LayerWalkAmount => l.walk_amount,
            Control::LayerParamA => l.param_a,
            Control::LayerParamB => l.param_b,
            Control::LayerParamC => l.param_c,
            Control::LayerParamD => l.param_d,
            Control::LayerEnable => f32::from(u8::from(l.enabled)),
            _ => 0.0,
        }
    }

    pub fn set(self, l: &mut LayerCfg, v: f32) {
        match self {
            Control::LayerOpacity => l.opacity = v,
            Control::LayerSpeed => l.speed = v,
            Control::LayerScale => l.scale = v,
            Control::LayerAudioAmount => l.audio_amount = v,
            Control::LayerHue => l.hue = v,
            Control::LayerHueRange => l.hue_range = v,
            Control::LayerSaturation => l.saturation = v,
            Control::LayerBrightness => l.brightness = v,
            Control::LayerTiltAmount => l.tilt_amount = v,
            Control::LayerWalkAmount => l.walk_amount = v,
            Control::LayerParamA => l.param_a = v,
            Control::LayerParamB => l.param_b = v,
            Control::LayerParamC => l.param_c = v,
            Control::LayerParamD => l.param_d = v,
            _ => {}
        }
    }
}

/// Seconds for a full swing of `control` at `level`; `None` = instant.
fn preset_swing_secs(level: Level, control: Control) -> Option<f32> {
    use Control as C;
    match level {
        Level::Guided => Some(match control {
            // Blackout from a Guided device is a quick fade, not a cut.
            C::MasterBrightness => 0.25,
            C::LayerEnable => 1.0,
            C::LayerHue => 2.0,
            _ => 0.5,
        }),
        // Patterns fade in and out; the master hue glides. Live controls act
        // at once (plans/no-hard-cuts.md).
        Level::Standard => match control {
            C::LayerEnable => Some(1.0),
            C::MasterHueAmount => Some(0.5),
            _ => None,
        },
        Level::Expert => None,
    }
}

/// A device's guardrail settings, kept on its `ClientRecord`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct GuardrailCfg {
    pub level: Level,
    /// Expert only: per-control rate limits in units per second. Absent or
    /// non-positive = no limit.
    pub rates: BTreeMap<Control, f32>,
}

impl GuardrailCfg {
    /// The d/dt cap a change from this device carries for `control`.
    pub fn rate(&self, control: Control) -> Option<f32> {
        if self.level == Level::Expert {
            return self
                .rates
                .get(&control)
                .copied()
                .filter(|r| r.is_finite() && *r > 0.0);
        }
        preset_swing_secs(self.level, control).map(|secs| control.span() / secs.max(1e-3))
    }

    /// The minimum seconds a scene change this device triggers may take.
    pub fn min_transition_secs(&self) -> f32 {
        if self.level == Level::Guided { 1.5 } else { 0.0 }
    }

    /// The range this device may set `control` to, when narrower than the
    /// slider's own.
    pub fn range(&self, control: Control) -> Option<(f32, f32)> {
        if self.level != Level::Guided {
            return None;
        }
        match control {
            Control::MasterSpeed => Some((0.25, 2.0)),
            Control::LayerSpeed => Some((-2.0, 2.0)),
            Control::LayerScale => Some((0.25, 3.0)),
            Control::LayerBrightness => Some((0.0, 1.25)),
            _ => None,
        }
    }

    pub fn clamp(&self, control: Control, v: f32) -> f32 {
        match self.range(control) {
            Some((lo, hi)) => v.clamp(lo, hi),
            None => v,
        }
    }

    /// Guided's narrower range for the walk depth and walk speed globals.
    pub fn walk_range(&self) -> Option<((f32, f32), (f32, f32))> {
        (self.level == Level::Guided).then_some(((0.0, 1.5), (0.25, 2.0)))
    }
}

/// The rate whoever last wrote a control carries. Masters are keyed by control,
/// layer fields by (config layer index, control).
#[derive(Debug, Clone, Default)]
pub struct ControlRates {
    /// Bumped on every change, so the engine copies only when it moved.
    pub version: u64,
    /// Bumped on structural layer edits (add, remove, move, whole-stack swaps):
    /// the engine snaps its layer slews instead of gliding a neighbour's values.
    pub structure: u64,
    master: HashMap<Control, Option<f32>>,
    layers: HashMap<(usize, Control), Option<f32>>,
}

impl ControlRates {
    /// Rate for a master control; unwritten controls use the Standard preset.
    pub fn master(&self, control: Control) -> Option<f32> {
        self.master
            .get(&control)
            .copied()
            .unwrap_or_else(|| GuardrailCfg::default().rate(control))
    }

    pub fn layer(&self, index: usize, control: Control) -> Option<f32> {
        self.layers
            .get(&(index, control))
            .copied()
            .unwrap_or_else(|| GuardrailCfg::default().rate(control))
    }

    pub fn note_master(&mut self, control: Control, by: &GuardrailCfg) {
        self.master.insert(control, by.rate(control));
        self.version += 1;
    }

    pub fn note_layer(&mut self, index: usize, control: Control, by: &GuardrailCfg) {
        self.layers.insert((index, control), by.rate(control));
        self.version += 1;
    }

    pub fn restructure(&mut self) {
        self.layers.clear();
        self.structure += 1;
        self.version += 1;
    }
}

/// Note every control `by` changed between `old` and `new` layer `index`, and
/// clamp the changed fields to `by`'s ranges. Untouched fields keep whatever
/// someone else set, even outside `by`'s range.
pub fn note_layer_edit(
    rates: &mut ControlRates,
    index: usize,
    old: &LayerCfg,
    new: &mut LayerCfg,
    by: &GuardrailCfg,
) {
    if old.kind != new.kind {
        // A different pattern in the slot: nothing to glide between.
        rates.restructure();
        for c in LAYER_FIELDS {
            c.set(new, by.clamp(c, c.get(new)));
        }
        return;
    }
    if old.enabled != new.enabled {
        rates.note_layer(index, Control::LayerEnable, by);
    }
    for c in LAYER_FIELDS {
        if c.get(old) != c.get(new) {
            c.set(new, by.clamp(c, c.get(new)));
            rates.note_layer(index, c, by);
        }
    }
}

/// Move `current` toward `target` by at most `rate * dt` (`None` = jump).
pub fn slew(current: f32, target: f32, rate: Option<f32>, dt: f32, wraps: bool) -> f32 {
    let Some(rate) = rate else { return target };
    let delta = if wraps {
        (target - current + 0.5).rem_euclid(1.0) - 0.5
    } else {
        target - current
    };
    let step = rate * dt.max(0.0);
    if delta.abs() <= step {
        return target;
    }
    let next = current + step.copysign(delta);
    if wraps { next.rem_euclid(1.0) } else { next }
}

/// Per-layer slew state: the rendered value of each `LAYER_FIELDS` entry.
#[derive(Debug, Clone, Default)]
pub struct LayerSlew {
    vals: Option<[f32; LAYER_FIELDS.len()]>,
    kind: Option<crate::layers::LayerKind>,
}

impl LayerSlew {
    /// Step toward `target` and return the layer to render. A new slot or a
    /// different pattern kind snaps.
    pub fn step(
        &mut self,
        target: &LayerCfg,
        dt: f32,
        mut rate: impl FnMut(Control) -> Option<f32>,
    ) -> LayerCfg {
        let fresh = self.kind != Some(target.kind);
        let vals = self.vals.get_or_insert([0.0; LAYER_FIELDS.len()]);
        let mut out = target.clone();
        for (v, c) in vals.iter_mut().zip(LAYER_FIELDS) {
            *v = if fresh {
                c.get(target)
            } else {
                slew(*v, c.get(target), rate(c), dt, c.wraps())
            };
            c.set(&mut out, *v);
        }
        self.kind = Some(target.kind);
        out
    }

    pub fn snap(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(level: Level) -> GuardrailCfg {
        GuardrailCfg { level, ..Default::default() }
    }

    #[test]
    fn standard_keeps_live_controls_instant_and_fades_patterns() {
        let s = cfg(Level::Standard);
        assert_eq!(s.rate(Control::MasterBrightness), None, "Blackout cuts");
        assert_eq!(s.rate(Control::LayerOpacity), None);
        assert_eq!(s.rate(Control::LayerEnable), Some(1.0));
        assert!(s.rate(Control::MasterHueAmount).is_some());
        assert_eq!(s.range(Control::LayerSpeed), None);
        assert_eq!(s.min_transition_secs(), 0.0);
    }

    #[test]
    fn guided_limits_everything_and_narrows_ranges() {
        let g = cfg(Level::Guided);
        for c in Control::ALL {
            assert!(g.rate(c).is_some(), "{c:?} unlimited in Guided");
        }
        assert_eq!(g.rate(Control::MasterBrightness), Some(4.0));
        assert_eq!(g.clamp(Control::LayerSpeed, 4.0), 2.0);
        assert_eq!(g.clamp(Control::LayerOpacity, 1.0), 1.0);
        assert!(g.min_transition_secs() > 0.0);
    }

    #[test]
    fn expert_is_unlimited_until_it_sets_its_own_rates() {
        let mut e = cfg(Level::Expert);
        for c in Control::ALL {
            assert_eq!(e.rate(c), None, "{c:?}");
        }
        e.rates.insert(Control::LayerOpacity, 0.5);
        e.rates.insert(Control::LayerSpeed, 0.0);
        assert_eq!(e.rate(Control::LayerOpacity), Some(0.5));
        assert_eq!(e.rate(Control::LayerSpeed), None, "zero means no limit");
        // Custom rates mean nothing outside Expert.
        let mut g = e.clone();
        g.level = Level::Standard;
        assert_eq!(g.rate(Control::LayerOpacity), None);
    }

    #[test]
    fn slew_is_rate_limited_and_lands_exactly() {
        assert_eq!(slew(0.0, 1.0, None, 0.016, false), 1.0);
        let mut v = 1.0;
        let mut frames = 0;
        while v > 0.0 {
            v = slew(v, 0.0, Some(4.0), 1.0 / 60.0, false);
            frames += 1;
        }
        assert_eq!(v, 0.0);
        assert!((15..=16).contains(&frames), "a full swing at 4/s is a quarter second: {frames}");
    }

    #[test]
    fn hue_slews_the_short_way_round() {
        let v = slew(0.95, 0.05, Some(1.0), 0.05, true);
        assert!((v - 0.0).abs() < 1e-6 || (v - 1.0).abs() < 1e-6, "{v}");
        assert!((slew(0.95, 0.05, Some(1.0), 1.0, true) - 0.05).abs() < 1e-6);
    }

    #[test]
    fn layer_edit_notes_only_changed_fields_and_clamps_them() {
        let mut rates = ControlRates::default();
        let old = LayerCfg { speed: 4.0, ..LayerCfg::default() };
        let mut new = LayerCfg { speed: 4.0, scale: 5.0, ..LayerCfg::default() };
        note_layer_edit(&mut rates, 2, &old, &mut new, &cfg(Level::Guided));
        assert_eq!(new.speed, 4.0, "an Expert's untouched speed stays");
        assert_eq!(new.scale, 3.0, "Guided's own change is clamped");
        assert!(rates.layer(2, Control::LayerScale).is_some());
        assert_eq!(rates.layer(2, Control::LayerSpeed), None, "unwritten: Standard");
        assert_eq!(rates.layer(3, Control::LayerScale), None);
    }

    #[test]
    fn layer_slew_snaps_on_a_new_kind_and_glides_otherwise() {
        let mut s = LayerSlew::default();
        let a = LayerCfg { opacity: 1.0, ..LayerCfg::default() };
        assert_eq!(s.step(&a, 0.1, |_| Some(1.0)).opacity, 1.0, "first frame snaps");
        let b = LayerCfg { opacity: 0.0, ..a.clone() };
        assert!((s.step(&b, 0.1, |_| Some(1.0)).opacity - 0.9).abs() < 1e-6);
        let other = LayerCfg {
            kind: crate::layers::LayerKind::BeatRings,
            opacity: 0.0,
            ..a.clone()
        };
        assert_eq!(s.step(&other, 0.1, |_| Some(1.0)).opacity, 0.0);
    }

    #[test]
    fn control_names_round_trip() {
        let json = serde_json::to_string(&GuardrailCfg {
            level: Level::Expert,
            rates: [(Control::LayerParamA, 2.0)].into_iter().collect(),
        })
        .unwrap();
        assert_eq!(json, r#"{"level":"expert","rates":{"layer_param_a":2.0}}"#);
    }
}
