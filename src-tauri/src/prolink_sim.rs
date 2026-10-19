//! A simulated PRO DJ LINK: two virtual CDJs (players 1 and 2) and a mixer,
//! with an Auto DJ playing a crate of invented tracks, for testing a gate
//! with no CDJs on its network. It emits the packets real players do (status
//! on UDP 50002, beats and absolute position on 50001, keepalives on 50000)
//! and the track metadata a dbserver fetch would bring (rekordbox phrases, a
//! waveform, the beat grid); rhythm.rs feeds them through its own handlers,
//! so everything downstream is the real path.
//!
//! The decks and the Auto DJ are a port of the web runtime's simulator
//! (packages/patch-web/src/runtime/djlink.ts); the crate comes from
//! tests/fixtures/dj-sim.json, which that simulator writes, and a test here
//! replays its timeline to keep the two in step. plans/dj-link-simulator.md.

use crate::protocol::{
    ProDjLinkBeatGridEntry, ProDjLinkPhraseAnalysis, ProDjLinkPhraseInfo, ProDjLinkTrackInfo,
};
use serde::Deserialize;
use std::sync::OnceLock;

/// The shared fixture: the crate, the set's tempo, and the TS timeline.
const FIXTURE: &str = include_str!("../../tests/fixtures/dj-sim.json");

const MAGIC: &[u8; 10] = b"Qspt1WmJOL";

/// rekordbox ids of simulated tracks are this plus the crate index.
pub const SIM_REKORDBOX_ID_BASE: u32 = 0x5153_0000;

/// What a simulated player calls itself on the network.
pub const SIM_PLAYER_NAME: &str = "Simulated CDJ";

#[derive(Debug, Clone, Deserialize)]
pub struct SimPhrase {
    pub kind: String,
    pub beats: u32,
    #[serde(default)]
    pub fill: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SimLoop {
    pub beats: u32,
    pub laps: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimMove {
    pub at: u32,
    #[serde(default, rename = "loop")]
    pub loop_: Option<SimLoop>,
    #[serde(default)]
    pub jump_to: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SimTrack {
    pub title: String,
    pub artist: String,
    pub mood: String,
    #[serde(default)]
    pub root: Option<u8>,
    pub phrases: Vec<SimPhrase>,
    #[serde(default)]
    pub moves: Vec<SimMove>,
}

#[derive(Debug, Deserialize)]
struct Fixture {
    bpm: f64,
    #[serde(rename = "crate")]
    tracks: Vec<SimTrack>,
    #[cfg_attr(not(test), allow(dead_code))]
    timeline: Vec<serde_json::Value>,
}

fn fixture() -> &'static Fixture {
    static F: OnceLock<Fixture> = OnceLock::new();
    F.get_or_init(|| serde_json::from_str(FIXTURE).expect("tests/fixtures/dj-sim.json"))
}

/// The built-in crate.
pub fn crate_tracks() -> &'static [SimTrack] {
    &fixture().tracks
}

/// The set's tempo.
pub fn set_bpm() -> f64 {
    fixture().bpm
}

#[derive(Debug, Clone)]
pub struct PlacedPhrase {
    pub number: u16,
    pub kind: String,
    pub start: u32,
    pub end: u32,
    pub fill_from: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct TrackLayout {
    pub phrases: Vec<PlacedPhrase>,
    pub beats: u32,
    pub mix_at: u32,
}

/// Where a track's phrases fall (`trackLayout` in djlink.ts).
pub fn track_layout(track: &SimTrack) -> TrackLayout {
    let mut phrases = Vec::new();
    let mut start = 1u32;
    for (i, p) in track.phrases.iter().enumerate() {
        let beats = p.beats.max(1);
        let end = start + beats - 1;
        let fill = p.fill.map(|f| f.clamp(1, beats)).unwrap_or(0);
        phrases.push(PlacedPhrase {
            number: i as u16 + 1,
            kind: p.kind.clone(),
            start,
            end,
            fill_from: (fill > 0).then(|| end - fill + 1),
        });
        start = end + 1;
    }
    let beats = start - 1;
    let mix_at = phrases
        .iter()
        .rev()
        .find(|p| p.kind == "outro")
        .map_or(beats.saturating_sub(31).max(1), |p| p.start);
    TrackLayout {
        phrases,
        beats,
        mix_at,
    }
}

/// A player's transport, as Pioneer names its play modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeckMode {
    Empty,
    Cued,
    Playing,
    Paused,
    CuePlaying,
    Ended,
}

impl DeckMode {
    /// The name djlink.ts uses (the drift guard compares them).
    pub fn name(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Cued => "cued",
            Self::Playing => "playing",
            Self::Paused => "paused",
            Self::CuePlaying => "cuePlaying",
            Self::Ended => "ended",
        }
    }
}

