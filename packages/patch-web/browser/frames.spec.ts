// Frame by frame (plans/frame-step.md), on a real WebGPU device: the browser
// runtime paused and stepped, past frames kept and shown again exactly, and a
// paused edit rendered again without Feedback seeing the wrong last frame.
// The runtime is bundled with Bun and loaded into a blank page, as the
// playground would load it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { PatchRuntime } from "../src/runtime";
import type { PatchDoc } from "../src/types";

let page: Page;

test.beforeAll(async ({ browser }) => {
  const out = join(mkdtempSync(join(tmpdir(), "frames-")), "runtime.js");
  const entry = new URL("../src/runtime/index.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  execFileSync("bun", ["build", entry, "--format=esm", "--target=browser", `--outfile=${out}`], { stdio: "pipe" });
  const bundle = readFileSync(out);
  const wasm = readFileSync(new URL("../wasm/patch_bg.wasm", import.meta.url));

  page = await browser.newPage();
  // WebGPU needs a secure context; localhost is one, and nothing is served.
  await page.route("http://localhost/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/runtime.js") return r.fulfill({ contentType: "text/javascript", body: bundle });
    if (path === "/patch_bg.wasm") return r.fulfill({ contentType: "application/wasm", body: wasm });
    return r.fulfill({ contentType: "text/html", body: "<!doctype html><title>frames</title>" });
  });
  await page.goto("http://localhost/");
  await page.evaluate(async () => {
    const { PatchRuntime } = (await import("/runtime.js" as string)) as typeof import("../src/runtime");
    const wasm = await (await fetch("/patch_bg.wasm")).arrayBuffer();
    Object.assign(globalThis, { rt: await PatchRuntime.create(undefined, { wasm }) });
  });
});

test.afterAll(async () => {
  await page?.close();
});

const node = (id: string, kind: string, params: Record<string, number> = {}) => ({
  id,
  kind,
  name: "",
  params,
  pos: [0, 0] as [number, number],
});

/** A rainbow turning, so every frame differs, and an LFO for the meters. */
const TURNING: PatchDoc = {
  format: 7,
  id: "turning",
  name: "Turning",
  description: "",
  nodes: [node("bow", "rainbow", { speed: 1 }), node("lfo", "lfo", { rate: 3 }), node("o", "output")],
  edges: [{ from: { node: "bow", port: "out" }, to: { node: "o", port: "in" } }],
  exposed: [],
};

/** Each frame adds a dim rainbow over last frame's picture × Decay: a frame
 * rendered from the wrong last frame comes out brighter. */
const ECHO: PatchDoc = {
  format: 7,
  id: "echo",
  name: "Echo",
  description: "",
  nodes: [
    node("fb", "feedback", { decay: 0.9 }),
    node("bow", "rainbow", { speed: 1 }),
    node("mix", "blend", { opacity: 0.2 }),
    node("o", "output"),
  ],
  edges: [
    { from: { node: "fb", port: "out" }, to: { node: "mix", port: "base" } },
    { from: { node: "bow", port: "out" }, to: { node: "mix", port: "over" } },
    { from: { node: "mix", port: "out" }, to: { node: "o", port: "in" } },
  ],
  exposed: [],
};

/** Run `fn` in the page with the runtime as `rt`. */
function inPage<T, A>(fn: (rt: PatchRuntime, arg: A) => Promise<T> | T, arg: A): Promise<T> {
  return page.evaluate(
    ([src, a]) => {
      const f = new Function("rt", "arg", `return (${src})(rt, arg);`) as (rt: unknown, arg: unknown) => Promise<T>;
      return f((globalThis as unknown as { rt: unknown }).rt, a);
    },
    [fn.toString(), arg] as const,
  );
}

test("paused, the patch moves one frame per step and not otherwise", async () => {
  const r = await inPage(async (rt, doc) => {
    await rt.setPatch(doc);
    rt.pause();
    const sum = (rgb: Uint8Array) => rgb.reduce((a, b) => a + b, 0);
    const before = rt.state();
    rt.stepFrames(1);
    const one = sum(await rt.readFrame());
    rt.stepFrames(1);
    const two = sum(await rt.readFrame());
    const after = rt.state();
    // Nothing moves on its own while paused.
    await new Promise((res) => setTimeout(res, 100));
    const still = sum(await rt.readFrame());
    return { before, after, one, two, still, again: rt.state() };
  }, TURNING);
  expect(r.after.frame - r.before.frame).toBe(2);
  expect(r.after.time - r.before.time).toBeCloseTo(2 / 60, 6);
  expect(r.after.paused).toBe(true);
  expect(r.one).not.toBe(r.two);
  expect(r.still).toBe(r.two);
  expect(r.again.frame).toBe(r.after.frame);
});

test("without Keep past frames there is nothing to step back to", async () => {
  const r = await inPage(async (rt, doc) => {
    await rt.setPatch(doc);
    await rt.setKeep(0);
    rt.pause();
    rt.stepFrames(5);
    rt.stepFrames(-3);
    return rt.state();
  }, TURNING);
  expect(r.kept).toBe(0);
  expect(r.back).toBe(0);
});

