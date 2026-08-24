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
            pixels_per_spoke: 378,
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
    /// Universes allocated per spoke — the spacing between consecutive spokes'
    /// start universes. 0 = pack tightly, using only what the pixels need.
    /// The existing rig is patched 6 per spoke while only 3 carry data (378 px at
    /// 170/universe): the 16 PixLite Mk4 boxes have 8 outputs each and only every
    /// other output is wired today, so the controller map already reserves the
    /// second half of each block for the planned doubling. Spoke N therefore
    /// starts at `start_universe + N * 6` — 1, 7, 13 … 379 — and universes
    /// 4-6, 10-12 … are deliberately left dark.
    pub universe_stride: u16,
    /// Unicast destinations, one per controller in spoke order. Used only when
    /// `multicast` is false; controller i drives `strings_per_controller` spokes.
    /// Empty entries leave the corresponding spokes without an output destination.
    pub controllers: Vec<String>,
    pub strings_per_controller: u32,
    /// Destination mode: true sends only to sACN multicast groups (239.255.u.u),
    /// false sends only to the configured controller addresses.
    pub multicast: bool,
    /// E1.31 priority (default 100).
    pub priority: u8,
    /// Gamma applied to LED output only (preview shows the raw pattern).
    pub led_gamma: f32,
    /// E1.31 source identity: a UUID that receivers key ALL per-source state on —
    /// merge arbitration, sequence tracking, and the 2.5 s source-loss timeout.
    /// Generated once on first run and then persistent: the spec requires it to
    /// survive restarts and upgrades, and a changed CID makes every receiver treat
    /// us as a brand-new source while the old identity lingers in its merge table
    /// (visible HTP-merge artifacts, and controllers with a 2–4 source cap can
    /// refuse the new one). A handover between instances is seamless precisely
    /// because the successor reads this same CID out of the config.
    pub cid: String,
    /// E1.31 source name, shown by receivers and diagnostic tools. 64 bytes on the
    /// wire (UTF-8, null-terminated); longer names are truncated.
    pub source_name: String,
    /// Advertise our universe list on the E1.31 discovery universe (64214,
    /// 239.255.250.214) every 10 s while transmitting. This is what makes the
    /// source — and which universes it drives — visible in sACNView and controller
    /// UIs. Costs one small multicast packet per 10 s.
    pub discovery: bool,
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
            universe_stride: 6,
            controllers: Vec::new(),
            strings_per_controller: 4,
            multicast: true,
            priority: 100,
            led_gamma: 2.2,
            cid: String::new(), // filled on first load (see `load`)
            source_name: "Empyrean Gate".into(),
            discovery: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub bind: String,
    pub port: u16,
    /// Max clients streaming the live preview at once — the preview is >98% of
    /// per-client bandwidth, so this is the WiFi safety valve. Clients beyond the
    /// cap keep full control (taps/drawing/effects are tiny) and wait in a queue
    /// for a viewing slot.
    pub max_preview_clients: u32,
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
            max_preview_clients: 10,
            auth_token: None,
            join_token: String::new(),
            require_token: false,
        }
    }
}

/// A client device that has connected at least once. Identified by the persistent
/// id the client keeps in localStorage; named for humans; revocable.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ClientRecord {
    pub id: String,
    pub name: String,
    pub revoked: bool,
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
    /// Features extracted in the browser from the soundtrack of the currently
    /// active video. Packets are accepted only from that video's owning client.
    Video,
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

/// Where the musical clock used by beat-synchronized visuals comes from. Audio
/// energy remains per-layer regardless of this choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RhythmSource {
    /// Preserve the original behavior: each layer follows the beat detector for
    /// the same audio source it uses for level/bands/spectrum.
    #[default]
    LayerAudio,
    /// One MIDI Timing Clock drives every layer; audio remains independently
    /// selectable per layer. Intended for DJ mixers, bridges, and controllers.
    MidiClock,
    /// Passively receive beat/status packets from a Pioneer/AlphaTheta PRO DJ
    /// LINK network. This app never announces a virtual deck or sends commands.
    ProDjLink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RhythmConfig {
    pub source: RhythmSource,
    /// Exact operating-system MIDI input port name. None means no port selected;
    /// it never silently substitutes another device after a disconnect.
    pub midi_port: Option<String>,
    /// 0 follows the reported tempo master. 1..6 pins one player number, useful
    /// with hardware that broadcasts beat packets but not full status to listeners.
    pub pro_dj_link_player: u8,
    /// Unused player number used only as the dbserver query identity. Gate never
    /// sends transport/master commands. XDJ-XZ decks occupy 1 and 2, so 3 is the
    /// safe default; metadata queries are refused if that number is observed.
    pub pro_dj_link_metadata_player: u8,
    /// Shift the lighting clock relative to the external input to compensate for LED/audio
    /// transport latency. Positive values make the visual beat happen later.
    pub latency_ms: f32,
    /// If the external clock stops arriving, keep the show moving from this audio detector.
    pub fallback_to_audio: bool,
    pub fallback_audio_source: u32,
}

