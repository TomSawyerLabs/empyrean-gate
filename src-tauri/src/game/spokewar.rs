//! Spokewar — the first particle-substrate game (plans/game-mode.md).
//!
//! Every base is AI-run until a human picks up its chip, which is the whole
//! drop-in/drop-out story: the war was already happening, a player's taps just
//! aim one side's squads, and walking away hands the base back to the AI with
//! no seam. Territory decays continuously, so the map never settles and a
//! quit player's gains erode instead of freezing.
//!
//! Bases sit on the rim (outer feed end — where the players physically stand
//! around the array), aim is a tap anywhere on the disc, and squads of glowing
//! particles fly the vector from base to tap, painting territory as they go.
//! Crossing enemy territory is attrition: strong paint kills a particle while
//! losing strength, so pushing into a defended sector costs a stream, not a
//! tap. Enemy bases are indestructible — there is no elimination, only flux.
//!
//! Unlike the grid games this does not tick on the beat: particles want smooth
//! motion, so the sim runs at a fixed [`TICK_SECS`] and the engine's pack
//! interpolation smears each 50 ms step into continuous flight.

use super::SplitMix64;

/// Fixed simulation step — see module docs.
pub const TICK_SECS: f32 = 0.05;

/// Neutral cell owner.
const NEUTRAL: u8 = 0xff;
/// Freshly painted territory strength.
const TERRITORY_MAX: u8 = 220;
/// Strength decays by this much every [`DECAY_EVERY`] ticks (~22 s to fade).
const DECAY_STEP: u8 = 2;
const DECAY_EVERY: u32 = 4;
/// Strength a particle burns off an enemy cell as it dies there. Weaker paint
/// than `WEAK_CAPTURE` is simply overrun.
const ATTRITION: i16 = 90;
const WEAK_CAPTURE: u8 = 30;
/// Particles per squad (one tap / one AI volley).
const SQUAD: usize = 7;
/// Radial-equivalent speed in cells per second.
const SPEED: f32 = 14.0;
const MAX_PARTICLES: usize = 4000;
/// Rim band each base occupies.
const BASE_RINGS: usize = 3;
/// AI volley scheduling, in ticks (1.5 s .. 4.5 s).
const AI_MIN_TICKS: u32 = 30;
const AI_MAX_TICKS: u32 = 90;
const MAX_BASES: usize = 8;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell {
    /// Base index, or [`NEUTRAL`].
    pub owner: u8,
    pub strength: u8,
}

const EMPTY: Cell = Cell {
    owner: NEUTRAL,
    strength: 0,
};

#[derive(Clone, Copy, Debug)]
struct Particle {
    /// Position in cell space (θ wraps, fractional).
    t: f32,
    r: f32,
    /// Velocity in cells per tick.
    vt: f32,
    vr: f32,
    owner: u8,
    /// Remaining ticks; 0 = expire.
    life: u16,
}

pub struct SpokewarSim {
    theta: usize,
    radial: usize,
    bases: u8,
    cells: Vec<Cell>,
    particles: Vec<Particle>,
    rng: SplitMix64,
    ticks: u32,
    /// Tick at which each base's AI fires next. Humans and AI share bases —
    /// the AI keeps firing under a player, which reads as the base's garrison
    /// fighting alongside them and keeps zero-vs-one-player seamless.
    ai_next: [u32; MAX_BASES],
}

impl SpokewarSim {
    pub fn new(theta: usize, radial: usize, bases: u8, seed: u64) -> Self {
        assert!(theta >= 8 && radial >= 8);
        let mut sim = Self {
            theta,
            radial,
            bases: bases.clamp(2, MAX_BASES as u8),
            cells: vec![EMPTY; theta * radial],
            particles: Vec::with_capacity(1024),
            rng: SplitMix64::new(seed),
            ticks: 0,
            ai_next: [0; MAX_BASES],
        };
        for s in 0..MAX_BASES {
            sim.ai_next[s] = sim.rng.next_below((AI_MAX_TICKS - AI_MIN_TICKS) as u64) as u32;
        }
        sim
    }

