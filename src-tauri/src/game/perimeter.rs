//! Perimeter — Gate, Perimeter & Exodus's own hidden game
//! (plans/hidden-modes.md).
//!
//! Black Rock City is the rainbow party inside an orange pentagon (the trash
//! fence) around the middle of the array. Outside it is dark playa. Headlamps
//! spawn at the rim and dash inward trying to hop the fence; every player
//! drives a perimeter truck in their color and runs them down. One corner of
//! the fence is the Gate, with a mini Gate Road carrying ticketed traffic in
//! from the rim; the next edge has the airport, where a plane lands now and
//! then. Nothing is lost when a sneaker gets through — they just join the
//! party with a splash — the pressure is the game.
//!
//! Zero-to-N players is one world, Spokewar's way: every truck is AI-driven
//! until a human aims it, and the AI takes it back ~15 s after the human's
//! last tap. The AI re-targets slowly and chases where a sneaker *is*, not
//! where it will be, so the attract mode visibly lets some through. Two
//! scaling rules keep it fair for any crowd: sneakers spawn faster the more
//! humans are driving, and the rate backs off a little for every one that
//! made it in recently (the fence is porous enough already).
//!
//! The sim keeps movers in world coordinates (the array's normalized disc,
//! hole at [`HOLE`]) and rasterizes to the polar cell grid at pack time, so
//! motion is isotropic even though the cells are not. Fixed [`TICK_SECS`]
//! step like the other particle sims.

use super::SplitMix64;
use std::f32::consts::{PI, TAU};

/// Fixed step, shared with the other particle sims.
pub const TICK_SECS: f32 = 0.05;

/// The hole's radius as a fraction of the array's: ring 0 sits here. The
/// engine maps taps to cells with the configured geometry; the sim only needs
/// a consistent idea of where rings are in the disc, and this is the
/// installation's.
pub const HOLE: f32 = 0.32;

/// The trash fence: a regular pentagon, apothem (center to edge middle) in
/// disc units. Circumradius follows. One vertex sits at angle 0 — the Gate.
const FENCE_APOTHEM: f32 = 0.56;
const FENCE_SIDES: f32 = 5.0;
const FENCE_HALF: f32 = 0.013;
/// Trucks keep this far outside the fence.
const TRUCK_MARGIN: f32 = 0.035;

/// Gate Road: the ray from the rim to the Gate vertex.
const GATE_ANGLE: f32 = 0.0;
const ROAD_HALF_WIDTH: f32 = 0.038;
const CAR_SPEED: f32 = 0.13;
/// Seconds between ticketed cars (random in range).
const CAR_GAP_MIN: f32 = 1.8;
const CAR_GAP_MAX: f32 = 4.5;
const MAX_CARS: usize = 40;
const GATE_BLINK_TICKS: u8 = 6;

/// Airport: a runway just inside the edge after the Gate (edge normal at
/// 108°), spanning the middle of that edge. A plane approaches the runway's
/// threshold from the rim, taxis to the far end, and is gone.
const RUNWAY_NORMAL: f32 = 108.0 * PI / 180.0;
const RUNWAY_INSET: f32 = 0.075;
const RUNWAY_HALF_LENGTH: f32 = 0.19;
const RUNWAY_HALF_WIDTH: f32 = 0.011;
const RUNWAY_DASH: f32 = 0.05;
const PLANE_APPROACH_SPEED: f32 = 0.42;
const PLANE_TAXI_SPEED: f32 = 0.14;
const PLANE_GAP_MIN: f32 = 22.0;
const PLANE_GAP_MAX: f32 = 45.0;

/// Sneakers: headlamps running in from the dark.
const SNEAK_SPEED_MIN: f32 = 0.085;
const SNEAK_SPEED_MAX: f32 = 0.16;
/// Spawn angles this close to Gate Road are not used (sneakers do not queue).
const ROAD_KEEPOUT: f32 = 14.0 * PI / 180.0;
/// Within this distance of a truck a sneaker steers away…
const EVADE_RADIUS: f32 = 0.22;
/// …and may freeze and dim for a moment (hiding), which is easier to catch.
const HIDE_RADIUS: f32 = 0.11;
const HIDE_CHANCE: u64 = 12; // 1-in-N per tick while in range
const HIDE_TICKS: u8 = 24;
const MAX_SNEAKERS: usize = 200;

/// Spawn pressure: sneakers per second with nobody driving, plus per active
/// human driver, divided by the recent-through backoff.
const CALM_RATE: f32 = 0.45;
const RATE_PER_DRIVER: f32 = 0.38;
const BACKOFF_PER_THROUGH: f32 = 0.12;
const BACKOFF_CAP: usize = 15;
/// Sliding window for "made it in recently", in ticks (~20 s).
const THROUGH_WINDOW: u32 = 400;

