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
}
