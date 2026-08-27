//! Multi-color Game of Life — the second game-mode simulation.
//!
//! Conway's B3/S23 on the polar grid (θ wraps, hole/rim clamp), with color as
//! lineage: a newborn cell takes the circular-mean hue of its three parents,
//! so territories seeded by different players smear into gradients where their
//! colonies meet. Unlike the RPS ecosystem, plain Life *can* die out or freeze
//! into still lifes, so the watchdog does two jobs: revive a near-empty grid,
//! and drizzle a little soup when the population goes static — the attract
//! mode needs perpetual motion, not a museum of blocks.
//!
//! Player input paints *soup* (a sparse random fill in the blob), not solid
//! ink: a solid ellipse of live cells dies of overcrowding on the next tick,
//! which reads as the game eating your tap. Species `ERASE` clears instead.

use super::SplitMix64;

/// Newborn cells render at full brightness…
pub const VIGOR_MAX: u8 = 255;
/// …and settle here while they survive, so frontiers shimmer over calm interiors.
pub const VIGOR_FLOOR: u8 = 110;
const VIGOR_DECAY: u8 = 24;

/// `inject` species value that erases instead of painting.
pub const ERASE: u8 = 0xff;

/// Live fraction below which the watchdog reseeds the world.
const MIN_LIVE_SHARE: f32 = 0.06;
/// Ticks of unchanged population that count as "static" (still lifes and
/// period-2 oscillators both hold population constant) before soup drizzles.
const STATIC_TICKS: u32 = 24;
/// Fill probability of injected soup — sparse enough to evolve, dense enough
/// to read as a splat where the finger landed.
const SOUP_FILL: u32 = 2; // out of 5

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell {
    pub alive: bool,
    /// Hue in 0..=255 turns; meaningless while dead.
    pub hue: u8,
    pub vigor: u8,
}

const DEAD: Cell = Cell {
    alive: false,
    hue: 0,
    vigor: 0,
};

pub struct LifeSim {
    theta: usize,
    radial: usize,
    /// Player palette slots — hues are `slot / palette` turns. Unlike the RPS
    /// palette this never rotates: the chip in a player's hand is their color.
    palette: u8,
    cells: Vec<Cell>,
    scratch: Vec<Cell>,
    rng: SplitMix64,
    /// Population after each tick, for the static-world detector.
    last_population: usize,
    static_ticks: u32,
}

impl LifeSim {
    pub fn new(theta: usize, radial: usize, palette: u8, seed: u64) -> Self {
        assert!(theta >= 8 && radial >= 8);
        let mut sim = Self {
            theta,
            radial,
            palette: palette.clamp(2, 8),
            cells: vec![DEAD; theta * radial],
            scratch: vec![DEAD; theta * radial],
            rng: SplitMix64::new(seed),
            last_population: 0,
            static_ticks: 0,
        };
        // Opening soup: a handful of splats so the attract mode starts alive.
        for _ in 0..6 {
            let it = sim.rng.next_below(theta as u64) as i32;
            let ir = sim.rng.next_below(radial as u64) as i32;
            let slot = sim.rng.next_below(sim.palette as u64) as u8;
            sim.inject(it, ir, 4.0, 8.0, slot);
        }
        sim
    }

    pub fn theta(&self) -> usize {
        self.theta
    }

    pub fn radial(&self) -> usize {
        self.radial
    }

    pub fn palette(&self) -> u8 {
        self.palette
    }

    pub fn set_palette(&mut self, palette: u8) {
        // Existing cells keep their hues — colors are lineage, not indices.
        self.palette = palette.clamp(2, 8);
    }

    /// Cells in row-major order: `idx = ir * theta + it`, ring 0 at the hole.
    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    pub fn population(&self) -> usize {
        self.cells.iter().filter(|c| c.alive).count()
    }

    fn idx(&self, it: usize, ir: usize) -> usize {
        ir * self.theta + it
    }

    fn slot_hue(&self, slot: u8) -> u8 {
        ((slot as u32 % self.palette as u32) * 256 / self.palette as u32) as u8
    }

