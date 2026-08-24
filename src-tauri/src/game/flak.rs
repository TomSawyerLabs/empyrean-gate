//! Flak — inverted Missile Command, pure co-op (plans/game-mode.md).
//!
//! Meteors fall from the rim toward the center hole; a tap detonates a flak
//! bloom at that spot — an expanding ring that vaporizes every meteor it
//! catches, flashing sparkles in the defender's chip color. Nothing is lost
//! when a meteor gets through (an impact is a flash at the inner edge, not a
//! game over): the pressure is the game, not a fail state.
//!
//! Two scaling rules keep 0..N players one continuous world:
//! - **Storm pressure follows the crowd.** The spawn rate rises with how many
//!   blooms humans have fired recently, so one person defending is a calm
//!   shower and ten make a barrage. Walk away and the storm calms back down.
//! - **The grid defends itself, lazily.** When no human has fired for a few
//!   seconds an auto-bloom occasionally goes off (neutral white), so the
//!   attract mode shows the game being played, badly enough to leave meteors
//!   visibly slipping through — an invitation, not a performance.

use super::SplitMix64;

/// Fixed step, shared with the other particle sims.
pub const TICK_SECS: f32 = 0.05;

/// Base meteor spawns per second with a quiet crowd…
const CALM_RATE: f32 = 0.8;
/// …plus this much per recent human bloom (capped).
const RATE_PER_BLOOM: f32 = 0.35;
const RATE_BLOOMS_CAP: u32 = 10;
/// Sliding pressure window, in ticks (~12 s).
const PRESSURE_TICKS: u32 = 240;

/// Bloom lifetime in ticks (1 s) and final ring radius in cells.
const BLOOM_TICKS: u32 = 20;
const BLOOM_RADIUS: f32 = 8.0;
const MAX_BLOOMS: usize = 24;
/// Ticks of human silence before the lazy auto-defense may fire (~4 s), and
/// its chance per tick once allowed (~every 2.5 s on average).
const AUTO_AFTER_TICKS: u32 = 80;
const AUTO_CHANCE: u64 = 50; // 1-in-N per tick

/// Meteor radial speed range, cells per second.
const SPEED_MIN: f32 = 4.0;
const SPEED_MAX: f32 = 9.0;
const MAX_METEORS: usize = 600;

/// Trail/sparkle glow decays this much per tick (~0.5 s visible).
const GLOW_DECAY: u8 = 25;

/// Neutral hue slot for auto-blooms and meteor trails (rendered warm/white,
/// not a player color).
const NEUTRAL: u8 = 0xff;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell {
    /// Hue in 0..=255 turns (players) or [`NEUTRAL`].
    pub hue: u8,
    pub glow: u8,
}

const DARK: Cell = Cell { hue: NEUTRAL, glow: 0 };

#[derive(Clone, Copy, Debug)]
struct Meteor {
    t: f32,
    r: f32,
    /// Cells per tick.
    vt: f32,
    vr: f32,
}

#[derive(Clone, Copy, Debug)]
struct Bloom {
    t: f32,
    r: f32,
    age: u32,
    /// Color slot, or [`NEUTRAL`] for the auto-defense.
    owner: u8,
}

pub struct FlakSim {
    theta: usize,
    radial: usize,
    /// Player color slots (the chips).
    slots: u8,
    cells: Vec<Cell>,
    meteors: Vec<Meteor>,
    blooms: Vec<Bloom>,
    rng: SplitMix64,
    ticks: u32,
    /// Spawn-rate accumulator (spawns when it crosses 1).
    spawn_acc: f32,
    /// Tick stamps of recent human blooms, for the pressure window.
    recent: Vec<u32>,
    /// Last tick a human fired, for the lazy auto-defense.
    last_human: u32,
}

