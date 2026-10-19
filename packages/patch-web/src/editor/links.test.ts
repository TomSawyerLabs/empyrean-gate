import { describe, expect, test } from "bun:test";
import { linksTo, snapshot, sourceRev, summarize, syncLinks } from "./links";
import type { PatchDoc, PatchNode } from "../types";

const doc = (id: string, nodes: PatchNode[]): PatchDoc => ({
  format: 6,
  id,
  name: id.toUpperCase(),
  description: "",
  nodes,
  edges: [],
  exposed: [],
});
const solid = (id: string): PatchNode => ({ id, kind: "solid", name: "", params: {}, pos: [0, 0] });
const sub = (id: string, source: string, linked: boolean, inner: PatchDoc): PatchNode => ({
  id,
  kind: "subpatch",
  name: "",
  params: {},
  pos: [0, 0],
  sub: inner,
  source,
  ...(linked ? { linked } : {}),
});

describe("links", () => {
  test("a linked copy follows its source; a clone does not", () => {
    const a = doc("a", [solid("x")]);
    const parent = doc("p", [sub("s1", "a", true, snapshot(a)), sub("s2", "a", false, snapshot(a))]);
    const a2 = doc("a", [solid("x"), solid("y")]);
    expect(syncLinks(parent, a2)).toBe(true);
    expect(parent.nodes[0]!.sub!.nodes).toHaveLength(2);
    expect(parent.nodes[0]!.sub!.id).toBe("");
    expect(parent.nodes[1]!.sub!.nodes).toHaveLength(1);
    expect(syncLinks(parent, a2)).toBe(false);
  });

  test("links inside a clone are followed; a source linking back is refused", () => {
    const a = doc("a", [solid("x")]);
    const parent = doc("p", [sub("s", "b", false, doc("", [sub("deep", "a", true, snapshot(a))]))]);
    expect(linksTo(parent, "a")).toBe(true);
    expect(linksTo(parent, "b")).toBe(false);
    expect(syncLinks(parent, doc("a", [solid("x"), solid("y")]))).toBe(true);
    const back = doc("a", [sub("b", "p", true, doc("", []))]);
    expect(syncLinks(parent, back)).toBe(false);
  });

  test("sourceRev ignores names and field order, not content", () => {
    const a = doc("a", [solid("x")]);
    const renamed = { ...structuredClone(a), name: "Other" };
    const reordered = { ...a, nodes: [{ pos: [0, 0], params: {}, name: "", kind: "solid", id: "x" } as PatchNode] };
    expect(sourceRev(renamed)).toBe(sourceRev(a));
    expect(sourceRev(reordered)).toBe(sourceRev(a));
    expect(sourceRev(doc("a", [solid("y")]))).not.toBe(sourceRev(a));
  });

  test("summaries list kinds and the sub-patch tree", () => {
    const a = doc("a", [solid("x")]);
    const s = summarize(doc("p", [solid("o"), sub("s", "a", true, snapshot(a))]));
    expect(s.kinds).toEqual(["solid", "subpatch"]);
    expect(s.subpatches).toEqual([{ node: "s", name: "A", source: "a", linked: true }]);
  });
});
