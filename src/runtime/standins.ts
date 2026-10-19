// Stand-ins for the gate's live inputs that a browser (or an agent's headless
// render) has no source for, so every node kind does something anywhere:
//
// - `TestFilm`: Video in's picture when nobody has chosen a file or camera,
//   a short animated scene (sky, sun, rolling hills, a bouncing ball).
// - `attachVisitors`: people at the gate, tapping effects, drawing strokes
//   and, when the patch owns touch, touching with a finger or two.
// - `syntheticMotion`: someone dancing with the phone that holds motion.
//
// All pure TypeScript (no DOM), seeded and clocked by patch time, so a
// capture of the same patch repeats exactly.

import { GROOVE_BPM } from "./groove";
import type { Motion, MotionSource } from "./inputs";
import type { PatchRuntime } from "./index";

/** What the visitors need of a host: a `PatchRuntime`, or anything that can
 * step a patch and take its inputs the same way. */
export type VisitorHost = Pick<PatchRuntime, "onFrame" | "onRestart" | "getStatus" | "trigger" | "touch" | "draw">;

/** Where Video in's picture comes from: a file, a camera, or a stand-in. */
export interface VideoSource {
  /** Side of the square frames it gives. */
  readonly size: number;
  /** The frame `dt` seconds after the last, as `size`² RGBA; null when it
   * has not changed (a still picture) or is not ready yet. */
  frame(dt: number): Uint8Array | null;
  /** Start over (the runtime restarts the patch). */
  reset?(): void;
  dispose(): void;
}

/** A small, deterministic PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The stand-in film: dusk over rolling hills, a sun drifting across, stars
 * coming out, hills scrolling at two depths and a ball bouncing along them.
 * Colourful and always moving, so Video in, Texture sample and Brightness of
 * have something to show. */
export class TestFilm implements VideoSource {
  readonly size: number;
  private t = 0;
  private rgba: Uint8Array;

  constructor(size = 128) {
    this.size = size;
    this.rgba = new Uint8Array(size * size * 4);
  }

  reset() {
    this.t = 0;
  }

  frame(dt: number): Uint8Array {
    this.t += dt;
    const { size, rgba } = this;
    const t = this.t;
    const hueDrift = 0.04 * Math.sin(t * 0.05);
    const sunX = 0.5 + 0.32 * Math.sin(t * 0.11);
    const sunY = 0.42 + 0.08 * Math.cos(t * 0.11);
    const ballX = ((t * 0.17) % 1.2) - 0.1;
    const hill = (x: number, depth: number) =>
      depth === 0
        ? 0.66 + 0.05 * Math.sin((x + t * 0.03) * 7.1) + 0.03 * Math.sin((x + t * 0.03) * 17.3 + 1)
        : 0.78 + 0.06 * Math.sin((x + t * 0.08) * 5.3 + 2) + 0.025 * Math.sin((x + t * 0.08) * 23.1);
    const ballGround = hill(ballX, 1);
    const ballY = ballGround - 0.05 - 0.22 * Math.abs(Math.sin(t * 2.4));
    for (let py = 0; py < size; py++) {
      const y = (py + 0.5) / size;
      for (let px = 0; px < size; px++) {
        const x = (px + 0.5) / size;
        // Sky: deep blue overhead to orange at the horizon.
        const k = smooth(0.05, 0.7, y);
        let [r, g, b] = hsv((0.66 - 0.58 * k + hueDrift + 1) % 1, 0.75 - 0.2 * k, 0.25 + 0.7 * k);
        // Stars, twinkling, above the glow.
        const sx = Math.floor(x * 40);
        const sy = Math.floor(y * 40);
        const star = Math.sin(sx * 12.9898 + sy * 78.233) * 43758.5453;
        if (y < 0.4 && star - Math.floor(star) > 0.985) {
          const tw = 0.5 + 0.5 * Math.sin(t * 3 + sx * 1.7 + sy);
          r += tw * (1 - k);
          g += tw * (1 - k);
          b += tw * (1 - k);
        }
        // The sun and its glow.
        const ds = Math.hypot(x - sunX, (y - sunY) * 1.0);
        const glow = Math.exp(-ds * 7) * 0.6;
        const disc = 1 - smooth(0.07, 0.085, ds);
        r += glow + disc;
        g += glow * 0.7 + disc * 0.85;
        b += glow * 0.3 + disc * 0.4;
        // Hills, far then near.
        if (y > hill(x, 0)) [r, g, b] = hsv((0.8 + hueDrift) % 1, 0.6, 0.28);
        if (y > hill(x, 1)) [r, g, b] = hsv((0.75 + hueDrift) % 1, 0.7, 0.12);
        // The ball.
        const db = Math.hypot(x - ballX, y - ballY);
        if (db < 0.045) {
          const shade = 1 - db / 0.06;
          [r, g, b] = [0.4 + 0.6 * shade, 0.95 * shade, 0.8 * shade];
        }
        const o = (py * size + px) * 4;
        rgba[o] = Math.min(255, r * 255);
        rgba[o + 1] = Math.min(255, g * 255);
        rgba[o + 2] = Math.min(255, b * 255);
        rgba[o + 3] = 255;
      }
    }
    return rgba;
  }