#[derive(Debug, Clone)]
struct Deck {
    player: u8,
    track: Option<usize>,
    pos: f64,
    cue_point: f64,
    mode: DeckMode,
    loop_: Option<(f64, f64)>,
    fader: f64,
    started_at: f64,
    loaded_at: f64,
    laps: u32,
    moves_done: Vec<usize>,
    auto_loop_laps: Option<u32>,
    preview_until: Option<f64>,
    previewed: bool,
    prev_beat: u32,
    ticks: u64,
}

impl Deck {
    fn new(player: u8) -> Self {
        Self {
            player,
            track: None,
            pos: 0.0,
            cue_point: 0.0,
            mode: DeckMode::Empty,
            loop_: None,
            fader: 0.0,
            started_at: f64::NEG_INFINITY,
            loaded_at: f64::NEG_INFINITY,
            laps: 0,
            moves_done: Vec::new(),
            auto_loop_laps: None,
            preview_until: None,
            previewed: false,
            prev_beat: 0,
            ticks: 0,
        }
    }
    fn playing(&self) -> bool {
        matches!(self.mode, DeckMode::Playing | DeckMode::CuePlaying)
    }
    fn looping(&self) -> bool {
        self.mode == DeckMode::Playing && self.loop_.is_some()
    }
    fn played(&self) -> bool {
        self.started_at > self.loaded_at
    }
    fn beat(&self, layouts: &[TrackLayout]) -> u32 {
        match self.track {
            Some(t) => (self.pos.floor() as u32 + 1).min(layouts[t].beats),
            None => 0,
        }
    }
}

/// One deck as the gate's operator UI or a test sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct DeckView {
    pub player: u8,
    pub track: Option<usize>,
    pub mode: DeckMode,
    pub beat: u32,
    pub fader: f64,
    pub loop_beats: u32,
    pub on_air: bool,
    pub master: bool,
}

/// A packet for one of the PRO DJ LINK ports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SimPacket {
    /// UDP 50000: device keepalive (0x06).
    Discovery(Vec<u8>),
    /// UDP 50001: beat (0x28) or absolute position (0x0b).
    Beat(Vec<u8>),
    /// UDP 50002: CDJ status (0x0a).
    Status(Vec<u8>),
}

/// What one step produced.
#[derive(Debug, Default)]
pub struct SimOutput {
    pub packets: Vec<SimPacket>,
    /// Track metadata to put in `pioneer_tracks` for a deck (None: clear it),
    /// as a dbserver fetch would after a load.
    pub tracks: Vec<(u8, Option<ProDjLinkTrackInfo>)>,
}

/// How often each player sends status, absolute position and keepalives.
const STATUS_EVERY: f64 = 0.2;
const POSITION_EVERY: f64 = 0.1;
const KEEPALIVE_EVERY: f64 = 1.5;

/// The two players, the mixer and the Auto DJ.
pub struct ProlinkSim {
    tracks: &'static [SimTrack],
    layouts: Vec<TrackLayout>,
    bpm: f64,
    pub auto: bool,
    crossfader: f64,
    master: u8,
    decks: [Deck; 2],
    t: f64,
    clock: f64,
    next_track: usize,
    loaded_dirty: [bool; 2],
    next_status: [f64; 2],
    next_position: [f64; 2],
    next_keepalive: [f64; 2],
    sent_ticks: [u64; 2],
}

impl Default for ProlinkSim {
    fn default() -> Self {
        Self::new()
    }
}

impl ProlinkSim {
    pub fn new() -> Self {
        let tracks = crate_tracks();
        let mut sim = Self {
            tracks,
            layouts: tracks.iter().map(track_layout).collect(),
            bpm: set_bpm(),
            auto: true,
            crossfader: 0.5,
            master: 1,
            decks: [Deck::new(1), Deck::new(2)],
            t: 0.0,
            clock: 0.0,
            next_track: 0,
            loaded_dirty: [false; 2],
            // Deck 2's packets half a period after deck 1's, as two players'
            // independent clocks would be.
            next_status: [0.0, STATUS_EVERY / 2.0],
            next_position: [0.0, POSITION_EVERY / 2.0],
            next_keepalive: [0.0, KEEPALIVE_EVERY / 2.0],
            sent_ticks: [0; 2],
        };
        // The set opens with the first track playing on air and the second
        // ready on the other deck (`reset` in djlink.ts).
        let first = sim.take_next();
        sim.load_deck(0, first);
        sim.decks[0].fader = 1.0;
        sim.decks[0].mode = DeckMode::Playing;
        sim.decks[0].started_at = 0.0;
        let second = sim.take_next();
        sim.load_deck(1, second);
        sim.decks[1].previewed = true;
        sim.step_set(0.0);
        sim.step_set(0.0);
        sim
    }

