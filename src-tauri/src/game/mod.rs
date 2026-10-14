//! Game mode — continuously-running simulations the array becomes when an admin
//! starts a game. Design center (see `plans/game-mode.md`): every game is a
//! zero-player-capable world; connected clients perturb it, they are not
//! prerequisites. This module holds the pure simulation cores; engine/protocol
//! wiring lives with the rest of the frame loop.

pub mod echo;
pub mod flak;
pub mod gathering;
pub mod life;
pub mod perimeter;
pub mod radial_tetris;
pub mod rally;
pub mod rimfire;
pub mod rps;
pub mod spacewar;
pub mod spokewar;
pub mod trails;

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
    /// Mixed-size blocks falling inward; complete concentric rings collapse.
    RadialTetris,
    /// Hidden: Gate, Perimeter & Exodus's trucks catching sneakers at the
    /// trash fence (see `perimeter`, plans/hidden-modes.md).
    Perimeter,
    /// Hidden: the host camp's — calling lost sparks home to the six orbs of
    /// the Entheos mark until the sigil is whole (see `gathering`).
    Gathering,
    /// Tempest on the ring: enemies climb out of the hole along the lanes,
    /// claws on the rim shoot them down (see `rimfire`).
    Rimfire,
    /// Simon for the whole floor: coloured wedges, a pattern on the beat,
    /// the crowd answers together (see `echo`).
    Echo,
    /// Spacewar! around a real star: the hole's gravity bends ships and
    /// torpedoes; the rim wraps to the opposite side (see `spacewar`).
    Spacewar,
    /// Light cycles on the ring: walls of light, the hole and rim are walls
    /// too, tails fade (see `trails`).
    Trails,
    /// Pong for any number of players: every color owns an arc of the rim
    /// with a paddle; balls bounce off the hole (see `rally`).
    Rally,
    /// Shareware DOOM, the real thing, in a child process; the phone is the
    /// controller and the HUD (plans/doom.md). Reached by a secret code, not
    /// the Games tab, and not a playlist cue.
    Doom,
}

impl GameKind {
    pub fn label(self) -> &'static str {
        match self {
            GameKind::Rps => "Ecosystem",
            GameKind::Life => "Primordial",
            GameKind::Spokewar => "Spokewar",
            GameKind::Flak => "Flak",
            GameKind::RadialTetris => "Ringfall",
            GameKind::Perimeter => "Perimeter",
            GameKind::Gathering => "Gathering",
            GameKind::Rimfire => "Rimfire",
            GameKind::Echo => "Echo",
            GameKind::Spacewar => "Spacewar",
            GameKind::Trails => "Trails",
            GameKind::Rally => "Rally",
            GameKind::Doom => "DOOM",
        }
    }

    /// The perk a public-floor key must carry to start this game from the
    /// floor; `None` for games that are the operator's alone. Mirrors the
    /// catalog's `hidden` entries in `src/gameCatalog.ts`.
    pub fn floor_perk(self) -> Option<&'static str> {
        match self {
            GameKind::Perimeter => Some("game:perimeter"),
            GameKind::Gathering => Some("game:gathering"),
            _ => None,
        }
    }

    /// Color slots a floor start opens with — the catalog's `knob.start`,
    /// which the operator's Games tab sends after its own start.
    pub fn floor_species(self) -> u8 {
        match self {
            GameKind::Rps => 5,
            GameKind::Life => 6,
            GameKind::Spokewar => 5,
            GameKind::Flak => 5,
            GameKind::RadialTetris => 6,
            GameKind::Perimeter => 5,
            GameKind::Gathering => 5,
            GameKind::Rimfire => 4,
            GameKind::Echo => 4,
            GameKind::Spacewar => 4,
            GameKind::Trails => 4,
            GameKind::Rally => 4,
            // DOOM's knob is its skill; the floor never starts it anyway.
            GameKind::Doom => 3,
        }
    }

    /// The games the Games tab offers and a playlist can cue. DOOM is an
    /// easter egg: it starts from its secret page, over a show if need be.
    pub fn is_listed(self) -> bool {
        !matches!(self, GameKind::Doom)
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
    RadialTetris(radial_tetris::RadialTetrisSim),
    Perimeter(perimeter::PerimeterSim),
    Gathering(gathering::GatheringSim),
    Rimfire(rimfire::RimfireSim),
    Echo(echo::EchoSim),
    Spacewar(spacewar::SpacewarSim),
    Trails(trails::TrailsSim),
    Rally(rally::RallySim),
    Doom(crate::doom::DoomSim),
}

