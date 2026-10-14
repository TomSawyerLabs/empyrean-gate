//! Echo — Simon for the whole floor (plans/classic-games.md).
//!
//! The ring is cut into coloured wedges (Simon's red, blue, yellow and green
//! at four). The Gate plays a pattern on the beat of the music, one wedge
//! per beat; then it is the floor's turn, and anyone tapping a wedge on
//! their phone answers. Get the whole pattern and it grows by one; miss and
//! a fresh pattern starts from one.
//!
//! The crowd plays as one, and generously: a right tap counts the moment it
//! lands, and a step that has only wrong taps fails a couple of beats later,
//! so one person who remembers rescues everyone who doesn't. The more people
//! play, the longer the patterns get — it's a party, not an exam.
//!
//! With nobody tapping for a while the Gate answers itself, slowly and
//! sometimes wrongly, so a playlist cue with no one playing still looks
//! like a game and not a screensaver.
//!
//! Timing: a fixed 50 ms step for crisp light, with the beat told to the sim
//! by the engine ([`EchoSim::beat`]). Without a confident beat it keeps its
//! own at [`FREE_BEAT_TICKS`].

use super::{GameCommand, SplitMix64};

/// Fixed step: crisp flashes; the beat comes from [`EchoSim::beat`].
pub const TICK_SECS: f32 = 0.05;

/// Without a beat from the music for this long, keep our own (2 s)…
const BEAT_TIMEOUT_TICKS: u32 = 40;
/// …at 120 bpm.
const FREE_BEAT_TICKS: u32 = 10;
/// Beats shorter than this (fast drum & bass) show a step every other beat.
const FAST_BEAT_TICKS: u32 = 8;

/// A step with only wrong taps fails after this many beats.
const WRONG_GRACE_BEATS: u8 = 2;
/// The floor's turn, with people playing, times out after this many beats
/// without a right answer.
const PATIENCE_BEATS: u8 = 10;
/// No tap for this many beats and the Gate answers for itself.
const ATTRACT_BEATS: u32 = 24;
/// The self-answer is wrong this often per step of pattern length (1-in-N
/// scaled), so the attract mode tops out around eight to twelve.
const ATTRACT_SLIP_PER_STEP: f32 = 0.025;

/// A second tap on the wedge that just counted, this soon after it, is
/// another finger on the same answer, not the next step (200 ms).
const ECHO_TICKS: u32 = 4;

const WIN_BEATS: u8 = 3;
const MISS_BEATS: u8 = 4;
const MAX_PATTERN: usize = 64;

/// How fast a lit wedge fades, per tick (an on-beat flash that is mostly
/// gone by the next beat at 120 bpm).
const FADE: f32 = 0.84;

/// Wedge hues at four: Simon's own, laid out as on the toy when seen on the
/// phone preview (spoke 0 at the bottom, θ counterclockwise): blue
/// bottom-right, red top-right, green top-left, yellow bottom-left.
const SIMON_HUES: [f32; 4] = [0.62, 0.0, 0.33, 0.15];

#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
    /// The Gate plays `pattern[step]`; `wait` beats to the next step.
    Show { step: usize, wait: u8 },
    /// One beat of "your turn" between the pattern and the answers.
    Cue,
    /// The floor answers `pattern[step]`. `wrong` = a wrong wedge was tapped
    /// and this many beats of grace are left; `quiet` = beats with no right
    /// answer.
    Listen { step: usize, wrong: Option<(u8, u8)>, quiet: u8 },
    /// The whole pattern came back: a celebration, then one more step.
    Win { beats: u8 },
    /// `wrong` was tapped (or nobody answered) where `right` was wanted.
    Miss { beats: u8, wrong: Option<u8>, right: u8 },
}

