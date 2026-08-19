//! The WebSocket wire protocol shared by every UI client (the Tauri webview, browsers
//! on the LAN, phones). Text frames carry JSON messages; preview frames are binary
//! (see `PREVIEW_MAGIC` layout below).

use crate::config::AppConfig;
use crate::layers::{DabPoint, EffectCfg, LayerCfg, PenKind};
use serde::{Deserialize, Serialize};

/// Binary preview frame layout (little endian):
/// `u32 magic, u32 frame_number, u16 spokes, u16 pixels_per_spoke_after_decimation,`
/// then `spokes * pixels` RGB triplets (pixel 0 = outer end of spoke).
pub const PREVIEW_MAGIC: u32 = 0x4547_5056; // "VPGE"

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    Hello {
        #[serde(default)]
        name: String,
        /// For remote audio sources: matched against `AudioSourceKind::Remote.client_id`.
        #[serde(default)]
        client_id: String,
        /// Auth token; only checked when `server.auth_token` is configured.
        #[serde(default)]
        token: String,
    },
    GetState,
    /// Full config replace (settings page "everything" updates go through this).
    SetConfig {
        config: Box<AppConfig>,
    },
    SetMaster {
        #[serde(default)]
        brightness: Option<f32>,
        #[serde(default)]
        speed: Option<f32>,
    },
    SetSacnEnabled {
        enabled: bool,
    },
    AddLayer {
        layer: LayerCfg,
    },
    UpdateLayer {
        index: usize,
        layer: LayerCfg,
    },
    RemoveLayer {
        index: usize,
    },
    MoveLayer {
        from: usize,
        to: usize,
    },
    TriggerEffect {
        effect: EffectCfg,
    },
    /// Live drawing: a batch of stroke points (coalesced per pointer frame) painted
    /// with the given pen. Collaborative — dabs from all clients merge.
    Paint {
        pen: PenKind,
        points: Vec<DabPoint>,
        /// Hue in turns; negative = white.
        #[serde(default)]
        hue: f32,
        /// Dab radius as a fraction of the array radius.
        #[serde(default = "default_dab_size")]
        size: f32,
        #[serde(default = "default_intensity")]
        intensity: f32,
    },
    SubscribePreview {
        /// Max frames per second this client wants.
        fps: f32,
        /// Keep every Nth pixel along each spoke (1 = full resolution).
        decimate: u32,
    },
    UnsubscribePreview,
    /// Audio features computed client-side from a remote browser microphone.
    /// Sent at the client's analysis hop rate (~40 Hz).
    AudioFrame {
        level: f32,
        bass: f32,
        mid: f32,
        treble: f32,
        /// Rectified spectral flux — the onset signal the beat tracker consumes.
        flux: f32,
    },
    /// Set this device's own friendly name (shown in the Clients panel).
    SetClientName {
        name: String,
    },
    /// Operator: rename a known client.
    RenameClient {
        id: String,
        name: String,
    },
    /// Operator: revoke a client — kicks it live and blocks rejoin by id.
    RevokeClient {
        id: String,
    },
    UnrevokeClient {
        id: String,
    },
    /// Operator: forget a disconnected client record entirely.
    ForgetClient {
        id: String,
    },
    /// Operator: replace the join token (invalidates old QR codes when
    /// `require_token` is on).
    RotateJoinToken,
    SetRequireToken {
        require: bool,
    },
    /// Phone orientation / motion, mapped onto the global control bus.
    Imu {
        /// Compass-ish heading in radians.
        yaw: f32,
        /// Forward/back tilt, roughly -1..1.
        pitch: f32,
        /// Left/right tilt, roughly -1..1.
        roll: f32,
        /// Acceleration magnitude (shake), m/s^2 above gravity.
        #[serde(default)]
        shake: f32,
    },
}

fn default_dab_size() -> f32 {
    0.12
}

fn default_intensity() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    State {
        config: Box<AppConfig>,
        status: RuntimeStatus,
    },
    Status {
        status: RuntimeStatus,
    },
    Beat {
        source: u32,
        bpm: f32,
    },
    PreviewMeta {
        spokes: u32,
        pixels: u32,
        decimate: u32,
        outer_radius_ft: f32,
        inner_radius_ft: f32,
    },
    Error {
        message: String,
    },
    /// Access refused (revoked, or join token required). The client stops
    /// reconnecting and shows the reason.
    Denied {
        reason: String,
    },
}

/// Everything a freshly-started backend needs to take over from this one with
/// visual continuity (see `POST /handover`).
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct HandoverGrant {
    pub config: AppConfig,
    /// Per-layer animation phases, so patterns continue instead of jumping.
    pub layer_phases: Vec<f64>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ClientInfo {
    pub id: String,
    pub name: String,
    pub connected: bool,
    pub revoked: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct AudioSourceStatus {
    pub id: String,
    pub active: bool,
    pub level: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub bpm: f32,
    pub beat_phase: f32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct RuntimeStatus {
    /// Set when Vulkan init failed — the UI shows this prominently. No fallbacks.
    pub gpu_error: Option<String>,
    pub gpu_name: String,
    pub engine_fps: f32,
    pub frame_time_ms: f32,
    pub sacn_enabled: bool,
    pub sacn_universes: u16,
    /// sACN packets actually sent per second — the "is it transmitting" truth.
    /// (Last full one-second bucket.)
    pub sacn_pps: u32,
    /// Frames rendered in each of the last ~30 one-second buckets (oldest first).
    pub fps_history: Vec<u32>,
    /// sACN packets sent in each of the last ~30 one-second buckets (oldest first).
    pub pps_history: Vec<u32>,
    pub clients: u32,
    pub audio: Vec<AudioSourceStatus>,
    /// Available local capture devices, for the settings UI dropdowns.
    pub input_devices: Vec<String>,
    /// Output devices (selectable as loopback beat sources).
    pub output_devices: Vec<String>,
    /// Local IPv4 interfaces as "name — ip", for the sACN interface picker.
    pub interfaces: Vec<String>,
    /// Known + connected client devices.
    pub client_list: Vec<ClientInfo>,
    pub master_brightness: f32,
    pub master_speed: f32,
}
