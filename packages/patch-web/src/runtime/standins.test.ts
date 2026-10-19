import { expect, test } from "bun:test";
import { attachVisitors, syntheticMotion, TestFilm, type VisitorHost } from "./standins";

/** Just enough of a runtime for the visitors: frames, restarts, a status,
 * and a log of what they did. */
function fakeRuntime(touch = false) {
  const frames = new Set<(dt: number) => void>();
  const restarts = new Set<() => void>();
  const log: string[] = [];
  const rt = {
    onFrame: (l: (dt: number) => void) => (frames.add(l), () => frames.delete(l)),
    onRestart: (l: () => void) => (restarts.add(l), () => restarts.delete(l)),
    getStatus: () => ({ active: true, touch, error: null }),
    trigger: (e: { kind: string; angle?: number }) => log.push(`tap ${e.kind} ${e.angle!.toFixed(3)}`),
    draw: (pen: string, pts: { angle: number }[]) => log.push(`draw ${pen} ${pts[0]!.angle.toFixed(3)}`),
    touch: (id: number, phase: string) => log.push(`touch ${id} ${phase}`),
  };
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) frames.forEach((l) => l(1 / 60));
  };
  const restart = () => restarts.forEach((l) => l());
  return { runtime: rt as unknown as VisitorHost, log, run, restart };
}

test("visitors tap on the beat and draw strokes, the same again after a restart", () => {
  const { runtime, log, run, restart } = fakeRuntime();
  attachVisitors(runtime);
  run(20);
  const first = [...log];
  expect(first.filter((l) => l.startsWith("tap")).length).toBeGreaterThan(5);
  expect(first.filter((l) => l.startsWith("draw")).length).toBeGreaterThan(20);
  expect(first.some((l) => l.startsWith("touch"))).toBe(false);

  log.length = 0;
  restart();
  run(20);
  expect(log).toEqual(first);
});

test("when the patch owns touch, visitors touch instead, and lift every finger", () => {
  const { runtime, log, run } = fakeRuntime(true);
  const v = attachVisitors(runtime);
  run(10);
  expect(log.some((l) => l.startsWith("tap") || l.startsWith("draw"))).toBe(false);
  const downs = log.filter((l) => l.endsWith(" down")).length;
  expect(downs).toBeGreaterThan(3);
  v.stop();
  const ups = log.filter((l) => l.endsWith(" up")).length;
  expect(ups).toBe(downs);
});

test("visitors switched off do nothing", () => {
  const { runtime, log, run } = fakeRuntime();
  attachVisitors(runtime, { enabled: false });
  run(10);
  expect(log).toEqual([]);
});

test("the test film moves and repeats after a reset", () => {
  const film = new TestFilm(32);
  const a = film.frame(0.5).slice();
  const b = film.frame(0.5).slice();
  expect(a).not.toEqual(b);
  expect(a.length).toBe(32 * 32 * 4);
  film.reset();
  expect(film.frame(0.5)).toEqual(a);
});

test("synthetic motion turns, sways and shakes now and then", () => {
  let now = 0;
  const m = syntheticMotion(() => now);
  let shakes = 0;
  for (; now < 20_000; now += 100) {
    const r = m.read();
    expect(r.pitch).toBeGreaterThanOrEqual(-1);
    expect(r.pitch).toBeLessThanOrEqual(1);
    if (r.shake > 0) shakes++;
  }
  expect(shakes).toBeGreaterThan(1);
});
