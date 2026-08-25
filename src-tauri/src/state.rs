//! Shared state between the frame-generation thread (primary), the audio threads,
//! the WebSocket server, and the Tauri shell. Everything is lock-light: the frame
//! loop takes short locks to snapshot inputs and never blocks on clients.

use crate::config::AppConfig;
use crate::layers::{EffectCfg, MAX_AUDIO_SOURCES};
use crate::protocol::{ProDjLinkDebugEntry, ProDjLinkTrackInfo, RuntimeStatus, ServerMsg};
use parking_lot::{Mutex, RwLock};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::time::Instant;
use tokio::sync::broadcast;

pub const DJ_EVENT_PLAY: usize = 0;
pub const DJ_EVENT_CUE: usize = 1;
pub const DJ_EVENT_CUE_RELEASE: usize = 2;
pub const DJ_EVENT_ON_AIR: usize = 3;
pub const DJ_EVENT_OFF_AIR: usize = 4;
pub const DJ_EVENT_LOOP_START: usize = 5;
pub const DJ_EVENT_LOOP_WRAP: usize = 6;
pub const DJ_EVENT_LOOP_END: usize = 7;
pub const DJ_EVENT_JUMP: usize = 8;
pub const DJ_EVENT_COUNT: usize = 9;

/// Monotonic PRO DJ LINK event counters consumed by patch runtimes. Counters
/// preserve short deck events until the next render frame instead of relying on
/// a one-frame boolean pulse from the network thread.
#[derive(Debug, Clone, Copy, Default)]
pub struct DjLinkPatchEvents {
    pub seq: [u64; DJ_EVENT_COUNT],
    pub last_player: u8,
}

impl DjLinkPatchEvents {
    pub fn record(&mut self, event: usize, player: u8) {
        self.seq[event] = self.seq[event].wrapping_add(1);
        self.last_player = player;
    }
}

/// Per-source audio features, written by an analysis chain, read by the frame loop.
#[derive(Debug, Clone, Copy, Default)]
pub struct AudioFeatures {
    pub active: bool,
    /// See `audio::HEALTH_*` — surfaces "waiting for device" states to the UI.
    pub health: u8,
    pub level: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    /// Smoothed (~0.25 s) twins of the bands, MilkDrop-style: `bass / bass_att`
    /// is per-band punch; `bass_att` is the groove.
    pub bass_att: f32,
    pub mid_att: f32,
    pub treble_att: f32,
    /// Decaying onset pulse (1.0 at each detected onset).
    pub onset: f32,
    /// 0..1 phase within the current beat.
    pub beat_phase: f32,
    pub bpm: f32,
    /// 0..1 confidence in `bpm` (see BeatTracker::confidence).
    pub bpm_conf: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_frames_are_bounded_and_owned_by_one_connection() {
        let state = SharedState::new(AppConfig::default());
        state.start_video(
            7,
            "ipad",
            "clip".into(),
            "https://example.com/clip.mp4".into(),
        );
        let rgba = vec![42u8; 4 * 3 * 4];

        assert!(!state.push_video_frame(8, 4, 3, &rgba), "wrong connection");
        assert!(!state.push_video_frame(7, 0, 3, &[]), "zero width");
        assert!(
            !state.push_video_frame(7, 4, 3, &rgba[..rgba.len() - 1]),
            "bad payload size"
        );
        assert!(state.push_video_frame(7, 4, 3, &rgba));

        {
            let video = state.video.lock();
            assert!(video.active);
            assert_eq!((video.width, video.height), (4, 3));
            assert_eq!(video.frames, 1);
            assert_eq!(video.rgba, rgba);
        }

        state.stop_video(Some(8));
        assert!(
            state.video.lock().active,
            "a stale connection cannot stop the owner"
        );
        state.stop_video(Some(7));
        assert!(!state.video.lock().active);
        assert!(state.video.lock().rgba.is_empty());
    }

