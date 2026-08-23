//! Hardware commissioning patterns: deterministic CPU-generated frames that
//! bypass the pattern engine entirely.
//!
//! This exists to answer the questions you have while *wiring* the array, none of
//! which a show can answer: is the colour order right, which physical spoke is
//! logical spoke 17, is `pixels_per_spoke` actually 350, where does universe 4
//! start, are the strings really fed from the outside.
//!
//! Deliberately literal. Master brightness, master speed, the show scheduler,
//! effects and audio are all ignored — a test frame is exactly what the operator
//! asked for and nothing else, or it cannot be used as evidence about the
//! hardware. LED gamma is NOT bypassed: the frame goes out through the same
//! `SacnSender` gamma LUT the show uses, so a test exercises the real output path.
//!
//! State lives in `SharedState`, never in `AppConfig` — test mode must not be able
//! to survive a restart into a show.

use crate::config::{GeometryConfig, OutputConfig};
use serde::{Deserialize, Serialize};

/// How long one step of `ColorCycle` holds, in seconds. Long enough to walk a few
/// metres of strip and still be sure which colour you are looking at.
const COLOR_CYCLE_STEP_SECS: f32 = 1.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TestPattern {
    /// Everything off. Proves data is arriving and being obeyed — a rig that
    /// stays lit here is holding a last look, not following us.
    Blackout,
    /// One colour everywhere. The colour-order and dead-pixel test.
    #[default]
    Solid,
    /// Red, green, blue, white in turn. The UI names what *should* be lit right
    /// now, so a GRB strip announces itself immediately.
    ColorCycle,
    /// The Nth pixel counted from the outer feed (or from the inner end),
    /// `width` pixels wide, optionally chasing. Verifies pixel count, string
    /// direction, and null-pixel offsets.
    PixelIndex,
    /// Every 10th pixel dim white, every 50th blue, every 100th red. Lets you
    /// count the strip physically without stepping one pixel at a time.
    Ruler,
    /// The first pixel of every universe, alternating cyan/magenta. Checks
    /// `pixels_per_universe` and the universe boundaries against the
    /// controller's own configuration.
    UniverseMarks,
    /// Full brightness at the outer feed fading to black at the inner end. One
    /// glance confirms feed direction on all spokes at once.
    Gradient,
    /// The spoke number in binary on the outermost pixels, after a white start
    /// marker. Read which physical spoke is logical N without stepping.
    SpokeId,
    /// A band travelling along every spoke. Smooth-motion and refresh sanity.
    Chase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpokeSelect {
    #[default]
    All,
    /// Just `TestConfig::spoke`.
    One,
    /// Every spoke driven by `TestConfig::controller`.
    Controller,
    /// Step through the spokes automatically at `cycle_hz`.
    Cycle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TestConfig {
    pub pattern: TestPattern,
    /// 0..1, applied to the whole test frame. Low values are how you hunt
    /// voltage droop without pulling hundreds of amps.
    pub brightness: f32,
    /// Hue in turns; negative = white (same convention as the paint/effect path).
    pub hue: f32,
    pub saturation: f32,
    /// Nth pixel, counted from whichever end `from_inner` selects.
    pub index: u32,
    /// Count from the inner (last) end instead of the outer feed end.
    pub from_inner: bool,
    /// How many consecutive pixels light, extending away from the counted end.
    pub width: u32,
    /// Advance `index` automatically at this rate (0 = hold still). Also drives
    /// `Chase`.
    pub chase_hz: f32,
    /// Blink the whole frame at this rate (0 = steady). A blinking rig proves
    /// frames are still arriving; a steady one might just be a held last look.
    pub blink_hz: f32,
    pub spoke_select: SpokeSelect,
    pub spoke: u32,
    pub controller: u32,
    /// Step rate for `SpokeSelect::Cycle`.
    pub cycle_hz: f32,
    /// Disarm automatically after this long (0 = never). Cheap insurance against
    /// walking away from a rig left in test mode.
    pub auto_exit_secs: u32,
}

impl Default for TestConfig {
    fn default() -> Self {
        Self {
            pattern: TestPattern::Solid,
            brightness: 0.25,
            hue: -1.0,
            saturation: 1.0,
            index: 0,
            from_inner: false,
            width: 1,
            chase_hz: 0.0,
            blink_hz: 0.0,
            spoke_select: SpokeSelect::All,
            spoke: 0,
            controller: 0,
            cycle_hz: 1.0,
            auto_exit_secs: 1800,
        }
    }
}

/// Live test-mode state. Not part of `AppConfig` on purpose (see module docs).
pub struct TestState {
    pub active: bool,
    pub cfg: TestConfig,
    /// When test mode was armed; patterns are a pure function of the elapsed
    /// time since, so they always start at a known phase.
    pub started: std::time::Instant,
}

impl Default for TestState {
    fn default() -> Self {
        Self {
            active: false,
            cfg: TestConfig::default(),
            started: std::time::Instant::now(),
        }
    }
}

impl TestState {
    pub fn elapsed(&self) -> f32 {
        self.started.elapsed().as_secs_f32()
    }

    /// True once the auto-exit deadline has passed (never, when it is 0).
    pub fn expired(&self) -> bool {
        self.active
            && self.cfg.auto_exit_secs > 0
            && self.elapsed() >= self.cfg.auto_exit_secs as f32
    }

    /// Seconds until auto-exit; 0 when there is no deadline.
    pub fn remaining(&self) -> f32 {
        if !self.active || self.cfg.auto_exit_secs == 0 {
            return 0.0;
        }
        (self.cfg.auto_exit_secs as f32 - self.elapsed()).max(0.0)
    }
}

/// Hue in turns + saturation + value to linear RGB. A negative hue means white,
/// matching the paint and effect paths.
fn hsv(hue_turns: f32, saturation: f32, value: f32) -> [f32; 3] {
    if hue_turns < 0.0 {
        return [value; 3];
    }
    let h = hue_turns.rem_euclid(1.0) * 6.0;
    let s = saturation.clamp(0.0, 1.0);
    let c = value * s;
    let x = c * (1.0 - (h % 2.0 - 1.0).abs());
    let m = value - c;
    let (r, g, b) = match h as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    [r + m, g + m, b + m]
}

/// The four `ColorCycle` steps, with the names the UI shows so the operator can
/// compare "what it says" against "what the strip did".
pub const COLOR_CYCLE_STEPS: [(&str, [f32; 3]); 4] = [
    ("RED", [1.0, 0.0, 0.0]),
    ("GREEN", [0.0, 1.0, 0.0]),
    ("BLUE", [0.0, 0.0, 1.0]),
    ("WHITE", [1.0, 1.0, 1.0]),
];

/// Which `ColorCycle` step is showing at time `t`.
pub fn color_cycle_step(t: f32) -> usize {
    ((t.max(0.0) / COLOR_CYCLE_STEP_SECS) as usize) % COLOR_CYCLE_STEPS.len()
}

/// Is this spoke lit at all, given the spoke selection?
fn spoke_lit(cfg: &TestConfig, out: &OutputConfig, geo: &GeometryConfig, spoke: u32, t: f32) -> bool {
    match cfg.spoke_select {
        SpokeSelect::All => true,
        SpokeSelect::One => spoke == cfg.spoke,
        // Same mapping `geometry::controller_for_spoke` uses to pick a
        // destination, read in the other direction.
        SpokeSelect::Controller => spoke / out.strings_per_controller.max(1) == cfg.controller,
        SpokeSelect::Cycle => {
            let spokes = geo.spokes.max(1);
            let step = (t.max(0.0) * cfg.cycle_hz.max(0.01)) as u32;
            spoke == step % spokes
        }
    }
}

/// Colour for one pixel, before the master brightness/blink gate. `i` counts from
/// the OUTER feed end (the app-wide convention — see `geometry`).
fn pixel(
    cfg: &TestConfig,
    geo: &GeometryConfig,
    out: &OutputConfig,
    spoke: u32,
    i: u32,
    t: f32,
) -> [f32; 3] {
    let pps = geo.pixels_per_spoke.max(1);
    let base = hsv(cfg.hue, cfg.saturation, 1.0);
    let off = [0.0; 3];

    match cfg.pattern {
        TestPattern::Blackout => off,
        TestPattern::Solid => base,
        TestPattern::ColorCycle => COLOR_CYCLE_STEPS[color_cycle_step(t)].1,

        TestPattern::PixelIndex => {
            // Distance from whichever end the operator is counting from, so
            // "from the back" needs no separate windowing logic.
            let d = if cfg.from_inner { pps - 1 - i } else { i };
            let start = effective_index(cfg, pps, t);
            let width = cfg.width.clamp(1, pps);
            if d >= start && d < start + width { base } else { off }
        }

        TestPattern::Ruler => {
            // Coarsest marker wins, so pixel 0 reads as red — that end is the feed.
            if i % 100 == 0 {
                [0.9, 0.0, 0.0]
            } else if i % 50 == 0 {
                [0.0, 0.15, 0.9]
            } else if i % 10 == 0 {
                [0.18, 0.18, 0.18]
            } else {
                off
            }
        }

        TestPattern::UniverseMarks => {
            let ppu = out.pixels_per_universe.max(1) as u32;
            if i % ppu != 0 {
                return off;
            }
            // Alternate so two consecutive universe starts are distinguishable
            // when the count per universe is small.
            if (i / ppu) % 2 == 0 {
                [0.0, 0.9, 0.9]
            } else {
                [0.9, 0.0, 0.9]
            }
        }

        TestPattern::Gradient => {
            let t01 = if pps > 1 { i as f32 / (pps - 1) as f32 } else { 0.0 };
            let v = 1.0 - t01;
            [base[0] * v, base[1] * v, base[2] * v]
        }

        TestPattern::SpokeId => {
            // [marker][gap][bit MSB][gap]...[bit LSB]. Blocks scale with the
            // strip so this stays readable at any pixel count.
            let block = (pps / 40).max(2);
            let stride = block * 2;
            let bits = bits_needed(geo.spokes);
            if i < block {
                return [1.0, 1.0, 1.0]; // start marker: read leftward from here
            }
            let after = i - block;
            let slot = after / stride;
            let within = after % stride;
            if slot >= bits || within >= block {
                return off;
            }
            let bit = bits - 1 - slot; // MSB first, reading outward-in
            if (spoke >> bit) & 1 == 1 {
                base
            } else {
                [0.03, 0.03, 0.03] // dim, so the empty slots are still countable
            }
        }

        TestPattern::Chase => {
            let width = cfg.width.clamp(1, pps) as f32;
            let rate = if cfg.chase_hz > 0.0 { cfg.chase_hz } else { 0.5 };
            let head = (t.max(0.0) * rate).rem_euclid(1.0) * pps as f32;
            // Wrapped distance behind the head, so the band re-enters at the
            // feed end instead of blinking out.
            let mut d = head - i as f32;
            if d < 0.0 {
                d += pps as f32;
            }
            if d < width {
                let fade = 1.0 - d / width;
                [base[0] * fade, base[1] * fade, base[2] * fade]
            } else {
                off
            }
        }
    }
}

/// Bits needed to number `n` spokes (at least 1).
fn bits_needed(n: u32) -> u32 {
    (u32::BITS - n.saturating_sub(1).leading_zeros()).max(1)
}

/// Render one test frame into `buf` as perceptual RGB, exactly like the engine
/// produces — LED gamma is applied downstream by the sACN sender.
pub fn render_into(
    cfg: &TestConfig,
    geo: &GeometryConfig,
    out: &OutputConfig,
    t: f32,
    buf: &mut Vec<u8>,
) {
    let pps = geo.pixels_per_spoke.max(1);
    buf.clear();
    buf.resize(geo.pixel_count() * 3, 0);

    // Blink gates the whole frame; the dark half needs no further work.
    if cfg.blink_hz > 0.0 && (t.max(0.0) * cfg.blink_hz).rem_euclid(1.0) >= 0.5 {
        return;
    }
    let master = cfg.brightness.clamp(0.0, 1.0);
    if master <= 0.0 {
        return;
    }

    for spoke in 0..geo.spokes {
        if !spoke_lit(cfg, out, geo, spoke, t) {
            continue;
        }
        for i in 0..pps {
            let rgb = pixel(cfg, geo, out, spoke, i, t);
            let o = ((spoke * pps + i) * 3) as usize;
            for c in 0..3 {
                buf[o + c] = ((rgb[c] * master).clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            }
        }
    }
}

/// The index `PixelIndex` is actually lighting right now, chase included.
pub fn effective_index(cfg: &TestConfig, pixels_per_spoke: u32, t: f32) -> u32 {
    let advance = if cfg.chase_hz > 0.0 {
        (t.max(0.0) * cfg.chase_hz) as u32
    } else {
        0
    };
    (cfg.index + advance) % pixels_per_spoke.max(1)
}

/// One line naming what test mode is currently doing, for the always-visible
/// banner on every client.
pub fn summary(cfg: &TestConfig, pixels_per_spoke: u32, t: f32) -> String {
    let end = if cfg.from_inner { "inner end" } else { "outer feed" };
    let what = match cfg.pattern {
        TestPattern::Blackout => "Blackout".to_string(),
        TestPattern::Solid => "Solid colour".to_string(),
        TestPattern::ColorCycle => {
            format!("Colour cycle — should be {}", COLOR_CYCLE_STEPS[color_cycle_step(t)].0)
        }
        TestPattern::PixelIndex => format!(
            "Pixel {} from the {}{}",
            effective_index(cfg, pixels_per_spoke, t),
            end,
            if cfg.width > 1 {
                format!(" ({} wide)", cfg.width)
            } else {
                String::new()
            }
        ),
        TestPattern::Ruler => "Ruler (10/50/100)".to_string(),
        TestPattern::UniverseMarks => "Universe start marks".to_string(),
        TestPattern::Gradient => "Gradient from the outer feed".to_string(),
        TestPattern::SpokeId => "Spoke ID in binary".to_string(),
        TestPattern::Chase => "Chase".to_string(),
    };
    let where_ = match cfg.spoke_select {
        SpokeSelect::All => String::new(),
        SpokeSelect::One => format!(" · spoke {}", cfg.spoke),
        SpokeSelect::Controller => format!(" · controller {}", cfg.controller + 1),
        SpokeSelect::Cycle => " · cycling spokes".to_string(),
    };
    format!("{what}{where_} · {}%", (cfg.brightness * 100.0).round() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geo(spokes: u32, pixels_per_spoke: u32) -> GeometryConfig {
        GeometryConfig {
            spokes,
            pixels_per_spoke,
            ..Default::default()
        }
    }

    fn out() -> OutputConfig {
        OutputConfig {
            pixels_per_universe: 170,
            strings_per_controller: 4,
            ..Default::default()
        }
    }

    /// Indices of every non-black pixel in the frame.
    fn lit(buf: &[u8]) -> Vec<usize> {
        (0..buf.len() / 3)
            .filter(|p| buf[p * 3] != 0 || buf[p * 3 + 1] != 0 || buf[p * 3 + 2] != 0)
            .collect()
    }

    fn render(cfg: &TestConfig, g: &GeometryConfig, t: f32) -> Vec<u8> {
        let mut buf = Vec::new();
        render_into(cfg, g, &out(), t, &mut buf);
        buf
    }

    #[test]
    fn nth_pixel_counts_from_the_outer_feed_by_default() {
        let g = geo(2, 10);
        let cfg = TestConfig {
            pattern: TestPattern::PixelIndex,
            brightness: 1.0,
            index: 3,
            ..Default::default()
        };
        // Pixel 3 of each spoke, where index 0 is the outer feed.
        assert_eq!(lit(&render(&cfg, &g, 0.0)), vec![3, 13]);
    }

    #[test]
    fn nth_pixel_from_the_inner_end_counts_back_from_the_last_pixel() {
        let g = geo(2, 10);
        let cfg = TestConfig {
            pattern: TestPattern::PixelIndex,
            brightness: 1.0,
            index: 0,
            from_inner: true,
            ..Default::default()
        };
        // Index 0 from the inner end is the LAST pixel of each spoke.
        assert_eq!(lit(&render(&cfg, &g, 0.0)), vec![9, 19]);

        let cfg = TestConfig { index: 2, ..cfg };
        assert_eq!(lit(&render(&cfg, &g, 0.0)), vec![7, 17]);
    }

    #[test]
    fn width_extends_away_from_the_counted_end() {
        let g = geo(1, 10);
        let base = TestConfig {
            pattern: TestPattern::PixelIndex,
            brightness: 1.0,
            index: 1,
            width: 3,
            ..Default::default()
        };
        assert_eq!(lit(&render(&base, &g, 0.0)), vec![1, 2, 3]);

        let from_inner = TestConfig { from_inner: true, ..base };
        // Counting from the inner end, the window grows inward-to-outward.
        assert_eq!(lit(&render(&from_inner, &g, 0.0)), vec![6, 7, 8]);
    }

    #[test]
    fn chase_advances_the_index_one_pixel_per_period() {
        let g = geo(1, 10);
        let cfg = TestConfig {
            pattern: TestPattern::PixelIndex,
            brightness: 1.0,
            index: 0,
            chase_hz: 1.0,
            ..Default::default()
        };
        assert_eq!(lit(&render(&cfg, &g, 0.0)), vec![0]);
        assert_eq!(lit(&render(&cfg, &g, 2.5)), vec![2]);
        // And wraps at the end of the spoke rather than going dark.
        assert_eq!(lit(&render(&cfg, &g, 10.5)), vec![0]);
    }

    #[test]
    fn universe_marks_land_on_the_universe_boundaries() {
        let g = geo(1, 400);
        let mut o = out();
        o.pixels_per_universe = 170;
        let cfg = TestConfig {
            pattern: TestPattern::UniverseMarks,
            brightness: 1.0,
            ..Default::default()
        };
        let mut buf = Vec::new();
        render_into(&cfg, &g, &o, 0.0, &mut buf);
        assert_eq!(lit(&buf), vec![0, 170, 340]);
    }

    #[test]
    fn one_spoke_selection_blacks_out_every_other_spoke() {
        let g = geo(4, 5);
        let cfg = TestConfig {
            pattern: TestPattern::Solid,
            brightness: 1.0,
            spoke_select: SpokeSelect::One,
            spoke: 2,
            ..Default::default()
        };
        assert_eq!(lit(&render(&cfg, &g, 0.0)), vec![10, 11, 12, 13, 14]);
    }

    #[test]
    fn controller_selection_matches_the_sacn_spoke_mapping() {
        let g = geo(8, 1);
        let o = out(); // 4 strings per controller
        let cfg = TestConfig {
            pattern: TestPattern::Solid,
            brightness: 1.0,
            spoke_select: SpokeSelect::Controller,
            controller: 1,
            ..Default::default()
        };
        let mut buf = Vec::new();
        render_into(&cfg, &g, &o, 0.0, &mut buf);
        assert_eq!(lit(&buf), vec![4, 5, 6, 7]);
        // The generator and the sender must agree about which spokes belong to
        // which controller, or a test lights the wrong quarter of the wheel.
        for spoke in 4..8 {
            let mut o = o.clone();
            o.multicast = false;
            o.controllers = vec!["10.0.0.1".into(), "10.0.0.2".into()];
            assert_eq!(crate::geometry::controller_for_spoke(&o, spoke), Some("10.0.0.2"));
        }
    }

    #[test]
    fn cycle_steps_through_the_spokes_in_order() {
        let g = geo(4, 1);
        let cfg = TestConfig {
            pattern: TestPattern::Solid,
            brightness: 1.0,
            spoke_select: SpokeSelect::Cycle,
            cycle_hz: 1.0,
            ..Default::default()
        };
        assert_eq!(lit(&render(&cfg, &g, 0.0)), vec![0]);
        assert_eq!(lit(&render(&cfg, &g, 1.5)), vec![1]);
        assert_eq!(lit(&render(&cfg, &g, 4.5)), vec![0]); // wraps
    }

    #[test]
    fn brightness_scales_the_frame_and_zero_is_dark() {
        let g = geo(1, 2);
        let cfg = TestConfig {
            pattern: TestPattern::Solid,
            hue: -1.0, // white
            brightness: 0.5,
            ..Default::default()
        };
        assert_eq!(render(&cfg, &g, 0.0)[0], 128);
        let dark = TestConfig { brightness: 0.0, ..cfg };
        assert!(lit(&render(&dark, &g, 0.0)).is_empty());
    }

    #[test]
    fn blink_darkens_the_second_half_of_each_period() {
        let g = geo(1, 1);
        let cfg = TestConfig {
            pattern: TestPattern::Solid,
            brightness: 1.0,
            blink_hz: 1.0,
            ..Default::default()
        };
        assert_eq!(lit(&render(&cfg, &g, 0.2)).len(), 1);
        assert!(lit(&render(&cfg, &g, 0.7)).is_empty());
        assert_eq!(lit(&render(&cfg, &g, 1.2)).len(), 1);
    }

    #[test]
    fn ruler_marks_are_coarsest_wins_so_the_feed_end_reads_red() {
        let g = geo(1, 120);
        let cfg = TestConfig {
            pattern: TestPattern::Ruler,
            brightness: 1.0,
            ..Default::default()
        };
        let buf = render(&cfg, &g, 0.0);
        let red = |p: usize| (buf[p * 3], buf[p * 3 + 1], buf[p * 3 + 2]);
        assert_eq!(red(0).0, 230, "pixel 0 is a hundred-mark: red");
        assert!(red(50).2 > red(50).0, "50 is the blue mark");
        assert!(red(10).0 == red(10).1 && red(10).0 > 0, "10 is dim white");
        assert_eq!(red(11), (0, 0, 0));
    }

    #[test]
    fn colour_cycle_names_match_what_is_rendered() {
        let g = geo(1, 1);
        let cfg = TestConfig {
            pattern: TestPattern::ColorCycle,
            brightness: 1.0,
            ..Default::default()
        };
        for (step, (name, expected)) in COLOR_CYCLE_STEPS.iter().enumerate() {
            let t = step as f32 * COLOR_CYCLE_STEP_SECS + 0.1;
            assert_eq!(color_cycle_step(t), step, "{name}");
            let buf = render(&cfg, &g, t);
            for c in 0..3 {
                let want = (expected[c] * 255.0 + 0.5) as u8;
                assert_eq!(buf[c], want, "{name} channel {c}");
            }
        }
    }

    #[test]
    fn spoke_id_encodes_the_spoke_number_in_binary() {
        // 64 spokes needs 6 bits; block = max(2, 240/40) = 6, stride 12.
        let g = geo(64, 240);
        let cfg = TestConfig {
            pattern: TestPattern::SpokeId,
            brightness: 1.0,
            hue: -1.0,
            ..Default::default()
        };
        let buf = render(&cfg, &g, 0.0);
        let block = 6u32;
        let stride = 12u32;
        let bits = bits_needed(64);
        assert_eq!(bits, 6);

        for spoke in [0u32, 1, 17, 63] {
            for slot in 0..bits {
                let bit = bits - 1 - slot;
                let i = block + slot * stride; // first pixel of the slot's block
                let p = (spoke * g.pixels_per_spoke + i) as usize;
                let v = buf[p * 3];
                if (spoke >> bit) & 1 == 1 {
                    assert_eq!(v, 255, "spoke {spoke} bit {bit} should be set");
                } else {
                    assert!(v > 0 && v < 32, "spoke {spoke} bit {bit} should read as dim");
                }
            }
            // The white start marker is always there to read from.
            let marker = (spoke * g.pixels_per_spoke) as usize;
            assert_eq!(buf[marker * 3], 255);
        }
    }

    #[test]
    fn gradient_is_brightest_at_the_outer_feed() {
        let g = geo(1, 100);
        let cfg = TestConfig {
            pattern: TestPattern::Gradient,
            brightness: 1.0,
            hue: -1.0,
            ..Default::default()
        };
        let buf = render(&cfg, &g, 0.0);
        assert_eq!(buf[0], 255, "pixel 0 (outer feed) is full brightness");
        assert_eq!(buf[99 * 3], 0, "the inner end is dark");
        assert!(buf[50 * 3] > 100 && buf[50 * 3] < 155);
    }

    #[test]
    fn blackout_still_produces_a_full_frame_of_zeros() {
        let g = geo(3, 7);
        let cfg = TestConfig {
            pattern: TestPattern::Blackout,
            brightness: 1.0,
            ..Default::default()
        };
        let buf = render(&cfg, &g, 0.0);
        // A short buffer would make the sender skip universes rather than send
        // black — the whole point of Blackout is that data keeps flowing.
        assert_eq!(buf.len(), 3 * 7 * 3);
        assert!(buf.iter().all(|&b| b == 0));
    }

    #[test]
    fn auto_exit_expires_only_when_a_deadline_is_set() {
        let mut s = TestState {
            active: true,
            cfg: TestConfig { auto_exit_secs: 0, ..Default::default() },
            started: std::time::Instant::now() - std::time::Duration::from_secs(10_000),
        };
        assert!(!s.expired(), "0 means never");
        assert_eq!(s.remaining(), 0.0);

        s.cfg.auto_exit_secs = 1800;
        assert!(s.expired());

        s.started = std::time::Instant::now();
        assert!(!s.expired());
        assert!(s.remaining() > 1799.0);

        s.active = false;
        assert!(!s.expired(), "a disarmed state never expires again");
    }
}
