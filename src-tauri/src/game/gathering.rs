//! Gathering — the host camp's hidden game, for the Entheos Community
//! (plans/hidden-modes.md, "Second hidden mode").
//!
//! The camp mark on the array: six orbs — orange, yellow, green, blue,
//! violet, red — near the rim at 60° steps, a six-point star whose blades
//! point out at them, an enclosing ring. The star starts dark. Sparks (lost
//! lights, dim and white) wander the playa. A tap is a *call*: a pulse in the
//! player's colour spreads from the finger, every uncoloured spark it reaches
//! takes that colour and sets off for the orb of that colour, and sparks
//! already of that colour get a burst of speed home. Nobody is re-coloured —
//! no stealing — so players cover for each other's orbs rather than compete.
//! A spark that reaches its orb joins it; the orb brightens as it fills, and
//! a full orb lights its blade from the centre out toward it. When all six
//! blades are lit the sigil is whole: the ring flares, a wave runs inward to
//! the fire at the centre, and then rebirth — orbs empty, blades fade, and
//! every gathered spark is born again out of the hole as a new wanderer.
//!
//! Zero-player: every orb calls softly on its own now and then, over a small
//! radius, so an empty floor completes a gathering in a few minutes and a
//! crowd makes it minutes faster. Any number of players simply add calls.
//!
//! World coordinates on the normalized disc (hole at [`HOLE`]), rasterized
//! to the polar grid at pack time; fixed [`TICK_SECS`] step like the other
//! particle sims.

use super::SplitMix64;
use std::f32::consts::TAU;

/// Fixed step, shared with the other particle sims.
pub const TICK_SECS: f32 = 0.05;
/// The hole's radius as a fraction of the array's (ring 0 sits here).
pub const HOLE: f32 = 0.32;

/// The six orbs of the mark, in ring order: orange, yellow, green, blue,
/// violet, red. (Hue in turns, saturation.) The UI chips carry the same
/// colours from the SVG.
pub const ORBS: usize = 6;
const ORB_HSV: [(f32, f32); ORBS] = [
    (0.075, 0.95),
    (0.145, 0.95),
    (0.38, 0.88),
    (0.63, 0.85),
    (0.76, 0.80),
    (0.0, 0.95),
];
const ORB_R: f32 = 0.86;
/// A spark this close to its orb has arrived.
const ARRIVE: f32 = 0.055;
/// The ring of the mark.
const RING_R: f32 = 0.96;

/// Wanderers per knob step (the admin knob 2–8 → 24–96 sparks).
const SPARKS_PER_SLOT: usize = 12;
/// Fraction of an orb's sixth of the sparks it needs to fill.
const NEEDED_FRACTION: f32 = 0.7;
const MAX_SPARKS: usize = 120;

/// Wandering: a slow random walk with persistence, disc units per second.
const WANDER_SPEED: f32 = 0.05;
const WANDER_TURN: f32 = 0.35;
/// Wanderers roam between here and the rim side of the orbs.
const WANDER_OUT: f32 = 0.93;
/// Homing speed for a coloured spark, and under a fresh call's boost.
const HOME_SPEED: f32 = 0.06;
const BOOST_SPEED: f32 = 0.22;
const BOOST_TICKS: u16 = 40;
/// Rebirth: sparks fly out of the hole this fast until they reach their new
/// wandering spot.
const REBIRTH_SPEED: f32 = 0.6;

/// A human call: pulse radius in disc units and its life in ticks.
const CALL_RADIUS: f32 = 0.30;
const CALL_TICKS: u16 = 16;
/// The orbs' own soft calls: radius, the gap between them (seconds), and
/// how much louder a lonely orb calls — the radius grows toward
/// `ORB_CALL_RADIUS + ORB_CALL_LONELY` over `LONELY_TICKS` without an
/// arrival, so the last orb never waits forever.
const ORB_CALL_RADIUS: f32 = 0.18;
const ORB_CALL_LONELY: f32 = 0.32;
const LONELY_TICKS: f32 = 1200.0;
const ORB_CALL_MIN: f32 = 6.0;
const ORB_CALL_MAX: f32 = 10.0;
const MAX_PULSES: usize = 32;

/// The gathering: how long the sigil holds whole before rebirth (ticks).
const GATHERING_TICKS: u16 = 130;

