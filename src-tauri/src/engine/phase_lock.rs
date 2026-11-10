//! Beat-phase follower: a phase-locked loop between the clock sources and the
//! lights (plans/beat-phase-lock.md).
//!
//! Every beat source we have is a little jittery right where it matters most.
//! Pro DJ Link and MIDI clock extrapolate from the last packet and re-anchor on
//! the next one; the audio tracker re-locks to a drum hit that lands just after
//! its prediction. Each of those can step the phase *backwards*, and a backwards
//! step near the wrap turns into 0.98 → 0.01 → 0.99 → 0.02: anything that maps
//! phase to position (a beat ring launching from the edge) snaps edge ↔ centre
//! for a couple of frames.
//!
//! The follower keeps its own continuous beat count. Each frame it advances at
//! the tempo, measures how far it is from the source (the short way round the
//! wrap) and closes that gap by bending its *rate*, never its position: it runs
//! at most [`MAX_RUSH`] faster or [`MAX_DRAG`] slower than the tempo. Because the
//! rate never reaches zero it never moves backwards, so it crosses each wrap
//! exactly once. Errors larger than [`JUMP_BEATS`] are a real discontinuity in
//! the music (hot cue, loop, new track) and are followed immediately.

/// Fastest catch-up when behind the source: up to 1.5× the tempo.
pub const MAX_RUSH: f64 = 0.5;
/// Slowest hold-back when ahead of the source: down to 0.75× the tempo.
pub const MAX_DRAG: f64 = 0.25;
/// Time constant of the proportional correction, in seconds. Long enough to
/// average out per-packet jitter, short enough to settle within a beat or two.
pub const CORRECTION_TAU: f64 = 0.25;
/// Beyond this the source really moved; follow it at once rather than bend.
pub const JUMP_BEATS: f64 = 0.3;

/// Signed distance `x` folded into `[-quantum/2, quantum/2)`.
pub fn wrap_signed(x: f64, quantum: f64) -> f64 {
    (x + quantum * 0.5).rem_euclid(quantum) - quantum * 0.5
}

/// Turns a stream of wrapped `0..1` phase samples into a continuous beat total.
/// Each step is taken the short way round the wrap, so a backwards jitter across
/// the wrap counts back down instead of being counted as another beat.
#[derive(Debug, Clone, Copy, Default)]
pub struct PhaseUnwrap {
    total: f64,
    prev: Option<f32>,
}

