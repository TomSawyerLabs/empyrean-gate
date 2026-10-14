//! Trails — light cycles on the ring (plans/classic-games.md).
//!
//! Every color is a cycle laying a wall of light behind it. Hit any wall —
//! another cycle's, your own, the hole's edge or the rim — and you derez in
//! a burst of your color; the cycle whose wall you hit gets the credit. A
//! derezzed cycle's wall fades out, and the cycle rides back in two seconds
//! later. Walls have a fixed length (Snake's rule): the tail fades as the
//! head moves, so the arena never fills up for good.
//!
//! The arena is the strip between the hole and the rim, and the cycles ride
//! its cells: out, in, or round either way. Their speed is physical, so a
//! step round the ring near the rim, where cells are wide, takes longer
//! than a step out — on the real array every cycle moves at the same pace.
//!
//! **Turn left / Turn right** buttons turn a quarter turn as seen on the
//! phone preview, and a tap turns toward the tapped point (never straight
//! back into your own wall). A cycle is AI-ridden until someone steers it
//! and goes back to the AI [`HUMAN_TICKS`] after their last input. The AI
//! looks only a little way ahead, so it rides well and still crashes now
//! and then.
//!
//! On the preview the spoke index runs counterclockwise (plans/
//! classic-games.md), so `it + 1` is counterclockwise and a left turn from
//! heading out is counterclockwise.

use super::{GameCommand, SplitMix64};
use std::collections::VecDeque;
use std::f32::consts::TAU;

/// Fixed step, shared with the other particle sims.
pub const TICK_SECS: f32 = 0.05;

/// The hole's radius as a fraction of the array's (ring 0's inner edge).
const HOLE: f32 = 0.32;
/// Cycle speed, disc units per second (the strip's width in ~2.3 s).
const SPEED: f32 = 0.3;
/// A wall's length, disc units (about three quarters of the way round
/// the middle), long enough that the arena gets crowded.
const TRAIL_LENGTH: f32 = 3.0;
const RESPAWN_TICKS: u32 = 40;
const HUMAN_TICKS: u32 = 300;
/// Derezzed walls fade this much per tick (~0.7 s).
const FADE: u8 = 18;
/// AI: free road it wants ahead (disc units), how often it fails to react,
/// how often it goes after a rival within [`AI_HUNT_RANGE`], and how often
/// it turns for the fun of it (1-in-N per step).
const AI_LOOK: f32 = 0.07;
const AI_MISS: u64 = 4;
const AI_HUNT: u64 = 2;
const AI_HUNT_RANGE: f32 = 0.4;
const AI_WANDER: u64 = 15;

const NONE: u8 = 0xff;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    Out,
    /// `it + 1`: counterclockwise on the preview.
    Ccw,
    In,
    /// `it - 1`.
    Cw,
}

impl Dir {
    /// A quarter turn left as seen on the preview.
    pub fn left(self) -> Dir {
        match self {
            Dir::Out => Dir::Ccw,
            Dir::Ccw => Dir::In,
            Dir::In => Dir::Cw,
            Dir::Cw => Dir::Out,
        }
    }

    pub fn right(self) -> Dir {
        self.left().left().left()
    }

    fn reverse(self) -> Dir {
        self.left().left()
    }

    fn delta(self) -> (i32, i32) {
        match self {
            Dir::Out => (0, 1),
            Dir::In => (0, -1),
            Dir::Ccw => (1, 0),
            Dir::Cw => (-1, 0),
        }
    }

    fn radial(self) -> bool {
        matches!(self, Dir::Out | Dir::In)
    }
}

#[derive(Clone, Debug)]
struct Cycle {
    it: usize,
    ir: usize,
    heading: Dir,
    /// Distance travelled toward the next cell.
    progress: f32,
    /// The wall: cells from tail to head, with each one's length.
    trail: VecDeque<(usize, f32)>,
    trail_len: f32,
    human_until: u32,
    /// Derezzed: back at this tick (0 = riding).
    dead_until: u32,
    kills: u32,
}

pub struct TrailsSim {
    theta: usize,
    radial: usize,
    slots: u8,
    cycles: Vec<Cycle>,
    /// Which cycle's wall is in each cell ([`NONE`] = open road).
    wall: Vec<u8>,
    /// Fading light: derezzed walls and bursts, (slot, glow).
    fade: Vec<(u8, u8)>,
    rng: SplitMix64,
    ticks: u32,
    derezzes: u32,
}

