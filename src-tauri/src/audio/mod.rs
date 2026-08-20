//! Audio capture and analysis. Multiple sources run in parallel: local cpal devices
//! (with per-source channel selection, so one multichannel interface can feed several
//! sources) and remote browser microphones (feature packets over WebSocket).
//!
//! cpal streams are !Send on some platforms, so a dedicated thread owns all local
//! streams; it tears everything down and rebuilds when the config epoch changes.

pub mod analysis;

use crate::config::AudioSourceKind;
use crate::layers::MAX_AUDIO_SOURCES;
use crate::protocol::ServerMsg;
use crate::state::SharedState;
use analysis::{BeatTracker, FeatureExtractor, HOP_SIZE};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

/// Per-source analysis chain; shared with the stream callback for device sources or
/// fed by the WS server for remote sources.
pub struct AnalysisChain {
    pub extractor: Option<FeatureExtractor>,
    pub tracker: BeatTracker,
    pub gain: f32,
    pub source_index: usize,
}

impl AnalysisChain {
    /// Feed one hop worth of precomputed features (remote sources).
    pub fn feed_remote(
        &mut self,
        state: &SharedState,
        level: f32,
        bass: f32,
        mid: f32,
        treble: f32,
        flux: f32,
    ) {
        let beat = self.tracker.feed(flux);
        publish(state, self.source_index, level, bass, mid, treble, &self.tracker);
        if beat {
            let _ = state.events.send(ServerMsg::Beat {
                source: self.source_index as u32,
                bpm: self.tracker.bpm(),
            });
        }
    }
}

fn publish(
    state: &SharedState,
    index: usize,
    level: f32,
    bass: f32,
    mid: f32,
    treble: f32,
    tracker: &BeatTracker,
) {
    if index >= MAX_AUDIO_SOURCES {
        return;
    }
    let mut slot = state.audio[index].lock();
    slot.active = true;
    slot.health = HEALTH_OK;
    slot.level = level;
    slot.bass = bass;
    slot.mid = mid;
    slot.treble = treble;
    // ~0.25 s EMA at the ~43 Hz hop rate: the MilkDrop-style "attenuated" twins.
    const K: f32 = 0.09;
    slot.bass_att += (bass - slot.bass_att) * K;
    slot.mid_att += (mid - slot.mid_att) * K;
    slot.treble_att += (treble - slot.treble_att) * K;
    slot.onset = tracker.onset;
    slot.beat_phase = tracker.beat_phase;
    slot.bpm = tracker.bpm();
}

/// Registry of remote-source chains, keyed by the announced client id.
/// The WS server looks up a chain when AudioFrame packets arrive.
pub type RemoteChains = Arc<Mutex<Vec<(String, Mutex<AnalysisChain>)>>>;

pub fn spawn(state: Arc<SharedState>) -> RemoteChains {
    let remote: RemoteChains = Arc::new(Mutex::new(Vec::new()));
    let remote2 = remote.clone();
    std::thread::Builder::new()
        .name("audio".into())
        .spawn(move || audio_thread(state, remote2))
        .expect("spawn audio thread");
    remote
}

/// A device-backed source's live capture state. The audio thread owns these and
/// keeps them healthy: a missing or vanished device is retried quietly (targeting
/// ONLY the configured device — never substituting another), and "system default"
/// sources follow the OS default when Windows changes it. The show never dies for
/// lack of audio hardware; a silent source just means calm visuals.
struct DeviceRuntime {
    index: usize,
    id: String,
    device: Option<String>,
    channels: Vec<u32>,
    loopback: bool,
    gain: f32,
    stream: Option<cpal::Stream>,
    /// The endpoint the running stream was actually built on (for default-follow).
    resolved: String,
    /// Millis (since app start) of the last data callback; watchdog input.
    last_data: Arc<std::sync::atomic::AtomicU64>,
    /// Set by the stream error callback on fatal device loss.
    dead: Arc<std::sync::atomic::AtomicBool>,
    last_attempt: std::time::Instant,
    /// Log the "missing" message once per outage, and "recovered" once on return.
    reported_down: bool,
}

/// Health codes stored in `AudioFeatures::health` (see protocol `detail`).
pub const HEALTH_OK: u8 = 0;
pub const HEALTH_WAITING: u8 = 1;