    /// Seconds since the set started.
    pub fn time(&self) -> f64 {
        self.t
    }

    pub fn crossfader(&self) -> f64 {
        self.crossfader
    }

    pub fn master(&self) -> u8 {
        self.master
    }

    /// The decks now.
    pub fn decks(&self) -> [DeckView; 2] {
        [0, 1].map(|i| {
            let d = &self.decks[i];
            DeckView {
                player: d.player,
                track: d.track,
                mode: d.mode,
                beat: d.beat(&self.layouts),
                fader: d.fader,
                loop_beats: d.loop_.map_or(0, |(s, e)| (e - s) as u32),
                on_air: self.gain(d) > 0.02,
                master: self.master == d.player,
            }
        })
    }

    /// Advance the set `dt` seconds and say what the players sent.
    pub fn step(&mut self, dt: f64) -> SimOutput {
        self.step_set(dt);
        let mut out = SimOutput::default();
        for i in 0..2 {
            if self.loaded_dirty[i] {
                self.loaded_dirty[i] = false;
                out.tracks.push((self.decks[i].player, self.track_info(i)));
            }
        }
        for i in 0..2 {
            if self.t >= self.next_keepalive[i] {
                self.next_keepalive[i] = self.t + KEEPALIVE_EVERY;
                out.packets
                    .push(SimPacket::Discovery(self.keepalive_packet(i)));
            }
            // A beat packet for each beat period played.
            if self.decks[i].playing() && self.decks[i].ticks != self.sent_ticks[i] {
                out.packets.push(SimPacket::Beat(self.beat_packet(i)));
            }
            self.sent_ticks[i] = self.decks[i].ticks;
            if self.t >= self.next_position[i] {
                self.next_position[i] = self.t + POSITION_EVERY;
                if self.decks[i].track.is_some() {
                    out.packets.push(SimPacket::Beat(self.position_packet(i)));
                }
            }
            if self.t >= self.next_status[i] {
                self.next_status[i] = self.t + STATUS_EVERY;
                out.packets.push(SimPacket::Status(self.status_packet(i)));
            }
        }
        out
    }

    /// The set alone (`DjLinkSim.step` less the gate's reading).
    fn step_set(&mut self, dt: f64) {
        let dt = dt.max(0.0);
        self.t += dt;
        let beats = dt * self.bpm / 60.0;
        self.clock += beats;
        for i in 0..2 {
            self.decks[i].prev_beat = self.decks[i].beat(&self.layouts);
            self.advance(i, beats);
        }
        if self.auto {
            self.auto_dj(beats);
        }
    }

    // ---- The CDJ.

    fn advance(&mut self, i: usize, beats: f64) {
        let d = &mut self.decks[i];
        if !d.playing() {
            return;
        }
        let Some(t) = d.track else { return };
        let total = self.layouts[t].beats as f64;
        let mut p = d.pos + beats;
        if p.floor() != d.pos.floor() {
            d.ticks += 1;
        }
        if d.looping()
            && let Some((start, end)) = d.loop_
            && d.pos < end
            && p >= end
        {
            p = start + ((p - end) % (end - start));
            d.laps += 1;
        }
        if p >= total {
            p = total - 1e-6;
            d.mode = DeckMode::Ended;
            d.loop_ = None;
        }
        d.pos = p;
    }

    fn phase(&self) -> f64 {
        self.clock - self.clock.floor()
    }

    fn play_deck(&mut self, i: usize) {
        let phase = self.phase();
        let clock = self.clock;
        let d = &mut self.decks[i];
        if d.track.is_none() {
            return;
        }
        match d.mode {
            DeckMode::Playing => d.mode = DeckMode::Paused,
            DeckMode::CuePlaying => {
                d.mode = DeckMode::Playing;
                d.started_at = clock;
            }
            DeckMode::Ended => {}
            _ => {
                d.pos = d.pos.floor() + phase;
                d.mode = DeckMode::Playing;
                d.started_at = clock;
            }
        }
    }

