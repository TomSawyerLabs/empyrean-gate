//! Spacewar — the 1962 original, around a real star (plans/classic-games.md).
//!
//! Spacewar!'s duel happened around a star whose gravity bent every
//! trajectory. On the Gate the hole *is* the star: ships orbit it, burn to
//! change course, and fire torpedoes that feel its pull too, so a good shot
//! can curve around the star into someone. Touch the star and you are gone.
//!
//! The original's screen wrapped at the edges. A ring can't wrap like that,
//! so leaving at the rim brings you back in at the opposite side of the
//! array, heading inward: the circle's own wrap-around.
//!
//! Every color is a ship. A tap means "go there": the ship swings its nose
//! toward the point and burns. The **Fire** button looses a torpedo along
//! the nose, and **Hyperspace** jumps the ship somewhere random — with the
//! original's small chance of not coming back. A ship is AI-flown until
//! someone taps or presses with its color, and goes back to the AI
//! [`HUMAN_TICKS`] after their last input. The AI keeps an orbit and duels,
//! with aim a little off, so the attract mode is a dogfight that someone
//! eventually wins. A destroyed ship is back in orbit after [`RESPAWN_TICKS`].
//!
//! World coordinates (the array's unit disc, the star the size of the
//! hole), rasterized to the polar grid at pack time like Perimeter.

use super::{GameCommand, SplitMix64};
use std::f32::consts::{PI, TAU};

/// Fixed step, shared with the other particle sims.
pub const TICK_SECS: f32 = 0.05;
const DT: f32 = TICK_SECS;

/// The star's surface: the hole.
pub const HOLE: f32 = 0.32;
/// Gravity, disc units³/s²: a circular orbit at r = 0.65 takes about 8 s.
const GM: f32 = 0.17;
/// Leaving past this radius brings you back in at the antipode.
const RIM: f32 = 1.0;

const THRUST: f32 = 0.9;
const MAX_SPEED: f32 = 1.3;
/// Radians per second the nose swings.
const TURN_RATE: f32 = 5.0;
/// A tap's burn: ticks of thrust once the nose is on target, and how long
/// the ship may spend turning before it gives up.
const BURN_TICKS: u32 = 8;
const AIM_TICKS: u32 = 24;
/// "On target" for a burn or a shot, radians.
const BURN_CONE: f32 = 0.45;

const TORP_SPEED: f32 = 0.95;
const TORP_TICKS: u32 = 32;
const FIRE_COOLDOWN: u32 = 8;
const MAX_TORPS_PER_SHIP: usize = 4;
const HIT_RADIUS: f32 = 0.035;
const SHIP_RADIUS: f32 = 0.05;

/// Hyperspace: gone this long, this often fatal (1-in-N), and not again
/// for a while.
const HYPER_TICKS: u32 = 20;
const HYPER_DOOM: u64 = 10;
const HYPER_COOLDOWN: u32 = 80;

const RESPAWN_TICKS: u32 = 60;
const HUMAN_TICKS: u32 = 300;

/// AI: the orbit band it keeps, how often it may fire, and its aim error.
const AI_ORBIT_MIN: f32 = 0.58;
const AI_ORBIT_MAX: f32 = 0.82;
const AI_FIRE_COOLDOWN: u32 = 40;
const AI_AIM_NOISE: f32 = 0.4;
const AI_RANGE: f32 = 0.7;

/// Trails and explosions fade this much per tick (~0.7 s), long enough to
/// draw a stretch of orbit behind each ship.
const GLOW_DECAY: u8 = 18;
/// Star flare length after something falls in.
const FLARE_TICKS: u32 = 14;

/// Glow tones that are not a ship's color.
const WHITE: u8 = 0xff;
const FIRE: u8 = 0xfe;

#[derive(Clone, Copy, Debug, PartialEq)]
struct V2 {
    x: f32,
    y: f32,
}