    pub fn theta(&self) -> usize {
        self.theta
    }

    pub fn radial(&self) -> usize {
        self.radial
    }

    pub fn bases(&self) -> u8 {
        self.bases
    }

    pub fn set_bases(&mut self, bases: u8) {
        let bases = bases.clamp(2, MAX_BASES as u8);
        if bases == self.bases {
            return;
        }
        self.bases = bases;
        // Orphaned territory and armies go neutral/away rather than lingering
        // as unplayable colors.
        for c in &mut self.cells {
            if c.owner != NEUTRAL && c.owner >= bases {
                *c = EMPTY;
            }
        }
        self.particles.retain(|p| p.owner < bases);
    }

    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    pub fn particle_count(&self) -> usize {
        self.particles.len()
    }

    fn idx(&self, it: usize, ir: usize) -> usize {
        ir * self.theta + it
    }

    /// Center spoke of a base, evenly spread around the rim.
    fn base_center(&self, s: u8) -> f32 {
        (s as f32 + 0.5) * self.theta as f32 / self.bases as f32
    }

    /// Half-width of a base arc in spokes.
    fn base_half_width(&self) -> f32 {
        (self.theta as f32 / self.bases as f32 * 0.18).max(1.5)
    }

    /// Is this cell inside some base's rim band? Returns the owner.
    fn base_at(&self, it: usize, ir: usize) -> Option<u8> {
        if ir + BASE_RINGS < self.radial {
            return None;
        }
        let hw = self.base_half_width();
        for s in 0..self.bases {
            let mut d = (it as f32 - self.base_center(s)).abs();
            d = d.min(self.theta as f32 - d);
            if d <= hw {
                return Some(s);
            }
        }
        None
    }

    /// Shortest signed angular distance in cells, `from` → `to`.
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

    fn fire_squad(&mut self, owner: u8, target_t: f32, target_r: f32) {
        if self.particles.len() + SQUAD > MAX_PARTICLES {
            return;
        }
        let t0 = self.base_center(owner);
        let r0 = (self.radial - BASE_RINGS) as f32 - 1.0;
        let dt = self.wrap_diff(t0, target_t);
        let dr = target_r - r0;
        let dist = (dt * dt + dr * dr).sqrt().max(1.0);
        let step = SPEED * TICK_SECS;
        let life = (dist / step) as u16 + 30;
        for _ in 0..SQUAD {
            // Jitter direction and speed so a squad reads as a flight, not a line.
            let jt = (self.rng.next_below(1000) as f32 / 1000.0 - 0.5) * 0.35;
            let jr = (self.rng.next_below(1000) as f32 / 1000.0 - 0.5) * 0.35;
            let js = 0.8 + self.rng.next_below(1000) as f32 / 1000.0 * 0.4;
            let n = step * js / dist;
            self.particles.push(Particle {
                t: t0 + jt * 3.0,
                r: r0,
                vt: (dt + jt * dist * 0.2) * n,
                vr: (dr + jr * dist * 0.2) * n,
                owner,
                life,
            });
        }
    }