/// Sparkle glow decays this much per tick (~0.5 s).
const GLOW_DECAY: u8 = 24;
const NEUTRAL: u8 = 0xff;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell {
    /// Orb index for a coloured sparkle, [`NEUTRAL`] for white.
    pub hue: u8,
    pub glow: u8,
}

const DARK: Cell = Cell {
    hue: NEUTRAL,
    glow: 0,
};

#[derive(Clone, Copy, Debug)]
struct Spark {
    x: f32,
    y: f32,
    /// Wander heading, radians.
    heading: f32,
    /// The orb this spark is called to, once coloured.
    orb: Option<u8>,
    /// Ticks of homing boost left.
    boost: u16,
    /// Rebirth flight target (None once wandering).
    reborn_to: Option<(f32, f32)>,
}

#[derive(Clone, Copy, Debug)]
struct Pulse {
    x: f32,
    y: f32,
    radius: f32,
    age: u16,
    life: u16,
    /// Orb colour, or [`NEUTRAL`] for an orb's own soft call.
    orb: u8,
}

pub struct GatheringSim {
    theta: usize,
    radial: usize,
    slots: u8,
    cells: Vec<Cell>,
    sparks: Vec<Spark>,
    pulses: Vec<Pulse>,
    /// Sparks gathered at each orb this cycle.
    gathered: [u32; ORBS],
    /// Next tick each orb calls on its own.
    orb_call_next: [u32; ORBS],
    /// Last tick a spark arrived at each orb (its loneliness clock).
    last_arrival: [u32; ORBS],
    rng: SplitMix64,
    ticks: u32,
    /// Ticks left of the whole-sigil moment; 0 = not gathering.
    gathering: u16,
    gatherings: u32,
    /// Human calls this cycle, for the status line.
    calls: u32,
}

impl GatheringSim {
    pub fn new(theta: usize, radial: usize, slots: u8, seed: u64) -> Self {
        assert!(theta >= 8 && radial >= 8);
        let mut sim = Self {
            theta,
            radial,
            slots: slots.clamp(2, 8),
            cells: vec![DARK; theta * radial],
            sparks: Vec::with_capacity(MAX_SPARKS),
            pulses: Vec::with_capacity(MAX_PULSES),
            gathered: [0; ORBS],
            orb_call_next: [0; ORBS],
            last_arrival: [0; ORBS],
            rng: SplitMix64::new(seed),
            ticks: 0,
            gathering: 0,
            gatherings: 0,
            calls: 0,
        };
        for k in 0..ORBS {
            sim.orb_call_next[k] = sim.ticks_from_secs(1.0, ORB_CALL_MAX);
        }
        let n = sim.target_sparks();
        for _ in 0..n {
            let (x, y) = sim.random_playa_point();
            let heading = sim.unit() * TAU;
            sim.sparks.push(Spark {
                x,
                y,
                heading,
                orb: None,
                boost: 0,
                reborn_to: None,
            });
        }
        sim
    }

    pub fn theta(&self) -> usize {
        self.theta
    }

    pub fn radial(&self) -> usize {
        self.radial
    }

    /// The admin knob: how many sparks wander. Changing it mid-game adds
    /// wanderers at the rim or lets the surplus go at the next rebirth.
    pub fn set_slots(&mut self, slots: u8) {
        self.slots = slots.clamp(2, 8);
        let target = self.target_sparks();
        while self.sparks.len() < target {
            let (x, y) = self.random_playa_point();
            let heading = self.unit() * TAU;
            self.sparks.push(Spark {
                x,
                y,
                heading,
                orb: None,
                boost: 0,
                reborn_to: None,
            });
        }
    }

    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    pub fn spark_count(&self) -> usize {
        self.sparks.len()
    }

    pub fn gatherings(&self) -> u32 {
        self.gatherings
    }

    pub fn gathered(&self, orb: usize) -> u32 {
        self.gathered[orb]
    }

    /// Sparks an orb needs before its blade lights.
    pub fn needed(&self) -> u32 {
        ((self.target_sparks() as f32 / ORBS as f32) * NEEDED_FRACTION)
            .round()
            .max(3.0) as u32
    }

    pub fn orb_full(&self, orb: usize) -> bool {
        self.gathered[orb] >= self.needed()
    }

    pub fn orbs_lit(&self) -> usize {
        (0..ORBS).filter(|&k| self.orb_full(k)).count()
    }

