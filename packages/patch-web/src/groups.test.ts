import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grouped, groupOf, GROUPS } from "./groups";
import { loadPatchCore, type PatchCore } from "./runtime/core";

// The real patch core (run `bun run build:wasm` first).
let core: PatchCore;
beforeAll(async () => {
  core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "wasm", "patch_bg.wasm")));
});

test("every kind's group is one the editor knows, and every group is used", () => {
  const known = new Set(GROUPS.map((g) => g.id));
  for (const t of core.registry) expect(known, `${t.id} is in "${t.group}"`).toContain(t.group!);
  const used = new Set(core.registry.map((t) => t.group));
  for (const g of GROUPS) expect(used, `no kind is in ${g.id}`).toContain(g.id);
});

test("grouped keeps palette order and every kind once", () => {
  const groups = grouped(core.registry);
  expect(groups.map((g) => g.group.id)).toEqual(GROUPS.map((g) => g.id));
  expect(groups.flatMap((g) => g.types).length).toBe(core.registry.length);
});

test("a registry without groups falls back on the category", () => {
  const solid = { ...core.registry.find((t) => t.id === "solid")!, group: undefined };
  expect(groupOf(solid).id).toBe("patterns");
  const time = { ...core.registry.find((t) => t.id === "time")!, group: undefined };
  expect(groupOf(time).id).toBe("live");
});
