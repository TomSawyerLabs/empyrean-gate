//! Radial Tetris — tetrominoes fall from the rim toward the center and complete
//! rings collapse. The logical board stays deliberately coarse so one block is
//! legible across several LEDs on installations with many spokes.

use super::{SplitMix64, hsv_to_packed_rgb};

pub const TICK_SECS: f32 = 0.16;
const COLS: i32 = 16;
const ROWS: i32 = 20;
const EMPTY: u8 = 0xff;

#[derive(Clone, Copy, Debug)]
struct Piece {
    kind: u8,
    rotation: u8,
    col: i32,
    row: i32,
    color: u8,
}

/// Coordinates are angular offset, radial offset. Rotation is performed in
/// this square local space; angular coordinates wrap around the board.
const SHAPES: [[(i32, i32); 4]; 7] = [
    [(0, 0), (1, 0), (2, 0), (3, 0)],   // I
    [(0, 0), (1, 0), (0, 1), (1, 1)],   // O
    [(-1, 0), (0, 0), (1, 0), (0, 1)],  // T
    [(-1, 0), (0, 0), (0, 1), (1, 1)],  // S
    [(0, 0), (1, 0), (-1, 1), (0, 1)],  // Z
    [(-1, 0), (0, 0), (1, 0), (-1, 1)], // J
    [(-1, 0), (0, 0), (1, 0), (1, 1)],  // L
];

pub struct RadialTetrisSim {
    theta: usize,
    radial: usize,
    slots: u8,
    board: Vec<u8>,
    active: Piece,
    target_col: i32,
    rng: SplitMix64,
    cleared: u32,
    flash: u8,
}