    /// One fixed 50 ms step: decay, AI volleys, particle flight + combat.
    pub fn tick(&mut self) {
        self.ticks += 1;
        if self.ticks.is_multiple_of(DECAY_EVERY) {
            for c in &mut self.cells {
                if c.owner != NEUTRAL {
                    c.strength = c.strength.saturating_sub(DECAY_STEP);
                    if c.strength == 0 {
                        *c = EMPTY;
                    }
                }
            }
        }
        for s in 0..self.bases {
            if self.ticks >= self.ai_next[s as usize] {
                // Aim somewhere in the contested middle of the disc.
                let tt = self.rng.next_below(self.theta as u64) as f32;
                let tr = self.radial as f32 * (0.15 + self.rng.next_below(50) as f32 / 100.0);
                self.fire_squad(s, tt, tr);
                self.ai_next[s as usize] = self.ticks
                    + AI_MIN_TICKS
                    + self.rng.next_below((AI_MAX_TICKS - AI_MIN_TICKS) as u64) as u32;
            }
        }
        let mut i = 0;
        while i < self.particles.len() {
            let p = &mut self.particles[i];
            p.t = (p.t + p.vt).rem_euclid(self.theta as f32);
            p.r += p.vr;
            p.life = p.life.saturating_sub(1);
            let (t, r, owner, dead_by_age) = (p.t, p.r, p.owner, p.life == 0);
            // Flew off the rim or into the hole (the hole eats armies).
            if dead_by_age || r < 0.0 || r >= self.radial as f32 {
                self.particles.swap_remove(i);
                continue;
            }
            let it = (t as usize).min(self.theta - 1);
            let ir = (r as usize).min(self.radial - 1);
            // Bases are indestructible: friendly ones are flown over,
            // enemy ones absorb the hit.
            if let Some(b) = self.base_at(it, ir) {
                if b != owner {
                    self.particles.swap_remove(i);
                } else {
                    i += 1;
                }
                continue;
            }
            let dst = self.idx(it, ir);
            let cell = self.cells[dst];
            if cell.owner == NEUTRAL || cell.owner == owner || cell.strength <= WEAK_CAPTURE {
                self.cells[dst] = Cell {
                    owner,
                    strength: TERRITORY_MAX,
                };
                i += 1;
            } else {
                // Defended ground: burn strength, lose the particle.
                let left = cell.strength as i16 - ATTRITION;
                self.cells[dst] = if left <= 0 {
                    EMPTY
                } else {
                    Cell {
                        owner: cell.owner,
                        strength: left as u8,
                    }
                };
                self.particles.swap_remove(i);
            }
        }
    }

    /// Player input: aim base `owner`'s squad at the tapped cell. The blob
    /// half-sizes the grid games use don't apply — a tap is a vector, not a
    /// splat.
    pub fn inject(&mut self, it: i32, ir: i32, owner: u8) {
        let owner = owner % self.bases;
        let tt = (it as f32).rem_euclid(self.theta as f32);
        let tr = (ir.max(0) as f32).min(self.radial as f32 - 1.0);
        self.fire_squad(owner, tt, tr);
    }

    /// Zero-player upkeep is the AI volleys inside `tick`; nothing to do here.
    pub fn watchdog(&mut self) {}