impl GameSim {
    /// `species` is the one admin knob, per-game meaning (see `set_species`);
    /// for DOOM it is the skill (1–5) the engine starts at.
    pub fn new(kind: GameKind, theta: usize, radial: usize, species: u8, seed: u64) -> Self {
        match kind {
            GameKind::Rps => GameSim::Rps(rps::RpsSim::new(theta, radial, species, seed)),
            GameKind::Life => GameSim::Life(life::LifeSim::new(theta, radial, species, seed)),
            GameKind::Spokewar => {
                GameSim::Spokewar(spokewar::SpokewarSim::new(theta, radial, species, seed))
            }
            GameKind::Flak => GameSim::Flak(flak::FlakSim::new(theta, radial, species, seed)),
            GameKind::RadialTetris => GameSim::RadialTetris(radial_tetris::RadialTetrisSim::new(
                theta, radial, species, seed,
            )),
            GameKind::Perimeter => {
                GameSim::Perimeter(perimeter::PerimeterSim::new(theta, radial, species, seed))
            }
            GameKind::Gathering => {
                GameSim::Gathering(gathering::GatheringSim::new(theta, radial, species, seed))
            }
            GameKind::Rimfire => {
                GameSim::Rimfire(rimfire::RimfireSim::new(theta, radial, species, seed))
            }
            GameKind::Echo => GameSim::Echo(echo::EchoSim::new(theta, radial, species, seed)),
            GameKind::Spacewar => {
                GameSim::Spacewar(spacewar::SpacewarSim::new(theta, radial, species, seed))
            }
            GameKind::Trails => {
                GameSim::Trails(trails::TrailsSim::new(theta, radial, species, seed))
            }
            GameKind::Rally => GameSim::Rally(rally::RallySim::new(theta, radial, species, seed)),
            GameKind::Doom => GameSim::Doom(crate::doom::DoomSim::new(species)),
        }
    }

    /// `Some((width, height))` for sims whose cells are a planar raster the
    /// shader maps across the disc (DOOM), `None` for the polar grid games.
    pub fn raster(&self) -> Option<(usize, usize)> {
        match self {
            GameSim::Doom(_) => Some((crate::doom::WIDTH, crate::doom::HEIGHT)),
            _ => None,
        }
    }

    pub fn theta(&self) -> usize {
        match self {
            GameSim::Rps(s) => s.theta(),
            GameSim::Life(s) => s.theta(),
            GameSim::Spokewar(s) => s.theta(),
            GameSim::Flak(s) => s.theta(),
            GameSim::RadialTetris(s) => s.theta(),
            GameSim::Perimeter(s) => s.theta(),
            GameSim::Gathering(s) => s.theta(),
            GameSim::Rimfire(s) => s.theta(),
            GameSim::Echo(s) => s.theta(),
            GameSim::Spacewar(s) => s.theta(),
            GameSim::Trails(s) => s.theta(),
            GameSim::Rally(s) => s.theta(),
            GameSim::Doom(_) => crate::doom::WIDTH,
        }
    }

    pub fn radial(&self) -> usize {
        match self {
            GameSim::Rps(s) => s.radial(),
            GameSim::Life(s) => s.radial(),
            GameSim::Spokewar(s) => s.radial(),
            GameSim::Flak(s) => s.radial(),
            GameSim::RadialTetris(s) => s.radial(),
            GameSim::Perimeter(s) => s.radial(),
            GameSim::Gathering(s) => s.radial(),
            GameSim::Rimfire(s) => s.radial(),
            GameSim::Echo(s) => s.radial(),
            GameSim::Spacewar(s) => s.radial(),
            GameSim::Trails(s) => s.radial(),
            GameSim::Rally(s) => s.radial(),
            GameSim::Doom(_) => crate::doom::HEIGHT,
        }
    }