impl FlakSim {
    pub fn new(theta: usize, radial: usize, slots: u8, seed: u64) -> Self {
        Self {
            theta,
            radial,
            slots: slots.clamp(2, 8),
            cells: vec![DARK; theta * radial],
            meteors: Vec::with_capacity(256),
            blooms: Vec::with_capacity(MAX_BLOOMS),
            rng: SplitMix64::new(seed),
            ticks: 0,
            spawn_acc: 0.0,
            recent: Vec::new(),
            last_human: 0,
        }
    }

    pub fn theta(&self) -> usize {
        self.theta
    }

    pub fn radial(&self) -> usize {
        self.radial
    }

    pub fn set_slots(&mut self, slots: u8) {
        self.slots = slots.clamp(2, 8);
    }

    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    pub fn meteor_count(&self) -> usize {
        self.meteors.len()
    }

    pub fn bloom_count(&self) -> usize {
        self.blooms.len()
    }

    /// Meteor spawns per second right now (pressure-scaled) — public for
    /// tests and, later, a status line.
    pub fn spawn_rate(&self) -> f32 {
        let pressure = self.recent.len().min(RATE_BLOOMS_CAP as usize) as f32;
        CALM_RATE + RATE_PER_BLOOM * pressure
    }

    fn idx(&self, it: usize, ir: usize) -> usize {
        ir * self.theta + it
    }

    fn slot_hue(&self, slot: u8) -> u8 {
        if slot == NEUTRAL {
            return NEUTRAL;
        }
        ((slot as u32 % self.slots as u32) * 256 / self.slots as u32) as u8
    }

    fn wrap_diff(&self, from: f32, to: f32) -> f32 {
        let half = self.theta as f32 / 2.0;
        let mut d = to - from;
        while d > half {
            d -= self.theta as f32;
        }
        while d < -half {
            d += self.theta as f32;
        }
        d
    }

    fn glow(&mut self, it: i32, ir: i32, hue: u8, glow: u8) {
        if ir < 0 || ir >= self.radial as i32 {
            return;
        }
        let it = it.rem_euclid(self.theta as i32) as usize;
        let dst = self.idx(it, ir as usize);
        if self.cells[dst].glow < glow {
            self.cells[dst] = Cell { hue, glow };
        }
    }

    fn detonate(&mut self, t: f32, r: f32, owner: u8) {
        if self.blooms.len() >= MAX_BLOOMS {
            return;
        }
        self.blooms.push(Bloom { t, r, age: 0, owner });
    }

