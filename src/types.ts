// Mirrors src-tauri/src/protocol.rs, config.rs, layers.rs (serde snake_case JSON).

export type LayerKind =
  | "solid"
  | "gradient_radial"
  | "noise_field"
  | "noise_color"
  | "radial_waves"
  | "spiral"
  | "plasma"
  | "spoke_chase"
  | "sparkle"
  | "beat_rings"
  | "breathe"
  | "rainbow"
  | "wedges"
  | "interference"
  | "fire"
  | "meteors"
  | "warp"
  | "waveform"
  | "spectrum"
  | "video";

export type BlendMode = "add" | "multiply" | "screen" | "alpha_over" | "max";

/// Motion effects travel across the array; shapes are figures stamped where they
/// are tapped. Order is the GPU id — see `EffectKind::ALL` in layers.rs.
export type MotionEffectKind =
  | "burst"
  | "strobe"
  | "swoosh"
  | "collapse"
  | "bloom"
  | "pinwheel"
  | "twinkle"
  | "wipe"
  | "ring";

export type ShapeKind = "star" | "heart" | "flower" | "diamond" | "triangle" | "moon";

export type EffectKind = MotionEffectKind | ShapeKind;

export type PenKind = "glow" | "ripple" | "sparkle" | "comet" | "ring" | "beam" | "ember";

export interface LayerCfg {
  kind: LayerKind;
  enabled: boolean;
  name: string;
  blend: BlendMode;
  opacity: number;
  speed: number;
  scale: number;
  audio_source: number;
  audio_amount: number;
  hue: number;
  hue_range: number;
  saturation: number;
  brightness: number;
  tilt_amount: number;
  walk_amount: number;
  param_a: number;
  param_b: number;
  param_c: number;
  param_d: number;
}

export interface SavedStack {
  id: string;
  name: string;
  layers: LayerCfg[];
  master_speed: number;
  walk_enabled: boolean;
  walk_layers: boolean;
  walk_min_layers: number;
  walk_speed: number;
  walk_depth: number;
}

export type PerformanceAction =
  | { action: "set_look"; stack: SavedStack; patch: string | null }
  | { action: "add_layer"; layer: LayerCfg }
  | { action: "update_layer"; index: number; layer: LayerCfg }
  | { action: "remove_layer"; index: number }
  | { action: "move_layer"; from: number; to: number }
  | { action: "set_master"; brightness: number | null; speed: number | null }
  | { action: "trigger_effect"; effect: EffectCfg }
  | { action: "paint"; pen: PenKind; points: { angle: number; radius: number }[]; hue: number; saturation: number; brightness: number; size: number; intensity: number }
  | { action: "patch_activate"; id: string | null }
  | { action: "patch_param"; node: string; param: string; value: number };

export interface PerformanceEvent {
  at_secs: number;
  action: PerformanceAction["action"];
}

export interface SavedPerformance {
  id: string;
  name: string;
  initial_stack: SavedStack;
  initial_patch: string | null;
  duration_secs: number;
  events: (PerformanceEvent & Record<string, unknown>)[];
}

export interface ShowPlaylistEntry {
  id: string;
  name: string;
  stack: SavedStack;
  duration_secs: number;
  transition_secs: number;
  /** Present = this cue runs a game world (absent in older configs). */
  game?: GameCue | null;
  /** Present when the cue replays captured control metadata. */
  performance?: SavedPerformance | null;
}

export interface SavedPlaylist {
  id: string;
  name: string;
  entries: ShowPlaylistEntry[];
  repeat: boolean;
}

export interface ShowSchedulerConfig {
  enabled: boolean;
  active_playlist_id: string;
  current_index: number;
}

export interface EffectCfg {
  kind: EffectKind;
  angle: number;
  radius: number;
  intensity: number;
  size: number;
  hue: number;
  saturation: number;
  brightness: number;
  duration: number;
  /** Shapes: the figure's own rotation, radians. `angle`/`radius` place it. */
  rotation: number;
  /** Shapes: scale drift over the life, -1 (shrinks away) .. 1 (doubles). */
  grow: number;
}

export interface GeometryConfig {
  spokes: number;
  pixels_per_spoke: number;
  outer_radius_ft: number;
  inner_radius_ft: number;
  leds_per_meter: number;
}

export interface OutputConfig {
  enabled: boolean;
  interface: string;
  sync_to_render: boolean;
  fps: number;
  sync_universe: number;
  start_universe: number;
  pixels_per_universe: number;
  /** Universes allocated per spoke (spacing between spoke start universes); 0 = packed. */
  universe_stride: number;
  controllers: string[];
  strings_per_controller: number;
  multicast: boolean;
  priority: number;
  led_gamma: number;
  /** Persistent E1.31 source identity (UUID). Generated on first run; never changes. */
  cid: string;
  source_name: string;
  discovery: boolean;
}