    #[test]
    fn oversized_paint_batches_keep_only_the_newest_bounded_points() {
        let state = SharedState::new(AppConfig::default());
        let points: Vec<_> = (0..crate::layers::MAX_DABS + 100)
            .map(|index| crate::layers::DabPoint {
                angle: index as f32,
                radius: 0.5,
                dir: 0.0,
            })
            .collect();

        state.paint(
            crate::layers::PenKind::Glow,
            &points,
            0.0,
            1.0,
            1.0,
            0.1,
            1.0,
        );

        let dabs = state.dabs.lock();
        assert_eq!(dabs.len(), crate::layers::MAX_DABS);
        assert_eq!(dabs[0].angle, 100.0);
    }
}

/// Raw audio shapes shipped to the GPU each frame: the recent waveform (a ring
/// oscilloscope's worth) and the log-spaced spectrum. Written by capture threads.
pub struct ScopeData {
    pub wave: [f32; 256],
    pub spectrum: [f32; crate::audio::analysis::SPECTRUM_BINS],
}

impl Default for ScopeData {
    fn default() -> Self {
        Self {
            wave: [0.0; 256],
            spectrum: [0.0; crate::audio::analysis::SPECTRUM_BINS],
        }
    }
}

/// Control inputs from remote phones (IMU) — a small global "control bus".
#[derive(Debug, Clone, Copy, Default)]
pub struct ControlInputs {
    pub yaw: f32,
    pub pitch: f32,
    pub roll: f32,
    /// Decays over time; spiked by phone shakes.
    pub shake: f32,
}

pub struct ActiveEffect {
    pub cfg: EffectCfg,
    pub born: Instant,
}

pub struct ActiveDab {
    pub kind: crate::layers::PenKind,
    pub angle: f32,
    pub radius: f32,
    pub hue: f32,
    pub saturation: f32,
    pub brightness: f32,
    pub size: f32,
    pub intensity: f32,
    pub dir: f32,
    pub born: Instant,
}

pub struct ActivePerformanceRecording {
    pub id: String,
    pub name: String,
    pub started: Instant,
    pub initial_stack: crate::config::SavedStack,
    pub initial_patch: Option<String>,
    pub events: Vec<crate::config::PerformanceEvent>,
}

/// One frame as produced by the engine: raw perceptual RGB (no LED gamma).
pub struct PreviewFrame {
    pub frame_number: u64,
    pub spokes: u32,
    pub pixels_per_spoke: u32,
    pub rgb: Vec<u8>,
}

/// Rations concurrent preview streams (the bandwidth-heavy part of a client) to
/// `max` slots; everyone else waits FIFO. Control traffic is never gated.
#[derive(Default)]
pub struct PreviewGate {
    pub active: Vec<u64>,
    pub waiting: Vec<u64>,
}

impl PreviewGate {
    /// Register interest; returns true if immediately active.
    pub fn request(&mut self, conn: u64, max: usize) -> bool {
        if self.active.contains(&conn) {
            return true;
        }
        if !self.waiting.contains(&conn) {
            self.waiting.push(conn);
        }
        self.promote(max);
        self.active.contains(&conn)
    }

    pub fn release(&mut self, conn: u64, max: usize) {
        self.active.retain(|c| *c != conn);
        self.waiting.retain(|c| *c != conn);
        self.promote(max);
    }

    /// True when this connection holds a slot; promotes waiters as slots free up.
    pub fn is_active(&mut self, conn: u64, max: usize) -> bool {
        self.promote(max);
        self.active.contains(&conn)
    }

    /// 1-based queue position, if waiting.
    pub fn position(&self, conn: u64) -> Option<u32> {
        self.waiting
            .iter()
            .position(|c| *c == conn)
            .map(|p| p as u32 + 1)
    }