impl PhaseUnwrap {
    pub fn push(&mut self, phase: f32) -> f64 {
        let phase = phase.rem_euclid(1.0);
        match self.prev {
            Some(prev) => self.total += wrap_signed(f64::from(phase - prev), 1.0),
            None => self.total = f64::from(phase),
        }
        self.prev = Some(phase);
        self.total
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PhaseLock {
    total: Option<f64>,
}

impl PhaseLock {
    /// Advance one frame toward `measured` (the source's continuous beat total)
    /// and return the locked total. `quantum` is the span the lock aligns in:
    /// 1 beat normally, 2 when half-time parity matters. `reset` snaps to the
    /// source (used when the source itself was switched).
    pub fn step(&mut self, measured: f64, bpm: f32, dt: f32, quantum: f64, reset: bool) -> f64 {
        let Some(total) = self.total.filter(|_| !reset && measured.is_finite()) else {
            return self.snap(measured);
        };
        let bpm = f64::from(bpm);
        let dt = f64::from(dt).max(0.0);
        if !bpm.is_finite() || bpm <= 0.0 || dt == 0.0 {
            // No tempo to run at: there is nothing to bend, the source is static.
            return self.snap(measured);
        }
        let advance = bpm / 60.0 * dt;
        let predicted = total + advance;
        let error = wrap_signed(measured - predicted, quantum);
        if error.abs() > JUMP_BEATS {
            return self.snap(predicted + error);
        }
        let correction =
            (error * (dt / CORRECTION_TAU).min(1.0)).clamp(-MAX_DRAG * advance, MAX_RUSH * advance);
        let next = predicted + correction;
        self.total = Some(next);
        next
    }

    fn snap(&mut self, measured: f64) -> f64 {
        let measured = if measured.is_finite() { measured } else { 0.0 };
        self.total = Some(measured);
        measured
    }
}

/// Split a beat total into the `(phase, count)` pair the engine passes on.
/// The count keeps its parity for negative totals (two's complement), which is
/// all half-time needs from it.
pub fn split_total(total: f64) -> (f32, u64) {
    let floor = total.floor();
    ((total - floor) as f32, floor as i64 as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DT: f32 = 1.0 / 60.0;

    /// Deterministic noise in [-1, 1].
    fn noise(i: u64) -> f64 {
        let mut x = i.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03;
        x ^= x >> 29;
        x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        x ^= x >> 32;
        (x >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    }

    /// A Pro DJ Link–style source (`rhythm.rs` `snapshot`): extrapolates
    /// `count + (age − latency)·bpm/60` from each beat packet. Packets arrive
    /// with ±20 ms of jitter (Wi-Fi and a busy switch) and the operator has dialled in 5 ms of latency, so
    /// a packet later than the latency lands after the estimate already wrapped
    /// and pulls it back across the wrap: 0.01 → 0.99.
    fn packet_source(frames: u64, bpm: f64) -> Vec<f64> {
        let period = 60.0 / bpm;
        let latency = 0.005;
        let mut out = Vec::new();
        let mut anchor_beat = 0u64;
        let mut anchor_time = 0.0f64;
        for f in 0..frames {
            let t = f as f64 * f64::from(DT);
            let next_arrival = (anchor_beat + 1) as f64 * period + noise(anchor_beat) * 0.020;
            if t >= next_arrival {
                anchor_beat += 1;
                anchor_time = next_arrival;
            }
            out.push(anchor_beat as f64 + (t - anchor_time - latency) / period);
        }
        out
    }

    #[test]
    fn wrap_signed_takes_the_short_way() {
        assert!((wrap_signed(0.98 - 0.01, 1.0) - (-0.03)).abs() < 1e-9);
        assert!((wrap_signed(0.01 - 0.98, 1.0) - 0.03).abs() < 1e-9);
        assert!((wrap_signed(1.0, 2.0) - (-1.0)).abs() < 1e-9);
        assert!((wrap_signed(-0.2, 1.0) - (-0.2)).abs() < 1e-9);
    }

    #[test]
    fn jittery_source_steps_backwards_but_the_lock_never_does() {
        let source = packet_source(60 * 60, 128.0);
        // Precondition: the raw source really does step backwards across wraps.
        let raw_backwards = source.windows(2).filter(|w| w[1] < w[0]).count();
        assert!(
            raw_backwards > 10,
            "test source should jitter: {raw_backwards}"
        );
        let raw_straddles = source
            .windows(2)
            .filter(|w| w[1] < w[0] && w[1].floor() != w[0].floor())
            .count();
        assert!(raw_straddles > 0, "test source should straddle the wrap");

        let mut lock = PhaseLock::default();
        let mut prev = f64::NEG_INFINITY;
        let mut max_err = 0.0f64;
        let mut source_err = 0.0f64;
        for (i, &m) in source.iter().enumerate() {
            let total = lock.step(m, 128.0, DT, 1.0, false);
            assert!(
                total >= prev,
                "frame {i}: lock went backwards {prev} -> {total}"
            );
            prev = total;
            if i > 120 {
                // The true musical clock the source is noisy around.
                let truth = (i as f64 * f64::from(DT) - 0.005) * 128.0 / 60.0;
                max_err = max_err.max((total - truth).abs());
                source_err = source_err.max((m - truth).abs());
            }
        }
        // It follows the source's per-beat offset (that is the source's call to
        // make) but never strays further from the true beat than the source.
        assert!(
            max_err <= source_err,
            "lock ({max_err}) strays further from the true beat than the source ({source_err})"
        );
    }

    #[test]
    fn counts_each_beat_exactly_once() {
        let source = packet_source(60 * 30, 140.0);
        let mut lock = PhaseLock::default();
        let mut wraps = 0;
        let mut prev_phase = 0.0f32;
        for (i, &m) in source.iter().enumerate() {
            let (phase, _) = split_total(lock.step(m, 140.0, DT, 1.0, false));
            if i > 0 && phase < prev_phase - 0.5 {
                wraps += 1;
            }
            prev_phase = phase;
        }
        let beats = source.last().unwrap().floor() as i64;
        assert!(
            (wraps - beats).abs() <= 1,
            "{wraps} wraps for {beats} beats"
        );
    }

    #[test]
    fn rate_stays_within_the_bend_limits() {
        let mut lock = PhaseLock::default();
        lock.step(0.0, 120.0, DT, 1.0, false);
        let nominal = 120.0 / 60.0 * f64::from(DT);
        // Source suddenly 0.25 beats ahead (under the jump threshold): rush.
        let mut prev = 0.0;
        for f in 1..200 {
            let m = 0.25 + f as f64 * nominal;
            let t = lock.step(m, 120.0, DT, 1.0, false);
            let step = t - prev;
            assert!(
                step <= nominal * (1.0 + MAX_RUSH) + 1e-9,
                "rushed too hard: {step}"
            );
            assert!(
                step >= nominal * (1.0 - MAX_DRAG) - 1e-9,
                "dragged too hard: {step}"
            );
            prev = t;
        }
        assert!(
            (prev - (0.25 + 199.0 * nominal)).abs() < 0.01,
            "caught up: {prev}"
        );
        // Source now 0.25 behind: hold back, still moving forward.
        let base = prev;
        for f in 1..200 {
            let m = base - 0.25 + f as f64 * nominal;
            let t = lock.step(m, 120.0, DT, 1.0, false);
            assert!(t > prev, "never stands still or reverses");
            prev = t;
        }
        assert!(
            (prev - (base - 0.25 + 199.0 * nominal)).abs() < 0.01,
            "settled back: {prev}"
        );
    }

    #[test]
    fn big_moves_are_followed_at_once() {
        let mut lock = PhaseLock::default();
        lock.step(10.0, 120.0, DT, 1.0, false);
        // A hot cue half a beat away.
        let t = lock.step(10.5, 120.0, DT, 1.0, false);
        assert!((t - 10.5).abs() < 1e-9, "{t}");
        // A jump backwards by a whole bar lands on the same phase, so in a
        // one-beat quantum it is not an error at all: the lock keeps its count.
        let t2 = lock.step(6.5 + 120.0 / 60.0 * f64::from(DT), 120.0, DT, 1.0, false);
        assert!((t2.fract() - 0.5 - 120.0 / 60.0 * f64::from(DT)).abs() < 1e-6);
    }

    #[test]
    fn half_time_locks_parity() {
        let mut lock = PhaseLock::default();
        lock.step(4.2, 120.0, DT, 2.0, false);
        // Source says the same phase but the other parity: a full beat off.
        let adv = 120.0 / 60.0 * f64::from(DT);
        let t = lock.step(5.2 + adv, 120.0, DT, 2.0, false);
        let off = wrap_signed(t - (5.2 + adv), 2.0);
        assert!(off.abs() < 1e-9, "parity followed: {t}");
        let (_, count) = split_total(t);
        assert_eq!(count % 2, 1, "now on an odd beat like the source: {t}");
        // In a one-beat quantum the same move is invisible.
        let mut lock1 = PhaseLock::default();
        lock1.step(4.2, 120.0, DT, 1.0, false);
        let t1 = lock1.step(5.2 + adv, 120.0, DT, 1.0, false);
        assert!((t1 - (4.2 + adv)).abs() < 1e-9, "{t1}");
    }

    #[test]
    fn no_tempo_or_reset_snaps() {
        let mut lock = PhaseLock::default();
        assert_eq!(lock.step(3.25, 0.0, DT, 1.0, false), 3.25);
        assert_eq!(lock.step(3.4, 0.0, DT, 1.0, false), 3.4);
        lock.step(3.5, 120.0, DT, 1.0, false);
        assert_eq!(lock.step(0.1, 120.0, DT, 1.0, true), 0.1);
        assert_eq!(lock.step(f64::NAN, 120.0, DT, 1.0, false), 0.0);
    }

    #[test]
    fn unwrap_counts_back_down_on_backwards_straddle() {
        let mut u = PhaseUnwrap::default();
        let totals: Vec<f64> = [0.9f32, 0.98, 0.01, 0.99, 0.02, 0.1]
            .into_iter()
            .map(|p| u.push(p))
            .collect();
        let expect = [0.9, 0.98, 1.01, 0.99, 1.02, 1.1];
        for (t, e) in totals.iter().zip(expect) {
            assert!((t - e).abs() < 1e-5, "{totals:?}");
        }
        u.reset();
        assert!((u.push(0.4) - 0.4).abs() < 1e-6);
    }

    #[test]
    fn split_total_keeps_parity_below_zero() {
        assert_eq!(split_total(3.25), (0.25, 3));
        let (p, c) = split_total(-0.25);
        assert!((p - 0.75).abs() < 1e-6);
        assert_eq!(c % 2, 1, "-1 is odd");
    }
}