export interface ServerConfig {
  bind: string;
  port: number;
  max_preview_clients: number;
  auth_token: string | null;
  join_token: string;
  require_token: boolean;
}

export interface ClientRecord {
  id: string;
  name: string;
  revoked: boolean;
}

export interface ClientInfo {
  id: string;
  name: string;
  connected: boolean;
  revoked: boolean;
}

export type AudioSourceConfig = {
  id: string;
  gain: number;
} & (
  | { kind: "device"; device: string | null; channels: number[]; loopback: boolean }
  | { kind: "remote"; client_id: string }
  | { kind: "video" }
);

export interface AudioConfig {
  sources: AudioSourceConfig[];
}

export type RhythmSource = "layer_audio" | "midi_clock" | "pro_dj_link";

export interface RhythmConfig {
  source: RhythmSource;
  midi_port: string | null;
  pro_dj_link_player: number;
  pro_dj_link_metadata_player: number;
  latency_ms: number;
  fallback_to_audio: boolean;
  fallback_audio_source: number;
}

export interface RenderConfig {
  fps: number;
  master_brightness: number;
  master_speed: number;
  manual_transition_secs: number;
  manual_bpm: number | null;
  beat_time: "half" | "normal" | "double";
  walk_enabled: boolean;
  walk_layers: boolean;
  walk_min_layers: number;
  walk_speed: number;
  walk_depth: number;
  /**
   * Local "HH:MM" at which layer phases are zeroed daily, or null for never.
   * Scheduled for daylight because the reset is a visible jump — see
   * `RenderConfig::phase_reset_at` in config.rs.
   */
  phase_reset_at: string | null;
}

export interface UpdateConfig {
  auto_check: boolean;
  auto_install: boolean;
  /** Local "HH:MM" at which a client sitting in show mode leaves it; null = never. */
  leave_show_at: string | null;
}

export interface WindowsConfig {
  aux_open: string[];
  launch_at_startup: boolean;
}

export type PlaylistKind = "url" | "local_file";

export interface PlaylistEntry {
  id: string;
  title: string;
  /** URL or absolute path on the Gate machine. */
  source: string;
  kind: PlaylistKind;
  /** Watched folder this entry was discovered in ("" for manual adds). */
  from_dir: string;
}

export interface VideoConfig {
  playlist: PlaylistEntry[];
  dirs: string[];
  auto_advance: boolean;
}

export interface VideoCacheStatus {
  id: string;
  state: "cached" | "downloading" | "pending" | "error" | "local";
  progress: number;
  bytes: number;
  error: string;
}

export interface BeatTapConfig {
  enabled: boolean;
  audio_source: number;
  spin: number;
  vary: boolean;
  radius: number;
  intensity: number;
  hue: number;
  every: number;
}

export interface AppConfig {
  geometry: GeometryConfig;
  output: OutputConfig;
  server: ServerConfig;
  audio: AudioConfig;
  rhythm: RhythmConfig;
  render: RenderConfig;
  update: UpdateConfig;
  windows: WindowsConfig;
  video: VideoConfig;
  beat_taps: BeatTapConfig;
  autostart: boolean;
  layers: LayerCfg[];
  saved_stacks: SavedStack[];
  saved_performances: SavedPerformance[];
  saved_playlists: SavedPlaylist[];
  show_scheduler: ShowSchedulerConfig;
  clients: ClientRecord[];
  /** Id of the node-graph patch the engine renders instead of the layer stack. */
  active_patch: string | null;
}

export interface DeviceInfo {
  name: string;
  /** Channel count of the device's default config (0 = unknown). */
  channels: number;
}

export interface AudioSourceStatus {
  id: string;
  active: boolean;
  /** Health note, e.g. "waiting for device". Empty when running. */
  detail: string;
  level: number;
  bass: number;
  mid: number;
  treble: number;
  bpm: number;
  /** 0..1 confidence in bpm; hide or dim the number when low. */
  bpm_confidence: number;
  beat_phase: number;
}

export interface RhythmStatus {
  active: boolean;
  using_fallback: boolean;
  source: string;
  detail: string;
  bpm: number;
  beat_phase: number;
  running: boolean;
  age_ms: number;
}

export interface ProDjLinkDeviceInfo {
  number: number;
  name: string;
  tempo_master: boolean;
  playing: boolean;
  cued: boolean;
  on_air: boolean;
  looping: boolean;
  beat_number: number;
}