impl Default for RhythmConfig {
    fn default() -> Self {
        Self {
            source: RhythmSource::LayerAudio,
            midi_port: None,
            pro_dj_link_player: 0,
            pro_dj_link_metadata_player: 3,
            latency_ms: 0.0,
            fallback_to_audio: true,
            fallback_audio_source: 0,
        }
    }
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
    /// When set, drive the lighting beat clock at this BPM instead of following
    /// the audio detector. Half/normal/double time is applied afterward.
    pub manual_bpm: Option<f32>,
    /// Musical clock presented to lighting effects. Tempo detection remains at the
    /// source rate; this only changes the beat phase/BPM consumed by the show.
    pub beat_time: BeatTime,
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
    /// Global multiplier on every layer's walk amount: how FAR parameters wander.
    /// 1.0 = subtle; 2-3 = clearly visible evolution.
    pub walk_depth: f32,
    /// Local wall-clock time, `"HH:MM"`, at which every layer's accumulated
    /// phase is zeroed once a day. `None` never resets.
    ///
    /// Phase grows for as long as a layer stays in the stack, and crosses to the
    /// GPU as an f32, so the per-frame step eventually quantizes into visible
    /// stepping. Most kinds dodge that via `phase_period` or `split_phase`, but
    /// the noise-driven ones (Fire, NoiseField, NoiseColor) have no period to
    /// wrap to and no integer to split off — for those the only cure is to start
    /// the clock over, which is a visible jump. So it is scheduled for an hour
    /// when nobody can see the array: the Gate is outdoors and washed out by
    /// daylight roughly 09:00–17:00.
    pub phase_reset_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BeatTime {
    Half,
    #[default]
    Normal,
    Double,
}

impl BeatTime {
    pub fn multiplier(self) -> f32 {
        match self {
            Self::Half => 0.5,
            Self::Normal => 1.0,
            Self::Double => 2.0,
        }
    }
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            fps: 60.0,
            master_brightness: 1.0,
            master_speed: 1.0,
            manual_bpm: None,
            beat_time: BeatTime::Normal,
            walk_enabled: true,
            walk_layers: false,
            walk_min_layers: 2,
            walk_speed: 1.0,
            walk_depth: 1.0,
            phase_reset_at: Some("12:00".into()),
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

/// Where a playlist entry's media lives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaylistKind {
    /// A web URL — downloaded into the local media cache so playback never
    /// depends on venue internet.
    Url,
    /// A file on the Gate machine (added directly or found in a watched folder).
    LocalFile,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaylistEntry {
    /// Stable id; also names the cache file and the /media/file/{id} route.
    pub id: String,
    pub title: String,
    /// URL or absolute local path.
    pub source: String,
    pub kind: PlaylistKind,
    /// Set when this entry was auto-discovered in a watched folder (its value is
    /// that folder), so folder rescans can reconcile without touching manual adds.
    #[serde(default)]
    pub from_dir: String,
}

/// Video playlist: URLs added by any client plus files discovered in watched
/// folders on the Gate machine. URL entries are cached to disk in the background.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct VideoConfig {
    pub playlist: Vec<PlaylistEntry>,
    /// Folders on the Gate machine scanned (recursively) for video files.
    pub dirs: Vec<String>,
    /// Advance to the next playlist entry when one finishes playing.
    pub auto_advance: bool,
}

/// Self-update behavior (see `updater.rs`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UpdateConfig {
    /// Poll GitHub Releases for newer versions (startup + every 6 h).
    pub auto_check: bool,
    /// Install updates as soon as they are found. The swap is a seamless takeover,
    /// but taking an update mid-show is the operator's call — off by default.
    pub auto_install: bool,
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            auto_check: true,
            auto_install: false,
        }
    }
}