    fn cue_down(&mut self, i: usize) {
        let phase = self.phase();
        let d = &mut self.decks[i];
        if d.track.is_none() {
            return;
        }
        match d.mode {
            DeckMode::Playing => {
                d.pos = d.cue_point;
                d.loop_ = None;
                d.mode = DeckMode::Cued;
            }
            DeckMode::Cued => {
                d.pos = d.cue_point + phase;
                d.mode = DeckMode::CuePlaying;
            }
            DeckMode::Paused | DeckMode::Ended => {
                d.cue_point = d.pos.round();
                d.pos = d.cue_point;
                d.mode = DeckMode::Cued;
            }
            _ => {}
        }
    }

    fn cue_up(&mut self, i: usize) {
        let d = &mut self.decks[i];
        if d.mode != DeckMode::CuePlaying {
            return;
        }
        d.pos = d.cue_point;
        d.mode = DeckMode::Cued;
    }

    fn set_loop(&mut self, i: usize, beats: u32) {
        let Some(t) = self.decks[i].track else { return };
        let total = self.layouts[t].beats as f64;
        let d = &mut self.decks[i];
        let start = d.pos.floor();
        d.loop_ = Some((start, total.min(start + beats.max(1) as f64)));
        d.laps = 0;
        d.auto_loop_laps = None;
    }

    fn jump_to(&mut self, i: usize, beat: u32) {
        let Some(t) = self.decks[i].track else { return };
        let total = self.layouts[t].beats;
        let d = &mut self.decks[i];
        let b = beat.clamp(1, total) as f64;
        d.pos = b - 1.0 + (d.pos - d.pos.floor());
        d.loop_ = None;
        if d.mode == DeckMode::Ended {
            d.mode = DeckMode::Paused;
        }
    }

    fn load_deck(&mut self, i: usize, track: usize) {
        if track >= self.tracks.len() {
            return;
        }
        let clock = self.clock;
        let d = &mut self.decks[i];
        d.track = Some(track);
        d.pos = 0.0;
        d.cue_point = 0.0;
        d.mode = DeckMode::Cued;
        d.loop_ = None;
        d.laps = 0;
        d.loaded_at = clock;
        d.started_at = f64::NEG_INFINITY;
        d.moves_done.clear();
        d.auto_loop_laps = None;
        d.preview_until = None;
        d.previewed = false;
        self.loaded_dirty[i] = true;
    }

    fn take_next(&mut self) -> usize {
        let n = self.next_track % self.tracks.len();
        self.next_track = n + 1;
        n
    }

    // ---- The mixer.

    fn gain(&self, d: &Deck) -> f64 {
        let x = if d.player == 1 {
            (2.0 * (1.0 - self.crossfader)).min(1.0)
        } else {
            (2.0 * self.crossfader).min(1.0)
        };
        d.fader * x
    }

    // ---- The Auto DJ (`autoDj` in djlink.ts, step for step).

