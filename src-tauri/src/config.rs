//! Application configuration: geometry of the installation, sACN output, audio
//! sources, server, and the layer stack. Persisted as JSON in the user config dir.

use crate::layers::{BlendMode, LayerCfg, LayerKind};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GeometryConfig {
    /// Number of radial spokes (strings).
    pub spokes: u32,
    /// Pixels per spoke. Pixel 0 is at the OUTER radius (strings are fed from outside).
    pub pixels_per_spoke: u32,
    /// Outer (major) radius in feet — 50 ft diameter installation.
    pub outer_radius_ft: f32,
    /// Inner (minor) radius in feet, where the last pixel of each spoke sits.
    pub inner_radius_ft: f32,
    /// Informational; used to sanity-check spoke length against pixel count in the UI.
    pub leds_per_meter: f32,
}

impl Default for GeometryConfig {
    fn default() -> Self {
        Self {
            spokes: 64,
            pixels_per_spoke: 350,
            outer_radius_ft: 25.0,
            inner_radius_ft: 8.0,
            leds_per_meter: 60.0,
        }
    }
}

impl GeometryConfig {
    pub fn pixel_count(&self) -> usize {
        (self.spokes * self.pixels_per_spoke) as usize
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OutputConfig {
    /// Master switch — defaults OFF so a fresh install never floods a network.
    pub enabled: bool,
    /// Local interface IP to send from (source for unicast, egress for multicast).
    /// Empty = OS default route — on a multi-homed machine that is often the wrong
    /// NIC for the lighting network, so pick one in Settings.
    pub interface: String,
    /// Send an sACN frame for every rendered frame (capped by `fps`).
    pub sync_to_render: bool,
    /// sACN frame-rate cap (also the fixed rate when `sync_to_render` is off).
    pub fps: f32,
    /// E1.31 universe synchronization: data packets carry this sync address and a
    /// sync packet per frame releases all universes at once (tear-free on receivers
    /// that support it, e.g. PixLite Mk4; others ignore it). 0 = disabled.
    pub sync_universe: u16,
    /// First universe number; each spoke starts on a fresh universe boundary.
    pub start_universe: u16,
    /// Pixels per universe (170 * 3 = 510 channels fits the 512-channel DMX frame).
    pub pixels_per_universe: u16,
    /// Unicast destinations, one per controller in spoke order. Controller i drives
    /// `strings_per_controller` consecutive spokes. Empty entries fall back to multicast.
    pub controllers: Vec<String>,
    pub strings_per_controller: u32,
    /// Also/instead send to sACN multicast groups (239.255.u.u).
    pub multicast: bool,
    /// E1.31 priority (default 100).
    pub priority: u8,
    /// Gamma applied to LED output only (preview shows the raw pattern).
    pub led_gamma: f32,
}

impl Default for OutputConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interface: String::new(),
            sync_to_render: true,
            fps: 60.0,
            sync_universe: 0,
            start_universe: 1,
            pixels_per_universe: 170,
            controllers: Vec::new(),
            strings_per_controller: 4,
            multicast: true,
            priority: 100,
            led_gamma: 2.2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub bind: String,
    pub port: u16,
    /// Legacy placeholder, superseded by `join_token` + `require_token`.
    pub auth_token: Option<String>,
    /// Join token embedded in the connect QR URL. Generated on first run; the
    /// "rotate" action replaces it (locking out devices that only had the old one,
    /// when `require_token` is on).
    pub join_token: String,
    /// When true, unknown clients must present the join token (scan the QR) to
    /// connect. Loopback clients (the desktop app's own webview) always may.
    /// Off = open LAN access; revocation is then only a client-id blocklist.
    pub require_token: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: "0.0.0.0".into(),
            port: 9520,
            auth_token: None,
            join_token: String::new(),
            require_token: false,
        }
    }
}

/// A client device that has connected at least once. Identified by the persistent
/// id the client keeps in localStorage; named for humans; revocable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ClientRecord {
    pub id: String,
    pub name: String,
    pub revoked: bool,
}

impl Default for ClientRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            revoked: false,
        }
    }
}