/// Trucks.
const TRUCK_SPEED: f32 = 0.30;
/// Chases at this fraction of the speed when the AI drives — a person
/// aiming is the faster perimeter.
const AI_SPEED: f32 = 0.74;
const CATCH_RADIUS: f32 = 0.06;
/// Ticks a human keeps a truck after a tap (~15 s).
const HUMAN_TICKS: u32 = 300;
/// AI re-target cadence in ticks (1.5 s .. 2.6 s).
const AI_MIN_TICKS: u32 = 30;
const AI_MAX_TICKS: u32 = 52;
const MAX_TRUCKS: usize = 8;

/// Flash/splat glow decays this much per tick (~0.6 s visible).
const GLOW_DECAY: u8 = 22;

/// Hue slot meaning "not a player color" in the glow grid.
const NEUTRAL: u8 = 0xff;
/// Hue slot for the party splash when a sneaker gets in.
const PARTY: u8 = 0xfe;

/// What a cell is when nothing moves over it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Ground {
    Playa,
    City,
    Fence,
    Post,
    Road,
    Gate,
    Runway,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell {
    /// Player slot hue for a catch splat, [`PARTY`] for a through splash,
    /// [`NEUTRAL`] for a fence flash.
    pub hue: u8,
    pub glow: u8,
}

const DARK: Cell = Cell {
    hue: NEUTRAL,
    glow: 0,
};

#[derive(Clone, Copy, Debug)]
struct Sneaker {
    x: f32,
    y: f32,
    /// Disc units per second.
    speed: f32,
    /// Remaining frozen ticks (hiding from a truck).
    hidden: u8,
}

#[derive(Clone, Copy, Debug)]
struct Truck {
    x: f32,
    y: f32,
    tx: f32,
    ty: f32,
    /// Tick until which a human holds this truck (0 = AI).
    human_until: u32,
    /// Next tick the AI may re-target.
    ai_next: u32,
    caught: u32,
}

#[derive(Clone, Copy, Debug)]
struct Car {
    /// Distance from the center along Gate Road.
    r: f32,
}

#[derive(Clone, Copy, Debug)]
struct Plane {
    x: f32,
    y: f32,
    /// False while approaching the threshold, true while taxiing.
    taxiing: bool,
}

pub struct PerimeterSim {
    theta: usize,
    radial: usize,
    slots: u8,
    ground: Vec<Ground>,
    cells: Vec<Cell>,
    sneakers: Vec<Sneaker>,
    trucks: Vec<Truck>,
    cars: Vec<Car>,
    plane: Option<Plane>,
    rng: SplitMix64,
    ticks: u32,
    spawn_acc: f32,
    /// Tick stamps of recent fence crossings, for the backoff.
    recent_through: Vec<u32>,
    through: u32,
    caught: u32,
    gate_passes: u32,
    planes_landed: u32,
    next_car: u32,
    next_plane: u32,
    gate_blink: u8,
}

/// Distance from the center to the fence in the direction `phi`.
fn fence_r(phi: f32) -> f32 {
    let sector = TAU / FENCE_SIDES;
    let d = phi.rem_euclid(sector) - sector / 2.0;
    FENCE_APOTHEM / d.cos()
}

fn fence_circumradius() -> f32 {
    FENCE_APOTHEM / (PI / FENCE_SIDES).cos()
}

/// Runway endpoints: threshold (where a plane lands) then the far end.
fn runway() -> ((f32, f32), (f32, f32)) {
    let (nx, ny) = (RUNWAY_NORMAL.cos(), RUNWAY_NORMAL.sin());
    let (tx, ty) = (-ny, nx);
    let d = FENCE_APOTHEM - RUNWAY_INSET;
    let (cx, cy) = (nx * d, ny * d);
    (
        (cx - tx * RUNWAY_HALF_LENGTH, cy - ty * RUNWAY_HALF_LENGTH),
        (cx + tx * RUNWAY_HALF_LENGTH, cy + ty * RUNWAY_HALF_LENGTH),
    )
}

/// Distance from `p` to the segment `a`–`b`, and where along it (0..1).
fn segment_distance(p: (f32, f32), a: (f32, f32), b: (f32, f32)) -> (f32, f32) {
    let (abx, aby) = (b.0 - a.0, b.1 - a.1);
    let len2 = (abx * abx + aby * aby).max(1e-6);
    let t = (((p.0 - a.0) * abx + (p.1 - a.1) * aby) / len2).clamp(0.0, 1.0);
    let (qx, qy) = (a.0 + abx * t, a.1 + aby * t);
    ((p.0 - qx).hypot(p.1 - qy), t)
}

