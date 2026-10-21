// The built-in patches open laid out the way ⇆ Arrange leaves them: source
// on the left, Output on the right, nothing on top of anything else. The
// exact positions depend on the cards' measured sizes, which only a browser
// knows (scripts/arrange-presets.ts), so this checks what any arranged
// layout has whatever the sizes: every wire runs left to right, and no two
// nodes overlap at the size a card is assumed to have.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SIZE } from "./arrange";
import type { PatchDoc } from "../types";

const dir = join(import.meta.dir, "..", "..", "..", "..", "crates", "empyrean-patch", "src", "presets");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();
const FIX = "lay them out with `bun run arrange-presets` in packages/patch-web";

describe("built-in patches are arranged", () => {
  test("there are built-ins to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as PatchDoc;
    const pos = new Map(doc.nodes.map((n) => [n.id, n.pos]));

    test(`${file}: every wire runs left to right`, () => {
      const backwards = doc.edges
        .filter((e) => e.from.node !== e.to.node && pos.get(e.from.node)![0] >= pos.get(e.to.node)![0])
        .map((e) => `${e.from.node}.${e.from.port} → ${e.to.node}.${e.to.port}`);
      expect(backwards, FIX).toEqual([]);
    });

    test(`${file}: no two nodes overlap`, () => {
      const { width, height } = DEFAULT_SIZE;
      const overlapping: string[] = [];
      doc.nodes.forEach((a, i) => {
        for (const b of doc.nodes.slice(i + 1)) {
          if (Math.abs(a.pos[0] - b.pos[0]) < width && Math.abs(a.pos[1] - b.pos[1]) < height) {
            overlapping.push(`${a.id} / ${b.id}`);
          }
        }
      });
      expect(overlapping, FIX).toEqual([]);
    });
  }
});