pub struct EchoSim {
    theta: usize,
    radial: usize,
    wedges: u8,
    pattern: Vec<u8>,
    phase: Phase,
    /// Per-wedge light, 0..1, fading each tick…
    lit: Vec<f32>,
    /// …once its hold (ticks at full light, for a step of the pattern) runs out.
    hold: Vec<u32>,
    rng: SplitMix64,
    ticks: u32,
    beats: u32,
    /// A beat arrived from the music since the last tick.
    beat_pending: bool,
    last_music_beat: Option<u32>,
    last_beat_tick: u32,
    /// Ticks between the last two beats.
    beat_ticks: u32,
    /// The beat a human last tapped on (`None` = never).
    human_beat: Option<u32>,
    /// The wedge that just advanced the answer, and when (see
    /// [`ECHO_TICKS`]).
    echo_guard: Option<(u8, u32)>,
    best: usize,
    rounds_won: u32,
}

impl EchoSim {
    pub fn new(theta: usize, radial: usize, wedges: u8, seed: u64) -> Self {
        let mut sim = Self {
            theta,
            radial,
            wedges: wedges.clamp(3, 8),
            pattern: Vec::new(),
            phase: Phase::Cue,
            lit: vec![0.0; 8],
            hold: vec![0; 8],
            rng: SplitMix64::new(seed),
            ticks: 0,
            beats: 0,
            beat_pending: false,
            last_music_beat: None,
            last_beat_tick: 0,
            beat_ticks: FREE_BEAT_TICKS,
            human_beat: None,
            echo_guard: None,
            best: 0,
            rounds_won: 0,
        };
        sim.restart();
        sim
    }

    pub fn theta(&self) -> usize {
        self.theta
    }

    pub fn radial(&self) -> usize {
        self.radial
    }

    /// The wedge count. A change starts a fresh pattern: the old one named
    /// wedges that have moved.
    pub fn set_slots(&mut self, wedges: u8) {
        let wedges = wedges.clamp(3, 8);
        if wedges != self.wedges {
            self.wedges = wedges;
            self.restart();
        }
    }

    pub fn pattern_len(&self) -> usize {
        self.pattern.len()
    }

    pub fn best(&self) -> usize {
        self.best
    }

    fn restart(&mut self) {
        self.pattern.clear();
        self.grow();
        self.phase = Phase::Show { step: 0, wait: 0 };
    }

    fn grow(&mut self) {
        if self.pattern.len() < MAX_PATTERN {
            let w = self.rng.next_below(self.wedges as u64) as u8;
            self.pattern.push(w);
        }
    }

    fn wedge_of_cell(&self, it: i32) -> u8 {
        let it = it.rem_euclid(self.theta as i32) as usize;
        (it * self.wedges as usize / self.theta) as u8
    }

    fn wedge_cells(&self, w: u8) -> std::ops::Range<usize> {
        let n = self.wedges as usize;
        let a = (w as usize * self.theta).div_ceil(n);
        let b = ((w as usize + 1) * self.theta).div_ceil(n);
        a..b
    }

    fn hue(&self, w: u8) -> f32 {
        if self.wedges == 4 {
            SIMON_HUES[w as usize % 4]
        } else {
            w as f32 / self.wedges as f32
        }
    }

    fn attract(&self) -> bool {
        self.human_beat
            .is_none_or(|b| self.beats.saturating_sub(b) > ATTRACT_BEATS)
    }

    pub fn detail(&self) -> String {
        let len = self.pattern.len();
        let what = match self.phase {
            Phase::Show { .. } => "watch".to_string(),
            Phase::Cue => "your turn".to_string(),
            Phase::Listen { step, .. } => format!("your turn — {step} of {len}"),
            Phase::Win { .. } => "got it!".to_string(),
            Phase::Miss { .. } => "missed — starting over".to_string(),
        };
        format!("{what} · pattern {len} · best {}", self.best)
    }

    /// A beat of the music, from the engine.
    pub fn beat(&mut self) {
        self.beat_pending = true;
        self.last_music_beat = Some(self.ticks);
    }