    /// One 50 ms step: spawn by pressure, fall, expand blooms, vaporize.
    pub fn tick(&mut self) {
        self.ticks += 1;
        let ticks = self.ticks;
        self.recent.retain(|&t| ticks.saturating_sub(t) < PRESSURE_TICKS);

        for c in &mut self.cells {
            c.glow = c.glow.saturating_sub(GLOW_DECAY);
            if c.glow == 0 {
                *c = DARK;
            }
        }

        // Lazy auto-defense: only when humans have gone quiet, deliberately
        // imperfect (fires at a random meteor's CURRENT spot, so fast ones
        // outrun it and visibly slip through).
        if ticks.saturating_sub(self.last_human) > AUTO_AFTER_TICKS
            && !self.meteors.is_empty()
            && self.rng.next_below(AUTO_CHANCE) == 0
        {
            let m = self.meteors[self.rng.next_below(self.meteors.len() as u64) as usize];
            self.detonate(m.t, m.r, NEUTRAL);
        }

        self.spawn_acc += self.spawn_rate() * TICK_SECS;
        while self.spawn_acc >= 1.0 && self.meteors.len() < MAX_METEORS {
            self.spawn_acc -= 1.0;
            let t = self.rng.next_below(self.theta as u64 * 8) as f32 / 8.0;
            let speed = SPEED_MIN
                + (SPEED_MAX - SPEED_MIN) * self.rng.next_below(1000) as f32 / 1000.0;
            // A slight sideways drift so falls read as streaks, not elevator
            // rides down one spoke.
            let drift = (self.rng.next_below(1000) as f32 / 1000.0 - 0.5) * 0.5;
            self.meteors.push(Meteor {
                t,
                r: self.radial as f32 - 1.0,
                vt: drift * speed * TICK_SECS,
                vr: -speed * TICK_SECS,
            });
        }

        for b in &mut self.blooms {
            b.age += 1;
        }

        let mut i = 0;
        'meteors: while i < self.meteors.len() {
            let m = &mut self.meteors[i];
            m.t = (m.t + m.vt).rem_euclid(self.theta as f32);
            m.r += m.vr;
            let (t, r) = (m.t, m.r);
            if r < 1.0 {
                // Impact at the hole: a warm flash, not a fail state.
                let it = t as i32;
                for dt in -2i32..=2 {
                    self.glow(it + dt, 0, 0, 230);
                    self.glow(it + dt, 1, 0, 160);
                }
                self.meteors.swap_remove(i);
                continue;
            }
            for bi in 0..self.blooms.len() {
                let b = self.blooms[bi];
                let radius = BLOOM_RADIUS * (b.age as f32 / BLOOM_TICKS as f32).min(1.0);
                let dt = self.wrap_diff(b.t, t);
                let dr = r - b.r;
                if dt * dt + dr * dr <= radius * radius {
                    // Vaporized: a sparkle splat in the defender's color.
                    let hue = self.slot_hue(b.owner);
                    for _ in 0..5 {
                        let st = t as i32 + self.rng.next_below(5) as i32 - 2;
                        let sr = r as i32 + self.rng.next_below(5) as i32 - 2;
                        self.glow(st, sr, hue, 255);
                    }
                    self.meteors.swap_remove(i);
                    continue 'meteors;
                }
            }
            // Falling: a short warm trail behind the bright head.
            self.glow(t as i32, r as i32, NEUTRAL, 140);
            i += 1;
        }

