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
    /// sACN frame rate (independent of render fps; frames are resampled by dropping).
    pub fps: f32,
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
            fps: 60.0,
            start_universe: 1,
            pixels_per_universe: 170,
            controllers: Vec::new(),
            strings_per_controller: 4,
            multicast: false,
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
    /// When set, clients must present this token in their Hello. None = open access
    /// (current stage: trusted LAN; the field exists so auth can be added without a
    /// protocol/config migration).
    pub auth_token: Option<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: "0.0.0.0".into(),
            port: 9520,
            auth_token: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AudioSourceKind {
    /// A local capture device (cpal). `device: None` = system default input.
    /// `channels`: which channels of the device to mix into this source's mono
    /// analysis signal; empty = all channels. Lets one multichannel interface feed
    /// several sources (e.g. stage feed on 1+2, local mic on 3).
    Device {
        device: Option<String>,
        channels: Vec<u32>,
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
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            fps: 60.0,
            master_brightness: 1.0,
            master_speed: 1.0,
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
    pub layers: Vec<LayerCfg>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            geometry: GeometryConfig::default(),
            output: OutputConfig::default(),
            server: ServerConfig::default(),
            audio: AudioConfig::default(),
            render: RenderConfig::default(),
            layers: default_layer_stack(),
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
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("EmpyreanGate")
        .join("config.json")
}

pub fn load() -> AppConfig {
    let path = config_path();
    match std::fs::read_to_string(&path) {
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
    }
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