    fn promote(&mut self, max: usize) {
        while self.active.len() < max && !self.waiting.is_empty() {
            let next = self.waiting.remove(0);
            self.active.push(next);
        }
        // A lowered cap sheds the newest active first.
        while self.active.len() > max {
            if let Some(demoted) = self.active.pop() {
                self.waiting.insert(0, demoted);
            }
        }
    }
}

/// Latest browser-decoded video frame. Only the newest frame is retained: video
/// input is a real-time control signal, so network jitter drops frames instead of
/// building latency.
pub struct VideoInput {
    pub active: bool,
    pub owner_conn_id: u64,
    pub owner_id: String,
    pub title: String,
    pub source_url: String,
    pub width: u16,
    pub height: u16,
    pub rgba: Vec<u8>,
    pub revision: u64,
    pub frames: u64,
    pub fps: f32,
    last_frame: Option<Instant>,
}

impl Default for VideoInput {
    fn default() -> Self {
        Self {
            active: false,
            owner_conn_id: 0,
            owner_id: String::new(),
            title: String::new(),
            source_url: String::new(),
            width: 0,
            height: 0,
            rgba: Vec::new(),
            revision: 0,
            frames: 0,
            fps: 0.0,
            last_frame: None,
        }
    }
}

pub struct SharedState {
    pub config: RwLock<AppConfig>,
    /// Serializes mutate -> snapshot -> durable save -> broadcast. Without this,
    /// concurrent clients can race on config.json.tmp/.bak and an older snapshot
    /// can overwrite a newer one after the config lock has been released.
    config_save: Mutex<()>,
    /// Bumped on every config change; threads compare to notice reconfiguration.
    pub config_epoch: AtomicU32,
    /// Bumped when any patch file changes (save/delete), so the engine rebuilds
    /// the active patch's pipeline even though the config didn't change.
    pub patch_epoch: AtomicU32,
    /// Explicit renderer changes bump this so the engine can snapshot the
    /// outgoing bus before applying the new layer stack or patch.
    pub render_transition_epoch: AtomicU64,
    /// Live exposed-param changes queued for the active patch runtime — applied
    /// by the engine loop with NO pipeline rebuild (that's the point).
    pub patch_params: Mutex<Vec<(String, String, f32)>>,
    /// Monotonic count of triggered effects; the patch Tap node edge-detects it.
    pub effect_seq: AtomicU64,
    /// PRO DJ LINK transport events ask the renderer to bypass its normal
    /// one-frame GPU readback pipeline once. Kept separate from `effect_seq` so
    /// a busy touch surface does not double-dispatch every ordinary effect.
    pub low_latency_render_seq: AtomicU64,
    pub effects: Mutex<Vec<ActiveEffect>>,
    pub dabs: Mutex<Vec<ActiveDab>>,
    pub audio: [Mutex<AudioFeatures>; MAX_AUDIO_SOURCES],
    pub scope: [Mutex<ScopeData>; MAX_AUDIO_SOURCES],
    pub midi_clock: Mutex<crate::rhythm::MidiClockState>,
    pub pioneer_clock: Mutex<crate::rhythm::PioneerClockState>,
    pub pioneer_patch_events: Mutex<DjLinkPatchEvents>,
    pub pioneer_debug: Mutex<VecDeque<ProDjLinkDebugEntry>>,
    pub pioneer_debug_seq: AtomicU64,
    pub pioneer_tracks: Mutex<HashMap<u8, ProDjLinkTrackInfo>>,
    pub control: Mutex<ControlInputs>,
    /// Hardware commissioning mode. Deliberately NOT in `AppConfig`: it must not
    /// be able to survive a restart into a show. Always starts disarmed.
    pub test: Mutex<crate::testmode::TestState>,
    /// Game mode control surface (see `game::GameControl`). Same rule as test
    /// mode: not in `AppConfig`, always starts inactive.
    pub game: Mutex<crate::game::GameControl>,
    /// Result of the last controller scan, kept so a client that connects after
    /// a scan can still see it.
    pub last_discovery: Mutex<Option<crate::discovery::DiscoveryResult>>,
    /// One scan at a time — a second request while one is in flight is answered
    /// from the running scan rather than putting more probes on the wire.
    pub discovery_running: AtomicBool,
    pub status: Mutex<RuntimeStatus>,
    pub shutdown: AtomicBool,
    /// Per-layer animation phases, owned by the engine loop but shared so a
    /// handover can transplant them into a successor instance.
    pub layer_phases: Mutex<Vec<f64>>,
    /// Set after writing transplanted phases into `layer_phases`; the engine loop
    /// swaps it false and adopts them.
    pub phases_transplanted: AtomicBool,
    /// sACN gated off while a takeover from an older instance is in progress
    /// (this instance must not send before the old one has stopped).
    pub sacn_hold: AtomicBool,
    /// Set after the HTTP/WS listener owns the configured port. A successor whose
    /// handover response was lost keeps sACN held until this proves the old
    /// process has actually released its server.
    pub server_bound: AtomicBool,
    /// Set once this instance has granted a handover: stop sACN immediately and
    /// shut down shortly after.
    pub leaving: AtomicBool,
    /// Engine ack that it observed `leaving` and skipped a send — after this, no
    /// more packets will ever leave this instance (the commit reply waits on it).
    pub sacn_quiesced: AtomicBool,
    /// Engine ack that it has sent (or deliberately skipped) E1.31 stream
    /// termination on shutdown. Process exit waits briefly on this, otherwise the
    /// terminate packets never make it out of the socket.
    pub sacn_terminated: AtomicBool,
    /// The sACN sequence number last put on the wire, published for the handover
    /// grant so a successor can continue the stream instead of restarting it.
    pub sacn_sequence: AtomicU8,
    /// A grant's sequence number, waiting for the engine to hand it to the sender
    /// (the engine owns the `SacnSender`). Mirrors `phases_transplanted`.
    pub sacn_resume_pending: AtomicBool,
    pub sacn_resume_sequence: AtomicU8,
    /// Total frames rendered; the takeover waits for its adopted config to have
    /// flowed through the render+readback pipeline before committing.
    pub frames_rendered: AtomicU64,
    /// Set by the UI/auto-check to ask the updater thread to act.
    pub update_check_requested: AtomicBool,
    pub update_install_requested: AtomicBool,
    /// Whether this instance runs headless (the updater passes it to a successor).
    pub headless: AtomicBool,
    /// Per-playlist-entry cache state, written by the videocache task.
    pub video_cache: Mutex<HashMap<String, crate::videocache::VideoCacheStatus>>,
    /// Preview-stream slot rationing (see `PreviewGate`).
    pub preview_gate: Mutex<PreviewGate>,
    /// Currently-connected WS clients: connection serial -> client id.
    pub connected_clients: Mutex<HashMap<u64, String>>,
    pub conn_seq: AtomicU64,
    /// JSON events fanned out to every connected client.
    pub events: broadcast::Sender<ServerMsg>,
    /// Full-resolution frames; each client task decimates/throttles for itself.
    pub preview: broadcast::Sender<Arc<PreviewFrame>>,
    pub video: Mutex<VideoInput>,
    /// A second launch asked us to come forward (POST /focus) instead of taking
    /// the port from us; the Tauri layer polls this and focuses the window.
    pub focus_requested: AtomicBool,
    /// We took the port from an instance that was not newer than us — i.e. an
    /// update put us here. Licenses promoting over a launcher we were not told
    /// about, for updates started by binaries older than v0.5.2.
    pub took_over_older: AtomicBool,
    /// Set once the operator has confirmed closing a live show; the next window
    /// close request is then allowed through instead of being refused again.
    pub close_confirmed: AtomicBool,
    /// A UI is mounted and listening for the close-confirmation event. The guard
    /// is DISARMED until this is true, so a webview that failed to load can never
    /// leave the app unclosable.
    pub close_guard_ready: AtomicBool,
    /// Millis-since-start of the last refused close, for the "ask twice and it
    /// goes through" escape hatch.
    pub last_close_attempt_ms: AtomicU64,
    /// Always-on rolling capture of operator input + engine state, so the Report
    /// button can freeze the last seconds of a visual complaint.
    pub recorder: crate::report::Recorder,
    /// Explicit long-form capture. Unlike the rolling feedback recorder this is
    /// unbounded by time and stores only replayable control metadata.
    pub performance_recording: Mutex<Option<ActivePerformanceRecording>>,
    pub started: Instant,
}

