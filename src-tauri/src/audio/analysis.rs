//! Audio feature extraction and beat tracking, shared by local cpal sources and
//! remote (browser microphone) sources.
//!
//! Local chain: mono samples -> windowed FFT (2048 @ hop 1024) -> band energies +
//! rectified spectral flux -> `BeatTracker`.
//! Remote chain: the browser computes level/bands/flux itself and streams packets;
//! the same `BeatTracker` runs on the received flux, so beat/tempo behavior is
//! identical for both kinds of source.

use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};
use std::collections::VecDeque;
use std::sync::Arc;

pub const FFT_SIZE: usize = 2048;
pub const HOP_SIZE: usize = 1024;

/// Output of one analysis hop.
#[derive(Debug, Clone, Copy, Default)]
pub struct HopFeatures {
    pub level: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub flux: f32,
}

pub struct FeatureExtractor {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    buffer: VecDeque<f32>,
    prev_mag: Vec<f32>,
    scratch: Vec<Complex32>,
    sample_rate: f32,
    /// Slow AGC so band outputs sit near 0..1 regardless of input gain.
    agc: BandAgc,
}

struct BandAgc {
    peaks: [f32; 4],
}

impl BandAgc {
    fn normalize(&mut self, values: [f32; 4]) -> [f32; 4] {
        let mut out = [0.0; 4];
        for i in 0..4 {
            let p = &mut self.peaks[i];
            // Fast attack, ~8 s release.
            if values[i] > *p {
                *p = values[i];
            } else {
                *p *= 0.9997;
            }
            *p = p.max(1e-4);
            out[i] = (values[i] / *p).clamp(0.0, 1.0);
        }
        out
    }
}

impl FeatureExtractor {
    pub fn new(sample_rate: f32) -> Self {
        let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
        let window = (0..FFT_SIZE)
            .map(|i| {
                let t = i as f32 / (FFT_SIZE - 1) as f32;
                0.5 - 0.5 * (std::f32::consts::TAU * t).cos()
            })
            .collect();
        Self {
            fft,
            window,
            buffer: VecDeque::with_capacity(FFT_SIZE * 2),
            prev_mag: vec![0.0; FFT_SIZE / 2],
            scratch: vec![Complex32::default(); FFT_SIZE],
            sample_rate,
            agc: BandAgc { peaks: [1e-4; 4] },
        }
    }

    /// Push mono samples; returns one `HopFeatures` per completed hop.
    pub fn feed(&mut self, samples: &[f32], mut on_hop: impl FnMut(HopFeatures)) {
        self.buffer.extend(samples.iter().copied());
        while self.buffer.len() >= FFT_SIZE {
            let feats = self.process_frame();
            on_hop(feats);
            self.buffer.drain(..HOP_SIZE);
        }
    }

    fn process_frame(&mut self) -> HopFeatures {
        let mut rms = 0.0f32;
        for (i, s) in self.buffer.iter().take(FFT_SIZE).enumerate() {
            rms += s * s;
            self.scratch[i] = Complex32::new(s * self.window[i], 0.0);
        }
        rms = (rms / FFT_SIZE as f32).sqrt();
        self.fft.process(&mut self.scratch);

        let bin_hz = self.sample_rate / FFT_SIZE as f32;
        let band = |lo: f32, hi: f32, mags: &[f32]| -> f32 {
            let a = (lo / bin_hz) as usize;
            let b = ((hi / bin_hz) as usize).min(mags.len() - 1);
            if b <= a {
                return 0.0;
            }
            mags[a..=b].iter().sum::<f32>() / (b - a + 1) as f32
        };

        let mut flux = 0.0f32;
        let mut mags = vec![0.0f32; FFT_SIZE / 2];
        for i in 0..FFT_SIZE / 2 {
            let m = self.scratch[i].norm() / FFT_SIZE as f32;
            mags[i] = m;
            let d = m - self.prev_mag[i];
            if d > 0.0 {
                flux += d;
            }
            self.prev_mag[i] = m;
        }

        let bass = band(20.0, 150.0, &mags);
        let mid = band(150.0, 2000.0, &mags);
        let treble = band(2000.0, 8000.0, &mags);
        let [level, bass, mid, treble] = self.agc.normalize([rms, bass, mid, treble]);

        HopFeatures {
            level,
            bass,
            mid,
            treble,
            flux,
        }
    }
}

/// Onset detection + tempo estimation + beat phase, fed a flux sample per hop.
pub struct BeatTracker {
    /// Seconds between flux samples (hop period).
    dt: f32,
    env: VecDeque<f32>,
    env_capacity: usize,
    flux_peak: f32,
    time: f64,
    bpm: f32,
    last_beat: f64,
    next_beat: f64,
    since_retempo: f32,
    recent_onsets: Vec<f64>,
    pub onset: f32,
    pub beat_phase: f32,
}