    pub fn is_gathering(&self) -> bool {
        self.gathering > 0
    }

    /// The status line: what the phones say.
    pub fn detail(&self) -> String {
        if self.gathering > 0 {
            return format!("the sigil is whole · gathering {}", self.gatherings);
        }
        let home: u32 = self.gathered.iter().sum();
        let total = home + self.sparks.len() as u32;
        format!(
            "{} of 6 orbs lit · {} of {} sparks home · {} gathering{}",
            self.orbs_lit(),
            home,
            total,
            self.gatherings,
            if self.gatherings == 1 { "" } else { "s" }
        )
    }

    fn target_sparks(&self) -> usize {
        (self.slots as usize * SPARKS_PER_SLOT).min(MAX_SPARKS)
    }

    fn ticks_from_secs(&mut self, min: f32, max: f32) -> u32 {
        let span = ((max - min) / TICK_SECS).max(1.0) as u64;
        self.ticks + (min / TICK_SECS) as u32 + self.rng.next_below(span) as u32
    }

    fn unit(&mut self) -> f32 {
        self.rng.next_below(10_000) as f32 / 10_000.0
    }

    /// Somewhere on the strip, inside the orbs' own reach.
    fn random_playa_point(&mut self) -> (f32, f32) {
        let a = self.unit() * TAU;
        let rn = HOLE + 0.04 + self.unit() * (ORB_R - ORB_CALL_RADIUS - HOLE - 0.06);
        (rn * a.cos(), rn * a.sin())
    }

    /// How far an orb's own call reaches right now: louder the longer it
    /// has waited for an arrival.
    fn orb_call_radius(&self, k: usize) -> f32 {
        let lonely = (self.ticks.saturating_sub(self.last_arrival[k]) as f32 / LONELY_TICKS).min(1.0);
        ORB_CALL_RADIUS + ORB_CALL_LONELY * lonely
    }

    /// A spark born again out of the fire, flying to a fresh spot.
    fn reborn_spark(&mut self) -> Spark {
        let to = self.random_playa_point();
        let a = self.unit() * TAU;
        let r0 = HOLE + 0.01;
        let heading = self.unit() * TAU;
        Spark {
            x: r0 * a.cos(),
            y: r0 * a.sin(),
            heading,
            orb: None,
            boost: 0,
            reborn_to: Some(to),
        }
    }

    fn orb_pos(k: usize) -> (f32, f32) {
        let a = k as f32 / ORBS as f32 * TAU;
        (ORB_R * a.cos(), ORB_R * a.sin())
    }

    fn idx(&self, it: usize, ir: usize) -> usize {
        ir * self.theta + it
    }

