//! Rimfire — Tempest on the Gate (plans/classic-games.md).
//!
//! Tempest's playfield is a tube seen end-on, and the Gate already is one:
//! the hole is the far end, the rim is the near lip, and groups of spokes are
//! the lanes. Enemies climb out of the hole along the lanes; every color
//! chip is a claw riding the rim, firing inward down its lane.
//!
//! - **Flippers** (red) climb, now and then flipping to the next lane. Once
//!   at the rim they flip lane to lane toward the nearest claw and grab it —
//!   unless the claw shoots first during the wind-up. A grabbed claw is gone
//!   for two seconds.
//! - **Tankers** (violet) climb slowly and split into two flippers on the
//!   neighbouring lanes when shot (or when they reach the rim).
//! - **Spikers** (green) climb partway, leaving a spike down the lane behind
//!   them, then retreat into the hole. A spike is cover: shots wear it down
//!   from the tip, and anything climbing beneath it cannot be hit until it
//!   is gone. Spikes also crumble on their own, slowly.
//! - **Superzapper**: a button that destroys every enemy on the board, once
//!   per color per [`ZAP_COOLDOWN`].
//!
//! Zero to N players is one world, Spokewar's way: a claw is AI-driven until
//! someone taps with its color, and goes back to the AI [`HUMAN_TICKS`] after
//! their last input. The AI is slower to move and slower to fire, so the
//! attract mode loses a claw now and then. Enemies come faster the more
//! claws humans are driving (Flak's rule). Losing a claw is a flash, not a
//! game over — the pressure is the game.
//!
//! Grid-native: lanes are groups of θ cells, depth is rings (0 = hole).

use super::{GameCommand, SplitMix64};

/// Fixed step, shared with the other particle sims.
pub const TICK_SECS: f32 = 0.05;

/// Spokes per lane on the installation (64 spokes → Tempest's 16 lanes).
const SPOKES_PER_LANE: usize = 4;
const MIN_LANES: usize = 8;

/// Claw travel around the rim, lanes per tick (human / AI).
const CLAW_SPEED: f32 = 0.5;
const AI_CLAW_SPEED: f32 = 0.15;
/// Ticks between automatic shots (human / AI).
const FIRE_TICKS: u32 = 3;
const AI_FIRE_TICKS: u32 = 9;
/// Shot speed inward, rings per tick (the tube in ~1 s).
const SHOT_SPEED: f32 = 2.4;
/// A grabbed claw is gone this long (2 s).
const RESPAWN_TICKS: u32 = 40;
/// Ticks a human keeps a claw after a tap or button (~15 s).
const HUMAN_TICKS: u32 = 300;
/// AI re-target cadence (0.6 s .. 1.5 s).
const AI_MIN_TICKS: u32 = 25;
const AI_MAX_TICKS: u32 = 50;
/// Superzapper cooldown per color (30 s).
const ZAP_COOLDOWN: u32 = 600;
const ZAP_FLASH_TICKS: u32 = 14;

/// Enemy pressure: spawns per second with nobody playing, plus per claw a
/// human is driving.
const CALM_RATE: f32 = 1.1;
const RATE_PER_HUMAN: f32 = 0.3;
const MAX_ENEMIES: usize = 60;

/// Climb speeds, rings per tick.
const FLIPPER_CLIMB_MIN: f32 = 0.22;
const FLIPPER_CLIMB_MAX: f32 = 0.4;
const TANKER_CLIMB: f32 = 0.13;
const SPIKER_CLIMB: f32 = 0.3;
const SPIKER_RETREAT: f32 = 0.25;
/// Mid-tube lane flips: 1-in-N per tick while climbing.
const CLIMB_FLIP_CHANCE: u64 = 45;
/// Ticks a flip between lanes takes (unhittable meanwhile).
const FLIP_TICKS: u8 = 5;
/// At the rim a flipper hops toward the nearest claw every this many ticks.
const RIM_HOP_TICKS: u8 = 7;
/// Wind-up after landing in a claw's lane before the grab lands.
const GRAB_TICKS: u8 = 5;
/// Spike erosion per shot and per tick, rings.
const SPIKE_EROSION: f32 = 1.5;
const SPIKE_DECAY: f32 = 0.01;

/// Explosion glow decay per tick (~0.5 s visible).
const GLOW_DECAY: u8 = 24;

/// Claw colors as (hue, saturation), Tempest's yellow first. None of them is
/// an enemy's red, violet or green, so a claw never looks like a flipper.
/// Mirrored by the catalog's `palette` in `src/gameCatalog.ts`.
pub const CLAW_COLORS: [(f32, f32); 6] = [
    (0.145, 0.85), // yellow
    (0.52, 0.85),  // cyan
    (0.075, 0.9),  // orange
    (0.9, 0.6),    // pink
    (0.0, 0.0),    // white
    (0.6, 0.65),   // sky blue
];
const MAX_CLAWS: u8 = CLAW_COLORS.len() as u8;

