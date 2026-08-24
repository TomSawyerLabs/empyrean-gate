//! Game mode — continuously-running simulations the array becomes when an admin
//! starts a game. Design center (see `plans/game-mode.md`): every game is a
//! zero-player-capable world; connected clients perturb it, they are not
//! prerequisites. This module holds the pure simulation cores; engine/protocol
//! wiring lives with the rest of the frame loop.

pub mod rps;

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