impl RadialTetrisSim {
    pub fn new(theta: usize, radial: usize, slots: u8, seed: u64) -> Self {
        let mut sim = Self {
            theta,
            radial,
            slots: slots.clamp(2, 8),
            board: vec![EMPTY; (COLS * ROWS) as usize],
            active: Piece {
                kind: 0,
                rotation: 0,
                col: 0,
                row: 0,
                color: 0,
            },
            target_col: 0,
            rng: SplitMix64::new(seed),
            cleared: 0,
            flash: 0,
        };
        sim.spawn();
        sim
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
    pub fn cleared_rings(&self) -> u32 {
        self.cleared
    }

    fn index(col: i32, row: i32) -> usize {
        (row * COLS + col.rem_euclid(COLS)) as usize
    }

    fn blocks(piece: Piece) -> [(i32, i32); 4] {
        SHAPES[piece.kind as usize].map(|(mut x, mut y)| {
            // The O piece should not orbit its own corner when rotated.
            if piece.kind != 1 {
                for _ in 0..piece.rotation % 4 {
                    (x, y) = (-y, x);
                }
            }
            ((piece.col + x).rem_euclid(COLS), piece.row + y)
        })
    }

    fn fits(&self, piece: Piece) -> bool {
        Self::blocks(piece)
            .iter()
            .all(|&(col, row)| row >= 0 && row < ROWS && self.board[Self::index(col, row)] == EMPTY)
    }

    fn spawn(&mut self) {
        let kind = self.rng.next_below(7) as u8;
        let rotation = self.rng.next_below(4) as u8;
        let col = self.rng.next_below(COLS as u64) as i32;
        let color = self.rng.next_below(self.slots as u64) as u8;
        // Start far enough inside the rim for every rotated shape.
        let mut piece = Piece {
            kind,
            rotation,
            col,
            row: ROWS - 3,
            color,
        };
        while !self.fits(piece) && piece.row > ROWS - 6 {
            piece.row -= 1;
        }
        if !self.fits(piece) {
            // Reaching the rim is a soft reset, not a dead screen. The flash
            // makes the event readable and the attract mode immediately resumes.
            self.board.fill(EMPTY);
            self.flash = 8;
            piece.row = ROWS - 3;
        }
        self.active = piece;
        self.target_col = self.rng.next_below(COLS as u64) as i32;
    }

    fn rotate(&mut self) {
        let mut next = self.active;
        next.rotation = (next.rotation + 1) % 4;
        // Small wall kicks around the circumference keep rotation generous.
        for kick in [0, -1, 1, -2, 2] {
            next.col = (self.active.col + kick).rem_euclid(COLS);
            if self.fits(next) {
                self.active = next;
                return;
            }
        }
    }

    fn shift(&mut self, amount: i32) {
        let mut next = self.active;
        next.col = (next.col + amount).rem_euclid(COLS);
        if self.fits(next) {
            self.active = next;
        }
    }

    fn lock(&mut self) {
        for (col, row) in Self::blocks(self.active) {
            if (0..ROWS).contains(&row) {
                self.board[Self::index(col, row)] = self.active.color;
            }
        }
        let mut row = 0;
        while row < ROWS {
            let full = (0..COLS).all(|col| self.board[Self::index(col, row)] != EMPTY);
            if full {
                for upper in row..(ROWS - 1) {
                    for col in 0..COLS {
                        let value = self.board[Self::index(col, upper + 1)];
                        let dst = Self::index(col, upper);
                        self.board[dst] = value;
                    }
                }
                for col in 0..COLS {
                    let dst = Self::index(col, ROWS - 1);
                    self.board[dst] = EMPTY;
                }
                self.cleared += 1;
                self.flash = 5;
            } else {
                row += 1;
            }
        }
        self.spawn();
    }

    pub fn tick(&mut self) {
        self.flash = self.flash.saturating_sub(1);
        // The unattended world aims for a random lane. Player commands replace
        // this target, so participation naturally takes control without modes.
        let clockwise = (self.target_col - self.active.col).rem_euclid(COLS);
        if clockwise != 0 {
            self.shift(if clockwise <= COLS / 2 { 1 } else { -1 });
        }
        let mut next = self.active;
        next.row -= 1;
        if self.fits(next) {
            self.active = next;
        } else {
            self.lock();
        }
    }

    pub fn watchdog(&mut self) {}

    /// Inputs near the hole are commands in four angular quadrants; other taps
    /// point the falling piece at a lane. The Games UI exposes explicit buttons,
    /// while the installation itself remains a usable touch surface.
    pub fn inject(&mut self, it: i32, ir: i32, owner: u8) {
        self.active.color = owner % self.slots;
        if ir <= 1 {
            match (it.rem_euclid(self.theta as i32) as usize * 4) / self.theta.max(1) {
                0 => self.rotate(),
                1 => self.shift(-1),
                2 => self.shift(1),
                _ => {
                    loop {
                        let mut next = self.active;
                        next.row -= 1;
                        if !self.fits(next) {
                            break;
                        }
                        self.active = next;
                    }
                    self.lock();
                }
            }
        } else {
            self.target_col =
                (it.rem_euclid(self.theta as i32) * COLS / self.theta as i32).rem_euclid(COLS);
        }
    }

    pub fn pack_cells(&self) -> Vec<u32> {
        let mut logical = self.board.clone();
        for (col, row) in Self::blocks(self.active) {
            if (0..ROWS).contains(&row) {
                logical[Self::index(col, row)] = self.active.color;
            }
        }
        let mut out = vec![0; self.theta * self.radial];
        for ir in 0..self.radial {
            let row = (ir * ROWS as usize / self.radial).min(ROWS as usize - 1) as i32;
            for it in 0..self.theta {
                let col = (it * COLS as usize / self.theta).min(COLS as usize - 1) as i32;
                let slot = logical[Self::index(col, row)];
                let edge = (it * COLS as usize) % self.theta < COLS as usize
                    || (ir * ROWS as usize) % self.radial < ROWS as usize;
                out[ir * self.theta + it] = if slot != EMPTY {
                    let hue = slot as f32 / self.slots as f32;
                    hsv_to_packed_rgb(hue, 0.82, if self.flash > 0 { 1.0 } else { 0.88 })
                } else if edge {
                    hsv_to_packed_rgb(0.68, 0.35, 0.055 + self.flash as f32 * 0.012)
                } else {
                    0
                };
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn piece_falls_inward_and_locks() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 7);
        let first_row = sim.active.row;
        sim.tick();
        assert!(sim.active.row < first_row || sim.board.iter().any(|&c| c != EMPTY));
        for _ in 0..30 {
            sim.tick();
        }
        assert!(sim.board.iter().any(|&c| c != EMPTY));
    }

    #[test]
    fn full_ring_clears_and_collapses() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 11);
        for col in 0..COLS {
            sim.board[RadialTetrisSim::index(col, 0)] = 0;
        }
        sim.active = Piece {
            kind: 1,
            rotation: 0,
            col: 2,
            row: 4,
            color: 1,
        };
        sim.lock();
        assert_eq!(sim.cleared_rings(), 1);
        assert!((0..COLS).any(|col| sim.board[RadialTetrisSim::index(col, 0)] == EMPTY));
    }

    #[test]
    fn hard_drop_locks_immediately() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 13);
        sim.inject(48, 0, 2); // fourth quadrant = hard drop
        assert!(sim.board.iter().any(|&c| c == 2));
    }

    #[test]
    fn seeded_games_are_deterministic() {
        let mut a = RadialTetrisSim::new(64, 48, 4, 19);
        let mut b = RadialTetrisSim::new(64, 48, 4, 19);
        for _ in 0..100 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.pack_cells(), b.pack_cells());
    }
}