/// Glow tones that are not a claw's color.
const RED: u8 = 0xff;
const WHITE: u8 = 0xfe;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Flipper,
    Tanker,
    Spiker,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Motion {
    /// Climbing out of the hole at the enemy's own speed.
    Climb,
    /// Between lanes: moving to `to`, `left` ticks to go.
    Flip { to: usize, left: u8 },
    /// At the rim, hopping toward claws; `wait` ticks to the next hop.
    Rim { wait: u8 },
    /// Landed in a claw's lane: grabs when `left` runs out.
    Grab { left: u8 },
    /// Spiker heading back into the hole.
    Retreat,
}

#[derive(Clone, Copy, Debug)]
struct Enemy {
    kind: Kind,
    lane: usize,
    depth: f32,
    /// Climb speed, rings per tick (kept through a flip).
    speed: f32,
    motion: Motion,
    /// Spikers turn back here.
    turn_at: f32,
}

#[derive(Clone, Copy, Debug)]
struct Claw {
    /// Position around the rim in lanes (fractional while moving).
    pos: f32,
    target: usize,
    human_until: u32,
    /// Grabbed: back at this tick (0 = alive).
    dead_until: u32,
    fire_wait: u32,
    zap_ready: u32,
    ai_next: u32,
    kills: u32,
}

#[derive(Clone, Copy, Debug)]
struct Shot {
    lane: usize,
    depth: f32,
    owner: u8,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Glow {
    /// A claw slot, or [`RED`] / [`WHITE`].
    tone: u8,
    glow: u8,
}

const DARK: Glow = Glow { tone: WHITE, glow: 0 };

pub struct RimfireSim {
    theta: usize,
    radial: usize,
    lanes: usize,
    slots: u8,
    claws: Vec<Claw>,
    enemies: Vec<Enemy>,
    shots: Vec<Shot>,
    /// Spike tip per lane, in rings from the hole (0 = none).
    spikes: Vec<f32>,
    glow: Vec<Glow>,
    rng: SplitMix64,
    ticks: u32,
    spawn_acc: f32,
    zap_flash: u32,
    zap_tone: u8,
    destroyed: u32,
    grabs: u32,
}

impl RimfireSim {
    pub fn new(theta: usize, radial: usize, slots: u8, seed: u64) -> Self {
        let lanes = (theta / SPOKES_PER_LANE).max(MIN_LANES).min(theta);
        let mut sim = Self {
            theta,
            radial,
            lanes,
            slots: 0,
            claws: Vec::new(),
            enemies: Vec::with_capacity(MAX_ENEMIES),
            shots: Vec::with_capacity(64),
            spikes: vec![0.0; lanes],
            glow: vec![DARK; theta * radial],
            rng: SplitMix64::new(seed),
            ticks: 0,
            spawn_acc: 0.0,
            zap_flash: 0,
            zap_tone: 0,
            destroyed: 0,
            grabs: 0,
        };
        sim.set_slots(slots);
        sim
    }

    pub fn theta(&self) -> usize {
        self.theta
    }

    pub fn radial(&self) -> usize {
        self.radial
    }

    /// One claw per color; existing claws keep their place and score.
    pub fn set_slots(&mut self, slots: u8) {
        let slots = slots.clamp(2, MAX_CLAWS);
        if slots == self.slots {
            return;
        }
        self.slots = slots;
        while self.claws.len() > slots as usize {
            self.claws.pop();
        }
        while self.claws.len() < slots as usize {
            let k = self.claws.len();
            let lane = (k * self.lanes / slots as usize) % self.lanes;
            self.claws.push(Claw {
                pos: lane as f32,
                target: lane,
                human_until: 0,
                dead_until: 0,
                fire_wait: k as u32 % FIRE_TICKS,
                zap_ready: 0,
                ai_next: 0,
                kills: 0,
            });
        }
    }

    fn rim(&self) -> f32 {
        self.radial as f32 - 1.0
    }

    fn lane_of_cell(&self, it: i32) -> usize {
        let it = it.rem_euclid(self.theta as i32) as usize;
        it * self.lanes / self.theta
    }

    /// The θ cells a lane covers.
    fn lane_cells(&self, lane: usize) -> std::ops::Range<usize> {
        let a = (lane * self.theta).div_ceil(self.lanes);
        let b = ((lane + 1) * self.theta).div_ceil(self.lanes);
        a..b.max(a + 1)
    }

    /// The middle of a lane: the one or two cells enemies and shots occupy.
    fn lane_core(&self, lane: usize) -> std::ops::Range<usize> {
        let cells = self.lane_cells(lane);
        let n = cells.len();
        if n <= 2 {
            return cells;
        }
        let a = cells.start + (n - 2) / 2;
        a..a + 2
    }

    fn lane_diff(&self, from: usize, to: usize) -> i32 {
        let n = self.lanes as i32;
        let mut d = to as i32 - from as i32;
        if d > n / 2 {
            d -= n;
        } else if d < -n / 2 {
            d += n;
        }
        d
    }

    fn claw_lane(&self, k: usize) -> usize {
        (self.claws[k].pos.round() as i64).rem_euclid(self.lanes as i64) as usize
    }