impl TrailsSim {
    pub fn new(theta: usize, radial: usize, slots: u8, seed: u64) -> Self {
        let mut sim = Self {
            theta,
            radial,
            slots: 0,
            cycles: Vec::new(),
            wall: vec![NONE; theta * radial],
            fade: vec![(NONE, 0); theta * radial],
            rng: SplitMix64::new(seed),
            ticks: 0,
            derezzes: 0,
        };
        sim.set_slots(slots);
        sim
    }

    pub fn theta(&self) -> usize {
        self.theta
    }

    pub fn radial(&self) -> usize {
        self.radial
    }

    pub fn set_slots(&mut self, slots: u8) {
        let slots = slots.clamp(2, 8);
        if slots == self.slots {
            return;
        }
        // Retire cycles past the new count, walls and all.
        while self.cycles.len() > slots as usize {
            let k = self.cycles.len() - 1;
            self.clear_wall(k, false);
            self.cycles.pop();
        }
        self.slots = slots;
        while self.cycles.len() < slots as usize {
            let k = self.cycles.len();
            self.cycles.push(Cycle {
                it: 0,
                ir: 0,
                heading: Dir::Ccw,
                progress: 0.0,
                trail: VecDeque::new(),
                trail_len: 0.0,
                human_until: 0,
                dead_until: 0,
                kills: 0,
            });
            // Evenly round the ring, all riding the same way.
            let it = k * self.theta / slots as usize;
            let ir = self.radial / 2 + (k % 3) * self.radial / 8;
            self.ride_in(k, it, ir.min(self.radial - 2), Dir::Ccw);
        }
    }

    pub fn detail(&self) -> String {
        let riders = self.cycles.iter().filter(|c| c.human_until > self.ticks).count();
        let mut line = match self
            .cycles
            .iter()
            .enumerate()
            .filter(|(_, c)| c.kills > 0)
            .max_by_key(|(_, c)| c.kills)
        {
            Some((k, c)) => format!("color {} leads with {} derezzed", k + 1, c.kills),
            None => "no derezzes yet".to_string(),
        };
        line.push_str(&format!(
            " · {riders} rider{}",
            if riders == 1 { "" } else { "s" }
        ));
        line
    }

    fn idx(&self, it: usize, ir: usize) -> usize {
        ir * self.theta + it
    }

    fn slot_hue(&self, slot: u8) -> f32 {
        (slot % self.slots) as f32 / self.slots as f32
    }

    /// The physical length of a step from ring `ir` in direction `d`.
    fn step_len(&self, ir: usize, d: Dir) -> f32 {
        let ring = (1.0 - HOLE) / self.radial as f32;
        if d.radial() {
            ring
        } else {
            let r = HOLE + (ir as f32 + 0.5) * ring;
            r * TAU / self.theta as f32
        }
    }

    /// The cell one step from (`it`, `ir`) along `d`, or `None` past the
    /// hole's edge or the rim.
    fn next(&self, it: usize, ir: usize, d: Dir) -> Option<(usize, usize)> {
        let (dt, dr) = d.delta();
        let ir = ir as i32 + dr;
        if ir < 0 || ir >= self.radial as i32 {
            return None;
        }
        let it = (it as i32 + dt).rem_euclid(self.theta as i32) as usize;
        Some((it, ir as usize))
    }

    fn open(&self, cell: Option<(usize, usize)>) -> bool {
        cell.is_some_and(|(it, ir)| self.wall[self.idx(it, ir)] == NONE)
    }

    /// Free road straight ahead along `d`, in disc units, up to `max`.
    fn road(&self, it: usize, ir: usize, d: Dir, max: f32) -> f32 {
        let (mut it, mut ir) = (it, ir);
        let mut dist = 0.0;
        while dist < max {
            match self.next(it, ir, d) {
                Some(c) if self.open(Some(c)) => {
                    dist += self.step_len(ir, d);
                    (it, ir) = c;
                }
                _ => return dist,
            }
        }
        max
    }