    fn auto_dj(&mut self, beats: f64) {
        let ramp = |d: &mut Deck, target: f64, per_beat: f64| {
            let step = per_beat * beats;
            d.fader = if d.fader < target {
                target.min(d.fader + step)
            } else {
                target.max(d.fader - step)
            };
        };
        let mut m = (self.master - 1) as usize;
        let mut o = 1 - m;

        if !self.decks[m].playing() && self.decks[o].playing() {
            self.master = self.decks[o].player;
            std::mem::swap(&mut m, &mut o);
        }
        if !self.decks[m].playing() && !self.decks[o].playing() {
            let ready = |d: &Deck| d.track.is_some() && d.mode != DeckMode::Ended;
            let d = if ready(&self.decks[m]) {
                m
            } else if ready(&self.decks[o]) {
                o
            } else {
                m
            };
            if !ready(&self.decks[d]) {
                let next = self.take_next();
                self.load_deck(d, next);
            }
            if self.decks[d].mode == DeckMode::CuePlaying {
                self.cue_up(d);
            }
            self.play_deck(d);
            self.decks[d].fader = 1.0;
            self.master = self.decks[d].player;
            if d != m {
                std::mem::swap(&mut m, &mut o);
            }
        }

        let beat = self.decks[m].beat(&self.layouts);
        let prev_beat = self.decks[m].prev_beat;
        let crossed = |at: u32| prev_beat < at && beat >= at;

        if let Some(t) = self.decks[m].track
            && self.decks[m].playing()
            && self.gain(&self.decks[m]) > 0.02
        {
            for (i, mv) in self.tracks[t].moves.iter().enumerate() {
                if self.decks[m].moves_done.contains(&i) || !crossed(mv.at) {
                    continue;
                }
                self.decks[m].moves_done.push(i);
                if let Some(l) = &mv.loop_ {
                    self.set_loop(m, l.beats);
                    self.decks[m].auto_loop_laps = Some(l.laps);
                } else if let Some(to) = mv.jump_to {
                    self.jump_to(m, to);
                }
            }
        }
        for d in &mut self.decks {
            if let (Some((start, end)), Some(laps)) = (d.loop_, d.auto_loop_laps)
                && d.laps >= laps
                && d.pos >= (start + end) / 2.0
            {
                d.loop_ = None;
                d.auto_loop_laps = None;
            }
        }

        {
            let d = &self.decks[o];
            if !d.playing()
                && d.fader < 0.01
                && (d.track.is_none() || d.mode == DeckMode::Ended || d.played())
            {
                let next = self.take_next();
                self.load_deck(o, next);
            }
        }
        if self.decks[o].mode == DeckMode::Cued
            && !self.decks[o].previewed
            && self.clock - self.decks[o].loaded_at >= 8.0
        {
            self.decks[o].previewed = true;
            self.cue_down(o);
            self.decks[o].preview_until = Some(self.clock + 4.0);
        }
        if self.decks[o].mode == DeckMode::CuePlaying
            && let Some(until) = self.decks[o].preview_until
            && self.clock >= until
        {
            self.cue_up(o);
            self.decks[o].preview_until = None;
        }

        if let Some(t) = self.decks[m].track
            && self.decks[m].playing()
            && self.decks[o].mode == DeckMode::Cued
            && self.decks[o].pos == self.decks[o].cue_point
            && beat > prev_beat
            && beat >= self.layouts[t].mix_at
            && (beat - self.layouts[t].mix_at) % 16 == 0
        {
            self.play_deck(o);
        }

        if self.decks[m].playing() {
            ramp(&mut self.decks[m], 1.0, 0.5);
        }
        if self.decks[o].mode == DeckMode::CuePlaying {
            ramp(&mut self.decks[o], 0.0, 1.0 / 4.0);
        } else if self.decks[o].playing() && self.decks[o].started_at > self.decks[m].started_at {
            if self.clock - self.decks[o].started_at >= 8.0 {
                ramp(&mut self.decks[o], 1.0, 1.0 / 8.0);
            }
            if self.decks[o].fader >= 1.0 && self.clock - self.decks[o].started_at >= 16.0 {
                self.master = self.decks[o].player;
            }
        } else if self.decks[o].playing() {
            ramp(&mut self.decks[o], 0.0, 1.0 / 12.0);
            if let Some(t) = self.decks[o].track
                && self.decks[o].fader == 0.0
                && self.layouts[t].beats as f64 - self.decks[o].pos > 33.0
            {
                self.play_deck(o);
            }
        } else {
            ramp(&mut self.decks[o], 0.0, 1.0 / 4.0);
        }
        let x = self.crossfader;
        self.crossfader = if x < 0.5 {
            (x + beats / 8.0).min(0.5)
        } else {
            (x - beats / 8.0).max(0.5)
        };
    }

    // ---- Packets, as the players send them (offsets from rhythm.rs).

    fn header(kind: u8, length: usize) -> Vec<u8> {
        let mut p = vec![0u8; length];
        p[..10].copy_from_slice(MAGIC);
        p[0x0a] = kind;
        p
    }

    fn name_at(p: &mut [u8], offset: usize) {
        for (to, from) in p[offset..offset + 20]
            .iter_mut()
            .zip(SIM_PLAYER_NAME.bytes())
        {
            *to = from;
        }
    }

    fn play_mode(d: &Deck) -> u8 {
        if d.looping() {
            return 0x04;
        }
        match d.mode {
            DeckMode::Empty => 0x00,
            DeckMode::Playing => 0x03,
            DeckMode::Paused => 0x05,
            DeckMode::Cued => 0x06,
            DeckMode::CuePlaying => 0x07,
            DeckMode::Ended => 0x11,
        }
    }

    fn keepalive_packet(&self, i: usize) -> Vec<u8> {
        let player = self.decks[i].player;
        let mut p = Self::header(0x06, 0x36);
        Self::name_at(&mut p, 0x0c);
        p[0x20] = 1;
        p[0x21] = 2;
        p[0x23] = 0x36;
        p[0x24] = player;
        p[0x25] = 1;
        p[0x26..0x2c].copy_from_slice(&[0x02, 0x51, 0x53, 0x00, 0x00, player]);
        p[0x2c..0x30].copy_from_slice(&[127, 0, 0, player]);
        p[0x34] = 1;
        p
    }