/// Desktop window bookkeeping, so a restart (or self-update handover) restores the
/// same set of windows. Geometry itself is persisted per-label by
/// tauri-plugin-window-state; this only remembers WHICH aux windows were open.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowsConfig {
    /// Tabs with a popped-out window open (e.g. "control", "live").
    pub aux_open: Vec<String>,
}

/// A named, reusable capture of the layer stack and the motion settings that
/// shape it. Saved with the main config so every control device sees the same
/// library and it survives backend restarts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SavedStack {
    pub id: String,
    pub name: String,
    pub layers: Vec<LayerCfg>,
    pub master_speed: f32,
    pub walk_enabled: bool,
    pub walk_layers: bool,
    pub walk_min_layers: u32,
    pub walk_speed: f32,
    pub walk_depth: f32,
}

/// One timed composition in a saved unattended show. The stack is embedded rather
/// than referenced by id so a playlist remains intact if its source scene is later
/// edited or deleted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ShowPlaylistEntry {
    pub id: String,
    pub name: String,
    pub stack: SavedStack,
    /// Time from this scene's arrival until the scheduler advances.
    pub duration_secs: f32,
    /// Crossfade time when entering this scene.
    pub transition_secs: f32,
}

impl Default for ShowPlaylistEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "Untitled scene".into(),
            stack: SavedStack::default(),
            duration_secs: 1_800.0,
            transition_secs: 20.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SavedPlaylist {
    pub id: String,
    pub name: String,
    pub entries: Vec<ShowPlaylistEntry>,
    /// Continue from the first entry after the last one finishes.
    pub repeat: bool,
}

impl Default for SavedPlaylist {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "Untitled show".into(),
            entries: Vec::new(),
            repeat: true,
        }
    }
}

/// Runtime selection for the backend-owned unattended show. The active index is
/// persisted at each change, so a headless restart resumes the same playlist.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ShowSchedulerConfig {
    pub enabled: bool,
    pub active_playlist_id: String,
    pub current_index: u32,
}

impl Default for SavedStack {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "Untitled stack".into(),
            layers: Vec::new(),
            master_speed: 1.0,
            walk_enabled: false,
            walk_layers: false,
            walk_min_layers: 1,
            walk_speed: 1.0,
            walk_depth: 1.0,
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
    pub rhythm: RhythmConfig,
    pub render: RenderConfig,
    pub update: UpdateConfig,
    pub windows: WindowsConfig,
    pub video: VideoConfig,
    pub beat_taps: BeatTapConfig,
    /// Register the app to launch at login (per-user Run key; survives
    /// self-updates because the running exe re-registers itself at startup).
    pub autostart: bool,
    pub layers: Vec<LayerCfg>,
    /// Named layer-stack captures shared by all clients.
    pub saved_stacks: Vec<SavedStack>,
    /// Reusable timed shows and the currently running selection.
    pub saved_playlists: Vec<SavedPlaylist>,
    pub show_scheduler: ShowSchedulerConfig,
    /// Known client devices (see `ClientRecord`).
    pub clients: Vec<ClientRecord>,
    /// Id of the node-graph patch the engine renders instead of the layer
    /// stack; `None` renders the stack (a dev-time bridge until the stack is
    /// retired — see `plans/node-graph.md`).
    pub active_patch: Option<String>,
}

