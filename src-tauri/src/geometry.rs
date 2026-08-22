//! Mapping between pixel indices, physical polar positions, and sACN universes.
//!
//! Pixel indexing convention everywhere in this app: `idx = spoke * pixels_per_spoke + i`
//! where `i = 0` is the OUTER end of the spoke (strings are fed from outside) and the
//! last pixel is at the inner radius.

use crate::config::{GeometryConfig, OutputConfig};

/// Polar position of a pixel. Angle in radians, radius in feet.
pub fn pixel_polar(geo: &GeometryConfig, spoke: u32, i: u32) -> (f32, f32) {
    let angle = spoke as f32 / geo.spokes as f32 * std::f32::consts::TAU;
    let t = if geo.pixels_per_spoke > 1 {
        i as f32 / (geo.pixels_per_spoke - 1) as f32
    } else {
        0.0
    };
    let radius = geo.outer_radius_ft + (geo.inner_radius_ft - geo.outer_radius_ft) * t;
    (angle, radius)
}

/// Universes that actually carry pixels for one spoke.
pub fn universes_per_spoke(geo: &GeometryConfig, out: &OutputConfig) -> u16 {
    let ppu = out.pixels_per_universe.max(1) as u32;
    geo.pixels_per_spoke.div_ceil(ppu)
}

/// Spacing between consecutive spokes' start universes — each spoke begins on a
/// fresh universe boundary, and the patch may reserve more universes per spoke
/// than the pixels need (`output.universe_stride`; see its doc comment). Never
/// less than the data requires, or spokes would overlap on the wire.
pub fn universe_stride(geo: &GeometryConfig, out: &OutputConfig) -> u16 {
    universes_per_spoke(geo, out).max(out.universe_stride)
}

/// Universes we transmit. Reserved-but-unused universes inside each spoke's block
/// are not counted: nothing is sent on them.
pub fn total_universes(geo: &GeometryConfig, out: &OutputConfig) -> u16 {
    universes_per_spoke(geo, out) * geo.spokes as u16
}

/// Every universe we actually put pixels on, ascending. Mirrors the plan
/// `sacn::SacnSender::configure` builds — reserved-but-unused universes inside a
/// spoke's block are skipped, because nothing is sent on them and nothing else
/// using them is competing with us.
pub fn universe_list(geo: &GeometryConfig, out: &OutputConfig) -> Vec<u16> {
    let ppu = out.pixels_per_universe.max(1) as u32;
    let ups = universes_per_spoke(geo, out) as u32;
    let stride = universe_stride(geo, out) as u32;
    let mut universes = Vec::new();
    for spoke in 0..geo.spokes {
        for u in 0..ups {
            if u * ppu >= geo.pixels_per_spoke {
                break;
            }
            universes.push(out.start_universe + (spoke * stride + u) as u16);
        }
    }
    universes.sort_unstable();
    universes.dedup();
    universes
}

/// The unicast destination (controller IP) for a given spoke, if configured.
pub fn controller_for_spoke(out: &OutputConfig, spoke: u32) -> Option<&str> {
    let idx = (spoke / out.strings_per_controller.max(1)) as usize;
    out.controllers.get(idx).map(|s| s.as_str()).filter(|s| !s.is_empty())
}

/// Implied physical strip length vs. the configured radii, for the settings UI to
/// display ("350 px at 60/m = 5.83 m = 19.1 ft; outer->inner span is 17.0 ft").
pub fn implied_strip_ft(geo: &GeometryConfig) -> (f32, f32) {
    let strip_m = geo.pixels_per_spoke as f32 / geo.leds_per_meter.max(1.0);
    let strip_ft = strip_m * 3.28084;
    let span_ft = geo.outer_radius_ft - geo.inner_radius_ft;
    (strip_ft, span_ft)
}
