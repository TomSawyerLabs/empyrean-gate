import { describe, expect, test } from "bun:test";
import { combinerFor, freeSpot, insertCombiner } from "./combine";
import { PATCH_FORMAT, type PatchDoc, type PatchNodeType, type PatchParamDef } from "../types";

const num = (name: string): PatchParamDef => ({
  name,
  label: name,
  min: 0,
  max: 1,
  default: 0.5,
  integrate: false,
  kind: "number",
});

const T = (
  id: string,
  inputs: [string, PatchNodeType["inputs"][number]["shape"]][],
  outputs: [string, PatchNodeType["outputs"][number]["shape"]][],
  params: string[] = [],
): PatchNodeType => ({
  id,
  label: id,
  category: "combine",
  inputs: inputs.map(([name, shape]) => ({ name, shape })),
  outputs: outputs.map(([name, shape]) => ({ name, shape })),
  params: params.map(num),
});

const registry = new Map(
  [
    T("blend", [["base", "field_color"], ["over", "field_color"]], [["out", "field_color"]], ["opacity"]),
    T("field_math", [["a", "field_scalar"], ["b", "field_scalar"]], [["out", "field_scalar"]], ["gain"]),
    T("event_merge", [["a", "event"], ["b", "event"]], [["out", "event"]], ["open"]),
    T("scalar_math", [], [["out", "scalar"]], ["a", "b"]),
  ].map((t) => [t.id, t]),
);

describe("combinerFor", () => {
  test("each shape gets its combiner", () => {
    expect(combinerFor(registry, "field_color", "field_color", "field_color")?.kind).toBe("blend");
    expect(combinerFor(registry, "field_scalar", "field_scalar", "field_scalar")?.kind).toBe("field_math");
    expect(combinerFor(registry, "event", "event", "event")?.kind).toBe("event_merge");
    // Math's operands are knobs, which take numbers like any shaped input.
    expect(combinerFor(registry, "scalar", "scalar", "scalar")).toMatchObject({
      kind: "scalar_math",
      lower: "a",
      upper: "b",
    });
  });

  test("the adapters still apply: a grey field blends into a colour input", () => {
    expect(combinerFor(registry, "field_color", "field_color", "field_scalar")?.kind).toBe("blend");
    expect(combinerFor(registry, "field_scalar", "scalar", "field_scalar")?.kind).toBe("field_math");
  });

  test("no combiner for points, or for a wire the combiner cannot take", () => {
    expect(combinerFor(registry, "points", "points", "points")).toBeNull();
    expect(combinerFor(registry, "field_scalar", "field_scalar", "field_color")).toBeNull();
    expect(combinerFor(new Map(), "field_color", "field_color", "field_color")).toBeNull();
  });
});

function doc(): PatchDoc {
  return {
    format: PATCH_FORMAT,
    id: "",
    name: "t",
    description: "",
    nodes: [
      { id: "a", kind: "noise", name: "", params: {}, pos: [0, 0] },
      { id: "b", kind: "plasma", name: "", params: {}, pos: [0, 200] },
      { id: "o", kind: "output", name: "", params: {}, pos: [400, 0] },
    ],
    edges: [{ from: { node: "a", port: "out" }, to: { node: "o", port: "in" } }],
    exposed: [],
  };
}

describe("insertCombiner", () => {
  const blend = combinerFor(registry, "field_color", "field_color", "field_color")!;

  test("the old wire goes under, the new one over, and the combiner feeds the input", () => {
    const d = doc();
    expect(insertCombiner(d, { node: "o", port: "in" }, { node: "b", port: "out" }, blend, "n9", [200, 0])).toBe(true);
    expect(d.nodes.at(-1)).toEqual({ id: "n9", kind: "blend", name: "", params: {}, pos: [200, 0], collapsed: true });
    expect(d.edges).toEqual([
      { from: { node: "a", port: "out" }, to: { node: "n9", port: "base" } },
      { from: { node: "b", port: "out" }, to: { node: "n9", port: "over" } },
      { from: { node: "n9", port: "out" }, to: { node: "o", port: "in" } },
    ]);
  });

  test("a third wire stacks on the second", () => {
    const d = doc();
    d.nodes.push({ id: "c", kind: "fire", name: "", params: {}, pos: [0, 400] });
    insertCombiner(d, { node: "o", port: "in" }, { node: "b", port: "out" }, blend, "n9", [200, 0]);
    insertCombiner(d, { node: "o", port: "in" }, { node: "c", port: "out" }, blend, "n10", [200, 150]);
    expect(d.edges.filter((e) => e.to.node === "n10")).toEqual([
      { from: { node: "n9", port: "out" }, to: { node: "n10", port: "base" } },
      { from: { node: "c", port: "out" }, to: { node: "n10", port: "over" } },
    ]);
    expect(d.edges.filter((e) => e.to.node === "o")).toEqual([
      { from: { node: "n10", port: "out" }, to: { node: "o", port: "in" } },
    ]);
  });

  test("nothing wired into the input: no change", () => {
    const d = doc();
    const before = structuredClone(d);
    expect(insertCombiner(d, { node: "o", port: "master" }, { node: "b", port: "out" }, blend, "n9", [0, 0])).toBe(false);
    expect(d).toEqual(before);
  });
});

describe("freeSpot", () => {
  const size = { width: 100, height: 100 };

  test("an empty canvas takes the spot asked for", () => {
    expect(freeSpot([10, 20], size, [])).toEqual([10, 20]);
  });

  test("a taken spot steps below first, then above", () => {
    const taken = [{ x: 0, y: 0, width: 100, height: 100 }];
    expect(freeSpot([0, 0], size, taken)).toEqual([0, 116]);
    const below = [...taken, { x: 0, y: 116, width: 100, height: 100 }];
    expect(freeSpot([0, 0], size, below)).toEqual([0, -116]);
  });

  test("a full column moves left", () => {
    const column = Array.from({ length: 9 }, (_, k) => ({ x: 0, y: (k - 4) * 116, width: 100, height: 100 }));
    expect(freeSpot([0, 0], size, column)).toEqual([-116, 0]);
  });
});
