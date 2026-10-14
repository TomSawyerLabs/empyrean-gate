//! Rally — Pong for any number of players (plans/classic-games.md).
//!
//! The rim is shared out: every color owns an equal arc of it, with a
//! paddle that slides inside its arc. Balls bounce around the strip, off
//! the hole in the middle (a round bumper) and off the paddles; a ball that
//! gets past a paddle out through its arc is a point for whoever hit it
//! last. Pong's own rule makes the returns: where the ball meets the paddle
//! decides where it goes, the edge of the paddle sending it off at a slant.
//! A rally speeds the ball up a little with every hit, and a miss serves a
//! fresh, slower one.
//!
//! A paddle is AI-played until someone taps with its color — the tap is
//! where the paddle should go, clamped to its own arc — and goes back to the
//! AI [`HUMAN_TICKS`] after their last tap. The AI tracks where each ball
//! will reach the rim, a little late and a little off, so it misses
//! sometimes. More people playing means more balls in play.
//!
//! World coordinates like Perimeter: the unit disc, the hole at [`HOLE`].

use super::{GameCommand, SplitMix64};
use std::f32::consts::{PI, TAU};

/// Fixed step, shared with the other particle sims.
pub const TICK_SECS: f32 = 0.05;
const DT: f32 = TICK_SECS;

/// The hole: the bumper's surface.
pub const HOLE: f32 = 0.32;
/// Where a ball meets the paddles (just inside the outermost rings).
const PADDLE_R: f32 = 0.95;
const BALL_R: f32 = 0.02;
/// Half the paddle's width, as a fraction of its arc (capped in radians).
const PADDLE_FRACTION: f32 = 0.16;
const PADDLE_HALF_MAX: f32 = 0.3;
/// Paddle speed, radians per second (human / AI).
const PADDLE_SPEED: f32 = 3.2;
const AI_PADDLE_SPEED: f32 = 1.2;
/// How far off a hit's offset can send the return, radians from straight in.
const MAX_DEFLECT: f32 = 1.0;

const SERVE_SPEED: f32 = 0.42;
const SPEEDUP: f32 = 1.06;
const MAX_SPEED: f32 = 1.05;
/// A served ball waits this long (1 s) before it moves.
const SERVE_TICKS: u32 = 20;
/// Balls in play: one, plus one for every two people playing, up to four.
const MAX_BALLS: usize = 4;

const HUMAN_TICKS: u32 = 300;
/// AI: how often it re-reads the balls, and its aim error (radians,
/// re-rolled for each ball it chases): a little for a slow ball, more per
/// unit of ball speed, so a long rally builds toward a miss.
const AI_THINK_TICKS: u32 = 4;
const AI_SPEED_ERROR: f32 = 0.3;
const AI_AIM_ERROR: f32 = 0.12;

/// Glows fade this much per tick.
const GLOW_DECAY: u8 = 22;
const FLASH_TICKS: u8 = 12;

#[derive(Clone, Copy, Debug, PartialEq)]
struct Ball {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    /// Waiting to be served (ticks left).
    wait: u32,
    last_hitter: Option<u8>,
    /// Hits this rally.
    hits: u32,
}

impl Ball {
    fn speed(&self) -> f32 {
        self.vx.hypot(self.vy)
    }
}

#[derive(Clone, Copy, Debug)]
struct Paddle {
    /// Center angle.
    at: f32,
    target: f32,
    human_until: u32,
    ai_next: u32,
    ai_error: f32,
    points: u32,
    /// Lit up by a hit (ticks left), or by a miss.
    hit_flash: u8,
    miss_flash: u8,
}

pub struct RallySim {
    theta: usize,
    radial: usize,
    slots: u8,
    paddles: Vec<Paddle>,
    balls: Vec<Ball>,
    /// Ball trails: (slot or NONE, glow) per cell.
    trail: Vec<(u8, u8)>,
    rng: SplitMix64,
    ticks: u32,
    bumper_flash: u8,
    longest_rally: u32,
    hits: u32,
    goals: u32,
}

const NONE: u8 = 0xff;

