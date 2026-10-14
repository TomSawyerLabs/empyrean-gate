//! DOOM as a game world (plans/doom.md). The engine side: `DoomSim` is the
//! `GameSim` arm that owns a child process running the real engine
//! (`host.rs`, reached as `empyrean-gate --doom-host`), turns its 8-bit frames
//! into the packed RGB raster the gate shader maps across the array, feeds it
//! the phone's keys, and decides when the game is over — the child died, the
//! player stopped pressing anything, or the controller walked away and nobody
//! picked it up.
//!
//! Nothing here can take the show down: a DOOM fault is an EOF on a pipe.

pub mod wire;

#[cfg(feature = "doom")]
pub mod host;

use crate::game::GameKey;
use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub use wire::{HEIGHT, WIDTH};

/// No key input for this long and DOOM ends (the "short timeout if the
/// player leaves"). DOOM itself keeps running meanwhile — the array shows
/// whatever the player left on screen, demons included.
pub const DOOM_IDLE_SECS: f32 = 90.0;
/// The controller's connection is gone (phone locked, walked out of WiFi,
/// closed the page) and nobody else has taken the keys for this long.
pub const DOOM_LEAVE_SECS: f32 = 15.0;

/// Where the crosshair lands on the array: the frame's centre is pushed this
/// far along the screen's "up" direction (in disc units, rim = 1) so the
/// middle of the view clears the hole instead of vanishing into it.
pub const SCREEN_LIFT: f32 = 0.43;
/// Width of the 4:3 frame in disc units — 2.0 spans the full diameter.
pub const SCREEN_WIDTH: f32 = 2.0;

/// SHA-256 of the shareware IWAD this binary embeds (see doom/README.md).
pub const WAD_SHA256: &str = "1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771";
pub const WAD_BYTES: usize = 4_196_020;

#[cfg(feature = "doom")]
const WAD: &[u8] = include_bytes!("../../doom/doom1.wad");

/// `doomkeys.h` codes for the keys a phone can hold.
pub fn doom_code(key: GameKey) -> u8 {
    match key {
        GameKey::Up => 0xad,
        GameKey::Down => 0xaf,
        GameKey::Left => 0xac,
        GameKey::Right => 0xae,
        GameKey::StrafeLeft => 0xa0,
        GameKey::StrafeRight => 0xa1,
        GameKey::Fire => 0xa3,
        GameKey::Use => 0xa2,
        GameKey::Run => 0x80 + 0x36,    // KEY_RSHIFT
        GameKey::Strafe => 0x80 + 0x38, // KEY_RALT
        GameKey::Weapon1 => b'1',
        GameKey::Weapon2 => b'2',
        GameKey::Weapon3 => b'3',
        GameKey::Weapon4 => b'4',
        GameKey::Weapon5 => b'5',
        GameKey::Weapon6 => b'6',
        GameKey::Weapon7 => b'7',
        GameKey::Escape => 27,
        GameKey::Enter => 13,
        GameKey::Yes => b'y',
        GameKey::No => b'n',
        GameKey::Map => 9,
    }
}

pub fn weapon_name(weapon: i32) -> &'static str {
    match weapon {
        0 => "Fist",
        1 => "Pistol",
        2 => "Shotgun",
        3 => "Chaingun",
        4 => "Rocket launcher",
        5 => "Plasma rifle",
        6 => "BFG 9000",
        7 => "Chainsaw",
        8 => "Super shotgun",
        _ => "?",
    }
}

/// The HUD, as the phone shows it (the array cannot show text). Mirrored
/// into `GameModeStatus::doom`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct DoomStatus {
    pub health: i32,
    pub armor: i32,
    /// `None` for weapons that need none.
    pub ammo: Option<i32>,
    pub max_ammo: Option<i32>,
    pub weapon: String,
    pub kills: i32,
    pub total_kills: i32,
    /// "E1M1".
    pub map: String,
    /// In a level (not intermission/finale), menu closed, not paused.
    pub playing: bool,
    pub menu: bool,
    /// Seconds since the last key or tap.
    pub idle_secs: u32,
    /// Frames received from the engine so far — a liveness number for the UI.
    pub frames: u64,
    /// The connection holding the controls: its client id (so a phone can tell
    /// whether it is the one) and display name. `None` = up for grabs.
    pub controller_id: Option<String>,
    pub controller: Option<String>,
    /// Screen orientation the shader is using: radians of the screen's
    /// "down" direction in array coordinates, and whether it is mirrored.
    pub turn: f32,
    pub mirror: bool,
}