impl V2 {
    const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
    fn len(self) -> f32 {
        self.x.hypot(self.y)
    }
    fn add(self, o: V2) -> V2 {
        V2::new(self.x + o.x, self.y + o.y)
    }
    fn sub(self, o: V2) -> V2 {
        V2::new(self.x - o.x, self.y - o.y)
    }
    fn scale(self, k: f32) -> V2 {
        V2::new(self.x * k, self.y * k)
    }
    fn angle(self) -> f32 {
        self.y.atan2(self.x)
    }
    fn dir(a: f32) -> V2 {
        V2::new(a.cos(), a.sin())
    }
}

/// Signed shortest turn from `from` to `to`, radians.
fn turn(from: f32, to: f32) -> f32 {
    (to - from + PI).rem_euclid(TAU) - PI
}

fn gravity(p: V2) -> V2 {
    let r = p.len().max(HOLE * 0.5);
    p.scale(-GM / (r * r * r))
}

#[derive(Clone, Copy, Debug)]
struct Ship {
    pos: V2,
    vel: V2,
    heading: f32,
    /// A human's "go there", with ticks of burn left and ticks to get the
    /// nose round.
    aim: Option<V2>,
    burn: u32,
    aim_left: u32,
    thrusting: bool,
    human_until: u32,
    /// Destroyed: back at this tick (0 = flying).
    dead_until: u32,
    /// In hyperspace until this tick (0 = here).
    hyper_until: u32,
    hyper_ready: u32,
    fire_ready: u32,
    /// The AI's aim error for its next shot, re-rolled after each one (a
    /// fresh error every tick would average out to perfect aim).
    ai_bias: f32,
    kills: u32,
}