    fn cell_center(&self, it: usize, ir: usize) -> (f32, f32) {
        let a = (it as f32 + 0.5) / self.theta as f32 * TAU;
        let rn = HOLE + (ir as f32 + 0.5) / self.radial as f32 * (1.0 - HOLE);
        (rn * a.cos(), rn * a.sin())
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

    fn glow(&mut self, x: f32, y: f32, hue: u8, glow: u8) {
        if let Some((it, ir)) = self.cell_of(x, y) {
            let i = self.idx(it, ir);
            if self.cells[i].glow < glow {
                self.cells[i] = Cell { hue, glow };
            }
        }
    }

    fn splat(&mut self, x: f32, y: f32, hue: u8, n: usize, spread: f32) {
        self.glow(x, y, hue, 255);
        for _ in 0..n {
            let a = self.unit() * TAU;
            let d = self.unit() * spread;
            self.glow(x + d * a.cos(), y + d * a.sin(), hue, 200);
        }
    }

    /// A call at a point: colour the uncoloured sparks in reach, speed the
    /// ones already of that colour. `orb` is the colour; the orbs' own soft
    /// calls colour for themselves.
    fn call(&mut self, x: f32, y: f32, radius: f32, orb: u8, soft: bool) {
        if self.pulses.len() < MAX_PULSES {
            self.pulses.push(Pulse {
                x,
                y,
                radius,
                age: 0,
                life: CALL_TICKS,
                orb: if soft { NEUTRAL } else { orb },
            });
        }
        for s in &mut self.sparks {
            if s.reborn_to.is_some() {
                continue;
            }
            let d = (s.x - x).hypot(s.y - y);
            if d > radius {
                continue;
            }
            match s.orb {
                None => {
                    s.orb = Some(orb);
                    s.boost = if soft { 0 } else { BOOST_TICKS };
                }
                Some(k) if k == orb && !soft => s.boost = BOOST_TICKS,
                _ => {}
            }
        }
    }

    /// One 50 ms step.
    pub fn tick(&mut self) {
        self.ticks += 1;
        for c in &mut self.cells {
            c.glow = c.glow.saturating_sub(GLOW_DECAY);
            if c.glow == 0 {
                *c = DARK;
            }
        }
        for p in &mut self.pulses {
            p.age += 1;
        }
        self.pulses.retain(|p| p.age < p.life);

        if self.gathering > 0 {
            self.gathering -= 1;
            if self.gathering == 0 {
                self.rebirth();
            }
            // The world holds still while the sigil is whole.
            return;
        }

        // The orbs' own soft calls; a full orb has no need to call.
        for k in 0..ORBS {
            if self.ticks >= self.orb_call_next[k] {
                if !self.orb_full(k) {
                    let (x, y) = Self::orb_pos(k);
                    let radius = self.orb_call_radius(k);
                    self.call(x, y, radius, k as u8, true);
                }
                self.orb_call_next[k] = self.ticks_from_secs(ORB_CALL_MIN, ORB_CALL_MAX);
            }
        }

        let mut i = 0;
        while i < self.sparks.len() {
            let mut s = self.sparks[i];
            if let Some((tx, ty)) = s.reborn_to {
                // Flying out of the fire to a new spot on the playa.
                let (dx, dy) = (tx - s.x, ty - s.y);
                let dist = dx.hypot(dy);
                let step = REBIRTH_SPEED * TICK_SECS;
                if dist <= step {
                    s.x = tx;
                    s.y = ty;
                    s.reborn_to = None;
                } else {
                    s.x += dx / dist * step;
                    s.y += dy / dist * step;
                }
                self.sparks[i] = s;
                i += 1;
                continue;
            }
            match s.orb {
                None => {
                    // Wander: persistent heading, nudged at random, kept on
                    // the strip and off the orbs (an uncoloured spark does
                    // not drift home by accident).
                    s.heading += (self.unit() - 0.5) * WANDER_TURN;
                    let step = WANDER_SPEED * TICK_SECS;
                    s.x += s.heading.cos() * step;
                    s.y += s.heading.sin() * step;
                    let rn = s.x.hypot(s.y);
                    let (lo, hi) = (HOLE + 0.03, WANDER_OUT);
                    if rn < lo || rn > hi {
                        let clamped = rn.clamp(lo, hi);
                        s.x *= clamped / rn.max(1e-4);
                        s.y *= clamped / rn.max(1e-4);
                        s.heading += std::f32::consts::PI * 0.5;
                    }
                }
                Some(k) => {
                    let (ox, oy) = Self::orb_pos(k as usize);
                    let (dx, dy) = (ox - s.x, oy - s.y);
                    let dist = dx.hypot(dy);
                    if dist <= ARRIVE {
                        self.last_arrival[k as usize] = self.ticks;
                        self.splat(ox, oy, k, 4, 0.05);
                        if self.orb_full(k as usize) {
                            // A full orb passes its surplus on: the spark is
                            // born again out of the fire for another orb to
                            // call, so the last orb is never starved.
                            self.sparks[i] = self.reborn_spark();
                            i += 1;
                        } else {
                            // Home: joins the orb.
                            self.gathered[k as usize] += 1;
                            self.sparks.swap_remove(i);
                        }
                        continue;
                    }
                    let speed = if s.boost > 0 { BOOST_SPEED } else { HOME_SPEED };
                    s.boost = s.boost.saturating_sub(1);
                    // A little sideways wander keeps the walk home alive.
                    s.heading += (self.unit() - 0.5) * WANDER_TURN;
                    let wobble = 0.35 * HOME_SPEED * TICK_SECS;
                    let step = speed * TICK_SECS;
                    s.x += dx / dist * step + s.heading.cos() * wobble;
                    s.y += dy / dist * step + s.heading.sin() * wobble;
                    if s.boost > 0 {
                        self.glow(s.x, s.y, k, 90);
                    }
                }
            }
            self.sparks[i] = s;
            i += 1;
        }

        if (0..ORBS).all(|k| self.orb_full(k)) {
            self.gathering = GATHERING_TICKS;
            self.gatherings += 1;
        }
    }

    /// The orbs empty, the blades go dark, and every gathered spark flies
    /// out of the fire as a new wanderer.
    fn rebirth(&mut self) {
        let home: u32 = self.gathered.iter().sum();
        self.gathered = [0; ORBS];
        self.calls = 0;
        let room = self.target_sparks().saturating_sub(self.sparks.len());
        for _ in 0..(home as usize).min(room) {
            let spark = self.reborn_spark();
            self.sparks.push(spark);
        }
        for k in 0..ORBS {
            self.orb_call_next[k] = self.ticks_from_secs(2.0, ORB_CALL_MAX);
            self.last_arrival[k] = self.ticks;
        }
    }

    /// Player input: a call in orb `species`'s colour at the tapped cell.
    pub fn inject(&mut self, it: i32, ir: i32, species: u8) {
        if self.gathering > 0 {
            return;
        }
        let orb = species % ORBS as u8;
        let it = it.rem_euclid(self.theta as i32) as usize;
        let ir = ir.clamp(0, self.radial as i32 - 1) as usize;
        let (x, y) = self.cell_center(it, ir);
        self.calls += 1;
        self.call(x, y, CALL_RADIUS, orb, false);
    }

    /// Upkeep lives in `tick`.
    pub fn watchdog(&mut self) {}

    /// The mark, then the glow, then sparks and pulses on top. `time`
    /// drives the slow flow through lit blades.
    pub fn pack_cells(&self, time: f32) -> Vec<u32> {
        use super::hsv_to_packed_rgb as rgb;
        let needed = self.needed() as f32;
        let whole = self.gathering > 0;
        let gather_t = if whole {
            1.0 - self.gathering as f32 / GATHERING_TICKS as f32
        } else {
            0.0
        };
        let mut out: Vec<u32> = Vec::with_capacity(self.cells.len());
        for ir in 0..self.radial {
            for it in 0..self.theta {
                let (x, y) = self.cell_center(it, ir);
                let rn = x.hypot(y);
                let phi = y.atan2(x).rem_euclid(TAU);
                // Which orb's sector, and the angle off its axis.
                let sector = TAU / ORBS as f32;
                let k = ((phi + sector / 2.0) / sector).floor() as usize % ORBS;
                let off = (phi - k as f32 * sector + sector / 2.0).rem_euclid(sector) - sector / 2.0;
                let (h, s) = ORB_HSV[k];
                let mut v = 0.0f32;
                let mut hue = h;
                let mut sat = s;
                // The ring: faint always, white and bright when whole.
                let ring = (-((rn - RING_R) / 0.012).powi(2)).exp();
                if ring > 0.01 {
                    v = v.max(ring * if whole { 1.0 } else { 0.12 });
                    if whole || ring > 0.2 {
                        sat = 0.0;
                    }
                }
                // The orb: a disc that grows and brightens with its fill,
                // with a white shell once full.
                let (ox, oy) = Self::orb_pos(k);
                let d = (x - ox).hypot(y - oy);
                let fill = (self.gathered[k] as f32 / needed).min(1.0);
                let orb_r = 0.035 + 0.04 * fill;
                if d < orb_r {
                    v = 0.25 + 0.75 * fill;
                    sat = s;
                    hue = h;
                    if self.orb_full(k) && d > orb_r - 0.014 {
                        sat = 0.0;
                        v = 1.0;
                    }
                } else if d < orb_r + 0.02 && self.orb_full(k) {
                    v = v.max(0.4);
                    sat = 0.0;
                }
                // The blade: lit from the centre to its tip when the orb is
                // full, wide at the hole and narrow at the tip like the mark.
                if self.orb_full(k) || whole {
                    let u = (rn - HOLE) / (1.0 - HOLE);
                    let (inner, tip) = (0.03, 0.62);
                    if u >= inner && u <= tip {
                        let t = (u - inner) / (tip - inner);
                        let half = 0.40 * (1.0 - t) + 0.045 * t;
                        if off.abs() <= half {
                            let flow = 0.55 + 0.25 * ((u * 19.0 - time * 1.6 + k as f32).sin());
                            let edge = ((half - off.abs()) / 0.03).clamp(0.0, 1.0);
                            let blade = flow * (0.6 + 0.4 * edge);
                            v = v.max(blade);
                            hue = h;
                            sat = s;
                        }
                    }
                }
                // The gathering: a white wave from the ring to the fire.
                if whole {
                    let front = RING_R - gather_t * (RING_R - HOLE);
                    let wave = (-((rn - front) / 0.05).powi(2)).exp();
                    if wave > v {
                        v = wave;
                        sat = 0.0;
                    }
                }
                let base = if v <= 0.0 { 0 } else { rgb(hue, sat, v.min(1.0)) };
                let c = self.cells[self.idx(it, ir)];
                out.push(if c.glow == 0 {
                    base
                } else {
                    let g = c.glow as f32 / 255.0;
                    if c.hue == NEUTRAL {
                        rgb(0.1, 0.1, g)
                    } else {
                        let (h, s) = ORB_HSV[c.hue as usize % ORBS];
                        rgb(h, s, g)
                    }
                });
            }
        }
        let mut put = |x: f32, y: f32, color: u32| {
            if let Some((it, ir)) = self.cell_of(x, y) {
                out[ir * self.theta + it] = color;
            }
        };
        for p in &self.pulses {
            let age = p.age as f32 / p.life as f32;
            let radius = p.radius * age;
            let fade = 1.0 - age;
            let color = if p.orb == NEUTRAL {
                rgb(0.1, 0.1, 0.35 * fade)
            } else {
                let (h, s) = ORB_HSV[p.orb as usize % ORBS];
                rgb(h, s, 0.9 * fade)
            };
            let steps = (radius * 90.0) as i32 + 8;
            for q in 0..steps {
                let a = q as f32 / steps as f32 * TAU;
                put(p.x + radius * a.cos(), p.y + radius * a.sin(), color);
            }
        }
        for s in &self.sparks {
            let color = match s.orb {
                None => rgb(0.1, 0.08, 0.4),
                Some(k) => {
                    let (h, sat) = ORB_HSV[k as usize];
                    rgb(h, sat, if s.boost > 0 { 1.0 } else { 0.8 })
                }
            };
            put(s.x, s.y, color);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> GatheringSim {
        GatheringSim::new(64, 48, 5, 7)
    }

    fn silence_orbs(s: &mut GatheringSim) {
        s.orb_call_next = [u32::MAX; ORBS];
    }

    #[test]
    fn the_world_starts_dark_with_sparks_wandering() {
        let s = sim();
        assert_eq!(s.spark_count(), 60);
        assert_eq!(s.needed(), 7);
        assert_eq!(s.orbs_lit(), 0);
        assert!(s.sparks.iter().all(|k| k.orb.is_none()));
        let cells = s.pack_cells(0.0);
        // Six orbs and sixty sparks, but no blades and a faint ring only.
        let lit = cells.iter().filter(|&&c| c != 0).count();
        assert!(lit > 60 && lit < 600, "{lit} lit cells");
    }

    #[test]
    fn a_call_colours_the_sparks_in_reach_and_they_go_home() {
        let mut s = sim();
        silence_orbs(&mut s);
        s.sparks.clear();
        // Three sparks near a point, one far away.
        for (x, y) in [(0.0, 0.6), (0.05, 0.62), (-0.04, 0.58), (-0.6, -0.6)] {
            s.sparks.push(Spark { x, y, heading: 0.0, orb: None, boost: 0, reborn_to: None });
        }
        let ir = ((0.6 - HOLE) / (1.0 - HOLE) * 48.0) as i32;
        s.inject(16, ir, 2); // angle 90°, the green orb
        assert_eq!(s.sparks.iter().filter(|k| k.orb == Some(2)).count(), 3);
        assert!(s.sparks[3].orb.is_none(), "a spark out of reach was coloured");
        // They walk to the green orb (at 120°) and join it.
        for _ in 0..600 {
            s.tick();
        }
        assert_eq!(s.gathered(2), 3, "the called sparks did not arrive");
        assert_eq!(s.spark_count(), 1);
    }

    #[test]
    fn a_coloured_spark_is_never_recoloured() {
        let mut s = sim();
        silence_orbs(&mut s);
        s.sparks.clear();
        s.sparks.push(Spark { x: 0.0, y: 0.6, heading: 0.0, orb: Some(4), boost: 0, reborn_to: None });
        let ir = ((0.6 - HOLE) / (1.0 - HOLE) * 48.0) as i32;
        s.inject(16, ir, 1);
        assert_eq!(s.sparks[0].orb, Some(4));
        assert_eq!(s.sparks[0].boost, 0, "a call of another colour must not speed it either");
        s.inject(16, ir, 4);
        assert_eq!(s.sparks[0].boost, BOOST_TICKS);
    }

    #[test]
    fn a_full_orb_lights_its_blade() {
        let mut s = sim();
        silence_orbs(&mut s);
        let dark = s.pack_cells(0.0);
        s.gathered[0] = s.needed();
        assert!(s.orb_full(0));
        let lit = s.pack_cells(0.0);
        // Blade 0 points along angle 0: the innermost ring near spoke 0 lights.
        let i = s.idx(0, 2);
        assert_eq!(dark[i], 0);
        assert_ne!(lit[i], 0);
        // The opposite blade (orb 3, angle 180°) stays dark.
        let j = s.idx(32, 2);
        assert_eq!(lit[j], 0);
    }

    #[test]
    fn all_six_make_a_gathering_then_rebirth() {
        let mut s = sim();
        silence_orbs(&mut s);
        let before = s.spark_count();
        for k in 0..ORBS {
            s.gathered[k] = s.needed();
        }
        // Pretend those sparks had arrived.
        s.sparks.truncate(before - (s.needed() as usize * ORBS));
        s.tick();
        assert!(s.is_gathering());
        assert_eq!(s.gatherings(), 1);
        assert!(s.detail().contains("whole"));
        for _ in 0..(GATHERING_TICKS as usize + 1) {
            s.tick();
        }
        assert!(!s.is_gathering());
        assert_eq!(s.orbs_lit(), 0);
        assert_eq!(s.spark_count(), before, "the gathered sparks were not reborn");
        assert!(s.sparks.iter().any(|k| k.reborn_to.is_some()), "rebirth should fly out of the fire");
        for _ in 0..200 {
            s.tick();
        }
        assert!(s.sparks.iter().all(|k| k.reborn_to.is_none()), "reborn sparks never landed");
    }

    #[test]
    fn a_full_orb_passes_surplus_sparks_back_out() {
        let mut s = sim();
        silence_orbs(&mut s);
        s.gathered[2] = s.needed();
        let n = s.spark_count();
        s.sparks.clear();
        let (ox, oy) = GatheringSim::orb_pos(2);
        s.sparks.push(Spark { x: ox - 0.1, y: oy, heading: 0.0, orb: Some(2), boost: BOOST_TICKS, reborn_to: None });
        for _ in 0..60 {
            s.tick();
        }
        assert_eq!(s.gathered(2), s.needed(), "a full orb must not keep counting");
        assert_eq!(s.spark_count(), 1, "the surplus spark vanished instead of being reborn");
        assert!(s.sparks[0].orb.is_none());
        let _ = n;
    }

    #[test]
    fn a_lonely_orb_calls_louder() {
        let mut s = sim();
        let quiet = s.orb_call_radius(0);
        s.ticks += LONELY_TICKS as u32;
        assert!(s.orb_call_radius(0) > quiet + 0.25);
        s.last_arrival[0] = s.ticks;
        assert!((s.orb_call_radius(0) - quiet).abs() < 1e-6);
    }

    #[test]
    fn with_nobody_calling_the_orbs_gather_the_sparks_themselves() {
        let mut s = sim();
        for _ in 0..(10 * 60 * 20) {
            s.tick();
            if s.gatherings() > 0 {
                break;
            }
        }
        assert!(s.gatherings() > 0, "no gathering in ten quiet minutes ({})", s.detail());
    }

    #[test]
    fn sparks_knob_adds_wanderers() {
        let mut s = GatheringSim::new(64, 48, 2, 3);
        assert_eq!(s.spark_count(), 24);
        assert_eq!(s.needed(), 3);
        s.set_slots(8);
        assert_eq!(s.spark_count(), 96);
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = GatheringSim::new(64, 48, 5, 11);
        let mut b = GatheringSim::new(64, 48, 5, 11);
        for _ in 0..800 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.cells(), b.cells());
        assert_eq!(a.spark_count(), b.spark_count());
        assert_eq!(a.pack_cells(2.0), b.pack_cells(2.0));
    }
}