impl AppConfig {
    /// The playlist the show scheduler is actually running, if any. "Enabled" on
    /// its own is not enough — the selection can point at a deleted or empty
    /// playlist, in which case nothing is being driven. Shared by the engine's
    /// cue clock and by the test-mode gate so both agree on what "a show is
    /// running" means.
    pub fn running_show(&self) -> Option<&SavedPlaylist> {
        if !self.show_scheduler.enabled {
            return None;
        }
        self.saved_playlists
            .iter()
            .find(|p| p.id == self.show_scheduler.active_playlist_id && !p.entries.is_empty())
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            geometry: GeometryConfig::default(),
            output: OutputConfig::default(),
            server: ServerConfig::default(),
            audio: AudioConfig::default(),
            rhythm: RhythmConfig::default(),
            render: RenderConfig::default(),
            update: UpdateConfig::default(),
            windows: WindowsConfig::default(),
            video: VideoConfig::default(),
            beat_taps: BeatTapConfig::default(),
            autostart: false,
            layers: default_layer_stack(),
            saved_stacks: Vec::new(),
            saved_playlists: Vec::new(),
            show_scheduler: ShowSchedulerConfig::default(),
            clients: Vec::new(),
            active_patch: None,
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
    let bak = path.with_extension("json.bak");
    // A broken main config falls back to the .bak kept by `save` — losing the
    // config wouldn't just reset the show, it would regenerate the sACN CID.
    let mut recovered = false;
    let mut cfg = match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(cfg) => {
                log::info!("loaded config from {}", path.display());
                cfg
            }
            Err(e) => {
                log::error!("config at {} is invalid ({e}); trying backup", path.display());
                recovered = true;
                load_backup(&bak)
            }
        },
        Err(_) if bak.exists() => {
            // Main missing but a backup exists: a save was interrupted between
            // renames, or the file was deleted. Either way the backup is newer
            // than "defaults".
            log::warn!("no config at {}; trying backup", path.display());
            recovered = true;
            load_backup(&bak)
        }
        Err(_) => {
            log::info!("no config at {}; using defaults", path.display());
            AppConfig::default()
        }
    };
    // First-run identities. Both must be written back immediately: the sACN CID in
    // particular is only useful if it is the SAME one next launch.
    let mut dirty = recovered; // rewrite a good main config after any fallback
    if cfg.server.join_token.is_empty() {
        cfg.server.join_token = generate_token();
        dirty = true;
    }
    if cfg.output.cid.is_empty() {
        cfg.output.cid = uuid::Uuid::new_v4().to_string();
        log::info!("generated sACN source CID {}", cfg.output.cid);
        dirty = true;
    }
    if dirty {
        save(&cfg);
    }
    // Isolated integration tests and parallel local instances can choose a port
    // without rewriting the persisted operator configuration.
    if let Some(port) = std::env::var("EMPYREAN_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        cfg.server.port = port;
    }
    cfg
}

fn load_backup(bak: &std::path::Path) -> AppConfig {
    let parsed = std::fs::read_to_string(bak)
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()));
    match parsed {
        Ok(cfg) => {
            log::warn!("recovered config from backup {}", bak.display());
            cfg
        }
        Err(e) => {
            log::error!("backup {} unusable ({e}); using defaults", bak.display());
            AppConfig::default()
        }
    }
}