#[derive(Clone, Copy, Debug)]
struct Torp {
    pos: V2,
    vel: V2,
    owner: u8,
    left: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Glow {
    tone: u8,
    glow: u8,
}

const DARK: Glow = Glow { tone: WHITE, glow: 0 };

pub struct SpacewarSim {
    theta: usize,
    radial: usize,
    slots: u8,
    ships: Vec<Ship>,
    torps: Vec<Torp>,
    glow: Vec<Glow>,
    rng: SplitMix64,
    ticks: u32,
    flare: u32,
    fell_in: u32,
}

impl SpacewarSim {
    pub fn new(theta: usize, radial: usize, slots: u8, seed: u64) -> Self {
        let mut sim = Self {
            theta,
            radial,
            slots: 0,
            ships: Vec::new(),
            torps: Vec::with_capacity(32),
            glow: vec![DARK; theta * radial],
            rng: SplitMix64::new(seed),
            ticks: 0,
            flare: 0,
            fell_in: 0,
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
        self.slots = slots;
        self.ships.truncate(slots as usize);
        self.torps.retain(|t| t.owner < slots);
        while self.ships.len() < slots as usize {
            let k = self.ships.len();
            let a = k as f32 / slots as f32 * TAU;
            let mut ship = Ship {
                pos: V2::new(0.0, 0.0),
                vel: V2::new(0.0, 0.0),
                heading: 0.0,
                aim: None,
                burn: 0,
                aim_left: 0,
                thrusting: false,
                human_until: 0,
                dead_until: 0,
                hyper_until: 0,
                hyper_ready: 0,
                fire_ready: 0,
                ai_bias: 0.0,
                kills: 0,
            };
            self.place_in_orbit(&mut ship, a);
            self.ships.push(ship);
        }
    }

    pub fn detail(&self) -> String {
        let mut line = String::new();
        if let Some((k, s)) = self
            .ships
            .iter()
            .enumerate()
            .filter(|(_, s)| s.kills > 0)
            .max_by_key(|(_, s)| s.kills)
        {
            line.push_str(&format!("color {} leads with {} kills", k + 1, s.kills));
        } else {
            line.push_str("no kills yet");
        }
        line.push_str(&format!(" · {} fell into the star", self.fell_in));
        line
    }

    fn unit(&mut self) -> f32 {
        self.rng.next_below(10_000) as f32 / 10_000.0
    }

    fn slot_hue(&self, slot: u8) -> f32 {
        (slot % self.slots) as f32 / self.slots as f32
    }

    /// A circular orbit at angle `a`, counterclockwise, the nose along it.
    fn place_in_orbit(&mut self, ship: &mut Ship, a: f32) {
        let r = AI_ORBIT_MIN + (AI_ORBIT_MAX - AI_ORBIT_MIN) * self.unit();
        let speed = (GM / r).sqrt();
        ship.pos = V2::dir(a).scale(r);
        ship.vel = V2::dir(a + PI / 2.0).scale(speed);
        ship.heading = a + PI / 2.0;
        ship.aim = None;
        ship.burn = 0;
        ship.thrusting = false;
    }

    fn flying(&self, k: usize) -> bool {
        let s = &self.ships[k];
        s.dead_until == 0 && s.hyper_until == 0
    }

    fn cell_of(&self, p: V2) -> Option<(usize, usize)> {
        let rn = p.len();
        let ir = (rn - HOLE) / (1.0 - HOLE) * self.radial as f32;
        if !(0.0..self.radial as f32).contains(&ir) {
            return None;
        }
        let a = p.angle().rem_euclid(TAU);
        let it = ((a / TAU * self.theta as f32) as usize).min(self.theta - 1);
        Some((it, ir as usize))
    }

    fn cell_center(&self, it: i32, ir: i32) -> V2 {
        let a = (it as f32 + 0.5) / self.theta as f32 * TAU;
        let ir = ir.clamp(0, self.radial as i32 - 1);
        let rn = HOLE + (ir as f32 + 0.5) / self.radial as f32 * (1.0 - HOLE);
        V2::dir(a).scale(rn)
    }

    fn glow_at(&mut self, p: V2, tone: u8, glow: u8) {
        if let Some((it, ir)) = self.cell_of(p) {
            let i = ir * self.theta + it;
            if self.glow[i].glow < glow {
                self.glow[i] = Glow { tone, glow };
            }
        }
    }

    fn explode(&mut self, p: V2, tone: u8) {
        self.glow_at(p, WHITE, 255);
        for _ in 0..14 {
            let a = self.unit() * TAU;
            let d = self.unit() * 0.11;
            let t = if self.rng.next_below(3) == 0 { WHITE } else { tone };
            self.glow_at(p.add(V2::dir(a).scale(d)), t, 230);
        }
    }

    fn destroy(&mut self, k: usize) {
        let p = self.ships[k].pos;
        self.explode(p, k as u8);
        let ticks = self.ticks;
        let s = &mut self.ships[k];
        s.dead_until = ticks + RESPAWN_TICKS;
        s.aim = None;
        s.burn = 0;
        s.thrusting = false;
    }

    /// Leaving at the rim: back in at the opposite side, heading inward —
    /// the projective plane's wrap, the circle's answer to the original's
    /// wrap-around screen. The position goes to the antipode; the radial
    /// part of the velocity carries on as it was (which at the antipode
    /// points inward) and the sideways part flips.
    fn wrap(p: &mut V2, v: &mut V2) {
        let r = p.len();
        if r > RIM {
            let out = p.scale(1.0 / r);
            let side = V2::new(-out.y, out.x);
            let sideways = v.x * side.x + v.y * side.y;
            *v = v.sub(side.scale(2.0 * sideways));
            *p = p.scale(-(2.0 * RIM - r) / r);
        }
    }

    fn step(p: &mut V2, v: &mut V2, accel: V2) {
        // Semi-implicit Euler: stable enough for a circular orbit.
        *v = v.add(gravity(*p).add(accel).scale(DT));
        let speed = v.len();
        if speed > MAX_SPEED {
            *v = v.scale(MAX_SPEED / speed);
        }
        *p = p.add(v.scale(DT));
    }

    pub fn tick(&mut self) {
        self.ticks += 1;
        for g in &mut self.glow {
            g.glow = g.glow.saturating_sub(GLOW_DECAY);
        }
        self.flare = self.flare.saturating_sub(1);
        self.tick_ships();
        self.tick_torps();
        self.collide_ships();
    }

    fn tick_ships(&mut self) {
        let ticks = self.ticks;
        for k in 0..self.ships.len() {
            if self.ships[k].dead_until != 0 {
                if ticks >= self.ships[k].dead_until {
                    let a = self.safe_angle();
                    let mut s = self.ships[k];
                    self.place_in_orbit(&mut s, a);
                    s.dead_until = 0;
                    self.ships[k] = s;
                    let p = self.ships[k].pos;
                    self.explode(p, k as u8);
                }
                continue;
            }
            if self.ships[k].hyper_until != 0 {
                if ticks >= self.ships[k].hyper_until {
                    self.ships[k].hyper_until = 0;
                    if self.rng.next_below(HYPER_DOOM) == 0 {
                        // The original's gamble: sometimes the jump kills you.
                        self.destroy(k);
                    } else {
                        let a = self.unit() * TAU;
                        let r = 0.45 + 0.45 * self.unit();
                        let s = &mut self.ships[k];
                        s.pos = V2::dir(a).scale(r);
                        s.vel = V2::dir(a + PI / 2.0).scale((GM / r).sqrt() * 0.8);
                        let p = s.pos;
                        self.explode(p, WHITE);
                    }
                }
                continue;
            }
            let human = self.ships[k].human_until > ticks;
            let (want, burn, fire) = if human {
                self.human_steer(k)
            } else {
                self.ai_steer(k)
            };
            let s = &mut self.ships[k];
            if let Some(want) = want {
                let d = turn(s.heading, want);
                s.heading += d.clamp(-TURN_RATE * DT, TURN_RATE * DT);
            }
            let on = burn && want.is_none_or(|w| turn(s.heading, w).abs() < BURN_CONE);
            s.thrusting = on;
            let accel = if on {
                V2::dir(s.heading).scale(THRUST)
            } else {
                V2::new(0.0, 0.0)
            };
            let (mut p, mut v) = (s.pos, s.vel);
            Self::step(&mut p, &mut v, accel);
            Self::wrap(&mut p, &mut v);
            s.pos = p;
            s.vel = v;
            if fire {
                self.fire(k);
            }
            let p = self.ships[k].pos;
            if p.len() < HOLE {
                self.fell_in += 1;
                self.flare = FLARE_TICKS;
                self.destroy(k);
                continue;
            }
            // A short trail in the ship's color, and flame behind a burn.
            self.glow_at(p, k as u8, 170);
            if self.ships[k].thrusting {
                let back = p.sub(V2::dir(self.ships[k].heading).scale(0.035));
                self.glow_at(back, FIRE, 240);
            }
        }
    }

    /// A human's ship: turn toward the tapped point and burn when the nose
    /// is on it. Firing is the button's business.
    fn human_steer(&mut self, k: usize) -> (Option<f32>, bool, bool) {
        let s = &mut self.ships[k];
        let Some(target) = s.aim else {
            return (None, false, false);
        };
        let want = target.sub(s.pos).angle();
        if turn(s.heading, want).abs() < BURN_CONE && s.burn > 0 {
            s.burn -= 1;
            if s.burn == 0 {
                s.aim = None;
            }
            return (Some(want), true, false);
        }
        s.aim_left = s.aim_left.saturating_sub(1);
        if s.aim_left == 0 {
            s.aim = None;
        }
        (Some(want), false, false)
    }

    /// The AI: keep an orbit in the band; otherwise turn on the nearest
    /// enemy, leading it (a little off), and fire when lined up.
    fn ai_steer(&mut self, k: usize) -> (Option<f32>, bool, bool) {
        let me = self.ships[k];
        let r = me.pos.len();
        let radial = me.pos.scale(1.0 / r.max(1e-4));
        let tangent = V2::new(-radial.y, radial.x);
        // The orbit it wants: circular at the band's middle, with a radial
        // correction toward the band.
        let mid = (AI_ORBIT_MIN + AI_ORBIT_MAX) / 2.0;
        let r_goal = r.clamp(AI_ORBIT_MIN, AI_ORBIT_MAX);
        let along = if me.vel.x * tangent.x + me.vel.y * tangent.y >= 0.0 { 1.0 } else { -1.0 };
        let v_goal = tangent
            .scale(along * (GM / r_goal).sqrt())
            .add(radial.scale((mid - r) * 0.8));
        let error = v_goal.sub(me.vel);
        if error.len() > 0.18 {
            return (Some(error.angle()), true, false);
        }
        // Hunt: the nearest flying enemy within range.
        let mut best: Option<(f32, V2, V2)> = None;
        for (j, other) in self.ships.iter().enumerate() {
            if j == k || other.dead_until != 0 || other.hyper_until != 0 {
                continue;
            }
            let d = other.pos.sub(me.pos).len();
            if d < AI_RANGE && best.is_none_or(|(bd, _, _)| d < bd) {
                best = Some((d, other.pos, other.vel));
            }
        }
        let Some((d, tp, tv)) = best else {
            return (None, false, false);
        };
        let lead = d / TORP_SPEED;
        let aim_at = tp.add(tv.sub(me.vel).scale(lead));
        let want = aim_at.sub(me.pos).angle() + me.ai_bias;
        let lined_up = turn(me.heading, want).abs() < 0.12;
        let fire = lined_up && self.ticks >= me.fire_ready.max(1) && self.rng.next_below(3) == 0;
        if fire {
            self.ships[k].fire_ready = self.ticks + AI_FIRE_COOLDOWN;
            self.ships[k].ai_bias = (self.unit() - 0.5) * 2.0 * AI_AIM_NOISE;
        }
        (Some(want), false, fire)
    }

    fn fire(&mut self, k: usize) {
        let mine = self.torps.iter().filter(|t| t.owner as usize == k).count();
        if mine >= MAX_TORPS_PER_SHIP || !self.flying(k) {
            return;
        }
        let s = self.ships[k];
        let nose = V2::dir(s.heading);
        self.torps.push(Torp {
            pos: s.pos.add(nose.scale(SHIP_RADIUS + 0.01)),
            vel: s.vel.add(nose.scale(TORP_SPEED)),
            owner: k as u8,
            left: TORP_TICKS,
        });
    }

    fn tick_torps(&mut self) {
        let mut i = 0;
        'torps: while i < self.torps.len() {
            let mut t = self.torps[i];
            Self::step(&mut t.pos, &mut t.vel, V2::new(0.0, 0.0));
            Self::wrap(&mut t.pos, &mut t.vel);
            t.left = t.left.saturating_sub(1);
            if t.left == 0 || t.pos.len() < HOLE {
                self.torps.swap_remove(i);
                continue;
            }
            for k in 0..self.ships.len() {
                if !self.flying(k) {
                    continue;
                }
                if self.ships[k].pos.sub(t.pos).len() < HIT_RADIUS {
                    if k != t.owner as usize {
                        self.ships[t.owner as usize].kills += 1;
                    }
                    self.destroy(k);
                    self.torps.swap_remove(i);
                    continue 'torps;
                }
            }
            self.torps[i] = t;
            self.glow_at(t.pos, WHITE, 120);
            i += 1;
        }
    }

