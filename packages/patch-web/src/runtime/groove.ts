// Music for a patch when there is none: a simulated DJ set (djlink.ts) on
// the PRO DJ LINK inputs, and its sound as a synthetic groove on audio source
// 0, so audio- and DJ-driven nodes move in a playground, a demo, or an agent's
// headless render. Not music, but the patterns were written for some. (Moved
// here from empyreangate.org's app/gate/engine.ts, which drove its playground
// with it.)

import { DjLinkSim, SET_BPM } from "./djlink";
import type { PatchRuntime } from "./index";

/** The groove's tempo: the set's. */
export const GROOVE_BPM = SET_BPM;

export interface GrooveFeatures {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  beatPhase: number;
  onset: number;
}

/** A plain groove at `t` seconds: a track's chorus, with no set around it
 * (`attachGroove` plays the set's own sound). */
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

export interface GrooveSettings {
  /** Feed the set's sound to audio source 0 (false: silence there; for a host
   * whose microphone has taken over, see `audio: "off"`). */
  audio: "groove" | "silent" | "off";
  /** Where in the set `runtime.restart()` starts it, in seconds, so a
   * capture repeats from there. */
  startAt: number;
}

/** Drive `runtime` with the simulated set every frame until the returned
 * `stop`: its PRO DJ LINK outputs and events, and (per `settings.audio`) its
 * sound. `dj` is the set, for a host's deck controls. The set restarts at
 * `settings.startAt` with `runtime.restart()`, so a capture repeats. */
export function attachGroove(
  runtime: PatchRuntime,
  initial: Partial<GrooveSettings> = {},
): { settings: GrooveSettings; dj: DjLinkSim; time(): number; stop(): void } {
  const settings: GrooveSettings = { audio: "groove", startAt: 0, ...initial };
  const dj = new DjLinkSim();
  if (settings.startAt > 0) dj.reset(settings.startAt);
  const offFrame = runtime.onFrame((dt) => {
    const fired = dj.step(dt);
    if (settings.audio === "groove") runtime.setAudio(0, dj.audio());
    else if (settings.audio === "silent") runtime.setAudio(0, new Float32Array(11));
    runtime.setDjLink(dj.scalars());
    for (const [event] of fired) runtime.fireDjEvent(event);
  });
  const offRestart = runtime.onRestart(() => dj.reset(settings.startAt));
  return {
    settings,
    dj,
    time: () => dj.time,
    stop: () => {
      offFrame();
      offRestart();
    },
  };
}
