// The simulated DJ set (djlink.ts), out loud: Web Audio voices playing what
// each deck's track would sound like at its playhead (a house groove whose
// parts follow the rekordbox phrases: no kick in a breakdown, a riser on a
// build, a snare roll on a fill-in, a crash as a chorus lands), each deck
// through its channel fader and the crossfader. Output only: the patch's
// audio features stay the simulator's own, so captures repeat; this is for
// the person at the playground, started by their click as browsers require.

import type { DjDeckState, DjLinkSim } from "./djlink";
import { phraseAt, trackLayout, type PhraseKind, type SimTrack } from "./djlink";
import type { PatchRuntime } from "./index";

/** One sound on one sixteenth note. `v` is velocity 0..1. */
export type DjNote =
  | { voice: "kick"; v: number }
  | { voice: "hat"; v: number; open: boolean }
  | { voice: "clap"; v: number }
  | { voice: "snare"; v: number; pitch: number }
  | { voice: "bass"; v: number; midi: number }
  | { voice: "pad"; v: number; midis: number[]; beats: number }
  | { voice: "swell"; v: number; cutoff: number }
  | { voice: "crash"; v: number };

// A minor-key loop of four chords, one per bar: i, VI, III, VII.
const PROGRESSION: { offset: number; minor: boolean }[] = [
  { offset: 0, minor: true },
  { offset: -4, minor: false },
  { offset: 3, minor: false },
  { offset: -2, minor: false },
];

// Which parts play in each kind of phrase: kick (1 = four to the floor,
// 0.5 = half time), hats (0 none, 1 off-beats, 2 sixteenths), claps on 2
// and 4, the bassline, pads (and how loud).
const PARTS: Record<PhraseKind, { kick: number; hats: number; clap: boolean; bass: boolean; pad: number }> = {
  intro: { kick: 1, hats: 1, clap: false, bass: false, pad: 0.35 },
  up: { kick: 1, hats: 2, clap: true, bass: true, pad: 0 },
  chorus: { kick: 1, hats: 2, clap: true, bass: true, pad: 0.45 },
  down: { kick: 0, hats: 0, clap: false, bass: false, pad: 1 },
  outro: { kick: 1, hats: 1, clap: false, bass: true, pad: 0 },
  verse: { kick: 1, hats: 1, clap: true, bass: true, pad: 0.25 },
  bridge: { kick: 0.5, hats: 1, clap: false, bass: false, pad: 0.7 },
};

/** What a track plays on the sixteenth note starting `step` sixteenths
 * from its start. Pure: the same step always sounds the same. */
export function notesAt(track: SimTrack, step: number): DjNote[] {
  const layout = trackLayout(track);
  const pos = step / 4;
  const beat = Math.floor(pos) + 1;
  const sixteenth = ((step % 4) + 4) % 4;
  const at = phraseAt(layout, beat, pos - Math.floor(pos));
  if (!at) return [];
  const parts = PARTS[at.phrase.kind];
  const out: DjNote[] = [];
  const root = track.root ?? 45;
  const bar = Math.floor((beat - 1) / 4);
  const chord = PROGRESSION[((bar % 4) + 4) % 4]!;
  const onBeat = sixteenth === 0;
  const firstOfPhrase = beat === at.phrase.start && onBeat;

  if (at.fill) {
    // The fill-in: a snare roll climbing through the phrase's last beats,
    // over the bass alone.
    const fillLength = at.phrase.end - at.phrase.fillFrom! + 1;
    const through = Math.min(1, (pos - (at.phrase.fillFrom! - 1)) / fillLength);
    out.push({ voice: "snare", v: 0.35 + 0.55 * through, pitch: 1 + through });
  } else {
    const kickHere = onBeat && (parts.kick >= 1 || (parts.kick > 0 && beat % 2 === 1));
    if (kickHere) out.push({ voice: "kick", v: 1 });
    if (parts.clap && sixteenth === 0 && beat % 2 === 0) out.push({ voice: "clap", v: 0.8 });
    if (parts.hats === 2) out.push({ voice: "hat", v: sixteenth === 2 ? 0.55 : 0.25, open: false });
    else if (parts.hats === 1 && sixteenth === 2) out.push({ voice: "hat", v: 0.45, open: at.phrase.kind === "verse" });
  }
  if (parts.bass && sixteenth === 2) {
    out.push({ voice: "bass", v: 0.8, midi: root + chord.offset - 12 });
  }
  if (parts.pad > 0 && onBeat && (beat - 1) % 4 === 0) {
    const third = chord.minor ? 3 : 4;
    const base = root + chord.offset + 12;
    out.push({ voice: "pad", v: parts.pad, midis: [base, base + third, base + 7], beats: 4 });
  }
  if (at.phrase.kind === "up" && onBeat && !at.fill) {
    // The build's riser, a swell a beat long that opens as the phrase goes.
    out.push({ voice: "swell", v: 0.15 + 0.45 * at.progress, cutoff: 500 + 7500 * at.progress });
  }
  if (firstOfPhrase && (at.phrase.kind === "chorus" || at.phrase.kind === "down")) {
    out.push({ voice: "crash", v: at.phrase.kind === "chorus" ? 0.7 : 0.45 });
  }
  return out;
}