    fn collide_ships(&mut self) {
        for a in 0..self.ships.len() {
            for b in a + 1..self.ships.len() {
                if !self.flying(a) || !self.flying(b) {
                    continue;
                }
                if self.ships[a].pos.sub(self.ships[b].pos).len() < SHIP_RADIUS {
                    self.destroy(a);
                    self.destroy(b);
                }
            }
        }
    }

    /// An orbit angle away from every flying ship.
    fn safe_angle(&mut self) -> f32 {
        let mut best = 0.0;
        let mut best_gap = -1.0;
        for _ in 0..8 {
            let a = self.unit() * TAU;
            let gap = self
                .ships
                .iter()
                .filter(|s| s.dead_until == 0)
                .map(|s| turn(s.pos.angle(), a).abs())
                .fold(PI, f32::min);
            if gap > best_gap {
                best_gap = gap;
                best = a;
            }
        }
        best
    }

    /// A tap: this color's ship swings toward the point and burns.
    pub fn inject(&mut self, it: i32, ir: i32, species: u8) {
        let k = (species % self.slots) as usize;
        let target = self.cell_center(it, ir);
        let ticks = self.ticks;
        let s = &mut self.ships[k];
        s.human_until = ticks + HUMAN_TICKS;
        s.aim = Some(target);
        s.burn = BURN_TICKS;
        s.aim_left = AIM_TICKS;
    }