    fn alive(&self, k: usize) -> bool {
        self.claws[k].dead_until == 0
    }

    /// A tone (claw slot, red or white) at brightness `v`.
    fn tone_rgb(tone: u8, v: f32) -> u32 {
        match tone {
            RED => super::hsv_to_packed_rgb(0.02, 0.9, v),
            WHITE => super::hsv_to_packed_rgb(0.0, 0.0, v * 0.8),
            k => {
                let (h, s) = CLAW_COLORS[k as usize % CLAW_COLORS.len()];
                super::hsv_to_packed_rgb(h, s, v)
            }
        }
    }

    fn unit(&mut self) -> f32 {
        self.rng.next_below(10_000) as f32 / 10_000.0
    }

    pub fn enemy_count(&self) -> usize {
        self.enemies.len()
    }

    pub fn destroyed(&self) -> u32 {
        self.destroyed
    }

    pub fn grabs(&self) -> u32 {
        self.grabs
    }

    fn humans(&self) -> usize {
        self.claws.iter().filter(|c| c.human_until > self.ticks).count()
    }

    pub fn spawn_rate(&self) -> f32 {
        CALM_RATE + RATE_PER_HUMAN * self.humans() as f32
    }

    pub fn detail(&self) -> String {
        let mut line = format!("{} destroyed · {} claws grabbed", self.destroyed, self.grabs);
        if let Some((k, c)) = self
            .claws
            .iter()
            .enumerate()
            .filter(|(_, c)| c.kills > 0)
            .max_by_key(|(_, c)| c.kills)
        {
            line.push_str(&format!(" · color {} leads with {}", k + 1, c.kills));
        }
        line
    }

    fn flash(&mut self, lane: usize, depth: f32, tone: u8, rings: i32) {
        let ir = depth.round() as i32;
        let cells = self.lane_cells(lane);
        for it in cells {
            for dr in -rings..=rings {
                let r = ir + dr;
                if r < 0 || r >= self.radial as i32 {
                    continue;
                }
                let idx = r as usize * self.theta + it;
                let glow = 255u8.saturating_sub(dr.unsigned_abs() as u8 * 50);
                if self.glow[idx].glow < glow {
                    self.glow[idx] = Glow { tone, glow };
                }
            }
        }
    }

    fn spawn_enemy(&mut self) {
        let lane = self.rng.next_below(self.lanes as u64) as usize;
        let roll = self.rng.next_below(100);
        let (kind, speed) = if roll < 60 {
            (Kind::Flipper, self.flipper_speed())
        } else if roll < 85 {
            (Kind::Tanker, TANKER_CLIMB)
        } else {
            (Kind::Spiker, SPIKER_CLIMB)
        };
        let turn_at = self.rim() * (0.4 + 0.35 * self.unit());
        self.enemies.push(Enemy {
            kind,
            lane,
            depth: 0.0,
            speed,
            motion: Motion::Climb,
            turn_at,
        });
    }

    fn flipper_speed(&mut self) -> f32 {
        FLIPPER_CLIMB_MIN + (FLIPPER_CLIMB_MAX - FLIPPER_CLIMB_MIN) * self.unit()
    }

    /// Two flippers on the neighbouring lanes, where a tanker was.
    fn split(&mut self, lane: usize, depth: f32) {
        for d in [-1i32, 1] {
            if self.enemies.len() >= MAX_ENEMIES {
                break;
            }
            let to = (lane as i32 + d).rem_euclid(self.lanes as i32) as usize;
            let speed = self.flipper_speed();
            self.enemies.push(Enemy {
                kind: Kind::Flipper,
                lane,
                depth,
                speed,
                motion: Motion::Flip { to, left: FLIP_TICKS },
                turn_at: 0.0,
            });
        }
    }

    /// One 50 ms step.
    pub fn tick(&mut self) {
        self.ticks += 1;
        for g in &mut self.glow {
            g.glow = g.glow.saturating_sub(GLOW_DECAY);
        }
        self.zap_flash = self.zap_flash.saturating_sub(1);
        for s in &mut self.spikes {
            *s = (*s - SPIKE_DECAY).max(0.0);
        }

        self.spawn_acc += self.spawn_rate() * TICK_SECS;
        while self.spawn_acc >= 1.0 {
            self.spawn_acc -= 1.0;
            if self.enemies.len() < MAX_ENEMIES {
                self.spawn_enemy();
            }
        }

        self.tick_claws();
        self.tick_shots();
        self.tick_enemies();
    }