    /// A cell's center in the disc.
    fn at(&self, it: usize, ir: usize) -> (f32, f32) {
        let ring = (1.0 - HOLE) / self.radial as f32;
        let r = HOLE + (ir as f32 + 0.5) * ring;
        let a = (it as f32 + 0.5) / self.theta as f32 * TAU;
        (r * a.cos(), r * a.sin())
    }

    /// The heading that takes cycle `k` toward cell (`it`, `ir`): along
    /// whichever way is further, unless that is straight back.
    fn toward(&self, k: usize, it: i32, ir: i32) -> Dir {
        let c = &self.cycles[k];
        let ring = (1.0 - HOLE) / self.radial as f32;
        let r = HOLE + (c.ir as f32 + 0.5) * ring;
        let half = self.theta as i32 / 2;
        let mut dt = it.rem_euclid(self.theta as i32) - c.it as i32;
        if dt > half {
            dt -= self.theta as i32;
        } else if dt < -half {
            dt += self.theta as i32;
        }
        let along = dt as f32 * r * TAU / self.theta as f32;
        let across = (ir - c.ir as i32) as f32 * ring;
        let round = if along >= 0.0 { Dir::Ccw } else { Dir::Cw };
        let radial = if across >= 0.0 { Dir::Out } else { Dir::In };
        let (major, minor) = if along.abs() >= across.abs() {
            (round, radial)
        } else {
            (radial, round)
        };
        if major != c.heading.reverse() {
            major
        } else {
            minor
        }
    }

    fn lay(&mut self, k: usize, it: usize, ir: usize, len: f32) {
        let i = self.idx(it, ir);
        self.wall[i] = k as u8;
        let c = &mut self.cycles[k];
        c.trail.push_back((i, len));
        c.trail_len += len;
        while c.trail_len > TRAIL_LENGTH && c.trail.len() > 1 {
            let (j, l) = c.trail.pop_front().unwrap();
            c.trail_len -= l;
            if self.wall[j] == k as u8 {
                self.wall[j] = NONE;
            }
        }
    }

    /// Take cycle `k`'s wall down, fading it out in its color if `derez`.
    fn clear_wall(&mut self, k: usize, derez: bool) {
        let trail = std::mem::take(&mut self.cycles[k].trail);
        self.cycles[k].trail_len = 0.0;
        for (i, _) in trail {
            if self.wall[i] == k as u8 {
                self.wall[i] = NONE;
                if derez {
                    self.fade[i] = (k as u8, 200);
                }
            }
        }
    }

    fn burst(&mut self, k: usize, it: usize, ir: usize) {
        for dr in -2i32..=2 {
            for dt in -1i32..=1 {
                let r = ir as i32 + dr;
                if r < 0 || r >= self.radial as i32 {
                    continue;
                }
                let t = (it as i32 + dt).rem_euclid(self.theta as i32) as usize;
                let i = self.idx(t, r as usize);
                let glow = 255 - (dr.unsigned_abs() * 30 + dt.unsigned_abs() * 40) as u8;
                if self.fade[i].1 < glow {
                    self.fade[i] = (k as u8, glow);
                }
            }
        }
    }

    fn derez(&mut self, k: usize, by: Option<usize>) {
        let (it, ir) = (self.cycles[k].it, self.cycles[k].ir);
        self.clear_wall(k, true);
        self.burst(k, it, ir);
        self.derezzes += 1;
        self.cycles[k].dead_until = self.ticks + RESPAWN_TICKS;
        if let Some(j) = by.filter(|&j| j != k) {
            self.cycles[j].kills += 1;
        }
    }

    /// Put cycle `k` on the road at (`it`, `ir`) heading `d`.
    fn ride_in(&mut self, k: usize, it: usize, ir: usize, d: Dir) {
        let c = &mut self.cycles[k];
        c.it = it;
        c.ir = ir;
        c.heading = d;
        c.progress = 0.0;
        c.dead_until = 0;
        let len = self.step_len(ir, d);
        self.lay(k, it, ir, len);
    }

