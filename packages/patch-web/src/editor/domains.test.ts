import { describe, expect, test } from "bun:test";
import { codeReadsLeds, codeSamples, fitsInput, isSampledInput, ledNodes } from "./domains";
import type { CodeDef, PatchDoc, PatchNode, PatchNodeType, PatchShape } from "../types";

const T = (
  id: string,
  inputs: [string, PatchShape][],
  outputs: [string, PatchShape][],
  sampled?: string[],
): PatchNodeType => ({
  id,
  label: id,
  category: "field",
  inputs: inputs.map(([name, shape]) => ({ name, shape })),
  outputs: outputs.map(([name, shape]) => ({ name, shape })),
  params: [],
  ...(sampled ? { sampled } : {}),
});

// A slice of the real palette, as `palette_json` describes it.
const kinds = new Map<string, PatchNodeType>([
  ["random_field", T("random_field", [], [["out", "led_scalar"]])],
  ["gradient", T("gradient", [], [["out", "field_color"]])],
  ["colorize", T("colorize", [["in", "field_scalar"]], [["out", "field_color"]])],
  ["blend", T("blend", [["base", "field_color"], ["over", "field_color"]], [["out", "field_color"]])],
  ["transform", T("transform", [["in", "field_color"]], [["out", "field_color"]], ["in"])],
  ["resample", T("resample", [["in", "field_color"]], [["out", "field_color"]])],
  ["output", T("output", [["in", "field_color"]], [])],
  ["code", T("code", [], [])],
  ["subpatch", T("subpatch", [], [["out", "field_color"]])],
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
const doc = (nodes: PatchNode[], edges: PatchDoc["edges"]): PatchDoc => ({
  format: 6,
  id: "",
  name: "",
  nodes,
  edges,
  exposed: [],
});
const codeDef = (inputs: [string, PatchShape][], outputs: [string, PatchShape][], body: string): CodeDef => ({
  inputs: inputs.map(([name, shape]) => ({ name, shape, min: 0, max: 1, default: 0 })),
  outputs: outputs.map(([name, shape]) => ({ name, shape, min: 0, max: 1, default: 0 })),
  body,
});

describe("ledNodes", () => {
  test("LED data flows through pointwise nodes, and Resample turns it into the plane", () => {
    const d = doc(
      [
        node("snow", "random_field"),
        node("tint", "colorize"),
        node("sky", "gradient"),
        node("mix", "blend"),
        node("rs", "resample"),
        node("t", "transform"),
        node("o", "output"),
      ],
      [
        wire("snow", "tint"),
        wire("sky", "mix", "out", "base"),
        wire("tint", "mix", "out", "over"),
        wire("mix", "rs"),
        wire("rs", "t"),
        wire("t", "o"),
      ],
    );
    expect([...ledNodes(d, kinds)].sort()).toEqual(["mix", "snow", "tint"]);
  });

  test("a Code node is LED data when it keys on the LED or declares it", () => {
    const keyed = node("k", "code", { code: codeDef([], [["out", "field_color"]], "out = vec4f(f32(c.spoke % 2u));") });
    const declared = node("d", "code", { code: codeDef([], [["out", "led_color"]], "out = vec4f(c.r01);") });
    const plane = node("p", "code", {
      code: codeDef([], [["out", "field_color"]], "// c.spoke would key on the LED\nlet v = x.c.i; out = vec4f(c.r01);"),
    });
    expect([...ledNodes(doc([keyed, declared, plane], []), kinds)].sort()).toEqual(["d", "k"]);
  });

  test("a Sub-patch hands on what feeds its inner Output", () => {
    const inner = doc([node("snow", "random_field"), node("tint", "colorize"), node("o", "output")], [
      wire("snow", "tint"),
      wire("tint", "o"),
    ]);
    const d = doc([node("s", "subpatch", { sub: inner }), node("t", "transform")], [wire("s", "t")]);
    expect(ledNodes(d, kinds).has("s")).toBe(true);
  });
});

describe("sampled inputs", () => {
  test("from the palette, and from a Code body's name_at", () => {
    expect(isSampledInput(kinds.get("transform"), node("t", "transform"), "in")).toBe(true);
    expect(isSampledInput(kinds.get("blend"), node("b", "blend"), "over")).toBe(false);
    const sampler = node("s", "code", { code: codeDef([["img", "field_color"]], [["out", "field_color"]], "out = img_at(c);") });
    const reader = node("r", "code", { code: codeDef([["img", "field_color"]], [["out", "field_color"]], "out = img; // img_at(c)") });
    expect(isSampledInput(kinds.get("code"), sampler, "img")).toBe(true);
    expect(isSampledInput(kinds.get("code"), reader, "img")).toBe(false);
  });

  test("LED data fits every field input except a sampled one", () => {
    expect(fitsInput("field_color", false, "led_color")).toBe(true);
    expect(fitsInput("field_color", true, "led_color")).toBe(false);
    expect(fitsInput("field_color", true, "field_color")).toBe(true);
    expect(fitsInput("field_scalar", false, "led_scalar")).toBe(true);
    expect(fitsInput("led_scalar", false, "scalar")).toBe(true);
    expect(fitsInput("field_scalar", false, "led_color")).toBe(false);
  });

  test("the body tests ignore comments and other names", () => {
    const d = (body: string) => codeDef([["img", "field_color"]], [["out", "field_color"]], body);
    expect(codeSamples(d("/* img_at(c) */ out = img;"), "img")).toBe(false);
    expect(codeSamples(d("out = myimg_at(c);"), "img")).toBe(false);
    expect(codeReadsLeds(d("let n = c . i;"))).toBe(true);
    expect(codeReadsLeds(d("return c.id;"))).toBe(false);
    // A CPU-tier body has no LEDs to key on.
    expect(codeReadsLeds(codeDef([], [["out", "scalar"]], "out = c.i;"))).toBe(false);
  });

  test("a body that renders a texture reads every field input between the LEDs", () => {
    const tex = codeDef([["img", "field_color"]], [["out", "texture"]], "out = img;");
    expect(codeSamples(tex, "img")).toBe(true);
    // Its one output; with another beside it the core refuses the node.
    expect(codeSamples(codeDef([["img", "field_color"]], [["out", "texture"], ["o2", "field_color"]], "out = img;"), "img")).toBe(
      false,
    );
  });
});