export interface ProDjLinkDebugEntry {
  sequence: number;
  elapsed_ms: number;
  category: string;
  device: number;
  summary: string;
  fields: Record<string, string>;
}

export interface ProDjLinkCueInfo {
  kind: "memory" | "hot_cue" | "loop";
  hot_cue_number: number | null;
  position_ms: number;
  loop_end_ms: number | null;
  comment: string;
  color: string;
}

export interface ProDjLinkTrackInfo {
  deck: number;
  source_player: number;
  source_slot: string;
  rekordbox_id: number;
  loading: boolean;
  error: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  key: string;
  label: string;
  comment: string;
  duration_seconds: number;
  bpm: number;
  rating: number;
  year: number;
  bit_rate: number;
  artwork_id: number;
  cues: ProDjLinkCueInfo[];
  waveform_preview: number[];
  waveform_detail: number[];
}

export interface RuntimeStatus {
  gpu_error: string | null;
  gpu_name: string;
  engine_fps: number;
  frame_time_ms: number;
  render_transition_active: boolean;
  render_transition_progress: number;
  sacn_enabled: boolean;
  sacn_universes: number;
  sacn_pps: number;
  sacn_error: string | null;
  /** Our configured sACN priority, for comparing against a peer's. */
  sacn_priority: number;
  /** Other sACN sources heard right now; worst problem first. */
  sacn_peers: SacnPeer[];
  /** How many of our universes the watcher actually holds memberships for. */
  sacn_watched_universes: number;
  /** Why the watcher sees less than it wants to. */
  sacn_watch_error: string | null;
  config_error: string | null;
  power_error: string | null;
  fps_history: number[];
  pps_history: number[];
  clients: number;
  audio: AudioSourceStatus[];
  rhythm: RhythmStatus;
  midi_ports: string[];
  pro_dj_link_devices: ProDjLinkDeviceInfo[];
  pro_dj_link_debug: ProDjLinkDebugEntry[];
  pro_dj_link_tracks: ProDjLinkTrackInfo[];
  input_devices: DeviceInfo[];
  output_devices: DeviceInfo[];
  default_input_channels: number;
  default_output_channels: number;
  interfaces: string[];
  firewall_pending: boolean;
  startup_supported: boolean;
  startup_enabled: boolean;
  startup_state: string;
  video_cache: VideoCacheStatus[];
  client_list: ClientInfo[];
  master_brightness: number;
  master_speed: number;
  version: string;
  update_available: string | null;
  update_state: string;
  /** The release is already downloaded, so installing it is a spawn, not a wait. */
  update_staged: boolean;
  video: VideoSourceStatus;
  /** True while a compiled node-graph patch renders instead of the layer stack. */
  patch_active: boolean;
  /** Why the active patch is NOT rendering (engine fell back to the stack). */
  patch_error: string | null;
  show: ScheduledShowStatus;
  performance_recording: boolean;
  performance_recording_name: string;
  performance_recording_secs: number;
  test: TestModeStatus;
  game: GameModeStatus;
  /** True while a controller scan is in flight. */
  discovery_running: boolean;
  diagnostics_path: string;
  diagnostics_active: boolean;
  diagnostics_error: string;
}

// --- hardware test mode (mirrors src-tauri/src/testmode.rs) ---

export type TestPattern =
  | "blackout"
  | "solid"
  | "color_cycle"
  | "pixel_index"
  | "ruler"
  | "universe_marks"
  | "gradient"
  | "spoke_id"
  | "chase";

export type SpokeSelect = "all" | "one" | "controller" | "cycle";

export interface TestConfig {
  pattern: TestPattern;
  /** 0..1, applied to the whole test frame. */
  brightness: number;
  /** Hue in turns; negative = white. */
  hue: number;
  saturation: number;
  /** Nth pixel, counted from whichever end `from_inner` selects. */
  index: number;
  /** Count from the inner end instead of the outer feed end. */
  from_inner: boolean;
  width: number;
  chase_hz: number;
  blink_hz: number;
  spoke_select: SpokeSelect;
  spoke: number;
  controller: number;
  cycle_hz: number;
  /** Disarm automatically after this long; 0 = never. */
  auto_exit_secs: number;
}

export interface TestModeStatus {
  active: boolean;
  summary: string;
  expires_secs: number;
  config: TestConfig;
  /** Name of the playlist blocking arming, when a show is running. */
  blocked_by_show: string | null;
}

// --- game mode (mirrors src-tauri/src/game/mod.rs, plans/game-mode.md) ---

export type GameKind = "rps" | "life" | "spokewar" | "flak" | "radial_tetris";

