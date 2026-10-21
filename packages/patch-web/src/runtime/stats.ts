// The frame loop's rate and cost, counted in windows of about a second.

/** How often the stats report, while frames are being rendered. */
export const STATS_INTERVAL_MS = 1000;

/** How the frame loop is doing, reported about once a second while frames
 * render (so a stalled loop reports nothing). */
export interface RuntimeStats {
  /** Frames the loop has rendered since the runtime was created. */
  frames: number;
  /** Frames per second since the last report. */
  fps: number;
  /** Average CPU time per frame since the last report, in milliseconds:
   * evaluating the patch and encoding its passes (not the GPU's own time). */
  cpuMs: number;
}

export class LoopStats {
  private frames = 0;
  /** The current window: when it began (0: at the next frame), its frames
   * and CPU time. */
  private start = 0;
  private windowFrames = 0;
  private windowCpu = 0;

  /** Start a fresh window at the next frame (the loop restarted: the time
   * it was stopped is no frame rate). */
  restart() {
    this.start = 0;
    this.windowFrames = 0;
    this.windowCpu = 0;
  }

  /** One frame rendered at `now` (ms) that cost `cpuMs`: the window's stats
   * once it spans `STATS_INTERVAL_MS`, otherwise null. */
  count(now: number, cpuMs: number): RuntimeStats | null {
    this.frames += 1;
    if (this.start === 0) {
      // The first frame opens the window: the rate is frames after it.
      this.start = now;
      return null;
    }
    this.windowFrames += 1;
    this.windowCpu += cpuMs;
    const span = now - this.start;
    if (span < STATS_INTERVAL_MS) return null;
    const stats: RuntimeStats = {
      frames: this.frames,
      fps: (this.windowFrames * 1000) / span,
      cpuMs: this.windowCpu / this.windowFrames,
    };
    this.start = now;
    this.windowFrames = 0;
    this.windowCpu = 0;
    return stats;
  }
}
