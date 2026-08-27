//! Ringfall — a radial falling-block puzzle. Pieces enter at the rim and fall
//! toward the center; complete rings collapse. Unlike the first prototype, the
//! bag deliberately includes one-, two-, and three-cell pieces so real gaps
//! remain playable instead of becoming permanent clutter.

use super::{hsv_to_packed_rgb, GameCommand, SplitMix64};

// A piece gets roughly 5.6 seconds to cross the twenty playable rings. The
// original 110 ms step looked lively in attract mode but gave a person barely
// two seconds to read, aim, rotate, and place a piece.
pub const TICK_SECS: f32 = 0.28;
const COLS: i32 = 16;
const ROWS: i32 = 20;
const EMPTY: u8 = 0xff;
// Once somebody touches the controls, let them own several decisions before
// the zero-player attract mode resumes steering pieces for the room.
const HUMAN_TICKS: u8 = 36;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Shape {
    name: &'static str,
    cells: [(i8, i8); 4],
    len: u8,
    rotations: u8,
}

const SHAPES: [Shape; 11] = [
    Shape {
        name: "Dot",
        cells: [(0, 0), (0, 0), (0, 0), (0, 0)],
        len: 1,
        rotations: 1,
    },
    Shape {
        name: "Domino",
        cells: [(0, 0), (1, 0), (0, 0), (0, 0)],
        len: 2,
        rotations: 2,
    },
    Shape {
        name: "Bar 3",
        cells: [(-1, 0), (0, 0), (1, 0), (0, 0)],
        len: 3,
        rotations: 2,
    },
    Shape {
        name: "Corner 3",
        cells: [(0, 0), (1, 0), (0, 1), (0, 0)],
        len: 3,
        rotations: 4,
    },
    Shape {
        name: "I",
        cells: [(-1, 0), (0, 0), (1, 0), (2, 0)],
        len: 4,
        rotations: 2,
    },
    Shape {
        name: "O",
        cells: [(0, 0), (1, 0), (0, 1), (1, 1)],
        len: 4,
        rotations: 1,
    },
    Shape {
        name: "T",
        cells: [(-1, 0), (0, 0), (1, 0), (0, 1)],
        len: 4,
        rotations: 4,
    },
    Shape {
        name: "S",
        cells: [(-1, 0), (0, 0), (0, 1), (1, 1)],
        len: 4,
        rotations: 2,
    },
    Shape {
        name: "Z",
        cells: [(0, 0), (1, 0), (-1, 1), (0, 1)],
        len: 4,
        rotations: 2,
    },
    Shape {
        name: "J",
        cells: [(-1, 0), (0, 0), (1, 0), (-1, 1)],
        len: 4,
        rotations: 4,
    },
    Shape {
        name: "L",
        cells: [(-1, 0), (0, 0), (1, 0), (1, 1)],
        len: 4,
        rotations: 4,
    },
];

// Small pieces are half of the bag. They are gameplay tools, not rare bonuses.
const BAG: [u8; 15] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10];

#[derive(Clone, Copy, Debug)]
struct Piece {
    kind: u8,
    rotation: u8,
    col: i32,
    row: i32,
    color: u8,
}

pub struct RadialTetrisSim {
    theta: usize,
    radial: usize,
    slots: u8,
    board: Vec<u8>,
    active: Piece,
    next_kind: u8,
    auto_target: i32,
    human_ticks: u8,
    rng: SplitMix64,
    cleared: u32,
    flash: u8,
    reset_flash: u8,
    restarts: u32,
}

