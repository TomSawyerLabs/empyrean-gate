//! Rock–paper–scissors ecosystem — the first game-mode simulation.
//!
//! A cyclic predator–prey cellular automaton on the polar cell grid: species
//! `i` is consumed by species `(i + 1) % S`. With a conversion threshold the
//! field self-organizes into rotating spiral fronts and never converges, which
//! is exactly the zero-player behavior game mode wants: the world runs forever
//! and players only steer it by injecting blobs of a species.
//!
//! Grid convention matches the array: θ index wraps (the ring is closed),
//! radial index clamps (the hole and the rim are hard edges). Cells are
//! radially thin and angularly wide; the CA does not care, and chunky fronts
//! read better from the dance floor anyway.

use super::SplitMix64;

/// A freshly-converted cell renders at full brightness…
pub const VIGOR_MAX: u8 = 255;
/// …and settles to this, so spiral frontiers shimmer over a calmer interior.
pub const VIGOR_FLOOR: u8 = 90;
/// Per-tick vigor decay: ~9 ticks from frontier to settled.
const VIGOR_DECAY: u8 = 18;

/// Neighbors of the predator species needed to convert a cell. 3 of 8 gives
/// clean advancing fronts; lower dissolves into noise, higher freezes.
const CONVERT_THRESHOLD: u8 = 3;

/// Watchdog floor: a species holding fewer than this fraction of cells gets
/// reseeded. On a small grid one species *can* be squeezed out, and a cyclic
/// ecosystem missing a link collapses to a single color — the one end state
/// the game must never reach.
const MIN_SPECIES_SHARE: f32 = 0.02;
/// Blobs the watchdog injects per starved species.
const WATCHDOG_BLOBS: usize = 4;

pub const MIN_SPECIES: u8 = 3;
pub const MAX_SPECIES: u8 = 5;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell {
    pub species: u8,
    pub vigor: u8,
}

pub struct RpsSim {
    theta: usize,
    radial: usize,
    species: u8,
    cells: Vec<Cell>,
    scratch: Vec<Cell>,
    rng: SplitMix64,
}

impl RpsSim {
    /// `theta` is one cell per spoke; `radial` divides rn 0.32..1.0. The grid
    /// starts as random soup, which resolves into spirals within a few dozen
    /// ticks — the attract mode needs no further setup.
    pub fn new(theta: usize, radial: usize, species: u8, seed: u64) -> Self {
        assert!(theta >= 8 && radial >= 8);
        let species = species.clamp(MIN_SPECIES, MAX_SPECIES);
        let mut rng = SplitMix64::new(seed);
        let cells = (0..theta * radial)
            .map(|_| Cell { species: rng.next_below(species as u64) as u8, vigor: VIGOR_FLOOR })
            .collect::<Vec<_>>();
        let scratch = cells.clone();
        Self { theta, radial, species, cells, scratch, rng }
    }

    pub fn theta(&self) -> usize {
        self.theta
    }

    pub fn radial(&self) -> usize {
        self.radial
    }

    pub fn species_count(&self) -> u8 {
        self.species
    }

    /// Live-adjustable from the admin controls. Cells of a species that no
    /// longer exists are folded back into range rather than reseeding the
    /// world — shrinking 5 → 3 mid-game just hands their territory over.
    pub fn set_species_count(&mut self, species: u8) {
        let species = species.clamp(MIN_SPECIES, MAX_SPECIES);
        if species == self.species {
            return;
        }
        self.species = species;
        for c in &mut self.cells {
            if c.species >= species {
                c.species %= species;
            }
        }
    }

    /// Cells in row-major order: `idx = ir * theta + it`, `ir = 0` at the hole.
    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    fn idx(&self, it: usize, ir: usize) -> usize {
        ir * self.theta + it
    }