fn wrap(a: f32) -> f32 {
    (a + PI).rem_euclid(TAU) - PI
}

impl RallySim {
    pub fn new(theta: usize, radial: usize, slots: u8, seed: u64) -> Self {
        let mut sim = Self {
            theta,
            radial,
            slots: 0,
            paddles: Vec::new(),
            balls: Vec::new(),
            trail: vec![(NONE, 0); theta * radial],
            rng: SplitMix64::new(seed),
            ticks: 0,
            bumper_flash: 0,
            longest_rally: 0,
            hits: 0,
            goals: 0,
        };
        sim.set_slots(slots);
        sim.serve();
        sim
    }

    pub fn theta(&self) -> usize {
        self.theta
    }

    pub fn radial(&self) -> usize {
        self.radial
    }

    /// One paddle per color; the arcs are re-dealt and every paddle goes to
    /// the middle of its new arc. Scores carry over.
    pub fn set_slots(&mut self, slots: u8) {
        let slots = slots.clamp(2, 8);
        if slots == self.slots {
            return;
        }
        self.slots = slots;
        self.paddles.truncate(slots as usize);
        while self.paddles.len() < slots as usize {
            self.paddles.push(Paddle {
                at: 0.0,
                target: 0.0,
                human_until: 0,
                ai_next: 0,
                ai_error: 0.0,
                points: 0,
                hit_flash: 0,
                miss_flash: 0,
            });
        }
        for k in 0..self.paddles.len() {
            let mid = self.arc_mid(k);
            self.paddles[k].at = mid;
            self.paddles[k].target = mid;
        }
        for b in &mut self.balls {
            if let Some(h) = b.last_hitter {
                if h >= slots {
                    b.last_hitter = None;
                }
            }
        }
    }

    pub fn ball_count(&self) -> usize {
        self.balls.len()
    }

    pub fn detail(&self) -> String {
        let mut line = match self
            .paddles
            .iter()
            .enumerate()
            .filter(|(_, p)| p.points > 0)
            .max_by_key(|(_, p)| p.points)
        {
            Some((k, p)) => format!("color {} leads with {}", k + 1, p.points),
            None => "no points yet".to_string(),
        };
        line.push_str(&format!(" · longest rally {}", self.longest_rally));
        line
    }

    fn arc_width(&self) -> f32 {
        TAU / self.slots as f32
    }

    /// Arc `k` runs from `k·w` to `(k+1)·w`, angles as on the grid.
    fn arc_mid(&self, k: usize) -> f32 {
        wrap((k as f32 + 0.5) * self.arc_width())
    }

    fn arc_of(&self, angle: f32) -> usize {
        ((angle.rem_euclid(TAU) / self.arc_width()) as usize).min(self.slots as usize - 1)
    }

    fn paddle_half(&self) -> f32 {
        (self.arc_width() * PADDLE_FRACTION).min(PADDLE_HALF_MAX)
    }

    /// Keep a paddle center inside its own arc.
    fn clamp_to_arc(&self, k: usize, angle: f32) -> f32 {
        let mid = self.arc_mid(k);
        let room = self.arc_width() / 2.0 - self.paddle_half();
        mid + wrap(angle - mid).clamp(-room, room)
    }

    fn humans(&self) -> usize {
        self.paddles.iter().filter(|p| p.human_until > self.ticks).count()
    }

    fn balls_wanted(&self) -> usize {
        (1 + self.humans() / 2).min(MAX_BALLS)
    }

    fn unit(&mut self) -> f32 {
        self.rng.next_below(10_000) as f32 / 10_000.0
    }

    fn serve(&mut self) {
        let a = self.unit() * TAU;
        let r = 0.55 + 0.1 * self.unit();
        // Off toward a random arc, at a slant so it doesn't just go straight
        // back and forth on one spoke.
        let dir = a + (self.unit() - 0.5) * 1.6;
        self.balls.push(Ball {
            x: r * a.cos(),
            y: r * a.sin(),
            vx: SERVE_SPEED * dir.cos(),
            vy: SERVE_SPEED * dir.sin(),
            wait: SERVE_TICKS,
            last_hitter: None,
            hits: 0,
        });
    }

