import { describe, expect, test } from "bun:test";
import { colourCalls, fromHex, hsvToRgb, lit3, recolour, rgbToHsv, toHex, type Rgb } from "./code-swatches";

/** `text` with `edits` applied. */
function apply(text: string, edits: { from: number; to: number; insert: string }[]) {
  let s = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) s = s.slice(0, e.from) + e.insert + s.slice(e.to);
  return s;
}

describe("colourCalls", () => {
  test("reads colours spelled out in literals", () => {
    const calls = colourCalls("out = vec4f(1.0, 0.5, 0.0, 1.0) + vec4f(vec3f(0.25), 1.0);");
    expect(calls.map((c) => [c.kind, c.rgb])).toEqual([
      ["rgb", [1, 0.5, 0]],
      ["splat", [0.25, 0.25, 0.25]],
    ]);
    expect(colourCalls("let c = hsv2rgb(0.5, 1.0, 1.0);")[0]!.rgb).toEqual([0, 1, 1]);
  });

  test("skips anything computed", () => {
    expect(colourCalls("out = vec4f(hue, 0.5, 0.0, 1.0);")).toEqual([]);
    expect(colourCalls("out = vec4f(rgb, 1.0);")).toEqual([]);
    expect(colourCalls("let c = hsv2rgb(fract(t), 1.0, 1.0);")).toEqual([]);
    expect(colourCalls("let c = vec3f(1.0, 0.5")).toEqual([]);
  });
});

describe("conversions", () => {
  test("hsv matches the shader lib's, both ways", () => {
    expect(hsvToRgb(0, 1, 1)).toEqual([1, 0, 0]);
    expect(hsvToRgb(1 / 3, 1, 1).map((x) => Math.round(x * 1000) / 1000)).toEqual([0, 1, 0]);
    const back = rgbToHsv([0.2, 0.4, 0.8]);
    expect(hsvToRgb(...back).map((x) => Math.round(x * 1000) / 1000)).toEqual([0.2, 0.4, 0.8]);
  });
  test("hex, and literals with one to three decimals", () => {
    expect(toHex([1, 0.5, 0])).toBe("#ff8000");
    expect(fromHex("#ff8000").map((x) => Math.round(x * 100) / 100)).toEqual([1, 0.5, 0]);
    expect(toHex([2, -1, 0.5] as Rgb)).toBe("#ff0080");
    expect([lit3(1), lit3(0.25), lit3(1 / 3)]).toEqual(["1.0", "0.25", "0.333"]);
  });
});

describe("recolour", () => {
  test("rewrites the literals of each form", () => {
    const text = "out = vec4f(1.0, 0.5, 0.0, 1.0);";
    expect(apply(text, recolour(colourCalls(text)[0]!, [0, 0.25, 1]))).toBe("out = vec4f(0.0, 0.25, 1.0, 1.0);");
    const splat = "let g = vec3f(0.5);";
    expect(apply(splat, recolour(colourCalls(splat)[0]!, [0.2, 0.2, 0.2]))).toBe("let g = vec3f(0.2);");
    expect(apply(splat, recolour(colourCalls(splat)[0]!, [1, 0, 0]))).toBe("let g = vec3f(1.0, 0.0, 0.0);");
    const hsv = "let c = hsv2rgb(0.0, 1.0, 1.0);";
    expect(apply(hsv, recolour(colourCalls(hsv)[0]!, [0, 0, 1]))).toBe("let c = hsv2rgb(0.667, 1.0, 1.0);");
  });
});
