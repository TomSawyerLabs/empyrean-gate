//! The WebSocket wire protocol shared by every UI client (the Tauri webview, browsers
//! on the LAN, phones). Text frames carry JSON messages; preview frames are binary
//! (see `PREVIEW_MAGIC` layout below).

use crate::config::AppConfig;
use crate::layers::{DabPoint, EffectCfg, LayerCfg, PenKind};
use crate::patch::store::PatchSummary;
use crate::patch::PatchDoc;
use serde::{Deserialize, Serialize};

/// Binary preview frame layout (little endian):
/// `u32 magic, u32 frame_number, u16 spokes, u16 pixels_per_spoke_after_decimation,`
/// then `spokes * pixels` RGB triplets (pixel 0 = outer end of spoke).
pub const PREVIEW_MAGIC: u32 = 0x4547_5056; // "VPGE"
/// Same binary layout as `PREVIEW_MAGIC`, carrying the independently rendered
/// off-air Ready bus. Sent only to clients that explicitly request both buses.
pub const READY_PREVIEW_MAGIC: u32 = 0x4547_5256; // "VRGE"

/// Binary mini-preview batch (per-layer / per-patch-node solo renders), little
/// endian: `u32 magic, u32 batch, u16 spokes, u16 pixels, u8 kind (0 = layers,
/// 1 = patch nodes), u8 pad, u16 cell_count, u16 scalar_count, u16 pad`, then
/// `cell_count` × (`u16 id, u16 pad`, `spokes * pixels` RGB triplets), then
/// `scalar_count` × (`u16 id, u16 pad, f32 value`). Ids are config layer
/// indices (layers) or indices into the `mini_preview_meta` lists (patch).
pub const MINI_PREVIEW_MAGIC: u32 = 0x4547_4D56; // "VMGE"

