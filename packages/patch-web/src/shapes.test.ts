import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPatchCore } from "./runtime/core";
import { shapeAccepts } from "./types";

test("shapeAccepts is the patch core's wire rule, for every pair of shapes", async () => {
  // The real patch core (run `bun run build:wasm` first).
  const core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "wasm", "patch_bg.wasm")));
  const ids = core.shapes.map((s) => s.id);
  expect(ids).toContain("any");
  for (const into of core.shapes) {
    expect(ids.filter((from) => shapeAccepts(into.id, from))).toEqual(into.accepts);
  }
});