    pub fn command(&mut self, command: GameCommand, species: u8) {
        let k = (species % self.slots) as usize;
        let ticks = self.ticks;
        match command {
            GameCommand::Fire => {
                self.ships[k].human_until = ticks + HUMAN_TICKS;
                if ticks >= self.ships[k].fire_ready {
                    self.ships[k].fire_ready = ticks + FIRE_COOLDOWN;
                    self.fire(k);
                }
            }
            GameCommand::Hyperspace => {
                self.ships[k].human_until = ticks + HUMAN_TICKS;
                if self.flying(k) && ticks >= self.ships[k].hyper_ready {
                    let p = self.ships[k].pos;
                    self.explode(p, WHITE);
                    let s = &mut self.ships[k];
                    s.hyper_until = ticks + HYPER_TICKS;
                    s.hyper_ready = ticks + HYPER_TICKS + HYPER_COOLDOWN;
                    s.aim = None;
                }
            }
            _ => {}
        }
    }

    pub fn watchdog(&mut self) {}

    /// Black space, the star burning in the inner rings, trails and
    /// explosions, then the ships and torpedoes on top.
    pub fn pack_cells(&self) -> Vec<u32> {
        use super::hsv_to_packed_rgb as rgb;
        let (theta, radial) = (self.theta, self.radial);
        let mut out = vec![0u32; theta * radial];
        // The star's corona: the innermost rings, flickering, and blazing
        // out further when something falls in.
        let flare = self.flare as f32 / FLARE_TICKS as f32;
        let corona = 5.0 + 8.0 * flare;
        for ir in 0..radial {
            let depth = ir as f32;
            if depth > corona {
                break;
            }
            for it in 0..theta {
                let h = ((it as u32).wrapping_mul(2654435761)
                    ^ (ir as u32).wrapping_mul(40503)
                    ^ (self.ticks / 2).wrapping_mul(7919))
                    % 1000;
                let flicker = 0.8 + 0.2 * h as f32 / 1000.0;
                let v = (1.0 - depth / (corona + 1.0)).powf(1.6) * flicker * (0.75 + 0.25 * flare);
                out[ir * theta + it] = rgb(0.11, 0.55 - 0.3 * flare, v);
            }
        }
        for (i, g) in self.glow.iter().enumerate() {
            if g.glow == 0 {
                continue;
            }
            let v = g.glow as f32 / 255.0;
            out[i] = match g.tone {
                WHITE => rgb(0.0, 0.0, v * 0.85),
                FIRE => rgb(0.07, 0.95, v),
                k => rgb(self.slot_hue(k), 0.85, v * 0.55),
            };
        }
        for t in &self.torps {
            if let Some((it, ir)) = self.cell_of(t.pos) {
                out[ir * theta + it] = rgb(0.0, 0.0, 1.0);
            }
        }
        for (k, s) in self.ships.iter().enumerate() {
            if s.dead_until != 0 || s.hyper_until != 0 {
                continue;
            }
            let human = s.human_until > self.ticks;
            let body = rgb(self.slot_hue(k as u8), 0.9, if human { 1.0 } else { 0.8 });
            // The body three rings tall (a ring is far narrower than a
            // spoke's spacing), and a nose cell ahead so a heading shows.
            if let Some((it, ir)) = self.cell_of(s.pos) {
                for r in ir.saturating_sub(1)..=(ir + 1).min(radial - 1) {
                    out[r * theta + it] = body;
                }
            }
            let nose = s.pos.add(V2::dir(s.heading).scale(0.04));
            if let Some((it, ir)) = self.cell_of(nose) {
                out[ir * theta + it] = rgb(self.slot_hue(k as u8), 0.35, 1.0);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> SpacewarSim {
        SpacewarSim::new(64, 48, 4, 21)
    }

    /// Every ship human-held and drifting (no AI), torpedoes cleared.
    fn quiet(s: &mut SpacewarSim) {
        for sh in &mut s.ships {
            sh.human_until = u32::MAX;
            sh.aim = None;
        }
        s.torps.clear();
    }

    #[test]
    fn a_circular_orbit_stays_circular() {
        let mut s = sim();
        quiet(&mut s);
        // Keep only ship 0, alone, on a clean orbit.
        s.set_slots(2);
        s.ships[1].dead_until = u32::MAX;
        let a = 0.3;
        let mut ship = s.ships[0];
        s.place_in_orbit(&mut ship, a);
        s.ships[0] = ship;
        let r0 = s.ships[0].pos.len();
        let mut lo = f32::MAX;
        let mut hi = 0.0f32;
        for _ in 0..400 {
            s.tick();
            let r = s.ships[0].pos.len();
            lo = lo.min(r);
            hi = hi.max(r);
        }
        assert!(s.ships[0].dead_until == 0, "the orbit decayed into the star");
        assert!(lo > r0 - 0.05 && hi < r0 + 0.05, "orbit at {r0} wandered {lo}..{hi}");
    }

    #[test]
    fn falling_into_the_star_destroys_the_ship_and_flares() {
        let mut s = sim();
        quiet(&mut s);
        s.ships[0].pos = V2::new(0.36, 0.0);
        s.ships[0].vel = V2::new(-0.5, 0.0);
        for _ in 0..10 {
            s.tick();
        }
        assert!(s.ships[0].dead_until != 0);
        assert_eq!(s.fell_in, 1);
        assert!(s.flare > 0);
        for _ in 0..RESPAWN_TICKS + 1 {
            s.tick();
        }
        assert_eq!(s.ships[0].dead_until, 0, "back in orbit");
        assert!(s.ships[0].pos.len() > 0.5);
    }

    #[test]
    fn leaving_at_the_rim_comes_back_in_at_the_opposite_side() {
        let mut p = V2::new(1.02, 0.0);
        let mut v = V2::new(0.6, 0.1);
        SpacewarSim::wrap(&mut p, &mut v);
        assert!(p.x < -0.9 && p.len() <= RIM, "{p:?}");
        assert!(p.x * v.x + p.y * v.y < 0.0, "now heading inward: {v:?}");
        assert!((v.len() - V2::new(0.6, 0.1).len()).abs() < 1e-5, "same speed");
    }

    #[test]
    fn a_torpedo_kills_and_credits_its_owner() {
        let mut s = sim();
        quiet(&mut s);
        // Ship 1 parked just ahead of ship 0's nose.
        s.ships[0].pos = V2::new(0.7, 0.0);
        s.ships[0].vel = V2::new(0.0, 0.0);
        s.ships[0].heading = PI / 2.0;
        s.ships[1].pos = V2::new(0.7, 0.2);
        s.ships[1].vel = V2::new(0.0, 0.0);
        for k in 2..4 {
            s.ships[k].dead_until = u32::MAX;
        }
        s.command(GameCommand::Fire, 0);
        assert_eq!(s.torps.len(), 1);
        for _ in 0..10 {
            s.tick();
        }
        assert!(s.ships[1].dead_until != 0, "ship 1 should be hit");
        assert_eq!(s.ships[0].kills, 1);
    }

    #[test]
    fn fire_has_a_cooldown_and_a_torpedo_limit() {
        let mut s = sim();
        quiet(&mut s);
        s.command(GameCommand::Fire, 2);
        s.command(GameCommand::Fire, 2);
        assert_eq!(s.torps.len(), 1, "cooling down");
        for _ in 0..6 {
            for _ in 0..FIRE_COOLDOWN {
                s.tick();
            }
            s.command(GameCommand::Fire, 2);
        }
        assert!(s.torps.iter().filter(|t| t.owner == 2).count() <= MAX_TORPS_PER_SHIP);
    }

    #[test]
    fn hyperspace_jumps_the_ship_and_cools_down() {
        let mut s = sim();
        quiet(&mut s);
        let before = s.ships[3].pos;
        s.command(GameCommand::Hyperspace, 3);
        assert!(!s.flying(3), "gone into hyperspace");
        for _ in 0..HYPER_TICKS + 1 {
            s.tick();
        }
        let sh = s.ships[3];
        assert!(sh.hyper_until == 0);
        assert!(sh.dead_until != 0 || sh.pos.sub(before).len() > 1e-3, "it went somewhere (or died trying)");
        let ready = sh.hyper_ready;
        s.command(GameCommand::Hyperspace, 3);
        assert!(s.ticks < ready && s.ships[3].hyper_until == 0, "cooling down");
    }

    #[test]
    fn a_tap_burns_the_ship_toward_the_point() {
        let mut s = sim();
        quiet(&mut s);
        s.ships[0].pos = V2::new(0.7, 0.0);
        s.ships[0].vel = V2::new(0.0, 0.0);
        s.ships[0].heading = PI;
        // Tap on the far side, out near the rim at angle π/2.
        s.inject(16, 40, 0);
        let target = s.cell_center(16, 40);
        let start = s.ships[0].pos.sub(target).len();
        let mut burned = false;
        for _ in 0..AIM_TICKS {
            s.tick();
            burned |= s.ships[0].thrusting;
        }
        assert!(burned, "never lit the engine");
        let to = target.sub(s.ships[0].pos);
        let v = s.ships[0].vel;
        assert!(to.x * v.x + to.y * v.y > 0.0, "not moving toward the tap");
        assert!(s.ships[0].pos.sub(target).len() < start);
    }

    #[test]
    fn with_nobody_playing_the_ai_duels_and_mostly_stays_out_of_the_star() {
        let mut kills = 0;
        let mut fell = 0;
        for seed in 0..4 {
            let mut s = SpacewarSim::new(64, 48, 4, seed);
            for _ in 0..20 * 120 {
                s.tick();
            }
            kills += s.ships.iter().map(|sh| sh.kills).sum::<u32>();
            fell += s.fell_in;
        }
        assert!(kills >= 8, "four 2-minute duels with only {kills} kills");
        assert!(fell * 2 <= kills, "{fell} fell in against {kills} kills");
    }

    #[test]
    fn pack_draws_the_star_and_the_ships() {
        let s = sim();
        let out = s.pack_cells();
        assert!(out[10] != 0, "the star's corona in ring 0");
        let lit = out.iter().skip(64 * 12).filter(|&&c| c != 0).count();
        assert!(lit >= 4, "four ships out in space: {lit} cells lit");
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = SpacewarSim::new(64, 48, 5, 4);
        let mut b = SpacewarSim::new(64, 48, 5, 4);
        for _ in 0..1500 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.pack_cells(), b.pack_cells());
    }
}
