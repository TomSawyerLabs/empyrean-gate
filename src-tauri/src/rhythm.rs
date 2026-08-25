//! External musical-clock inputs. Audio analysis owns energy/spectrum; this module
//! owns authoritative timing signals that can be overlaid on every layer.

use crate::config::RhythmSource;
use crate::protocol::{ProDjLinkCueInfo, ProDjLinkTrackInfo};
use crate::state::SharedState;
use crossbeam_channel::{Receiver, Sender, bounded};
use midir::{Ignore, MidiInput, MidiInputConnection};
use prodjlink_rs::data::metadata::build_metadata_request_args;
use prodjlink_rs::dbserver::client::Client as DbClient;
use prodjlink_rs::dbserver::field::Field as DbField;
use prodjlink_rs::dbserver::message::MessageType as DbMessageType;
use prodjlink_rs::{
    CueList, CueType, DataReference, DeviceNumber, TrackMetadata, TrackSourceSlot, WaveformDetail,
    WaveformPreview, WaveformStyle,
};
use socket2::{Domain, Protocol, Socket, Type};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const CLOCKS_PER_BEAT: f64 = 24.0;
const CLOCK_TIMEOUT: Duration = Duration::from_millis(500);
const RESCAN_EVERY: Duration = Duration::from_secs(2);
const PRO_DJ_LINK_MAGIC: &[u8; 10] = b"Qspt1WmJOL";
const PRO_DJ_LINK_BEAT_PORT: u16 = 50_001;
const PRO_DJ_LINK_STATUS_PORT: u16 = 50_002;
const MAX_DETAIL_SAMPLES: usize = 1_200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MetadataRequest {
    deck: u8,
    source_player: u8,
    source_ip: Ipv4Addr,
    source_slot: u8,
    track_id: u32,
    query_player: u8,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ClockSnapshot {
    pub usable: bool,
    pub running: bool,
    pub bpm: f32,
    pub beat_phase: f32,
    pub beat_count: u64,
    pub age_ms: f32,
}

/// MIDI callback state. Kept independent of the MIDI connection so the engine can
/// read a tiny snapshot without ever touching an OS MIDI API.
#[derive(Debug)]
pub struct MidiClockState {
    ticks: u64,
    bpm: f32,
    running: bool,
    transport_seen: bool,
    last_tick: Option<Instant>,
}

impl Default for MidiClockState {
    fn default() -> Self {
        Self {
            ticks: 0,
            bpm: 0.0,
            running: false,
            transport_seen: false,
            last_tick: None,
        }
    }
}

impl MidiClockState {
    fn message_at(&mut self, message: &[u8], now: Instant) {
        let Some(status) = message.first().copied() else {
            return;
        };
        match status {
            // Timing Clock: 24 pulses per quarter note.
            0xf8 => {
                let continuing = self.last_tick.is_some();
                if let Some(last) = self.last_tick {
                    let dt = now.duration_since(last).as_secs_f32();
                    let instant_bpm = 60.0 / (dt * CLOCKS_PER_BEAT as f32);
                    if (20.0..=400.0).contains(&instant_bpm) {
                        self.bpm = if self.bpm <= 0.0 {
                            instant_bpm
                        } else {
                            // Enough smoothing to reject USB scheduling jitter while
                            // still following a DJ tempo bend promptly.
                            self.bpm * 0.85 + instant_bpm * 0.15
                        };
                    }
                }
                self.last_tick = Some(now);
                // The first pulse after Start is the downbeat (tick zero), not
                // tick one. Subsequent pulses advance the 24-PPQN position.
                if continuing {
                    self.ticks = self.ticks.wrapping_add(1);
                }
                // Many clock senders omit transport messages. In that common case,
                // clock presence itself means running. An explicit Stop wins.
                if !self.transport_seen {
                    self.running = true;
                }
            }
            // Start / Continue / Stop.
            0xfa => {
                self.transport_seen = true;
                self.running = true;
                self.ticks = 0;
                self.last_tick = None;
            }
            0xfb => {
                self.transport_seen = true;
                self.running = true;
            }
            0xfc => {
                self.transport_seen = true;
                self.running = false;
            }
            // Song Position Pointer is counted in MIDI beats (six clocks).
            0xf2 if message.len() >= 3 => {
                let position = u16::from(message[1] & 0x7f) | (u16::from(message[2] & 0x7f) << 7);
                self.ticks = u64::from(position) * 6;
            }
            _ => {}
        }
    }

    pub fn snapshot(&self, now: Instant, latency_ms: f32) -> ClockSnapshot {
        let Some(last) = self.last_tick else {
            return ClockSnapshot::default();
        };
        let age = now.duration_since(last);
        let usable = age <= CLOCK_TIMEOUT && self.bpm > 0.0 && self.running;
        let offset_beats =
            (age.as_secs_f64() - f64::from(latency_ms) / 1000.0) * f64::from(self.bpm) / 60.0;
        let total_beats = self.ticks as f64 / CLOCKS_PER_BEAT + offset_beats;
        ClockSnapshot {
            usable,
            running: self.running,
            bpm: self.bpm,
            beat_phase: total_beats.rem_euclid(1.0) as f32,
            beat_count: total_beats.max(0.0).floor() as u64,
            age_ms: age.as_secs_f32() * 1000.0,
        }
    }

    fn disconnect(&mut self) {
        self.running = false;
        self.last_tick = None;
        self.bpm = 0.0;
        self.ticks = 0;
    }
}

#[derive(Debug, Clone)]
pub struct PioneerDevice {
    pub number: u8,
    pub name: String,
    pub tempo_master: bool,
    pub playing: bool,
    pub cued: bool,
    pub on_air: bool,
    pub looping: bool,
    pub beat_number: u64,
}

/// Estimate musical energy without an audio capture path. PRO DJ LINK does not
/// publish mixer meters or PCM, but rekordbox's analyzed waveform plus the
/// deck's track-relative beat number gives us a useful, deterministic level.
/// When metadata is unavailable, a conservative beat-shaped playing level keeps
/// LINK-native shows alive rather than silently blacking out.
pub fn pioneer_energy(
    devices: &[PioneerDevice],
    tracks: &HashMap<u8, ProDjLinkTrackInfo>,
    followed_player: u8,
    beat_phase: f32,
) -> f32 {
    let mut candidates: Vec<&PioneerDevice> = devices
        .iter()
        .filter(|deck| {
            deck.playing
                && if (1..32).contains(&followed_player) {
                    deck.number == followed_player
                } else {
                    deck.on_air || deck.tempo_master
                }
        })
        .collect();
    // Some all-in-one/mixer paths omit on-air flags. A playing deck is a safer
    // fallback than zero energy; if two play, max() below follows the stronger
    // analyzed waveform without pretending we know their fader positions.
    if candidates.is_empty() {
        candidates.extend(devices.iter().filter(|deck| deck.playing));
    }
    if candidates.is_empty() {
        return 0.0;
    }

    let phase = beat_phase.rem_euclid(1.0);
    candidates
        .into_iter()
        .map(|deck| {
            tracks
                .get(&deck.number)
                .and_then(|track| waveform_level(track, deck.beat_number, phase))
                // No metadata server / unanalyzed source: transport still gives
                // a musical signal, though not a claim about actual loudness.
                .unwrap_or_else(|| pioneer_transport_energy(phase))
        })
        .fold(0.0, f32::max)
        .clamp(0.0, 1.0)
}

/// Beat-only PRO DJ LINK sources do not expose player status or rekordbox
/// metadata. A received clock still proves that music is advancing, so provide
/// a conservative musical envelope instead of reporting silence.
pub fn pioneer_transport_energy(beat_phase: f32) -> f32 {
    let phase = beat_phase.rem_euclid(1.0);
    0.46 + 0.24 * (-phase * 7.0).exp()
}

fn waveform_level(track: &ProDjLinkTrackInfo, beat_number: u64, beat_phase: f32) -> Option<f32> {
    let samples = if track.waveform_detail.is_empty() {
        &track.waveform_preview
    } else {
        &track.waveform_detail
    };
    if samples.is_empty() || track.duration_seconds == 0 || track.bpm <= 0.0 {
        return None;
    }
    let beats = beat_number.saturating_sub(1) as f64 + f64::from(beat_phase);
    let seconds = beats * 60.0 / track.bpm;
    let progress = (seconds / f64::from(track.duration_seconds)).clamp(0.0, 0.999_999);
    let center = (progress * samples.len() as f64) as usize;
    let start = center.saturating_sub(2);
    let end = (center + 3).min(samples.len());
    let mean = samples[start..end]
        .iter()
        .map(|sample| f32::from(*sample) / 255.0)
        .sum::<f32>()
        / (end - start).max(1) as f32;
    // Waveform height is peak-like and visually compressed; sqrt restores
    // useful dynamics at the quiet end without turning silence into a floor.
    Some(mean.sqrt())
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PioneerVisualSnapshot {
    pub active: bool,
    pub player: u8,
    pub playing: bool,
    pub on_air: bool,
    pub deck_1_on_air: bool,
    pub deck_2_on_air: bool,
    pub looping: bool,
    pub beat_in_bar: u8,
}

#[derive(Debug)]
struct PioneerDeckState {
    name: String,
    seen: Instant,
    playing: bool,
    cued: bool,
    cue_playing: bool,
    on_air: bool,
    looping: bool,
    beat_number: Option<u64>,
    last_beat_in_bar: u8,
    last_beat_packet: Option<Instant>,
    last_loop_wrap: Option<Instant>,
    last_jump: Option<Instant>,
    pending_jump: Option<Instant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PioneerVisualEvent {
    PlayStarted(u8),
    CueStarted(u8),
    CuePlayStarted(u8),
    CueEnded(u8),
    OnAirChanged(u8, bool),
    LoopStarted(u8),
    LoopWrap(u8),
    LoopEnded(u8),
    Jump(u8),
}

/// Receive-only PRO DJ LINK clock state. We deliberately do not announce a
/// virtual CDJ, claim a device number, or send sync/master commands.
#[derive(Debug, Default)]
pub struct PioneerClockState {
    bpm: f32,
    beat_count: u64,
    last_beat: Option<Instant>,
    player: u8,
    player_name: String,
    master_player: Option<u8>,
    on_air_observed: bool,
    decks: HashMap<u8, PioneerDeckState>,
    beat_numbers: HashMap<u8, u64>,
    listen_error: String,
}

// Beat packets can announce a position discontinuity just before the slower
// deck-status stream reports that a loop was engaged. Hold only that ambiguous
// beat-only inference long enough for status to distinguish Loop from Hot Cue.
const PIONEER_JUMP_STATUS_GRACE: Duration = Duration::from_millis(250);

impl PioneerClockState {
    fn has_fresh_device(&self, number: u8, now: Instant) -> bool {
        self.decks
            .get(&number)
            .is_some_and(|deck| now.duration_since(deck.seen) < Duration::from_secs(10))
    }

    pub fn snapshot(&self, now: Instant, latency_ms: f32) -> ClockSnapshot {
        let Some(last) = self.last_beat else {
            return ClockSnapshot::default();
        };
        let age = now.duration_since(last);
        // Beat packets arrive once per beat, so the timeout must scale for slow
        // music. Two and a half periods tolerates a lost UDP packet without
        // abandoning the master deck during a mix.
        let timeout = Duration::from_secs_f32((150.0 / self.bpm.max(20.0)).clamp(0.75, 4.0));
        let usable = age <= timeout && self.bpm > 0.0;
        let offset_beats =
            (age.as_secs_f64() - f64::from(latency_ms) / 1000.0) * f64::from(self.bpm) / 60.0;
        let total_beats = self.beat_count as f64 + offset_beats;
        ClockSnapshot {
            usable,
            running: usable,
            bpm: self.bpm,
            beat_phase: total_beats.rem_euclid(1.0) as f32,
            beat_count: total_beats.max(0.0).floor() as u64,
            age_ms: age.as_secs_f32() * 1000.0,
        }
    }

    pub fn player_label(&self) -> String {
        if self.player == 0 {
            String::new()
        } else if self.player >= 32 && self.player_name.is_empty() {
            format!("mixer {} master", self.player)
        } else if self.player >= 32 {
            format!("{} · mixer master", self.player_name)
        } else if self.player_name.is_empty() {
            format!("player {}", self.player)
        } else {
            format!("{} · player {}", self.player_name, self.player)
        }
    }

    pub fn devices(&self, now: Instant) -> Vec<PioneerDevice> {
        let mut out: Vec<_> = self
            .decks
            .iter()
            .filter(|(number, deck)| {
                **number < 32 && now.duration_since(deck.seen) < Duration::from_secs(10)
            })
            .map(|(number, deck)| PioneerDevice {
                number: *number,
                name: deck.name.clone(),
                tempo_master: self.master_player == Some(*number),
                playing: deck.playing,
                cued: deck.cued,
                on_air: deck.on_air,
                looping: deck.looping,
                beat_number: deck.beat_number.unwrap_or(0),
            })
            .collect();
        out.sort_by_key(|d| d.number);
        out
    }

    pub fn visual_snapshot(&self, now: Instant) -> PioneerVisualSnapshot {
        let fresh = |number| {
            self.decks
                .get(&number)
                .filter(|deck| now.duration_since(deck.seen) < Duration::from_secs(2))
        };
        let deck_1 = fresh(1);
        let deck_2 = fresh(2);
        let selected = fresh(self.player);
        let fresh_status = deck_1.is_some() || deck_2.is_some();
        let (deck_1_on_air, deck_2_on_air) = if self.on_air_observed {
            (
                deck_1.is_some_and(|deck| deck.on_air),
                deck_2.is_some_and(|deck| deck.on_air),
            )
        } else {
            // The XDJ-XZ-over-rekordbox path can omit mixer on-air flags. In
            // that mode, use the currently followed/tempo-master deck as the
            // directional visual focus instead of dimming the whole Gate.
            (self.player == 1, self.player == 2)
        };
        PioneerVisualSnapshot {
            active: fresh_status && (self.on_air_observed || matches!(self.player, 1 | 2)),
            player: self.player,
            playing: selected.is_some_and(|deck| deck.playing),
            on_air: selected.is_some_and(|deck| deck.on_air),
            deck_1_on_air,
            deck_2_on_air,
            looping: deck_1.is_some_and(|deck| deck.looping)
                || deck_2.is_some_and(|deck| deck.looping),
            beat_in_bar: selected.map_or(0, |deck| deck.last_beat_in_bar),
        }
    }

    pub fn listen_error(&self) -> &str {
        &self.listen_error
    }

    fn set_listen_error(&mut self, error: String) {
        self.listen_error = error;
    }

    fn disconnect(&mut self) {
        self.bpm = 0.0;
        self.last_beat = None;
        self.player = 0;
        self.player_name.clear();
        self.master_player = None;
        self.listen_error.clear();
    }

    fn receive_status(&mut self, packet: &[u8], now: Instant) -> Vec<PioneerVisualEvent> {
        if valid_link_packet(packet, 0x29) && packet.len() >= 0x38 {
            // A DJM or the mixer side of an all-in-one can own tempo master.
            // Its beat packets then drive global Gate timing while CDJ status
            // continues to generate independent deck-local visual events.
            let mixer = packet[0x21];
            let master = packet[0x27] & 0x20 != 0;
            if master {
                self.master_player = Some(mixer);
            } else if self.master_player == Some(mixer) {
                self.master_player = None;
            }
            return Vec::new();
        }
        if !valid_link_packet(packet, 0x0a) || packet.len() < 0xa7 {
            return Vec::new();
        }
        let player = packet[0x21];
        let name = link_name(packet);
        let flags = packet[0x89];
        let on_air = flags & 0x08 != 0;
        let play_mode = packet[0x7b];
        let playing = matches!(play_mode, 0x03 | 0x04 | 0x07 | 0x08 | 0x09 | 0x12);
        let cued = matches!(play_mode, 0x06 | 0x07 | 0x08);
        let cue_playing = matches!(play_mode, 0x07 | 0x08);
        let looping = matches!(play_mode, 0x04 | 0x12);
        self.on_air_observed |= on_air;
        if flags & 0x20 != 0 {
            self.master_player = Some(player);
        } else if self.master_player == Some(player) {
            self.master_player = None;
        }
        let raw_beat = u32::from_be_bytes(packet[0xa0..0xa4].try_into().unwrap());
        let beat_number = (raw_beat != u32::MAX).then_some(u64::from(raw_beat));
        if let Some(number) = beat_number {
            self.beat_numbers.insert(player, number);
        }

        let Some(deck) = self.decks.get_mut(&player) else {
            self.decks.insert(
                player,
                PioneerDeckState {
                    name,
                    seen: now,
                    playing,
                    cued,
                    cue_playing,
                    on_air,
                    looping,
                    beat_number,
                    last_beat_in_bar: 0,
                    last_beat_packet: None,
                    last_loop_wrap: None,
                    last_jump: None,
                    pending_jump: None,
                },
            );
            return Vec::new();
        };

        let mut events = Vec::new();
        if !deck.playing && playing {
            events.push(PioneerVisualEvent::PlayStarted(player));
        }
        if !deck.cued && cued {
            events.push(PioneerVisualEvent::CueStarted(player));
        }
        if !deck.cue_playing && cue_playing {
            events.push(PioneerVisualEvent::CuePlayStarted(player));
        }
        if deck.cued && !cued {
            events.push(PioneerVisualEvent::CueEnded(player));
        }
        if deck.on_air != on_air {
            events.push(PioneerVisualEvent::OnAirChanged(player, on_air));
        }
        if !deck.looping && looping {
            deck.pending_jump = None;
            events.push(PioneerVisualEvent::LoopStarted(player));
        } else if deck.looping && !looping {
            deck.pending_jump = None;
            events.push(PioneerVisualEvent::LoopEnded(player));
        }
        if deck.playing
            && playing
            && let (Some(previous), Some(current)) = (deck.beat_number, beat_number)
            && previous > 0
            && current > 0
        {
            // The position commonly jumps backward in the same status packet
            // that first announces loop mode. LoopStarted already represents
            // that button press; reserve LoopWrap for later laps.
            if deck.looping && looping && current < previous {
                let cooled_down = deck
                    .last_loop_wrap
                    .is_none_or(|last| now.duration_since(last) > Duration::from_millis(350));
                if cooled_down {
                    deck.pending_jump = None;
                    events.push(PioneerVisualEvent::LoopWrap(player));
                    deck.last_loop_wrap = Some(now);
                }
            } else if !looping
                && (current.saturating_add(1) < previous || current > previous.saturating_add(8))
            {
                // The basic status stream does not name the pressed Hot Cue. A
                // discontinuity in the analyzed beat counter is nevertheless a
                // reliable first-version signal for Hot Cue and seek jumps.
                deck.pending_jump = None;
                deck.last_jump = Some(now);
                events.push(PioneerVisualEvent::Jump(player));
            }
        }

        deck.name = name;
        deck.seen = now;
        deck.playing = playing;
        deck.cued = cued;
        deck.cue_playing = cue_playing;
        deck.on_air = on_air;
        deck.looping = looping;
        deck.beat_number = beat_number;
        events
    }

    fn receive_beat(
        &mut self,
        packet: &[u8],
        configured_player: u8,
        now: Instant,
    ) -> Option<PioneerVisualEvent> {
        let Some(beat) = parse_link_beat(packet) else {
            return None;
        };
        // Mixer beat packets (normally device 33+) represent the master mix,
        // and are a stronger auto-selection signal than whichever deck packet
        // happened to arrive first. An explicit player setting still wins.
        if configured_player == 0 && beat.player >= 32 {
            self.master_player = Some(beat.player);
        } else if configured_player == 0
            && self.master_player.is_some_and(|player| player >= 32)
            && self
                .last_beat
                .is_some_and(|last| now.duration_since(last) > Duration::from_millis(1200))
        {
            // If the mixer stream disappears, allow healthy deck beats to take
            // over instead of leaving the global clock stalled indefinitely.
            self.master_player = None;
        }
        let deck = self.decks.entry(beat.player).or_insert(PioneerDeckState {
            name: beat.name.clone(),
            seen: now,
            playing: true,
            cued: false,
            cue_playing: false,
            on_air: false,
            looping: false,
            beat_number: None,
            last_beat_in_bar: 0,
            last_beat_packet: None,
            last_loop_wrap: None,
            last_jump: None,
            pending_jump: None,
        });
        deck.name = beat.name.clone();
        deck.seen = now;
        let wanted = if configured_player > 0 {
            Some(configured_player)
        } else {
            self.master_player
        };
        if wanted.is_some_and(|player| player != beat.player) {
            return None;
        }
        // Without visible master status, stay on the current deck while its beats
        // remain healthy instead of flip-flopping during a two-deck crossfade.
        if wanted.is_none()
            && self.player != 0
            && self.player != beat.player
            && self
                .last_beat
                .is_some_and(|last| now.duration_since(last) < Duration::from_millis(1200))
        {
            return None;
        }
        let period = Duration::from_secs_f32(60.0 / beat.bpm.max(20.0));
        let since_last = deck.last_beat_packet.map(|last| now.duration_since(last));
        // Advance the expectation by the number of elapsed beat periods, not
        // merely one packet. UDP loss otherwise looks exactly like a Hot Cue:
        // e.g. seeing bar beats 2 then 4 one second apart at 120 BPM is normal
        // progression with beat 3 missing, not a seek.
        let elapsed_beats = since_last
            .map(|elapsed| {
                (elapsed.as_secs_f32() / period.as_secs_f32())
                    .round()
                    .clamp(1.0, 16.0) as u8
            })
            .unwrap_or(1);
        let expected_bar_beat = if (1..=4).contains(&deck.last_beat_in_bar) {
            ((deck.last_beat_in_bar - 1 + elapsed_beats) % 4) + 1
        } else {
            0
        };
        let early = deck
            .last_beat_packet
            .is_some_and(|last| now.duration_since(last) < period.mul_f32(0.45));
        let recent = since_last.is_some_and(|elapsed| elapsed < period.mul_f32(4.5));
        let bar_discontinuity = expected_bar_beat != 0
            && (1..=4).contains(&beat.beat_within_bar)
            && beat.beat_within_bar != expected_bar_beat;
        let event_cooled_down = deck
            .last_jump
            .is_none_or(|last| now.duration_since(last) > Duration::from_millis(500));
        let visual_event = if deck.looping
            && deck.last_beat_packet.is_some()
            && beat.beat_within_bar == 1
            && deck
                .last_loop_wrap
                .is_none_or(|last| now.duration_since(last) > Duration::from_millis(500))
        {
            deck.last_loop_wrap = Some(now);
            Some(PioneerVisualEvent::LoopWrap(beat.player))
        } else if event_cooled_down && (early || (bar_discontinuity && recent)) {
            deck.last_jump = Some(now);
            deck.pending_jump = Some(now);
            None
        } else {
            None
        };
        deck.last_beat_in_bar = beat.beat_within_bar;
        deck.last_beat_packet = Some(now);
        let changed_player = self.player != beat.player;
        self.player = beat.player;
        self.player_name = beat.name;
        self.bpm = beat.bpm;
        self.last_beat = Some(now);
        if let Some(number) = self.beat_numbers.get(&beat.player).copied() {
            self.beat_count = number;
        } else if changed_player && (1..=4).contains(&beat.beat_within_bar) {
            let bar_base = self.beat_count.saturating_sub(self.beat_count % 4);
            self.beat_count = bar_base + u64::from(beat.beat_within_bar - 1);
        } else {
            self.beat_count = self.beat_count.wrapping_add(1);
        }
        visual_event
    }

    fn take_due_visual_events(&mut self, now: Instant) -> Vec<PioneerVisualEvent> {
        self.decks
            .iter_mut()
            .filter_map(|(&player, deck)| {
                let pending = deck.pending_jump?;
                if deck.looping {
                    deck.pending_jump = None;
                    return None;
                }
                if now.duration_since(pending) < PIONEER_JUMP_STATUS_GRACE {
                    return None;
                }
                deck.pending_jump = None;
                Some(PioneerVisualEvent::Jump(player))
            })
            .collect()
    }
}

struct LinkBeat {
    player: u8,
    name: String,
    bpm: f32,
    beat_within_bar: u8,
}

fn valid_link_packet(packet: &[u8], kind: u8) -> bool {
    packet.len() > 0x0a && &packet[..10] == PRO_DJ_LINK_MAGIC && packet[0x0a] == kind
}

fn link_name(packet: &[u8]) -> String {
    let end = packet[0x0b..0x1f]
        .iter()
        .position(|b| *b == 0)
        .unwrap_or(20);
    String::from_utf8_lossy(&packet[0x0b..0x0b + end]).into_owned()
}

fn parse_link_beat(packet: &[u8]) -> Option<LinkBeat> {
    if !valid_link_packet(packet, 0x28) || packet.len() < 0x60 {
        return None;
    }
    let raw_pitch = u32::from_be_bytes([0, packet[0x55], packet[0x56], packet[0x57]]);
    let base_bpm = f32::from(u16::from_be_bytes([packet[0x5a], packet[0x5b]])) / 100.0;
    let bpm = base_bpm * raw_pitch as f32 / 0x10_0000 as f32;
    if !(20.0..=400.0).contains(&bpm) {
        return None;
    }
    Some(LinkBeat {
        player: packet[0x21],
        name: link_name(packet),
        bpm,
        beat_within_bar: packet[0x5c],
    })
}

fn play_mode_label(mode: u8) -> &'static str {
    match mode {
        0x00 => "no track",
        0x02 => "loading",
        0x03 => "playing",
        0x04 | 0x12 => "looping",
        0x05 => "paused",
        0x06 => "cued",
        0x07 => "cue play",
        0x08 => "cue scratch",
        0x09 => "searching",
        0x11 => "ended",
        _ => "unknown",
    }
}

fn debug_status_packet(
    packet: &[u8],
) -> Option<(String, u8, String, BTreeMap<String, String>, Vec<u8>)> {
    if valid_link_packet(packet, 0x29) && packet.len() >= 0x38 {
        let device = packet[0x21];
        let name = link_name(packet);
        let flags = packet[0x27];
        let pitch = u32::from_be_bytes(packet[0x28..0x2c].try_into().ok()?);
        let bpm = f32::from(u16::from_be_bytes(packet[0x2e..0x30].try_into().ok()?)) / 100.0;
        let effective = bpm * pitch as f32 / 0x10_0000 as f32;
        let mut fields = BTreeMap::new();
        fields.insert("packet_type".into(), "0x29 mixer status".into());
        fields.insert("packet_length".into(), packet.len().to_string());
        fields.insert("name".into(), name.clone());
        fields.insert("flags".into(), format!("0x{flags:02x}"));
        fields.insert("tempo_master".into(), (flags & 0x20 != 0).to_string());
        fields.insert("synced".into(), (flags & 0x10 != 0).to_string());
        fields.insert("pitch_raw".into(), format!("0x{pitch:08x}"));
        fields.insert("bpm".into(), format!("{bpm:.2}"));
        fields.insert("effective_bpm".into(), format!("{effective:.3}"));
        fields.insert("master_handoff_to".into(), packet[0x36].to_string());
        fields.insert("beat_in_bar".into(), packet[0x37].to_string());
        let signature = packet[0x27..0x38].to_vec();
        return Some((
            "mixer".into(),
            device,
            format!("{name} master={} · {effective:.2} BPM", flags & 0x20 != 0),
            fields,
            signature,
        ));
    }
    if !valid_link_packet(packet, 0x0a) || packet.len() < 0xa7 {
        return None;
    }

    let device = packet[0x21];
    let name = link_name(packet);
    let mode = packet[0x7b];
    let flags = packet[0x89];
    let track_id = u32::from_be_bytes(packet[0x2c..0x30].try_into().ok()?);
    let track_number = u16::from_be_bytes(packet[0x32..0x34].try_into().ok()?);
    let pitch = u32::from_be_bytes([0, packet[0x8d], packet[0x8e], packet[0x8f]]);
    let bpm = f32::from(u16::from_be_bytes(packet[0x92..0x94].try_into().ok()?)) / 100.0;
    let effective = bpm * pitch as f32 / 0x10_0000 as f32;
    let raw_beat = u32::from_be_bytes(packet[0xa0..0xa4].try_into().ok()?);
    let cue_countdown = u16::from_be_bytes(packet[0xa4..0xa6].try_into().ok()?);
    let firmware = String::from_utf8_lossy(&packet[0x7c..0x80])
        .trim_matches(char::from(0))
        .to_owned();
    let mut fields = BTreeMap::new();
    fields.insert("packet_type".into(), "0x0a CDJ status".into());
    fields.insert("packet_length".into(), packet.len().to_string());
    fields.insert("name".into(), name.clone());
    fields.insert("firmware".into(), firmware);
    fields.insert(
        "play_mode".into(),
        format!("0x{mode:02x} {}", play_mode_label(mode)),
    );
    fields.insert("flags".into(), format!("0x{flags:02x}"));
    fields.insert("playing".into(), (flags & 0x40 != 0).to_string());
    fields.insert("tempo_master".into(), (flags & 0x20 != 0).to_string());
    fields.insert("synced".into(), (flags & 0x10 != 0).to_string());
    fields.insert("on_air".into(), (flags & 0x08 != 0).to_string());
    fields.insert("track_source_player".into(), packet[0x28].to_string());
    fields.insert(
        "track_source_slot".into(),
        format!("0x{:02x}", packet[0x29]),
    );
    fields.insert("track_type".into(), format!("0x{:02x}", packet[0x2a]));
    fields.insert("rekordbox_track_id".into(), track_id.to_string());
    fields.insert("track_number".into(), track_number.to_string());
    fields.insert(
        "pitch".into(),
        format!("{:+.2}%", (pitch as f32 / 0x10_0000 as f32 - 1.0) * 100.0),
    );
    fields.insert("track_bpm".into(), format!("{bpm:.2}"));
    fields.insert("effective_bpm".into(), format!("{effective:.3}"));
    fields.insert(
        "beat_number".into(),
        if raw_beat == u32::MAX {
            "unknown".into()
        } else {
            raw_beat.to_string()
        },
    );
    fields.insert("beat_in_bar".into(), packet[0xa6].to_string());
    fields.insert(
        "cue_countdown".into(),
        if cue_countdown == u16::MAX {
            "none".into()
        } else {
            cue_countdown.to_string()
        },
    );
    let mut signature = Vec::new();
    signature.extend_from_slice(&packet[0x28..0x34]);
    signature.extend_from_slice(&packet[0x7b..0x80]);
    signature.push(flags);
    signature.extend_from_slice(&packet[0x8d..0x94]);
    signature.extend_from_slice(&packet[0xa0..0xa7]);
    Some((
        "deck".into(),
        device,
        format!(
            "{name} · {} · track {track_id} · {effective:.2} BPM",
            play_mode_label(mode)
        ),
        fields,
        signature,
    ))
}

pub fn spawn(state: Arc<SharedState>) -> std::thread::JoinHandle<()> {
    let (metadata_tx, metadata_rx) = bounded(32);
    let metadata_state = state.clone();
    std::thread::Builder::new()
        .name("pro-dj-link-metadata".into())
        .spawn(move || metadata_thread(metadata_state, metadata_rx))
        .expect("spawn PRO DJ LINK metadata thread");
    let pioneer_state = state.clone();
    std::thread::Builder::new()
        .name("pro-dj-link".into())
        .spawn(move || pioneer_thread(pioneer_state, metadata_tx))
        .expect("spawn PRO DJ LINK thread");
    std::thread::Builder::new()
        .name("midi-clock".into())
        .spawn(move || midi_thread(state))
        .expect("spawn MIDI clock thread")
}

fn pioneer_thread(state: Arc<SharedState>, metadata_tx: Sender<MetadataRequest>) {
    let mut beat_sockets: Vec<UdpSocket> = Vec::new();
    let mut status_sockets: Vec<UdpSocket> = Vec::new();
    let mut debug_status_signatures: HashMap<u8, Vec<u8>> = HashMap::new();
    let mut last_debug_beat: HashMap<u8, Instant> = HashMap::new();
    let mut device_ips: HashMap<u8, Ipv4Addr> = HashMap::new();
    let mut metadata_refs: HashMap<u8, (u8, u8, u32, Ipv4Addr)> = HashMap::new();
    let mut last_bind_attempt = Instant::now() - RESCAN_EVERY;
    let mut buffer = [0u8; 2048];

    while !state.shutdown.load(Ordering::Relaxed) {
        let (enabled, configured_player) = {
            let cfg = state.config.read();
            (
                cfg.rhythm.source == RhythmSource::ProDjLink,
                cfg.rhythm.pro_dj_link_player,
            )
        };
        if !enabled {
            beat_sockets.clear();
            status_sockets.clear();
            state.pioneer_clock.lock().disconnect();
            std::thread::sleep(Duration::from_millis(100));
            continue;
        }

        if (beat_sockets.is_empty() || status_sockets.is_empty())
            && last_bind_attempt.elapsed() >= RESCAN_EVERY
        {
            last_bind_attempt = Instant::now();
            if beat_sockets.is_empty() {
                match bind_link_sockets(PRO_DJ_LINK_BEAT_PORT) {
                    Ok(sockets) => {
                        beat_sockets = sockets;
                        state.pioneer_clock.lock().set_listen_error(String::new());
                        log::info!("passively listening for PRO DJ LINK beats on UDP 50001");
                    }
                    Err(e) => state
                        .pioneer_clock
                        .lock()
                        .set_listen_error(format!("cannot listen on UDP 50001: {e}")),
                }
            }
            if status_sockets.is_empty() {
                match bind_link_sockets(PRO_DJ_LINK_STATUS_PORT) {
                    Ok(sockets) => status_sockets = sockets,
                    Err(e) => log::warn!(
                        "PRO DJ LINK status port 50002 unavailable ({e}); beat input still works, select a player number if auto-master cannot be seen"
                    ),
                }
            }
        }

        let mut beat_error = None;
        beat_sockets.retain(|socket| {
            loop {
                match socket.recv_from(&mut buffer) {
                    Ok((length, _)) => {
                        if let Some(beat) = parse_link_beat(&buffer[..length]) {
                            let now = Instant::now();
                            let duplicate = last_debug_beat.get(&beat.player).is_some_and(|last| {
                                now.duration_since(*last) < Duration::from_millis(35)
                            });
                            if !duplicate {
                                last_debug_beat.insert(beat.player, now);
                                state.push_pioneer_debug(
                                    "beat",
                                    beat.player,
                                    format!(
                                        "{} · beat {} · {:.2} BPM",
                                        beat.name, beat.beat_within_bar, beat.bpm
                                    ),
                                    BTreeMap::from([
                                        ("packet_type".into(), "0x28 beat".into()),
                                        ("packet_length".into(), length.to_string()),
                                        ("name".into(), beat.name.clone()),
                                        ("effective_bpm".into(), format!("{:.3}", beat.bpm)),
                                        ("beat_in_bar".into(), beat.beat_within_bar.to_string()),
                                    ]),
                                );
                            }
                        }
                        let event = state.pioneer_clock.lock().receive_beat(
                            &buffer[..length],
                            configured_player,
                            Instant::now(),
                        );
                        if let Some(event) = event {
                            trigger_pioneer_visual(&state, event);
                        }
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => return true,
                    Err(e) => {
                        beat_error = Some(e);
                        return false;
                    }
                }
            }
        });
        if let Some(e) = beat_error {
            state
                .pioneer_clock
                .lock()
                .set_listen_error(format!("UDP 50001 receive failed: {e}"));
        }
        status_sockets.retain(|socket| {
            loop {
                match socket.recv_from(&mut buffer) {
                    Ok((length, source)) => {
                        if let SocketAddr::V4(source) = source
                            && let Some(device) = link_device_number(&buffer[..length])
                        {
                            device_ips.insert(device, *source.ip());
                            maybe_request_metadata(
                                &state,
                                &metadata_tx,
                                &mut metadata_refs,
                                &device_ips,
                                &buffer[..length],
                                *source.ip(),
                            );
                        }
                        if let Some((category, device, summary, fields, signature)) =
                            debug_status_packet(&buffer[..length])
                        {
                            let changed = debug_status_signatures
                                .get(&device)
                                .is_none_or(|previous| previous != &signature);
                            if changed {
                                debug_status_signatures.insert(device, signature);
                                state.push_pioneer_debug(category, device, summary, fields);
                            }
                        }
                        let events = state
                            .pioneer_clock
                            .lock()
                            .receive_status(&buffer[..length], Instant::now());
                        for event in events {
                            trigger_pioneer_visual(&state, event);
                        }
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => return true,
                    Err(_) => return false,
                }
            }
        });
        let pending_events = state
            .pioneer_clock
            .lock()
            .take_due_visual_events(Instant::now());
        for event in pending_events {
            trigger_pioneer_visual(&state, event);
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn link_device_number(packet: &[u8]) -> Option<u8> {
    (packet.len() > 0x21
        && packet.starts_with(PRO_DJ_LINK_MAGIC)
        && matches!(packet[0x0a], 0x0a | 0x29))
    .then_some(packet[0x21])
}

fn slot_label(slot: u8) -> &'static str {
    match slot {
        1 => "CD",
        2 => "SD",
        3 => "USB 1",
        4 => "rekordbox collection",
        7 => "USB 2",
        _ => "unknown",
    }
}

fn maybe_request_metadata(
    state: &SharedState,
    metadata_tx: &Sender<MetadataRequest>,
    metadata_refs: &mut HashMap<u8, (u8, u8, u32, Ipv4Addr)>,
    device_ips: &HashMap<u8, Ipv4Addr>,
    packet: &[u8],
    packet_ip: Ipv4Addr,
) {
    if !valid_link_packet(packet, 0x0a) || packet.len() < 0x34 {
        return;
    }
    let deck = packet[0x21];
    let source_player = packet[0x28];
    let source_slot = packet[0x29];
    let track_id = u32::from_be_bytes(packet[0x2c..0x30].try_into().unwrap());
    if track_id == 0 || source_player == 0 || source_slot == 0 {
        metadata_refs.remove(&deck);
        state.pioneer_tracks.lock().remove(&deck);
        return;
    }

    let source_ip = device_ips.get(&source_player).copied().unwrap_or(packet_ip);
    let reference = (source_player, source_slot, track_id, source_ip);
    if metadata_refs.get(&deck) == Some(&reference) {
        return;
    }

    let query_player = state.config.read().rhythm.pro_dj_link_metadata_player;
    if !(1..=15).contains(&query_player) {
        return;
    }
    if state
        .pioneer_clock
        .lock()
        .has_fresh_device(query_player, Instant::now())
    {
        let mut fields = BTreeMap::new();
        fields.insert("query_player".into(), query_player.to_string());
        fields.insert("track_id".into(), track_id.to_string());
        state.push_pioneer_debug(
            "metadata",
            deck,
            format!("metadata query blocked: player {query_player} is already in use"),
            fields,
        );
        return;
    }

    let request = MetadataRequest {
        deck,
        source_player,
        source_ip,
        source_slot,
        track_id,
        query_player,
    };
    if metadata_tx.try_send(request).is_ok() {
        metadata_refs.insert(deck, reference);
        state.pioneer_tracks.lock().insert(
            deck,
            ProDjLinkTrackInfo {
                deck,
                source_player,
                source_slot: slot_label(source_slot).into(),
                rekordbox_id: track_id,
                loading: true,
                ..Default::default()
            },
        );
    }
}

fn metadata_thread(state: Arc<SharedState>, requests: Receiver<MetadataRequest>) {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            log::error!("cannot start DJ LINK metadata runtime: {error}");
            return;
        }
    };
    while !state.shutdown.load(Ordering::Relaxed) {
        let Ok(request) = requests.recv_timeout(Duration::from_millis(250)) else {
            continue;
        };
        let result = runtime.block_on(fetch_track_info(request));
        let mut fields = BTreeMap::from([
            ("source_player".into(), request.source_player.to_string()),
            ("source_ip".into(), request.source_ip.to_string()),
            ("source_slot".into(), slot_label(request.source_slot).into()),
            ("track_id".into(), request.track_id.to_string()),
            ("query_player".into(), request.query_player.to_string()),
        ]);
        match result {
            Ok(track) => {
                fields.insert("title".into(), track.title.clone());
                fields.insert("artist".into(), track.artist.clone());
                fields.insert("cues".into(), track.cues.len().to_string());
                fields.insert(
                    "waveform_preview_samples".into(),
                    track.waveform_preview.len().to_string(),
                );
                fields.insert(
                    "waveform_detail_samples".into(),
                    track.waveform_detail.len().to_string(),
                );
                state
                    .pioneer_tracks
                    .lock()
                    .insert(request.deck, track.clone());
                state.push_pioneer_debug(
                    "metadata",
                    request.deck,
                    format!("{} — {}", track.title, track.artist),
                    fields,
                );
            }
            Err(error) => {
                fields.insert("error".into(), error.clone());
                state.pioneer_tracks.lock().insert(
                    request.deck,
                    ProDjLinkTrackInfo {
                        deck: request.deck,
                        source_player: request.source_player,
                        source_slot: slot_label(request.source_slot).into(),
                        rekordbox_id: request.track_id,
                        error: error.clone(),
                        ..Default::default()
                    },
                );
                state.push_pioneer_debug(
                    "metadata",
                    request.deck,
                    format!("metadata unavailable: {error}"),
                    fields,
                );
            }
        }
    }
}

async fn discover_dbserver_port(ip: Ipv4Addr) -> Result<u16, String> {
    let mut stream = TcpStream::connect((ip, 12_523))
        .await
        .map_err(|error| format!("dbserver discovery: {error}"))?;
    let query = b"RemoteDBServer\0";
    stream
        .write_all(&(query.len() as u32).to_be_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stream
        .write_all(query)
        .await
        .map_err(|error| error.to_string())?;
    let mut first = [0u8; 2];
    stream
        .read_exact(&mut first)
        .await
        .map_err(|error| error.to_string())?;
    if first != [0, 0] {
        return Ok(u16::from_be_bytes(first));
    }
    // Some newer servers prefix the two-byte port with a four-byte length.
    let mut rest = [0u8; 4];
    stream
        .read_exact(&mut rest)
        .await
        .map_err(|error| error.to_string())?;
    Ok(u16::from_be_bytes([rest[2], rest[3]]))
}

async fn fetch_track_info(request: MetadataRequest) -> Result<ProDjLinkTrackInfo, String> {
    let device = DeviceNumber(request.source_player);
    let slot = TrackSourceSlot::from(request.source_slot);
    let port = discover_dbserver_port(request.source_ip).await?;
    let mut client = DbClient::connect(
        (request.source_ip, port).into(),
        request.query_player,
        request.source_player,
    )
    .await
    .map_err(|error| error.to_string())?;
    let data_ref = DataReference::new(device, slot, request.track_id);
    let metadata_items = client
        .menu_request(
            DbMessageType::MetadataReq,
            build_metadata_request_args(&data_ref, 8),
        )
        .await
        .map_err(|error| error.to_string())?;
    let metadata = TrackMetadata::from_menu_items(data_ref, &metadata_items);
    let data_args = || {
        vec![
            DbField::number(8),
            DbField::number(u8::from(slot) as u32),
            DbField::number(request.track_id),
        ]
    };
    let cues = client
        .menu_request(DbMessageType::CueListExtReq, data_args())
        .await
        .ok()
        .map(|items| CueList::from_menu_items(&items));
    let preview = client
        .simple_request(DbMessageType::WaveformPreviewReq, data_args())
        .await
        .ok()
        .and_then(|message| {
            message
                .args
                .get(3)
                .and_then(|field| field.as_binary().ok())
                .cloned()
        })
        .and_then(|bytes| WaveformPreview::from_bytes(bytes, WaveformStyle::Blue).ok());
    let detail = client
        .simple_request(DbMessageType::WaveformDetailReq, data_args())
        .await
        .ok()
        .and_then(|message| {
            message
                .args
                .get(3)
                .and_then(|field| field.as_binary().ok())
                .cloned()
        })
        .and_then(|bytes| WaveformDetail::from_bytes(bytes, WaveformStyle::Blue).ok());

    let waveform_preview = preview
        .map(|waveform| {
            (0..waveform.segment_count())
                .filter_map(|index| waveform.segment_height(index))
                .map(|height| ((u16::from(height) * 255) / 31) as u8)
                .collect()
        })
        .unwrap_or_default();
    let waveform_detail = detail
        .map(|waveform| {
            let frames = waveform.frame_count();
            let chunk = frames.div_ceil(MAX_DETAIL_SAMPLES).max(1);
            (0..frames)
                .step_by(chunk)
                .map(|start| {
                    (start..(start + chunk).min(frames))
                        .filter_map(|index| waveform.frame_height(index))
                        .max()
                        .unwrap_or(0)
                        .saturating_mul(8)
                })
                .collect()
        })
        .unwrap_or_default();
    let cues = cues
        .map(|list| {
            list.entries
                .into_iter()
                .map(|cue| {
                    let color = cue
                        .color_rgb
                        .map(|(r, g, b)| format!("#{r:02x}{g:02x}{b:02x}"))
                        .or_else(|| {
                            cue.color
                                .map(|c| format!("#{:02x}{:02x}{:02x}", c.red, c.green, c.blue))
                        })
                        .unwrap_or_default();
                    ProDjLinkCueInfo {
                        kind: match cue.cue_type {
                            CueType::MemoryPoint => "memory",
                            CueType::HotCue => "hot_cue",
                            CueType::Loop => "loop",
                        }
                        .into(),
                        hot_cue_number: cue.hot_cue_number,
                        position_ms: cue.position_ms,
                        loop_end_ms: cue.loop_end_ms,
                        comment: cue.comment.unwrap_or_default(),
                        color,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(ProDjLinkTrackInfo {
        deck: request.deck,
        source_player: request.source_player,
        source_slot: slot_label(request.source_slot).into(),
        rekordbox_id: request.track_id,
        title: metadata.title,
        artist: metadata.artist.label,
        album: metadata.album.label,
        genre: metadata.genre.label,
        key: metadata.key.label,
        label: metadata.label.label,
        comment: metadata.comment,
        duration_seconds: metadata.duration,
        bpm: metadata.tempo.0,
        rating: metadata.rating,
        year: metadata.year,
        bit_rate: metadata.bit_rate,
        artwork_id: metadata.artwork_id,
        cues,
        waveform_preview,
        waveform_detail,
        ..Default::default()
    })
}

fn trigger_pioneer_visual(state: &SharedState, event: PioneerVisualEvent) {
    use crate::layers::{EffectCfg, EffectKind};
    use crate::state::{
        DJ_EVENT_CUE, DJ_EVENT_CUE_RELEASE, DJ_EVENT_JUMP, DJ_EVENT_LOOP_END, DJ_EVENT_LOOP_START,
        DJ_EVENT_LOOP_WRAP, DJ_EVENT_OFF_AIR, DJ_EVENT_ON_AIR, DJ_EVENT_PLAY,
    };

    let player = match event {
        PioneerVisualEvent::PlayStarted(player)
        | PioneerVisualEvent::CueStarted(player)
        | PioneerVisualEvent::CuePlayStarted(player)
        | PioneerVisualEvent::CueEnded(player)
        | PioneerVisualEvent::OnAirChanged(player, _)
        | PioneerVisualEvent::LoopStarted(player)
        | PioneerVisualEvent::LoopWrap(player)
        | PioneerVisualEvent::LoopEnded(player)
        | PioneerVisualEvent::Jump(player) => player,
    };
    // Deck 1 occupies the left hemisphere, deck 2 the right. Additional
    // players fan around the circle rather than all originating at one point.
    let angle = match player {
        // The preview rotates spoke zero to the top: shader-space -Y/+Y are
        // displayed left/right respectively.
        1 => -std::f32::consts::FRAC_PI_2,
        2 => std::f32::consts::FRAC_PI_2,
        _ => f32::from(player.saturating_sub(1)) * std::f32::consts::FRAC_PI_2,
    };
    let hue = if player == 1 { 0.58 } else { 0.08 };
    let patch_event = match event {
        PioneerVisualEvent::PlayStarted(_) => DJ_EVENT_PLAY,
        PioneerVisualEvent::CueStarted(_) | PioneerVisualEvent::CuePlayStarted(_) => DJ_EVENT_CUE,
        PioneerVisualEvent::CueEnded(_) => DJ_EVENT_CUE_RELEASE,
        PioneerVisualEvent::OnAirChanged(_, true) => DJ_EVENT_ON_AIR,
        PioneerVisualEvent::OnAirChanged(_, false) => DJ_EVENT_OFF_AIR,
        PioneerVisualEvent::LoopStarted(_) => DJ_EVENT_LOOP_START,
        PioneerVisualEvent::LoopWrap(_) => DJ_EVENT_LOOP_WRAP,
        PioneerVisualEvent::LoopEnded(_) => DJ_EVENT_LOOP_END,
        PioneerVisualEvent::Jump(_) => DJ_EVENT_JUMP,
    };
    state
        .pioneer_patch_events
        .lock()
        .record(patch_event, player);
    let effect = |kind, intensity, size, radius, duration| EffectCfg {
        kind,
        angle,
        radius,
        intensity,
        size,
        hue,
        saturation: 0.9,
        brightness: 1.0,
        duration,
        ..Default::default()
    };

    let (event_name, visual_effects) = match event {
        PioneerVisualEvent::PlayStarted(_) => ("play started", "burst"),
        PioneerVisualEvent::CueStarted(_) => ("cue engaged", "burst"),
        PioneerVisualEvent::CuePlayStarted(_) => ("cue play", "swoosh"),
        PioneerVisualEvent::CueEnded(_) => ("cue released", "collapse"),
        PioneerVisualEvent::OnAirChanged(_, true) => ("on air", "swoosh"),
        PioneerVisualEvent::OnAirChanged(_, false) => ("off air", "collapse"),
        PioneerVisualEvent::LoopStarted(_) => ("loop started", "ring"),
        PioneerVisualEvent::LoopWrap(_) => ("loop wrapped", "ring"),
        PioneerVisualEvent::LoopEnded(_) => ("loop ended", "ring"),
        PioneerVisualEvent::Jump(_) => ("hot cue / seek inferred", "burst + strobe"),
    };
    state.push_pioneer_debug(
        "visual",
        player,
        format!("{event_name} → {visual_effects}"),
        BTreeMap::from([
            ("event".into(), event_name.into()),
            ("effects".into(), visual_effects.into()),
            ("origin_angle_rad".into(), format!("{angle:.3}")),
            ("deck_hue".into(), format!("{hue:.3}")),
        ]),
    );

    match event {
        PioneerVisualEvent::PlayStarted(_) => {
            state.trigger_effect(effect(EffectKind::Burst, 1.4, 1.25, 0.7, 1.1));
        }
        PioneerVisualEvent::CueStarted(_) => {
            state.trigger_effect(effect(EffectKind::Burst, 1.15, 0.7, 0.82, 0.7));
        }
        PioneerVisualEvent::CuePlayStarted(_) => {
            state.trigger_effect(effect(EffectKind::Swoosh, 1.3, 1.2, 0.82, 0.8));
        }
        PioneerVisualEvent::CueEnded(_) => {
            state.trigger_effect(effect(EffectKind::Collapse, 0.8, 0.7, 0.82, 0.65));
        }
        PioneerVisualEvent::OnAirChanged(_, true) => {
            state.trigger_effect(effect(EffectKind::Swoosh, 1.5, 1.8, 0.8, 1.35));
        }
        PioneerVisualEvent::OnAirChanged(_, false) => {
            state.trigger_effect(effect(EffectKind::Collapse, 1.1, 1.2, 0.8, 1.1));
        }
        PioneerVisualEvent::LoopStarted(_) => {
            state.trigger_effect(effect(EffectKind::Ring, 1.7, 1.1, 0.5, 1.2));
        }
        PioneerVisualEvent::LoopWrap(_) => {
            state.trigger_effect(effect(EffectKind::Ring, 1.35, 0.85, 0.5, 0.75));
        }
        PioneerVisualEvent::LoopEnded(_) => {
            state.trigger_effect(effect(EffectKind::Ring, 1.15, 1.2, 0.5, 0.9));
        }
        PioneerVisualEvent::Jump(_) => {
            // A large analyzed-beat discontinuity is our first-version Hot Cue
            // signal. Pair the localized burst with a short full-array strike.
            state.trigger_effect(effect(EffectKind::Burst, 2.0, 1.5, 0.85, 1.25));
            state.trigger_effect(effect(EffectKind::Strobe, 1.0, 1.0, 0.5, 0.22));
        }
    }
    // The renderer normally submits frame N while reading back N-1. That is
    // ideal steady-state throughput, but adds a visible 16.7 ms at 60 Hz to an
    // event that arrived asynchronously just after a frame boundary. Mark only
    // deck-transport reactions urgent; the engine will double-dispatch once so
    // the newly-created effect is the frame delivered this tick.
    state.low_latency_render_seq.fetch_add(1, Ordering::Release);
}

fn bind_link_socket(address: Ipv4Addr, port: u16) -> io::Result<UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    socket.set_reuse_port(true)?;
    socket.bind(&SocketAddrV4::new(address, port).into())?;
    socket.set_nonblocking(true)?;
    Ok(socket.into())
}

/// rekordbox binds the wildcard PRO DJ LINK ports on macOS. A second wildcard
/// bind is then rejected even with SO_REUSEPORT. Interface-specific sockets can
/// coexist, but the kernel may still route an entire UDP flow to rekordbox. Bind
/// the interface's broadcast address too so deck beat broadcasts have an exact
/// listener. Prefer the wildcard socket when it is available.
fn bind_link_sockets(port: u16) -> io::Result<Vec<UdpSocket>> {
    let wildcard_error = match bind_link_socket(Ipv4Addr::UNSPECIFIED, port) {
        // On macOS, always leave the wildcard address available for rekordbox so
        // either application can start first. The interface and broadcast binds
        // below receive the deck traffic without monopolizing the port.
        Ok(socket) if cfg!(not(target_os = "macos")) => return Ok(vec![socket]),
        Ok(_) => io::Error::new(
            io::ErrorKind::AddrInUse,
            "using interface-specific PRO DJ LINK sockets",
        ),
        Err(error) => error,
    };
    {
        let interfaces = match local_ip_address::list_afinet_netifas() {
            Ok(interfaces) => interfaces,
            Err(_) => return Err(wildcard_error),
        };
        let mut seen = HashSet::new();
        let mut sockets = Vec::new();
        for (_, address) in interfaces {
            let std::net::IpAddr::V4(address) = address else {
                continue;
            };
            if address.is_loopback() {
                continue;
            }
            for bind_address in link_bind_addresses(address) {
                if seen.insert(bind_address)
                    && let Ok(socket) = bind_link_socket(bind_address, port)
                {
                    sockets.push(socket);
                }
            }
        }
        if sockets.is_empty() {
            Err(wildcard_error)
        } else {
            log::info!(
                "UDP {port} wildcard port is occupied; listening on {} local interfaces",
                sockets.len()
            );
            Ok(sockets)
        }
    }
}

/// Return the interface address plus possible directed-broadcast addresses.
/// Binding an address that does not belong to a local interface simply fails;
/// this lets us support arbitrary subnet masks without another platform API.
fn link_bind_addresses(address: Ipv4Addr) -> Vec<Ipv4Addr> {
    let bits = u32::from(address);
    let mut addresses = vec![address];
    for prefix in 8..=30 {
        let mask = u32::MAX << (32 - prefix);
        let broadcast = Ipv4Addr::from(bits | !mask);
        if broadcast != Ipv4Addr::BROADCAST && broadcast != address {
            addresses.push(broadcast);
        }
    }
    addresses.sort_unstable();
    addresses.dedup();
    addresses
}

fn midi_thread(state: Arc<SharedState>) {
    let mut connection: Option<MidiInputConnection<()>> = None;
    let mut connected_name: Option<String> = None;
    let mut last_scan = Instant::now() - RESCAN_EVERY;

    while !state.shutdown.load(Ordering::Relaxed) {
        if last_scan.elapsed() < RESCAN_EVERY {
            std::thread::sleep(Duration::from_millis(100));
            continue;
        }
        last_scan = Instant::now();

        let desired = {
            let cfg = state.config.read();
            (cfg.rhythm.source, cfg.rhythm.midi_port.clone())
        };
        let (mut input, ports) = match enumerate_ports() {
            Ok(v) => v,
            Err(e) => {
                state.status.lock().midi_ports.clear();
                log::warn!("cannot enumerate MIDI inputs: {e}");
                continue;
            }
        };
        state.status.lock().midi_ports = ports.iter().map(|(name, _)| name.clone()).collect();

        let wanted_name = if desired.0 == RhythmSource::MidiClock {
            desired.1
        } else {
            None
        };
        let still_present = connected_name.as_ref().is_some_and(|name| {
            wanted_name.as_ref() == Some(name) && ports.iter().any(|p| &p.0 == name)
        });
        if connection.is_some() && !still_present {
            connection = None;
            connected_name = None;
            state.midi_clock.lock().disconnect();
        }
        if connection.is_some() {
            continue;
        }

        let Some(wanted) = wanted_name else {
            continue;
        };
        let Some((_, port)) = ports.into_iter().find(|(name, _)| *name == wanted) else {
            continue;
        };
        input.ignore(Ignore::None);
        let callback_state = state.clone();
        match input.connect(
            &port,
            "empyrean-gate-clock",
            move |_stamp, message, _| {
                callback_state
                    .midi_clock
                    .lock()
                    .message_at(message, Instant::now());
            },
            (),
        ) {
            Ok(c) => {
                log::info!("MIDI clock connected to '{wanted}'");
                connection = Some(c);
                connected_name = Some(wanted);
            }
            Err(e) => log::warn!("cannot connect MIDI input '{wanted}': {e}"),
        }
    }
}

fn enumerate_ports() -> Result<(MidiInput, Vec<(String, midir::MidiInputPort)>), midir::InitError> {
    let input = MidiInput::new("Empyrean Gate")?;
    let ports = input
        .ports()
        .into_iter()
        .map(|port| {
            let name = input
                .port_name(&port)
                .unwrap_or_else(|_| "Unknown MIDI input".into());
            (name, port)
        })
        .collect();
    Ok((input, ports))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link_beat(player: u8, bpm: f32, beat_in_bar: u8) -> Vec<u8> {
        let mut packet = vec![0u8; 0x60];
        packet[..10].copy_from_slice(PRO_DJ_LINK_MAGIC);
        packet[0x0a] = 0x28;
        packet[0x0b..0x13].copy_from_slice(b"CDJ-TEST");
        packet[0x21] = player;
        packet[0x55..0x58].copy_from_slice(&[0x10, 0x00, 0x00]);
        packet[0x5a..0x5c].copy_from_slice(&((bpm * 100.0) as u16).to_be_bytes());
        packet[0x5c] = beat_in_bar;
        packet
    }

    fn link_status(player: u8, master: bool, beat_number: u32) -> Vec<u8> {
        link_status_state(player, master, beat_number, true, false, false)
    }

    fn link_status_state(
        player: u8,
        master: bool,
        beat_number: u32,
        playing: bool,
        on_air: bool,
        looping: bool,
    ) -> Vec<u8> {
        let mut packet = vec![0u8; 0xd4];
        packet[..10].copy_from_slice(PRO_DJ_LINK_MAGIC);
        packet[0x0a] = 0x0a;
        packet[0x0b..0x13].copy_from_slice(b"CDJ-TEST");
        packet[0x21] = player;
        packet[0x7b] = if looping {
            0x04
        } else if playing {
            0x03
        } else {
            0x05
        };
        packet[0x89] = u8::from(playing) * 0x40 | u8::from(master) * 0x20 | u8::from(on_air) * 0x08;
        packet[0xa0..0xa4].copy_from_slice(&beat_number.to_be_bytes());
        packet
    }

    fn mixer_status(number: u8, master: bool) -> Vec<u8> {
        let mut packet = vec![0u8; 0x38];
        packet[..10].copy_from_slice(PRO_DJ_LINK_MAGIC);
        packet[0x0a] = 0x29;
        packet[0x0b..0x13].copy_from_slice(b"DJM-TEST");
        packet[0x21] = number;
        packet[0x27] = u8::from(master) * 0x20;
        packet
    }

    #[test]
    fn clock_estimates_tempo_and_phase() {
        let start = Instant::now();
        let mut clock = MidiClockState::default();
        clock.message_at(&[0xfa], start);
        for tick in 0..48 {
            clock.message_at(&[0xf8], start + Duration::from_secs_f64(tick as f64 / 48.0));
        }
        let snap = clock.snapshot(start + Duration::from_secs(1), 0.0);
        assert!(snap.usable);
        assert!((snap.bpm - 120.0).abs() < 0.1, "{}", snap.bpm);
        assert!(
            snap.beat_phase < 0.06 || snap.beat_phase > 0.94,
            "{}",
            snap.beat_phase
        );
    }

    #[test]
    fn positive_latency_delays_the_visual_wrap() {
        let start = Instant::now();
        let mut clock = MidiClockState::default();
        clock.bpm = 120.0;
        clock.running = true;
        clock.last_tick = Some(start);
        let snap = clock.snapshot(start, 50.0);
        assert!((snap.beat_phase - 0.9).abs() < 0.001);
    }

    #[test]
    fn explicit_stop_makes_clock_unusable() {
        let start = Instant::now();
        let mut clock = MidiClockState::default();
        clock.bpm = 120.0;
        clock.running = true;
        clock.last_tick = Some(start);
        clock.message_at(&[0xfc], start);
        assert!(!clock.snapshot(start, 0.0).usable);
    }

    #[test]
    fn pioneer_beat_parser_applies_pitch() {
        let mut packet = link_beat(2, 120.0, 3);
        packet[0x55..0x58].copy_from_slice(&[0x11, 0x00, 0x00]); // +6.25%
        let beat = parse_link_beat(&packet).unwrap();
        assert_eq!(beat.player, 2);
        assert!((beat.bpm - 127.5).abs() < 0.01);
        assert_eq!(beat.beat_within_bar, 3);
    }

    #[test]
    fn pioneer_energy_follows_rekordbox_waveform_without_audio_capture() {
        let devices = vec![PioneerDevice {
            number: 2,
            name: "CDJ-TEST".into(),
            tempo_master: true,
            playing: true,
            cued: false,
            on_air: true,
            looping: false,
            beat_number: 51,
        }];
        let tracks = HashMap::from([(
            2,
            ProDjLinkTrackInfo {
                deck: 2,
                duration_seconds: 100,
                bpm: 60.0,
                waveform_detail: vec![64; 10],
                ..Default::default()
            },
        )]);
        let energy = pioneer_energy(&devices, &tracks, 2, 0.0);
        assert!((energy - (64.0f32 / 255.0).sqrt()).abs() < 1e-4);
    }

    #[test]
    fn pioneer_energy_has_transport_fallback_but_stops_with_the_deck() {
        let mut devices = vec![PioneerDevice {
            number: 1,
            name: "CDJ-TEST".into(),
            tempo_master: true,
            playing: true,
            cued: false,
            on_air: true,
            looping: false,
            beat_number: 1,
        }];
        let tracks = HashMap::new();
        assert!((pioneer_energy(&devices, &tracks, 1, 0.0) - 0.70).abs() < 1e-4);
        assert!(pioneer_energy(&devices, &tracks, 1, 0.5) < 0.48);
        devices[0].playing = false;
        assert_eq!(pioneer_energy(&devices, &tracks, 1, 0.0), 0.0);
    }

    #[test]
    fn pioneer_transport_energy_keeps_beat_only_link_sources_visible() {
        assert!((pioneer_transport_energy(0.0) - 0.70).abs() < 1e-4);
        assert!(pioneer_transport_energy(0.5) > 0.46);
        assert!(pioneer_transport_energy(0.5) < 0.48);
    }

    #[test]
    fn pioneer_debug_status_exposes_track_transport_and_tempo_fields() {
        let mut packet = link_status_state(2, true, 321, true, true, false);
        packet[0x2c..0x30].copy_from_slice(&42u32.to_be_bytes());
        packet[0x92..0x94].copy_from_slice(&12000u16.to_be_bytes());
        packet[0x8d..0x90].copy_from_slice(&[0x10, 0x00, 0x00]);
        packet[0xa6] = 3;
        let (category, device, _, fields, _) = debug_status_packet(&packet).unwrap();
        assert_eq!(category, "deck");
        assert_eq!(device, 2);
        assert_eq!(fields["rekordbox_track_id"], "42");
        assert_eq!(fields["beat_number"], "321");
        assert_eq!(fields["beat_in_bar"], "3");
        assert_eq!(fields["effective_bpm"], "120.000");
        assert_eq!(fields["on_air"], "true");
        assert_eq!(fields["tempo_master"], "true");
    }

    #[test]
    fn link_bind_candidates_include_interface_broadcast() {
        let addresses = link_bind_addresses(Ipv4Addr::new(10, 255, 12, 135));
        assert!(addresses.contains(&Ipv4Addr::new(10, 255, 12, 135)));
        assert!(addresses.contains(&Ipv4Addr::new(10, 255, 15, 255)));
    }

    #[test]
    fn pioneer_auto_follows_reported_master_and_handoff() {
        let start = Instant::now();
        let mut clock = PioneerClockState::default();
        clock.receive_status(&link_status(1, true, 100), start);
        clock.receive_beat(&link_beat(2, 130.0, 1), 0, start);
        assert!(!clock.snapshot(start, 0.0).usable, "non-master ignored");
        clock.receive_beat(&link_beat(1, 120.0, 1), 0, start);
        assert_eq!(clock.player, 1);
        assert_eq!(clock.beat_count, 100);

        clock.receive_status(&link_status(1, false, 101), start);
        clock.receive_status(&link_status(2, true, 44), start);
        clock.receive_beat(&link_beat(2, 130.0, 1), 0, start);
        assert_eq!(clock.player, 2);
        assert!((clock.bpm - 130.0).abs() < 0.01);
        assert_eq!(clock.beat_count, 44);
    }

    #[test]
    fn pioneer_auto_uses_mixer_master_for_global_clock() {
        let start = Instant::now();
        let mut clock = PioneerClockState::default();
        clock.receive_status(&mixer_status(33, true), start);
        clock.receive_beat(&link_beat(1, 120.0, 1), 0, start);
        assert!(!clock.snapshot(start, 0.0).usable, "deck beat ignored");
        clock.receive_beat(&link_beat(33, 124.0, 1), 0, start);
        assert_eq!(clock.player, 33);
        assert!((clock.snapshot(start, 0.0).bpm - 124.0).abs() < 0.01);
        assert!(clock.player_label().contains("mixer master"));
    }

    #[test]
    fn pioneer_mixer_beat_preempts_auto_selected_deck() {
        let start = Instant::now();
        let mut clock = PioneerClockState::default();
        clock.receive_beat(&link_beat(1, 120.0, 1), 0, start);
        assert_eq!(clock.player, 1);
        clock.receive_beat(
            &link_beat(33, 123.0, 1),
            0,
            start + Duration::from_millis(20),
        );
        assert_eq!(clock.player, 33);
        assert_eq!(clock.master_player, Some(33));
        assert!((clock.bpm - 123.0).abs() < 0.01);
    }

    #[test]
    fn pioneer_player_override_works_without_master_status() {
        let start = Instant::now();
        let mut clock = PioneerClockState::default();
        clock.receive_beat(&link_beat(1, 120.0, 1), 2, start);
        clock.receive_beat(&link_beat(2, 128.0, 1), 2, start);
        assert_eq!(clock.player, 2);
        assert!((clock.snapshot(start, 0.0).bpm - 128.0).abs() < 0.01);
    }

    #[test]
    fn pioneer_status_emits_transport_loop_and_jump_visuals() {
        let start = Instant::now();
        let mut clock = PioneerClockState::default();
        assert!(
            clock
                .receive_status(&link_status_state(2, false, 10, false, false, false), start)
                .is_empty()
        );

        let started = clock.receive_status(
            &link_status_state(2, true, 10, true, true, false),
            start + Duration::from_millis(100),
        );
        assert!(started.contains(&PioneerVisualEvent::PlayStarted(2)));
        assert!(started.contains(&PioneerVisualEvent::OnAirChanged(2, true)));

        let loop_started = clock.receive_status(
            &link_status_state(2, true, 14, true, true, true),
            start + Duration::from_millis(200),
        );
        assert!(loop_started.contains(&PioneerVisualEvent::LoopStarted(2)));
        let wrapped = clock.receive_status(
            &link_status_state(2, true, 10, true, true, true),
            start + Duration::from_millis(600),
        );
        assert!(wrapped.contains(&PioneerVisualEvent::LoopWrap(2)));

        let advanced = clock.receive_status(
            &link_status_state(2, true, 14, true, true, true),
            start + Duration::from_millis(700),
        );
        assert!(!advanced.contains(&PioneerVisualEvent::LoopWrap(2)));
        let wrapped_again = clock.receive_status(
            &link_status_state(2, true, 10, true, true, true),
            start + Duration::from_millis(1_000),
        );
        assert!(wrapped_again.contains(&PioneerVisualEvent::LoopWrap(2)));

        let loop_ended = clock.receive_status(
            &link_status_state(2, true, 11, true, true, false),
            start + Duration::from_millis(1_100),
        );
        assert!(loop_ended.contains(&PioneerVisualEvent::LoopEnded(2)));
        let jumped = clock.receive_status(
            &link_status_state(2, true, 40, true, true, false),
            start + Duration::from_millis(1_200),
        );
        assert!(jumped.contains(&PioneerVisualEvent::Jump(2)));

        let visual = clock.visual_snapshot(start + Duration::from_millis(1_200));
        assert!(visual.active);
        assert!(!visual.deck_1_on_air);
        assert!(visual.deck_2_on_air);
        assert!(!visual.looping);
    }

    #[test]
    fn pioneer_status_emits_deck_local_cue_visuals() {
        let start = Instant::now();
        let mut clock = PioneerClockState::default();
        let mut status = link_status_state(1, false, 10, false, false, false);
        clock.receive_status(&status, start);

        status[0x7b] = 0x06; // paused at cue point
        let cued = clock.receive_status(&status, start + Duration::from_millis(50));
        assert!(cued.contains(&PioneerVisualEvent::CueStarted(1)));

        status[0x7b] = 0x07; // cue button held: cue play
        let cue_play = clock.receive_status(&status, start + Duration::from_millis(100));
        assert!(cue_play.contains(&PioneerVisualEvent::CuePlayStarted(1)));

        status[0x7b] = 0x03;
        let released = clock.receive_status(&status, start + Duration::from_millis(150));
        assert!(released.contains(&PioneerVisualEvent::CueEnded(1)));
        assert!(!clock.devices(start + Duration::from_millis(150))[0].cued);

        status[0x7b] = 0x06;
        let cued_again = clock.receive_status(&status, start + Duration::from_millis(200));
        assert!(cued_again.contains(&PioneerVisualEvent::CueStarted(1)));
    }

    #[test]
    fn pioneer_beat_sequence_does_not_treat_a_lost_packet_as_a_hot_cue() {
        let start = Instant::now();
        let mut clock = PioneerClockState::default();
        assert!(
            clock
                .receive_beat(&link_beat(2, 120.0, 1), 2, start)
                .is_none()
        );
        assert!(
            clock
                .receive_beat(
                    &link_beat(2, 120.0, 2),
                    2,
                    start + Duration::from_millis(500)
                )
                .is_none()
        );
        assert!(
            clock
                .receive_beat(
                    &link_beat(2, 120.0, 4),
                    2,
                    start + Duration::from_millis(1500)
                )
                .is_none()
        );
    }

    #[test]
    fn pioneer_beat_sequence_defers_an_early_hot_cue_without_position_status() {
        let start = Instant::now();
        let mut clock = PioneerClockState::default();
        assert!(
            clock
                .receive_beat(&link_beat(2, 120.0, 1), 2, start)
                .is_none()
        );
        assert!(
            clock
                .receive_beat(
                    &link_beat(2, 120.0, 2),
                    2,
                    start + Duration::from_millis(500)
                )
                .is_none()
        );
        assert!(
            clock
                .receive_beat(
                    &link_beat(2, 120.0, 4),
                    2,
                    start + Duration::from_millis(650)
                )
                .is_none()
        );
        assert!(
            clock
                .take_due_visual_events(start + Duration::from_millis(899))
                .is_empty()
        );
        assert_eq!(
            clock.take_due_visual_events(start + Duration::from_millis(900)),
            vec![PioneerVisualEvent::Jump(2)]
        );
    }

    #[test]
    fn pioneer_loop_status_cancels_a_pending_beat_inferred_hot_cue() {
        let start = Instant::now();
        let mut clock = PioneerClockState::default();
        clock.receive_status(&link_status_state(2, true, 20, true, true, false), start);
        assert!(
            clock
                .receive_beat(&link_beat(2, 120.0, 1), 2, start)
                .is_none()
        );
        assert!(
            clock
                .receive_beat(
                    &link_beat(2, 120.0, 4),
                    2,
                    start + Duration::from_millis(100)
                )
                .is_none(),
            "the ambiguous beat discontinuity must wait for deck status"
        );

        let loop_events = clock.receive_status(
            &link_status_state(2, true, 16, true, true, true),
            start + Duration::from_millis(180),
        );
        assert_eq!(loop_events, vec![PioneerVisualEvent::LoopStarted(2)]);
        assert!(
            clock
                .take_due_visual_events(start + Duration::from_millis(500))
                .is_empty(),
            "loop status must cancel the pending Hot Cue inference"
        );
    }

    #[test]
    fn pioneer_jump_fires_one_burst_and_one_strobe() {
        let state = SharedState::new(crate::config::AppConfig::default());
        trigger_pioneer_visual(&state, PioneerVisualEvent::Jump(2));
        let effects = state.effects.lock();
        assert_eq!(effects.len(), 2);
        assert_eq!(effects[0].cfg.kind, crate::layers::EffectKind::Burst);
        assert_eq!(effects[1].cfg.kind, crate::layers::EffectKind::Strobe);
        assert_eq!(
            effects[0].cfg.angle,
            std::f32::consts::FRAC_PI_2,
            "deck 2 originates at displayed right"
        );
        assert_eq!(
            state.low_latency_render_seq.load(Ordering::Acquire),
            1,
            "one deck event requests one immediate render"
        );
    }

    #[test]
    fn pioneer_loop_transitions_fire_only_rings() {
        for event in [
            PioneerVisualEvent::LoopStarted(1),
            PioneerVisualEvent::LoopWrap(1),
            PioneerVisualEvent::LoopEnded(1),
        ] {
            let state = SharedState::new(crate::config::AppConfig::default());
            trigger_pioneer_visual(&state, event);
            let effects = state.effects.lock();
            assert_eq!(effects.len(), 1, "{event:?} created extra effects");
            assert_eq!(effects[0].cfg.kind, crate::layers::EffectKind::Ring);
        }
    }
}