    /// One B3/S23 generation. Deterministic; the RNG is only used by `inject`
    /// and `watchdog`.
    pub fn tick(&mut self) {
        for ir in 0..self.radial {
            for it in 0..self.theta {
                let mut neighbors = 0u8;
                // Circular mean of parent hues, so red+red+blue skews red
                // instead of averaging across the wheel to a color no parent
                // had. Angles double-counted as unit vectors.
                let (mut hx, mut hy) = (0.0f32, 0.0f32);
                for dr in -1i32..=1 {
                    let nr = ir as i32 + dr;
                    if nr < 0 || nr >= self.radial as i32 {
                        continue; // hole / rim: edge, not wrap
                    }
                    for dt in -1i32..=1 {
                        if dr == 0 && dt == 0 {
                            continue;
                        }
                        let nt = (it as i32 + dt).rem_euclid(self.theta as i32);
                        let n = self.cells[self.idx(nt as usize, nr as usize)];
                        if n.alive {
                            neighbors += 1;
                            let a = n.hue as f32 / 256.0 * std::f32::consts::TAU;
                            hx += a.cos();
                            hy += a.sin();
                        }
                    }
                }
                let cell = self.cells[self.idx(it, ir)];
                let dst = self.idx(it, ir);
                self.scratch[dst] = if cell.alive {
                    if neighbors == 2 || neighbors == 3 {
                        Cell {
                            alive: true,
                            hue: cell.hue,
                            vigor: cell.vigor.saturating_sub(VIGOR_DECAY).max(VIGOR_FLOOR),
                        }
                    } else {
                        DEAD
                    }
                } else if neighbors == 3 {
                    let mean = hy.atan2(hx).rem_euclid(std::f32::consts::TAU);
                    Cell {
                        alive: true,
                        hue: (mean / std::f32::consts::TAU * 256.0) as u8,
                        vigor: VIGOR_MAX,
                    }
                } else {
                    DEAD
                };
            }
        }
        std::mem::swap(&mut self.cells, &mut self.scratch);
        let pop = self.population();
        if pop == self.last_population {
            self.static_ticks += 1;
        } else {
            self.static_ticks = 0;
            self.last_population = pop;
        }
    }

    /// Player (or watchdog) input. Paints sparse soup of the slot's hue in an
    /// elliptical blob — or clears it when `slot` is [`ERASE`]. θ wraps, r
    /// clamps.
    pub fn inject(&mut self, it: i32, ir: i32, half_theta: f32, half_r: f32, slot: u8) {
        let (ht, hr) = (half_theta.max(0.5), half_r.max(0.5));
        let hue = if slot == ERASE {
            0
        } else {
            self.slot_hue(slot)
        };
        for dr in -(hr.ceil() as i32)..=(hr.ceil() as i32) {
            let nr = ir + dr;
            if nr < 0 || nr >= self.radial as i32 {
                continue;
            }
            for dt in -(ht.ceil() as i32)..=(ht.ceil() as i32) {
                let e = (dt as f32 / ht).powi(2) + (dr as f32 / hr).powi(2);
                if e > 1.0 {
                    continue;
                }
                let nt = (it + dt).rem_euclid(self.theta as i32);
                let dst = self.idx(nt as usize, nr as usize);
                if slot == ERASE {
                    self.cells[dst] = DEAD;
                } else if self.rng.next_below(5) < SOUP_FILL as u64 {
                    self.cells[dst] = Cell {
                        alive: true,
                        hue,
                        vigor: VIGOR_MAX,
                    };
                }
            }
        }
    }