pub fn save(cfg: &AppConfig) {
    crate::autostart::sync(cfg.autostart);
    let path = config_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let text = match serde_json::to_string_pretty(cfg) {
        Ok(text) => text,
        Err(e) => {
            log::error!("failed to serialize config: {e}");
            return;
        }
    };
    // Crash-safe write: a plain overwrite truncates first, so a power cut
    // mid-save destroys the config (and with it the persistent sACN CID).
    // Instead: write + fsync a temp file, keep the previous config as .bak,
    // then rename into place — at every instant either the old file, the
    // backup, or the new file is intact, and `load` knows to try the .bak.
    let tmp = path.with_extension("json.tmp");
    let bak = path.with_extension("json.bak");
    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        drop(f);
        if path.exists() {
            let _ = std::fs::remove_file(&bak); // Windows: rename won't overwrite
            std::fs::rename(&path, &bak)?;
        }
        std::fs::rename(&tmp, &path)
    })();
    if let Err(e) = result {
        log::error!("failed to save config to {}: {e}", path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Compare fixtures without caring how git checked them out. `str::lines`
    /// splits on `\n` and drops a trailing `\r`, so this needs no escape
    /// sequences — which matters, because an earlier version of this helper was
    /// written through a shell heredoc that mangled `\r\n` into a real newline,
    /// quietly turning it into a no-op and only failing on Windows CI.
    /// `.gitattributes` pins these fixtures to LF as well; this is the backstop.
    fn normalize_lines(text: &str) -> String {
        text.lines()
            .map(str::trim_end)
            .collect::<Vec<_>>()
            .join("\n")
            .trim_end()
            .to_string()
    }

    #[test]
    fn fixture_comparison_ignores_line_endings() {
        assert_eq!(normalize_lines("a\r\nb\r\n"), normalize_lines("a\nb"));
        assert_ne!(normalize_lines("a\nb"), normalize_lines("a\nc"));
    }

    /// The web UI's layout tests drive a mock backend that replays a committed
    /// snapshot of the default config (no GPU, no audio device, deterministic).
    /// A fixture that silently drifts from the real defaults would test a UI
    /// nobody runs, so it is regenerated from here rather than hand-maintained:
    /// `EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture`.
    #[test]
    fn default_config_fixture_is_current() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("default-config.json");
        // Compared as TEXT, not as parsed JSON: serde_json's default float parser
        // is allowed to land a ULP away from the value that was written, so a
        // freshly-written fixture would fail a Value == Value comparison on
        // hue 0.12. Text also catches formatting and key-order drift, which is
        // fine for a file nobody edits by hand.
        let current =
            serde_json::to_string_pretty(&AppConfig::default()).expect("serialize default config");
        if std::env::var("EMPYREAN_UPDATE_FIXTURES").is_ok() {
            std::fs::create_dir_all(path.parent().expect("fixture dir")).expect("create fixture dir");
            std::fs::write(&path, format!("{current}\n")).expect("write fixture");
            return;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            panic!(
                "missing {} ({e}); regenerate with EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture",
                path.display()
            )
        });
        assert_eq!(
            normalize_lines(&text),
            normalize_lines(&current),
            "tests/fixtures/default-config.json is stale; regenerate with \
             EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture"
        );
    }

    /// Same contract for the runtime status the mock backend replays. The UI
    /// reads status fields without optional chaining in places, so a fixture
    /// missing a field the backend now sends white-screens a tab — which is how
    /// this fixture came to exist.
    #[test]
    fn default_status_fixture_is_current() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("default-status.json");
        let current = serde_json::to_string_pretty(&crate::protocol::RuntimeStatus::default())
            .expect("serialize default status");
        if std::env::var("EMPYREAN_UPDATE_FIXTURES").is_ok() {
            std::fs::create_dir_all(path.parent().expect("fixture dir")).expect("create fixture dir");
            std::fs::write(&path, format!("{current}\n")).expect("write fixture");
            return;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            panic!(
                "missing {} ({e}); regenerate with EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture",
                path.display()
            )
        });
        assert_eq!(
            normalize_lines(&text),
            normalize_lines(&current),
            "tests/fixtures/default-status.json is stale; regenerate with \
             EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture"
        );
    }

    #[test]
    fn config_without_rhythm_section_keeps_legacy_behavior() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value.as_object_mut().unwrap().remove("rhythm");
        let config: AppConfig = serde_json::from_value(value).unwrap();
        assert_eq!(config.rhythm.source, RhythmSource::LayerAudio);
        assert!(config.rhythm.fallback_to_audio);
    }

    #[test]
    fn legacy_config_gets_an_idle_empty_show_scheduler() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        let object = value.as_object_mut().unwrap();
        object.remove("saved_playlists");
        object.remove("show_scheduler");
        let config: AppConfig = serde_json::from_value(value).unwrap();
        assert!(config.saved_playlists.is_empty());
        assert!(!config.show_scheduler.enabled);
        assert!(config.show_scheduler.active_playlist_id.is_empty());
    }

    #[test]
    fn playlist_embeds_a_restart_safe_scene_snapshot() {
        let stack = SavedStack {
            id: "scene-a".into(),
            name: "Scene A".into(),
            layers: default_layer_stack(),
            walk_enabled: true,
            ..Default::default()
        };
        let mut config = AppConfig::default();
        config.saved_playlists.push(SavedPlaylist {
            id: "night".into(),
            name: "All night".into(),
            entries: vec![ShowPlaylistEntry {
                id: "cue-a".into(),
                name: "Scene A".into(),
                stack,
                duration_secs: 2_100.0,
                transition_secs: 20.0,
            }],
            repeat: true,
        });
        config.show_scheduler = ShowSchedulerConfig {
            enabled: true,
            active_playlist_id: "night".into(),
            current_index: 0,
        };

        let restored: AppConfig =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert!(restored.show_scheduler.enabled);
        assert_eq!(restored.saved_playlists[0].entries[0].stack.layers.len(), 4);
        assert_eq!(
            restored.saved_playlists[0].entries[0].duration_secs,
            2_100.0
        );
    }
}