impl SharedState {
    pub fn new(config: AppConfig) -> Arc<Self> {
        let (events, _) = broadcast::channel(256);
        let (preview, _) = broadcast::channel(4);
        Arc::new(Self {
            config: RwLock::new(config),
            config_save: Mutex::new(()),
            config_epoch: AtomicU32::new(0),
            patch_epoch: AtomicU32::new(0),
            render_transition_epoch: AtomicU64::new(0),
            patch_params: Mutex::new(Vec::new()),
            effect_seq: AtomicU64::new(0),
            low_latency_render_seq: AtomicU64::new(0),
            effects: Mutex::new(Vec::new()),
            dabs: Mutex::new(Vec::new()),
            audio: Default::default(),
            scope: Default::default(),
            midi_clock: Mutex::new(crate::rhythm::MidiClockState::default()),
            pioneer_clock: Mutex::new(crate::rhythm::PioneerClockState::default()),
            pioneer_patch_events: Mutex::new(DjLinkPatchEvents::default()),
            pioneer_debug: Mutex::new(VecDeque::new()),
            pioneer_debug_seq: AtomicU64::new(1),
            pioneer_tracks: Mutex::new(HashMap::new()),
            control: Mutex::new(ControlInputs::default()),
            test: Mutex::new(crate::testmode::TestState::default()),
            game: Mutex::new(crate::game::GameControl::default()),
            last_discovery: Mutex::new(None),
            discovery_running: AtomicBool::new(false),
            status: Mutex::new(RuntimeStatus::default()),
            shutdown: AtomicBool::new(false),
            layer_phases: Mutex::new(Vec::new()),
            phases_transplanted: AtomicBool::new(false),
            sacn_hold: AtomicBool::new(false),
            server_bound: AtomicBool::new(false),
            leaving: AtomicBool::new(false),
            sacn_quiesced: AtomicBool::new(false),
            sacn_terminated: AtomicBool::new(false),
            sacn_sequence: AtomicU8::new(0),
            sacn_resume_pending: AtomicBool::new(false),
            sacn_resume_sequence: AtomicU8::new(0),
            frames_rendered: AtomicU64::new(0),
            update_check_requested: AtomicBool::new(false),
            update_install_requested: AtomicBool::new(false),
            headless: AtomicBool::new(false),
            video_cache: Mutex::new(HashMap::new()),
            preview_gate: Mutex::new(PreviewGate::default()),
            connected_clients: Mutex::new(HashMap::new()),
            conn_seq: AtomicU64::new(1),
            events,
            preview,
            video: Mutex::new(VideoInput::default()),
            focus_requested: AtomicBool::new(false),
            took_over_older: AtomicBool::new(false),
            close_confirmed: AtomicBool::new(false),
            close_guard_ready: AtomicBool::new(false),
            last_close_attempt_ms: AtomicU64::new(0),
            recorder: crate::report::Recorder::new(),
            performance_recording: Mutex::new(None),
            started: Instant::now(),
        })
    }

