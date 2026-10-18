// Music for a patch when there is none: a steady synthetic groove on audio
// source 0 and a stand-in DJ deck riding the same beat, so audio- and
// DJ-driven nodes move in a playground, a demo, or an agent's headless
// render. Not music, but the patterns were written for some. (Moved here from
// empyreangate.org's app/gate/engine.ts, which drove its playground with it.)

import type { PatchRuntime } from "./index";

/** The groove's tempo. */
export const GROOVE_BPM = 122;

export interface GrooveFeatures {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  beatPhase: number;
  onset: number;
}

/** The groove at `t` seconds. */
export function grooveAt(t: number): GrooveFeatures {
  const beatPhase = ((t * GROOVE_BPM) / 60) % 1;
  const bar = ((t * GROOVE_BPM) / 240) % 1;
  const kick = Math.exp(-beatPhase * 7);
  const swell = 0.5 + 0.5 * Math.sin(t * 0.21);
  const bass = 0.18 + 0.75 * kick * (0.7 + 0.3 * swell);
  const mid = 0.35 + 0.25 * Math.sin(t * 1.7 + 1.0) + 0.15 * Math.sin(t * 4.3);
  const treble = 0.25 + 0.3 * Math.abs(Math.sin(t * 9.1)) * (bar > 0.5 ? 1 : 0.6) + 0.2 * kick;
  const level = 0.3 + 0.3 * bass + 0.2 * mid + 0.1 * treble;
  return {
    level: Math.min(1, level),
    bass: Math.min(1, bass),
    mid: Math.min(1, Math.max(0, mid)),
    treble: Math.min(1, treble),
    beatPhase,
    onset: Math.exp(-beatPhase * 24),
  };
}

/** The groove as `PatchRuntime.setAudio` takes it. */
export function grooveAudio(t: number): Float32Array {
  const a = grooveAt(t);
  return new Float32Array([
    a.level,
    a.bass,
    a.mid,
    a.treble,
    a.onset,
    a.beatPhase,
    GROOVE_BPM,
    1,
    a.bass,
    a.mid,
    a.treble,
  ]);
}

/** A deck playing the groove, as `PatchRuntime.setDjLink` takes it; `mix`
 * is the crossfader 0..1. */
export function grooveDjLink(t: number, mix = 0.5): Float32Array {
  const beat = Math.floor((t * GROOVE_BPM) / 60);
  const phrase = ((t * GROOVE_BPM) / 60 / 32) % 1;
  return new Float32Array([
    1, // active
    grooveAt(t).level, // energy
    1,
    -1,
    1,
    -1, // deck, deck_side, event_deck, event_side
    1,
    1,
    1,
    0, // playing, on_air, deck_1_on_air, deck_2_on_air
    0, // looping
    mix,
    0, // mix, mix_activity
    (beat % 4) + 1, // beat_in_bar
    1,
    1,
    phrase,
    0, // phrase_active, phrase_kind, phrase_progress, phrase_fill
  ]);
}

export interface GrooveSettings {
  /** Feed the groove to audio source 0 (false: silence there; for a host
   * whose microphone has taken over, see `audio: "off"`). */
  audio: "groove" | "silent" | "off";
  /** Crossfader of the stand-in deck. */
  djMix: number;
}

/** Drive `runtime` with the groove every frame until the returned `stop`.
 * The clock restarts with `runtime.restart()`, so a capture repeats. */
export function attachGroove(
  runtime: PatchRuntime,
  initial: Partial<GrooveSettings> = {},
): { settings: GrooveSettings; time(): number; stop(): void } {
  const settings: GrooveSettings = { audio: "groove", djMix: 0.5, ...initial };
  let t = 0;
  const offFrame = runtime.onFrame((dt) => {
    t += dt;
    if (settings.audio === "groove") runtime.setAudio(0, grooveAudio(t));
    else if (settings.audio === "silent") runtime.setAudio(0, new Float32Array(11));
    runtime.setDjLink(grooveDjLink(t, settings.djMix));
  });
  const offRestart = runtime.onRestart(() => {
    t = 0;
  });
  return {
    settings,
    time: () => t,
    stop: () => {
      offFrame();
      offRestart();
    },
  };
}