impl RadialTetrisSim {
    pub fn new(theta: usize, radial: usize, slots: u8, seed: u64) -> Self {
        let mut rng = SplitMix64::new(seed);
        let first = Self::draw_kind(&mut rng);
        let next_kind = Self::draw_kind(&mut rng);
        let mut sim = Self {
            theta,
            radial,
            slots: slots.clamp(2, 8),
            board: vec![EMPTY; (COLS * ROWS) as usize],
            active: Piece {
                kind: first,
                rotation: 0,
                col: 0,
                row: 0,
                color: 0,
            },
            next_kind,
            auto_target: 0,
            human_ticks: 0,
            rng,
            cleared: 0,
            flash: 0,
            reset_flash: 0,
            restarts: 0,
        };
        sim.spawn(first);
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
    pub fn current_name(&self) -> &'static str {
        SHAPES[self.active.kind as usize].name
    }
    pub fn next_name(&self) -> &'static str {
        SHAPES[self.next_kind as usize].name
    }
    pub fn inner_filled(&self) -> usize {
        (0..COLS)
            .filter(|&col| self.board[Self::index(col, 0)] != EMPTY)
            .count()
    }
    fn best_gap_col(&self) -> Option<i32> {
        let empty = |col: i32| self.board[Self::index(col, 0)] == EMPTY;
        if !(0..COLS).any(empty) {
            return None;
        }
        if (0..COLS).all(empty) {
            return Some(0);
        }
        let mut best = (0, 0);
        for start in 0..COLS {
            if !empty(start) || empty(start - 1) {
                continue;
            }
            let mut len = 0;
            while len < COLS && empty(start + len) {
                len += 1;
            }
            if len > best.1 {
                best = (start, len);
            }
        }
        Some((best.0 + (best.1 - 1) / 2).rem_euclid(COLS))
    }
    fn aim_hint(&self) -> Option<i32> {
        let col = self.best_gap_col()?;
        let hour = (6.0 - col as f32 * 12.0 / COLS as f32).round() as i32;
        let hour = hour.rem_euclid(12);
        Some(if hour == 0 { 12 } else { hour })
    }
    pub fn detail(&self) -> String {
        if self.reset_flash > 0 {
            return format!("Fresh board · {} rings", self.cleared);
        }
        if self.flash > 0 && self.cleared > 0 {
            return format!("Ring cleared! · {} total", self.cleared);
        }
        let restarts = if self.restarts == 0 {
            String::new()
        } else {
            format!(
                " · {} fresh start{}",
                self.restarts,
                if self.restarts == 1 { "" } else { "s" }
            )
        };
        let filled = self.inner_filled();
        let aim = if filled == 0 {
            String::new()
        } else {
            self.aim_hint()
                .map(|hour| format!(" · aim {hour} o'clock"))
                .unwrap_or_default()
        };
        format!(
            "{} falling · {} next · inner {}/{}{} · {} rings{}",
            self.current_name(),
            self.next_name(),
            filled,
            COLS,
            aim,
            self.cleared,
            restarts
        )
    }

    fn draw_kind(rng: &mut SplitMix64) -> u8 {
        BAG[rng.next_below(BAG.len() as u64) as usize]
    }

    fn index(col: i32, row: i32) -> usize {
        (row * COLS + col.rem_euclid(COLS)) as usize
    }

    fn local_cells(piece: Piece) -> impl Iterator<Item = (i32, i32)> {
        let shape = SHAPES[piece.kind as usize];
        shape
            .cells
            .into_iter()
            .take(shape.len as usize)
            .map(move |(x, y)| {
                let (mut x, mut y) = (i32::from(x), i32::from(y));
                for _ in 0..piece.rotation % shape.rotations {
                    (x, y) = (-y, x);
                }
                (x, y)
            })
    }

    fn blocks(piece: Piece) -> Vec<(i32, i32)> {
        Self::local_cells(piece)
            .map(|(x, y)| ((piece.col + x).rem_euclid(COLS), piece.row + y))
            .collect()
    }

    fn fits(&self, piece: Piece) -> bool {
        Self::blocks(piece).into_iter().all(|(col, row)| {
            (0..ROWS).contains(&row) && self.board[Self::index(col, row)] == EMPTY
        })
    }

    fn spawn(&mut self, kind: u8) {
        let shape = SHAPES[kind as usize];
        let rotation = self.rng.next_below(u64::from(shape.rotations)) as u8;
        let col = self.rng.next_below(COLS as u64) as i32;
        let color = self.rng.next_below(self.slots as u64) as u8;
        let probe = Piece {
            kind,
            rotation,
            col,
            row: 0,
            color,
        };
        let max_y = Self::local_cells(probe).map(|(_, y)| y).max().unwrap_or(0);
        let mut piece = Piece {
            row: ROWS - 1 - max_y,
            ..probe
        };
        while !self.fits(piece) && piece.row >= ROWS - 5 {
            piece.row -= 1;
        }
        if !self.fits(piece) {
            self.board.fill(EMPTY);
            self.flash = 0;
            self.reset_flash = 14;
            self.restarts += 1;
            piece.row = ROWS - 1 - max_y;
        }
        self.active = piece;
        self.auto_target = self.rng.next_below(COLS as u64) as i32;
    }

    fn shift(&mut self, amount: i32) -> bool {
        let mut next = self.active;
        next.col = (next.col + amount).rem_euclid(COLS);
        if self.fits(next) {
            self.active = next;
            true
        } else {
            false
        }
    }

    fn rotate(&mut self) {
        let shape = SHAPES[self.active.kind as usize];
        if shape.rotations == 1 {
            return;
        }
        let mut next = self.active;
        next.rotation = (next.rotation + 1) % shape.rotations;
        for kick in [0, -1, 1, -2, 2] {
            next.col = (self.active.col + kick).rem_euclid(COLS);
            if self.fits(next) {
                self.active = next;
                return;
            }
        }
    }

    fn descend_one(&mut self) -> bool {
        let mut next = self.active;
        next.row -= 1;
        if self.fits(next) {
            self.active = next;
            true
        } else {
            false
        }
    }

    fn landing_piece(&self) -> Piece {
        let mut landing = self.active;
        loop {
            let mut next = landing;
            next.row -= 1;
            if !self.fits(next) {
                return landing;
            }
            landing = next;
        }
    }

    fn hard_drop(&mut self) {
        self.active = self.landing_piece();
        self.lock();
    }

    fn move_to_col(&mut self, target: i32) {
        let target = target.rem_euclid(COLS);
        // A canvas tap promises direct lane selection. Try the requested lane
        // (and small seam-aware kicks) first instead of walking through every
        // intervening lane and getting snagged on an unrelated tower.
        for kick in [0, -1, 1, -2, 2] {
            let mut next = self.active;
            next.col = (target + kick).rem_euclid(COLS);
            if self.fits(next) {
                self.active = next;
                return;
            }
        }
        // If the target itself is crowded, preserve the useful old behavior:
        // move as far toward it as the current row allows.
        for _ in 0..COLS {
            if self.active.col == target {
                break;
            }
            let clockwise = (target - self.active.col).rem_euclid(COLS);
            let direction = if clockwise <= COLS / 2 { 1 } else { -1 };
            if !self.shift(direction) {
                break;
            }
        }
    }

    /// Once a piece locks, each spoke obeys radial gravity independently.
    /// Classic rectangular Tetris can expose a buried hole by clearing the
    /// rows above it; on a ring, a roofed inner hole made the only objective
    /// permanently unreachable. Settling inward keeps the angular packing
    /// puzzle while making every remaining gap honest and playable.
    fn settle_columns(&mut self) {
        for col in 0..COLS {
            let mut write_row = 0;
            for read_row in 0..ROWS {
                let value = self.board[Self::index(col, read_row)];
                if value == EMPTY {
                    continue;
                }
                self.board[Self::index(col, write_row)] = value;
                write_row += 1;
            }
            for row in write_row..ROWS {
                self.board[Self::index(col, row)] = EMPTY;
            }
        }
    }

    fn lock(&mut self) {
        for (col, row) in Self::blocks(self.active) {
            if (0..ROWS).contains(&row) {
                self.board[Self::index(col, row)] = self.active.color;
            }
        }
        self.settle_columns();
        let mut row = 0;
        while row < ROWS {
            if (0..COLS).all(|col| self.board[Self::index(col, row)] != EMPTY) {
                for upper in row..(ROWS - 1) {
                    for col in 0..COLS {
                        let value = self.board[Self::index(col, upper + 1)];
                        self.board[Self::index(col, upper)] = value;
                    }
                }
                for col in 0..COLS {
                    self.board[Self::index(col, ROWS - 1)] = EMPTY;
                }
                self.cleared += 1;
                self.flash = 6;
            } else {
                row += 1;
            }
        }
        let kind = self.next_kind;
        self.next_kind = Self::draw_kind(&mut self.rng);
        self.spawn(kind);
    }

    pub fn command(&mut self, command: GameCommand) {
        self.human_ticks = HUMAN_TICKS;
        match command {
            GameCommand::MoveCounterClockwise => {
                self.shift(-1);
            }
            GameCommand::MoveClockwise => {
                self.shift(1);
            }
            GameCommand::RotateClockwise => self.rotate(),
            GameCommand::SoftDrop => {
                if !self.descend_one() {
                    self.lock();
                }
            }
            GameCommand::HardDrop => self.hard_drop(),
        }
    }

    pub fn tick(&mut self) {
        self.flash = self.flash.saturating_sub(1);
        self.reset_flash = self.reset_flash.saturating_sub(1);
        if self.human_ticks > 0 {
            self.human_ticks -= 1;
        } else {
            let clockwise = (self.auto_target - self.active.col).rem_euclid(COLS);
            if clockwise != 0 {
                self.shift(if clockwise <= COLS / 2 { 1 } else { -1 });
            }
        }
        if !self.descend_one() {
            self.lock();
        }
    }

    pub fn watchdog(&mut self) {}

    /// A canvas tap selects an angular lane directly. It never doubles as a
    /// hidden rotate/drop command; those actions have explicit UI controls.
    pub fn inject(&mut self, it: i32, owner: u8) {
        self.active.color = owner % self.slots;
        self.human_ticks = HUMAN_TICKS;
        let target = (it.rem_euclid(self.theta as i32) * COLS / self.theta as i32).rem_euclid(COLS);
        self.move_to_col(target);
    }

    pub fn pack_cells(&self) -> Vec<u32> {
        let active = Self::blocks(self.active);
        let ghost_piece = self.landing_piece();
        let ghost = Self::blocks(ghost_piece);
        let mut out = vec![0; self.theta * self.radial];
        for ir in 0..self.radial {
            let row_pos = ir as f32 * ROWS as f32 / self.radial.max(1) as f32;
            let row = (row_pos.floor() as i32).min(ROWS - 1);
            let row_frac = row_pos.fract();
            for it in 0..self.theta {
                let col_pos = it as f32 * COLS as f32 / self.theta.max(1) as f32;
                let col = (col_pos.floor() as i32).min(COLS - 1);
                let col_frac = col_pos.fract();
                let board_slot = self.board[Self::index(col, row)];
                let active_here = active.contains(&(col, row));
                let ghost_here = ghost.contains(&(col, row)) && !active_here && board_slot == EMPTY;
                let cell_edge =
                    col_frac < 0.18 || col_frac > 0.82 || row_frac < 0.18 || row_frac > 0.82;
                out[ir * self.theta + it] = if active_here {
                    let hue = self.active.color as f32 / self.slots as f32;
                    hsv_to_packed_rgb(hue, 0.78, 1.0)
                } else if board_slot != EMPTY {
                    let hue = board_slot as f32 / self.slots as f32;
                    hsv_to_packed_rgb(hue, 0.84, if self.flash > 0 { 1.0 } else { 0.68 })
                } else if ghost_here && cell_edge {
                    // A pale guide is recognizable as the landing preview even
                    // when the active color matches blocks already underneath.
                    hsv_to_packed_rgb(0.48, 0.22, 0.68)
                } else if row == 0 && board_slot == EMPTY && cell_edge {
                    // The objective is a complete innermost ring. Keep its
                    // remaining holes faintly visible so the last placement is
                    // a readable decision instead of radial-grid guesswork.
                    hsv_to_packed_rgb(0.49, 0.78, 0.24)
                } else if cell_edge {
                    if self.reset_flash > 0 {
                        hsv_to_packed_rgb(0.98, 0.78, 0.09 + self.reset_flash as f32 * 0.018)
                    } else {
                        hsv_to_packed_rgb(0.68, 0.25, 0.028 + self.flash as f32 * 0.014)
                    }
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
    fn bag_contains_small_gap_filling_shapes() {
        assert!(SHAPES.iter().any(|shape| shape.len == 1));
        assert!(SHAPES.iter().any(|shape| shape.len == 2));
        assert!(SHAPES.iter().filter(|shape| shape.len == 3).count() >= 2);
        assert!(
            BAG.iter()
                .filter(|&&kind| SHAPES[kind as usize].len < 4)
                .count()
                * 2
                >= BAG.len()
        );
    }

    #[test]
    fn commands_are_immediate_and_human_input_pauses_autopilot() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 7);
        let start = sim.active.col;
        sim.command(GameCommand::MoveClockwise);
        assert_eq!(sim.active.col, (start + 1).rem_euclid(COLS));
        assert_eq!(sim.human_ticks, HUMAN_TICKS);
        let controlled = sim.active.col;
        sim.auto_target = (controlled + 6).rem_euclid(COLS);
        sim.tick();
        assert_eq!(
            sim.active.col, controlled,
            "autopilot must not fight a player"
        );
    }

    #[test]
    fn ghost_lands_where_hard_drop_locks() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 13);
        let landing = RadialTetrisSim::blocks(sim.landing_piece());
        let color = sim.active.color;
        sim.command(GameCommand::HardDrop);
        for (col, row) in landing {
            assert_eq!(sim.board[RadialTetrisSim::index(col, row)], color);
        }
    }

    #[test]
    fn full_ring_clears_and_collapses() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 11);
        for col in 0..COLS {
            sim.board[RadialTetrisSim::index(col, 0)] = 0;
        }
        sim.active = Piece {
            kind: 0,
            rotation: 0,
            col: 2,
            row: 4,
            color: 1,
        };
        sim.lock();
        assert_eq!(sim.cleared_rings(), 1);
        // Clearing the full center ring pulls the dot above it into the newly
        // opened innermost slot.
        assert_eq!(sim.inner_filled(), 1);
        assert!(sim.detail().starts_with("Ring cleared!"));
    }

    #[test]
    fn detail_reports_progress_toward_the_innermost_ring() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 31);
        sim.board.fill(EMPTY);
        for col in 0..7 {
            sim.board[RadialTetrisSim::index(col, 0)] = 1;
        }
        assert_eq!(sim.inner_filled(), 7);
        assert!(sim.detail().contains("inner 7/16"));
    }

    #[test]
    fn aim_hint_points_to_the_middle_of_the_largest_gap() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 37);
        for col in 0..COLS {
            sim.board[RadialTetrisSim::index(col, 0)] = 1;
        }
        sim.board[RadialTetrisSim::index(15, 0)] = EMPTY;
        sim.board[RadialTetrisSim::index(0, 0)] = EMPTY;
        sim.board[RadialTetrisSim::index(1, 0)] = EMPTY;
        assert_eq!(sim.aim_hint(), Some(6));
        assert!(sim.detail().contains("aim 6 o'clock"));
    }

    #[test]
    fn direct_lane_selection_does_not_get_stuck_behind_an_unrelated_tower() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 23);
        sim.active = Piece {
            kind: 0,
            rotation: 0,
            col: 0,
            row: 5,
            color: 1,
        };
        sim.board[RadialTetrisSim::index(1, 5)] = 2;
        // theta cell 8 maps directly to logical column 2.
        sim.inject(8, 3);
        assert_eq!(sim.active.col, 2);
        assert_eq!(sim.active.color, 3);
    }

    #[test]
    fn radial_gravity_closes_buried_holes_after_a_piece_locks() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 41);
        sim.board.fill(EMPTY);
        sim.board[RadialTetrisSim::index(3, 4)] = 1;
        sim.board[RadialTetrisSim::index(3, 7)] = 2;
        sim.settle_columns();
        assert_eq!(sim.board[RadialTetrisSim::index(3, 0)], 1);
        assert_eq!(sim.board[RadialTetrisSim::index(3, 1)], 2);
        assert_eq!(sim.board[RadialTetrisSim::index(3, 2)], EMPTY);
    }

    #[test]
    fn top_out_gets_a_visible_fresh_board_notice() {
        let mut sim = RadialTetrisSim::new(64, 48, 4, 29);
        for row in (ROWS - 6)..ROWS {
            for col in 0..COLS {
                sim.board[RadialTetrisSim::index(col, row)] = 1;
            }
        }
        sim.spawn(0);
        assert!(sim.board.iter().all(|&cell| cell == EMPTY));
        assert_eq!(sim.restarts, 1);
        assert!(sim.detail().starts_with("Fresh board"));
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