/** A playlist entry that runs a game world over its scene. */
export interface GameCue {
  game: GameKind;
  species: number;
}

export interface GameModeStatus {
  active: GameKind | null;
  /** One line naming the game and how long it has been running. */
  summary: string;
  species: number;
  effects_overlay: boolean;
  /** Name of the playlist blocking a manual start, when a show is running. */
  blocked_by_show: string | null;
}

// --- controller discovery (mirrors src-tauri/src/discovery.rs) ---

export interface FoundController {
  ip: string;
  /** Set only when the controller's own idea of its address disagrees with the
   *  address it answered from — a static IP that did not take, a stale lease. */
  reported_ip: string | null;
  mac: string;
  model: string;
  nickname: string;
  firmware: string;
  protocol: string;
  outputs: number;
  temperature_c: number | null;
  dhcp: boolean | null;
  expected: boolean;
}

/**
 * Another sACN source on the wire, seen by the always-on watcher. Distinct from
 * {@link SacnSourceSeen}, which is a one-shot result of the Test tab's scan and
 * carries no priority.
 */
export interface SacnPeer {
  cid: string;
  source_name: string;
  from_ip: string;
  /** Universes we have heard real data packets from it on. */
  universes: number[];
  /** Universes it advertises in its E1.31 discovery packets. */
  announced: number[];
  /** The intersection with our own output plan — the universes in dispute. */
  overlapping: number[];
  /** Its priority on a shared universe; null when only discovery told us it exists. */
  priority: number | null;
  our_priority: number;
  packets_per_sec: number;
  /** Everything it sends is Preview_Data: a visualiser, not a rival. */
  preview_only: boolean;
  /** Beats us on a shared universe — the receiver discards our frames. */
  wins: boolean;
  /** Equal priority on a shared universe: receivers merge HTP and the rig does
   *  what neither source asked for. */
  ties: boolean;
}

export interface SacnSourceSeen {
  cid: string;
  source_name: string;
  from_ip: string;
  universes: number[];
}

export interface DiscoveryResult {
  scanned_interface: string;
  duration_ms: number;
  found: FoundController[];
  missing: string[];
  unexpected: string[];
  other_sources: SacnSourceSeen[];
  errors: string[];
}

export interface ScheduledShowStatus {
  enabled: boolean;
  playlist_id: string;
  playlist_name: string;
  scene_name: string;
  index: number;
  total: number;
  remaining_secs: number;
  transition_progress: number;
}

export interface VideoSourceStatus {
  active: boolean;
  owner_id: string;
  owner_name: string;
  title: string;
  source_url: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
}

export type ServerMsg =
  | { type: "state"; config: AppConfig; status: RuntimeStatus }
  | { type: "status"; status: RuntimeStatus }
  | { type: "beat"; source: number; bpm: number }
  | { type: "pro_dj_link_debug"; entry: ProDjLinkDebugEntry }
  | {
      type: "preview_meta";
      spokes: number;
      pixels: number;
      decimate: number;
      outer_radius_ft: number;
      inner_radius_ft: number;
    }
  | { type: "error"; message: string }
  | { type: "denied"; reason: string }
  | { type: "report_saved"; report: ReportInfo }
  | { type: "preview_queue"; position: number }
  | { type: "patches"; patches: PatchSummary[] }
  | { type: "patch"; patch: PatchDoc }
  | { type: "patch_param_changed"; node: string; param: string; value: number }
  | { type: "discovery"; result: DiscoveryResult };

// --- node-graph patches (mirrors src-tauri/src/patch/) ---

export type PatchShape =
  | "scalar"
  | "event"
  | "field_scalar"
  | "field_color"
  | "points"
  | "texture"
  | "pixels";

export interface PatchPortDef {
  name: string;
  shape: PatchShape;
}

export interface PatchParamDef {
  name: string;
  label: string;
  min: number;
  max: number;
  default: number;
  integrate: boolean;
  kind: "number" | { select: string[] };
}

/** One palette entry from GET /patch/registry — the backend's node registry. */
export interface PatchNodeType {
  id: string;
  label: string;
  category: "input" | "scalar" | "generator" | "field" | "combine" | "texture" | "sink";
  inputs: PatchPortDef[];
  outputs: PatchPortDef[];
  params: PatchParamDef[];
}

export interface PatchNode {
  id: string;
  kind: string;
  name: string;
  params: Record<string, number>;
  pos: [number, number];
}

export interface PatchPortRef {
  node: string;
  port: string;
}

export interface PatchEdge {
  from: PatchPortRef;
  to: PatchPortRef;
}

export interface PatchExposedParam {
  node: string;
  param: string;
  label: string;
}

