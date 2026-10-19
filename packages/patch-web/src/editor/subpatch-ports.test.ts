import { describe, expect, test } from "bun:test";
import { suggestConnections } from "./connect";
import { ledNodes } from "./domains";
import {
  boundaryShape,
  subpatchHasOut,
  subpatchInlets,
  subpatchOutlets,
  type PatchDoc,
  type PatchNode,
  type PatchNodeType,
  type PatchShape,
} from "../types";

const T = (id: string, category: PatchNodeType["category"], inputs: [string, PatchShape][], outputs: [string, PatchShape][]): PatchNodeType => ({
  id,
  label: id,
  category,
  inputs: inputs.map(([name, shape]) => ({ name, shape })),
  outputs: outputs.map(([name, shape]) => ({ name, shape })),
  params: [],
});

const kinds = new Map<string, PatchNodeType>([
  ["random_field", T("random_field", "generator", [], [["out", "led_scalar"]])],
  ["colorize", T("colorize", "field", [["in", "field_scalar"]], [["out", "field_color"]])],
  ["plasma", T("plasma", "generator", [], [["out", "field_color"]])],
  ["patch_in", T("patch_in", "combine", [["in", "field_color"]], [["out", "field_color"]])],
  ["patch_out", T("patch_out", "combine", [["in", "field_color"]], [["out", "field_color"]])],
  ["subpatch", T("subpatch", "combine", [], [["out", "field_color"]])],
  ["output", T("output", "sink", [["in", "field_color"]], [])],
]);

const node = (id: string, kind: string, extra: Partial<PatchNode> = {}): PatchNode => ({
  id,
  kind,
  name: "",
  params: {},
  pos: [0, 0],
  ...extra,
});
const wire = (from: string, to: string, fromPort = "out", toPort = "in") => ({
  from: { node: from, port: fromPort },
  to: { node: to, port: toPort },
});
const doc = (nodes: PatchNode[], edges: PatchDoc["edges"]): PatchDoc => ({ format: 7, id: "", name: "", nodes, edges, exposed: [] });

describe("a Sub-patch's ports", () => {
  const block = doc(
    [
      node("img", "patch_in", { name: "Picture" }),
      node("amount", "patch_in", { params: { shape: 2 } }),
      node("folded", "patch_out"),
      node("level", "patch_out", { name: "Level", params: { shape: 1 } }),
    ],
    [wire("img", "folded")],
  );
  const sub = node("s", "subpatch", { sub: block });

  test("one per Patch in and Patch out, by id, labelled by name, shaped by the select", () => {
    expect(subpatchInlets(sub)).toEqual([
      { name: "img", label: "Picture", shape: "field_color" },
      { name: "amount", label: "amount", shape: "scalar" },
    ]);
    expect(subpatchOutlets(sub)).toEqual([
      { name: "folded", label: "folded", shape: "field_color" },
      { name: "level", label: "Level", shape: "field_scalar" },
    ]);
  });

  test("out stays unless the patch is a block with Patch outs and no Output", () => {
    expect(subpatchHasOut(sub)).toBe(false);
    expect(subpatchHasOut(node("s", "subpatch"))).toBe(true);
    const picture = doc([node("p", "plasma"), node("o", "output"), node("x", "patch_out")], [wire("p", "o")]);
    expect(subpatchHasOut(node("s", "subpatch", { sub: picture }))).toBe(true);
  });

  test("a shape select out of range is the last shape", () => {
    expect(boundaryShape(node("x", "patch_in", { params: { shape: 99 } }))).toBe("led_scalar");
    expect(boundaryShape(node("x", "plasma"))).toBeNull();
  });
});

describe("domains through boundaries", () => {
  test("an LED-shaped Patch in is LED data; a Sub-patch whose Patch out is fed LED data hands it on", () => {
    const ledIn = node("li", "patch_in", { params: { shape: 4 } });
    expect(ledNodes(doc([ledIn], []), kinds).has("li")).toBe(true);
    const block = doc([node("snow", "random_field"), node("tint", "colorize"), node("leds", "patch_out")], [
      wire("snow", "tint"),
      wire("tint", "leds"),
    ]);
    expect(ledNodes(doc([node("s", "subpatch", { sub: block })], []), kinds).has("s")).toBe(true);
  });
});

describe("the connect chooser", () => {
  test("offers a Patch out for a wire from an output, shaped to it, and a Patch in for one into an input", () => {
    const fromLeds = suggestConnections(kinds.values(), { shape: "led_color", dir: "out" });
    const out = fromLeds.find((s) => s.type.id === "patch_out")!;
    expect(out).toMatchObject({ port: "in", params: { shape: 4 } });
    expect(fromLeds.some((s) => s.type.id === "patch_in")).toBe(false);
    expect(fromLeds.at(-1)?.type.id).toBe("patch_out");

    const intoNumber = suggestConnections(kinds.values(), { shape: "scalar", dir: "in" });
    expect(intoNumber.find((s) => s.type.id === "patch_in")).toMatchObject({ port: "out", params: { shape: 2 } });
    expect(intoNumber.some((s) => s.type.id === "patch_out")).toBe(false);
  });
});