    fn status_packet(&self, i: usize) -> Vec<u8> {
        let d = &self.decks[i];
        let mut p = Self::header(0x0a, 0xd4);
        Self::name_at(&mut p, 0x0b);
        p[0x21] = d.player;
        p[0x24] = d.player;
        if let Some(t) = d.track {
            p[0x28] = d.player;
            p[0x29] = 3; // USB
            p[0x2a] = 1; // rekordbox
            p[0x2c..0x30].copy_from_slice(&(SIM_REKORDBOX_ID_BASE + t as u32).to_be_bytes());
            p[0x32..0x34].copy_from_slice(&(t as u16 + 1).to_be_bytes());
        }
        p[0x7b] = Self::play_mode(d);
        let master = self.master == d.player;
        let on_air = self.gain(d) > 0.02;
        p[0x89] = u8::from(d.playing()) * 0x40
            | u8::from(master) * 0x20
            | 0x10 // sync: every deck is beatmatched to the set
            | u8::from(on_air) * 0x08;
        p[0x8d..0x90].copy_from_slice(&[0x10, 0x00, 0x00]);
        p[0x92..0x94].copy_from_slice(&((self.bpm * 100.0).round() as u16).to_be_bytes());
        let beat = d.beat(&self.layouts);
        let beat_raw = if d.track.is_some() { beat } else { u32::MAX };
        p[0xa0..0xa4].copy_from_slice(&beat_raw.to_be_bytes());
        p[0xa4..0xa6].copy_from_slice(&u16::MAX.to_be_bytes());
        p[0xa6] = if beat > 0 {
            ((beat - 1) % 4 + 1) as u8
        } else {
            0
        };
        p
    }

    fn beat_packet(&self, i: usize) -> Vec<u8> {
        let d = &self.decks[i];
        let beat = d.beat(&self.layouts);
        let mut p = Self::header(0x28, 0x60);
        Self::name_at(&mut p, 0x0b);
        p[0x21] = d.player;
        let period_ms = (60_000.0 / self.bpm).round() as u32;
        let bar_beat = if beat > 0 { (beat - 1) % 4 + 1 } else { 1 };
        // Next beat, 2nd beat, next bar, 4th beat, 2nd bar, 8th beat.
        let to_bar = (5 - bar_beat) * period_ms;
        for (k, ms) in [
            period_ms,
            2 * period_ms,
            to_bar,
            4 * period_ms,
            to_bar + 4 * period_ms,
            8 * period_ms,
        ]
        .into_iter()
        .enumerate()
        {
            p[0x24 + 4 * k..0x28 + 4 * k].copy_from_slice(&ms.to_be_bytes());
        }
        p[0x55..0x58].copy_from_slice(&[0x10, 0x00, 0x00]);
        p[0x5a..0x5c].copy_from_slice(&((self.bpm * 100.0).round() as u16).to_be_bytes());
        p[0x5c] = bar_beat as u8;
        p
    }

    fn position_packet(&self, i: usize) -> Vec<u8> {
        let d = &self.decks[i];
        let beats = d.track.map_or(0, |t| self.layouts[t].beats) as f64;
        let mut p = Self::header(0x0b, 0x32);
        Self::name_at(&mut p, 0x0b);
        p[0x21] = d.player;
        let spb = 60.0 / self.bpm;
        p[0x24..0x28].copy_from_slice(&((beats * spb).round() as u32).to_be_bytes());
        p[0x28..0x2c].copy_from_slice(&((d.pos * spb * 1000.0) as u32).to_be_bytes());
        p[0x2c..0x30].copy_from_slice(&0i32.to_be_bytes());
        p[0x30..0x32].copy_from_slice(&((self.bpm * 10.0).round() as u16).to_be_bytes());
        p
    }

    // ---- What a dbserver fetch would return for a loaded track.