    fn tick_claws(&mut self) {
        let ticks = self.ticks;
        for k in 0..self.claws.len() {
            if self.claws[k].dead_until != 0 && ticks >= self.claws[k].dead_until {
                self.claws[k].dead_until = 0;
                let lane = self.claw_lane(k);
                let rim = self.rim();
                self.flash(lane, rim, k as u8, 2);
            }
            let human = self.claws[k].human_until > ticks;
            if !human && ticks >= self.claws[k].ai_next {
                let target = self.ai_target(k);
                let wait =
                    AI_MIN_TICKS + self.rng.next_below((AI_MAX_TICKS - AI_MIN_TICKS) as u64) as u32;
                let c = &mut self.claws[k];
                c.target = target;
                c.ai_next = ticks + wait;
            }
            let speed = if human { CLAW_SPEED } else { AI_CLAW_SPEED };
            let here = self.claw_lane(k);
            let d = self.lane_diff(here, self.claws[k].target) as f32
                + (here as f32 - self.claws[k].pos);
            let lanes = self.lanes as f32;
            let c = &mut self.claws[k];
            c.pos = (c.pos + d.clamp(-speed, speed)).rem_euclid(lanes);
            if c.dead_until != 0 {
                continue;
            }
            if c.fire_wait > 0 {
                c.fire_wait -= 1;
                continue;
            }
            c.fire_wait = if human { FIRE_TICKS } else { AI_FIRE_TICKS };
            let lane = self.claw_lane(k);
            let rim = self.rim();
            self.shots.push(Shot {
                lane,
                depth: rim + 0.5,
                owner: k as u8,
            });
        }
    }

    /// The AI's lane: the most threatening one near it — enemies close to
    /// the rim count most, spikes a little.
    fn ai_target(&self, k: usize) -> usize {
        let here = self.claw_lane(k);
        let rim = self.rim();
        let mut threat = vec![0.0f32; self.lanes];
        for e in &self.enemies {
            let lane = match e.motion {
                Motion::Flip { to, .. } => to,
                _ => e.lane,
            };
            if matches!(e.motion, Motion::Retreat) {
                continue;
            }
            // Reactive, not clairvoyant: only what has climbed past halfway
            // draws the AI, so the attract mode's tube fills up first.
            let up = e.depth / rim;
            if up > 0.5 {
                threat[lane] += up * up * 2.0;
            }
        }
        for (lane, s) in self.spikes.iter().enumerate() {
            threat[lane] += s / rim * 0.4;
        }
        // Lanes another claw holds or is heading for are covered: never
        // double up on one, and leave the neighbours to it too.
        let mut taken = vec![false; self.lanes];
        for j in 0..self.claws.len() {
            if j == k {
                continue;
            }
            for lane in [self.claws[j].target, self.claw_lane(j)] {
                taken[lane] = true;
                for d in [-1i32, 1] {
                    let n = (lane as i32 + d).rem_euclid(self.lanes as i32) as usize;
                    threat[n] *= 0.4;
                }
            }
        }
        let mut best = here;
        let mut best_score = f32::MIN;
        for (lane, t) in threat.iter().enumerate() {
            if taken[lane] {
                continue;
            }
            let dist = self.lane_diff(here, lane).unsigned_abs() as f32;
            let score = t - dist * 0.08;
            if score > best_score {
                best_score = score;
                best = lane;
            }
        }
        best
    }

    fn tick_shots(&mut self) {
        let mut i = 0;
        while i < self.shots.len() {
            let shot = self.shots[i];
            let next = shot.depth - SHOT_SPEED;
            // The first thing the shot meets on its way in: the highest enemy
            // in its lane, or the spike tip, whichever is nearer the rim.
            let mut hit: Option<(usize, f32)> = None;
            for (ei, e) in self.enemies.iter().enumerate() {
                if e.lane != shot.lane || matches!(e.motion, Motion::Flip { .. }) {
                    continue;
                }
                if e.depth <= shot.depth + 0.5
                    && e.depth > next - 0.5
                    && hit.is_none_or(|(_, d)| e.depth > d)
                {
                    hit = Some((ei, e.depth));
                }
            }
            let spike = self.spikes[shot.lane];
            let spike_hit = spike > 0.0 && spike <= shot.depth + 0.5 && spike > next;
            if spike_hit && hit.is_none_or(|(_, d)| spike >= d) {
                self.spikes[shot.lane] = (spike - SPIKE_EROSION).max(0.0);
                self.flash(shot.lane, spike, WHITE, 0);
                self.shots.swap_remove(i);
                continue;
            }
            if let Some((ei, depth)) = hit {
                let e = self.enemies.swap_remove(ei);
                self.flash(e.lane, depth, shot.owner, 1);
                self.destroyed += 1;
                let n = self.claws.len();
                self.claws[shot.owner as usize % n].kills += 1;
                if e.kind == Kind::Tanker {
                    self.split(e.lane, e.depth);
                }
                self.shots.swap_remove(i);
                continue;
            }
            if next < -0.5 {
                self.shots.swap_remove(i);
                continue;
            }
            self.shots[i].depth = next;
            i += 1;
        }
    }

    fn nearest_live_claw(&self, lane: usize) -> Option<(usize, i32)> {
        (0..self.claws.len())
            .filter(|&k| self.alive(k))
            .map(|k| (k, self.lane_diff(lane, self.claw_lane(k))))
            .min_by_key(|&(_, d)| d.abs())
    }

