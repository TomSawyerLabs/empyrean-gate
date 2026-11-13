// Frame hitches: the engine's late-frame count and its slowest-frame
// breakdown (plans/frame-spikes.md), worded for the VJ.

import type { FrameBreakdown, RuntimeStatus } from "./types";

/** Hitches in one second that the engine counts as a stutter
 *  (`LOAD_WARN_LATE_PER_SEC` in src-tauri/src/engine/mod.rs). */
export const HITCH_WARN_PER_SEC = 3;

/** Bars on the hitch meter are drawn against this many per second, so one
 *  hitch reads as a small bar rather than a full-height one. */
export const HITCH_METER_MAX = 10;

export function hitchesNow(status: RuntimeStatus): number {
  return status.late_history.at(-1) ?? 0;
}

const STAGES: [keyof FrameBreakdown, string][] = [
  ["prep_ms", "scene prep"],
  ["ready_ms", "Ready bus"],
  ["minis_ms", "layer thumbnails"],
  ["program_ms", "main render"],
  ["other_ms", "output and previews"],
  ["stall_ms", "the OS waking the engine late"],
];

/** The stage that took the biggest share of a slow frame: [ms, name]. */
export function biggestStage(frame: FrameBreakdown): [number, string] {
  let best: [number, string] = [-1, ""];
  for (const [key, name] of STAGES) {
    const ms = frame[key];
    if (ms > best[0]) best = [ms, name];
  }
  return best;
}

/** The slowest recent frame, when it was late enough to be a visible hitch. */
export function slowFrame(status: RuntimeStatus): FrameBreakdown | null {
  const frame = status.slowest_frame;
  if (!frame || status.frame_budget_ms <= 0) return null;
  return frame.interval_ms > status.frame_budget_ms * 1.5 ? frame : null;
}

/** "42 ms frame 3 s ago, mostly main render (30 ms)". */
export function describeSlowFrame(frame: FrameBreakdown): string {
  const [ms, stage] = biggestStage(frame);
  const when = frame.secs_ago === 0 ? "just now" : `${frame.secs_ago} s ago`;
  return `${Math.round(frame.interval_ms)} ms frame ${when}, mostly ${stage} (${Math.round(ms)} ms)`;
}
