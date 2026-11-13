//! Frame-loop timing: where each frame's time went, per-second load, late
//! frames, and the slowest recent frame (plans/frame-spikes.md).
//!
//! The average load sparkline alone hid what actually makes the rig stutter:
//! single frames that arrive tens of ms late while the average stays at
//! 10–20 %. So the loop reports both, and keeps a per-stage breakdown of the
//! worst frame so a spike can be pinned to the stage that caused it.

use crate::protocol::FrameBreakdown;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// A frame that starts more than this many frame intervals after the one
/// before is late: on the rig, the previous frame visibly holds.
pub const LATE_FRAME_RATIO: f32 = 1.5;
/// Seconds of per-second worst frames kept for `slowest`.
const SLOWEST_WINDOW_SECS: usize = 10;
/// One-second buckets kept for the UI sparklines.
pub const HIST_LEN: usize = 30;

/// Stage times for the frame in progress, in ms.
#[derive(Debug, Clone, Copy, Default)]
struct Stages {
    prep: f32,
    ready: f32,
    minis: f32,
    program: f32,
}

/// What one closed second looked like.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Second {
    pub load_pct: u32,
    pub late: u32,
    /// The longest frame interval this second, if any frame finished in it.
    pub worst: Option<FrameBreakdown>,
}

#[derive(Debug, Default)]
pub struct FrameTiming {
    /// The loop's first frame has no previous frame: its "interval" is
    /// engine start-up (hundreds of ms), not a hitch.
    started: bool,
    stages: Stages,
    busy_ms: f32,
    late: u32,
    worst: Option<FrameBreakdown>,
    pub load_hist: VecDeque<u32>,
    pub late_hist: VecDeque<u32>,
    pub worst_hist: VecDeque<f32>,
    /// Per-second worst frames, oldest first; `None` for a second with none.
    recent_worst: VecDeque<Option<FrameBreakdown>>,
}

fn ms(d: Duration) -> f32 {
    d.as_secs_f32() * 1000.0
}

fn round1(v: f32) -> f32 {
    (v * 10.0).round() / 10.0
}

impl FrameTiming {
    /// Close out the previous frame. Call right after the pacing wait:
    /// `work` is how long the loop was busy since that frame began (measured
    /// before the wait), `interval` is the real time between the two frame
    /// starts, `budget` is the target interval.
    pub fn frame_started(&mut self, work: Duration, interval: Duration, budget: Duration) {
        let (work_ms, interval_ms, budget_ms) = (ms(work), ms(interval), ms(budget));
        let s = std::mem::take(&mut self.stages);
        if !std::mem::replace(&mut self.started, true) {
            return;
        }
        self.busy_ms += work_ms;
        if interval_ms > budget_ms * LATE_FRAME_RATIO {
            self.late += 1;
        }
        if self.worst.is_none_or(|w| interval_ms > w.interval_ms) {
            let staged = s.prep + s.ready + s.minis + s.program;
            self.worst = Some(FrameBreakdown {
                interval_ms,
                work_ms,
                prep_ms: s.prep,
                ready_ms: s.ready,
                minis_ms: s.minis,
                program_ms: s.program,
                other_ms: (work_ms - staged).max(0.0),
                stall_ms: (interval_ms - work_ms.max(budget_ms)).max(0.0),
                secs_ago: 0,
            });
        }
    }

    /// Stage marks for the frame in progress. Each takes the stage's start;
    /// the stage ends now.
    pub fn prep(&mut self, frame_start: Instant) {
        self.stages.prep = ms(frame_start.elapsed());
    }
    pub fn ready(&mut self, started: Instant) {
        self.stages.ready = ms(started.elapsed());
    }
    pub fn minis(&mut self, started: Instant) {
        self.stages.minis = ms(started.elapsed());
    }
    pub fn program(&mut self, program_ms: f32) {
        self.stages.program = program_ms;
    }

    /// Close the one-second bucket and push it onto the histories.
    pub fn close_second(&mut self) -> Second {
        // Load = busy time as a share of the second (the budget is the whole
        // second at any target rate). Overruns push it past 100.
        let load_pct = (self.busy_ms / 10.0).round().clamp(0.0, 999.0) as u32;
        let second = Second {
            load_pct,
            late: self.late,
            worst: self.worst.take(),
        };
        self.busy_ms = 0.0;
        self.late = 0;
        push_capped(&mut self.load_hist, load_pct, HIST_LEN);
        push_capped(&mut self.late_hist, second.late, HIST_LEN);
        push_capped(
            &mut self.worst_hist,
            second.worst.map_or(0.0, |w| round1(w.interval_ms)),
            HIST_LEN,
        );
        push_capped(&mut self.recent_worst, second.worst, SLOWEST_WINDOW_SECS);
        second
    }

