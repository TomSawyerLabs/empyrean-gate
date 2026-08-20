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
    slot.level = level;
    slot.bass = bass;
    slot.mid = mid;
    slot.treble = treble;
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

fn audio_thread(state: Arc<SharedState>, remote: RemoteChains) {
    // Rebuild capture streams only when the AUDIO config actually changes — the
    // config epoch also bumps for unrelated tweaks (brightness sliders, layers)
    // and tearing down device streams for those would be wasteful and glitchy.
    let mut last_cfg = String::new();
    let mut streams: Vec<cpal::Stream> = Vec::new();

    while !state.shutdown.load(Ordering::Relaxed) {
        let cfg = serde_json::to_string(&state.config.read().audio).unwrap_or_default();
        if cfg != last_cfg {
            last_cfg = cfg;
            streams.clear(); // drop = stop capture
            for slot in state.audio.iter() {
                slot.lock().active = false;
            }
            build_sources(&state, &remote, &mut streams);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn build_sources(state: &Arc<SharedState>, remote: &RemoteChains, streams: &mut Vec<cpal::Stream>) {
    {
        let mut status = state.status.lock();
        status.input_devices = list_input_devices();
        status.output_devices = list_output_devices();
    }
    let sources = state.config.read().audio.sources.clone();
    let mut new_remote = Vec::new();

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
                match build_device_stream(
                    state.clone(),
                    index,
                    device.as_deref(),
                    channels,
                    *loopback,
                    src.gain,
                ) {
                    Ok(stream) => streams.push(stream),
                    Err(e) => {
                        log::error!("audio source '{}': {e:#}", src.id);
                        let _ = state.events.send(ServerMsg::Error {
                            message: format!("Audio source '{}': {e:#}", src.id),
                        });
                    }
                }
            }
        }
    }
    *remote.lock() = new_remote;
}

fn build_device_stream(
    state: Arc<SharedState>,
    index: usize,
    device_name: Option<&str>,
    channels: &[u32],
    loopback: bool,
    gain: f32,
) -> anyhow::Result<cpal::Stream> {
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
    let state_cb = state.clone();

    let stream = device.build_input_stream(
        config.into(),
        move |data: &[f32], _| {
            mono.clear();
            for frame in data.chunks_exact(n_channels) {
                let mut acc = 0.0f32;
                for &c in &selected {
                    acc += frame[c];
                }
                mono.push(acc / selected.len() as f32 * gain);
            }
            extractor.feed(&mono, |h| {
                let beat = tracker.feed(h.flux);
                publish(&state_cb, index, h.level, h.bass, h.mid, h.treble, &tracker);
                if beat {
                    let _ = state_cb.events.send(ServerMsg::Beat {
                        source: index as u32,
                        bpm: tracker.bpm(),
                    });
                }
            });
        },
        {
            // Underruns come in bursts (system sleep, load spikes); log-throttle.
            let mut errors: u64 = 0;
            move |err| {
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
    Ok(stream)
}

/// List available input devices for the settings UI.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    match host.input_devices() {
        Ok(devices) => devices
            .filter_map(|d| d.description().ok().map(|d| d.name().to_string()))
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// List output devices — selectable as loopback beat sources (play music locally).
pub fn list_output_devices() -> Vec<String> {
    let host = cpal::default_host();
    match host.output_devices() {
        Ok(devices) => devices
            .filter_map(|d| d.description().ok().map(|d| d.name().to_string()))
            .collect(),
        Err(_) => Vec::new(),
    }
}