    /// True when the rig is actually being driven — the test for "is a show
    /// live" that gates destructive actions (closing the window, stopping
    /// output). Deliberately the transmitting state rather than "is the engine
    /// running": an app open with output off is not a show.
    pub fn output_live(&self) -> bool {
        self.config.read().output.enabled && !self.leaving.load(Ordering::SeqCst)
    }

    /// Arm or disarm hardware test mode.
    ///
    /// Arming is refused while the show scheduler is driving a playlist —
    /// commissioning patterns are open to every device on the LAN, and a phone
    /// must not be able to replace a running show with a single test pixel.
    /// Stopping the show first is a deliberate, separate action.
    ///
    /// This never touches `output.enabled` in either direction: whether the rig
    /// is being transmitted to is the operator's standing decision, not
    /// something a test should quietly change under them.
    pub fn set_test_mode(&self, active: bool) -> Result<(), String> {
        if active && let Some(playlist) = self.config.read().running_show() {
            return Err(format!(
                "\"{}\" is running on the show scheduler. Stop the show before entering test mode.",
                playlist.name
            ));
        }
        {
            let mut test = self.test.lock();
            if test.active == active {
                return Ok(());
            }
            test.active = active;
            // Patterns are a function of time since arming, so every session
            // starts at a known phase instead of mid-blink.
            test.started = Instant::now();
        }
        log::info!("test mode {}", if active { "ARMED" } else { "disarmed" });
        self.broadcast_state();
        Ok(())
    }