/** The sixteenths a deck plays in the next `window` beats from its
 * playhead, as [track step, beats from now]: through its loop (wrapping as
 * the deck will) and not past the end of the track. */
export function upcomingSteps(
  deck: Pick<DjDeckState, "position" | "loopRange" | "looping" | "beats">,
  window: number,
): [number, number][] {
  const out: [number, number][] = [];
  const loop = deck.looping && deck.loopRange ? deck.loopRange : null;
  let pos = deck.position;
  let ahead = 0;
  // The first sixteenth may be the one the playhead is on; after that, one
  // grid step at a time (a loop's start is on the grid).
  let include = true;
  for (let guard = 0; guard < 512; guard++) {
    const next = include ? Math.ceil(pos * 4 - 1e-9) / 4 : pos + 0.25;
    include = false;
    if (loop && next >= loop[1]) {
      ahead += loop[1] - pos;
      pos = loop[0];
      include = true;
      if (ahead > window) break;
      continue;
    }
    ahead += next - pos;
    pos = next;
    if (ahead > window || next >= deck.beats) break;
    out.push([Math.round(next * 4), ahead]);
  }
  return out;
}

export interface DjSoundOptions {
  /** Master volume 0..1 (default 0.6). */
  volume?: number;
}

/** Seconds of sound scheduled ahead of the audio clock. */
const LOOKAHEAD = 0.12;
/** Headroom between "now" on the set's clock and when it is heard. */
const HEADROOM = 0.03;

/**
 * The set out loud. Create it from a click (`DjSound.listen`), and it follows
 * the runtime's frames until `stop()`.
 */
export class DjSound {
  readonly context: AudioContext;
  private master: GainNode;
  private analyser: AnalyserNode;
  private samples = new Float32Array(1024);
  private channels: GainNode[];
  private noise: AudioBuffer;
  private offset: number | null = null;
  private scheduled: number[] = [-Infinity, -Infinity];
  private offFrame: () => void;

  /** Start listening to `dj` (call it from a user gesture). */
  static async listen(runtime: PatchRuntime, dj: DjLinkSim, options: DjSoundOptions = {}): Promise<DjSound> {
    const context = new AudioContext({ latencyHint: "interactive" });
    await context.resume();
    return new DjSound(context, runtime, dj, options);
  }

  private constructor(
    context: AudioContext,
    runtime: PatchRuntime,
    private dj: DjLinkSim,
    options: DjSoundOptions,
  ) {
    this.context = context;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    limiter.connect(context.destination);
    this.master = context.createGain();
    this.master.gain.value = options.volume ?? 0.6;
    this.master.connect(limiter);
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 1024;
    limiter.connect(this.analyser);
    this.channels = [0, 1].map(() => {
      const g = context.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      return g;
    });
    this.noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // After the set has stepped (attachGroove's listener came first).
    this.offFrame = runtime.onFrame(() => this.tick());
  }

  get volume(): number {
    return this.master.gain.value;
  }
  set volume(v: number) {
    this.master.gain.setTargetAtTime(Math.min(1, Math.max(0, v)), this.context.currentTime, 0.03);
  }

