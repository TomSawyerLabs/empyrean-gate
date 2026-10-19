// A PRO DJ LINK set with no CDJs: two simulated players and a mixer playing a
// crate of invented tracks, and the gate's own reading of them, so `dj_link`
// nodes move in a playground, a demo or an agent's render the way they will
// on the night. The hardware is modelled as Pioneer reports it (play modes,
// on-air and master flags, beat numbers), and the gate's rules for reading it
// are ported from src-tauri (rhythm.rs: events from status changes; engine:
// the eased mix and the phrase key; prolink_analysis.rs: phrases), so the
// same button presses fire the same events, quirks included. An Auto DJ plays
// the set; a person or an agent can take the decks over at any point.
// plans/dj-link-simulator.md has the reasoning.

/** The set's tempo: every deck is beatmatched to it, as a DJ would. */
export const SET_BPM = 122;

/** The `dj_link` node's event outputs, in `fireDjEvent` index order
 * (`DJ_EVENT_*` in the crate's eval.rs). */
export const DJ_EVENTS = [
  "play",
  "cue",
  "cue_release",
  "on_air_event",
  "off_air_event",
  "loop_start",
  "loop_wrap",
  "loop_end",
  "jump",
  "phrase_change",
  "fill_in",
] as const;
export type DjEvent = (typeof DJ_EVENTS)[number];

/** The `dj_link` node's scalar outputs, in `setDjLink` order. */
export const DJ_SCALARS = [
  "active",
  "energy",
  "deck",
  "deck_side",
  "event_deck",
  "event_side",
  "playing",
  "on_air",
  "deck_1_on_air",
  "deck_2_on_air",
  "looping",
  "mix",
  "mix_activity",
  "beat_in_bar",
  "phrase_active",
  "phrase_kind",
  "phrase_progress",
  "phrase_fill",
] as const;
export type DjScalar = (typeof DJ_SCALARS)[number];

/** rekordbox phrase kinds, as the gate names them (verses collapse to one). */
export type PhraseKind = "intro" | "up" | "down" | "chorus" | "outro" | "verse" | "bridge";

/** `phrase_kind`'s codes (`phrase_kind_code` in prolink_analysis.rs). */
export const PHRASE_CODES: Record<PhraseKind, number> = {
  intro: 1,
  up: 2,
  down: 3,
  chorus: 4,
  outro: 5,
  verse: 6,
  bridge: 7,
};

/** One phrase of a track's rekordbox analysis. */
export interface SimPhrase {
  kind: PhraseKind;
  beats: number;
  /** A fill-in over the phrase's last `fill` beats. */
  fill?: number;
}

/** Something the Auto DJ does when a track it is playing on air reaches
 * beat `at`: a loop of `beats` held for `laps` jumps back, or a hot cue
 * jump to beat `jumpTo`. Once per load. */
export interface SimMove {
  at: number;
  loop?: { beats: number; laps: number };
  jumpTo?: number;
}

export interface SimTrack {
  title: string;
  artist: string;
  /** rekordbox's mood: high tracks phrase as up/down/chorus, mid and low as
   * verse/bridge/chorus. */
  mood: "high" | "mid" | "low";
  /** The key's root as a MIDI note (for a host that plays the set out
   * loud); minor. */
  root?: number;
  phrases: SimPhrase[];
  moves?: SimMove[];
}

/** The built-in crate. Invented tracks; their shapes are typical of the
 * genre, shortened so a visitor sees a mix within a couple of minutes. */
export const CRATE: readonly SimTrack[] = [
  {
    title: "Ember Theory",
    artist: "Halcyon Static",
    mood: "high",
    root: 45,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "up", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "down", beats: 16 },
      { kind: "up", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "outro", beats: 32 },
    ],
    // Hold the second build's last bar for three more laps.
    moves: [{ at: 109, loop: { beats: 4, laps: 3 } }],
  },
  {
    title: "Tidewater",
    artist: "The Lantern Choir",
    mood: "mid",
    root: 50,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "verse", beats: 32 },
      { kind: "bridge", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "verse", beats: 16 },
      { kind: "chorus", beats: 32, fill: 4 },
      { kind: "outro", beats: 32 },
    ],
    // As the second chorus lands, a hot cue back to the first one.
    moves: [{ at: 129, jumpTo: 81 }],
  },
  {
    title: "Low Orbit",
    artist: "Cassini Drift",
    mood: "low",
    root: 43,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "verse", beats: 32 },
      { kind: "bridge", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "outro", beats: 32 },
    ],
    // A loop roll on the bridge's fill-in, into the chorus.
    moves: [{ at: 77, loop: { beats: 2, laps: 3 } }],
  },
  {
    title: "Night Market",
    artist: "Paper Tigers Club",
    mood: "high",
    root: 48,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "up", beats: 32, fill: 8 },
      { kind: "chorus", beats: 32 },
      { kind: "down", beats: 32 },
      { kind: "up", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "outro", beats: 32 },
    ],
    // Cut the breakdown short: halfway through it, jump to the build.
    moves: [{ at: 113, jumpTo: 129 }],
  },
  {
    title: "Glasswing",
    artist: "Mirror Pilots",
    mood: "mid",
    root: 52,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "verse", beats: 32 },
      { kind: "chorus", beats: 32 },
      { kind: "bridge", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32, fill: 4 },
      { kind: "outro", beats: 32 },
    ],
    // Ride the last chorus's final two bars around twice.
    moves: [{ at: 137, loop: { beats: 8, laps: 2 } }],
  },
];