/// What the stdout reader thread leaves for the sim.
#[derive(Default)]
struct Inbox {
    /// The newest complete frame; older ones are dropped unseen.
    frame: Option<Vec<u8>>,
    frames: u64,
    /// Set once: why the pipe ended.
    exited: Option<String>,
    /// DOOM's last few stderr lines, for the exit message.
    stderr_tail: VecDeque<String>,
}

pub struct DoomSim {
    child: Option<std::process::Child>,
    stdin: Option<std::process::ChildStdin>,
    inbox: Arc<Mutex<Inbox>>,
    /// Latest frame as packed RGB, `WIDTH × HEIGHT`.
    rgb: Vec<u32>,
    stats: wire::RawStats,
    frames: u64,
    dirty: bool,
    held: Vec<u8>,
    last_input: Instant,
    /// Someone has held the controls at some point: only then does losing
    /// them start the (shorter) leave clock. A game just started from the
    /// secret page and not yet claimed gets the idle allowance instead.
    ever_claimed: bool,
    unowned_since: Option<Instant>,
    turn: f32,
    mirror: bool,
    controller_id: Option<String>,
    controller: Option<String>,
    /// A permanent failure (spawn error, child exit). The game ends on it.
    error: Option<String>,
}

impl DoomSim {
    /// Spawn the engine at `skill` (1–5). A failure is not a panic: the sim
    /// comes back already `expired()` with the reason.
    pub fn new(skill: u8) -> Self {
        let now = Instant::now();
        let mut sim = Self {
            child: None,
            stdin: None,
            inbox: Arc::new(Mutex::new(Inbox::default())),
            rgb: vec![0; wire::PIXELS],
            stats: wire::RawStats::default(),
            frames: 0,
            dirty: true,
            held: Vec::new(),
            last_input: now,
            ever_claimed: false,
            unowned_since: None,
            turn: 0.0,
            mirror: false,
            controller_id: None,
            controller: None,
            error: None,
        };
        if let Err(e) = sim.launch(skill.clamp(1, 5)) {
            log::error!("doom: {e}");
            sim.error = Some(e);
        }
        sim
    }

    #[cfg(not(feature = "doom"))]
    fn launch(&mut self, _skill: u8) -> Result<(), String> {
        Err("this build was made without the `doom` feature".into())
    }