test("kept frames come back exactly, and play returns to the live one", async () => {
  const r = await inPage(async (rt, doc) => {
    await rt.restart();
    await rt.setPatch(doc);
    const refused = await rt.setKeep(2);
    rt.pause();
    const frames: number[][] = [];
    for (let i = 0; i < 10; i++) {
      rt.stepFrames(1);
      frames.push(Array.from(await rt.readFrame()));
    }
    const equal = (a: number[], b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
    rt.stepFrames(-3);
    const back3 = { state: rt.state(), same: equal(frames[6]!, await rt.readFrame()) };
    rt.stepFrames(1);
    const back2 = { state: rt.state(), same: equal(frames[7]!, await rt.readFrame()) };
    rt.stepFrames(-100);
    const oldest = rt.state();
    rt.stepFrames(oldest.back);
    const live = { state: rt.state(), same: equal(frames[9]!, await rt.readFrame()) };
    rt.stepFrames(-1);
    rt.play();
    const playing = rt.state();
    rt.pause();
    return { refused, back3, back2, oldest, live, playing, cost: rt.keepCost(2) };
  }, TURNING);
  expect(r.refused).toBeNull();
  expect(r.back3.state.back).toBe(3);
  expect(r.back3.same).toBe(true);
  expect(r.back2.state.back).toBe(2);
  expect(r.back2.same).toBe(true);
  // Every stepped frame is kept (the frames before pausing too).
  expect(r.oldest.back).toBe(r.oldest.kept);
  expect(r.oldest.kept).toBeGreaterThanOrEqual(9);
  expect(r.live.state.back).toBe(0);
  expect(r.live.same).toBe(true);
  expect(r.playing.back).toBe(0);
  expect(r.playing.paused).toBe(false);
  expect(r.cost).toBeGreaterThan(0);
});

test("a paused edit renders the live frame again, from the right last frame", async () => {
  const r = await inPage(async (rt, doc) => {
    await rt.setKeep(0);
    await rt.setPatch(doc);
    rt.pause();
    rt.stepFrames(20);
    const sum = (rgb: Uint8Array) => rgb.reduce((a, b) => a + b, 0);
    const shown = sum(await rt.readFrame());
    const frame = rt.state().frame;
    // The same document again: an edit that changes nothing.
    await rt.setPatch(structuredClone(doc));
    const again = sum(await rt.readFrame());
    await rt.setPatch(structuredClone(doc));
    const twice = sum(await rt.readFrame());
    return { shown, again, twice, frame, after: rt.state().frame };
  }, ECHO);
  expect(r.shown).toBeGreaterThan(0);
  expect(r.again).toBe(r.shown);
  expect(r.twice).toBe(r.shown);
  expect(r.after).toBe(r.frame);
});

test("stepped frames reach the thumbnails and meters, one sample per frame", async () => {
  const r = await inPage(async (rt, doc) => {
    await rt.setKeep(2);
    await rt.setPatch(doc);
    rt.retain();
    rt.pause();
    rt.stepFrames(1);
    rt.stepFrames(1);
    rt.stepFrames(1);
    await new Promise((res) => setTimeout(res, 300));
    const meter = rt.scalars.get("scalar:lfo:out")?.values.slice(-3) ?? [];
    const cells = [...rt.cells.keys()];
    rt.stepFrames(-2);
    await new Promise((res) => setTimeout(res, 300));
    const pastMeter = rt.scalars.get("scalar:lfo:out")?.values.slice(-1) ?? [];
    rt.release();
    return { meter, cells, pastMeter };
  }, TURNING);
  expect(r.cells).toContain("node:bow");
  expect(r.meter).toHaveLength(3);
  expect(new Set(r.meter).size).toBe(3);
  // Two frames back, the meter ends where it was then.
  expect(r.pastMeter[0]).toBe(r.meter[0]);
});

test("a Debug node at every LED gets a whole frame's cell, kept with the others", async () => {
  const doc: PatchDoc = {
    ...TURNING,
    id: "every-led",
    nodes: [...TURNING.nodes, node("tap", "debug", { detail: 1 })],
    edges: [...TURNING.edges, { from: { node: "bow", port: "out" }, to: { node: "tap", port: "in" } }],
  };
  const r = await inPage(async (rt, d) => {
    await rt.setPatch(d);
    await rt.setKeep(2);
    rt.retain();
    rt.pause();
    const settle = () => new Promise((res) => setTimeout(res, 300));
    rt.stepFrames(1);
    await settle();
    const first = Array.from(rt.cells.get("node:tap") ?? []);
    rt.stepFrames(1);
    await settle();
    const second = Array.from(rt.cells.get("node:tap") ?? []);
    rt.stepFrames(-1);
    await settle();
    const back = Array.from(rt.cells.get("node:tap") ?? []);
    const mini = rt.cells.get("node:bow")?.length ?? 0;
    rt.release();
    return { first: first.length, differs: first.join() !== second.join(), same: back.join() === first.join(), mini };
  }, doc);
  expect(r.first).toBe(64 * 378 * 3);
  expect(r.mini).toBe(64 * 16 * 3);
  expect(r.differs).toBe(true);
  expect(r.same).toBe(true);
});