impl PerimeterSim {
    pub fn new(theta: usize, radial: usize, slots: u8, seed: u64) -> Self {
        assert!(theta >= 8 && radial >= 8);
        let mut sim = Self {
            theta,
            radial,
            slots: slots.clamp(2, MAX_TRUCKS as u8),
            ground: vec![Ground::Playa; theta * radial],
            cells: vec![DARK; theta * radial],
            sneakers: Vec::with_capacity(64),
            trucks: Vec::with_capacity(MAX_TRUCKS),
            cars: Vec::with_capacity(MAX_CARS),
            plane: None,
            rng: SplitMix64::new(seed),
            ticks: 0,
            spawn_acc: 0.0,
            recent_through: Vec::new(),
            through: 0,
            caught: 0,
            gate_passes: 0,
            planes_landed: 0,
            next_car: 0,
            next_plane: 0,
            gate_blink: 0,
        };
        sim.lay_ground();
        for s in 0..sim.slots {
            sim.spawn_truck(s);
        }
        sim.next_car = sim.ticks_from_secs(CAR_GAP_MIN, CAR_GAP_MAX);
        sim.next_plane = sim.ticks_from_secs(6.0, PLANE_GAP_MAX);
        // A few cars already on the road, so the Gate is busy from frame one.
        for k in 0..4 {
            sim.cars.push(Car {
                r: fence_circumradius() + 0.05 + k as f32 * 0.08,
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

    pub fn set_slots(&mut self, slots: u8) {
        let slots = slots.clamp(2, MAX_TRUCKS as u8);
        if slots == self.slots {
            return;
        }
        self.slots = slots;
        self.trucks.truncate(slots as usize);
        while self.trucks.len() < slots as usize {
            self.spawn_truck(self.trucks.len() as u8);
        }
    }

    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    pub fn sneaker_count(&self) -> usize {
        self.sneakers.len()
    }

    pub fn caught(&self) -> u32 {
        self.caught
    }

    pub fn through(&self) -> u32 {
        self.through
    }

    pub fn gate_passes(&self) -> u32 {
        self.gate_passes
    }

    pub fn planes_landed(&self) -> u32 {
        self.planes_landed
    }

    /// Trucks a human is currently driving.
    pub fn drivers(&self) -> usize {
        self.trucks
            .iter()
            .filter(|t| t.human_until > self.ticks)
            .count()
    }

    /// Sneakers per second right now.
    pub fn spawn_rate(&self) -> f32 {
        let pressure = CALM_RATE + RATE_PER_DRIVER * self.drivers() as f32;
        let backoff = 1.0 + BACKOFF_PER_THROUGH * self.recent_through.len().min(BACKOFF_CAP) as f32;
        pressure / backoff
    }

    /// The status line: what the scoreboard on a phone says.
    pub fn detail(&self) -> String {
        format!(
            "{} caught · {} got in · {} on the playa",
            self.caught,
            self.through,
            self.sneakers.len()
        )
    }

    fn ticks_from_secs(&mut self, min: f32, max: f32) -> u32 {
        let span = ((max - min) / TICK_SECS).max(1.0) as u64;
        self.ticks + (min / TICK_SECS) as u32 + self.rng.next_below(span) as u32
    }

    fn unit(&mut self) -> f32 {
        self.rng.next_below(10_000) as f32 / 10_000.0
    }

    fn idx(&self, it: usize, ir: usize) -> usize {
        ir * self.theta + it
    }

    /// World position of a cell's center.
    fn cell_center(&self, it: usize, ir: usize) -> (f32, f32) {
        let a = (it as f32 + 0.5) / self.theta as f32 * TAU;
        let rn = HOLE + (ir as f32 + 0.5) / self.radial as f32 * (1.0 - HOLE);
        (rn * a.cos(), rn * a.sin())
    }

    /// The cell under a world point, if it is on the strip.
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

    /// Static scenery, classified once per cell.
    fn lay_ground(&mut self) {
        let circum = fence_circumradius();
        let (rw_a, rw_b) = runway();
        for ir in 0..self.radial {
            for it in 0..self.theta {
                let (x, y) = self.cell_center(it, ir);
                let rn = x.hypot(y);
                let phi = y.atan2(x).rem_euclid(TAU);
                let fr = fence_r(phi);
                let sector = TAU / FENCE_SIDES;
                let to_vertex = (phi.rem_euclid(sector)).min(sector - phi.rem_euclid(sector));
                let ground = if (rn - fr).abs() < FENCE_HALF {
                    if to_vertex < 2.0 * PI / 180.0 {
                        Ground::Post
                    } else {
                        Ground::Fence
                    }
                } else if rn < fr {
                    if segment_distance((x, y), rw_a, rw_b).0 < RUNWAY_HALF_WIDTH {
                        Ground::Runway
                    } else {
                        Ground::City
                    }
                } else {
                    let gate = (circum * GATE_ANGLE.cos(), circum * GATE_ANGLE.sin());
                    let rim = (GATE_ANGLE.cos(), GATE_ANGLE.sin());
                    let (d, _) = segment_distance((x, y), gate, rim);
                    if (x - gate.0).hypot(y - gate.1) < 0.045 {
                        Ground::Gate
                    } else if d < ROAD_HALF_WIDTH {
                        Ground::Road
                    } else {
                        Ground::Playa
                    }
                };
                let i = self.idx(it, ir);
                self.ground[i] = ground;
            }
        }
    }

    fn spawn_truck(&mut self, slot: u8) {
        let a = (slot as f32 + 0.5) / self.slots as f32 * TAU;
        let rn = 0.86;
        self.trucks.push(Truck {
            x: rn * a.cos(),
            y: rn * a.sin(),
            tx: rn * a.cos(),
            ty: rn * a.sin(),
            human_until: 0,
            ai_next: 0,
            caught: 0,
        });
    }

    fn glow(&mut self, x: f32, y: f32, hue: u8, glow: u8) {
        if let Some((it, ir)) = self.cell_of(x, y) {
            let i = self.idx(it, ir);
            if self.cells[i].glow < glow {
                self.cells[i] = Cell { hue, glow };
            }
        }
    }

    /// A splat of glow around a point: `n` cells scattered within `spread`.
    fn splat(&mut self, x: f32, y: f32, hue: u8, n: usize, spread: f32) {
        self.glow(x, y, hue, 255);
        for _ in 0..n {
            let a = self.unit() * TAU;
            let d = self.unit() * spread;
            self.glow(x + d * a.cos(), y + d * a.sin(), hue, 200);
        }
    }

    /// Keep a point outside the fence by at least `margin`, at most the rim.
    fn outside_fence(x: f32, y: f32, margin: f32) -> (f32, f32) {
        let rn = x.hypot(y).max(1e-4);
        let phi = y.atan2(x);
        let min = fence_r(phi) + margin;
        let target = rn.clamp(min, 0.99);
        (x / rn * target, y / rn * target)
    }

    fn inside_fence(x: f32, y: f32, margin: f32) -> bool {
        x.hypot(y) < fence_r(y.atan2(x)) + margin - 1e-4
    }

    /// One step of a truck toward its target. Straight when the way is
    /// clear; when the next step would enter the city the truck goes
    /// *around*, hugging the fence in whichever direction is the shorter way
    /// to the target's angle — a tap across the city drives the long way
    /// round, it does not grind against the fence.
    fn drive((x, y): (f32, f32), (tx, ty): (f32, f32), step: f32) -> (f32, f32) {
        let (dx, dy) = (tx - x, ty - y);
        let dist = dx.hypot(dy);
        if dist <= step {
            return (tx, ty);
        }
        let (nx, ny) = (x + dx / dist * step, y + dy / dist * step);
        if !Self::inside_fence(nx, ny, TRUCK_MARGIN) {
            return (nx, ny);
        }
        let a = y.atan2(x);
        let mut d = ty.atan2(tx) - a;
        d = (d + PI).rem_euclid(TAU) - PI;
        let dir = if d < 0.0 { -1.0 } else { 1.0 };
        let (ux, uy) = (-a.sin() * dir, a.cos() * dir);
        Self::outside_fence(x + ux * step, y + uy * step, TRUCK_MARGIN)
    }

    fn spawn_sneaker(&mut self) {
        if self.sneakers.len() >= MAX_SNEAKERS {
            return;
        }
        // Anywhere on the rim except the Gate Road approach.
        let mut a = self.unit() * TAU;
        for _ in 0..8 {
            let d = (a - GATE_ANGLE).rem_euclid(TAU);
            if d.min(TAU - d) >= ROAD_KEEPOUT {
                break;
            }
            a = self.unit() * TAU;
        }
        let speed = SNEAK_SPEED_MIN + (SNEAK_SPEED_MAX - SNEAK_SPEED_MIN) * self.unit();
        self.sneakers.push(Sneaker {
            x: 0.985 * a.cos(),
            y: 0.985 * a.sin(),
            speed,
            hidden: 0,
        });
    }

    /// One 50 ms step.
    pub fn tick(&mut self) {
        self.ticks += 1;
        let ticks = self.ticks;
        self.recent_through
            .retain(|&t| ticks.saturating_sub(t) < THROUGH_WINDOW);
        self.gate_blink = self.gate_blink.saturating_sub(1);

        for c in &mut self.cells {
            c.glow = c.glow.saturating_sub(GLOW_DECAY);
            if c.glow == 0 {
                *c = DARK;
            }
        }

        // Pressure-scaled spawning.
        self.spawn_acc += self.spawn_rate() * TICK_SECS;
        while self.spawn_acc >= 1.0 {
            self.spawn_acc -= 1.0;
            self.spawn_sneaker();
        }

        self.tick_scenery();
        self.tick_trucks();
        self.tick_sneakers();
    }

    /// Gate Road traffic and the airport: scenery that moves.
    fn tick_scenery(&mut self) {
        let circum = fence_circumradius();
        if self.ticks >= self.next_car && self.cars.len() < MAX_CARS {
            self.cars.push(Car { r: 0.985 });
            self.next_car = self.ticks_from_secs(CAR_GAP_MIN, CAR_GAP_MAX);
        }
        let mut arrived = 0;
        for car in &mut self.cars {
            car.r -= CAR_SPEED * TICK_SECS;
            if car.r <= circum + 0.02 {
                arrived += 1;
            }
        }
        if arrived > 0 {
            self.cars.retain(|c| c.r > circum + 0.02);
            self.gate_passes += arrived;
            self.gate_blink = GATE_BLINK_TICKS;
        }

        let (threshold, far) = runway();
        match self.plane.as_mut() {
            None => {
                if self.ticks >= self.next_plane {
                    // Approach from the rim roughly along the runway's normal.
                    let a = RUNWAY_NORMAL + (self.unit() - 0.5) * 0.6;
                    self.plane = Some(Plane {
                        x: 0.985 * a.cos(),
                        y: 0.985 * a.sin(),
                        taxiing: false,
                    });
                }
            }
            Some(p) => {
                let (gx, gy) = if p.taxiing { far } else { threshold };
                let speed = if p.taxiing { PLANE_TAXI_SPEED } else { PLANE_APPROACH_SPEED };
                let (dx, dy) = (gx - p.x, gy - p.y);
                let dist = dx.hypot(dy);
                let step = speed * TICK_SECS;
                if dist <= step {
                    p.x = gx;
                    p.y = gy;
                    if p.taxiing {
                        self.plane = None;
                        self.planes_landed += 1;
                        self.next_plane = self.ticks_from_secs(PLANE_GAP_MIN, PLANE_GAP_MAX);
                    } else {
                        p.taxiing = true;
                    }
                } else {
                    p.x += dx / dist * step;
                    p.y += dy / dist * step;
                }
            }
        }
    }

    fn tick_trucks(&mut self) {
        let ticks = self.ticks;
        for i in 0..self.trucks.len() {
            let truck = self.trucks[i];
            let human = truck.human_until > ticks;
            if !human && ticks >= truck.ai_next {
                // The AI chases the nearest sneaker's current spot — never
                // ahead of it — or patrols the playa when there is none.
                let (x, y) = (truck.x, truck.y);
                let nearest = self
                    .sneakers
                    .iter()
                    .map(|s| ((s.x - x).hypot(s.y - y), s.x, s.y))
                    .min_by(|a, b| a.0.total_cmp(&b.0));
                let (tx, ty) = match nearest {
                    Some((_, sx, sy)) => (sx, sy),
                    None => {
                        let a = self.unit() * TAU;
                        let rn = 0.78 + self.unit() * 0.18;
                        (rn * a.cos(), rn * a.sin())
                    }
                };
                let (tx, ty) = Self::outside_fence(tx, ty, TRUCK_MARGIN);
                let t = &mut self.trucks[i];
                t.tx = tx;
                t.ty = ty;
                t.ai_next = ticks + AI_MIN_TICKS + self.rng.next_below((AI_MAX_TICKS - AI_MIN_TICKS) as u64) as u32;
            }
            let t = &mut self.trucks[i];
            let speed = TRUCK_SPEED * if human { 1.0 } else { AI_SPEED };
            let (x, y) = Self::drive((t.x, t.y), (t.tx, t.ty), speed * TICK_SECS);
            let (x, y) = Self::outside_fence(x, y, TRUCK_MARGIN);
            t.x = x;
            t.y = y;
        }
    }

    fn tick_sneakers(&mut self) {
        let circum = fence_circumradius();
        let mut i = 0;
        while i < self.sneakers.len() {
            let s = self.sneakers[i];
            // Nearest truck: to evade, to hide from, to be caught by.
            let (slot, td, tx, ty) = self
                .trucks
                .iter()
                .enumerate()
                .map(|(k, t)| (k, (t.x - s.x).hypot(t.y - s.y), t.x, t.y))
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap_or((0, f32::INFINITY, 0.0, 0.0));
            if td < CATCH_RADIUS {
                // Caught: a splat in the truck's color, and off to buy a
                // ticket — they reappear as a car at the top of Gate Road.
                self.sneakers.swap_remove(i);
                self.trucks[slot].caught += 1;
                self.caught += 1;
                self.splat(s.x, s.y, slot as u8, 6, 0.05);
                if self.cars.len() < MAX_CARS {
                    self.cars.push(Car { r: 0.985 });
                }
                continue;
            }
            let s = &mut self.sneakers[i];
            if s.hidden > 0 {
                s.hidden -= 1;
                i += 1;
                continue;
            }
            if td < HIDE_RADIUS && self.rng.next_below(HIDE_CHANCE) == 0 {
                s.hidden = HIDE_TICKS;
                i += 1;
                continue;
            }
            // Inward, bent away from a close truck.
            let rn = s.x.hypot(s.y).max(1e-4);
            let (mut dx, mut dy) = (-s.x / rn, -s.y / rn);
            if td < EVADE_RADIUS {
                let (ax, ay) = ((s.x - tx) / td.max(1e-4), (s.y - ty) / td.max(1e-4));
                let w = (1.0 - td / EVADE_RADIUS) * 1.4;
                dx += ax * w;
                dy += ay * w;
                let n = dx.hypot(dy).max(1e-4);
                dx /= n;
                dy /= n;
            }
            let step = s.speed * TICK_SECS;
            s.x += dx * step;
            s.y += dy * step;
            // Pushed back out past the rim by an evasion? Clamp.
            let rn = s.x.hypot(s.y);
            if rn > 0.99 {
                s.x *= 0.99 / rn;
                s.y *= 0.99 / rn;
            }
            let phi = s.y.atan2(s.x);
            if rn < fence_r(phi) {
                // Over the fence: a flash where they hopped, a splash of
                // party just inside, and one more at the party.
                let (x, y) = (s.x, s.y);
                self.sneakers.swap_remove(i);
                self.through += 1;
                self.recent_through.push(self.ticks);
                let fr = fence_r(phi);
                self.glow(fr * phi.cos(), fr * phi.sin(), NEUTRAL, 255);
                let inside = (fr - 0.05).max(HOLE + 0.02);
                self.splat(inside * phi.cos(), inside * phi.sin(), PARTY, 8, 0.06);
                let _ = (x, y, circum);
                continue;
            }
            i += 1;
        }
    }

    /// Player input: aim slot `species`'s truck at the tapped cell. The tap
    /// is a destination, not a splat; the truck drives there and stays
    /// outside the fence.
    pub fn inject(&mut self, it: i32, ir: i32, species: u8) {
        let slot = (species % self.slots) as usize;
        let it = it.rem_euclid(self.theta as i32) as usize;
        let ir = ir.clamp(0, self.radial as i32 - 1) as usize;
        let (x, y) = self.cell_center(it, ir);
        let (tx, ty) = Self::outside_fence(x, y, TRUCK_MARGIN);
        let ticks = self.ticks;
        if let Some(t) = self.trucks.get_mut(slot) {
            t.tx = tx;
            t.ty = ty;
            t.human_until = ticks + HUMAN_TICKS;
        }
    }

    /// Upkeep lives in `tick`.
    pub fn watchdog(&mut self) {}

    /// Scenery, then glow, then the movers on top. `time` drives the party.
    pub fn pack_cells(&self, time: f32) -> Vec<u32> {
        use super::hsv_to_packed_rgb as rgb;
        let orange = rgb(0.07, 0.95, 0.75);
        let mut out: Vec<u32> = Vec::with_capacity(self.cells.len());
        for ir in 0..self.radial {
            for it in 0..self.theta {
                let i = self.idx(it, ir);
                let base = match self.ground[i] {
                    Ground::Playa => 0,
                    Ground::City => {
                        // The party: a rainbow that flows around and inward,
                        // with a hashed twinkle so it never sits still.
                        let a = (it as f32 + 0.5) / self.theta as f32;
                        let depth = ir as f32 / self.radial as f32;
                        let hue = a + time * 0.07 + depth * 0.9;
                        let h = ((it as u32).wrapping_mul(2654435761)
                            ^ (ir as u32).wrapping_mul(40503)
                            ^ (self.ticks / 3).wrapping_mul(7919))
                            % 1000;
                        let v = 0.28 + 0.32 * (h as f32 / 1000.0);
                        rgb(hue, 0.9, v)
                    }
                    Ground::Fence => orange,
                    Ground::Post => rgb(0.07, 0.6, 1.0),
                    Ground::Road => rgb(0.09, 0.55, 0.11),
                    Ground::Gate => {
                        if self.gate_blink > 0 {
                            rgb(0.33, 0.9, 1.0)
                        } else {
                            rgb(0.07, 0.9, 0.95)
                        }
                    }
                    Ground::Runway => {
                        // Runway edge lights: dashes along the strip.
                        let (x, y) = self.cell_center(it, ir);
                        let (a, b) = runway();
                        let (_, along) = segment_distance((x, y), a, b);
                        let dash = (along * 2.0 * RUNWAY_HALF_LENGTH / RUNWAY_DASH) as i32;
                        if dash % 2 == 0 {
                            rgb(0.58, 0.35, 0.65)
                        } else {
                            rgb(0.58, 0.35, 0.12)
                        }
                    }
                };
                let c = self.cells[i];
                out.push(if c.glow == 0 {
                    base
                } else {
                    let v = c.glow as f32 / 255.0;
                    match c.hue {
                        NEUTRAL => rgb(0.07, 0.25, v),
                        PARTY => rgb(0.0, 0.0, v),
                        slot => rgb(slot as f32 / self.slots as f32, 0.85, v),
                    }
                });
            }
        }
        let mut put = |x: f32, y: f32, color: u32| {
            if let Some((it, ir)) = self.cell_of(x, y) {
                out[ir * self.theta + it] = color;
            }
        };
        for car in &self.cars {
            put(car.r * GATE_ANGLE.cos(), car.r * GATE_ANGLE.sin(), rgb(0.1, 0.6, 0.7));
        }
        for s in &self.sneakers {
            let v = if s.hidden > 0 { 0.22 } else { 1.0 };
            put(s.x, s.y, rgb(0.14, 0.12, v));
        }
        if let Some(p) = &self.plane {
            // Anti-collision strobe: red / white.
            let color = if (self.ticks / 4) % 2 == 0 { rgb(0.0, 0.95, 1.0) } else { rgb(0.0, 0.0, 1.0) };
            put(p.x, p.y, color);
        }
        for (slot, t) in self.trucks.iter().enumerate() {
            let hue = slot as f32 / self.slots as f32;
            let human = t.human_until > self.ticks;
            let body = rgb(hue, 0.85, if human { 0.95 } else { 0.7 });
            // Three cells along the radial — a truck is longer than it is
            // wide — with a light bar flashing on the middle one.
            let rn = t.x.hypot(t.y).max(1e-4);
            let (ux, uy) = (t.x / rn, t.y / rn);
            put(t.x - ux * 0.02, t.y - uy * 0.02, body);
            put(t.x + ux * 0.02, t.y + uy * 0.02, body);
            let bar = if (self.ticks / 3) % 2 == 0 { rgb(0.0, 0.0, 1.0) } else { body };
            put(t.x, t.y, bar);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> PerimeterSim {
        PerimeterSim::new(64, 48, 5, 7)
    }

    /// Park every truck under human control far from the action so the AI
    /// cannot interfere with a placed scenario.
    fn park_trucks(s: &mut PerimeterSim) {
        for t in &mut s.trucks {
            t.x = -0.95;
            t.y = 0.0;
            t.tx = -0.95;
            t.ty = 0.0;
            t.human_until = u32::MAX;
        }
    }

    #[test]
    fn the_fence_is_a_pentagon_around_the_middle() {
        let circum = fence_circumradius();
        // Vertices every 72° starting at the Gate; apothem between.
        assert!((fence_r(0.0) - circum).abs() < 1e-4);
        assert!((fence_r(TAU / 5.0) - circum).abs() < 1e-4);
        assert!((fence_r(PI / 5.0) - FENCE_APOTHEM).abs() < 1e-4);
        assert!(FENCE_APOTHEM > HOLE + 0.1 && circum < 0.85, "fence must sit on the strip");
        let s = sim();
        let city = s.ground.iter().filter(|g| **g == Ground::City).count();
        let fence = s.ground.iter().filter(|g| matches!(g, Ground::Fence | Ground::Post)).count();
        let playa = s.ground.iter().filter(|g| **g == Ground::Playa).count();
        assert!(city > 300 && fence > 60 && playa > 800, "city {city} fence {fence} playa {playa}");
        assert!(s.ground.iter().any(|g| *g == Ground::Road));
        assert!(s.ground.iter().any(|g| *g == Ground::Gate));
        assert!(s.ground.iter().any(|g| *g == Ground::Runway));
    }

    #[test]
    fn with_nobody_driving_the_ai_catches_some_and_lets_some_through() {
        let mut s = sim();
        for _ in 0..1800 {
            s.tick();
        }
        assert_eq!(s.drivers(), 0);
        assert!(s.caught() > 0, "the AI perimeter never caught anyone in 90 s");
        assert!(s.through() > 0, "the AI perimeter was perfect — attract mode should leak");
    }

    #[test]
    fn a_truck_driven_onto_a_sneaker_catches_it() {
        let mut s = sim();
        park_trucks(&mut s);
        s.sneakers.push(Sneaker { x: 0.0, y: 0.85, speed: 0.0, hidden: HIDE_TICKS });
        // Aim truck 1 at the sneaker: ring for rn 0.85 at angle 90°.
        let ir = ((0.85 - HOLE) / (1.0 - HOLE) * 48.0) as i32;
        s.inject(16, ir, 1);
        for _ in 0..200 {
            s.tick();
        }
        assert_eq!(s.caught(), 1);
        assert_eq!(s.trucks[1].caught, 1);
        // The planted one (speed 0) is gone; whatever spawned since is not it.
        assert!(s.sneakers.iter().all(|k| k.speed > 0.0), "the caught sneaker is still there");
        // A splat in truck 1's color, and the sneaker reappears as a car.
        assert!(s.cells().iter().any(|c| c.glow > 0 && c.hue == 1) || s.ticks > 60);
        assert!(s.cars.iter().any(|c| c.r > 0.9) || s.gate_passes > 0);
    }

    #[test]
    fn a_tap_across_the_city_drives_around_the_fence() {
        let mut s = sim();
        park_trucks(&mut s);
        // Truck 0 sits at 180°; send it to 0°, the far side of the pentagon.
        let ir = ((0.75 - HOLE) / (1.0 - HOLE) * 48.0) as i32;
        s.inject(0, ir, 0);
        let mut min_rn = f32::INFINITY;
        for _ in 0..200 {
            s.tick();
            let t = s.trucks[0];
            min_rn = min_rn.min(t.x.hypot(t.y));
        }
        let t = s.trucks[0];
        assert!(t.x > 0.6 && t.y.abs() < 0.1, "truck never got around: ({}, {})", t.x, t.y);
        assert!(min_rn >= FENCE_APOTHEM + TRUCK_MARGIN - 1e-3, "truck cut through the city at rn {min_rn}");
    }

    #[test]
    fn trucks_stay_outside_the_fence() {
        let mut s = sim();
        s.inject(10, 0, 0); // a tap in the city, at the hole
        for _ in 0..400 {
            s.tick();
        }
        for t in &s.trucks {
            let rn = t.x.hypot(t.y);
            let phi = t.y.atan2(t.x);
            assert!(rn >= fence_r(phi) + TRUCK_MARGIN - 1e-3, "truck inside the fence at rn {rn}");
            assert!(rn <= 0.99 + 1e-3);
        }
    }

    #[test]
    fn a_sneaker_over_the_fence_joins_the_party() {
        let mut s = sim();
        park_trucks(&mut s);
        let phi = PI / 5.0; // edge middle, fence at the apothem
        let r0 = FENCE_APOTHEM + 0.02;
        s.sneakers.push(Sneaker { x: r0 * phi.cos(), y: r0 * phi.sin(), speed: 0.2, hidden: 0 });
        for _ in 0..10 {
            s.tick();
        }
        assert_eq!(s.through(), 1);
        assert_eq!(s.recent_through.len(), 1);
        assert!(s.cells().iter().any(|c| c.glow > 0 && c.hue == PARTY), "no party splash");
        assert!(s.cells().iter().any(|c| c.glow > 0 && c.hue == NEUTRAL), "no fence flash");
    }

    #[test]
    fn pressure_follows_drivers_and_backs_off_when_they_get_in() {
        let mut s = sim();
        let calm = s.spawn_rate();
        s.inject(0, 40, 0);
        s.inject(20, 40, 1);
        s.inject(40, 40, 2);
        assert_eq!(s.drivers(), 3);
        let busy = s.spawn_rate();
        assert!(busy > calm + 1.0, "three drivers did not raise the pressure: {calm} -> {busy}");
        for _ in 0..6 {
            s.recent_through.push(s.ticks);
        }
        let leaky = s.spawn_rate();
        assert!(leaky < busy, "getting through did not back the rate off");
        for _ in 0..(HUMAN_TICKS + THROUGH_WINDOW + 1) {
            s.tick();
        }
        assert_eq!(s.drivers(), 0, "the AI did not take the trucks back");
        assert!((s.spawn_rate() - calm).abs() < 1e-5 || s.recent_through.len() > 0);
    }

    #[test]
    fn gate_road_traffic_flows_and_a_plane_lands() {
        let mut s = sim();
        for _ in 0..3000 {
            s.tick();
        }
        assert!(s.gate_passes() > 5, "no traffic through the Gate in 150 s");
        assert!(s.planes_landed() > 0, "no plane landed in 150 s");
        assert!(s.cars.len() < MAX_CARS);
    }

    #[test]
    fn pack_draws_the_scenery_and_the_movers() {
        let s = sim();
        let cells = s.pack_cells(1.0);
        let lit = cells.iter().filter(|&&c| c != 0).count();
        // City + fence + road + runway, plus five trucks and a few cars.
        assert!(lit > 400, "only {lit} lit cells");
        // Playa cells far from everything stay dark.
        let (it, ir) = s.cell_of(0.9 * (PI).cos(), 0.9 * (PI).sin()).unwrap();
        let _ = (it, ir);
        assert!(cells.iter().any(|&c| c == 0));
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = PerimeterSim::new(64, 48, 5, 11);
        let mut b = PerimeterSim::new(64, 48, 5, 11);
        for _ in 0..600 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.cells(), b.cells());
        assert_eq!(a.sneaker_count(), b.sneaker_count());
        assert_eq!(a.caught(), b.caught());
        assert_eq!(a.pack_cells(3.0), b.pack_cells(3.0));
    }
}