    /// One CA generation. Deterministic: no randomness in the update rule, so
    /// identical state always steps to identical state (the watchdog is the
    /// only consumer of the RNG and is a separate call).
    pub fn tick(&mut self) {
        for ir in 0..self.radial {
            for it in 0..self.theta {
                let cell = self.cells[self.idx(it, ir)];
                let predator = (cell.species + 1) % self.species;
                let mut count = 0u8;
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
                        if self.cells[self.idx(nt as usize, nr as usize)].species == predator {
                            count += 1;
                        }
                    }
                }
                let dst = self.idx(it, ir);
                self.scratch[dst] = if count >= CONVERT_THRESHOLD {
                    Cell { species: predator, vigor: VIGOR_MAX }
                } else {
                    Cell {
                        species: cell.species,
                        vigor: cell.vigor.saturating_sub(VIGOR_DECAY).max(VIGOR_FLOOR),
                    }
                };
            }
        }
        std::mem::swap(&mut self.cells, &mut self.scratch);
    }

    /// Player (or watchdog) input: stamp an elliptical blob of `species`,
    /// centered on a cell, half-extents in cells. θ wraps, r clamps.
    pub fn inject(&mut self, it: i32, ir: i32, half_theta: f32, half_r: f32, species: u8) {
        let species = species % self.species;
        let (ht, hr) = (half_theta.max(0.5), half_r.max(0.5));
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
                self.cells[dst] = Cell { species, vigor: VIGOR_MAX };
            }
        }
    }

    /// Reseed any species squeezed below its survival floor. Called once per
    /// tick by the owner; kept out of `tick` so the update rule itself stays
    /// deterministic and testable.
    pub fn watchdog(&mut self) {
        let mut census = [0usize; MAX_SPECIES as usize];
        for c in &self.cells {
            census[c.species as usize] += 1;
        }
        let min = ((self.cells.len() as f32) * MIN_SPECIES_SHARE) as usize;
        for s in 0..self.species {
            if census[s as usize] >= min {
                continue;
            }
            for _ in 0..WATCHDOG_BLOBS {
                let it = self.rng.next_below(self.theta as u64) as i32;
                let ir = self.rng.next_below(self.radial as u64) as i32;
                self.inject(it, ir, 2.0, 4.0, s);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uniform(species: u8, fill: u8) -> RpsSim {
        let mut sim = RpsSim::new(64, 48, species, 1);
        for c in &mut sim.cells {
            *c = Cell { species: fill, vigor: VIGOR_FLOOR };
        }
        sim
    }

    fn census(sim: &RpsSim) -> [usize; MAX_SPECIES as usize] {
        let mut n = [0usize; MAX_SPECIES as usize];
        for c in sim.cells() {
            n[c.species as usize] += 1;
        }
        n
    }

    #[test]
    fn predator_blob_grows_and_prey_blob_is_eaten() {
        // Field of species 0. Species 1 (its predator) must spread; species 2
        // (its prey — 0 is the predator of 2) must be consumed.
        let mut sim = uniform(3, 0);
        sim.inject(10, 24, 3.0, 6.0, 1);
        sim.inject(40, 24, 3.0, 6.0, 2);
        let before = census(&sim);
        for _ in 0..12 {
            sim.tick();
        }
        let after = census(&sim);
        assert!(after[1] > before[1], "predator did not grow: {before:?} -> {after:?}");
        assert!(after[2] < before[2], "prey was not consumed: {before:?} -> {after:?}");
    }

    #[test]
    fn theta_wraps_across_the_seam() {
        // A predator blob centered on spoke 0 must advance into high-θ spokes.
        let mut sim = uniform(3, 0);
        sim.inject(0, 24, 2.0, 6.0, 1);
        for _ in 0..8 {
            sim.tick();
        }
        let seam = (56..64).any(|it| {
            (18..30).any(|ir| sim.cells()[ir * 64 + it].species == 1)
        });
        assert!(seam, "front did not cross the θ seam");
    }

    #[test]
    fn radial_edges_clamp() {
        // Injection hanging past the rim must neither wrap nor panic.
        let mut sim = uniform(3, 0);
        sim.inject(10, 47, 2.0, 6.0, 1);
        sim.inject(10, 0, 2.0, 6.0, 2);
        sim.tick();
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = RpsSim::new(64, 48, 3, 42);
        let mut b = RpsSim::new(64, 48, 3, 42);
        for _ in 0..50 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.cells(), b.cells());
    }

    #[test]
    fn watchdog_revives_a_collapsed_ecosystem() {
        let mut sim = uniform(3, 0); // species 1 and 2 extinct
        sim.watchdog();
        let n = census(&sim);
        assert!(n[1] > 0 && n[2] > 0, "watchdog left a species extinct: {n:?}");
    }

    #[test]
    fn zero_player_world_keeps_all_species_alive() {
        // The attract-mode property: random soup, no input, hundreds of
        // generations — every species still holds ground.
        let mut sim = RpsSim::new(64, 48, 3, 7);
        for _ in 0..400 {
            sim.tick();
            sim.watchdog();
        }
        let n = census(&sim);
        for s in 0..3 {
            assert!(n[s] > 64, "species {s} nearly extinct after 400 ticks: {n:?}");
        }
    }

    #[test]
    fn frontier_cells_are_bright_and_interiors_settle() {
        let mut sim = uniform(3, 0);
        sim.inject(10, 24, 3.0, 6.0, 1);
        sim.tick();
        let max = sim.cells().iter().map(|c| c.vigor).max().unwrap();
        assert_eq!(max, VIGOR_MAX, "no freshly-converted cell at max vigor");
        for _ in 0..60 {
            sim.tick();
        }
        // Everything untouched for a while must have decayed to the floor.
        let settled =
            sim.cells().iter().filter(|c| c.vigor == VIGOR_FLOOR).count() as f32
                / sim.cells().len() as f32;
        assert!(settled > 0.5, "interior did not settle: {settled}");
    }

    #[test]
    fn shrinking_species_count_folds_orphans_back_into_range() {
        let mut sim = RpsSim::new(64, 48, 5, 9);
        sim.set_species_count(3);
        assert!(sim.cells().iter().all(|c| c.species < 3));
    }
}