    #[cfg(feature = "doom")]
    fn launch(&mut self, skill: u8) -> Result<(), String> {
        use std::io::{BufRead, Read};
        use std::process::{Command, Stdio};

        let dir = data_dir();
        let wad = provision_wad(&dir)?;
        let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
        let mut command = Command::new(&exe);
        command
            .arg("--doom-host")
            .arg("--wad")
            .arg(&wad)
            .arg("--skill")
            .arg(skill.to_string())
            .arg("--cwd")
            .arg(&dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // A debug build is a console app; never flash a console on the
            // show machine for the child.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("could not start the DOOM host ({}): {e}", exe.display()))?;
        let stdin = child.stdin.take().ok_or("DOOM host has no stdin")?;
        let mut stdout = child.stdout.take().ok_or("DOOM host has no stdout")?;
        let stderr = child.stderr.take().ok_or("DOOM host has no stderr")?;
        log::info!("doom: started pid {} at skill {skill}", child.id());

        let inbox = self.inbox.clone();
        std::thread::Builder::new()
            .name("doom-frames".into())
            .spawn(move || {
                let mut buf = vec![0u8; wire::FRAME_BYTES];
                loop {
                    if let Err(e) = stdout.read_exact(&mut buf) {
                        let mut inbox = inbox.lock().unwrap_or_else(|p| p.into_inner());
                        let tail: Vec<String> = inbox.stderr_tail.iter().cloned().collect();
                        let detail = if tail.is_empty() {
                            String::new()
                        } else {
                            format!(" — {}", tail.join(" | "))
                        };
                        inbox.exited = Some(if e.kind() == std::io::ErrorKind::UnexpectedEof {
                            format!("DOOM exited{detail}")
                        } else {
                            format!("DOOM frame pipe failed: {e}{detail}")
                        });
                        return;
                    }
                    if wire::parse_frame(&buf).is_none() {
                        let mut inbox = inbox.lock().unwrap_or_else(|p| p.into_inner());
                        inbox.exited = Some("DOOM frame pipe lost sync".into());
                        return;
                    }
                    let mut inbox = inbox.lock().unwrap_or_else(|p| p.into_inner());
                    inbox.frames += 1;
                    match inbox.frame.as_mut() {
                        Some(slot) => slot.copy_from_slice(&buf),
                        None => inbox.frame = Some(buf.clone()),
                    }
                }
            })
            .map_err(|e| format!("spawn doom-frames thread: {e}"))?;

        let inbox = self.inbox.clone();
        std::thread::Builder::new()
            .name("doom-stderr".into())
            .spawn(move || {
                for line in std::io::BufReader::new(stderr).lines() {
                    let Ok(line) = line else { break };
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    log::debug!("doom: {line}");
                    let mut inbox = inbox.lock().unwrap_or_else(|p| p.into_inner());
                    if inbox.stderr_tail.len() >= 6 {
                        inbox.stderr_tail.pop_front();
                    }
                    inbox.stderr_tail.push_back(line);
                }
            })
            .map_err(|e| format!("spawn doom-stderr thread: {e}"))?;

        self.child = Some(child);
        self.stdin = Some(stdin);
        Ok(())
    }

    /// Pull the newest frame, if one arrived. Cheap when nothing did.
    pub fn tick(&mut self) {
        let (frame, frames, exited) = {
            let mut inbox = self.inbox.lock().unwrap_or_else(|p| p.into_inner());
            (inbox.frame.take(), inbox.frames, inbox.exited.clone())
        };
        if let Some(frame) = frame
            && let Some(view) = wire::parse_frame(&frame)
        {
            wire::apply_palette(view.palette, view.pixels, &mut self.rgb);
            self.stats = view.stats;
            self.dirty = true;
        }
        self.frames = frames;
        if self.error.is_none()
            && let Some(reason) = exited
        {
            log::warn!("doom: {reason}");
            self.error = Some(reason);
        }
    }

    /// The raster for the GPU: `WIDTH × HEIGHT` packed RGB, top row first.
    pub fn pack_cells(&self) -> Vec<u32> {
        self.rgb.clone()
    }

    /// True once since the last frame change — the engine uploads on it.
    pub fn take_dirty(&mut self) -> bool {
        std::mem::take(&mut self.dirty)
    }

    pub fn key(&mut self, key: GameKey, down: bool) {
        self.last_input = Instant::now();
        let code = doom_code(key);
        if down {
            if !self.held.contains(&code) {
                self.held.push(code);
            }
        } else {
            self.held.retain(|&c| c != code);
        }
        self.send(wire::encode_key(code, down));
    }

    /// Lift every held key — the controller's connection went away and DOOM
    /// must not keep running forward into a wall (or firing) for 15 s.
    pub fn release_all(&mut self) {
        let held = std::mem::take(&mut self.held);
        for code in held {
            self.send(wire::encode_key(code, false));
        }
    }

    fn send(&mut self, event: [u8; 2]) {
        if let Some(stdin) = self.stdin.as_mut()
            && let Err(e) = stdin.write_all(&event).and_then(|()| stdin.flush())
            && self.error.is_none()
        {
            self.error = Some(format!("DOOM stopped taking input: {e}"));
        }
    }

    /// "Face me": the screen's bottom edge points at `angle` (array radians).
    pub fn face(&mut self, angle: f32) {
        self.turn = angle.rem_euclid(std::f32::consts::TAU);
        self.last_input = Instant::now();
    }

    pub fn set_mirror(&mut self, mirror: bool) {
        self.mirror = mirror;
        self.last_input = Instant::now();
    }

    pub fn turn(&self) -> f32 {
        self.turn
    }

    pub fn mirror(&self) -> bool {
        self.mirror
    }

    /// The engine tells the sim who holds the controls each frame; a change
    /// away from someone lifts their keys and starts the leave clock.
    pub fn set_controller(&mut self, id: Option<&str>, name: Option<&str>) {
        let changed = self.controller_id.as_deref() != id;
        if changed && self.controller_id.is_some() {
            self.release_all();
        }
        self.controller_id = id.map(str::to_string);
        self.controller = name.map(str::to_string);
        match (id, self.unowned_since) {
            (Some(_), _) => {
                self.ever_claimed = true;
                self.unowned_since = None;
            }
            (None, None) if self.ever_claimed => self.unowned_since = Some(Instant::now()),
            (None, _) => {}
        }
    }

    /// Why the game is over, if it is.
    pub fn expired(&self) -> Option<String> {
        self.expired_at(Instant::now())
    }

    fn expired_at(&self, now: Instant) -> Option<String> {
        if let Some(e) = &self.error {
            return Some(e.clone());
        }
        let idle = now.saturating_duration_since(self.last_input).as_secs_f32();
        if idle >= DOOM_IDLE_SECS {
            return Some(format!(
                "nobody touched the controls for {} s",
                DOOM_IDLE_SECS as u32
            ));
        }
        if let Some(since) = self.unowned_since
            && now.saturating_duration_since(since).as_secs_f32() >= DOOM_LEAVE_SECS
        {
            return Some("the player left".into());
        }
        None
    }

    pub fn status(&self) -> DoomStatus {
        let s = &self.stats;
        DoomStatus {
            health: s.health,
            armor: s.armor,
            ammo: (s.ammo >= 0).then_some(s.ammo),
            max_ammo: (s.max_ammo >= 0).then_some(s.max_ammo),
            weapon: weapon_name(s.weapon).into(),
            kills: s.kills,
            total_kills: s.total_kills,
            // Before the first frame the stats are zeros, not a game.
            map: if self.frames == 0 {
                "starting".into()
            } else {
                format!("E{}M{}", s.episode, s.map)
            },
            playing: self.frames > 0 && s.state == 0 && s.menu == 0 && s.paused == 0,
            menu: s.menu != 0,
            idle_secs: self.last_input.elapsed().as_secs() as u32,
            frames: self.frames,
            controller_id: self.controller_id.clone(),
            controller: self.controller.clone(),
            turn: self.turn,
            mirror: self.mirror,
        }
    }

    /// The status-line fragment ("E1M1 · 100 % · 3 kills").
    pub fn detail(&self) -> String {
        if let Some(e) = &self.error {
            return e.clone();
        }
        if self.frames == 0 {
            return "starting".into();
        }
        let s = &self.stats;
        let mut out = format!("E{}M{} · {} % · {} kills", s.episode, s.map, s.health, s.kills);
        if let Some(name) = &self.controller {
            out.push_str(" · ");
            out.push_str(name);
        }
        out
    }
}

impl Drop for DoomSim {
    fn drop(&mut self) {
        // Closing stdin is the polite signal (the key thread exits the
        // process); the kill is for a DOOM wedged in I_Error.
        self.stdin = None;
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
            log::info!("doom: stopped");
        }
    }
}