    fn track_info(&self, i: usize) -> Option<ProDjLinkTrackInfo> {
        let d = &self.decks[i];
        let t = d.track?;
        let track = &self.tracks[t];
        let layout = &self.layouts[t];
        let spb = 60.0 / self.bpm;
        let ms = |beat: u32| ((beat.saturating_sub(1)) as f64 * spb * 1000.0).round() as u32;
        let phrases = layout
            .phrases
            .iter()
            .map(|p| ProDjLinkPhraseInfo {
                phrase_number: p.number,
                start_beat: p.start,
                end_beat: p.end,
                start_ms: ms(p.start),
                end_ms: ms(p.end + 1),
                kind: rekordbox_kind(&p.kind).to_owned(),
                raw_kind: raw_kind(&track.mood, &p.kind),
                fill_in: p.fill_from.is_some(),
                fill_in_beat: p.fill_from,
            })
            .collect();
        let beat_grid = (1..=layout.beats)
            .map(|b| ProDjLinkBeatGridEntry {
                beat_number: b,
                beat_in_bar: ((b - 1) % 4 + 1) as u8,
                bpm: self.bpm,
                time_ms: ms(b),
            })
            .collect();
        let detail = waveform(layout, 1200);
        let preview = waveform(layout, 400);
        Some(ProDjLinkTrackInfo {
            deck: d.player,
            source_player: d.player,
            source_slot: "usb".into(),
            rekordbox_id: SIM_REKORDBOX_ID_BASE + t as u32,
            loading: false,
            error: String::new(),
            title: track.title.clone(),
            artist: track.artist.clone(),
            album: "Simulated set".into(),
            genre: "House".into(),
            key: key_name(track.root.unwrap_or(45)),
            label: String::new(),
            comment: "Simulated PRO DJ LINK (no CDJs)".into(),
            duration_seconds: (layout.beats as f64 * spb).round() as u32,
            bpm: self.bpm,
            beat_grid,
            phrase_analysis: Some(ProDjLinkPhraseAnalysis {
                mood: track.mood.clone(),
                bank: "default".into(),
                end_beat: layout.beats,
                phrases,
            }),
            waveform_preview: preview,
            waveform_detail: detail,
            ..Default::default()
        })
    }
}

/// The kind as `prolink_analysis::phrase_kind` names it (verses numbered).
fn rekordbox_kind(kind: &str) -> &str {
    match kind {
        "verse" => "verse1",
        other => other,
    }
}

/// rekordbox's raw phrase code for a kind in a mood.
fn raw_kind(mood: &str, kind: &str) -> u16 {
    match (mood, kind) {
        ("high", "intro") => 1,
        ("high", "up") => 2,
        ("high", "down") => 3,
        ("high", "chorus") => 5,
        ("high", "outro") => 6,
        (_, "intro") => 1,
        (_, "verse") => 2,
        (_, "bridge") => 8,
        (_, "chorus") => 9,
        (_, "outro") => 10,
        _ => 0,
    }
}

/// A minor key's name from its root (MIDI note).
fn key_name(root: u8) -> String {
    const NAMES: [&str; 12] = [
        "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
    ];
    format!("{}m", NAMES[(root % 12) as usize])
}

/// How loud each kind of phrase is, start → end (the web simulator's
/// `trackSound` levels, without its texture).
fn phrase_level(kind: &str, progress: f64) -> f64 {
    let (a, b) = match kind {
        "intro" => (0.5, 0.6),
        "up" => (0.6, 0.88),
        "chorus" => (0.95, 0.95),
        "down" => (0.42, 0.45),
        "outro" => (0.6, 0.35),
        "verse" => (0.72, 0.75),
        "bridge" => (0.5, 0.6),
        _ => (0.5, 0.5),
    };
    a + (b - a) * progress
}

