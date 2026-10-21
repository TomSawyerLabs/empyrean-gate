// Frame by frame (plans/frame-step.md): what a host offers the editor's
// transport bar. The browser runtime pauses the patch and steps it a frame at
// a time, and, when the person opts in, keeps past frames to step back
// through. The gate only freezes the editor's views (its engine is the show)
// and keeps past mini batches. Kept apart from the bar (React) so a runtime
// with no editor can implement it.

export interface TransportState {
  paused: boolean;
  /** The live frame: frames rendered since the patch started. */
  frame: number;
  /** Patch time at the live frame, in seconds. */
  time: number;
  /** How many frames behind the live one the views show (0: the live one). */
  back: number;
  /** The frame the views show and its patch time (the live one's at 0 back). */
  shown: { frame: number; time: number };
  /** Past frames there are to step back through now. */
  kept: number;
  /** What Keep past frames is set to, in seconds (0: off). */
  keepSeconds: number;
}

export interface FrameTransport {
  /** Steps the patch itself (the browser runtime); false: freezes the views
   * and steps through what was kept (the gate). */
  readonly canStep: boolean;
  state(): TransportState;
  onTransport(listener: () => void): () => void;
  pause(): void;
  /** Back to the live frame and running. */
  play(): void;
  /** Pause, then show `frames` frames on (negative: back through the kept
   * ones, as far as there are). */
  stepFrames(frames: number): void;
  /** Keep the last `seconds` of frames (0: none), dropping what was kept.
   * Resolves null, or why it can't (the GPU refused the memory). */
  setKeep(seconds: number): Promise<string | null>;
  /** Bytes `setKeep(seconds)` would hold, for the menu. */
  keepCost(seconds: number): number;
}

/** The lengths the menu offers, in seconds (0: off). */
export const KEEP_CHOICES = [0, 2, 10, 30, 60] as const;

/** Where the editor remembers the choice. */
export const KEEP_KEY = "empyrean-keep-frames";

/** Whether this device should hold `bytes` of past frames: within a quarter
 * of its memory where the browser says (`navigator.deviceMemory`, Chromium,
 * in GB and capped at 8). Elsewhere it is tried, and an allocation the GPU
 * refuses is reported (`setKeep`). */
export function deviceAllows(bytes: number, memoryGb = deviceMemoryGb()): boolean {
  return memoryGb === null || bytes <= (memoryGb * 2 ** 30) / 4;
}

function deviceMemoryGb(): number | null {
  const m = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory;
  return typeof m === "number" && m > 0 ? m : null;
}

/** "84 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 2 ** 20))} MB`;
}