    /// The "species" admin knob: species count for the ecosystem, palette
    /// slots for Life, base count for Spokewar, color slots for Flak. One
    /// knob, per-game meaning (trucks for Perimeter, sparks for Gathering).
    pub fn set_species(&mut self, species: u8) {
        match self {
            GameSim::Rps(s) => s.set_species_count(species),
            GameSim::Life(s) => s.set_palette(species),
            GameSim::Spokewar(s) => s.set_bases(species),
            GameSim::Flak(s) => s.set_slots(species),
            GameSim::RadialTetris(s) => s.set_slots(species),
            GameSim::Perimeter(s) => s.set_slots(species),
            GameSim::Gathering(s) => s.set_slots(species),
            GameSim::Rimfire(s) => s.set_slots(species),
            GameSim::Echo(s) => s.set_slots(species),
            GameSim::Spacewar(s) => s.set_slots(species),
            GameSim::Trails(s) => s.set_slots(species),
            GameSim::Rally(s) => s.set_slots(species),
            // Skill is fixed at launch; DOOM has no live knob.
            GameSim::Doom(_) => {}
        }
    }

    /// `None` = generations follow the beat (the grid games); `Some(secs)` =
    /// fixed step, for sims whose motion should not care about the music.
    pub fn cadence(&self) -> Option<f32> {
        match self {
            GameSim::Rps(_) | GameSim::Life(_) => None,
            GameSim::Spokewar(_) => Some(spokewar::TICK_SECS),
            GameSim::Flak(_) => Some(flak::TICK_SECS),
            GameSim::RadialTetris(_) => Some(radial_tetris::TICK_SECS),
            GameSim::Perimeter(_) => Some(perimeter::TICK_SECS),
            GameSim::Gathering(_) => Some(gathering::TICK_SECS),
            GameSim::Rimfire(_) => Some(rimfire::TICK_SECS),
            GameSim::Echo(_) => Some(echo::TICK_SECS),
            GameSim::Spacewar(_) => Some(spacewar::TICK_SECS),
            GameSim::Trails(_) => Some(trails::TICK_SECS),
            GameSim::Rally(_) => Some(rally::TICK_SECS),
            // Every render frame: the tick only polls the child's newest frame.
            GameSim::Doom(_) => Some(0.0),
        }
    }

    pub fn tick(&mut self) {
        match self {
            GameSim::Rps(s) => s.tick(),
            GameSim::Life(s) => s.tick(),
            GameSim::Spokewar(s) => s.tick(),
            GameSim::Flak(s) => s.tick(),
            GameSim::RadialTetris(s) => s.tick(),
            GameSim::Perimeter(s) => s.tick(),
            GameSim::Gathering(s) => s.tick(),
            GameSim::Rimfire(s) => s.tick(),
            GameSim::Echo(s) => s.tick(),
            GameSim::Spacewar(s) => s.tick(),
            GameSim::Trails(s) => s.tick(),
            GameSim::Rally(s) => s.tick(),
            GameSim::Doom(s) => s.tick(),
        }
    }

    pub fn watchdog(&mut self) {
        match self {
            GameSim::Rps(s) => s.watchdog(),
            GameSim::Life(s) => s.watchdog(),
            GameSim::Spokewar(s) => s.watchdog(),
            GameSim::Flak(s) => s.watchdog(),
            GameSim::RadialTetris(s) => s.watchdog(),
            GameSim::Perimeter(s) => s.watchdog(),
            GameSim::Gathering(s) => s.watchdog(),
            GameSim::Rimfire(s) => s.watchdog(),
            GameSim::Echo(s) => s.watchdog(),
            GameSim::Spacewar(s) => s.watchdog(),
            GameSim::Trails(s) => s.watchdog(),
            GameSim::Rally(s) => s.watchdog(),
            GameSim::Doom(_) => {}
        }
    }

    pub fn inject(&mut self, it: i32, ir: i32, half_theta: f32, half_r: f32, species: u8) {
        match self {
            GameSim::Rps(s) => s.inject(it, ir, half_theta, half_r, species % s.species_count()),
            GameSim::Life(s) => s.inject(it, ir, half_theta, half_r, species),
            GameSim::Spokewar(s) => s.inject(it, ir, species),
            GameSim::Flak(s) => s.inject(it, ir, species),
            GameSim::RadialTetris(s) => s.inject(it, species),
            GameSim::Perimeter(s) => s.inject(it, ir, species),
            GameSim::Gathering(s) => s.inject(it, ir, species),
            GameSim::Rimfire(s) => s.inject(it, ir, species),
            GameSim::Echo(s) => s.inject(it, ir, species),
            GameSim::Spacewar(s) => s.inject(it, ir, species),
            GameSim::Trails(s) => s.inject(it, ir, species),
            GameSim::Rally(s) => s.inject(it, ir, species),
            // A tap on the array preview is "face me": the screen's bottom
            // edge swings to point at the tapped spoke. The engine computed
            // `it` against this sim's theta(), which for DOOM is the raster
            // width, so it is a fraction of a turn in WIDTH units.
            GameSim::Doom(s) => {
                s.face(it as f32 / crate::doom::WIDTH as f32 * std::f32::consts::TAU)
            }
        }
    }