/// Binary video input frame (client -> backend), little endian:
/// `u32 magic, u32 sequence, u16 width, u16 height`, then RGBA8 pixels.
pub const VIDEO_FRAME_MAGIC: u32 = 0x4547_5646; // "FVGE"
pub const MAX_VIDEO_DIMENSION: u16 = 256;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserAudioStream {
    #[default]
    Microphone,
    Video,
}

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
    /// Patch the master hue pull; every field is optional so the UI can flip
    /// one switch without re-sending the rest.
    SetMasterHue {
        #[serde(default)]
        enabled: Option<bool>,
        #[serde(default)]
        hue: Option<f32>,
        #[serde(default)]
        amount: Option<f32>,
        #[serde(default)]
        loose: Option<bool>,
    },
    /// Atomically hand rendering back to the classic layer stack and load it.
    /// Unlike a full config write, this cannot be hidden by an active patch.
    ActivateStack {
        stack: crate::config::SavedStack,
    },
    /// Load the off-air render bus without changing the Gate output.
    PrepareStack {
        stack: crate::config::SavedStack,
    },
    /// Crossfade the prepared bus to air and move the old program look to Ready.
    TakeReady {
        /// Optimistic guard: a stale/double Take cannot immediately swap back.
        ready_id: String,
    },
    PerformanceRecordStart {
        name: String,
    },
    PerformanceRecordStop {
        /// Final name chosen at stop time. Empty keeps the start-time default.
        #[serde(default)]
        name: String,
    },
    /// Play one saved metadata performance as a first-class scene. The backend
    /// owns its clock; no all-night playlist needs to be created by the UI.
    PerformancePlay {
        id: String,
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
        #[serde(default = "default_saturation")]
        saturation: f32,
        #[serde(default = "default_brightness")]
        brightness: f32,
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
        /// Also stream READY_PREVIEW_MAGIC frames for the off-air render bus.
        #[serde(default)]
        include_ready: bool,
    },
    UnsubscribePreview,
    /// Stream MINI_PREVIEW_MAGIC batches: a tiny solo render of every playing
    /// layer (or every field node of the active patch) plus patch scalar
    /// values, so each contribution to the composite is visible on its own.
    SubscribeMiniPreviews {
        /// Max batches per second this client wants.
        #[serde(default = "default_mini_fps")]
        fps: f32,
    },
    UnsubscribeMiniPreviews,
    /// Receipt for one program preview frame. The server keeps only a few
    /// unacked frames in flight per remote client, so a congested link loses
    /// frame rate instead of accumulating seconds of buffered latency.
    PreviewAck {
        /// Echo of the frame_number field from the binary preview header.
        #[serde(default)]
        frame: u32,
    },
    /// Claim the single live video input. Binary VIDEO_FRAME_MAGIC messages from
    /// this connection are accepted until it stops or disconnects.
    StartVideo {
        #[serde(default)]
        title: String,
        #[serde(default)]
        source_url: String,
    },
    StopVideo {
        /// Normal cleanup may stop only the caller's own source. An explicit UI
        /// action can force-stop another connected device's source.
        #[serde(default)]
        force: bool,
    },
    /// Audio features computed client-side from a remote browser microphone or
    /// from the soundtrack of the browser-decoded video.
    /// Sent at the client's analysis hop rate (~40 Hz).
    AudioFrame {
        /// Absent means microphone for backwards compatibility with older UIs.
        #[serde(default)]
        stream: BrowserAudioStream,
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
    /// Operator: replace the admin token. Devices already recorded as admin
    /// keep the role; the old admin QR stops granting it.
    RotateAdminToken,
    /// Operator: grant or withdraw show control for a known client.
    SetClientAdmin {
        id: String,
        admin: bool,
    },
    SetRequireToken {
        require: bool,
    },
    /// Node-graph patches (see `patch` module / plans/node-graph.md). Reads
    /// are open to every client; mutations (`PatchSave`, `PatchDelete`,
    /// `PatchActivate`) are accepted from loopback connections only — the
    /// graph is edited on the Gate machine itself.
    PatchList,
    PatchGet {
        id: String,
    },
    /// Save (create or overwrite) a patch. An empty `id` is assigned one; the
    /// saved doc is echoed back as `ServerMsg::Patch`.
    PatchSave {
        patch: Box<PatchDoc>,
    },
    PatchDelete {
        id: String,
    },
    /// Set (`Some`) or clear (`None`) the patch the engine renders. Activation
    /// validates the graph and requires its Output node; invalid patches are
    /// refused with `ServerMsg::Error` and the config is left unchanged.
    PatchActivate {
        id: Option<String>,
    },
    /// Play an EXPOSED param of the ACTIVE patch. Unlike the editing messages
    /// this is open to every client — it's the phone-facing play surface —
    /// and it never rebuilds the pipeline. Persisted to the patch file.
    PatchParam {
        node: String,
        param: String,
        value: f32,
    },
    /// Start (`Some(kind)`) or stop (`None`) game mode. Loopback connections
    /// only, like patch editing — starting a game replaces the whole look of
    /// the array, which is the operator's call. Also refused while the show
    /// scheduler runs a playlist — see `SharedState::set_game_mode`.
    SetGameMode {
        game: Option<crate::game::GameKind>,
    },
    /// Live game parameters (species count, effects overlay). Loopback only.
    SetGameConfig {
        #[serde(default)]
        species: Option<u8>,
        #[serde(default)]
        effects_overlay: Option<bool>,
    },
    /// Player input into the running game: a batch of polar points (same space
    /// as `Paint`) injecting the chosen species. Open to every client —
    /// playing is the phone-facing surface, and inputs from all clients merge.
    GameInput {
        species: u8,
        points: Vec<DabPoint>,
    },
    /// A named game action from an on-screen button or keyboard. Open to every
    /// connected player; games that do not use commands simply ignore it.
    GameCommand {
        command: crate::game::GameCommand,
    },
    /// Arm/disarm hardware test mode. Open to every client (the commissioning
    /// workflow is a phone in your hand at the array), but refused while the
    /// show scheduler is running a playlist — see `SharedState::set_test_mode`.
    SetTestMode {
        active: bool,
    },
    /// Change the live test parameters. Accepted whether or not test mode is
    /// armed, so the controls can be set up before anything reaches the rig.
    SetTestConfig {
        test: crate::testmode::TestConfig,
    },
    /// Scan the lighting network for pixel controllers. Read-only — it sends
    /// vendor discovery probes and listens; nothing about the rig changes — so
    /// it needs no arming and is safe during a show.
    DiscoverControllers,
    /// Create the Windows Firewall port rule (one UAC prompt on the Gate machine).
    AuthorizeFirewall,
    /// "I don't like what it just did." Freezes the last `seconds` of the
    /// rolling capture (operator input, effective layer params, audio features,
    /// rendered frames) into a bundle on the Gate machine, together with the
    /// typed description — see `report.rs`.
    Report {
        description: String,
        #[serde(default = "default_report_seconds")]
        seconds: f32,
    },
    /// Ask the updater to poll GitHub Releases now.
    CheckUpdate,
    /// Download + hot-swap to the staged update (two-phase takeover).
    InstallUpdate,
    /// Windows only: create/remove this user's Startup-folder shortcut.
    SetLaunchAtStartup {
        enabled: bool,
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

fn default_mini_fps() -> f32 {
    10.0
}

/// One scalar meter of the active patch: a CPU node's output port.
#[derive(Debug, Clone, Serialize)]
pub struct MiniScalarRef {
    pub node: String,
    pub port: String,
}

fn default_report_seconds() -> f32 {
    10.0
}

fn default_intensity() -> f32 {
    1.0
}

fn default_saturation() -> f32 {
    0.85
}

fn default_brightness() -> f32 {
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
    ProDjLinkDebug {
        entry: ProDjLinkDebugEntry,
    },
    PreviewMeta {
        spokes: u32,
        pixels: u32,
        decimate: u32,
        outer_radius_ft: f32,
        inner_radius_ft: f32,
    },
    /// Geometry + id tables for MINI_PREVIEW_MAGIC batches. Re-sent whenever
    /// the mini geometry or the active patch's node/scalar lists change.
    MiniPreviewMeta {
        spokes: u32,
        pixels: u32,
        /// Patch node ids in cell-slot order; empty when no patch is active.
        patch_nodes: Vec<String>,
        /// (node id, output port) pairs in scalar-slot order.
        patch_scalars: Vec<MiniScalarRef>,
    },
    Error {
        message: String,
    },
    /// Access refused (revoked, or join token required). The client stops
    /// reconnecting and shows the reason.
    Denied {
        reason: String,
    },
    /// This connection's access level, sent right after the hello state and
    /// again whenever the operator changes it. Guests trim their UI to the
    /// play surfaces; the server enforces the split regardless.
    Role {
        admin: bool,
    },
    /// A feedback bundle was written. Sent to every client so the reports list
    /// is live on whichever device the operator picks up next.
    ReportSaved {
        report: crate::report::ReportInfo,
    },
    /// The live-preview slots are full; this client is queued at `position`
    /// (1 = next). Control input still works while waiting. Sent with position 0
    /// when a slot is granted after queueing.
    PreviewQueue {
        position: u32,
    },
    /// The patch store's contents; broadcast to everyone after any mutation.
    Patches {
        patches: Vec<PatchSummary>,
    },
    /// One full patch document (reply to `PatchGet` / echo after `PatchSave`).
    Patch {
        patch: Box<PatchDoc>,
    },
    /// An exposed param of the active patch changed (broadcast, so every play
    /// surface and the editor stay in sync without re-shipping the graph).
    PatchParamChanged {
        node: String,
        param: String,
        value: f32,
    },
    /// A controller scan finished. Broadcast, so a scan started from a phone at
    /// the array also lands on the laptop.
    Discovery {
        result: Box<crate::discovery::DiscoveryResult>,
    },
}

/// Everything a freshly-started backend needs to take over from this one with
/// visual continuity (see `POST /handover`).
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct HandoverGrant {
    pub config: AppConfig,
    /// Per-layer animation phases, so patterns continue instead of jumping.
    pub layer_phases: Vec<f64>,
    /// The sACN sequence number this instance last put on the wire. Because the
    /// CID is persistent, the receiver carries its per-source sequence state
    /// across the handover — a successor restarting at 0 would land inside the
    /// window E1.31 discards as an out-of-order repeat (a delta in [-20, 0]) and
    /// freeze the rig on its last look for up to ~20 frames.
    ///
    /// `Option` + `default` is load-bearing: during a real upgrade the grant is
    /// produced by the OLD binary, which may predate this field. `None` means
    /// "not reported" — distinct from a genuine 0, and the successor then starts
    /// fresh rather than continuing from a number it invented.
    #[serde(default)]
    pub sacn_sequence: Option<u8>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ClientInfo {
    pub id: String,
    pub name: String,
    pub connected: bool,
    pub revoked: bool,
    pub admin: bool,
}

/// An audio device as shown in the settings UI.
#[derive(Debug, Clone, Default, Serialize)]
pub struct DeviceInfo {
    pub name: String,
    /// Channel count of the device's default config (0 = unknown).
    pub channels: u16,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct AudioSourceStatus {
    pub id: String,
    pub active: bool,
    /// Human-readable health note, e.g. "waiting for device". Empty when running.
    pub detail: String,
    pub level: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub bpm: f32,
    /// 0..1 confidence in `bpm`; UIs hide or dim the number when low.
    pub bpm_confidence: f32,
    pub beat_phase: f32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct RhythmStatus {
    /// True when the configured clock is driving the lights. For MIDI this means
    /// recent clock pulses, a valid tempo, and no explicit transport Stop.
    pub active: bool,
    pub using_fallback: bool,
    pub source: String,
    pub detail: String,
    pub bpm: f32,
    pub beat_phase: f32,
    pub running: bool,
    pub age_ms: f32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProDjLinkDeviceInfo {
    pub number: u8,
    pub name: String,
    pub tempo_master: bool,
    pub playing: bool,
    pub cued: bool,
    pub on_air: bool,
    pub looping: bool,
    pub beat_number: u64,
    pub phrase: Option<ProDjLinkActivePhrase>,
    pub playhead_ms: u32,
    pub track_length_secs: u32,
    pub pitch_percent: f32,
    pub track_bpm: f32,
    pub effective_bpm: f32,
    pub phase_available: bool,
    pub beat_phase: f32,
    pub bar_phase: f32,
    pub beat_elapsed_secs: f32,
    pub beat_remaining_secs: f32,
    pub bar_elapsed_secs: f32,
    pub bar_remaining_secs: f32,
    pub next_beat_ms: u32,
    pub second_beat_ms: u32,
    pub next_bar_ms: u32,
    pub fourth_beat_ms: u32,
    pub second_bar_ms: u32,
    pub eighth_beat_ms: u32,
    pub synced: bool,
    pub beat_in_bar: u8,
    pub play_state: u8,
    pub status_flags: u8,
    pub beats_until_cue: Option<u16>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProDjLinkNetworkDeviceInfo {
    pub number: u8,
    pub name: String,
    pub kind: String,
    pub ip: String,
    pub mac: String,
}

/// One structured line in the live PRO DJ LINK inspector. Values remain strings
/// so packet sentinels, hex flags, and human labels can coexist without lossy JSON.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ProDjLinkDebugEntry {
    pub sequence: u64,
    pub elapsed_ms: u64,
    pub category: String,
    pub device: u8,
    pub summary: String,
    pub fields: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProDjLinkCueInfo {
    pub kind: String,
    pub hot_cue_number: Option<u8>,
    pub position_ms: u32,
    pub loop_end_ms: Option<u32>,
    pub comment: String,
    pub color: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProDjLinkBeatGridEntry {
    pub beat_number: u32,
    pub beat_in_bar: u8,
    pub bpm: f64,
    pub time_ms: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProDjLinkPhraseInfo {
    pub phrase_number: u16,
    pub start_beat: u32,
    pub end_beat: u32,
    pub start_ms: u32,
    pub end_ms: u32,
    pub kind: String,
    pub raw_kind: u16,
    pub fill_in: bool,
    pub fill_in_beat: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProDjLinkPhraseAnalysis {
    pub mood: String,
    pub bank: String,
    pub end_beat: u32,
    pub phrases: Vec<ProDjLinkPhraseInfo>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProDjLinkActivePhrase {
    pub phrase_number: u16,
    pub kind: String,
    pub mood: String,
    pub bank: String,
    pub start_beat: u32,
    pub end_beat: u32,
    pub progress: f32,
    pub beats_remaining: f32,
    pub fill_in_active: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProDjLinkTrackInfo {
    pub deck: u8,
    pub source_player: u8,
    pub source_slot: String,
    pub rekordbox_id: u32,
    pub loading: bool,
    pub error: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub key: String,
    pub label: String,
    pub comment: String,
    pub duration_seconds: u32,
    pub bpm: f64,
    pub rating: u8,
    pub year: u16,
    pub bit_rate: u32,
    pub color_id: Option<u8>,
    pub artwork_id: u32,
    pub cues: Vec<ProDjLinkCueInfo>,
    pub beat_grid: Vec<ProDjLinkBeatGridEntry>,
    pub phrase_analysis: Option<ProDjLinkPhraseAnalysis>,
    /// Normalized 0..255 heights, compact enough for the 2 Hz status stream.
    pub waveform_preview: Vec<u8>,
    /// Full waveform downsampled to at most 1200 normalized height samples.
    pub waveform_detail: Vec<u8>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct VideoSourceStatus {
    pub active: bool,
    pub owner_id: String,
    pub owner_name: String,
    pub title: String,
    pub source_url: String,
    pub width: u16,
    pub height: u16,
    pub fps: f32,
    pub frames: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ScheduledShowStatus {
    pub enabled: bool,
    pub playlist_id: String,
    pub playlist_name: String,
    pub scene_name: String,
    /// Zero-based active entry.
    pub index: u32,
    pub total: u32,
    pub remaining_secs: f32,
    /// 0 outside a transition; otherwise 0..1 as the incoming scene arrives.
    pub transition_progress: f32,
}

/// Hardware test mode, mirrored to every client so the "TEST MODE" banner can be
/// unmissable on whichever device the operator picks up.
#[derive(Debug, Clone, Default, Serialize)]
pub struct TestModeStatus {
    pub active: bool,
    /// One line naming what is being sent right now, e.g.
    /// "Pixel 12 from the outer feed · spoke 3 · 25%".
    pub summary: String,
    /// Seconds until auto-exit; 0 when no deadline is set.
    pub expires_secs: f32,
    /// The live parameters, so every device's controls agree.
    pub config: crate::testmode::TestConfig,
    /// Name of the playlist blocking arming, when one is running.
    pub blocked_by_show: Option<String>,
}

/// Game mode, mirrored to every client: the GAME MODE banner, the Games tab's
/// controls, and the phone controller surfaces all read this.
#[derive(Debug, Clone, Serialize)]
pub struct GameModeStatus {
    /// The running game, if any.
    pub active: Option<crate::game::GameKind>,
    /// One line naming the game and how long it has been running.
    pub summary: String,
    /// Species count the ecosystem sim is running with.
    pub species: u8,
    /// Whether effects/drawing are overlaid on the game world.
    pub effects_overlay: bool,
    /// Name of the playlist blocking a manual start, when one is running.
    pub blocked_by_show: Option<String>,
}

impl Default for GameModeStatus {
    fn default() -> Self {
        Self {
            active: None,
            summary: String::new(),
            // Mirrors `GameControl::default` so a fresh backend, the status
            // fixture, and the mock backend all agree before the engine's
            // first status write.
            species: 3,
            effects_overlay: false,
            blocked_by_show: None,
        }
    }
}

/// Another sACN source heard on the wire, and what it means for our output.
/// Produced continuously by `sacnwatch`, unlike `DiscoveryResult::other_sources`
/// which is a one-shot from the Test tab's scan.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct SacnPeer {
    pub cid: String,
    pub source_name: String,
    pub from_ip: String,
    /// Universes we have heard actual data packets from it on.
    pub universes: Vec<u16>,
    /// Universes it advertises in its E1.31 discovery packets. Can be far wider
    /// than `universes` — we only listen to a bounded number of groups.
    pub announced: Vec<u16>,
    /// The intersection with our own output plan: the universes in dispute.
    pub overlapping: Vec<u16>,
    /// Its priority on a shared universe, when a data packet has told us. `None`
    /// means we know it is there (from discovery) but not at what priority.
    pub priority: Option<u8>,
    /// Ours, so a client can explain the comparison without reading config.
    pub our_priority: u8,
    pub packets_per_sec: u32,
    /// Everything it sends is flagged Preview_Data — a visualiser, not a rival.
    pub preview_only: bool,
    /// Higher priority than ours on a shared universe: it wins and our frames
    /// are discarded by the receiver.
    pub wins: bool,
    /// Equal priority on a shared universe: E1.31 receivers merge the two HTP,
    /// so the rig does what neither source asked for.
    pub ties: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct RuntimeStatus {
    /// Set when Vulkan init failed — the UI shows this prominently. No fallbacks.
    pub gpu_error: Option<String>,
    pub gpu_name: String,
    pub engine_fps: f32,
    pub frame_time_ms: f32,
    pub render_transition_active: bool,
    pub render_transition_progress: f32,
    pub sacn_enabled: bool,
    pub sacn_universes: u16,
    /// sACN packets actually sent per second — the "is it transmitting" truth.
    /// (Last full one-second bucket.)
    pub sacn_pps: u32,
    /// Output-path problem the operator must see (interface bind failed, socket
    /// unavailable). Packets may still flow — via the WRONG network interface.
    pub sacn_error: Option<String>,
    /// Our configured sACN priority, mirrored here so a client can compare it
    /// against a peer's without holding the config.
    pub sacn_priority: u8,
    /// Other sACN sources currently heard on the wire (see `sacnwatch`). Loudest
    /// problem first: outright winners, then equal-priority merges, then sources
    /// that are merely present.
    pub sacn_peers: Vec<SacnPeer>,
    /// How many of our universes the contention watcher actually holds multicast
    /// memberships for. Fewer than `sacn_universes` on a large patch, and the UI
    /// says so rather than implying full coverage.
    pub sacn_watched_universes: u16,
    /// Why the watcher can see less than it wants to (bind refused, membership
    /// limit reached).
    pub sacn_watch_error: Option<String>,
    /// A durable-save failure. The in-memory show continues, but a restart could
    /// lose recent changes.
    pub config_error: Option<String>,
    /// Windows keep-awake failure; the machine may follow its normal sleep policy.
    pub power_error: Option<String>,
    /// Frames rendered in each of the last ~30 one-second buckets (oldest first).
    pub fps_history: Vec<u32>,
    /// sACN packets sent in each of the last ~30 one-second buckets (oldest first).
    pub pps_history: Vec<u32>,
    pub clients: u32,
    pub audio: Vec<AudioSourceStatus>,
    pub rhythm: RhythmStatus,
    /// Hot-plug refreshed MIDI input names.
    pub midi_ports: Vec<String>,
    pub pro_dj_link_devices: Vec<ProDjLinkDeviceInfo>,
    pub pro_dj_link_network_devices: Vec<ProDjLinkNetworkDeviceInfo>,
    pub pro_dj_link_debug: Vec<ProDjLinkDebugEntry>,
    pub pro_dj_link_tracks: Vec<ProDjLinkTrackInfo>,
    /// Available local capture devices, for the settings UI dropdowns.
    pub input_devices: Vec<DeviceInfo>,
    /// Output devices (selectable as loopback beat sources).
    pub output_devices: Vec<DeviceInfo>,
    /// Channel counts of the default devices (0 = unknown), so the UI can render
    /// per-channel checkboxes even when "system default" is selected.
    pub default_input_channels: u16,
    pub default_output_channels: u16,
    /// Local IPv4 interfaces as "name — ip", for the sACN interface picker.
    pub interfaces: Vec<String>,
    /// Windows only: the firewall allow rule for our port is missing, so LAN
    /// clients may be blocked (and every new binary re-triggers the security
    /// prompt). The UI offers one-click authorization.
    pub firewall_pending: bool,
    /// Whether this platform can create a per-user Startup-folder shortcut.
    pub startup_supported: bool,
    /// The shortcut's observed state (not merely the persisted preference).
    pub startup_enabled: bool,
    /// Human-readable result or unsupported/error note.
    pub startup_state: String,
    /// Cache/download state per video playlist entry.
    pub video_cache: Vec<crate::videocache::VideoCacheStatus>,
    /// Known + connected client devices.
    pub client_list: Vec<ClientInfo>,
    pub master_brightness: f32,
    pub master_speed: f32,
    /// Running app version (CARGO_PKG_VERSION).
    pub version: String,
    /// Newer release version, when one is known.
    pub update_available: Option<String>,
    /// Updater progress / result note ("up to date", "downloading…", errors).
    pub update_state: String,
    /// The newer release is already downloaded and sitting beside the running exe,
    /// so installing it is a process spawn rather than a download. Lets the UI
    /// promise "Update now" instead of "Download and update".
    pub update_staged: bool,
    pub video: VideoSourceStatus,
    /// True while a compiled node-graph patch is rendering instead of the
    /// layer stack.
    pub patch_active: bool,
    /// Why the active patch is NOT rendering (compile/pipeline failure); the
    /// engine falls back to the layer stack when this is set.
    pub patch_error: Option<String>,
    pub show: ScheduledShowStatus,
    pub performance_recording: bool,
    pub performance_recording_name: String,
    pub performance_recording_secs: f32,
    pub test: TestModeStatus,
    pub game: GameModeStatus,
    /// True while a controller scan is in flight, so the Scan button can say so.
    pub discovery_running: bool,
    /// Current bounded persistent log and whether it could be opened.
    pub diagnostics_path: String,
    pub diagnostics_active: bool,
    pub diagnostics_error: String,
}

#[cfg(test)]
mod startup_tests {
    use super::ClientMsg;

    #[test]
    fn launch_at_startup_message_is_explicitly_typed() {
        let message: ClientMsg = serde_json::from_str(
            r#"{"type":"set_launch_at_startup","enabled":true}"#,
        )
        .unwrap();
        assert!(matches!(
            message,
            ClientMsg::SetLaunchAtStartup { enabled: true }
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_stop_video_message_is_owner_scoped() {
        let message: ClientMsg = serde_json::from_str(r#"{"type":"stop_video"}"#).unwrap();
        assert!(matches!(message, ClientMsg::StopVideo { force: false }));
    }

    #[test]
    fn legacy_audio_frame_defaults_to_microphone() {
        let message: ClientMsg = serde_json::from_str(
            r#"{"type":"audio_frame","level":0.1,"bass":0.2,"mid":0.3,"treble":0.4,"flux":0.5}"#,
        )
        .unwrap();
        assert!(matches!(
            message,
            ClientMsg::AudioFrame {
                stream: BrowserAudioStream::Microphone,
                ..
            }
        ));
    }

    #[test]
    fn legacy_paint_defaults_to_the_original_color_profile() {
        let message: ClientMsg = serde_json::from_str(
            r#"{"type":"paint","pen":"glow","points":[],"hue":0.5,"size":0.12,"intensity":1.0}"#,
        )
        .unwrap();
        assert!(matches!(
            message,
            ClientMsg::Paint {
                saturation: 0.85,
                brightness: 1.0,
                ..
            }
        ));
    }
}
