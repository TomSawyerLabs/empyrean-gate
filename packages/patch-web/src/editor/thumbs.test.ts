import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPatchCore } from "../runtime/core";
import { ICON_ONLY } from "./thumbs";
import { THUMBS } from "./thumbs.gen";

test("every kind has a thumbnail or is icon-only, and none is stale", async () => {
  // The real patch core (run `bun run build:wasm` first). On a failure,
  // `bun run thumbnails` regenerates thumbs.gen.ts.
  const core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "..", "wasm", "patch_bg.wasm")));
  const kinds = new Set(core.registry.map((t) => t.id));
  const pictured = new Set([...Object.keys(THUMBS.rings), ...Object.keys(THUMBS.traces)]);
  expect([...kinds].filter((k) => !pictured.has(k) && !ICON_ONLY.has(k))).toEqual([]);
  expect([...pictured].filter((k) => !kinds.has(k))).toEqual([]);
});

test("ring pictures are spokes × samples RGB", () => {
  for (const [kind, b64] of Object.entries(THUMBS.rings)) {
    expect(atob(b64).length, kind).toBe(THUMBS.spokes * THUMBS.samples * 3);
  }
});
