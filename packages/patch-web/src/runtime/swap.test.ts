// The running patch keeps rendering while an edited one's pipelines build,
// and the swap happens between two frames. A fake GPU stands in for WebGPU:
// its builds finish only when a test says so, and each frame records which
// program it rendered.

import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PatchDoc } from "../types";
import { loadPatchCore, type PatchCore } from "./core";
import type { GpuProgram } from "./gpu";
import { GATE_GEOMETRY, PatchRuntime } from "./index";
import { ShaderError } from "./gpu";

// The real patch core (run `bun run build:wasm` first).
let core: PatchCore;
/** Three presets, each with a shader of its own. */
let a: PatchDoc, b: PatchDoc, c: PatchDoc;
beforeAll(async () => {
  core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "..", "wasm", "patch_bg.wasm")));
  const g = GATE_GEOMETRY;
  const seen = new Set<string>();
  const distinct = core.presets.filter((doc) => {
    const sim = core.createSim(doc, g.spokes, g.pixels, g.innerOverOuter);
    const wgsl = sim.wgsl();
    sim.free();
    if (seen.has(wgsl)) return false;
    seen.add(wgsl);
    return true;
  });
  [a, b, c] = distinct;
});

/** What `GateGpu` does for the runtime, minus the GPU. */
class FakeGpu {
  readonly device = { lost: new Promise<never>(() => {}) };
  readonly geometry = GATE_GEOMETRY;
  /** Builds not finished yet, oldest first. */
  readonly building: { wgsl: string; finish: () => void; fail: (e: unknown) => void }[] = [];
  installed: string | null = null;
  /** The program each frame rendered. */
  readonly frames: (string | null)[] = [];

  build(wgsl: string): Promise<GpuProgram> {
    return new Promise((resolve, reject) => {
      this.building.push({
        wgsl,
        finish: () => resolve({ key: wgsl } as GpuProgram),
        fail: reject,
      });
    });
  }
  install(program: GpuProgram) {
    this.installed = program.key;
  }
  /** Finish the build of `wgsl`. */
  finish(wgsl: string) {
    const k = this.building.findIndex((x) => x.wgsl === wgsl);
    expect(k).toBeGreaterThanOrEqual(0);
    this.building.splice(k, 1)[0].finish();
  }
  render() {
    this.frames.push(this.installed);
  }
  write() {}
  writeScope() {}
  writeVideo() {}
  writeImage() {}
  async readPreview() {
    return null;
  }
}

function runtime() {
  const gpu = new FakeGpu();
  const rt = Reflect.construct(PatchRuntime as unknown as new (...args: unknown[]) => PatchRuntime, [
    core,
    gpu,
    async () => new Uint8Array(0),
  ]);
  return { gpu, rt };
}

function wgslOf(doc: PatchDoc): string {
  const g = GATE_GEOMETRY;
  const sim = core.createSim(doc, g.spokes, g.pixels, g.innerOverOuter);
  const wgsl = sim.wgsl();
  sim.free();
  return wgsl;
}

/** `rt` running `doc`, its pipelines built. */
async function running(doc: PatchDoc) {
  const { gpu, rt } = runtime();
  const opened = rt.setPatch(doc);
  rt.step(1 / 60);
  expect(gpu.frames).toEqual([]); // nothing older to show
  gpu.finish(wgslOf(doc));
  await opened;
  return { gpu, rt };
}

/** A tiny pause: lets settled promises run their continuations. */
const settle = () => new Promise((r) => setTimeout(r, 0));

test("the running patch keeps rendering until the new shader is built", async () => {
  const { gpu, rt } = await running(a);
  const edit = rt.setPatch(b);
  for (let i = 0; i < 3; i++) rt.step(1 / 60);
  expect(gpu.frames).toEqual([wgslOf(a), wgslOf(a), wgslOf(a)]);
  expect(rt.getStatus()).toMatchObject({ active: true, error: null });

  gpu.finish(wgslOf(b));
  await edit;
  rt.step(1 / 60);
  expect(gpu.frames.at(-1)).toBe(wgslOf(b));
  expect(rt.getStatus()).toMatchObject({ active: true, error: null });
});

test("a build that finishes after a newer one is never installed", async () => {
  const { gpu, rt } = await running(a);
  const toB = rt.setPatch(b);
  const toC = rt.setPatch(c);
  gpu.finish(wgslOf(c));
  await toC;
  expect(gpu.installed).toBe(wgslOf(c));
  gpu.finish(wgslOf(b));
  await toB;
  expect(gpu.installed).toBe(wgslOf(c));
  rt.step(1 / 60);
  expect(gpu.frames.at(-1)).toBe(wgslOf(c));
});

test("an older build that finishes first shows on the way to the latest", async () => {
  const { gpu, rt } = await running(a);
  const toB = rt.setPatch(b);
  const toC = rt.setPatch(c);
  gpu.finish(wgslOf(b));
  await toB;
  expect(gpu.installed).toBe(wgslOf(b));
  gpu.finish(wgslOf(c));
  await toC;
  expect(gpu.installed).toBe(wgslOf(c));
});

test("going back to the running shader drops the build in flight", async () => {
  const { gpu, rt } = await running(a);
  const toB = rt.setPatch(b);
  const knob = structuredClone(a);
  knob.name = `${a.name} (renamed)`;
  await rt.setPatch(knob); // same shader as what runs: no build
  expect(gpu.building.map((x) => x.wgsl)).toEqual([wgslOf(b)]);
  gpu.finish(wgslOf(b));
  await toB;
  expect(gpu.installed).toBe(wgslOf(a));
});

test("a shader the GPU refuses leaves the running patch on, with the error", async () => {
  const { gpu, rt } = await running(a);
  const edit = rt.setPatch(b);
  gpu.building[0].fail(new ShaderError("patch shader failed to compile", ["wgsl:1:1 nope"]));
  await edit;
  await settle();
  expect(rt.getStatus().active).toBe(true);
  expect(rt.getStatus().error).toContain("nope");
  rt.step(1 / 60);
  expect(gpu.frames.at(-1)).toBe(wgslOf(a));

  // The next good edit clears it.
  const fixed = rt.setPatch(c);
  gpu.finish(wgslOf(c));
  await fixed;
  expect(rt.getStatus()).toMatchObject({ active: true, error: null });
});