/** A phrase placed on its track: beat numbers count from 1, as rekordbox's. */
export interface PlacedPhrase {
  number: number;
  kind: PhraseKind;
  start: number;
  end: number;
  /** The first beat of the fill-in, if it has one. */
  fillFrom: number | null;
}

export interface TrackLayout {
  phrases: PlacedPhrase[];
  /** The track's length in beats. */
  beats: number;
  /** Where the Auto DJ brings the next track in: the outro's first beat, or
   * 32 beats from the end. */
  mixAt: number;
}

const layouts = new WeakMap<SimTrack, TrackLayout>();

/** Where a track's phrases fall. */
export function trackLayout(track: SimTrack): TrackLayout {
  let l = layouts.get(track);
  if (l) return l;
  const phrases: PlacedPhrase[] = [];
  let start = 1;
  track.phrases.forEach((p, i) => {
    const beats = Math.max(1, Math.round(p.beats));
    const end = start + beats - 1;
    const fill = p.fill ? Math.min(beats, Math.max(1, Math.round(p.fill))) : 0;
    phrases.push({ number: i + 1, kind: p.kind, start, end, fillFrom: fill ? end - fill + 1 : null });
    start = end + 1;
  });
  const beats = start - 1;
  const outro = [...phrases].reverse().find((p) => p.kind === "outro");
  l = { phrases, beats, mixAt: outro ? outro.start : Math.max(1, beats - 31) };
  layouts.set(track, l);
  return l;
}

/** The phrase under the playhead (`active_phrase` in prolink_analysis.rs). */
export function phraseAt(
  layout: TrackLayout,
  beat: number,
  phase: number,
): { phrase: PlacedPhrase; progress: number; fill: boolean } | null {
  const phrase = layout.phrases.find((p) => beat >= p.start && beat <= p.end);
  if (!phrase) return null;
  const length = Math.max(1, phrase.end - phrase.start + 1);
  const elapsed = beat - phrase.start + Math.min(Math.max(phase, 0), 0.999999);
  return {
    phrase,
    progress: Math.min(1, Math.max(0, elapsed / length)),
    fill: phrase.fillFrom !== null && beat >= phrase.fillFrom,
  };
}

/** The sound of a track at a point, as audio features 0..1. */
export interface TrackSound {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  onset: number;
}