    pub fn tick(&mut self) {
        self.ticks += 1;
        for (l, h) in self.lit.iter_mut().zip(self.hold.iter_mut()) {
            if *h > 0 {
                *h -= 1;
            } else {
                *l *= FADE;
            }
        }
        let music = self
            .last_music_beat
            .is_some_and(|t| self.ticks.saturating_sub(t) <= BEAT_TIMEOUT_TICKS);
        let free_beat = !music && self.ticks.saturating_sub(self.last_beat_tick) >= FREE_BEAT_TICKS;
        if std::mem::take(&mut self.beat_pending) || free_beat {
            // The tempo, from beats that follow on from one another (not the
            // first after a gap, nor two in one tick).
            let gap = self.ticks.saturating_sub(self.last_beat_tick);
            if (2..=BEAT_TIMEOUT_TICKS).contains(&gap) {
                self.beat_ticks = gap;
            }
            self.last_beat_tick = self.ticks;
            self.on_beat();
        }
    }

    fn flash(&mut self, w: u8) {
        self.lit[w as usize % 8] = 1.0;
    }

    /// A step of the pattern: full light for most of the beat, like the toy.
    fn show(&mut self, w: u8) {
        self.flash(w);
        self.hold[w as usize % 8] = self.beat_ticks * 3 / 5;
    }

    fn on_beat(&mut self) {
        self.beats += 1;
        self.phase = match self.phase {
            Phase::Show { step, wait } if wait > 0 => Phase::Show { step, wait: wait - 1 },
            Phase::Show { step, .. } => {
                let w = self.pattern[step];
                self.show(w);
                // Fast music shows a step every other beat.
                let wait = u8::from(self.beat_ticks < FAST_BEAT_TICKS);
                if step + 1 < self.pattern.len() {
                    Phase::Show { step: step + 1, wait }
                } else {
                    Phase::Cue
                }
            }
            Phase::Cue => Phase::Listen { step: 0, wrong: None, quiet: 0 },
            Phase::Listen { step, wrong: Some((w, grace)), quiet } => {
                if grace > 1 {
                    Phase::Listen { step, wrong: Some((w, grace - 1)), quiet }
                } else {
                    self.miss(Some(w), step)
                }
            }
            Phase::Listen { step, wrong: None, quiet } => {
                if self.attract() {
                    // The Gate answers itself, a little worse the longer the
                    // pattern gets.
                    let slip = (ATTRACT_SLIP_PER_STEP * step as f32 * 1000.0) as u64;
                    let right = self.pattern[step];
                    if self.rng.next_below(1000) < slip {
                        let wrong = (right + 1 + self.rng.next_below(self.wedges as u64 - 1) as u8)
                            % self.wedges;
                        self.flash(wrong);
                        self.miss(Some(wrong), step)
                    } else {
                        self.flash(right);
                        self.advance(step)
                    }
                } else if quiet + 1 >= PATIENCE_BEATS {
                    self.miss(None, step)
                } else {
                    Phase::Listen { step, wrong: None, quiet: quiet + 1 }
                }
            }
            Phase::Win { beats } if beats > 1 => {
                for w in 0..self.wedges {
                    if (w as u32 + self.beats) % 2 == 0 {
                        self.flash(w);
                    }
                }
                Phase::Win { beats: beats - 1 }
            }
            Phase::Win { .. } => {
                self.grow();
                Phase::Show { step: 0, wait: 1 }
            }
            Phase::Miss { beats, wrong, right } if beats > 1 => {
                if beats % 2 == 0 {
                    self.flash(right);
                }
                Phase::Miss { beats: beats - 1, wrong, right }
            }
            Phase::Miss { .. } => {
                self.pattern.clear();
                self.grow();
                Phase::Show { step: 0, wait: 1 }
            }
        };
    }

    /// `step` was answered right.
    fn advance(&mut self, step: usize) -> Phase {
        if step + 1 >= self.pattern.len() {
            self.best = self.best.max(self.pattern.len());
            self.rounds_won += 1;
            Phase::Win { beats: WIN_BEATS }
        } else {
            Phase::Listen { step: step + 1, wrong: None, quiet: 0 }
        }
    }