    fn cell_of(&self, x: f32, y: f32) -> Option<(usize, usize)> {
        let rn = x.hypot(y);
        let ir = (rn - HOLE) / (1.0 - HOLE) * self.radial as f32;
        if !(0.0..self.radial as f32).contains(&ir) {
            return None;
        }
        let a = y.atan2(x).rem_euclid(TAU);
        let it = ((a / TAU * self.theta as f32) as usize).min(self.theta - 1);
        Some((it, ir as usize))
    }

    fn cell_angle(&self, it: i32) -> f32 {
        wrap((it as f32 + 0.5) / self.theta as f32 * TAU)
    }

    pub fn tick(&mut self) {
        self.ticks += 1;
        for t in &mut self.trail {
            t.1 = t.1.saturating_sub(GLOW_DECAY);
        }
        self.bumper_flash = self.bumper_flash.saturating_sub(1);
        for p in &mut self.paddles {
            p.hit_flash = p.hit_flash.saturating_sub(1);
            p.miss_flash = p.miss_flash.saturating_sub(1);
        }
        self.tick_paddles();
        self.tick_balls();
        // Top the balls up to the crowd; extras leave at their next goal.
        while self.balls.len() < self.balls_wanted() {
            self.serve();
        }
    }

    fn tick_paddles(&mut self) {
        let ticks = self.ticks;
        for k in 0..self.paddles.len() {
            let human = self.paddles[k].human_until > ticks;
            if !human && ticks >= self.paddles[k].ai_next {
                self.paddles[k].ai_next = ticks + AI_THINK_TICKS;
                if let Some(target) = self.ai_target(k) {
                    self.paddles[k].target = target;
                }
            }
            let speed = if human { PADDLE_SPEED } else { AI_PADDLE_SPEED } * DT;
            let p = self.paddles[k];
            let to = self.clamp_to_arc(k, p.target);
            let at = p.at + wrap(to - p.at).clamp(-speed, speed);
            self.paddles[k].at = self.clamp_to_arc(k, at);
        }
    }

    /// Where the soonest ball heading for this paddle's arc will cross the
    /// paddle ring, give or take this paddle's aim error; the middle of the
    /// arc when nothing is coming.
    fn ai_target(&mut self, k: usize) -> Option<f32> {
        let mut soonest: Option<(f32, f32, f32)> = None;
        for b in &self.balls {
            if b.wait > 0 {
                continue;
            }
            // Ray to the paddle ring: |p + v t| = PADDLE_R.
            let (px, py, vx, vy) = (b.x, b.y, b.vx, b.vy);
            let a = vx * vx + vy * vy;
            let bb = 2.0 * (px * vx + py * vy);
            let c = px * px + py * py - PADDLE_R * PADDLE_R;
            let disc = bb * bb - 4.0 * a * c;
            if disc < 0.0 || a <= 0.0 {
                continue;
            }
            let t = (-bb + disc.sqrt()) / (2.0 * a);
            if t <= 0.0 {
                continue;
            }
            // Through the hole? Then it bounces first; don't chase it yet.
            let tmin = -(px * vx + py * vy) / a;
            if tmin > 0.0 && tmin < t {
                let cx = px + vx * tmin;
                let cy = py + vy * tmin;
                if cx.hypot(cy) < HOLE + BALL_R {
                    continue;
                }
            }
            let angle = (py + vy * t).atan2(px + vx * t);
            if self.arc_of(angle) == k && soonest.is_none_or(|(st, _, _)| t < st) {
                soonest = Some((t, angle, a.sqrt()));
            }
        }
        match soonest {
            Some((_, angle, speed)) => {
                if self.paddles[k].ai_error == 0.0 {
                    let spread = AI_AIM_ERROR + AI_SPEED_ERROR * speed;
                    self.paddles[k].ai_error = (self.unit() - 0.5) * 2.0 * spread + 1e-4;
                }
                Some(angle + self.paddles[k].ai_error)
            }
            None => {
                self.paddles[k].ai_error = 0.0;
                Some(self.arc_mid(k))
            }
        }
    }