// How each kind of phrase sounds: kick (0 = none, 0.5 = half time), the
// bassline, mids and highs, and the overall level, each from → to across the
// phrase.
const CHARACTER: Record<PhraseKind, { kick: number; bass: number; mid: number; treble: [number, number]; level: [number, number] }> = {
  intro: { kick: 1, bass: 0.45, mid: 0.3, treble: [0.4, 0.5], level: [0.5, 0.6] },
  up: { kick: 1, bass: 0.6, mid: 0.5, treble: [0.4, 0.9], level: [0.6, 0.88] },
  chorus: { kick: 1, bass: 1, mid: 0.7, treble: [0.7, 0.75], level: [0.95, 0.95] },
  down: { kick: 0, bass: 0.15, mid: 0.65, treble: [0.25, 0.35], level: [0.42, 0.45] },
  outro: { kick: 1, bass: 0.6, mid: 0.3, treble: [0.45, 0.3], level: [0.6, 0.35] },
  verse: { kick: 1, bass: 0.75, mid: 0.55, treble: [0.5, 0.55], level: [0.72, 0.75] },
  bridge: { kick: 0.5, bass: 0.4, mid: 0.6, treble: [0.35, 0.45], level: [0.5, 0.6] },
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** What a track sounds like at `pos` beats from its start (`t` seconds is
 * only for texture). A fill-in drops the kick for a snare roll. */
export function trackSound(layout: TrackLayout, pos: number, t: number): TrackSound {
  const beat = Math.floor(pos) + 1;
  const phase = pos - Math.floor(pos);
  const at = phraseAt(layout, beat, phase);
  if (!at) return { level: 0, bass: 0, mid: 0, treble: 0, onset: 0 };
  const c = CHARACTER[at.phrase.kind];
  const p = at.progress;
  // Half time: a kick on every other beat.
  const kickOn = c.kick >= 1 || (c.kick > 0 && beat % 2 === 1) ? 1 : 0;
  const kick = at.fill ? 0 : Math.exp(-phase * 7) * kickOn;
  const sixteenth = (pos * 4) % 1;
  const roll = at.fill ? Math.exp(-sixteenth * 14) * (0.6 + 0.4 * phase) : 0;
  const swell = 0.5 + 0.5 * Math.sin(t * 0.21);
  const bass = clamp01(c.bass * (0.3 + 0.7 * kick * (0.7 + 0.3 * swell)));
  const mid = clamp01(c.mid + 0.18 * Math.sin(t * 1.7 + 1) + 0.1 * Math.sin(t * 4.3) + 0.25 * roll);
  const treble = clamp01(lerp(c.treble[0], c.treble[1], p) * (0.7 + 0.3 * Math.abs(Math.sin(t * 9.1))) + 0.2 * kick + 0.3 * roll);
  const level = clamp01(lerp(c.level[0], c.level[1], p) * (0.82 + 0.18 * kick + 0.12 * roll));
  return { level, bass, mid, treble, onset: Math.max(Math.exp(-phase * 24) * kickOn * (at.fill ? 0 : 1), roll) };
}

/** A player's transport, as Pioneer names its play modes. */
export type DeckMode = "empty" | "cued" | "playing" | "paused" | "cuePlaying" | "ended";

/** CDJ status play-mode bytes (status packet 0x7b) for each mode; looping
 * is its own code while playing. */
export const PLAY_MODES = { empty: 0x00, playing: 0x03, looping: 0x04, paused: 0x05, cued: 0x06, cuePlaying: 0x07, ended: 0x11 };

class Deck {
  track: number | null = null;
  /** Playhead in beats from the track's start: beat number floor(pos) + 1. */
  pos = 0;
  cuePoint = 0;
  mode: DeckMode = "empty";
  loop: { start: number; end: number } | null = null;
  /** Channel fader 0..1. */
  fader = 0;
  /** The set clock (beats) when it last started playing / was loaded. */
  startedAt = -Infinity;
  loadedAt = -Infinity;
  /** Times the loop jumped back since it was set. */
  laps = 0;
  /** The Auto DJ's bookkeeping for this load. */
  movesDone = new Set<number>();
  autoLoopLaps: number | null = null;
  previewUntil: number | null = null;
  previewed = false;
  prevBeat = 0;
  /** Beat periods played (the CDJ sends a beat packet on each), loops and
   * jumps included. */
  ticks = 0;

  constructor(readonly player: 1 | 2) {}

  get playing() {
    return this.mode === "playing" || this.mode === "cuePlaying";
  }
  get cued() {
    return this.mode === "cued" || this.mode === "cuePlaying";
  }
  get looping() {
    return this.mode === "playing" && this.loop !== null;
  }
  get played() {
    return this.startedAt > this.loadedAt;
  }
  layout(crate: readonly SimTrack[]): TrackLayout | null {
    const t = this.track === null ? undefined : crate[this.track];
    return t ? trackLayout(t) : null;
  }
  /** The beat number the CDJ reports (0 with no track). */
  beat(crate: readonly SimTrack[]): number {
    const l = this.layout(crate);
    return l ? Math.min(l.beats, Math.floor(this.pos) + 1) : 0;
  }
}

/** What one CDJ tells the gate in a frame. */
interface CdjStatus {
  player: number;
  playing: boolean;
  cued: boolean;
  cuePlaying: boolean;
  onAir: boolean;
  looping: boolean;
  /** 0 = no beat number. */
  beat: number;
  phase: number;
  /** Beat packets sent so far. */
  ticks: number;
  track: number | null;
  layout: TrackLayout | null;
  /** Analysed level at the playhead (rekordbox waveform). */
  level: number;
}

/** The gate's reading of the LINK: rhythm.rs's status diff, the engine's
 * mix easing and phrase key. Fed what the CDJs report each frame. */
class GateView {
  private seen = new Map<
    number,
    { playing: boolean; cued: boolean; cuePlaying: boolean; onAir: boolean; looping: boolean; beat: number; ticks: number; lastWrap: number }
  >();
  private beatInBar = new Map<number, number>();
  private phraseKey: [number, number, number, boolean] | null = null;
  fadePos = 0.5;
  fadeActivity = 0;
  lastPlayer = 0;
  readonly seq = new Array<number>(DJ_EVENTS.length).fill(0);

  /** One frame: `cdjs` empty when the LINK is unplugged. Returns the events
   * it records, in order, and leaves the scalars in `out`. */
  update(cdjs: CdjStatus[], followed: number, now: number, dt: number, out: Float32Array): [number, number][] {
    const events: [number, number][] = [];
    const record = (event: DjEvent, player: number) => {
      const i = DJ_EVENTS.indexOf(event);
      this.seq[i]!++;
      this.lastPlayer = player;
      events.push([i, player]);
    };

    for (const s of cdjs) {
      const d = this.seen.get(s.player);
      if (!d) {
        // A player seen for the first time announces nothing (rhythm.rs).
        const { playing, cued, cuePlaying, onAir, looping, beat, ticks } = s;
        this.seen.set(s.player, { playing, cued, cuePlaying, onAir, looping, beat, ticks, lastWrap: -Infinity });
        continue;
      }
      if (!d.playing && s.playing) record("play", s.player);
      if (!d.cued && s.cued) record("cue", s.player);
      if (!d.cuePlaying && s.cuePlaying) record("cue", s.player);
      if (d.cued && !s.cued) record("cue_release", s.player);
      if (d.onAir !== s.onAir) record(s.onAir ? "on_air_event" : "off_air_event", s.player);
      if (!d.looping && s.looping) record("loop_start", s.player);
      else if (d.looping && !s.looping) record("loop_end", s.player);
      if (d.playing && s.playing && d.beat > 0 && s.beat > 0) {
        // The jump back that announces a loop is loop_start, not a wrap.
        if (d.looping && s.looping && s.beat < d.beat) {
          if (now - d.lastWrap > 0.35) {
            record("loop_wrap", s.player);
            d.lastWrap = now;
          }
        } else if (!s.looping && (s.beat + 1 < d.beat || s.beat > d.beat + 8)) {
          // Hot cues and seeks show as a break in the beat counter.
          record("jump", s.player);
        }
      }
      // Beat packets: one per beat period while playing. The followed deck's
      // downbeats count as loop wraps too while it loops (with their own
      // cooldown), so a loop longer than a bar wraps on every bar.
      if (s.playing && s.beat > 0 && s.ticks !== d.ticks) {
        const bar = ((s.beat - 1) % 4) + 1;
        const hadBeat = this.beatInBar.has(s.player);
        this.beatInBar.set(s.player, bar);
        if (s.player === followed && d.looping && hadBeat && bar === 1 && now - d.lastWrap > 0.5) {
          record("loop_wrap", s.player);
          d.lastWrap = now;
        }
      }
      d.playing = s.playing;
      d.cued = s.cued;
      d.cuePlaying = s.cuePlaying;
      d.onAir = s.onAir;
      d.looping = s.looping;
      d.beat = s.beat;
      d.ticks = s.ticks;
    }

    const by = (n: number) => cdjs.find((s) => s.player === n);
    const sel = by(followed);
    const d1 = by(1)?.onAir ?? false;
    const d2 = by(2)?.onAir ?? false;

    // The mix: discrete on-air flags eased into a position (engine/mod.rs).
    const target = d1 && !d2 ? 0 : !d1 && d2 ? 1 : d1 && d2 ? 0.5 : this.fadePos;
    const previous = this.fadePos;
    this.fadePos += (target - this.fadePos) * Math.min(dt / 0.9, 1);
    const motion = clamp01(Math.abs(this.fadePos - previous) / Math.max(dt, 0.001));
    this.fadeActivity = Math.max(this.fadeActivity * Math.exp(-dt / 0.55), motion);

    // The followed deck's phrase, and its changes.
    const at = sel?.layout && sel.track !== null ? phraseAt(sel.layout, sel.beat, sel.phase) : null;
    const key: [number, number, number, boolean] | null = at && sel ? [sel.player, sel.track!, at.phrase.number, at.fill] : null;
    const prev = this.phraseKey;
    if (key) {
      if (prev && (prev[0] !== key[0] || prev[1] !== key[1] || prev[2] !== key[2])) record("phrase_change", key[0]);
      else if (prev && !prev[3] && key[3]) record("fill_in", key[0]);
      else if (!prev) record("phrase_change", key[0]);
    }
    this.phraseKey = key;

    // Energy (`pioneer_energy`): the followed deck if it plays, else any
    // playing deck's analysed level.
    const active = cdjs.length > 0;
    let candidates = cdjs.filter((s) => s.playing && (followed > 0 && followed < 32 ? s.player === followed : s.onAir));
    if (candidates.length === 0) candidates = cdjs.filter((s) => s.playing);
    const energy = active ? clamp01(candidates.reduce((m, s) => Math.max(m, s.level), 0)) : 0;

    const side = (p: number) => (p === 1 ? -1 : p === 2 ? 1 : 0);
    const player = active ? followed : 0;
    const values: Record<DjScalar, number> = {
      active: active ? 1 : 0,
      energy,
      deck: player,
      deck_side: side(player),
      event_deck: this.lastPlayer,
      event_side: side(this.lastPlayer),
      playing: sel?.playing ? 1 : 0,
      on_air: sel?.onAir ? 1 : 0,
      deck_1_on_air: d1 ? 1 : 0,
      deck_2_on_air: d2 ? 1 : 0,
      looping: cdjs.some((s) => (s.player === 1 || s.player === 2) && s.looping) ? 1 : 0,
      mix: this.fadePos,
      mix_activity: this.fadeActivity,
      beat_in_bar: sel ? (this.beatInBar.get(sel.player) ?? 0) : 0,
      phrase_active: at ? 1 : 0,
      phrase_kind: at ? PHRASE_CODES[at.phrase.kind] : 0,
      phrase_progress: at ? at.progress : 0,
      phrase_fill: at?.fill ? 1 : 0,
    };
    DJ_SCALARS.forEach((name, i) => (out[i] = values[name]));
    return events;
  }
}

/** One deck as a UI shows it. */
export interface DjDeckState {
  player: 1 | 2;
  /** Index into the crate, or null when empty. */
  track: number | null;
  title: string | null;
  artist: string | null;
  mode: DeckMode;
  /** The CDJ's play-mode byte. */
  playMode: number;
  looping: boolean;
  /** The loop's length in beats while one is set. */
  loopBeats: number | null;
  /** The loop's playhead range (`position` units) while one is set. */
  loopRange: [number, number] | null;
  /** The playhead in beats from the track's start (beat number is
   * floor(position) + 1). */
  position: number;
  beat: number;
  beats: number;
  /** 1..4, from the beat grid. */
  beatInBar: number;
  phrase: { number: number; kind: PhraseKind; progress: number; fill: boolean } | null;
  /** The track's phrases, for a strip. */
  phrases: PlacedPhrase[];
  onAir: boolean;
  master: boolean;
  fader: number;
  /** What the audience hears of it, 0..1 (fader × crossfader). */
  gain: number;
}

export interface DjLinkState {
  connected: boolean;
  auto: boolean;
  /** Seconds since the set started. */
  time: number;
  /** Beats since the set started. */
  clock: number;
  bpm: number;
  crossfader: number;
  decks: [DjDeckState, DjDeckState];
  /** The deck the gate follows (the tempo master), 0 when unplugged. */
  followed: number;
  /** The `dj_link` node's outputs as the patch sees them now. */
  outputs: Record<DjScalar, number>;
  /** When each event last fired (seconds on `time`'s clock) and from which
   * player, or null. */
  lastFired: Record<DjEvent, { at: number; player: number } | null>;
}

export interface DjLinkSimOptions {
  crate?: readonly SimTrack[];
  bpm?: number;
}

/** A deck action, by name (for tools and buttons). */
export type DeckAction =
  | { action: "play" }
  | { action: "cue" }
  | { action: "cue_release" }
  | { action: "loop"; beats: number }
  | { action: "exit_loop" }
  | { action: "beat_jump"; beats: number }
  | { action: "hot_cue"; beat: number }
  | { action: "load"; track: number }
  | { action: "fader"; value: number }
  | { action: "master" };

const FRAME = 1 / 60;

/**
 * Two CDJs, a mixer, an Auto DJ, and the gate reading them. `step(dt)` every
 * frame gives the events that fired; `scalars()` the 18 values for
 * `setDjLink`; `audio()` what the room hears, for `setAudio`. A function of
 * time from `reset(at)` while Auto plays, so a capture repeats.
 *
 * The deck controls behave like a CDJ's (with quantize and sync on): `play`
 * toggles, `cueDown`/`cueUp` are the CUE button held and let go (back to the
 * cue point while playing; cue-play while held at it), loops start on the
 * beat. Any of them, from a person or an agent, turns Auto off.
 */
export class DjLinkSim {
  readonly crate: readonly SimTrack[];
  readonly bpm: number;
  /** The LINK cable: unplugged, every output reads as on a gate with no
   * CDJs (`active` 0). The music plays on. */
  connected = true;
  /** The Auto DJ is playing the set. */
  auto = true;
  crossfader = 0.5;
  master: 1 | 2 = 1;
  private decks: [Deck, Deck] = [new Deck(1), new Deck(2)];
  private t = 0;
  private clock = 0;
  private nextTrack = 0;
  private view = new GateView();
  private out = new Float32Array(DJ_SCALARS.length);
  private last: Record<DjEvent, { at: number; player: number } | null> = blankFired();

  constructor(options: DjLinkSimOptions = {}) {
    this.crate = options.crate?.length ? options.crate : CRATE;
    this.bpm = options.bpm ?? SET_BPM;
    this.reset(0);
  }

  /** Seconds since the set started. */
  get time(): number {
    return this.t;
  }

  /** Start the set again and play it to `at` seconds (as Auto would have),
   * quietly: what was fired on the way is forgotten. `connected` and `auto`
   * stay as they are. */
  reset(at = 0): void {
    const { connected, auto } = this;
    this.t = 0;
    this.clock = 0;
    this.crossfader = 0.5;
    this.master = 1;
    this.decks = [new Deck(1), new Deck(2)];
    this.view = new GateView();
    // As if the gate had been watching the set all along: deck 1 alone on air.
    this.view.fadePos = 0;
    this.nextTrack = 0;
    // The set opens with the first track playing on air and the second
    // ready on the other deck.
    const [a, b] = this.decks;
    this.loadDeck(a, this.takeNext());
    a.fader = 1;
    a.mode = "playing";
    a.startedAt = 0;
    this.loadDeck(b, this.takeNext());
    b.previewed = true;
    this.connected = true;
    this.auto = true;
    for (let n = Math.round(Math.max(0, at) / FRAME); n > 0; n--) this.step(FRAME);
    // The gate has seen the decks; now the outputs as the flags say.
    this.step(0);
    this.connected = connected;
    this.auto = auto;
    this.step(0);
    this.last = blankFired();
  }

  /** Advance `dt` seconds. Returns the events the gate recorded, as
   * `[index into DJ_EVENTS, player]`, in order. */
  step(dt: number): [number, number][] {
    dt = Math.max(0, dt);
    this.t += dt;
    const beats = (dt * this.bpm) / 60;
    this.clock += beats;
    for (const d of this.decks) {
      d.prevBeat = d.beat(this.crate);
      this.advance(d, beats);
    }
    if (this.auto) this.autoDj(beats);

    const cdjs: CdjStatus[] = this.connected ? this.decks.map((d) => this.status(d)) : [];
    const followed = this.connected ? this.master : 0;
    const events = this.view.update(cdjs, followed, this.t, dt, this.out);
    for (const [i, player] of events) this.last[DJ_EVENTS[i]!] = { at: this.t, player };
    return events;
  }

  /** The `dj_link` scalars, in `setDjLink` order. */
  scalars(): Float32Array {
    return this.out;
  }

  /** What the room hears: the decks through the faders and crossfader, as
   * `setAudio` features (level, bass, mid, treble, onset, beat phase, bpm,
   * bpm confidence, bass/mid/treble again as the attenuated values). */
  audio(): Float32Array {
    let level = 0;
    let bass = 0;
    let mid = 0;
    let treble = 0;
    let onset = 0;
    let heard = 0;
    for (const d of this.decks) {
      const g = this.gain(d);
      const l = d.layout(this.crate);
      if (!d.playing || g < 0.02 || !l) continue;
      const s = trackSound(l, d.pos, this.t);
      level += s.level * g;
      bass += s.bass * g;
      mid += s.mid * g;
      treble += s.treble * g;
      onset = Math.max(onset, s.onset * g);
      heard = Math.max(heard, g);
    }
    if (heard === 0) return new Float32Array(11);
    const phase = this.clock - Math.floor(this.clock);
    [level, bass, mid, treble] = [level, bass, mid, treble].map(clamp01) as [number, number, number, number];
    return new Float32Array([level, bass, mid, treble, onset, phase, this.bpm, 1, bass, mid, treble]);
  }

  /** Everything a UI shows. */
  state(): DjLinkState {
    const outputs = {} as Record<DjScalar, number>;
    DJ_SCALARS.forEach((name, i) => (outputs[name] = this.out[i]!));
    return {
      connected: this.connected,
      auto: this.auto,
      time: this.t,
      clock: this.clock,
      bpm: this.bpm,
      crossfader: this.crossfader,
      decks: [this.deckState(this.decks[0]), this.deckState(this.decks[1])],
      followed: this.connected ? this.master : 0,
      outputs,
      lastFired: { ...this.last },
    };
  }

  // ---- A person's (or an agent's) hands on the decks: Auto steps aside.

  /** One deck action, as the buttons and the agent tool name them. */
  act(player: 1 | 2, a: DeckAction): void {
    this.auto = false;
    const d = this.decks[player - 1];
    switch (a.action) {
      case "play":
        return this.playDeck(d);
      case "cue":
        return this.cueDown(d);
      case "cue_release":
        return this.cueUp(d);
      case "loop":
        return this.setLoop(d, a.beats);
      case "exit_loop":
        d.loop = null;
        return;
      case "beat_jump":
        return this.jumpTo(d, d.beat(this.crate) + Math.round(a.beats));
      case "hot_cue":
        return this.jumpTo(d, Math.round(a.beat));
      case "load":
        return this.loadDeck(d, Math.round(a.track));
      case "fader":
        d.fader = clamp01(a.value);
        return;
      case "master":
        this.master = player;
        return;
    }
  }

  setCrossfader(x: number): void {
    this.auto = false;
    this.crossfader = clamp01(x);
  }

  // ---- The CDJ.

  private advance(d: Deck, beats: number) {
    if (!d.playing) return;
    const l = d.layout(this.crate);
    if (!l) return;
    let p = d.pos + beats;
    if (Math.floor(p) !== Math.floor(d.pos)) d.ticks++;
    if (d.looping && d.loop && d.pos < d.loop.end && p >= d.loop.end) {
      p = d.loop.start + ((p - d.loop.end) % (d.loop.end - d.loop.start));
      d.laps++;
    }
    if (p >= l.beats) {
      // The end of the track: the player stops there.
      p = l.beats - 1e-6;
      d.mode = "ended";
      d.loop = null;
    }
    d.pos = p;
  }

  /** Quantize: a deck that starts plays in phase with the set's clock. */
  private phase() {
    return this.clock - Math.floor(this.clock);
  }

  private playDeck(d: Deck) {
    if (d.track === null) return;
    switch (d.mode) {
      case "playing":
        d.mode = "paused";
        return;
      case "cuePlaying":
        // PLAY while CUE is held: it keeps playing when CUE is let go.
        d.mode = "playing";
        d.startedAt = this.clock;
        return;
      case "ended":
        return;
      default:
        d.pos = Math.floor(d.pos) + this.phase();
        d.mode = "playing";
        d.startedAt = this.clock;
    }
  }

  private cueDown(d: Deck) {
    if (d.track === null) return;
    if (d.mode === "playing") {
      d.pos = d.cuePoint;
      d.loop = null;
      d.mode = "cued";
    } else if (d.mode === "cued") {
      d.pos = d.cuePoint + this.phase();
      d.mode = "cuePlaying";
    } else if (d.mode === "paused" || d.mode === "ended") {
      // Paused away from the cue: CUE sets it here (on the beat).
      d.cuePoint = Math.round(d.pos);
      d.pos = d.cuePoint;
      d.mode = "cued";
    }
  }

  private cueUp(d: Deck) {
    if (d.mode !== "cuePlaying") return;
    d.pos = d.cuePoint;
    d.mode = "cued";
  }

  private setLoop(d: Deck, beats: number) {
    const l = d.layout(this.crate);
    if (!l) return;
    const n = Math.max(1, Math.round(beats));
    const start = Math.floor(d.pos);
    d.loop = { start, end: Math.min(l.beats, start + n) };
    d.laps = 0;
    d.autoLoopLaps = null;
  }

  private jumpTo(d: Deck, beat: number) {
    const l = d.layout(this.crate);
    if (!l) return;
    const b = Math.min(l.beats, Math.max(1, beat));
    d.pos = b - 1 + (d.pos - Math.floor(d.pos));
    d.loop = null;
    if (d.mode === "ended") d.mode = "paused";
  }

  private loadDeck(d: Deck, track: number) {
    if (track < 0 || track >= this.crate.length) return;
    d.track = track;
    d.pos = 0;
    d.cuePoint = 0;
    d.mode = "cued";
    d.loop = null;
    d.laps = 0;
    d.loadedAt = this.clock;
    d.startedAt = -Infinity;
    d.movesDone = new Set();
    d.autoLoopLaps = null;
    d.previewUntil = null;
    d.previewed = false;
  }

  private takeNext(): number {
    const n = this.nextTrack % this.crate.length;
    this.nextTrack = n + 1;
    return n;
  }

  // ---- The mixer.

  /** Fader × crossfader (a sharp curve: both full in the middle). */
  private gain(d: Deck): number {
    const x = d.player === 1 ? Math.min(1, 2 * (1 - this.crossfader)) : Math.min(1, 2 * this.crossfader);
    return d.fader * x;
  }

  private status(d: Deck): CdjStatus {
    const l = d.layout(this.crate);
    const beat = d.beat(this.crate);
    return {
      player: d.player,
      playing: d.playing,
      cued: d.cued,
      cuePlaying: d.mode === "cuePlaying",
      onAir: this.gain(d) > 0.02,
      looping: d.looping,
      beat,
      phase: d.pos - Math.floor(d.pos),
      ticks: d.ticks,
      track: d.track,
      layout: l,
      level: l && d.playing ? trackSound(l, d.pos, this.t).level : 0,
    };
  }

  private deckState(d: Deck): DjDeckState {
    const l = d.layout(this.crate);
    const beat = d.beat(this.crate);
    const at = l ? phraseAt(l, beat, d.pos - Math.floor(d.pos)) : null;
    const track = d.track === null ? null : (this.crate[d.track] ?? null);
    return {
      player: d.player,
      track: d.track,
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      mode: d.mode,
      playMode: d.looping ? PLAY_MODES.looping : PLAY_MODES[d.mode],
      looping: d.looping,
      loopBeats: d.loop ? d.loop.end - d.loop.start : null,
      loopRange: d.loop ? [d.loop.start, d.loop.end] : null,
      position: d.pos,
      beat,
      beats: l?.beats ?? 0,
      beatInBar: beat > 0 ? ((beat - 1) % 4) + 1 : 0,
      phrase: at ? { number: at.phrase.number, kind: at.phrase.kind, progress: at.progress, fill: at.fill } : null,
      phrases: l?.phrases ?? [],
      onAir: this.gain(d) > 0.02,
      master: this.master === d.player,
      fader: d.fader,
      gain: this.gain(d),
    };
  }

  // ---- The Auto DJ: a policy over the decks' state, so it can take over
  // from wherever a person left them.

  private autoDj(beats: number) {
    let m = this.decks[this.master - 1];
    let o = this.decks[2 - this.master];
    const ramp = (d: Deck, target: number, perBeat: number) => {
      const step = perBeat * beats;
      d.fader = d.fader < target ? Math.min(target, d.fader + step) : Math.max(target, d.fader - step);
    };

    // The master stopped while the other plays: follow the music.
    if (!m.playing && o.playing) {
      this.master = o.player;
      [m, o] = [o, m];
    }
    // Nothing playing: start whichever deck is ready, loading one if need be.
    if (!m.playing && !o.playing) {
      const ready = (d: Deck) => d.track !== null && d.mode !== "ended";
      const d = ready(m) ? m : ready(o) ? o : m;
      if (!ready(d)) this.loadDeck(d, this.takeNext());
      if (d.mode === "cuePlaying") this.cueUp(d);
      this.playDeck(d);
      d.fader = 1;
      this.master = d.player;
      if (d !== m) [m, o] = [o, m];
    }

    const ml = m.layout(this.crate);
    const beat = m.beat(this.crate);
    const crossed = (at: number) => m.prevBeat < at && beat >= at;

    // The master's performance moves, while it is on air.
    if (ml && m.playing && this.gain(m) > 0.02 && m.track !== null) {
      this.crate[m.track]!.moves?.forEach((move, i) => {
        if (m.movesDone.has(i) || !crossed(move.at)) return;
        m.movesDone.add(i);
        if (move.loop) {
          this.setLoop(m, move.loop.beats);
          m.autoLoopLaps = move.loop.laps;
        } else if (move.jumpTo !== undefined) {
          this.jumpTo(m, move.jumpTo);
        }
      });
    }
    // Out of a move's loop halfway through its last lap, as a DJ would
    // press exit (on the wrap itself it would read as a jump).
    for (const d of this.decks) {
      if (d.loop && d.autoLoopLaps !== null && d.laps >= d.autoLoopLaps && d.pos >= (d.loop.start + d.loop.end) / 2) {
        d.loop = null;
        d.autoLoopLaps = null;
      }
    }

    // The other deck: once it is out of the mix and done, the next track
    // goes on it; a few beats later the DJ checks it in the headphones.
    if (!o.playing && o.fader < 0.01 && (o.track === null || o.mode === "ended" || o.played)) {
      this.loadDeck(o, this.takeNext());
    }
    if (o.mode === "cued" && !o.previewed && this.clock - o.loadedAt >= 8) {
      o.previewed = true;
      this.cueDown(o);
      o.previewUntil = this.clock + 4;
    }
    if (o.mode === "cuePlaying" && o.previewUntil !== null && this.clock >= o.previewUntil) {
      this.cueUp(o);
      o.previewUntil = null;
    }

    // Bring it in on the master's mix point (or a later 16-beat line, if
    // Auto took over late), phrase-aligned.
    if (ml && m.playing && o.mode === "cued" && o.pos === o.cuePoint && beat > m.prevBeat && beat >= ml.mixAt && (beat - ml.mixAt) % 16 === 0) {
      this.playDeck(o);
    }

    // Faders: the master up; an incoming deck up after two bars, taking the
    // master once it is full; an outgoing deck down over three bars and
    // stopped if much of it is left.
    // (A cue preview is in the headphones: not part of the mix.)
    if (m.playing) ramp(m, 1, 0.5);
    if (o.mode === "cuePlaying") {
      ramp(o, 0, 1 / 4);
    } else if (o.playing && o.startedAt > m.startedAt) {
      if (this.clock - o.startedAt >= 8) ramp(o, 1, 1 / 8);
      if (o.fader >= 1 && this.clock - o.startedAt >= 16) {
        this.master = o.player;
      }
    } else if (o.playing) {
      ramp(o, 0, 1 / 12);
      const ol = o.layout(this.crate);
      if (o.fader === 0 && ol && ol.beats - o.pos > 33) this.playDeck(o);
    } else {
      ramp(o, 0, 1 / 4);
    }
    const x = this.crossfader;
    this.crossfader = x < 0.5 ? Math.min(0.5, x + beats / 8) : Math.max(0.5, x - beats / 8);
  }
}

function blankFired(): Record<DjEvent, { at: number; player: number } | null> {
  return Object.fromEntries(DJ_EVENTS.map((e) => [e, null])) as Record<DjEvent, { at: number; player: number } | null>;
}
