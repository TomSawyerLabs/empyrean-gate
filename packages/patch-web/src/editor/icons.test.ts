import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPatchCore } from "../runtime/core";
import { ICON_KINDS } from "./icons";

test("every node kind has its own icon, and every icon a kind", async () => {
  // The real patch core (run `bun run build:wasm` first).
  const core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "..", "wasm", "patch_bg.wasm")));
  const kinds = new Set(core.registry.map((t) => t.id));
  expect([...kinds].filter((k) => !ICON_KINDS.has(k))).toEqual([]);
  expect([...ICON_KINDS].filter((k) => !kinds.has(k))).toEqual([]);
});