    /// The slowest frame of the last few seconds, rounded for display.
    pub fn slowest(&self) -> Option<FrameBreakdown> {
        let n = self.recent_worst.len();
        self.recent_worst
            .iter()
            .enumerate()
            .filter_map(|(i, w)| w.map(|w| (i, w)))
            .max_by(|a, b| a.1.interval_ms.total_cmp(&b.1.interval_ms))
            .map(|(i, w)| FrameBreakdown {
                interval_ms: round1(w.interval_ms),
                work_ms: round1(w.work_ms),
                prep_ms: round1(w.prep_ms),
                ready_ms: round1(w.ready_ms),
                minis_ms: round1(w.minis_ms),
                program_ms: round1(w.program_ms),
                other_ms: round1(w.other_ms),
                stall_ms: round1(w.stall_ms),
                secs_ago: (n - 1 - i) as u32,
            })
    }
}

fn push_capped<T>(q: &mut VecDeque<T>, v: T, cap: usize) {
    q.push_back(v);
    while q.len() > cap {
        q.pop_front();
    }
}

/// One line naming where a slow frame's time went, biggest stage first.
pub fn describe(w: &FrameBreakdown, budget_ms: f32) -> String {
    let mut parts = [
        ("prep", w.prep_ms),
        ("ready bus", w.ready_ms),
        ("minis", w.minis_ms),
        ("program", w.program_ms),
        ("other", w.other_ms),
        ("late wake", w.stall_ms),
    ];
    parts.sort_by(|a, b| b.1.total_cmp(&a.1));
    let stages: Vec<String> = parts
        .iter()
        .filter(|(_, v)| *v >= 0.1)
        .map(|(name, v)| format!("{name} {v:.1}"))
        .collect();
    format!(
        "{:.1} ms frame against a {budget_ms:.1} ms budget: {}",
        w.interval_ms,
        stages.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUDGET: Duration = Duration::from_micros(16_667);

    fn d(ms: f32) -> Duration {
        Duration::from_secs_f32(ms / 1000.0)
    }

    /// A timing that has already seen the loop's start-up frame.
    fn running() -> FrameTiming {
        let mut t = FrameTiming::default();
        t.frame_started(d(300.0), d(340.0), BUDGET);
        t
    }

    #[test]
    fn start_up_is_not_a_hitch() {
        let mut t = FrameTiming::default();
        t.frame_started(d(300.0), d(340.0), BUDGET);
        let s = t.close_second();
        assert_eq!((s.late, s.load_pct, s.worst), (0, 0, None));
    }

    #[test]
    fn late_frames_and_load_are_counted_per_second() {
        let mut t = running();
        for _ in 0..58 {
            t.frame_started(d(2.0), d(16.7), BUDGET);
        }
        // One frame whose work overran, one where the thread woke late.
        t.program(30.0);
        t.frame_started(d(35.0), d(36.0), BUDGET);
        t.frame_started(d(2.0), d(40.0), BUDGET);
        let s = t.close_second();
        assert_eq!(s.late, 2);
        assert_eq!(s.load_pct, ((58.0 * 2.0 + 35.0 + 2.0) / 10.0_f32).round() as u32);
        let w = s.worst.unwrap();
        assert!((w.interval_ms - 40.0).abs() < 0.01);
        // The late wake is not the loop's own work.
        assert!((w.stall_ms - (40.0 - 16.667)).abs() < 0.01);
        assert_eq!(t.late_hist.back(), Some(&2));
        assert_eq!(t.worst_hist.back(), Some(&40.0));
    }

    #[test]
    fn overrun_is_attributed_to_its_stage() {
        let mut t = running();
        t.program(30.0);
        t.frame_started(d(35.0), d(35.0), BUDGET);
        let w = t.close_second().worst.unwrap();
        assert!((w.program_ms - 30.0).abs() < 0.01);
        assert!((w.other_ms - 5.0).abs() < 0.01);
        assert_eq!(w.stall_ms, 0.0);
        assert!(describe(&w, 16.7).contains("program 30.0, other 5.0"));
    }

    #[test]
    fn slowest_looks_back_a_few_seconds() {
        let mut t = running();
        t.frame_started(d(2.0), d(50.0), BUDGET);
        t.close_second();
        for _ in 0..3 {
            t.frame_started(d(2.0), d(16.7), BUDGET);
            t.close_second();
        }
        let w = t.slowest().unwrap();
        assert_eq!(w.interval_ms, 50.0);
        assert_eq!(w.secs_ago, 3);
        for _ in 0..SLOWEST_WINDOW_SECS {
            t.close_second();
        }
        assert!(t.slowest().is_none());
    }
}
