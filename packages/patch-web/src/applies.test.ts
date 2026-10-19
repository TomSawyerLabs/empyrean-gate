import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPatchCore } from "./runtime/core";
import { applies, type PatchNode } from "./types";

test("Random's ports and knobs follow its mode", async () => {
  // The real patch core (run `bun run build:wasm` first).
  const core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "wasm", "patch_bg.wasm")));
  const random = core.registry.find((t) => t.id === "random")!;
  const node = (mode: number): PatchNode => ({ id: "r", kind: "random", name: "", params: { mode }, pos: [0, 0] });
  const ins = (n?: PatchNode) => random.inputs.filter((p) => applies(p, random, n)).map((p) => p.name);
  const knobs = (n?: PatchNode) => random.params.filter((p) => applies(p, random, n)).map((p) => p.name);
  // A node just added is in Hold.
  expect(ins()).toEqual(["trigger"]);
  expect(knobs()).toEqual(["mode", "rate", "glide", "min", "max"]);
  expect(ins(node(2))).toEqual(["step", "reset"]);
  expect(knobs(node(2))).toEqual(["mode", "wander", "jump", "pull", "edges", "min", "max"]);
  expect(knobs(node(3))).toEqual(["mode", "speed", "harmonics", "roughness", "spacing", "min", "max"]);
  expect(random.outputs.filter((p) => applies(p, random, node(1))).map((p) => p.name)).toEqual(["out"]);
});