    /// A beat of the music (confident tempo only), for sims that keep time
    /// with it rather than ticking on it (Echo).
    pub fn beat(&mut self) {
        if let GameSim::Echo(sim) = self {
            sim.beat();
        }
    }

    /// Held-key input (DOOM). Games without keys ignore it.
    pub fn key(&mut self, key: GameKey, down: bool) {
        if let GameSim::Doom(sim) = self {
            sim.key(key, down);
        }
    }

    /// Who holds the controls, for sims that have a single controller.
    pub fn set_controller(&mut self, id: Option<&str>, name: Option<&str>) {
        if let GameSim::Doom(sim) = self {
            sim.set_controller(id, name);
        }
    }

    pub fn set_mirror(&mut self, mirror: bool) {
        if let GameSim::Doom(sim) = self {
            sim.set_mirror(mirror);
        }
    }

    /// Raster orientation for the shader: (radians of screen-down, mirrored).
    pub fn orientation(&self) -> (f32, bool) {
        match self {
            GameSim::Doom(sim) => (sim.turn(), sim.mirror()),
            _ => (0.0, false),
        }
    }

    /// Sims that end themselves report why; the engine stops the game.
    pub fn expired(&self) -> Option<String> {
        match self {
            GameSim::Doom(sim) => sim.expired(),
            _ => None,
        }
    }

    /// Raster sims flag when a new frame arrived; grid sims are uploaded on
    /// tick/injection by the engine's own bookkeeping.
    pub fn take_dirty(&mut self) -> bool {
        match self {
            GameSim::Doom(sim) => sim.take_dirty(),
            _ => false,
        }
    }

    pub fn doom_status(&self) -> Option<crate::doom::DoomStatus> {
        match self {
            GameSim::Doom(sim) => Some(sim.status()),
            _ => None,
        }
    }

    /// A button press from the player holding color `species`.
    pub fn command(&mut self, command: GameCommand, species: u8) {
        match self {
            GameSim::RadialTetris(sim) => sim.command(command),
            GameSim::Rally(sim) => sim.command(command, species),
            GameSim::Trails(sim) => sim.command(command, species),
            GameSim::Spacewar(sim) => sim.command(command, species),
            GameSim::Echo(sim) => sim.command(command, species),
            GameSim::Rimfire(sim) => sim.command(command, species),
            _ => {}
        }
    }

    pub fn detail(&self) -> Option<String> {
        match self {
            GameSim::RadialTetris(sim) => Some(sim.detail()),
            GameSim::Perimeter(sim) => Some(sim.detail()),
            GameSim::Gathering(sim) => Some(sim.detail()),
            GameSim::Rimfire(sim) => Some(sim.detail()),
            GameSim::Echo(sim) => Some(sim.detail()),
            GameSim::Spacewar(sim) => Some(sim.detail()),
            GameSim::Trails(sim) => Some(sim.detail()),
            GameSim::Rally(sim) => Some(sim.detail()),
            GameSim::Doom(sim) => Some(sim.detail()),
            _ => None,
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
            GameSim::RadialTetris(s) => s.pack_cells(),
            GameSim::Perimeter(s) => s.pack_cells(time),
            GameSim::Gathering(s) => s.pack_cells(time),
            GameSim::Rimfire(s) => s.pack_cells(),
            GameSim::Echo(s) => s.pack_cells(),
            GameSim::Spacewar(s) => s.pack_cells(),
            GameSim::Trails(s) => s.pack_cells(),
            GameSim::Rally(s) => s.pack_cells(),
            GameSim::Doom(s) => s.pack_cells(),
        }
    }
}

/// A key a phone can hold down (DOOM). Names are DOOM's actions, not the
/// keyboard keys that happen to default to them, so the controller surface
/// says what it does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameKey {
    Up,
    Down,
    Left,
    Right,
    StrafeLeft,
    StrafeRight,
    Fire,
    Use,
    Run,
    Strafe,
    Weapon1,
    Weapon2,
    Weapon3,
    Weapon4,
    Weapon5,
    Weapon6,
    Weapon7,
    Escape,
    Enter,
    Yes,
    No,
    Map,
}