        self.blooms.retain(|b| b.age < BLOOM_TICKS + 6);
    }

    /// Player input: detonate a bloom at the tapped cell.
    pub fn inject(&mut self, it: i32, ir: i32, owner: u8) {
        let owner = owner % self.slots;
        self.last_human = self.ticks;
        self.recent.push(self.ticks);
        self.detonate(
            (it as f32).rem_euclid(self.theta as f32),
            (ir.max(0) as f32).min(self.radial as f32 - 1.0),
            owner,
        );
    }

    /// Upkeep (spawning, auto-defense) lives in `tick`.
    pub fn watchdog(&mut self) {}

    /// Trails and sparkles from the glow grid, then bloom rings, then meteor
    /// heads on top.
    pub fn pack_cells(&self) -> Vec<u32> {
        let mut out: Vec<u32> = self
            .cells
            .iter()
            .map(|c| {
                if c.glow == 0 {
                    return 0;
                }
                let v = c.glow as f32 / 255.0;
                if c.hue == NEUTRAL {
                    // Warm ember trail.
                    super::hsv_to_packed_rgb(0.07, 0.65, v * 0.55)
                } else {
                    super::hsv_to_packed_rgb(c.hue as f32 / 256.0, 0.85, v * 0.8)
                }
            })
            .collect();
        for b in &self.blooms {
            let age = b.age as f32 / BLOOM_TICKS as f32;
            let radius = BLOOM_RADIUS * age.min(1.0);
            let fade = (1.0 - (age - 1.0).max(0.0) / 0.3).clamp(0.0, 1.0);
            let (hue, sat) = if b.owner == NEUTRAL {
                (0.0, 0.05)
            } else {
                (self.slot_hue(b.owner) as f32 / 256.0, 0.75)
            };
            let color = super::hsv_to_packed_rgb(hue, sat, 0.9 * fade);
            // Rasterize the ring by walking the circle.
            let steps = (radius * 8.0) as i32 + 8;
            for k in 0..steps {
                let a = k as f32 / steps as f32 * std::f32::consts::TAU;
                let it = (b.t + radius * a.cos()).rem_euclid(self.theta as f32) as usize;
                let ir = b.r + radius * a.sin();
                if ir < 0.0 || ir >= self.radial as f32 {
                    continue;
                }
                let dst = ir as usize * self.theta + it.min(self.theta - 1);
                out[dst] = color;
            }
        }
        for m in &self.meteors {
            let it = (m.t as usize).min(self.theta - 1);
            let ir = (m.r.max(0.0) as usize).min(self.radial - 1);
            out[ir * self.theta + it] = super::hsv_to_packed_rgb(0.09, 0.35, 1.0);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> FlakSim {
        FlakSim::new(64, 48, 4, 5)
    }

    #[test]
    fn meteors_spawn_fall_and_impact() {
        let mut s = sim();
        for _ in 0..100 {
            s.tick();
        }
        assert!(s.meteor_count() > 0, "no meteors after 5 s");
        // Long before any meteor could cross 47 cells at ≤0.45 cells/tick,
        // none have impacted; after enough ticks the earliest spawns have.
        let mut impacts = 0;
        for _ in 0..400 {
            s.tick();
            if s.cells().iter().take(64).any(|c| c.glow > 0) {
                impacts += 1;
            }
        }
        assert!(impacts > 0, "no meteor ever reached the hole");
    }

    #[test]
    fn a_bloom_vaporizes_meteors_in_range() {
        let mut s = sim();
        // Plant a meteor mid-field, then detonate on top of it.
        s.meteors.push(Meteor { t: 20.0, r: 24.0, vt: 0.0, vr: -0.2 });
        s.inject(20, 24, 1);
        for _ in 0..4 {
            s.tick();
        }
        assert_eq!(s.meteor_count(), 0, "meteor survived a point-blank bloom");
        // The sparkle splat carries the defender's hue (slot 1 of 4 = 64).
        assert!(
            s.cells().iter().any(|c| c.glow > 0 && c.hue == 64),
            "no colored sparkles from the kill"
        );
    }

    #[test]
    fn pressure_rises_with_human_blooms_and_calms_back_down() {
        let mut s = sim();
        let calm = s.spawn_rate();
        for i in 0..8 {
            s.inject(i * 7, 30, 0);
            s.tick();
        }
        assert!(s.spawn_rate() > calm + 1.0, "storm did not rise under fire");
        for _ in 0..(PRESSURE_TICKS + 1) {
            s.tick();
        }
        assert_eq!(s.spawn_rate(), calm, "storm never calmed back down");
    }

    #[test]
    fn auto_defense_fires_only_after_human_silence() {
        let mut s = sim();
        s.inject(10, 30, 0); // a human just fired
        let mut auto_blooms_early = 0;
        for _ in 0..AUTO_AFTER_TICKS {
            s.tick();
            auto_blooms_early += s.blooms.iter().filter(|b| b.owner == NEUTRAL).count();
        }
        assert_eq!(auto_blooms_early, 0, "auto-defense fired while a human was active");
        let mut auto_blooms_late = 0;
        for _ in 0..2000 {
            s.tick();
            auto_blooms_late += s.blooms.iter().filter(|b| b.owner == NEUTRAL).count();
        }
        assert!(auto_blooms_late > 0, "auto-defense never fired in 100 quiet seconds");
    }

    #[test]
    fn glow_trails_decay_to_dark() {
        let mut s = sim();
        s.glow(5, 5, 0, 200);
        for _ in 0..(200 / GLOW_DECAY as u32 + 2) {
            s.tick();
        }
        let c = s.cells()[s.idx(5, 5)];
        // The cell may have been re-lit by a falling meteor; accept either
        // dark or freshly warm, but not the original stamp.
        assert!(c != Cell { hue: 0, glow: 200 }, "glow never decayed");
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = FlakSim::new(64, 48, 4, 9);
        let mut b = FlakSim::new(64, 48, 4, 9);
        for _ in 0..500 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.meteor_count(), b.meteor_count());
        assert_eq!(a.cells(), b.cells());
    }
}