/// A rekordbox-style waveform of `samples` heights 0..255 over the track.
fn waveform(layout: &TrackLayout, samples: usize) -> Vec<u8> {
    (0..samples)
        .map(|s| {
            let pos = (s as f64 + 0.5) / samples as f64 * layout.beats as f64;
            let beat = pos.floor() as u32 + 1;
            let phase = pos - pos.floor();
            let Some(p) = layout
                .phrases
                .iter()
                .find(|p| beat >= p.start && beat <= p.end)
            else {
                return 0;
            };
            let length = (p.end - p.start + 1) as f64;
            let progress = ((beat - p.start) as f64 + phase) / length;
            let kick = if p.kind == "down" {
                0.0
            } else {
                (-phase * 7.0).exp()
            };
            let level = phrase_level(&p.kind, progress) * (0.82 + 0.18 * kick);
            (level.clamp(0.0, 1.0) * 255.0).round() as u8
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_crate_loads_and_every_track_mixes_out_of_an_outro() {
        assert!(crate_tracks().len() >= 4);
        for t in crate_tracks() {
            let l = track_layout(t);
            assert_eq!(l.phrases.last().unwrap().kind, "outro");
            assert_eq!(l.mix_at, l.phrases.last().unwrap().start);
        }
    }

    /// The drift guard: the Auto DJ here plays the set exactly as the web
    /// simulator does (its timeline is in tests/fixtures/dj-sim.json, which
    /// djlink.fixture.test.ts writes).
    #[test]
    fn auto_dj_matches_the_web_simulators_timeline() {
        let mut sim = ProlinkSim::new();
        let mut frame = 0u64;
        for row in &fixture().timeline {
            let row = row.as_array().expect("row");
            let at = row[0].as_u64().unwrap();
            while frame < at {
                sim.step_set(1.0 / 60.0);
                frame += 1;
            }
            let decks = sim.decks();
            let r6 = |v: f64| (v * 1e6).round() / 1e6;
            assert_eq!(
                u64::from(sim.master()),
                row[1].as_u64().unwrap(),
                "master at frame {at}"
            );
            assert_eq!(
                r6(sim.crossfader()),
                row[2].as_f64().unwrap(),
                "crossfader at frame {at}"
            );
            for (i, d) in decks.iter().enumerate() {
                let want = row[3 + i].as_array().unwrap();
                let got = (
                    d.track.map(|t| t as u64),
                    d.mode.name(),
                    u64::from(d.beat),
                    r6(d.fader),
                    u64::from(d.loop_beats),
                );
                let want = (
                    want[0].as_u64(),
                    want[1].as_str().unwrap(),
                    want[2].as_u64().unwrap(),
                    want[3].as_f64().unwrap(),
                    want[4].as_u64().unwrap(),
                );
                assert_eq!(got, want, "deck {} at frame {at}", i + 1);
            }
        }
    }

    #[test]
    fn status_packets_carry_the_transport_the_gate_reads() {
        let mut sim = ProlinkSim::new();
        let out = sim.step(0.05);
        let status: Vec<_> = out
            .packets
            .iter()
            .filter_map(|p| match p {
                SimPacket::Status(s) => Some(s.clone()),
                _ => None,
            })
            .collect();
        let d1 = status.iter().find(|p| p[0x21] == 1).expect("deck 1 status");
        assert_eq!(&d1[..10], MAGIC);
        assert_eq!(d1[0x0a], 0x0a);
        assert_eq!(d1[0x7b], 0x03, "playing");
        assert_eq!(d1[0x89] & 0x28, 0x28, "on air and master");
        assert_eq!(u32::from_be_bytes(d1[0xa0..0xa4].try_into().unwrap()), 1);
        assert_eq!(&d1[0x8d..0x90], &[0x10, 0, 0], "pitch 0 %");
        assert_eq!(u16::from_be_bytes([d1[0x92], d1[0x93]]), 12200);
        // Both decks' tracks come with their analysis on the first step.
        assert_eq!(out.tracks.len(), 2);
        let (deck, info) = &out.tracks[0];
        let info = info.as_ref().unwrap();
        assert_eq!(*deck, 1);
        assert_eq!(info.title, crate_tracks()[0].title);
        assert_eq!(info.waveform_detail.len(), 1200);
        let phrases = &info.phrase_analysis.as_ref().unwrap().phrases;
        assert_eq!(phrases[0].kind, "intro");
        assert_eq!(phrases[0].start_beat, 1);
    }

    #[test]
    fn the_gate_reads_simulated_tracks_phrases_as_it_reads_rekordbox() {
        use crate::prolink_analysis::{active_phrase, phrase_kind_code};
        let mut sim = ProlinkSim::new();
        let out = sim.step(0.0);
        // Deck 2 holds the second track, a mid-mood one with verses.
        let info = out.tracks[1].1.clone().unwrap();
        let analysis = info.phrase_analysis.unwrap();
        let layout = track_layout(&crate_tracks()[1]);
        let verse = layout.phrases.iter().find(|p| p.kind == "verse").unwrap();
        let at = active_phrase(&analysis, u64::from(verse.start), 0.5).unwrap();
        assert_eq!(phrase_kind_code(&at.kind), 6.0, "verse");
        let filled = layout
            .phrases
            .iter()
            .find(|p| p.fill_from.is_some())
            .unwrap();
        let fill = filled.fill_from.unwrap();
        assert!(
            !active_phrase(&analysis, u64::from(fill - 1), 0.0)
                .unwrap()
                .fill_in_active
        );
        assert!(
            active_phrase(&analysis, u64::from(fill), 0.0)
                .unwrap()
                .fill_in_active
        );
        assert_eq!(
            info.duration_seconds,
            (f64::from(layout.beats) * 60.0 / 122.0).round() as u32
        );
        assert!(info.waveform_detail.iter().any(|&h| h > 200));
    }

    #[test]
    fn a_beat_packet_each_beat_while_playing() {
        let mut sim = ProlinkSim::new();
        let mut beats = Vec::new();
        for _ in 0..(4.0 * 60.0 / 122.0 / 0.01) as usize + 2 {
            for p in sim.step(0.01).packets {
                if let SimPacket::Beat(b) = p
                    && b[0x0a] == 0x28
                    && b[0x21] == 1
                {
                    beats.push(b[0x5c]);
                }
            }
        }
        assert_eq!(beats, vec![2, 3, 4, 1]);
    }
}