const MIN_BPM: f32 = 60.0;
const MAX_BPM: f32 = 190.0;

impl BeatTracker {
    pub fn new(dt: f32) -> Self {
        let env_capacity = (8.0 / dt).ceil() as usize;
        Self {
            dt,
            env: VecDeque::with_capacity(env_capacity),
            env_capacity,
            flux_peak: 1e-4,
            time: 0.0,
            bpm: 0.0,
            last_beat: 0.0,
            next_beat: f64::MAX,
            since_retempo: 0.0,
            recent_onsets: Vec::with_capacity(64),
            onset: 0.0,
            beat_phase: 0.0,
        }
    }

    /// Returns true when this hop lands on a beat.
    pub fn feed(&mut self, flux: f32) -> bool {
        self.time += self.dt as f64;

        // Normalize flux against a slowly-decaying peak.
        if flux > self.flux_peak {
            self.flux_peak = flux;
        } else {
            self.flux_peak *= 0.9995;
        }
        let norm = (flux / self.flux_peak.max(1e-4)).clamp(0.0, 1.5);

        if self.env.len() == self.env_capacity {
            self.env.pop_front();
        }
        self.env.push_back(norm);

        // Onset: flux above a moving mean + margin, with a refractory period.
        let recent = 20.min(self.env.len());
        let mean: f32 = self.env.iter().rev().take(recent).sum::<f32>() / recent.max(1) as f32;
        let is_onset = norm > mean + 0.25 && (self.time - self.last_onset_time()) > 0.12;
        if is_onset {
            self.onset = 1.0;
            self.onset_times_push(self.time);
        } else {
            self.onset *= (-self.dt / 0.15).exp();
        }

        self.since_retempo += self.dt;
        if self.since_retempo > 1.0 && self.env.len() > self.env_capacity / 2 {
            self.since_retempo = 0.0;
            self.estimate_tempo();
        }

        // Beat phase: run a predicted beat clock, resynced by onsets near the prediction.
        let mut beat_now = false;
        if self.bpm > 0.0 {
            let period = 60.0 / self.bpm as f64;
            if self.next_beat == f64::MAX {
                self.next_beat = self.time;
            }
            if is_onset && (self.time - self.next_beat).abs() < period * 0.2 {
                // Onset close to prediction: lock to it.
                self.next_beat = self.time;
            }
            if self.time >= self.next_beat {
                self.last_beat = self.next_beat;
                self.next_beat += period;
                beat_now = true;
            }
            self.beat_phase = (((self.time - self.last_beat) / period) as f32).clamp(0.0, 1.0);
        } else {
            self.beat_phase = 0.0;
        }
        beat_now
    }

    pub fn bpm(&self) -> f32 {
        self.bpm
    }

    fn last_onset_time(&self) -> f64 {
        self.recent_onsets.last().copied().unwrap_or(f64::MIN)
    }

    fn onset_times_push(&mut self, t: f64) {
        self.recent_onsets.push(t);
        if self.recent_onsets.len() > 64 {
            self.recent_onsets.remove(0);
        }
    }

    /// Autocorrelation of the onset envelope over lags in the 60..190 BPM range.
    fn estimate_tempo(&mut self) {
        let env: Vec<f32> = self.env.iter().copied().collect();
        let n = env.len();
        let mean = env.iter().sum::<f32>() / n as f32;
        let lag_min = (60.0 / MAX_BPM / self.dt) as usize;
        let lag_max = ((60.0 / MIN_BPM / self.dt) as usize).min(n / 2);
        if lag_max <= lag_min {
            return;
        }
        let mut best_lag = 0usize;
        let mut best = 0.0f32;
        for lag in lag_min..=lag_max {
            let mut acc = 0.0f32;
            for i in lag..n {
                acc += (env[i] - mean) * (env[i - lag] - mean);
            }
            // Slight preference for faster tempos (shorter lags) to avoid half-time locks.
            let score = acc / (n - lag) as f32 * (1.0 + 0.1 * (lag_min as f32 / lag as f32));
            if score > best {
                best = score;
                best_lag = lag;
            }
        }
        if best_lag > 0 && best > 0.0 {
            let new_bpm = 60.0 / (best_lag as f32 * self.dt);
            // Smooth tempo changes unless it's the first estimate.
            self.bpm = if self.bpm == 0.0 {
                new_bpm
            } else {
                self.bpm * 0.8 + new_bpm * 0.2
            };
        }
    }
}