    /// Keep the attract mode alive AND moving: reseed a near-empty world, and
    /// drizzle one splat of soup when the population has been static long
    /// enough to mean still lifes and oscillators are all that's left.
    pub fn watchdog(&mut self) {
        let min = ((self.cells.len() as f32) * MIN_LIVE_SHARE) as usize;
        let starving = self.population() < min;
        let stalled = self.static_ticks >= STATIC_TICKS;
        if !starving && !stalled {
            return;
        }
        let blobs = if starving { 4 } else { 1 };
        for _ in 0..blobs {
            let it = self.rng.next_below(self.theta as u64) as i32;
            let ir = self.rng.next_below(self.radial as u64) as i32;
            let slot = self.rng.next_below(self.palette as u64) as u8;
            self.inject(it, ir, 3.0, 6.0, slot);
        }
        self.static_ticks = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty() -> LifeSim {
        let mut sim = LifeSim::new(64, 48, 4, 1);
        sim.cells.fill(DEAD);
        sim.last_population = 0;
        sim
    }

    fn set(sim: &mut LifeSim, cells: &[(usize, usize)], hue: u8) {
        for &(it, ir) in cells {
            let i = sim.idx(it, ir);
            sim.cells[i] = Cell {
                alive: true,
                hue,
                vigor: VIGOR_FLOOR,
            };
        }
    }

    #[test]
    fn block_still_life_survives() {
        let mut sim = empty();
        set(&mut sim, &[(10, 10), (11, 10), (10, 11), (11, 11)], 40);
        sim.tick();
        assert_eq!(sim.population(), 4);
        assert!(sim.cells()[sim.idx(10, 10)].alive);
    }

    #[test]
    fn blinker_oscillates() {
        let mut sim = empty();
        set(&mut sim, &[(9, 10), (10, 10), (11, 10)], 40);
        sim.tick();
        // Horizontal bar becomes vertical: same center, rotated.
        assert!(sim.cells()[sim.idx(10, 9)].alive);
        assert!(sim.cells()[sim.idx(10, 10)].alive);
        assert!(sim.cells()[sim.idx(10, 11)].alive);
        assert_eq!(sim.population(), 3);
        sim.tick();
        assert!(sim.cells()[sim.idx(9, 10)].alive);
        assert_eq!(sim.population(), 3);
    }

    #[test]
    fn blinker_works_across_the_theta_seam() {
        let mut sim = empty();
        set(&mut sim, &[(63, 10), (0, 10), (1, 10)], 40);
        sim.tick();
        assert!(sim.cells()[sim.idx(0, 9)].alive);
        assert!(sim.cells()[sim.idx(0, 10)].alive);
        assert!(sim.cells()[sim.idx(0, 11)].alive);
    }

    #[test]
    fn overcrowding_kills_and_solitude_kills() {
        let mut sim = empty();
        // A solid 3×3 block: the center has 8 neighbors and dies.
        set(
            &mut sim,
            &[
                (10, 10),
                (11, 10),
                (12, 10),
                (10, 11),
                (11, 11),
                (12, 11),
                (10, 12),
                (11, 12),
                (12, 12),
            ],
            40,
        );
        sim.tick();
        assert!(
            !sim.cells()[sim.idx(11, 11)].alive,
            "center should die of overcrowding"
        );
        // A lone cell dies of solitude.
        let mut sim = empty();
        set(&mut sim, &[(30, 30)], 40);
        sim.tick();
        assert_eq!(sim.population(), 0);
    }

    #[test]
    fn newborn_hue_is_the_parents_hue_when_they_agree() {
        let mut sim = empty();
        set(&mut sim, &[(9, 10), (10, 10), (11, 10)], 64);
        sim.tick();
        let born = sim.cells()[sim.idx(10, 9)];
        assert!(born.alive);
        // Circular mean of three identical hues is that hue (± rounding).
        assert!((born.hue as i16 - 64).abs() <= 1, "hue {} != ~64", born.hue);
        assert_eq!(born.vigor, VIGOR_MAX);
    }

    #[test]
    fn erase_clears_a_blob() {
        let mut sim = empty();
        set(&mut sim, &[(10, 10), (11, 10), (10, 11), (11, 11)], 40);
        sim.inject(10, 10, 3.0, 3.0, ERASE);
        assert_eq!(sim.population(), 0);
    }

    #[test]
    fn watchdog_revives_an_empty_world() {
        let mut sim = empty();
        sim.watchdog();
        assert!(sim.population() > 0, "watchdog left the world dead");
    }

    #[test]
    fn watchdog_drizzles_soup_when_the_world_goes_static() {
        let mut sim = empty();
        // A block is a still life: population constant forever.
        set(&mut sim, &[(10, 10), (11, 10), (10, 11), (11, 11)], 40);
        // Population starts above the starvation floor? No — 4 cells of 3072
        // is starving, so pad with more blocks to isolate the static path.
        for i in 0..50 {
            let it = 2 + (i % 15) * 4;
            let ir = 2 + (i / 15) * 4;
            set(
                &mut sim,
                &[(it, ir), (it + 1, ir), (it, ir + 1), (it + 1, ir + 1)],
                90,
            );
        }
        let start = sim.population();
        // The first tick registers the population; the counter starts after it.
        for _ in 0..=STATIC_TICKS {
            sim.tick();
        }
        assert_eq!(
            sim.population(),
            start,
            "test setup should be all still lifes"
        );
        sim.watchdog();
        assert_ne!(
            sim.population(),
            start,
            "no soup arrived for a static world"
        );
    }

    #[test]
    fn zero_player_world_stays_alive_for_hundreds_of_ticks() {
        let mut sim = LifeSim::new(64, 48, 4, 7);
        for _ in 0..400 {
            sim.tick();
            sim.watchdog();
        }
        assert!(
            sim.population() > 60,
            "attract mode starved: {}",
            sim.population()
        );
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = LifeSim::new(64, 48, 4, 42);
        let mut b = LifeSim::new(64, 48, 4, 42);
        for _ in 0..50 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.cells(), b.cells());
    }
}