  /** How loud it is right now, 0..1 (RMS of what is playing). */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const s of this.samples) sum += s * s;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 2);
  }

  /** Stop and let the audio device go (again is a no-op). */
  stop(): void {
    if (this.context.state === "closed") return;
    this.offFrame();
    this.context.close().catch(() => {});
  }

  private tick() {
    const ctx = this.context;
    if (ctx.state !== "running") return;
    const now = ctx.currentTime;
    const state = this.dj.state();
    // The set's clock against the audio clock, smoothed; a jump (a restart,
    // a hidden tab) starts it afresh.
    const target = now + HEADROOM - state.time;
    if (this.offset === null || Math.abs(target - this.offset) > 0.2) this.offset = target;
    else this.offset += (target - this.offset) * 0.05;
    const spb = 60 / state.bpm;

    state.decks.forEach((deck, i) => {
      const channel = this.channels[i]!;
      channel.gain.setTargetAtTime(deck.gain, now, 0.02);
      const track = deck.track === null ? null : this.dj.crate[deck.track];
      const playing = deck.mode === "playing" || deck.mode === "cuePlaying";
      if (!track || !playing || deck.gain < 0.01) return;
      for (const [step, ahead] of upcomingSteps(deck, LOOKAHEAD / spb + 0.25)) {
        const t = state.time + ahead * spb + this.offset!;
        if (t <= this.scheduled[i]! + 1e-4 || t < now || t > now + LOOKAHEAD) continue;
        this.scheduled[i] = t;
        for (const n of notesAt(track, step)) this.play(n, t, spb, channel);
      }
    });
  }

  private play(n: DjNote, t: number, spb: number, out: AudioNode) {
    const ctx = this.context;
    const env = (peak: number, attack: number, decay: number) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      g.connect(out);
      return g;
    };
    const noise = (into: AudioNode, length: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.connect(into);
      s.start(t, Math.random() * 1.5, length);
    };
    const osc = (type: OscillatorType, freq: number, into: AudioNode, length: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.connect(into);
      o.start(t);
      o.stop(t + length);
      return o;
    };
    const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
    switch (n.voice) {
      case "kick": {
        const g = env(0.9 * n.v, 0.002, 0.42);
        const o = osc("sine", 150, g, 0.45);
        o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
        return;
      }
      case "hat": {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 7500;
        hp.connect(env(0.22 * n.v, 0.001, n.open ? 0.22 : 0.05));
        noise(hp, n.open ? 0.25 : 0.06);
        return;
      }
      case "clap": {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1500;
        bp.Q.value = 0.9;
        bp.connect(env(0.5 * n.v, 0.004, 0.18));
        noise(bp, 0.2);
        return;
      }
      case "snare": {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1700 * n.pitch;
        bp.connect(env(0.32 * n.v, 0.002, 0.1));
        noise(bp, 0.12);
        osc("triangle", 180 * n.pitch, env(0.15 * n.v, 0.002, 0.07), 0.1);
        return;
      }
      case "bass": {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.Q.value = 6;
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.exponentialRampToValueAtTime(160, t + 0.2);
        lp.connect(env(0.38 * n.v, 0.005, 0.24));
        osc("sawtooth", hz(n.midi), lp, 0.3);
        return;
      }
      case "pad": {
        const length = n.beats * spb;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05 * n.v, t + Math.min(0.4, length / 3));
        g.gain.setValueAtTime(0.05 * n.v, t + length * 0.8);
        g.gain.linearRampToValueAtTime(0.0001, t + length);
        g.connect(out);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1400;
        lp.connect(g);
        for (const m of n.midis) {
          for (const detune of [-7, 7]) osc("sawtooth", hz(m), lp, length).detune.value = detune;
        }
        return;
      }
      case "swell": {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(n.cutoff, t);
        bp.frequency.exponentialRampToValueAtTime(n.cutoff * 1.3, t + spb);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.12 * n.v, t + spb * 0.9);
        g.gain.linearRampToValueAtTime(0.0001, t + spb);
        g.connect(out);
        bp.connect(g);
        noise(bp, spb);
        return;
      }
      case "crash": {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 4500;
        hp.connect(env(0.28 * n.v, 0.002, 1.6));
        noise(hp, 1.7);
        return;
      }
    }
  }
}
