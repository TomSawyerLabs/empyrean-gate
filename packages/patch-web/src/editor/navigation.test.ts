import { describe, expect, test } from "bun:test";
import { cloneAlong, crumbs, docAt, flatId, lockAt, outputMini, sameLocation, validPath } from "./navigation";
import { sourceRev } from "./links";
import type { PatchDoc, PatchNode } from "../types";

const doc = (id: string, name: string, nodes: PatchNode[], edges: PatchDoc["edges"] = []): PatchDoc => ({
  format: 6,
  id,
  name,
  description: "",
  nodes,
  edges,
  exposed: [],
});
const node = (id: string, kind: string): PatchNode => ({ id, kind, name: "", params: {}, pos: [0, 0] });
const sub = (id: string, inner: PatchDoc, extra: Partial<PatchNode> = {}): PatchNode => ({
  ...node(id, "subpatch"),
  sub: inner,
  ...extra,
});

// root ─ s1 (linked to "a") ─ s2 (a clone) ─ { x → out }
const deepest = doc("", "Deep", [node("x", "solid"), node("o", "output")], [
  { from: { node: "x", port: "out" }, to: { node: "o", port: "in" } },
]);
const middle = doc("", "Middle", [sub("s2", deepest)]);
const root = doc("r", "Root", [node("n", "solid"), sub("s1", middle, { source: "a", linked: true })]);

describe("navigation", () => {
  test("paths resolve, and a broken tail is dropped", () => {
    expect(docAt(root, []).name).toBe("Root");
    expect(docAt(root, ["s1", "s2"]).name).toBe("Deep");
    expect(validPath(root, ["s1", "nope", "s2"])).toEqual(["s1"]);
    expect(validPath(root, ["n"])).toEqual([]);
    expect(crumbs(root, ["s1", "s2"]).map((c) => c.label)).toEqual(["Root", "Middle", "Deep"]);
  });

  test("a built-in, or anything under a linked Sub-patch, is locked", () => {
    expect(lockAt(root, [])).toBeNull();
    expect(lockAt(root, ["s1", "s2"])).toMatchObject({ kind: "linked", node: "s1", source: "a" });
    expect(lockAt({ ...root, id: "builtin-x" }, [])).toMatchObject({ kind: "builtin" });
  });

  test("cloning along the path unlocks it and remembers the source's revision", () => {
    const copy = structuredClone(root);
    cloneAlong(copy, ["s1", "s2"]);
    expect(lockAt(copy, ["s1", "s2"])).toBeNull();
    const s1 = copy.nodes[1]!;
    expect(s1.linked).toBeUndefined();
    expect(s1.source).toBe("a");
    expect(s1.source_rev).toBe(sourceRev(middle));
  });

  test("minis key on the flattened ids", () => {
    expect(flatId(root, [], "n")).toBe("n");
    expect(flatId(root, ["s1", "s2"], "x")).toBe("s1/s2");
    expect(flatId(root, ["s1"], "s2")).toBe("s1/s2");
  });

  test("an Output's mini is its own at the top, the Sub-patch's inside one", () => {
    expect(outputMini(root, [], "o")).toBe("o");
    expect(outputMini(root, ["s1", "s2"], "o")).toBe("s1/s2");
  });

  test("locations compare by value", () => {
    expect(sameLocation({ patch: "a", path: ["s"] }, { patch: "a", path: ["s"] })).toBe(true);
    expect(sameLocation({ patch: "a", path: [] }, { patch: "a", path: ["s"] })).toBe(false);
  });
});