    fn tick_enemies(&mut self) {
        let rim = self.rim();
        let mut i = 0;
        while i < self.enemies.len() {
            let mut e = self.enemies[i];
            let mut remove = false;
            match e.motion {
                Motion::Climb => {
                    e.depth += e.speed;
                    if e.kind == Kind::Spiker {
                        self.spikes[e.lane] = self.spikes[e.lane].max(e.depth);
                        if e.depth >= e.turn_at {
                            e.motion = Motion::Retreat;
                        }
                    } else if e.depth >= rim {
                        e.depth = rim;
                        if e.kind == Kind::Tanker {
                            self.enemies.swap_remove(i);
                            self.split(e.lane, rim);
                            continue;
                        }
                        e.motion = Motion::Rim { wait: RIM_HOP_TICKS };
                    } else if e.kind == Kind::Flipper && self.rng.next_below(CLIMB_FLIP_CHANCE) == 0
                    {
                        let d = if self.rng.next_below(2) == 0 { -1 } else { 1 };
                        let to = (e.lane as i32 + d).rem_euclid(self.lanes as i32) as usize;
                        e.motion = Motion::Flip { to, left: FLIP_TICKS };
                    }
                }
                Motion::Flip { to, left } => {
                    if left > 1 {
                        e.motion = Motion::Flip { to, left: left - 1 };
                    } else {
                        e.lane = to;
                        e.motion = if e.depth >= rim - 0.01 {
                            Motion::Rim { wait: RIM_HOP_TICKS }
                        } else {
                            Motion::Climb
                        };
                    }
                }
                Motion::Rim { wait } => {
                    if wait > 1 {
                        e.motion = Motion::Rim { wait: wait - 1 };
                    } else if let Some((_, d)) = self.nearest_live_claw(e.lane) {
                        if d != 0 {
                            let to = (e.lane as i32 + d.signum()).rem_euclid(self.lanes as i32)
                                as usize;
                            e.motion = Motion::Flip { to, left: FLIP_TICKS };
                        } else {
                            e.motion = Motion::Rim { wait: RIM_HOP_TICKS };
                        }
                    } else {
                        e.motion = Motion::Rim { wait: RIM_HOP_TICKS };
                    }
                }
                Motion::Grab { left } => {
                    if left > 1 {
                        e.motion = Motion::Grab { left: left - 1 };
                    } else {
                        // The grab lands on every live claw in the lane.
                        for k in 0..self.claws.len() {
                            if self.alive(k) && self.claw_lane(k) == e.lane {
                                self.claws[k].dead_until = self.ticks + RESPAWN_TICKS;
                                self.grabs += 1;
                            }
                        }
                        self.flash(e.lane, rim, RED, 3);
                        remove = true;
                    }
                }
                Motion::Retreat => {
                    e.depth -= SPIKER_RETREAT;
                    if e.depth < 0.0 {
                        remove = true;
                    }
                }
            }
            // A flipper sitting at the rim in a live claw's lane winds up.
            if !remove
                && matches!(e.motion, Motion::Rim { .. })
                && (0..self.claws.len()).any(|k| self.alive(k) && self.claw_lane(k) == e.lane)
            {
                e.motion = Motion::Grab { left: GRAB_TICKS };
            }
            if remove {
                self.enemies.swap_remove(i);
                continue;
            }
            self.enemies[i] = e;
            i += 1;
        }
    }

    /// A tap: this color's claw heads for the tapped lane.
    pub fn inject(&mut self, it: i32, _ir: i32, species: u8) {
        let k = (species % self.slots) as usize;
        let lane = self.lane_of_cell(it);
        let ticks = self.ticks;
        let c = &mut self.claws[k];
        c.target = lane;
        c.human_until = ticks + HUMAN_TICKS;
    }

    /// The Superzapper: every enemy on the board, gone, once per cooldown.
    pub fn command(&mut self, command: GameCommand, species: u8) {
        if command != GameCommand::Superzap {
            return;
        }
        let k = (species % self.slots) as usize;
        let ticks = self.ticks;
        self.claws[k].human_until = ticks + HUMAN_TICKS;
        if ticks < self.claws[k].zap_ready {
            return;
        }
        self.claws[k].zap_ready = ticks + ZAP_COOLDOWN;
        let enemies = std::mem::take(&mut self.enemies);
        for e in &enemies {
            self.flash(e.lane, e.depth, k as u8, 1);
        }
        let n = enemies.len() as u32;
        self.destroyed += n;
        self.claws[k].kills += n;
        self.zap_flash = ZAP_FLASH_TICKS;
        self.zap_tone = k as u8;
    }

    /// Upkeep lives in `tick`.
    pub fn watchdog(&mut self) {}

