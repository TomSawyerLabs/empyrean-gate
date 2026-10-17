import { describe, expect, test } from "bun:test";
import { ARRANGE_MARGIN, arrangeDoc, DEFAULT_SIZE, type NodeSize } from "./arrange";
import type { PatchDoc } from "../types";

function doc(nodes: string[], edges: [string, string][]): PatchDoc {
  return {
    id: "d",
    name: "d",
    format: 1,
    nodes: nodes.map((id, i) => ({ id, kind: "noise_field", name: "", params: {}, pos: [i * 7, 500 - i * 3] })),
    edges: edges.map(([from, to]) => ({ from: { node: from, port: "out" }, to: { node: to, port: "in" } })),
    exposed: [],
  } as unknown as PatchDoc;
}

function overlaps(
  a: [number, number],
  b: [number, number],
  sa: NodeSize = DEFAULT_SIZE,
  sb: NodeSize = DEFAULT_SIZE,
): boolean {
  return a[0] < b[0] + sb.width && b[0] < a[0] + sa.width && a[1] < b[1] + sb.height && b[1] < a[1] + sa.height;
}

describe("arrangeDoc", () => {
  test("a chain runs left to right on one row, starting at the margin", () => {
    const out = arrangeDoc(doc(["a", "b", "c"], [["a", "b"], ["b", "c"]]));
    const [a, b, c] = ["a", "b", "c"].map((id) => out.get(id)!);
    expect(a[0]).toBe(ARRANGE_MARGIN);
    expect(a[1]).toBe(ARRANGE_MARGIN);
    expect(b[0]).toBeGreaterThan(a[0] + DEFAULT_SIZE.width);
    expect(c[0]).toBeGreaterThan(b[0] + DEFAULT_SIZE.width);
    expect(b[1]).toBe(a[1]);
    expect(c[1]).toBe(a[1]);
  });

  test("a fan-in stacks the sources in one rank without overlap", () => {
    const d = doc(["s1", "s2", "s3", "mix", "out"], [
      ["s1", "mix"],
      ["s2", "mix"],
      ["s3", "mix"],
      ["mix", "out"],
    ]);
    const out = arrangeDoc(d);
    const xs = ["s1", "s2", "s3"].map((id) => out.get(id)![0]);
    expect(new Set(xs).size).toBe(1);
    expect(out.get("mix")![0]).toBeGreaterThan(xs[0]);
    expect(out.get("out")![0]).toBeGreaterThan(out.get("mix")![0]);
    const ids = d.nodes.map((n) => n.id);
    for (const p of ids) for (const q of ids) if (p < q) expect(overlaps(out.get(p)!, out.get(q)!)).toBe(false);
  });

  test("the same document lays out the same way twice; old positions do not matter", () => {
    const d = doc(["a", "b", "c", "d"], [["a", "c"], ["b", "c"], ["c", "d"]]);
    const once = arrangeDoc(d);
    const moved = structuredClone(d);
    for (const n of moved.nodes) n.pos = [Math.random() * 1000, Math.random() * 1000];
    expect(arrangeDoc(moved)).toEqual(once);
  });

  test("measured sizes are honoured and a self-wire or a loop does not break it", () => {
    const d = doc(["big", "small", "back"], [["big", "small"], ["small", "back"], ["back", "big"], ["big", "big"]]);
    const sizes = new Map<string, NodeSize>([["big", { width: 400, height: 300 }]]);
    const out = arrangeDoc(d, sizes);
    expect(out.size).toBe(3);
    const big = out.get("big")!;
    const small = out.get("small")!;
    expect(overlaps(big, small, sizes.get("big"), DEFAULT_SIZE)).toBe(false);
    for (const p of out.values()) {
      expect(p[0]).toBeGreaterThanOrEqual(ARRANGE_MARGIN);
      expect(p[1]).toBeGreaterThanOrEqual(ARRANGE_MARGIN);
    }
  });
});
