//! Audio analysis shared by the gate and the browser playground.
//!
//! [`analysis`] is the gate's feature extractor and beat tracker, unchanged.
//! [`AudioChain`] wires them the way the gate's local device sources do
//! (`src-tauri/src/audio/mod.rs`: `build_device_stream` and `publish`) for a
//! host that only has mono samples — the browser's microphone — producing the
//! same [`AudioUniform`] record and SCOPE data the patch shader reads.

pub mod analysis;

use crate::abi::{AudioUniform, SCOPE_FLOATS, SCOPE_SPECTRUM, SCOPE_WAVE};
use analysis::{BeatTracker, FeatureExtractor, HOP_SIZE, SPECTRUM_BINS};

const _: () = assert!(SPECTRUM_BINS == SCOPE_SPECTRUM);

/// One mono source: samples in, audio features and scope out.
pub struct AudioChain {
    extractor: FeatureExtractor,
    tracker: BeatTracker,
    decim: usize,
    wave_ring: [f32; SCOPE_WAVE],
    wave_cursor: usize,
    features: AudioUniform,
    spectrum: [f32; SCOPE_SPECTRUM],
}

impl AudioChain {
    pub fn new(sample_rate: f32) -> Self {
        let sample_rate = sample_rate.max(8_000.0);
        Self {
            extractor: FeatureExtractor::new(sample_rate),
            tracker: BeatTracker::new(HOP_SIZE as f32 / sample_rate),
            decim: (sample_rate / 12_000.0).max(1.0) as usize,
            wave_ring: [0.0; SCOPE_WAVE],
            wave_cursor: 0,
            features: AudioUniform::default(),
            spectrum: [0.0; SCOPE_SPECTRUM],
        }
    }

    /// Feed mono samples (any block size). Returns whether at least one
    /// analysis hop completed.
    pub fn feed(&mut self, mono: &[f32]) -> bool {
        // Ring-oscilloscope waveform for the GPU, decimated to ~12 kHz.
        for s in mono.iter().step_by(self.decim) {
            self.wave_ring[self.wave_cursor] = *s;
            self.wave_cursor = (self.wave_cursor + 1) % SCOPE_WAVE;
        }
        let mut hopped = false;
        let Self {
            extractor,
            tracker,
            features: f,
            spectrum,
            ..
        } = self;
        extractor.feed(mono, |h| {
            hopped = true;
            tracker.feed(h.flux);
            f.level = h.level;
            f.bass = h.bass;
            f.mid = h.mid;
            f.treble = h.treble;
            // ~0.25 s EMA at the ~43 Hz hop rate: the MilkDrop-style
            // "attenuated" twins.
            const K: f32 = 0.09;
            f.bass_att += (h.bass - f.bass_att) * K;
            f.mid_att += (h.mid - f.mid_att) * K;
            f.treble_att += (h.treble - f.treble_att) * K;
            f.onset = tracker.onset;
            f.beat_phase = tracker.beat_phase;
            f.bpm = tracker.bpm();
            f.bpm_conf = tracker.confidence;
            *spectrum = h.spectrum;
        });
        hopped
    }

    /// The source's record for binding 1.
    pub fn features(&self) -> AudioUniform {
        self.features
    }

    /// This source's slice of the SCOPE buffer: the waveform ring oldest
    /// sample first, then the spectrum.
    pub fn scope(&self) -> [f32; SCOPE_FLOATS] {
        let mut out = [0.0; SCOPE_FLOATS];
        for (i, dst) in out[..SCOPE_WAVE].iter_mut().enumerate() {
            *dst = self.wave_ring[(self.wave_cursor + i) % SCOPE_WAVE];
        }
        out[SCOPE_WAVE..].copy_from_slice(&self.spectrum);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_steady_kick_finds_a_tempo() {
        let rate = 48_000.0;
        let mut chain = AudioChain::new(rate);
        // 120 BPM: a short decaying 60 Hz burst every 0.5 s, for 12 s.
        let total = (rate * 12.0) as usize;
        let samples: Vec<f32> = (0..total)
            .map(|n| {
                let t = n as f32 / rate;
                let since = t % 0.5;
                (std::f32::consts::TAU * 60.0 * t).sin() * (-since * 30.0).exp()
            })
            .collect();
        for block in samples.chunks(128) {
            chain.feed(block);
        }
        let f = chain.features();
        assert!(f.level > 0.0);
        assert!((f.bpm - 120.0).abs() < 4.0, "bpm {}", f.bpm);
        let scope = chain.scope();
        assert!(scope[..SCOPE_WAVE].iter().any(|v| *v != 0.0));
    }
}