const RETRY_EVERY: Duration = Duration::from_secs(2);
const WATCHDOG_STALL: Duration = Duration::from_secs(3);

fn audio_thread(state: Arc<SharedState>, remote: RemoteChains) {
    // Rebuild capture streams only when the AUDIO config actually changes — the
    // config epoch also bumps for unrelated tweaks (brightness sliders, layers)
    // and tearing down device streams for those would be wasteful and glitchy.
    let mut last_cfg = String::new();
    let mut runtimes: Vec<DeviceRuntime> = Vec::new();
    let mut last_device_scan = std::time::Instant::now() - Duration::from_secs(60);

    while !state.shutdown.load(Ordering::Relaxed) {
        let cfg = serde_json::to_string(&state.config.read().audio).unwrap_or_default();
        if cfg != last_cfg {
            last_cfg = cfg;
            runtimes = build_sources(&state, &remote);
            last_device_scan = std::time::Instant::now();
            refresh_device_lists(&state);
        }

        // Refresh the pickable-device lists periodically so hot-plugged hardware
        // shows up in the settings UI without a config touch.
        if last_device_scan.elapsed() > Duration::from_secs(3) {
            last_device_scan = std::time::Instant::now();
            refresh_device_lists(&state);
        }

        for rt in runtimes.iter_mut() {
            maintain(&state, rt);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn refresh_device_lists(state: &Arc<SharedState>) {
    let host = cpal::default_host();
    let input_devices = list_input_devices();
    let output_devices = list_output_devices();
    let din = host
        .default_input_device()
        .and_then(|d| d.default_input_config().ok())
        .map(|c| c.channels())
        .unwrap_or(0);
    let dout = host
        .default_output_device()
        .and_then(|d| d.default_output_config().ok())
        .map(|c| c.channels())
        .unwrap_or(0);
    let mut status = state.status.lock();
    status.input_devices = input_devices;
    status.output_devices = output_devices;
    status.default_input_channels = din;
    status.default_output_channels = dout;
}

/// Name of the endpoint a source with `device: None` would bind right now.
fn current_default_name(loopback: bool) -> Option<String> {
    let host = cpal::default_host();
    let dev = if loopback {
        host.default_output_device()
    } else {
        host.default_input_device()
    }?;
    dev.description().ok().map(|d| d.name().to_string())
}

/// Mark a source silent (device gone): visuals should decay to quiet, not freeze
/// on the last captured values.
fn silence_slot(state: &SharedState, index: usize) {
    if index >= MAX_AUDIO_SOURCES {
        return;
    }
    *state.audio[index].lock() = crate::state::AudioFeatures {
        active: false,
        health: HEALTH_WAITING,
        ..Default::default()
    };
    *state.scope[index].lock() = Default::default();
}

/// Keep one device source healthy: watchdog a running stream, follow the OS
/// default when configured for it, and quietly retry a missing device.
fn maintain(state: &Arc<SharedState>, rt: &mut DeviceRuntime) {
    let now_ms = state.started.elapsed().as_millis() as u64;

    if rt.stream.is_some() {
        let stalled = now_ms.saturating_sub(rt.last_data.load(Ordering::Relaxed))
            > WATCHDOG_STALL.as_millis() as u64;
        let dead = rt.dead.load(Ordering::Relaxed);
        if dead || stalled {
            rt.stream = None; // drop = release the endpoint
            silence_slot(state, rt.index);
            if !rt.reported_down {
                rt.reported_down = true;
                log::warn!(
                    "audio source '{}': device '{}' {} — waiting for it to return \
                     (will not switch to another device)",
                    rt.id,
                    rt.resolved,
                    if dead { "was lost" } else { "stopped delivering data" }
                );
            }
            return;
        }

        // The ONE permitted automatic change: a "system default" source follows
        // the OS default device, because that is what "default" means.
        if rt.device.is_none() && rt.last_attempt.elapsed() > RETRY_EVERY {
            rt.last_attempt = std::time::Instant::now();
            if let Some(current) = current_default_name(rt.loopback) {
                if current != rt.resolved {
                    log::info!(
                        "audio source '{}': OS default changed '{}' -> '{}'; following",
                        rt.id,
                        rt.resolved,
                        current
                    );
                    rt.stream = None;
                    silence_slot(state, rt.index);
                    // Fall through to the rebuild path below on the next tick.
                }
            }
        }
        return;
    }

    // No stream: retry the configured device, quietly, forever.
    if rt.last_attempt.elapsed() < RETRY_EVERY {
        return;
    }
    rt.last_attempt = std::time::Instant::now();
    rt.dead.store(false, Ordering::Relaxed);
    match build_device_stream(
        state.clone(),
        rt.index,
        rt.device.as_deref(),
        &rt.channels,
        rt.loopback,
        rt.gain,
        rt.last_data.clone(),
        rt.dead.clone(),
    ) {
        Ok((stream, resolved)) => {
            rt.last_data.store(now_ms, Ordering::Relaxed);
            rt.resolved = resolved;
            rt.stream = Some(stream);
            if rt.reported_down {
                log::info!("audio source '{}': device '{}' is back", rt.id, rt.resolved);
            }
            rt.reported_down = false;
        }
        Err(e) => {
            silence_slot(state, rt.index);
            if !rt.reported_down {
                rt.reported_down = true;
                log::warn!(
                    "audio source '{}': {e:#} — waiting for the device (retrying quietly)",
                    rt.id
                );
            }
        }
    }
}

fn build_sources(state: &Arc<SharedState>, remote: &RemoteChains) -> Vec<DeviceRuntime> {
    let sources = state.config.read().audio.sources.clone();
    let mut new_remote = Vec::new();
    let mut runtimes = Vec::new();

    // Clear all slots first; runtimes re-activate theirs as streams come up.
    for slot in state.audio.iter() {
        slot.lock().active = false;
    }

    for (index, src) in sources.iter().take(MAX_AUDIO_SOURCES).enumerate() {
        match &src.kind {
            AudioSourceKind::Remote { client_id } => {
                // Hop cadence for remote packets is set by the client (~46 Hz at 48k/1024);
                // the tracker just needs a nominal dt.
                let chain = AnalysisChain {
                    extractor: None,
                    tracker: BeatTracker::new(1024.0 / 48000.0),
                    gain: src.gain,
                    source_index: index,
                };
                new_remote.push((client_id.clone(), Mutex::new(chain)));
            }
            AudioSourceKind::Device {
                device,
                channels,
                loopback,
            } => {
                // Streams are built (and rebuilt) by `maintain`; starting with no
                // stream means the first tick handles present and missing devices
                // through one code path.
                runtimes.push(DeviceRuntime {
                    index,
                    id: src.id.clone(),
                    device: device.clone(),
                    channels: channels.clone(),
                    loopback: *loopback,
                    gain: src.gain,
                    stream: None,
                    resolved: String::new(),
                    last_data: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                    dead: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                    last_attempt: std::time::Instant::now() - RETRY_EVERY,
                    reported_down: false,
                });
            }
        }
    }
    *remote.lock() = new_remote;
    runtimes
}

#[allow(clippy::too_many_arguments)]
fn build_device_stream(
    state: Arc<SharedState>,
    index: usize,
    device_name: Option<&str>,
    channels: &[u32],
    loopback: bool,
    gain: f32,
    last_data: Arc<std::sync::atomic::AtomicU64>,
    dead: Arc<std::sync::atomic::AtomicBool>,
) -> anyhow::Result<(cpal::Stream, String)> {
    let host = cpal::default_host();
    // Loopback: capture what an OUTPUT device is playing. On WASAPI, building an
    // input stream on an output device transparently enables loopback mode.
    let device = match (device_name, loopback) {
        (None, false) => host
            .default_input_device()
            .ok_or_else(|| anyhow::anyhow!("no default input device"))?,
        (None, true) => host
            .default_output_device()
            .ok_or_else(|| anyhow::anyhow!("no default output device"))?,
        (Some(name), false) => host
            .input_devices()?
            .find(|d| d.description().map(|d| d.name() == name).unwrap_or(false))
            .ok_or_else(|| anyhow::anyhow!("input device '{name}' not found"))?,
        (Some(name), true) => host
            .output_devices()?
            .find(|d| d.description().map(|d| d.name() == name).unwrap_or(false))
            .ok_or_else(|| anyhow::anyhow!("output device '{name}' not found"))?,
    };
    let config = if loopback {
        device.default_output_config()?
    } else {
        device.default_input_config()?
    };
    let sample_rate = config.sample_rate() as f32;
    let n_channels = config.channels() as usize;
    let mut selected: Vec<usize> = if channels.is_empty() {
        (0..n_channels).collect()
    } else {
        channels
            .iter()
            .map(|c| *c as usize)
            .filter(|c| *c < n_channels)
            .collect()
    };
    // Recover, don't refuse: a bad channel list (e.g. 1-based entry, or numbers
    // beyond the device) falls back to all channels with a warning — a show tool
    // must keep making sound-reactive light, not die on a typo.
    if selected.is_empty() {
        log::warn!(
            "audio source {index}: channel selection {channels:?} matches none of the \
             device's {n_channels} channels (they are 0-based); using all channels"
        );
        selected = (0..n_channels).collect();
    }

    let mut extractor = FeatureExtractor::new(sample_rate);
    let mut tracker = BeatTracker::new(HOP_SIZE as f32 / sample_rate);
    let mut mono = Vec::with_capacity(4096);
    let mut wave_ring = [0.0f32; 256];
    let mut wave_cursor: usize = 0;
    let state_cb = state.clone();

    let started = state.started;
    let stream = device.build_input_stream(
        config.into(),
        move |data: &[f32], _| {
            last_data.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
            mono.clear();
            for frame in data.chunks_exact(n_channels) {
                let mut acc = 0.0f32;
                for &c in &selected {
                    acc += frame[c];
                }
                mono.push(acc / selected.len() as f32 * gain);
            }

            // Ring-oscilloscope waveform for the GPU: decimate into a 256-sample
            // ring, snapshot (oldest-first) into shared state once per callback.
            let decim = (sample_rate / 12_000.0).max(1.0) as usize;
            for s in mono.iter().step_by(decim) {
                wave_ring[wave_cursor] = *s;
                wave_cursor = (wave_cursor + 1) % wave_ring.len();
            }
            {
                let mut scope = state_cb.scope[index].lock();
                for (i, dst) in scope.wave.iter_mut().enumerate() {
                    *dst = wave_ring[(wave_cursor + i) % wave_ring.len()];
                }
            }

            extractor.feed(&mono, |h| {
                let beat = tracker.feed(h.flux);
                publish(&state_cb, index, h.level, h.bass, h.mid, h.treble, &tracker);
                state_cb.scope[index].lock().spectrum = h.spectrum;
                if beat {
                    let _ = state_cb.events.send(ServerMsg::Beat {
                        source: index as u32,
                        bpm: tracker.bpm(),
                    });
                }
            });
        },
        {
            // Fatal device loss flips the dead flag (the watchdog rebuilds);
            // transient underruns come in bursts, so log-throttle those.
            let mut errors: u64 = 0;
            move |err| {
                if err.kind() == cpal::ErrorKind::DeviceNotAvailable {
                    dead.store(true, Ordering::Relaxed);
                    return;
                }
                errors += 1;
                if errors.is_power_of_two() {
                    log::warn!("audio stream error ({errors} total): {err}");
                }
            }
        },
        None,
    )?;
    stream.play()?;
    let name = device
        .description()
        .map(|d| d.name().to_string())
        .unwrap_or_default();
    let mode = if loopback { "loopback of" } else { "capturing" };
    log::info!("audio source {index}: {mode} '{name}' @ {sample_rate} Hz, {n_channels} ch");
    Ok((stream, name))
}

/// List available input devices (with channel counts) for the settings UI.
pub fn list_input_devices() -> Vec<crate::protocol::DeviceInfo> {
    let host = cpal::default_host();
    match host.input_devices() {
        Ok(devices) => devices
            .filter_map(|d| {
                let name = d.description().ok()?.name().to_string();
                let channels = d.default_input_config().map(|c| c.channels()).unwrap_or(0);
                Some(crate::protocol::DeviceInfo { name, channels })
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// List output devices — selectable as loopback beat sources (play music locally).
pub fn list_output_devices() -> Vec<crate::protocol::DeviceInfo> {
    let host = cpal::default_host();
    match host.output_devices() {
        Ok(devices) => devices
            .filter_map(|d| {
                let name = d.description().ok()?.name().to_string();
                let channels = d.default_output_config().map(|c| c.channels()).unwrap_or(0);
                Some(crate::protocol::DeviceInfo { name, channels })
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}