    /// Somewhere with open road ahead, round the middle of the strip.
    fn respawn(&mut self, k: usize) {
        let mut best = None;
        let mut best_road = 0.0;
        for _ in 0..24 {
            let it = self.rng.next_below(self.theta as u64) as usize;
            let ir = self.radial / 4 + self.rng.next_below(self.radial as u64 / 2) as usize;
            let d = if self.rng.next_below(2) == 0 { Dir::Ccw } else { Dir::Cw };
            if !self.open(Some((it, ir))) {
                continue;
            }
            let road = self.road(it, ir, d, 0.6);
            if road > best_road {
                best_road = road;
                best = Some((it, ir, d));
            }
        }
        if let Some((it, ir, d)) = best {
            self.ride_in(k, it, ir, d);
        } else {
            // Nowhere good: try again next tick.
            self.cycles[k].dead_until = self.ticks + 1;
        }
    }

    pub fn tick(&mut self) {
        self.ticks += 1;
        for f in &mut self.fade {
            f.1 = f.1.saturating_sub(FADE);
        }
        for k in 0..self.cycles.len() {
            if self.cycles[k].dead_until != 0 {
                if self.ticks >= self.cycles[k].dead_until {
                    self.respawn(k);
                }
                continue;
            }
            self.cycles[k].progress += SPEED * TICK_SECS;
            loop {
                let c = &self.cycles[k];
                let cost = self.step_len(c.ir, c.heading);
                if c.progress < cost {
                    break;
                }
                if c.human_until <= self.ticks {
                    self.ai_turn(k);
                }
                let (it, ir, d) = (self.cycles[k].it, self.cycles[k].ir, self.cycles[k].heading);
                let cost = self.step_len(ir, d);
                self.cycles[k].progress -= cost;
                match self.next(it, ir, d) {
                    None => {
                        self.derez(k, None);
                        break;
                    }
                    Some((nt, nr)) => {
                        let owner = self.wall[self.idx(nt, nr)];
                        if owner != NONE {
                            self.cycles[k].it = nt;
                            self.cycles[k].ir = nr;
                            self.derez(k, Some(owner as usize));
                            break;
                        }
                        self.cycles[k].it = nt;
                        self.cycles[k].ir = nr;
                        let len = self.step_len(nr, d);
                        self.lay(k, nt, nr, len);
                    }
                }
            }
        }
    }

    /// Before each step: swerve from walls a few cells ahead, toward the
    /// side with more road, and now and then turn for no reason.
    fn ai_turn(&mut self, k: usize) {
        let c = &self.cycles[k];
        let (it, ir, d) = (c.it, c.ir, c.heading);
        let ahead = self.road(it, ir, d, AI_LOOK);
        if ahead < AI_LOOK {
            if self.rng.next_below(AI_MISS) == 0 {
                return; // didn't see it
            }
            let left = self.road(it, ir, d.left(), 0.6);
            let right = self.road(it, ir, d.right(), 0.6);
            if left > ahead || right > ahead {
                self.cycles[k].heading = if left >= right { d.left() } else { d.right() };
            }
            return;
        }
        // Go after the nearest rival close by: aim a little ahead of it to
        // cut it off.
        if self.rng.next_below(AI_HUNT) == 0 {
            let here = self.at(it, ir);
            let rival = (0..self.cycles.len())
                .filter(|&j| j != k && self.cycles[j].dead_until == 0)
                .map(|j| {
                    let o = &self.cycles[j];
                    let p = self.at(o.it, o.ir);
                    (j, (p.0 - here.0).hypot(p.1 - here.1))
                })
                .filter(|&(_, dist)| dist < AI_HUNT_RANGE)
                .min_by(|a, b| a.1.total_cmp(&b.1));
            if let Some((j, _)) = rival {
                let o = &self.cycles[j];
                let (dt, dr) = o.heading.delta();
                let lead = if o.heading.radial() { 8 } else { 2 };
                let turn = self.toward(k, o.it as i32 + dt * lead, o.ir as i32 + dr * lead);
                if turn != d && self.road(it, ir, turn, 0.12) >= 0.12 {
                    self.cycles[k].heading = turn;
                }
                return;
            }
        }
        if self.rng.next_below(AI_WANDER) == 0 {
            let turn = if self.rng.next_below(2) == 0 { d.left() } else { d.right() };
            if self.road(it, ir, turn, 0.2) >= 0.2 {
                self.cycles[k].heading = turn;
            }
        }
    }

    fn take(&mut self, k: usize) {
        self.cycles[k].human_until = self.ticks + HUMAN_TICKS;
    }