export interface PatchDoc {
  format: number;
  id: string;
  name: string;
  description: string;
  nodes: PatchNode[];
  edges: PatchEdge[];
  exposed: PatchExposedParam[];
}

export interface PatchSummary {
  id: string;
  name: string;
  description: string;
  nodes: number;
}

/** Wire-compat rule — mirrors Shape::accepts in Rust: exact match plus the
 * two blessed adapters (Scalar→Field<f32>, Field<f32>→Field<color>). */
export function shapeAccepts(into: PatchShape, from: PatchShape): boolean {
  return (
    into === from ||
    (from === "scalar" && into === "field_scalar") ||
    (from === "field_scalar" && into === "field_color")
  );
}

/** Summary of a saved feedback bundle (see src-tauri/src/report.rs). */
export interface ReportInfo {
  id: string;
  created: string;
  created_unix_ms: number;
  description: string;
  reported_by: string;
  window_seconds: number;
  frames: number;
  app_version: string;
  /** Absolute path of the bundle directory on the Gate machine. */
  path: string;
}

export interface PreviewMeta {
  spokes: number;
  pixels: number;
  decimate: number;
  outer_radius_ft: number;
  inner_radius_ft: number;
}

export interface PreviewFrame {
  frameNumber: number;
  spokes: number;
  pixels: number;
  rgb: Uint8Array;
}

export const LAYER_KINDS: LayerKind[] = [
  "solid",
  "gradient_radial",
  "noise_field",
  "noise_color",
  "radial_waves",
  "spiral",
  "plasma",
  "spoke_chase",
  "sparkle",
  "beat_rings",
  "breathe",
  "rainbow",
  "wedges",
  "interference",
  "fire",
  "meteors",
  "warp",
  "waveform",
  "spectrum",
  "video",
];

export const BLEND_MODES: BlendMode[] = ["add", "multiply", "screen", "alpha_over", "max"];

export const LAYER_LABELS: Record<LayerKind, string> = {
  solid: "Solid",
  gradient_radial: "Radial Gradient",
  noise_field: "Noise Field",
  noise_color: "Color Noise",
  radial_waves: "Harmonic Rings",
  spiral: "Spiral",
  plasma: "Plasma",
  spoke_chase: "Spoke Chase",
  sparkle: "Sparkle",
  beat_rings: "Beat Rings",
  breathe: "Breathe",
  rainbow: "Rainbow",
  wedges: "Wedges",
  interference: "Interference",
  fire: "Fire",
  meteors: "Meteors",
  warp: "Warp",
  waveform: "Waveform",
  spectrum: "Spectrum",
  video: "Video",
};

/** Kind-specific labels for param_a..d, where meaningful. */
export const PARAM_LABELS: Partial<Record<LayerKind, [string?, string?, string?, string?]>> = {
  noise_field: ["Threshold"],
  radial_waves: ["Base freq", "Harmonics"],
  spiral: ["Arms", "Twist", "Sharpness"],
  spoke_chase: ["Speed", "Direction", "Tail length"],
  sparkle: ["Density", "Twinkle rate"],
  beat_rings: ["Ring width", "Direction"],
  breathe: ["Depth floor"],
  rainbow: ["Turns"],
  wedges: ["Slices", "Radial twist", "Edge softness"],
  interference: ["Frequency", "Orbit size", "Sharpness"],
  fire: ["Flame reach", "Flame stretch"],
  meteors: ["Density", "Rate/tail", "Direction"],
  warp: ["Star density", "Speed"],
  waveform: ["Ring radius", "Depth", "Thickness"],
  spectrum: ["Bar length", "From outer/inner"],
  video: ["Zoom", "Kaleidoscope", "Contrast", "Rotation"],
};

export function defaultLayer(kind: LayerKind): LayerCfg {
  const layer: LayerCfg = {
    kind,
    enabled: true,
    name: LAYER_LABELS[kind],
    blend: "add",
    opacity: 1.0,
    speed: 1.0,
    scale: 1.0,
    audio_source: 0,
    audio_amount: 0.5,
    hue: 0.6,
    hue_range: 0.2,
    saturation: 0.9,
    brightness: 1.0,
    tilt_amount: 0.0,
    walk_amount: 0.25,
    param_a: 0.5,
    param_b: 0.5,
    param_c: 0.5,
    param_d: 0.5,
  };
  if (kind === "video") {
    layer.blend = "alpha_over";
    layer.audio_amount = 0.7;
    layer.hue_range = 1;
    layer.saturation = 1;
    layer.walk_amount = 0;
    layer.param_a = 0.5;
    layer.param_b = 0;
    layer.param_c = 0.35;
  }
  return layer;
}