    /// Replace the live test parameters. Does not arm test mode — the tab's
    /// controls stay usable (and shared between devices) while disarmed.
    pub fn set_test_config(&self, cfg: crate::testmode::TestConfig) {
        {
            let mut test = self.test.lock();
            // Restart the clock when the auto-exit budget changes, so raising it
            // does not leave a deadline that already passed.
            if test.cfg.auto_exit_secs != cfg.auto_exit_secs {
                test.started = Instant::now();
            }
            test.cfg = cfg;
        }
        self.broadcast_state();
    }

    /// Start or stop a game (see plans/game-mode.md). Mirrors `set_test_mode`:
    /// starting is refused while the show scheduler is running a playlist —
    /// stopping the show first is a deliberate, separate action. (A future
    /// playlist *game cue* enters through the scheduler itself, not here, so
    /// this guard only ever applies to the manual path.) Never touches
    /// `output.enabled`. Stopping is always allowed; the engine crossfades out.
    pub fn set_game_mode(&self, game: Option<crate::game::GameKind>) -> Result<(), String> {
        if game.is_some() && let Some(playlist) = self.config.read().running_show() {
            return Err(format!(
                "\"{}\" is running on the show scheduler. Stop the show before starting a game.",
                playlist.name
            ));
        }
        {
            let mut g = self.game.lock();
            if g.active == game {
                return Ok(());
            }
            g.active = game;
            g.started = game.map(|_| Instant::now());
            g.inputs.clear();
        }
        match game {
            Some(kind) => log::info!("game mode: {} started", kind.label()),
            None => log::info!("game mode: stopped"),
        }
        self.broadcast_state();
        Ok(())
    }

    /// Live game parameters. Accepted while inactive too, so the Games tab's
    /// controls can be set up before anything reaches the array.
    pub fn set_game_config(&self, species: Option<u8>, effects_overlay: Option<bool>) {
        {
            let mut g = self.game.lock();
            if let Some(s) = species {
                // The union of every game's knob range; each sim clamps to its
                // own (rps 3–5, life/spokewar 2–8), and the UI slider carries
                // the per-game bounds.
                g.species = s.clamp(2, 8);
            }
            if let Some(o) = effects_overlay {
                g.effects_overlay = o;
            }
        }
        self.broadcast_state();
    }