/// Random URL-safe token (join links). Seeded from `RandomState`, which is
/// randomly keyed per process — fine for LAN join control, not cryptography.
pub fn generate_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for i in 0..2 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(std::process::id() as u64 ^ (i as u64) << 32);
        out.push_str(&format!("{:08x}", h.finish() as u32));
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AudioSourceKind {
    /// A local capture device (cpal). `device: None` = system default input.
    /// `channels`: which channels of the device to mix into this source's mono
    /// analysis signal; empty = all channels. Lets one multichannel interface feed
    /// several sources (e.g. stage feed on 1+2, local mic on 3).
    /// `loopback: true` captures an OUTPUT device's playback (WASAPI loopback) —
    /// use whatever is playing on this machine as the beat source.
    Device {
        device: Option<String>,
        channels: Vec<u32>,
        #[serde(default)]
        loopback: bool,
    },
    /// Features streamed from a remote browser client (its microphone) over WebSocket.
    /// `client_id` is matched against the id the remote client announces.
    Remote { client_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioSourceConfig {
    /// Stable id, referenced by layers (`audio_source` index is positional though —
    /// the id is for display and remote matching).
    pub id: String,
    #[serde(flatten)]
    pub kind: AudioSourceKind,
    pub gain: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AudioConfig {
    /// Up to `layers::MAX_AUDIO_SOURCES` analyzed in parallel; layers pick one by index.
    pub sources: Vec<AudioSourceConfig>,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            sources: vec![AudioSourceConfig {
                id: "main".into(),
                kind: AudioSourceKind::Device {
                    device: None,
                    channels: Vec::new(),
                    loopback: false,
                },
                gain: 1.0,
            }],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RenderConfig {
    pub fps: f32,
    pub master_brightness: f32,
    pub master_speed: f32,
    /// Autopilot: slow mean-reverting random walk over layer parameters, so an
    /// unattended show keeps evolving for hours. Each layer's `walk_amount` scales
    /// how far its parameters may wander from where the sliders are set.
    pub walk_enabled: bool,
    /// Also walk WHICH layers play (Gray-code style: one layer fades in or out per
    /// step), on top of the parameter walk.
    pub walk_layers: bool,
    /// Never fewer than this many of the enabled layers playing at once.
    pub walk_min_layers: u32,
    /// Walk rate multiplier (1.0 ≈ minutes-scale evolution).
    pub walk_speed: f32,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            fps: 60.0,
            master_brightness: 1.0,
            master_speed: 1.0,
            walk_enabled: true,
            walk_layers: false,
            walk_min_layers: 2,
            walk_speed: 1.0,
        }
    }
}

/// Automated "taps": fire a burst on every beat at a point that orbits the ring —
/// the automated version of tapping the preview in a circle on the beat, which
/// makes fun spiral effects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BeatTapConfig {
    pub enabled: bool,
    /// Which audio source's beat drives the taps.
    pub audio_source: u32,
    /// Orbit speed in turns per beat; negative reverses. 0.0833 = one lap / 12 beats.
    pub spin: f32,
    /// Slowly drift the spin speed (autopilot-style), so the spiral keeps changing.
    pub vary: bool,
    /// Tap position radius, 0 (center) .. 1 (outer edge).
    pub radius: f32,
    pub intensity: f32,
    /// Hue in turns; negative = white.
    pub hue: f32,
    /// Fire on every Nth beat (1 = every beat).
    pub every: u32,
}

impl Default for BeatTapConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            audio_source: 0,
            spin: 0.0833,
            vary: true,
            radius: 0.8,
            intensity: 0.7,
            hue: -1.0,
            every: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub geometry: GeometryConfig,
    pub output: OutputConfig,
    pub server: ServerConfig,
    pub audio: AudioConfig,
    pub render: RenderConfig,
    pub beat_taps: BeatTapConfig,
    pub layers: Vec<LayerCfg>,
    /// Known client devices (see `ClientRecord`).
    pub clients: Vec<ClientRecord>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            geometry: GeometryConfig::default(),
            output: OutputConfig::default(),
            server: ServerConfig::default(),
            audio: AudioConfig::default(),
            render: RenderConfig::default(),
            beat_taps: BeatTapConfig::default(),
            layers: default_layer_stack(),
            clients: Vec::new(),
        }
    }
}

/// A stack that looks good out of the box: deep noise base, harmonic rings riding
/// the bass, sparkles on the treble, and beat rings.
fn default_layer_stack() -> Vec<LayerCfg> {
    vec![
        LayerCfg {
            kind: LayerKind::NoiseColor,
            name: "Nebula base".into(),
            blend: BlendMode::AlphaOver,
            opacity: 1.0,
            speed: 0.25,
            scale: 1.2,
            audio_amount: 0.3,
            hue: 0.65,
            hue_range: 0.25,
            brightness: 0.5,
            ..Default::default()
        },
        LayerCfg {
            kind: LayerKind::RadialWaves,
            name: "Harmonic rings".into(),
            blend: BlendMode::Add,
            opacity: 0.6,
            speed: 1.0,
            scale: 1.0,
            audio_amount: 0.8,
            hue: 0.55,
            hue_range: 0.1,
            param_a: 3.0,
            param_b: 4.0,
            ..Default::default()
        },
        LayerCfg {
            kind: LayerKind::Sparkle,
            name: "Treble glitter".into(),
            blend: BlendMode::Add,
            opacity: 0.7,
            speed: 1.0,
            audio_amount: 0.9,
            hue: 0.12,
            hue_range: 0.05,
            saturation: 0.3,
            param_a: 0.15,
            ..Default::default()
        },
        LayerCfg {
            kind: LayerKind::BeatRings,
            name: "Beat rings".into(),
            blend: BlendMode::Add,
            opacity: 0.8,
            audio_amount: 1.0,
            hue: 0.85,
            hue_range: 0.0,
            param_a: 0.08,
            ..Default::default()
        },
    ]
}

pub fn config_path() -> PathBuf {
    // Override for tests / portable installs / running several isolated instances.
    if let Ok(p) = std::env::var("EMPYREAN_CONFIG") {
        return PathBuf::from(p);
    }
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("EmpyreanGate")
        .join("config.json")
}

pub fn load() -> AppConfig {
    let path = config_path();
    let mut cfg = match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(cfg) => {
                log::info!("loaded config from {}", path.display());
                cfg
            }
            Err(e) => {
                log::error!("config at {} is invalid ({e}); using defaults", path.display());
                AppConfig::default()
            }
        },
        Err(_) => {
            log::info!("no config at {}; using defaults", path.display());
            AppConfig::default()
        }
    };
    if cfg.server.join_token.is_empty() {
        cfg.server.join_token = generate_token();
        save(&cfg);
    }
    cfg
}

pub fn save(cfg: &AppConfig) {
    let path = config_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    match serde_json::to_string_pretty(cfg) {
        Ok(text) => {
            if let Err(e) = std::fs::write(&path, text) {
                log::error!("failed to save config to {}: {e}", path.display());
            }
        }
        Err(e) => log::error!("failed to serialize config: {e}"),
    }
}