  dispose() {}
}

/** Effect kinds the visitors tap (wire names, see `core.effectKinds`). */
const TAP_EFFECTS = ["burst", "bloom", "ring", "twinkle", "swoosh", "star", "flower", "pinwheel"];
/** Pens they draw with (the crate's pen names). */
const PENS = ["glow", "ripple", "sparkle", "comet", "ring", "beam", "ember"];

export interface VisitorSettings {
  /** Visitors are at the gate. */
  enabled: boolean;
  /** How busy: 1 is a steady trickle; 2 a crowd. */
  busy: number;
}

interface Stroke {
  pen: string;
  hue: number;
  /** Seconds since it began, and how long it lasts. */
  age: number;
  life: number;
  /** A curve through the disc: centre, reach and turn. */
  a0: number;
  r0: number;
  da: number;
  dr: number;
  lastX: number;
  lastY: number;
}

interface Finger {
  id: number;
  hue: number;
  age: number;
  life: number;
  a0: number;
  r0: number;
  wobble: number;
}

const polar = (x: number, y: number) => ({ angle: Math.atan2(y, x), radius: Math.hypot(x, y) });

/**
 * People at the gate, for a host with nobody tapping: taps on the beat of the
 * synthetic groove (Effect taps, Triggered effects), strokes every few
 * seconds (Touch strokes) and, when the patch owns touch (Touch, Touch mask,
 * Touch glow), one or two fingers wandering across the surface instead, as
 * the gate's clients send raw touches then. Runs until `stop`; the clock and
 * the dice restart with `runtime.restart()`.
 */
export function attachVisitors(
  runtime: VisitorHost,
  initial: Partial<VisitorSettings> = {},
  seed = 7,
): { settings: VisitorSettings; stop(): void } {
  const settings: VisitorSettings = { enabled: true, busy: 1, ...initial };
  let rand = seeded(seed);
  let t = 0;
  let lastBeat = -1;
  let nextStroke = 1.5;
  let strokes: Stroke[] = [];
  let fingers: Finger[] = [];
  let nextFinger = 0.3;
  let fingerIds = 1000;

  const liftAll = () => {
    for (const f of fingers) runtime.touch(f.id, "up", fingerAt(f), { hue: f.hue });
    fingers = [];
  };
  const fingerAt = (f: Finger) => {
    const a = f.a0 + 0.9 * Math.sin(f.age * 0.9 + f.wobble) + f.age * 0.4;
    const r = Math.min(0.95, Math.max(0.1, f.r0 + 0.25 * Math.sin(f.age * 1.3 + f.wobble * 2)));
    return { angle: a, radius: r };
  };

  const offFrame = runtime.onFrame((dt) => {
    t += dt;
    if (!settings.enabled) {
      if (fingers.length) liftAll();
      strokes = [];
      return;
    }
    const busy = Math.max(0.1, settings.busy);
    if (runtime.getStatus().touch) {
      // The patch owns touch: fingers, not taps or pens.
      strokes = [];
      nextFinger -= dt * busy;
      if (nextFinger <= 0 && fingers.length < 2) {
        const f: Finger = {
          id: fingerIds++,
          hue: rand(),
          age: 0,
          life: 0.8 + rand() * 2,
          a0: rand() * Math.PI * 2,
          r0: 0.3 + rand() * 0.5,
          wobble: rand() * 6,
        };
        fingers.push(f);
        runtime.touch(f.id, "down", fingerAt(f), { hue: f.hue });
        nextFinger = 0.3 + rand() * 1.2;
      }
      fingers = fingers.filter((f) => {
        f.age += dt;
        if (f.age >= f.life) {
          runtime.touch(f.id, "up", fingerAt(f), { hue: f.hue });
          return false;
        }
        runtime.touch(f.id, "move", fingerAt(f), { hue: f.hue });
        return true;
      });
      return;
    }
    if (fingers.length) liftAll();

    // Taps land on the beat, some beats.
    const beat = Math.floor((t * GROOVE_BPM) / 60);
    if (beat !== lastBeat) {
      lastBeat = beat;
      if (rand() < 0.3 * busy) {
        runtime.trigger({
          kind: TAP_EFFECTS[Math.floor(rand() * TAP_EFFECTS.length)]!,
          angle: rand() * Math.PI * 2,
          radius: 0.25 + rand() * 0.7,
          hue: rand(),
          saturation: 0.85,
          brightness: 1,
        });
      }
    }

    // A stroke every few seconds, drawn a point per frame like a finger.
    nextStroke -= dt * busy;
    if (nextStroke <= 0) {
      const s: Stroke = {
        pen: PENS[Math.floor(rand() * PENS.length)]!,
        hue: rand(),
        age: 0,
        life: 0.6 + rand() * 0.9,
        a0: rand() * Math.PI * 2,
        r0: 0.2 + rand() * 0.5,
        da: (rand() < 0.5 ? -1 : 1) * (1 + rand() * 2),
        dr: (rand() - 0.5) * 0.6,
        lastX: NaN,
        lastY: NaN,
      };
      strokes.push(s);
      nextStroke = 2.5 + rand() * 4;
    }
    strokes = strokes.filter((s) => {
      s.age += dt;
      const u = Math.min(1, s.age / s.life);
      const a = s.a0 + s.da * u;
      const r = Math.min(1.1, Math.max(0.05, s.r0 + s.dr * u + 0.08 * Math.sin(u * 9)));
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      const dir = Number.isNaN(s.lastX) ? a + Math.PI / 2 : Math.atan2(y - s.lastY, x - s.lastX);
      s.lastX = x;
      s.lastY = y;
      runtime.draw(s.pen, [{ ...polar(x, y), dir }], { hue: s.hue, saturation: 0.85 });
      return s.age < s.life;
    });
  });

  const offRestart = runtime.onRestart(() => {
    rand = seeded(seed);
    t = 0;
    lastBeat = -1;
    nextStroke = 1.5;
    strokes = [];
    fingers = [];
    nextFinger = 0.3;
  });

  return {
    settings,
    stop: () => {
      offFrame();
      offRestart();
      if (fingers.length) liftAll();
    },
  };
}

