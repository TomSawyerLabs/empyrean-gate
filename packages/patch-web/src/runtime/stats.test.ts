import { describe, expect, test } from "bun:test";
import { LoopStats, STATS_INTERVAL_MS } from "./stats";

/** Frames every `step` ms from `from`, each costing `cpu` ms. */
function run(stats: LoopStats, from: number, frames: number, step: number, cpu = 2) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    const s = stats.count(from + i * step, cpu);
    if (s) out.push(s);
  }
  return out;
}

describe("LoopStats", () => {
  test("reports once a second, with the rate and the CPU cost", () => {
    const stats = new LoopStats();
    const out = run(stats, 1000, 61, 1000 / 60, 3);
    expect(out).toHaveLength(1);
    expect(out[0].fps).toBeCloseTo(60, 5);
    expect(out[0].cpuMs).toBeCloseTo(3, 5);
    expect(out[0].frames).toBe(61);
  });

  test("says nothing before a window fills", () => {
    const stats = new LoopStats();
    expect(run(stats, 1000, 30, 1000 / 60)).toHaveLength(0);
  });

  test("a restart doesn't count the time stopped", () => {
    const stats = new LoopStats();
    run(stats, 1000, 30, 1000 / 60);
    stats.restart();
    // Ten seconds later, 30 fps: without the restart the first report would
    // span the gap.
    const out = run(stats, 11000, 31, 1000 / 30);
    expect(out).toHaveLength(1);
    expect(out[0].fps).toBeCloseTo(30, 5);
    expect(out[0].frames).toBe(61);
  });

  test("a slow loop still reports, at its own rate", () => {
    const stats = new LoopStats();
    const out = run(stats, 1000, 3, STATS_INTERVAL_MS * 0.75);
    expect(out).toHaveLength(1);
    expect(out[0].fps).toBeCloseTo(1000 / 750, 5);
  });
});