    fn tick_balls(&mut self) {
        let mut i = 0;
        while i < self.balls.len() {
            let mut b = self.balls[i];
            if b.wait > 0 {
                b.wait -= 1;
                self.balls[i] = b;
                i += 1;
                continue;
            }
            b.x += b.vx * DT;
            b.y += b.vy * DT;
            let r = b.x.hypot(b.y);
            // The bumper: reflect off the hole's edge.
            if r < HOLE + BALL_R {
                let (nx, ny) = (b.x / r, b.y / r);
                let dot = b.vx * nx + b.vy * ny;
                if dot < 0.0 {
                    b.vx -= 2.0 * dot * nx;
                    b.vy -= 2.0 * dot * ny;
                }
                let push = (HOLE + BALL_R) / r;
                b.x *= push;
                b.y *= push;
                self.bumper_flash = FLASH_TICKS;
            }
            let r = b.x.hypot(b.y);
            if r >= PADDLE_R && b.vx * b.x + b.vy * b.y > 0.0 {
                let angle = b.y.atan2(b.x);
                let k = self.arc_of(angle);
                let offset = wrap(angle - self.paddles[k].at);
                let reach = self.paddle_half() + BALL_R / PADDLE_R;
                if offset.abs() <= reach {
                    // Pong's return: straight in from the middle of the
                    // paddle, slanting more the nearer the edge.
                    let speed = (b.speed() * SPEEDUP).min(MAX_SPEED);
                    let out = angle + PI + (offset / reach) * MAX_DEFLECT;
                    b.vx = speed * out.cos();
                    b.vy = speed * out.sin();
                    let pull = (PADDLE_R - 0.001) / r;
                    b.x *= pull;
                    b.y *= pull;
                    b.last_hitter = Some(k as u8);
                    b.hits += 1;
                    self.hits += 1;
                    self.longest_rally = self.longest_rally.max(b.hits);
                    self.paddles[k].hit_flash = FLASH_TICKS;
                    self.paddles[k].ai_error = 0.0;
                } else {
                    // Past the paddle: a point for the last hitter (unless
                    // it was the arc's own owner).
                    self.goals += 1;
                    self.paddles[k].miss_flash = FLASH_TICKS;
                    self.paddles[k].ai_error = 0.0;
                    if let Some(h) = b.last_hitter.filter(|&h| h as usize != k) {
                        self.paddles[h as usize].points += 1;
                    }
                    self.balls.swap_remove(i);
                    if self.balls.len() < self.balls_wanted() {
                        self.serve();
                    }
                    continue;
                }
            }
            if let Some((it, ir)) = self.cell_of(b.x, b.y) {
                let idx = ir * self.theta + it;
                self.trail[idx] = (b.last_hitter.unwrap_or(NONE), 180);
            }
            self.balls[i] = b;
            i += 1;
        }
    }

    /// A tap: this color's paddle heads for the tapped angle, within its arc.
    pub fn inject(&mut self, it: i32, _ir: i32, species: u8) {
        let k = (species % self.slots) as usize;
        self.paddles[k].human_until = self.ticks + HUMAN_TICKS;
        self.paddles[k].target = self.cell_angle(it);
    }

    /// Rally has no buttons.
    pub fn command(&mut self, _command: GameCommand, _species: u8) {}

    pub fn watchdog(&mut self) {}