    /// The tube, spikes, enemies, shots, explosions, then the claws on top.
    pub fn pack_cells(&self) -> Vec<u32> {
        use super::hsv_to_packed_rgb as rgb;
        let (theta, radial) = (self.theta, self.radial);
        let mut out = vec![0u32; theta * radial];
        let zap = self.zap_flash as f32 / ZAP_FLASH_TICKS as f32;
        let tube_blue = 0.62;

        // The tube: a dim blue line down the first spoke of every lane, the
        // lip at the rim brighter, and the hole's edge.
        for lane in 0..self.lanes {
            let it = self.lane_cells(lane).start;
            for ir in 0..radial {
                out[ir * theta + it] = rgb(tube_blue, 0.9, 0.06 + 0.06 * ir as f32 / radial as f32);
            }
        }
        for it in 0..theta {
            out[(radial - 1) * theta + it] = rgb(tube_blue, 0.9, 0.22);
            out[it] = rgb(tube_blue, 0.9, 0.12);
        }
        // Each live claw's lane, faintly in its color, so a phone player
        // can see which tube is theirs.
        for k in 0..self.claws.len() {
            if !self.alive(k) {
                continue;
            }
            let faint = Self::tone_rgb(k as u8, 0.07);
            for it in self.lane_cells(self.claw_lane(k)) {
                for ir in 0..radial - 1 {
                    out[ir * theta + it] = faint;
                }
            }
        }
        if zap > 0.0 {
            let tint = Self::tone_rgb(self.zap_tone, 0.6 * zap);
            for c in out.iter_mut() {
                *c = tint;
            }
        }

        for (lane, &tip) in self.spikes.iter().enumerate() {
            if tip <= 0.0 {
                continue;
            }
            let it = self.lane_core(lane).start;
            for ir in 0..=(tip.round() as usize).min(radial - 1) {
                out[ir * theta + it] = rgb(0.33, 0.9, 0.35);
            }
        }

        // Enemies pulse, so they read as hostile whatever the claw colors.
        let pulse = 0.7 + 0.3 * ((self.ticks % 6) as f32 / 5.0 * std::f32::consts::PI).sin();
        for e in &self.enemies {
            let (hue, sat) = match e.kind {
                Kind::Flipper => (0.0, 0.95),
                Kind::Tanker => (0.78, 0.85),
                Kind::Spiker => (0.33, 0.95),
            };
            let color = rgb(hue, sat, pulse);
            let ir = (e.depth.round() as usize).min(radial - 1);
            let cells: Vec<usize> = match e.motion {
                // Mid-flip: astride the two lanes' shared edge.
                Motion::Flip { to, .. } => {
                    let a = self.lane_cells(e.lane);
                    let b = self.lane_cells(to);
                    if self.lane_diff(e.lane, to) > 0 {
                        vec![a.end - 1, b.start]
                    } else {
                        vec![a.start, b.end - 1]
                    }
                }
                Motion::Grab { .. } => self.lane_cells(e.lane).collect(),
                _ if e.kind == Kind::Tanker => self.lane_cells(e.lane).collect(),
                _ => self.lane_core(e.lane).collect(),
            };
            for it in cells {
                out[ir * theta + it] = color;
                if ir + 1 < radial && e.kind != Kind::Spiker {
                    out[(ir + 1) * theta + it] = color;
                }
            }
        }

        for s in &self.shots {
            let ir = s.depth.round().clamp(0.0, radial as f32 - 1.0) as usize;
            for it in self.lane_core(s.lane) {
                out[ir * theta + it] = rgb(0.14, 0.25, 1.0);
            }
        }

        for (idx, g) in self.glow.iter().enumerate() {
            if g.glow == 0 {
                continue;
            }
            let v = g.glow as f32 / 255.0;
            out[idx] = Self::tone_rgb(g.tone, v);
        }

        // Claws: the lane's width, the two outermost rings, in their color.
        // Claws sharing a lane (humans may stack) are drawn striped so every
        // color still shows.
        for k in 0..self.claws.len() {
            if !self.alive(k) {
                continue;
            }
            let lane = self.claw_lane(k);
            let sharing: Vec<usize> = (0..self.claws.len())
                .filter(|&j| self.alive(j) && self.claw_lane(j) == lane)
                .collect();
            let stripe = sharing.iter().position(|&j| j == k).unwrap_or(0);
            let c = &self.claws[k];
            let human = c.human_until > self.ticks;
            let color = Self::tone_rgb(k as u8, if human { 1.0 } else { 0.75 });
            // Fractional position: cover the cells under [pos, pos + 1) lanes.
            let start = c.pos / self.lanes as f32 * theta as f32;
            let width = theta as f32 / self.lanes as f32;
            let first = start.round() as i64;
            let last = (start + width).round() as i64;
            for (n, it) in (first..last.max(first + 1)).enumerate() {
                if n % sharing.len() != stripe {
                    continue;
                }
                let it = it.rem_euclid(theta as i64) as usize;
                out[(radial - 1) * theta + it] = color;
                out[(radial - 2) * theta + it] = color;
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim() -> RimfireSim {
        RimfireSim::new(64, 48, 4, 7)
    }

    /// Every claw parked in its lane and kept human (so the AI leaves it be),
    /// with automatic fire held off.
    fn hold_fire(s: &mut RimfireSim) {
        for c in &mut s.claws {
            c.human_until = u32::MAX;
            c.fire_wait = u32::MAX;
        }
    }

    /// An enemy that holds still unless the test gives it a speed.
    fn enemy(kind: Kind, lane: usize, depth: f32, motion: Motion) -> Enemy {
        Enemy {
            kind,
            lane,
            depth,
            speed: 0.0,
            motion,
            turn_at: 30.0,
        }
    }

    #[test]
    fn sixty_four_spokes_make_tempests_sixteen_lanes() {
        let s = sim();
        assert_eq!(s.lanes, 16);
        let mut covered = 0;
        for lane in 0..s.lanes {
            let cells = s.lane_cells(lane);
            assert_eq!(cells.len(), 4);
            assert_eq!(s.lane_core(lane).len(), 2);
            for it in cells {
                assert_eq!(s.lane_of_cell(it as i32), lane);
                covered += 1;
            }
        }
        assert_eq!(covered, 64);
    }

    #[test]
    fn a_shot_destroys_the_first_enemy_in_its_lane() {
        let mut s = sim();
        hold_fire(&mut s);
        s.enemies.push(enemy(Kind::Flipper, 3, 10.0, Motion::Climb));
        s.enemies.push(enemy(Kind::Flipper, 3, 30.0, Motion::Climb));
        s.shots.push(Shot { lane: 3, depth: 47.5, owner: 1 });
        for _ in 0..12 {
            s.tick_shots();
        }
        assert_eq!(s.enemies.len(), 1, "one shot, one kill");
        assert_eq!(s.enemies[0].depth, 10.0, "the deeper one survives");
        assert_eq!(s.claws[1].kills, 1);
    }

    #[test]
    fn a_tanker_splits_into_two_flippers_when_shot() {
        let mut s = sim();
        hold_fire(&mut s);
        s.enemies.push(enemy(Kind::Tanker, 5, 20.0, Motion::Climb));
        s.shots.push(Shot { lane: 5, depth: 47.5, owner: 0 });
        for _ in 0..15 {
            s.tick_shots();
        }
        assert_eq!(s.enemies.len(), 2);
        let mut lanes: Vec<usize> = s
            .enemies
            .iter()
            .map(|e| match e.motion {
                Motion::Flip { to, .. } => to,
                _ => panic!("split flippers start mid-flip"),
            })
            .collect();
        lanes.sort();
        assert_eq!(lanes, vec![4, 6]);
        assert!(s.enemies.iter().all(|e| e.kind == Kind::Flipper));
    }

    #[test]
    fn a_spike_shields_what_climbs_beneath_it_until_shot_away() {
        let mut s = sim();
        hold_fire(&mut s);
        s.spikes[2] = 20.0;
        s.enemies.push(enemy(Kind::Flipper, 2, 8.0, Motion::Climb));
        for _ in 0..3 {
            s.shots.push(Shot { lane: 2, depth: 47.5, owner: 0 });
            for _ in 0..25 {
                s.tick_shots();
            }
        }
        assert_eq!(s.enemies.len(), 1, "the spike took the shots");
        assert!((s.spikes[2] - (20.0 - 3.0 * SPIKE_EROSION)).abs() < 0.01);
        s.spikes[2] = 0.0;
        s.shots.push(Shot { lane: 2, depth: 47.5, owner: 0 });
        for _ in 0..25 {
            s.tick_shots();
        }
        assert!(s.enemies.is_empty(), "with the spike gone the flipper is hit");
    }

    #[test]
    fn a_flipper_at_the_rim_hunts_down_a_claw_that_will_not_shoot() {
        let mut s = sim();
        hold_fire(&mut s);
        // Claw 0 is in lane 0 and claw 3 in lane 12; a flipper reaches the
        // rim in lane 15, one hop from claw 0.
        assert_eq!(s.claw_lane(0), 0);
        s.enemies.push(enemy(Kind::Flipper, 15, 47.0, Motion::Rim { wait: 1 }));
        for _ in 0..120 {
            s.tick_enemies();
            s.ticks += 1;
        }
        assert_eq!(s.grabs, 1);
        assert!(!s.alive(0), "the claw was grabbed");
        // It comes back after the respawn time.
        for _ in 0..RESPAWN_TICKS + 1 {
            s.tick_claws();
            s.ticks += 1;
        }
        assert!(s.alive(0));
    }

    #[test]
    fn a_claw_shoots_a_flipper_winding_up_in_its_lane() {
        let mut s = sim();
        for c in &mut s.claws {
            c.human_until = u32::MAX;
            c.fire_wait = 0;
        }
        let lane0 = s.claw_lane(0);
        s.enemies.push(enemy(Kind::Flipper, lane0, 47.0, Motion::Grab { left: GRAB_TICKS }));
        // No new spawns for the test.
        s.spawn_acc = -1000.0;
        for _ in 0..GRAB_TICKS as usize {
            s.tick();
        }
        assert_eq!(s.grabs, 0, "the claw fired first");
        assert!(s.alive(0));
    }

    #[test]
    fn a_tap_sends_that_colors_claw_to_the_tapped_lane() {
        let mut s = sim();
        s.spawn_acc = -1000.0;
        s.inject(41, 30, 2); // cell 41 is in lane 10
        assert_eq!(s.claws[2].target, 10);
        for _ in 0..40 {
            s.tick();
        }
        assert_eq!(s.claw_lane(2), 10);
        assert!(s.claws[2].human_until > s.ticks, "a tap takes the claw from the AI");
    }

    #[test]
    fn the_superzapper_clears_the_board_then_cools_down() {
        let mut s = sim();
        for lane in 0..8 {
            s.enemies.push(enemy(Kind::Flipper, lane, 20.0, Motion::Climb));
        }
        s.command(GameCommand::Superzap, 1);
        assert!(s.enemies.is_empty());
        assert_eq!(s.claws[1].kills, 8);
        s.enemies.push(enemy(Kind::Flipper, 3, 20.0, Motion::Climb));
        s.command(GameCommand::Superzap, 1);
        assert_eq!(s.enemies.len(), 1, "cooling down");
        // Another color's zapper is its own.
        s.command(GameCommand::Superzap, 2);
        assert!(s.enemies.is_empty());
        // Other games' buttons do nothing.
        s.enemies.push(enemy(Kind::Flipper, 3, 20.0, Motion::Climb));
        s.command(GameCommand::Fire, 3);
        assert_eq!(s.enemies.len(), 1);
    }

    #[test]
    fn with_nobody_playing_the_ai_fights_and_sometimes_loses_a_claw() {
        let mut s = sim();
        for _ in 0..20 * 120 {
            s.tick();
        }
        assert!(s.destroyed > 40, "the AI barely fought: {}", s.destroyed);
        assert!(s.grabs > 0, "the attract mode should lose a claw now and then");
        assert!(s.enemies.len() < MAX_ENEMIES, "the board filled up");
    }

    #[test]
    fn spikers_leave_spikes_and_spikes_crumble() {
        let mut s = sim();
        hold_fire(&mut s);
        let mut e = enemy(Kind::Spiker, 7, 0.0, Motion::Climb);
        e.speed = SPIKER_CLIMB;
        e.turn_at = 25.0;
        s.enemies.push(e);
        for _ in 0..200 {
            s.tick_enemies();
        }
        assert!(s.enemies.is_empty(), "the spiker went back into the hole");
        assert!(s.spikes[7] >= 25.0);
        s.spawn_acc = -1e9;
        for _ in 0..4000 {
            s.tick();
        }
        assert_eq!(s.spikes[7], 0.0);
    }

    #[test]
    fn ai_claws_never_park_in_the_same_lane() {
        for seed in 0..6 {
            let mut s = RimfireSim::new(64, 48, 4, seed);
            for t in 0..2000 {
                s.tick();
                if t % 10 == 0 {
                    let mut targets: Vec<usize> = s.claws.iter().map(|c| c.target).collect();
                    targets.sort();
                    targets.dedup();
                    assert_eq!(targets.len(), 4, "seed {seed} tick {t}: two claws share a lane");
                }
            }
        }
    }

    #[test]
    fn claws_sharing_a_lane_both_show() {
        let mut s = sim();
        s.claws[1].pos = 0.0;
        s.claws[1].target = 0;
        let out = s.pack_cells();
        let yellow = RimfireSim::tone_rgb(0, 0.75);
        let cyan = RimfireSim::tone_rgb(1, 0.75);
        let rim: Vec<u32> = (0..4).map(|it| out[47 * 64 + it]).collect();
        assert!(rim.contains(&yellow) && rim.contains(&cyan), "{rim:06x?}");
    }

    #[test]
    fn pressure_follows_the_humans() {
        let mut s = sim();
        let calm = s.spawn_rate();
        s.inject(0, 0, 0);
        s.inject(20, 0, 1);
        assert!((s.spawn_rate() - (calm + 2.0 * RATE_PER_HUMAN)).abs() < 1e-4);
        for _ in 0..HUMAN_TICKS + 1 {
            s.tick();
        }
        assert_eq!(s.spawn_rate(), calm);
    }

    #[test]
    fn pack_draws_the_tube_and_the_claws() {
        let s = sim();
        let out = s.pack_cells();
        assert_eq!(out.len(), 64 * 48);
        // The lip of the tube is lit everywhere; claw 0 sits at lane 0.
        assert!(out[47 * 64 + 30] != 0);
        // Claw 0 is Tempest's yellow: red and green bright, blue low.
        let claw = out[47 * 64 + 1];
        let (r, g, b) = (claw & 0xff, (claw >> 8) & 0xff, claw >> 16);
        assert!(r > 150 && g > 150 && b < 100, "claw 0 should be yellow: {claw:06x}");
    }

    #[test]
    fn tick_is_deterministic() {
        let mut a = RimfireSim::new(64, 48, 4, 11);
        let mut b = RimfireSim::new(64, 48, 4, 11);
        for _ in 0..600 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.destroyed, b.destroyed);
        assert_eq!(a.enemies.len(), b.enemies.len());
        assert_eq!(a.pack_cells(), b.pack_cells());
    }
}

