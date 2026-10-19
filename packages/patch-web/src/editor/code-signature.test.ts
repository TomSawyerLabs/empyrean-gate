import { describe, expect, test } from "bun:test";
import { callAt, splitSignature } from "./code-signature";

/** `callAt` with the caret where `|` is. */
function at(text: string) {
  const pos = text.indexOf("|");
  return callAt(text.replace("|", ""), pos);
}

describe("callAt", () => {
  test("names the innermost open call and the argument the caret is in", () => {
    expect(at("out = mix(a, |")).toEqual({ from: 6, name: "mix", arg: 1 });
    expect(at("out = vec4f(hsv2rgb(h, s|), 1.0);")).toMatchObject({ name: "hsv2rgb", arg: 1 });
    expect(at("out = vec4f(hsv2rgb(h, s, v), |")).toMatchObject({ name: "vec4f", arg: 1 });
    expect(at("let x = clamp( |")).toMatchObject({ name: "clamp", arg: 0 });
  });

  test("skips nested calls, indexing and comments", () => {
    expect(at("out = mix(f(a, b), arr[1, 2], |")).toMatchObject({ name: "mix", arg: 2 });
    expect(at("out = mix(a, // (x, y\n |")).toMatchObject({ name: "mix", arg: 1 });
  });

  test("is nothing outside a call, in a control head, or past a statement", () => {
    expect(at("out = a + |")).toBeNull();
    expect(at("if (x > |")).toBeNull();
    expect(at("for (var i = 0u; i < |")).toBeNull();
    expect(at("f(a); |")).toBeNull();
    expect(at("out = (a + |")).toBeNull();
  });
});

describe("splitSignature", () => {
  test("splits the top-level parameters and keeps the return type", () => {
    expect(splitSignature("hsv2rgb(h: f32, s: f32, v: f32) -> vec3f")).toEqual({
      head: "hsv2rgb(",
      params: ["h: f32", "s: f32", "v: f32"],
      tail: ") -> vec3f",
    });
    expect(splitSignature("f(a: array<f32, 4>, b)").params).toEqual(["a: array<f32, 4>", "b"]);
    expect(splitSignature("noargs()").params).toEqual([]);
  });
});
