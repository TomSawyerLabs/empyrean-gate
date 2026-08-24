//! Game mode — continuously-running simulations the array becomes when an admin
//! starts a game. Design center (see `plans/game-mode.md`): every game is a
//! zero-player-capable world; connected clients perturb it, they are not
//! prerequisites. This module holds the pure simulation cores; engine/protocol
//! wiring lives with the rest of the frame loop.

pub mod flak;
pub mod life;
pub mod rps;
pub mod spokewar;

use serde::{Deserialize, Serialize};
use std::time::Instant;

/// The games the engine knows how to run. Serialized snake_case on the wire
/// and in status, like every other kind enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameKind {
    /// Cyclic predator–prey cellular automaton (see `rps`).
    Rps,
    /// Multi-color Conway's Life; players paint soup, colors are lineage.
    Life,
    /// Rim bases firing army particles; territory war (see `spokewar`).
    Spokewar,
    /// Co-op inverted Missile Command: meteors in, taps detonate (see `flak`).
    Flak,
}

impl GameKind {
    pub fn label(self) -> &'static str {
        match self {
            GameKind::Rps => "Ecosystem",
            GameKind::Life => "Primordial",
            GameKind::Spokewar => "Spokewar",
            GameKind::Flak => "Flak",
        }
    }
}

/// One simulation, whichever game it is. Enum dispatch instead of a trait so
/// the engine's `GameRuntime` needs no boxing and the match is exhaustive —
/// adding a game without wiring every arm is a compile error.
pub enum GameSim {
    Rps(rps::RpsSim),
    Life(life::LifeSim),
    Spokewar(spokewar::SpokewarSim),
    Flak(flak::FlakSim),
}

impl GameSim {
    pub fn new(kind: GameKind, theta: usize, radial: usize, species: u8, seed: u64) -> Self {
        match kind {
            GameKind::Rps => GameSim::Rps(rps::RpsSim::new(theta, radial, species, seed)),
            GameKind::Life => GameSim::Life(life::LifeSim::new(theta, radial, species, seed)),
            GameKind::Spokewar => {
                GameSim::Spokewar(spokewar::SpokewarSim::new(theta, radial, species, seed))
            }
            GameKind::Flak => GameSim::Flak(flak::FlakSim::new(theta, radial, species, seed)),
        }
    }

    pub fn theta(&self) -> usize {
        match self {
            GameSim::Rps(s) => s.theta(),
            GameSim::Life(s) => s.theta(),
            GameSim::Spokewar(s) => s.theta(),
            GameSim::Flak(s) => s.theta(),
        }
    }

    pub fn radial(&self) -> usize {
        match self {
            GameSim::Rps(s) => s.radial(),
            GameSim::Life(s) => s.radial(),
            GameSim::Spokewar(s) => s.radial(),
            GameSim::Flak(s) => s.radial(),
        }
    }

    /// The "species" admin knob: species count for the ecosystem, palette
    /// slots for Life, base count for Spokewar, color slots for Flak. One
    /// knob, per-game meaning.
    pub fn set_species(&mut self, species: u8) {
        match self {
            GameSim::Rps(s) => s.set_species_count(species),
            GameSim::Life(s) => s.set_palette(species),
            GameSim::Spokewar(s) => s.set_bases(species),
            GameSim::Flak(s) => s.set_slots(species),
        }
    }

    /// `None` = generations follow the beat (the grid games); `Some(secs)` =
    /// fixed step, for sims whose motion should not care about the music.
    pub fn cadence(&self) -> Option<f32> {
        match self {
            GameSim::Rps(_) | GameSim::Life(_) => None,
            GameSim::Spokewar(_) => Some(spokewar::TICK_SECS),
            GameSim::Flak(_) => Some(flak::TICK_SECS),
        }
    }

    pub fn tick(&mut self) {
        match self {
            GameSim::Rps(s) => s.tick(),
            GameSim::Life(s) => s.tick(),
            GameSim::Spokewar(s) => s.tick(),
            GameSim::Flak(s) => s.tick(),
        }
    }

    pub fn watchdog(&mut self) {
        match self {
            GameSim::Rps(s) => s.watchdog(),
            GameSim::Life(s) => s.watchdog(),
            GameSim::Spokewar(s) => s.watchdog(),
            GameSim::Flak(s) => s.watchdog(),
        }
    }

    pub fn inject(&mut self, it: i32, ir: i32, half_theta: f32, half_r: f32, species: u8) {
        match self {
            GameSim::Rps(s) => s.inject(it, ir, half_theta, half_r, species % s.species_count()),
            GameSim::Life(s) => s.inject(it, ir, half_theta, half_r, species),
            GameSim::Spokewar(s) => s.inject(it, ir, species),
            GameSim::Flak(s) => s.inject(it, ir, species),
        }
    }