    /// Packed RGB per cell: bases bright, territory dim by strength, particles
    /// brightest, rasterized last. Hue = owner slot, same formula as the UI
    /// chips — never rotated, a base's color is its players' identity.
    pub fn pack_cells(&self) -> Vec<u32> {
        let hue = |owner: u8| owner as f32 / self.bases as f32;
        let mut out: Vec<u32> = Vec::with_capacity(self.cells.len());
        for ir in 0..self.radial {
            for it in 0..self.theta {
                let cell = self.cells[self.idx(it, ir)];
                out.push(if let Some(b) = self.base_at(it, ir) {
                    super::hsv_to_packed_rgb(hue(b), 0.80, 0.85)
                } else if cell.owner != NEUTRAL {
                    let v = 0.08 + 0.32 * (cell.strength as f32 / TERRITORY_MAX as f32);
                    super::hsv_to_packed_rgb(hue(cell.owner), 0.85, v)
                } else {
                    0
                });
            }
        }
        for p in &self.particles {
            let it = (p.t as usize).min(self.theta - 1);
            let ir = (p.r.max(0.0) as usize).min(self.radial - 1);
            out[ir * self.theta + it] = super::hsv_to_packed_rgb(hue(p.owner), 0.55, 1.0);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> SpokewarSim {
        SpokewarSim::new(64, 48, 4, 3)
    }

    #[test]
    fn bases_render_on_the_rim() {
        let s = sim();
        let cells = s.pack_cells();
        let rim = &cells[(s.radial() - 1) * s.theta()..];
        assert!(
            rim.iter().filter(|&&c| c != 0).count() >= 4,
            "no lit base cells on the rim"
        );
        // And the innermost ring starts dark.
        assert!(cells[..s.theta()].iter().all(|&c| c == 0));
    }

    #[test]
    fn a_tap_fires_a_squad_that_paints_territory() {
        let mut s = sim();
        s.ai_next = [u32::MAX; 8]; // silence the AI for the assertion
        s.inject(8, 5, 0); // base 0 center is spoke 8 of 64 with 4 bases
        assert_eq!(s.particle_count(), SQUAD);
        for _ in 0..200 {
            s.tick();
        }
        assert_eq!(s.particle_count(), 0, "squad should have expired");
        let owned = s.cells().iter().filter(|c| c.owner == 0).count();
        assert!(owned > 5, "squad painted almost nothing: {owned}");
    }

    #[test]
    fn defended_territory_attrits_attackers() {
        // Breaching one cell takes ceil(220/90) = 3 particles, so a 3-ring
        // wall needs ~9 in one column — more than a whole squad. (A 1-ring
        // wall CAN be punched by a squad; that partial-penetration is the
        // intended feel, so the test uses a wall that must hold.)
        let mut s = sim();
        s.ai_next = [u32::MAX; 8];
        let wall_r = 30;
        for it in 0..s.theta() {
            for ring in wall_r - 1..=wall_r + 1 {
                let i = s.idx(it, ring);
                s.cells[i] = Cell {
                    owner: 1,
                    strength: TERRITORY_MAX,
                };
            }
        }
        s.inject(8, 5, 0);
        for _ in 0..40 {
            s.tick();
        }
        // The squad died in the wall: no base-0 paint meaningfully deeper.
        let deep = s
            .cells()
            .iter()
            .enumerate()
            .filter(|(i, c)| c.owner == 0 && i / s.theta() < wall_r - 3)
            .count();
        assert_eq!(deep, 0, "attackers passed a 3-ring full-strength wall");
        // And the wall took damage where they hit (beyond mere decay).
        let decay_floor = TERRITORY_MAX - DECAY_STEP * (40 / DECAY_EVERY) as u8;
        let weakened = (wall_r - 1..=wall_r + 1)
            .flat_map(|ring| (0..s.theta()).map(move |it| (it, ring)))
            .filter(|&(it, ring)| {
                let c = s.cells()[s.idx(it, ring)];
                c.owner != 1 || c.strength < decay_floor
            })
            .count();
        assert!(weakened > 0, "wall took no damage");
    }

    #[test]
    fn territory_decays_to_neutral() {
        let mut s = sim();
        s.ai_next = [u32::MAX; 8];
        let i = s.idx(10, 10);
        s.cells[i] = Cell {
            owner: 2,
            strength: 8,
        };
        for _ in 0..(8 / DECAY_STEP as u32 * DECAY_EVERY + DECAY_EVERY) {
            s.tick();
        }
        assert_eq!(s.cells()[i], EMPTY);
    }

    #[test]
    fn zero_player_war_wages_itself() {
        let mut s = sim();
        for _ in 0..600 {
            s.tick();
        }
        let owned = s.cells().iter().filter(|c| c.owner != NEUTRAL).count();
        assert!(owned > 20, "AI bases painted almost nothing: {owned}");
    }

    #[test]
    fn shrinking_bases_clears_orphaned_colors() {
        let mut s = sim();
        s.ai_next = [u32::MAX; 8];
        let i = s.idx(5, 20);
        s.cells[i] = Cell {
            owner: 3,
            strength: 100,
        };
        s.inject(30, 10, 3);
        s.set_bases(2);
        assert_eq!(s.cells()[i], EMPTY);
        assert_eq!(s.particle_count(), 0);
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = SpokewarSim::new(64, 48, 4, 11);
        let mut b = SpokewarSim::new(64, 48, 4, 11);
        for _ in 0..300 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.cells(), b.cells());
        assert_eq!(a.particle_count(), b.particle_count());
    }
}