    fn miss(&mut self, wrong: Option<u8>, step: usize) -> Phase {
        Phase::Miss {
            beats: MISS_BEATS,
            wrong,
            right: self.pattern[step],
        }
    }

    /// A tap: that wedge, as an answer.
    pub fn inject(&mut self, it: i32, _ir: i32, _species: u8) {
        self.human_beat = Some(self.beats);
        let w = self.wedge_of_cell(it);
        let Phase::Listen { step, wrong, .. } = self.phase else {
            return;
        };
        if self
            .echo_guard
            .is_some_and(|(g, at)| g == w && self.ticks.saturating_sub(at) < ECHO_TICKS)
        {
            // A second finger on the wedge that just counted.
            self.flash(w);
            return;
        }
        self.flash(w);
        if w == self.pattern[step] {
            self.echo_guard = Some((w, self.ticks));
            self.phase = self.advance(step);
        } else if wrong.is_none() {
            self.phase = Phase::Listen {
                step,
                wrong: Some((w, WRONG_GRACE_BEATS)),
                quiet: 0,
            };
        }
    }

    /// Echo has no buttons.
    pub fn command(&mut self, _command: GameCommand, _species: u8) {}

    pub fn watchdog(&mut self) {}

    /// The wedges (dim until lit, a dark seam between them), and an inner
    /// band that says whose turn it is.
    pub fn pack_cells(&self) -> Vec<u32> {
        use super::hsv_to_packed_rgb as rgb;
        let (theta, radial) = (self.theta, self.radial);
        let mut out = vec![0u32; theta * radial];
        let band = 3.min(radial);
        let (miss_wrong, miss_dim) = match self.phase {
            Phase::Miss { wrong, beats, .. } => (wrong, beats >= MISS_BEATS - 1),
            _ => (None, false),
        };
        for w in 0..self.wedges {
            let cells = self.wedge_cells(w);
            let seam = cells.start;
            let lit = self.lit[w as usize];
            let (h, s, v) = if miss_dim && miss_wrong == Some(w) {
                // The wrong answer buzzes dark red.
                (0.0, 1.0, 0.25 + 0.2 * lit)
            } else {
                (self.hue(w), 0.9, 0.09 + 0.91 * lit)
            };
            let color = rgb(h, s, v);
            for it in cells {
                if it == seam {
                    continue;
                }
                for ir in band..radial {
                    out[ir * theta + it] = color;
                }
            }
        }
        // The inner band: white while the floor is answering, gold on a win,
        // red on a miss, dark while the Gate plays.
        let pulse = (self.ticks.saturating_sub(self.last_beat_tick) as f32
            / self.beat_ticks.max(1) as f32)
            .clamp(0.0, 1.0);
        let inner = match self.phase {
            Phase::Show { .. } => 0,
            Phase::Cue | Phase::Listen { .. } => rgb(0.0, 0.0, 0.35 - 0.2 * pulse),
            Phase::Win { .. } => rgb(0.12, 0.8, 0.9),
            Phase::Miss { .. } => rgb(0.0, 1.0, 0.6),
        };
        for ir in 0..band {
            for it in 0..theta {
                out[ir * theta + it] = inner;
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> EchoSim {
        EchoSim::new(64, 48, 4, 3)
    }

    /// One beat of the music at 120 bpm.
    fn one_beat(s: &mut EchoSim) {
        s.beat();
        for _ in 0..FREE_BEAT_TICKS {
            s.tick();
        }
    }

    /// A θ cell in the middle of wedge `w`.
    fn cell(s: &EchoSim, w: u8) -> i32 {
        let c = s.wedge_cells(w);
        ((c.start + c.end) / 2) as i32
    }

    /// Beat until the floor's turn.
    fn to_listen(s: &mut EchoSim) {
        for _ in 0..200 {
            if matches!(s.phase, Phase::Listen { .. }) {
                return;
            }
            one_beat(s);
        }
        panic!("never reached the floor's turn: {:?}", s.phase);
    }

    #[test]
    fn four_wedges_are_simons_colors_in_simons_places() {
        let s = sim();
        assert_eq!(s.wedge_cells(0), 0..16);
        assert_eq!(s.wedge_cells(3), 48..64);
        assert_eq!(s.wedge_of_cell(20), 1);
        assert_eq!(s.hue(0), 0.62, "blue bottom-right");
        assert_eq!(s.hue(1), 0.0, "red top-right");
        assert_eq!(s.hue(2), 0.33, "green top-left");
        assert_eq!(s.hue(3), 0.15, "yellow bottom-left");
    }

    #[test]
    fn the_gate_shows_the_pattern_one_wedge_per_beat() {
        let mut s = sim();
        s.pattern = vec![2, 0, 3];
        s.phase = Phase::Show { step: 0, wait: 0 };
        let mut shown = Vec::new();
        for _ in 0..3 {
            one_beat(&mut s);
            let brightest = (0..4).max_by(|a, b| s.lit[*a].total_cmp(&s.lit[*b])).unwrap();
            shown.push(brightest as u8);
        }
        assert_eq!(shown, vec![2, 0, 3]);
        one_beat(&mut s);
        assert!(matches!(s.phase, Phase::Listen { step: 0, .. }));
    }

    #[test]
    fn fast_music_shows_a_step_every_other_beat() {
        let mut s = sim();
        // 174 bpm: a beat every 7 ticks.
        let fast = |s: &mut EchoSim| {
            s.beat();
            for _ in 0..7 {
                s.tick();
            }
        };
        fast(&mut s);
        fast(&mut s);
        assert_eq!(s.beat_ticks, 7, "the tempo is measured");
        s.pattern = vec![2, 0];
        s.phase = Phase::Show { step: 0, wait: 0 };
        s.lit = vec![0.0; 8];
        fast(&mut s);
        assert!(s.lit[2] > 0.0 && s.lit[0] == 0.0, "step 0 shown");
        assert!(matches!(s.phase, Phase::Show { step: 1, wait: 1 }), "{:?}", s.phase);
        fast(&mut s);
        assert_eq!(s.lit[0], 0.0, "a beat of rest");
        fast(&mut s);
        assert!(s.lit[0] > 0.0, "step 1 shown");
    }

    #[test]
    fn the_right_answers_grow_the_pattern() {
        let mut s = sim();
        s.human_beat = Some(0);
        to_listen(&mut s);
        let pattern = s.pattern.clone();
        for &w in &pattern {
            s.inject(cell(&s, w), 30, 0);
        }
        assert!(matches!(s.phase, Phase::Win { .. }));
        for _ in 0..(WIN_BEATS as usize + 1) {
            one_beat(&mut s);
        }
        assert_eq!(s.pattern_len(), pattern.len() + 1);
        assert_eq!(&s.pattern[..pattern.len()], &pattern[..], "the pattern grows, it doesn't change");
        assert_eq!(s.best(), pattern.len());
    }

    #[test]
    fn one_right_tap_rescues_a_wrong_one() {
        let mut s = sim();
        s.pattern = vec![1, 2];
        s.phase = Phase::Listen { step: 0, wrong: None, quiet: 0 };
        s.human_beat = Some(0);
        s.inject(cell(&s, 3), 30, 0); // someone gets it wrong…
        one_beat(&mut s);
        s.inject(cell(&s, 1), 30, 0); // …someone else remembers
        assert!(matches!(s.phase, Phase::Listen { step: 1, wrong: None, .. }));
    }

    #[test]
    fn only_wrong_taps_fail_after_the_grace() {
        let mut s = sim();
        s.pattern = vec![1, 2];
        s.phase = Phase::Listen { step: 0, wrong: None, quiet: 0 };
        s.human_beat = Some(0);
        s.inject(cell(&s, 3), 30, 0);
        for _ in 0..WRONG_GRACE_BEATS {
            one_beat(&mut s);
        }
        assert!(matches!(s.phase, Phase::Miss { wrong: Some(3), right: 1, .. }), "{:?}", s.phase);
        for _ in 0..MISS_BEATS {
            one_beat(&mut s);
        }
        assert_eq!(s.pattern_len(), 1, "a miss starts over from one");
        assert!(matches!(s.phase, Phase::Show { .. }));
    }

    #[test]
    fn a_second_finger_on_the_same_wedge_is_not_the_next_answer() {
        let mut s = sim();
        s.pattern = vec![1, 1, 2];
        s.phase = Phase::Listen { step: 0, wrong: None, quiet: 0 };
        s.inject(cell(&s, 1), 30, 0);
        s.inject(cell(&s, 1), 30, 4); // the same instant: a duplicate
        assert!(matches!(s.phase, Phase::Listen { step: 1, .. }));
        for _ in 0..ECHO_TICKS {
            s.tick();
        }
        s.inject(cell(&s, 1), 30, 0); // a moment later: a real answer
        assert!(matches!(s.phase, Phase::Listen { step: 2, .. }));
    }

    #[test]
    fn taps_while_the_gate_plays_do_not_count() {
        let mut s = sim();
        s.pattern = vec![1, 2];
        s.phase = Phase::Show { step: 0, wait: 0 };
        s.inject(cell(&s, 1), 30, 0);
        assert!(matches!(s.phase, Phase::Show { step: 0, .. }));
    }

    #[test]
    fn people_playing_who_go_quiet_time_out() {
        let mut s = sim();
        s.pattern = vec![1, 2];
        s.phase = Phase::Listen { step: 0, wrong: None, quiet: 0 };
        s.human_beat = Some(s.beats);
        for _ in 0..PATIENCE_BEATS {
            one_beat(&mut s);
        }
        assert!(matches!(s.phase, Phase::Miss { wrong: None, .. }));
    }

    #[test]
    fn with_nobody_playing_the_gate_answers_itself_and_sometimes_slips() {
        let mut s = sim();
        let mut lengths = Vec::new();
        for _ in 0..3000 {
            one_beat(&mut s);
            lengths.push(s.pattern_len());
        }
        assert!(s.best() >= 4, "the attract mode never got going: best {}", s.best());
        assert!(
            lengths.windows(2).any(|w| w[1] < w[0]),
            "the attract mode never missed"
        );
    }

    #[test]
    fn without_music_it_keeps_its_own_beat() {
        let mut s = sim();
        for _ in 0..(FREE_BEAT_TICKS * 5) {
            s.tick();
        }
        assert_eq!(s.beats, 5);
        // With music, the music's beats rule.
        one_beat(&mut s);
        let at = s.beats;
        for _ in 0..(FREE_BEAT_TICKS * 2) {
            s.tick();
        }
        assert_eq!(s.beats, at, "no free beats while the music is fresh");
    }

    #[test]
    fn changing_the_wedge_count_starts_over() {
        let mut s = sim();
        s.pattern = vec![1, 2, 3];
        s.set_slots(6);
        assert_eq!(s.pattern_len(), 1);
        assert!(s.pattern[0] < 6);
        assert_eq!(s.wedge_cells(5), 54..64);
    }

    #[test]
    fn pack_lights_the_wedge_and_keeps_the_seams_dark() {
        let mut s = sim();
        s.flash(1);
        let out = s.pack_cells();
        let lit = out[20 * 64 + 24];
        let dim = out[20 * 64 + 40];
        let lum = |c: u32| (c & 0xff) + ((c >> 8) & 0xff) + (c >> 16);
        assert!(lum(lit) > 3 * lum(dim), "lit {lit:06x} vs dim {dim:06x}");
        assert_eq!(out[20 * 64 + 16], 0, "seam between wedges 0 and 1");
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = EchoSim::new(64, 48, 5, 11);
        let mut b = EchoSim::new(64, 48, 5, 11);
        for _ in 0..2000 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.pattern, b.pattern);
        assert_eq!(a.pack_cells(), b.pack_cells());
    }
}