    /// The arcs along the rim in their owners' colors, the paddles bright on
    /// them, the bumper, ball trails, and the balls.
    pub fn pack_cells(&self) -> Vec<u32> {
        use super::hsv_to_packed_rgb as rgb;
        let (theta, radial) = (self.theta, self.radial);
        let mut out = vec![0u32; theta * radial];
        let hue = |k: usize| k as f32 / self.slots as f32;
        let half = self.paddle_half();
        for it in 0..theta {
            let a = self.cell_angle(it as i32);
            let k = self.arc_of(a);
            let p = &self.paddles[k];
            // A dark seam where one arc meets the next.
            let seam = self.arc_of(self.cell_angle(it as i32 - 1)) != k;
            if !seam {
                // A miss lights the whole arc white for a moment (not red:
                // red is somebody's color).
                let (s, v) = if p.miss_flash > 0 { (0.0, 0.65) } else { (0.8, 0.12) };
                out[(radial - 1) * theta + it] = rgb(hue(k), s, v);
            }
            if wrap(a - p.at).abs() <= half {
                let human = p.human_until > self.ticks;
                let v = if p.hit_flash > 0 { 1.0 } else if human { 0.95 } else { 0.75 };
                let s = if p.hit_flash > 0 { 0.4 } else { 0.85 };
                let c = rgb(hue(k), s, v);
                for ir in radial.saturating_sub(4)..radial - 1 {
                    out[ir * theta + it] = c;
                }
            }
            // The bumper.
            let v = 0.12 + 0.6 * self.bumper_flash as f32 / FLASH_TICKS as f32;
            out[it] = rgb(0.0, 0.0, v);
        }
        for (i, &(slot, glow)) in self.trail.iter().enumerate() {
            if glow == 0 {
                continue;
            }
            let v = glow as f32 / 255.0 * 0.6;
            out[i] = if slot == NONE {
                rgb(0.0, 0.0, v)
            } else {
                rgb(hue(slot as usize), 0.7, v)
            };
        }
        for b in &self.balls {
            if let Some((it, ir)) = self.cell_of(b.x, b.y) {
                let blink = b.wait > 0 && (b.wait / 3) % 2 == 0;
                let c = if blink { rgb(0.0, 0.0, 0.3) } else { rgb(0.14, 0.1, 1.0) };
                for r in ir.saturating_sub(1)..=(ir + 1).min(radial - 1) {
                    out[r * theta + it] = c;
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> RallySim {
        RallySim::new(64, 48, 4, 31)
    }

    fn ball(x: f32, y: f32, vx: f32, vy: f32) -> Ball {
        Ball {
            x,
            y,
            vx,
            vy,
            wait: 0,
            last_hitter: None,
            hits: 0,
        }
    }

    /// Every paddle human-held and parked where it is.
    fn hold(s: &mut RallySim) {
        for p in &mut s.paddles {
            p.human_until = u32::MAX;
            p.target = p.at;
        }
    }

    #[test]
    fn the_rim_is_dealt_out_in_equal_arcs() {
        let s = sim();
        assert_eq!(s.arc_of(0.1), 0);
        assert_eq!(s.arc_of(PI / 2.0 + 0.1), 1);
        assert_eq!(s.arc_of(-0.1), 3);
        // A paddle can't leave its arc.
        let edge = s.clamp_to_arc(0, 2.0);
        assert!(edge < PI / 2.0 - s.paddle_half() + 1e-4);
    }

    #[test]
    fn the_hole_is_a_bumper() {
        let mut s = sim();
        hold(&mut s);
        s.balls = vec![ball(0.45, 0.0, -0.5, 0.0)];
        for _ in 0..20 {
            s.tick();
        }
        let b = s.balls[0];
        assert!(b.vx > 0.0, "bounced back out: {b:?}");
        assert!((b.speed() - 0.5).abs() < 1e-3, "a bumper keeps the speed");
        assert!(b.x.hypot(b.y) >= HOLE);
    }

    #[test]
    fn the_middle_of_the_paddle_returns_straight_and_faster() {
        let mut s = sim();
        hold(&mut s);
        let mid = s.paddles[0].at;
        s.balls = vec![ball(0.85 * mid.cos(), 0.85 * mid.sin(), 0.6 * mid.cos(), 0.6 * mid.sin())];
        for _ in 0..8 {
            s.tick();
        }
        let b = s.balls[0];
        assert_eq!(b.last_hitter, Some(0));
        let out = b.vy.atan2(b.vx);
        assert!(wrap(out - (mid + PI)).abs() < 0.05, "straight back in");
        assert!(b.speed() > 0.6, "a rally speeds up");
    }

    #[test]
    fn the_edge_of_the_paddle_slants_the_return() {
        let mut s = sim();
        hold(&mut s);
        let mid = s.paddles[0].at;
        let a = mid + s.paddle_half() * 0.9;
        s.balls = vec![ball(0.85 * a.cos(), 0.85 * a.sin(), 0.6 * a.cos(), 0.6 * a.sin())];
        for _ in 0..8 {
            s.tick();
        }
        let b = s.balls[0];
        assert_eq!(b.last_hitter, Some(0));
        let out = b.vy.atan2(b.vx);
        assert!(wrap(out - (a + PI)).abs() > 0.5, "an edge hit goes off at a slant");
    }

    #[test]
    fn a_miss_is_a_point_for_the_last_hitter_and_a_new_serve() {
        let mut s = sim();
        hold(&mut s);
        // Into arc 1, well away from its paddle, last hit by color 3.
        let a = s.arc_mid(1) + s.paddle_half() * 2.5;
        let mut b = ball(0.85 * a.cos(), 0.85 * a.sin(), 0.6 * a.cos(), 0.6 * a.sin());
        b.last_hitter = Some(3);
        s.balls = vec![b];
        for _ in 0..8 {
            s.tick();
        }
        assert_eq!(s.paddles[3].points, 1);
        assert_eq!(s.goals, 1);
        assert_eq!(s.ball_count(), s.balls_wanted(), "served again");
        assert!(s.balls.iter().any(|b| b.wait > 0), "the new ball waits a moment");
    }

    #[test]
    fn missing_your_own_return_is_nobodys_point() {
        let mut s = sim();
        hold(&mut s);
        let a = s.arc_mid(2) + s.paddle_half() * 2.5;
        let mut b = ball(0.85 * a.cos(), 0.85 * a.sin(), 0.6 * a.cos(), 0.6 * a.sin());
        b.last_hitter = Some(2);
        s.balls = vec![b];
        for _ in 0..8 {
            s.tick();
        }
        assert_eq!(s.paddles.iter().map(|p| p.points).sum::<u32>(), 0);
    }

    #[test]
    fn a_tap_moves_that_colors_paddle_within_its_arc() {
        let mut s = sim();
        s.inject(10, 30, 0); // cell 10 is inside arc 0 (cells 0..16)
        for _ in 0..30 {
            s.tick();
        }
        assert!((s.paddles[0].at - s.cell_angle(10)).abs() < 0.02);
        s.inject(40, 30, 0); // far outside arc 0: the paddle stops at the edge
        for _ in 0..30 {
            s.tick();
        }
        assert_eq!(s.arc_of(s.paddles[0].at), 0);
        assert!(s.paddles[0].human_until > s.ticks);
    }

    #[test]
    fn more_people_more_balls() {
        let mut s = sim();
        assert_eq!(s.balls_wanted(), 1);
        for k in 0..4 {
            s.inject(k * 16 + 8, 30, k as u8);
        }
        s.tick();
        assert_eq!(s.ball_count(), 3);
    }

    #[test]
    fn with_nobody_playing_the_ai_rallies_and_sometimes_misses() {
        let (mut hits, mut goals) = (0, 0);
        for seed in 0..4 {
            let mut s = RallySim::new(64, 48, 4, seed);
            for _ in 0..20 * 120 {
                s.tick();
            }
            hits += s.hits;
            goals += s.goals;
        }
        assert!(goals > 4, "the AI never misses: {goals} goals, {hits} hits");
        assert!(hits > goals * 2, "the AI can't rally: {hits} hits, {goals} goals");
    }

    #[test]
    fn pack_draws_arcs_paddles_and_the_ball() {
        let s = sim();
        let out = s.pack_cells();
        // Paddle 0 sits at the middle of arc 0 (cell 8).
        assert!(out[45 * 64 + 8] != 0);
        assert_eq!(out[47 * 64 + 16], 0, "seam between arcs 0 and 1");
        assert!(out[5] != 0, "the bumper");
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = RallySim::new(64, 48, 5, 2);
        let mut b = RallySim::new(64, 48, 5, 2);
        for _ in 0..1500 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.balls, b.balls);
        assert_eq!(a.pack_cells(), b.pack_cells());
    }
}