    /// Queue player injections for the running game. Collaborative like
    /// `paint`: inputs from all clients merge, oldest dropped under flood.
    /// No active-game check here: a playlist game cue runs without touching
    /// `active`, and the engine drains this queue every frame regardless — an
    /// input with no game to land in simply evaporates.
    pub fn game_input(&self, species: u8, points: &[crate::layers::DabPoint]) {
        let mut g = self.game.lock();
        for p in points {
            if g.inputs.len() >= crate::game::MAX_QUEUED_INPUTS {
                g.inputs.remove(0);
            }
            g.inputs.push(crate::game::QueuedInput {
                angle: p.angle,
                radius: p.radius.clamp(0.0, 1.0),
                species,
            });
        }
    }

    /// One-shot: the operator has confirmed a close, so the next CloseRequested
    /// passes through. Cleared if they change their mind and keep working.
    pub fn confirm_close(&self) {
        self.close_confirmed.store(true, Ordering::SeqCst);
    }

    pub fn close_confirmed(&self) -> bool {
        self.close_confirmed.load(Ordering::SeqCst)
    }

    pub fn cancel_close(&self) {
        self.close_confirmed.store(false, Ordering::SeqCst);
    }

    pub fn set_close_guard_ready(&self, ready: bool) {
        self.close_guard_ready.store(ready, Ordering::SeqCst);
    }

    pub fn close_guard_ready(&self) -> bool {
        self.close_guard_ready.load(Ordering::SeqCst)
    }

    /// True when a close was already refused moments ago — the operator is
    /// pressing X again, so let it through. Costs one accidental double-tap
    /// versus the possibility of an app that cannot be closed at all.
    pub fn close_attempted_recently(&self) -> bool {
        const WINDOW_MS: u64 = 5_000;
        let now = self.started.elapsed().as_millis() as u64;
        let previous = self.last_close_attempt_ms.swap(now, Ordering::SeqCst);
        previous != 0 && now.saturating_sub(previous) < WINDOW_MS
    }

    pub fn bump_config(&self) {
        self.config_epoch.fetch_add(1, Ordering::SeqCst);
    }

    pub fn request_render_transition(&self) {
        self.render_transition_epoch.fetch_add(1, Ordering::SeqCst);
    }

    pub fn epoch(&self) -> u32 {
        self.config_epoch.load(Ordering::SeqCst)
    }

    pub fn push_pioneer_debug(
        &self,
        category: impl Into<String>,
        device: u8,
        summary: impl Into<String>,
        fields: BTreeMap<String, String>,
    ) {
        let entry = ProDjLinkDebugEntry {
            sequence: self.pioneer_debug_seq.fetch_add(1, Ordering::Relaxed),
            elapsed_ms: self.started.elapsed().as_millis() as u64,
            category: category.into(),
            device,
            summary: summary.into(),
            fields,
        };
        {
            let mut debug = self.pioneer_debug.lock();
            debug.push_back(entry.clone());
            while debug.len() > 400 {
                debug.pop_front();
            }
        }
        let _ = self.events.send(ServerMsg::ProDjLinkDebug { entry });
    }

    /// Mutate the config, persist it, and notify all clients with fresh state.
    pub fn update_config(&self, f: impl FnOnce(&mut AppConfig)) {
        let _save = self.config_save.lock();
        let snapshot = {
            let mut cfg = self.config.write();
            f(&mut cfg);
            cfg.clone()
        };
        let save_error = crate::config::save(&snapshot).err();
        if let Some(error) = &save_error {
            log::error!("failed to save config: {error}");
        }
        self.status.lock().config_error = save_error;
        self.bump_config();
        self.broadcast_state();
    }

    pub fn broadcast_state(&self) {
        let config = Box::new(self.config.read().clone());
        let status = self.status.lock().clone();
        let _ = self.events.send(ServerMsg::State { config, status });
    }