    /// A tap: turn toward the point, never straight back.
    pub fn inject(&mut self, it: i32, ir: i32, species: u8) {
        let k = (species % self.slots) as usize;
        self.take(k);
        if self.cycles[k].dead_until != 0 {
            return;
        }
        self.cycles[k].heading = self.toward(k, it, ir);
    }

    pub fn command(&mut self, command: GameCommand, species: u8) {
        let k = (species % self.slots) as usize;
        let turn = match command {
            GameCommand::TurnLeft => Dir::left,
            GameCommand::TurnRight => Dir::right,
            _ => return,
        };
        self.take(k);
        let c = &mut self.cycles[k];
        if c.dead_until == 0 {
            c.heading = turn(c.heading);
        }
    }

    pub fn watchdog(&mut self) {}

    /// Walls in their color, heads blazing, derezzed walls fading out, and
    /// the rim and the hole's edge drawn faintly so the arena has walls.
    pub fn pack_cells(&self) -> Vec<u32> {
        use super::hsv_to_packed_rgb as rgb;
        let (theta, radial) = (self.theta, self.radial);
        let mut out = vec![0u32; theta * radial];
        let edge = rgb(0.55, 0.5, 0.1);
        for it in 0..theta {
            out[it] = edge;
            out[(radial - 1) * theta + it] = edge;
        }
        for (i, &(slot, glow)) in self.fade.iter().enumerate() {
            if glow > 0 && slot != NONE {
                out[i] = rgb(self.slot_hue(slot), 0.7, glow as f32 / 255.0);
            }
        }
        for (i, &w) in self.wall.iter().enumerate() {
            if w != NONE {
                out[i] = rgb(self.slot_hue(w), 0.9, 0.6);
            }
        }
        for (k, c) in self.cycles.iter().enumerate() {
            if c.dead_until != 0 {
                continue;
            }
            let human = c.human_until > self.ticks;
            out[self.idx(c.it, c.ir)] =
                rgb(self.slot_hue(k as u8), 0.3, if human { 1.0 } else { 0.85 });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> TrailsSim {
        TrailsSim::new(64, 48, 4, 13)
    }

    /// Every cycle human-held (no AI turns) and every wall cleared.
    fn quiet(s: &mut TrailsSim) {
        for k in 0..s.cycles.len() {
            s.cycles[k].human_until = u32::MAX;
            s.clear_wall(k, false);
        }
    }

    #[test]
    fn left_turns_go_round_as_seen_on_the_preview() {
        assert_eq!(Dir::Out.left(), Dir::Ccw);
        assert_eq!(Dir::Ccw.left(), Dir::In);
        assert_eq!(Dir::In.left(), Dir::Cw);
        assert_eq!(Dir::Cw.left(), Dir::Out);
        for d in [Dir::Out, Dir::Ccw, Dir::In, Dir::Cw] {
            assert_eq!(d.left().right(), d);
            assert_eq!(d.reverse().reverse(), d);
        }
    }

    #[test]
    fn a_step_round_the_rim_is_longer_than_a_step_out() {
        let s = sim();
        let out = s.step_len(46, Dir::Out);
        let round_rim = s.step_len(46, Dir::Ccw);
        let round_hole = s.step_len(0, Dir::Ccw);
        assert!(round_rim > 6.0 * out, "{round_rim} vs {out}");
        assert!(round_hole < round_rim / 2.5);
    }

    #[test]
    fn hitting_a_wall_derezzes_and_credits_its_owner() {
        let mut s = sim();
        quiet(&mut s);
        // Cycle 1's wall across cycle 0's path.
        for ir in 10..20 {
            let i = s.idx(30, ir);
            s.wall[i] = 1;
        }
        s.cycles[0].it = 27;
        s.cycles[0].ir = 15;
        s.cycles[0].heading = Dir::Ccw;
        for _ in 0..60 {
            s.tick();
            if s.cycles[0].dead_until != 0 {
                break;
            }
        }
        assert!(s.cycles[0].dead_until != 0, "rode through a wall");
        assert_eq!(s.cycles[1].kills, 1);
        assert!(s.cycles[0].trail.is_empty(), "its own wall came down");
    }

    #[test]
    fn the_hole_and_the_rim_are_walls() {
        for (ir, d) in [(1, Dir::In), (46, Dir::Out)] {
            let mut s = sim();
            quiet(&mut s);
            s.cycles[0].it = 5;
            s.cycles[0].ir = ir;
            s.cycles[0].heading = d;
            for _ in 0..10 {
                s.tick();
            }
            assert!(s.cycles[0].dead_until != 0, "ring {ir} heading {d:?}");
            assert_eq!(s.cycles.iter().map(|c| c.kills).sum::<u32>(), 0, "nobody's credit");
        }
    }

    #[test]
    fn a_wall_has_a_fixed_length() {
        let mut s = sim();
        quiet(&mut s);
        s.set_slots(2);
        s.cycles[1].dead_until = u32::MAX;
        s.cycles[0].it = 0;
        s.cycles[0].ir = 24;
        s.cycles[0].heading = Dir::Ccw;
        for _ in 0..400 {
            s.tick();
        }
        assert_eq!(s.cycles[0].dead_until, 0, "riding round the middle is safe");
        let c = &s.cycles[0];
        assert!(c.trail_len <= TRAIL_LENGTH + 0.1, "{}", c.trail_len);
        let laid = s.wall.iter().filter(|&&w| w == 0).count();
        assert_eq!(laid, c.trail.len());
        assert!(laid < 64, "the tail must fade: {laid} cells");
    }

    #[test]
    fn buttons_turn_that_colors_cycle() {
        let mut s = sim();
        quiet(&mut s);
        s.cycles[2].heading = Dir::Out;
        s.command(GameCommand::TurnLeft, 2);
        assert_eq!(s.cycles[2].heading, Dir::Ccw);
        s.command(GameCommand::TurnRight, 2);
        s.command(GameCommand::TurnRight, 2);
        assert_eq!(s.cycles[2].heading, Dir::Cw);
        s.command(GameCommand::Fire, 2);
        assert_eq!(s.cycles[2].heading, Dir::Cw, "not a Trails button");
    }

    #[test]
    fn a_tap_turns_toward_the_point_but_never_straight_back() {
        let mut s = sim();
        quiet(&mut s);
        s.cycles[0].it = 10;
        s.cycles[0].ir = 20;
        s.cycles[0].heading = Dir::Ccw;
        s.inject(10, 40, 0); // straight out
        assert_eq!(s.cycles[0].heading, Dir::Out);
        s.inject(10, 2, 0); // straight in — that's a U-turn, so round instead
        assert_ne!(s.cycles[0].heading, Dir::In);
        s.cycles[0].heading = Dir::Out;
        s.inject(4, 20, 0); // round the ring the low way
        assert_eq!(s.cycles[0].heading, Dir::Cw);
        assert!(s.cycles[0].human_until > s.ticks);
    }

    #[test]
    fn with_nobody_riding_the_ai_rides_well_and_still_crashes() {
        let mut crashes = 0;
        for seed in 0..4 {
            let mut s = TrailsSim::new(64, 48, 4, seed);
            for _ in 0..20 * 120 {
                s.tick();
            }
            crashes += s.derezzes;
        }
        // Four cycles for two minutes, four times: some crashes, but nobody
        // derezzes every few seconds.
        assert!(crashes > 4, "the AI never crashes: {crashes}");
        assert!(crashes < 4 * 4 * 12, "the AI is hopeless: {crashes}");
    }

    #[test]
    fn respawned_cycles_ride_back_in() {
        let mut s = sim();
        quiet(&mut s);
        s.derez(0, None);
        for _ in 0..RESPAWN_TICKS + 2 {
            s.tick();
        }
        assert_eq!(s.cycles[0].dead_until, 0);
        assert!(!s.cycles[0].trail.is_empty());
    }

    #[test]
    fn pack_draws_the_arena_and_the_cycles() {
        let s = sim();
        let out = s.pack_cells();
        assert!(out[0] != 0 && out[47 * 64] != 0, "hole edge and rim");
        let c = &s.cycles[0];
        assert!(out[c.ir * 64 + c.it] != 0);
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = TrailsSim::new(64, 48, 5, 8);
        let mut b = TrailsSim::new(64, 48, 5, 8);
        for _ in 0..1500 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.wall, b.wall);
        assert_eq!(a.pack_cells(), b.pack_cells());
    }
}