const TURN_PER_S = 0.06; // turns per second: a full turn in ~17 s

/**
 * Someone dancing with the phone that holds motion: a slow turn with a wobble
 * (yaw, radians like the real sensor path), a sway and a nod (roll and pitch,
 * -1..1) and a shake every few seconds (a spike of the size the real path
 * reports, 0..3). `now` is in milliseconds; the default is wall time.
 */
export function syntheticMotion(now: () => number = () => performance.now(), seed = 3): MotionSource {
  const t0 = now();
  const rand = seeded(seed);
  let nextShake = 3;
  let shake = 0;
  return {
    read(): Motion {
      const t = (now() - t0) / 1000;
      const yaw =
        (((t * TURN_PER_S * Math.PI * 2 + 0.5 * Math.sin(t * 0.37)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const pitch = 0.35 * Math.sin(t * 1.9) + 0.15 * Math.sin(t * 0.53);
      const roll = 0.45 * Math.sin(t * 1.2 + 1) + 0.1 * Math.sin(t * 3.1);
      if (t >= nextShake) {
        shake = 1.5 + rand();
        nextShake = t + 3 + rand() * 5;
      }
      const spike = shake;
      shake = 0;
      return { yaw, pitch, roll, shake: spike };
    },
    stop() {},
  };
}

/**
 * A scope (waveform, then spectrum, as the patch core's audio analysis lays
 * it out) to go with audio features that came without samples, such as the
 * synthetic groove's: Waveform and Spectrum then move with the music instead
 * of lying flat. `features` in `setAudio` order (level, bass, mid, treble,
 * onset, …); `t` in seconds.
 */
export function synthScope(features: Float32Array, t: number, wave: number, spectrum: number): Float32Array {
  const [level = 0, bass = 0, mid = 0, treble = 0, onset = 0] = features;
  const out = new Float32Array(wave + spectrum);
  for (let i = 0; i < wave; i++) {
    const x = i / wave;
    out[i] =
      0.7 * bass * Math.sin(2 * Math.PI * (2 * x + t * 0.9)) +
      0.35 * mid * Math.sin(2 * Math.PI * (9 * x + t * 2.3) + 1) +
      0.18 * treble * Math.sin(2 * Math.PI * (31 * x + t * 5.1) + 2);
  }
  for (let k = 0; k < spectrum; k++) {
    const f = k / (spectrum - 1);
    const shape =
      bass * Math.exp(-((f - 0.06) ** 2) / 0.006) +
      0.8 * mid * Math.exp(-((f - 0.35) ** 2) / 0.03) +
      0.6 * treble * Math.exp(-((f - 0.75) ** 2) / 0.04);
    const ripple = 0.85 + 0.15 * Math.sin(k * 1.7 + t * 6);
    out[wave + k] = Math.min(1, (shape * ripple + 0.25 * onset * (1 - f)) * (0.6 + 0.6 * level));
  }
  return out;
}
