//! GPU-side records shared by the engine's two shaders (`gate.wgsl` and
//! [`crate::codegen::PATCH_LIB_WGSL`]). Every layout here is uploaded with
//! `bytemuck` as-is, by the desktop engine and by the browser runtime alike,
//! so a field change here must be mirrored in both WGSL copies.

pub const MAX_EFFECTS: usize = 32;
pub const MAX_AUDIO_SOURCES: usize = 4;
/// Live-draw dabs (see `PenKind`). 512 supports several fingers drawing at once
/// across multiple clients with ~2 s trails.
pub const MAX_DABS: usize = 512;

#[repr(C)]
#[derive(Debug, Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Globals {
    pub spokes: u32,
    pub pixels: u32,
    pub layer_count: u32,
    pub effect_count: u32,
    pub time: f32,
    pub dt: f32,
    pub master: f32,
    pub inner_over_outer: f32,
    pub tilt_x: f32,
    pub tilt_y: f32,
    pub shake: f32,
    pub yaw: f32,
    pub dab_count: u32,
    pub video_width: u32,
    pub video_height: u32,
    pub video_active: u32,
    /// Number of leading GPU layers that belong to the outgoing scene.
    pub transition_split: u32,
    /// Non-zero while the shader should compose two independent scene stacks.
    pub transition_active: u32,
    /// Smoothed 0..1 mix from the outgoing scene to the incoming scene.
    pub transition_progress: f32,
    /// 0..1 fade-in of the Video layer's contribution, smoothstepped here so
    /// the shader's opacity scale stays a plain multiply.
    pub video_mix: f32,
    /// PRO DJ LINK transport visuals. These only add overlays to the base scene.
    pub dj_link_visual_active: u32,
    pub dj_fade_position: f32,
    pub dj_fade_activity: f32,
    pub dj_looping: f32,
    /// Game mode (plans/game-mode.md). Non-zero while a game world should be
    /// composited over the scene; `game_mix` is the smoothed crossfade.
    pub game_active: u32,
    pub game_mix: f32,
    /// Game grid dimensions: θ cells (1:1 with spokes, clamped) × radial cells.
    pub game_theta: u32,
    pub game_rings: u32,
    /// 0..1 progress from the previous sim tick's grid to the current one; the
    /// shader interpolates so cells glide instead of strobing per generation.
    pub game_alpha: f32,
    /// Beat envelope (1 on the beat, decaying) for the game's brightness pulse.
    pub game_beat: f32,
    /// Raster games (DOOM, plans/doom.md): 1 = a planar frame of
    /// `game_theta` × `game_rings` pixels mapped across the disc, 2 = the same
    /// mirrored left-right; 0 = the polar cell grid.
    pub game_style: u32,
    /// Raster orientation: radians of the screen's "down" direction.
    pub game_turn: f32,
    /// Whole-composition rotation, integrated on the CPU so it remains
    /// continuous as transient button pulses expire.
    pub rotation: f32,
    /// Master hue pull (operator "warm colors now"). Target in turns; amount
    /// 0 disables. `hue_loose` 0..1 fades the pull out for hues far from the
    /// target so flourishes survive — 0 is a strict pull. These occupy what
    /// was `_pad_rotation`, so the GPU struct layout is unchanged.
    pub hue_target: f32,
    pub hue_amount: f32,
    pub hue_loose: f32,
    /// Live records in the TOUCH buffer (binding 10); see `crate::touch`.
    pub touch_count: u32,
    pub _pad_touch: [u32; 3],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct AudioUniform {
    pub level: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub onset: f32,
    pub beat_phase: f32,
    pub bpm: f32,
    /// 0..1 confidence in `bpm`; shaders and automation gate on it.
    pub bpm_conf: f32,
    pub bass_att: f32,
    pub mid_att: f32,
    pub treble_att: f32,
    pub _pad2: f32,
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
    pub rotation: f32,
    pub grow: f32,
    pub edge: f32,
    pub fill: f32,
    /// Who fired it: 0 = a client (pads, keys, taps), otherwise the emitting
    /// node's `effects::effect_source`. Render effects draws the sources its
    /// wired chain names; the layer stack draws only 0.
    pub source: u32,
}

/// One finger in the TOUCH uniform array (binding 10, `MAX_TOUCHES` long),
/// read only by the patch shader's touch nodes. Composition frame, like dabs.
/// 48 bytes: a multiple of 16, as a uniform array stride must be.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuTouch {
    pub angle: f32,
    pub radius: f32,
    /// Seconds since touchdown.
    pub age: f32,
    /// Seconds since release; negative while the finger is down.
    pub released: f32,
    pub hue: f32,
    pub saturation: f32,
    pub brightness: f32,
    /// Units (array radii) per second.
    pub speed: f32,
    /// Direction of motion, composition cartesian frame.
    pub dir: f32,
    pub _pad: [f32; 3],
}

/// Floats per audio source in the SCOPE buffer (binding 6): a waveform ring of
/// `SCOPE_WAVE` samples, then `SCOPE_SPECTRUM` spectrum bins.
pub const SCOPE_WAVE: usize = 256;
pub const SCOPE_SPECTRUM: usize = 64;
pub const SCOPE_FLOATS: usize = SCOPE_WAVE + SCOPE_SPECTRUM;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codegen::PATCH_LIB_WGSL;

    /// Field names of a WGSL struct, in order.
    fn wgsl_fields(name: &str) -> Vec<String> {
        let body = PATCH_LIB_WGSL
            .split_once(&format!("struct {name} {{"))
            .unwrap_or_else(|| panic!("struct {name}"))
            .1
            .split_once('}')
            .unwrap()
            .0;
        body.lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with("//"))
            .map(|l| l.split(':').next().unwrap().trim().to_string())
            .collect()
    }

    /// Every record here is uploaded byte-for-byte, and every field is 4
    /// bytes, so a struct matches its WGSL twin exactly when the field counts
    /// agree. The browser runtime depends on this as much as the engine does.
    #[test]
    fn records_match_their_wgsl_structs() {
        for (name, size) in [
            ("Globals", std::mem::size_of::<Globals>()),
            ("AudioU", std::mem::size_of::<AudioUniform>()),
            ("Effect", std::mem::size_of::<GpuEffect>()),
            ("Dab", std::mem::size_of::<GpuDab>()),
            ("Touch", std::mem::size_of::<GpuTouch>()),
        ] {
            assert_eq!(
                wgsl_fields(name).len() * 4,
                size,
                "{name} drifted from patch_lib.wgsl"
            );
        }
        assert_eq!(wgsl_fields("Globals")[0], "spokes");
        assert_eq!(wgsl_fields("Globals").last().unwrap(), "_pad_touch2");
    }

    #[test]
    fn touch_uniform_matches_the_tracker() {
        assert_eq!(std::mem::size_of::<GpuTouch>() % 16, 0, "uniform array stride");
        assert!(PATCH_LIB_WGSL.contains(&format!(
            "var<uniform> TOUCH: array<Touch, {}>;",
            crate::touch::MAX_TOUCHES
        )));
    }

    #[test]
    fn scope_layout_matches_the_shader() {
        assert!(PATCH_LIB_WGSL.contains(&format!("const WAVE_N: u32 = {SCOPE_WAVE}u;")));
        assert!(PATCH_LIB_WGSL.contains(&format!("const SPEC_N: u32 = {SCOPE_SPECTRUM}u;")));
    }
}