/// `<config dir>/EmpyreanGate/doom/` — the WAD, DOOM's default.cfg and saves.
pub fn data_dir() -> PathBuf {
    crate::config::config_path()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("doom")
}

/// Make sure the embedded IWAD is on disk and intact; returns its path.
#[cfg(feature = "doom")]
fn provision_wad(dir: &Path) -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let path = dir.join("doom1.wad");
    let intact = std::fs::read(&path)
        .ok()
        .is_some_and(|bytes| bytes.len() == WAD_BYTES && hex(&Sha256::digest(&bytes)) == WAD_SHA256);
    if intact {
        return Ok(path);
    }
    let embedded = hex(&Sha256::digest(WAD));
    if embedded != WAD_SHA256 || WAD.len() != WAD_BYTES {
        return Err(format!(
            "the embedded doom1.wad is not the shareware IWAD this build expects (sha256 {embedded})"
        ));
    }
    let tmp = dir.join("doom1.wad.part");
    std::fs::write(&tmp, WAD).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("install {}: {e}", path.display()))?;
    log::info!("doom: installed doom1.wad at {}", path.display());
    Ok(path)
}

#[cfg(feature = "doom")]
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// A sim with no child (as a `doom`-less build, or a failed spawn, has).
    fn bare() -> DoomSim {
        let now = Instant::now();
        DoomSim {
            child: None,
            stdin: None,
            inbox: Arc::new(Mutex::new(Inbox::default())),
            rgb: vec![0; wire::PIXELS],
            stats: wire::RawStats::default(),
            frames: 0,
            dirty: true,
            held: Vec::new(),
            last_input: now,
            ever_claimed: false,
            unowned_since: None,
            turn: 0.0,
            mirror: false,
            controller_id: None,
            controller: None,
            error: None,
        }
    }

    #[test]
    fn key_codes_match_doomkeys_h() {
        assert_eq!(doom_code(GameKey::Up), 0xad);
        assert_eq!(doom_code(GameKey::Fire), 0xa3);
        assert_eq!(doom_code(GameKey::Use), 0xa2);
        assert_eq!(doom_code(GameKey::Run), 0xb6);
        assert_eq!(doom_code(GameKey::Weapon3), b'3');
        assert_eq!(doom_code(GameKey::Escape), 27);
        assert_eq!(doom_code(GameKey::Map), 9);
    }

    #[test]
    fn idle_ends_the_game_after_the_allowance() {
        let sim = bare();
        let now = sim.last_input;
        assert_eq!(sim.expired_at(now), None);
        assert_eq!(
            sim.expired_at(now + Duration::from_secs_f32(DOOM_IDLE_SECS - 1.0)),
            None
        );
        assert!(
            sim.expired_at(now + Duration::from_secs_f32(DOOM_IDLE_SECS + 0.5))
                .is_some_and(|r| r.contains("nobody touched"))
        );
    }

    #[test]
    fn leaving_ends_the_game_only_after_someone_had_the_controls() {
        let mut sim = bare();
        let t0 = sim.last_input;
        // Nobody has claimed it yet: the leave clock does not run.
        sim.set_controller(None, None);
        assert_eq!(sim.expired_at(t0 + Duration::from_secs_f32(DOOM_LEAVE_SECS + 5.0)), None);
        // Someone plays, then disconnects.
        sim.set_controller(Some("phone-a"), Some("Dusty Badger"));
        sim.set_controller(None, None);
        let left = sim.unowned_since.expect("leave clock started");
        assert_eq!(sim.expired_at(left + Duration::from_secs_f32(DOOM_LEAVE_SECS - 1.0)), None);
        assert_eq!(
            sim.expired_at(left + Duration::from_secs_f32(DOOM_LEAVE_SECS + 0.1)).as_deref(),
            Some("the player left")
        );
        // A new controller stops the clock (inside the idle allowance, which
        // is the other way a quiet game ends).
        sim.set_controller(Some("phone-b"), Some("Sonic Tumbleweed"));
        assert_eq!(
            sim.expired_at(left + Duration::from_secs_f32(DOOM_LEAVE_SECS + 5.0)).as_deref(),
            None
        );
    }

    #[test]
    fn controller_change_lifts_held_keys() {
        let mut sim = bare();
        sim.set_controller(Some("a"), None);
        sim.key(GameKey::Up, true);
        sim.key(GameKey::Fire, true);
        assert_eq!(sim.held.len(), 2);
        sim.set_controller(None, None);
        assert!(sim.held.is_empty());
    }

    #[test]
    fn an_error_is_an_immediate_end() {
        let mut sim = bare();
        sim.error = Some("DOOM exited".into());
        assert_eq!(sim.expired().as_deref(), Some("DOOM exited"));
        assert_eq!(sim.detail(), "DOOM exited");
    }

    #[test]
    fn status_mirrors_the_stats() {
        let mut sim = bare();
        sim.stats = wire::RawStats {
            health: 73,
            armor: 10,
            ammo: -1,
            max_ammo: -1,
            weapon: 7,
            episode: 1,
            map: 2,
            ..Default::default()
        };
        sim.frames = 9;
        let st = sim.status();
        assert_eq!(st.map, "E1M2");
        assert_eq!(st.weapon, "Chainsaw");
        assert_eq!(st.ammo, None);
        assert!(st.playing);
        assert_eq!(sim.detail(), "E1M2 · 73 % · 0 kills");
    }
}