    /// Add live-draw dabs; the oldest are evicted when the buffer is full so a
    /// crowd drawing at once degrades gracefully instead of erroring.
    pub fn paint(
        &self,
        kind: crate::layers::PenKind,
        points: &[crate::layers::DabPoint],
        hue: f32,
        saturation: f32,
        brightness: f32,
        size: f32,
        intensity: f32,
    ) {
        let mut dabs = self.dabs.lock();
        // Retain only the newest bounded batch and evict old dabs once. Repeated
        // Vec::remove(0) made a single oversized paint packet quadratic work on
        // the engine machine.
        let points = &points[points.len().saturating_sub(crate::layers::MAX_DABS)..];
        let overflow = dabs
            .len()
            .saturating_add(points.len())
            .saturating_sub(crate::layers::MAX_DABS);
        if overflow > 0 {
            let remove = overflow.min(dabs.len());
            dabs.drain(..remove);
        }
        for p in points {
            dabs.push(ActiveDab {
                kind,
                angle: p.angle,
                radius: p.radius.clamp(0.0, 1.2),
                hue,
                saturation: saturation.clamp(0.0, 1.0),
                brightness: brightness.clamp(0.0, 1.0),
                size: size.clamp(0.01, 1.0),
                intensity: intensity.clamp(0.0, 2.0),
                dir: p.dir,
                born: Instant::now(),
            });
        }
    }

    pub fn trigger_effect(&self, cfg: EffectCfg) {
        self.effect_seq.fetch_add(1, Ordering::Relaxed);
        let mut effects = self.effects.lock();
        // Cap active effects; drop the oldest if the floor is spamming taps.
        if effects.len() >= crate::layers::MAX_EFFECTS {
            effects.remove(0);
        }
        effects.push(ActiveEffect {
            cfg,
            born: Instant::now(),
        });
    }

    pub fn start_video(&self, conn_id: u64, owner_id: &str, title: String, source_url: String) {
        let mut v = self.video.lock();
        v.active = true;
        v.owner_conn_id = conn_id;
        v.owner_id = owner_id.to_owned();
        v.title = title.chars().take(160).collect();
        v.source_url = source_url.chars().take(2048).collect();
        v.width = 0;
        v.height = 0;
        v.rgba.clear();
        v.frames = 0;
        v.fps = 0.0;
        v.last_frame = None;
        v.revision = v.revision.wrapping_add(1);
    }

    /// Stop the current source, returning whether this caller actually owned (or
    /// force-stopped) it. The return value lets the server clear soundtrack data
    /// without a stale disconnect blanking the new owner's beat source.
    pub fn stop_video(&self, conn_id: Option<u64>) -> bool {
        let mut v = self.video.lock();
        if conn_id.is_some_and(|id| id != v.owner_conn_id) {
            return false;
        }
        v.active = false;
        v.owner_conn_id = 0;
        v.width = 0;
        v.height = 0;
        v.rgba.clear();
        v.fps = 0.0;
        v.last_frame = None;
        v.revision = v.revision.wrapping_add(1);
        true
    }

    pub fn push_video_frame(&self, conn_id: u64, width: u16, height: u16, rgba: &[u8]) -> bool {
        let expected = width as usize * height as usize * 4;
        if width == 0
            || height == 0
            || width > crate::protocol::MAX_VIDEO_DIMENSION
            || height > crate::protocol::MAX_VIDEO_DIMENSION
            || rgba.len() != expected
        {
            return false;
        }
        let mut v = self.video.lock();
        if !v.active || v.owner_conn_id != conn_id {
            return false;
        }
        let now = Instant::now();
        if let Some(last) = v.last_frame {
            let instant_fps = 1.0 / now.duration_since(last).as_secs_f32().max(0.001);
            v.fps = if v.fps == 0.0 {
                instant_fps
            } else {
                v.fps * 0.85 + instant_fps * 0.15
            };
        }
        v.last_frame = Some(now);
        v.width = width;
        v.height = height;
        v.rgba.clear();
        v.rgba.extend_from_slice(rgba);
        v.frames += 1;
        v.revision = v.revision.wrapping_add(1);
        true
    }
}