/// Explicit controller actions for games that need buttons. Keeping these out
/// of polar tap coordinates makes the play surface self-explanatory and keeps
/// canvas taps free to mean “move here”. Each arrives with the presser's
/// color slot (plans/classic-games.md); Ringfall's shared piece ignores it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameCommand {
    MoveCounterClockwise,
    MoveClockwise,
    RotateClockwise,
    SoftDrop,
    HardDrop,
    /// Trails: turn the cycle a quarter turn, as seen on the phone preview.
    TurnLeft,
    TurnRight,
    /// Spacewar: a torpedo along the ship's heading.
    Fire,
    /// Spacewar: vanish and reappear somewhere random — usually.
    Hyperspace,
    /// Rimfire: clear the board, once per color per cooldown.
    Superzap,
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
    /// Explicit button/keyboard actions with the presser's color slot,
    /// drained once per render frame.
    pub commands: Vec<(GameCommand, u8)>,
    /// Held-key events (DOOM), drained once per render frame.
    pub keys: Vec<(GameKey, bool)>,
    /// The connection holding DOOM's controls (plans/doom.md): the first to
    /// send a key, until it disconnects. `None` = up for grabs.
    pub controller: Option<GameController>,
    /// Mirror the raster left-right (viewed from the other side of the ring).
    pub mirror: bool,
    /// Why the last game ended on its own, and when — shown for a few seconds.
    pub ended: Option<(String, Instant)>,
    /// When the current game was started (None while inactive).
    pub started: Option<Instant>,
    /// Started from the public floor by a key holder (plans/hidden-modes.md).
    /// The floor may stop such a game, and it stops itself after
    /// `public::FLOOR_GAME_IDLE` without input. Never set by the operator's
    /// own start, which also clears it.
    pub from_floor: bool,
    /// The most recent player input of any kind, for the floor game's idle
    /// stop. Set on start too, so a fresh game has its full idle allowance.
    pub last_input: Option<Instant>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameController {
    pub conn_id: u64,
    pub client_id: String,
}

pub const MAX_QUEUED_INPUTS: usize = 256;

impl Default for GameControl {
    fn default() -> Self {
        Self {
            active: None,
            species: 3,
            effects_overlay: false,
            inputs: Vec::new(),
            commands: Vec::new(),
            keys: Vec::new(),
            controller: None,
            mirror: false,
            ended: None,
            started: None,
            from_floor: false,
            last_input: None,
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

        let radial = serde_json::to_string(&GameKind::RadialTetris).unwrap();
        assert_eq!(radial, "\"radial_tetris\"");
        assert_eq!(
            serde_json::from_str::<GameKind>(&radial).unwrap(),
            GameKind::RadialTetris
        );
        // The floor perk is built from the wire name.
        assert_eq!(
            serde_json::to_string(&GameKind::Perimeter).unwrap(),
            "\"perimeter\""
        );
        assert_eq!(GameKind::Perimeter.floor_perk(), Some("game:perimeter"));
        assert_eq!(GameKind::Gathering.floor_perk(), Some("game:gathering"));
        assert_eq!(GameKind::Flak.floor_perk(), None);
        assert_eq!(serde_json::to_string(&GameKind::Doom).unwrap(), "\"doom\"");
        assert_eq!(
            serde_json::to_string(&GameKey::StrafeLeft).unwrap(),
            "\"strafe_left\""
        );
        assert!(!GameKind::Doom.is_listed());
        assert!(GameKind::Rps.is_listed());
    }

    /// Buttons carry the presser's color; a client from before that (only
    /// Ringfall had buttons) still parses, as color 0.
    #[test]
    fn game_commands_carry_a_color_and_default_it_for_older_clients() {
        use crate::protocol::ClientMsg;
        let old: ClientMsg =
            serde_json::from_str(r#"{"type":"game_command","command":"hard_drop"}"#).unwrap();
        assert!(matches!(
            old,
            ClientMsg::GameCommand {
                command: GameCommand::HardDrop,
                species: 0
            }
        ));
        let new: ClientMsg =
            serde_json::from_str(r#"{"type":"game_command","command":"turn_left","species":3}"#)
                .unwrap();
        assert!(matches!(
            new,
            ClientMsg::GameCommand {
                command: GameCommand::TurnLeft,
                species: 3
            }
        ));
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