    /// Bake the grid into packed RGB (`r | g<<8 | b<<16`) for the shader,
    /// which is a dumb lookup and never knows species or palettes. `time`
    /// drives the ecosystem's slow palette rotation; Life's palette is player
    /// identity and never rotates.
    pub fn pack_cells(&self, time: f32) -> Vec<u32> {
        match self {
            GameSim::Rps(s) => {
                let species = s.species_count() as f32;
                s.cells()
                    .iter()
                    .map(|c| {
                        let hue = c.species as f32 / species + time * 0.0015;
                        let value = 0.30 + 0.70 * (c.vigor as f32 / 255.0);
                        hsv_to_packed_rgb(hue, 0.85, value)
                    })
                    .collect()
            }
            GameSim::Life(s) => s
                .cells()
                .iter()
                .map(|c| {
                    if !c.alive {
                        return 0;
                    }
                    let value = 0.35 + 0.65 * (c.vigor as f32 / 255.0);
                    hsv_to_packed_rgb(c.hue as f32 / 256.0, 0.85, value)
                })
                .collect(),
            GameSim::Spokewar(s) => s.pack_cells(),
            GameSim::Flak(s) => s.pack_cells(),
        }
    }
}

/// One queued player injection, in the same polar space as drawing dabs:
/// `angle` radians, `radius` 0 (center) .. 1 (rim).
#[derive(Debug, Clone, Copy)]
pub struct QueuedInput {
    pub angle: f32,
    pub radius: f32,
    pub species: u8,
}

/// Shared-state side of game mode. Like test mode, deliberately NOT in
/// `AppConfig`: an active game must not survive a restart into a show. The
/// engine loop owns the simulation itself; this is the control surface the
/// server writes and the engine samples once per frame.
pub struct GameControl {
    /// Which game should be running. The engine fades toward/away from this.
    pub active: Option<GameKind>,
    /// Species count for the ecosystem games (live-adjustable, 3–5).
    pub species: u8,
    /// Admin override: keep effects and drawing visible on top of the game.
    pub effects_overlay: bool,
    /// Queued player injections, drained by the engine each frame. Bounded so
    /// a hammering client cannot grow memory.
    pub inputs: Vec<QueuedInput>,
    /// When the current game was started (None while inactive).
    pub started: Option<Instant>,
}

pub const MAX_QUEUED_INPUTS: usize = 256;

impl Default for GameControl {
    fn default() -> Self {
        Self {
            active: None,
            species: 3,
            effects_overlay: false,
            inputs: Vec::new(),
            started: None,
        }
    }
}

/// Grid dimensions the GPU buffer is sized for. θ cells are 1:1 with spokes
/// (clamped), radial cells divide the strip; both well past the installation.
pub const GRID_MAX_THETA: usize = 128;
pub const GRID_RINGS: usize = 48;

/// HSV → packed RGB8 (`r | g<<8 | b<<16`, the same layout the shader emits).
/// Species colors are baked CPU-side at cell-pack time so the shader stays a
/// dumb lookup — it never needs to know the species count or palette.
pub fn hsv_to_packed_rgb(h: f32, s: f32, v: f32) -> u32 {
    let h = (h.rem_euclid(1.0)) * 6.0;
    let c = v * s;
    let x = c * (1.0 - (h % 2.0 - 1.0).abs());
    let m = v - c;
    let (r, g, b) = match h as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let to8 = |f: f32| ((f + m).clamp(0.0, 1.0) * 255.0 + 0.5) as u32;
    to8(r) | (to8(g) << 8) | (to8(b) << 16)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The wire/status name is part of the protocol; a rename would strand
    /// every client. Same guard the effect kinds have.
    #[test]
    fn game_kinds_round_trip_through_snake_case_json() {
        let json = serde_json::to_string(&GameKind::Rps).unwrap();
        assert_eq!(json, "\"rps\"");
        let back: GameKind = serde_json::from_str(&json).unwrap();
        assert_eq!(back, GameKind::Rps);
    }

    /// WGSL uniform structs round their size to 16 bytes; a Rust struct that
    /// doesn't would silently shear every field after the mismatch.
    #[test]
    fn globals_struct_is_uniform_aligned() {
        assert_eq!(std::mem::size_of::<crate::engine::Globals>() % 16, 0);
    }

    #[test]
    fn packed_rgb_matches_shader_unpack_order() {
        // Red must land in the low byte — the same `r | g<<8 | b<<16` layout
        // the shader emits into OUT and game_unpack reads back.
        assert_eq!(hsv_to_packed_rgb(0.0, 1.0, 1.0) & 0xff, 255);
        assert_eq!(hsv_to_packed_rgb(1.0 / 3.0, 1.0, 1.0), 255 << 8);
        assert_eq!(hsv_to_packed_rgb(2.0 / 3.0, 1.0, 1.0), 255 << 16);
    }
}

/// Deterministic PRNG (SplitMix64). Games must be seedable and reproducible —
/// a replayed report bundle should be able to reproduce a game frame — so
/// simulations take one of these rather than reaching for a global RNG.
pub struct SplitMix64(u64);

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `0..n`. `n` must be nonzero. Modulo bias is irrelevant at
    /// game-grid sizes.
    pub fn next_below(&mut self, n: u64) -> u64 {
        debug_assert!(n > 0);
        self.next_u64() % n
    }
}
