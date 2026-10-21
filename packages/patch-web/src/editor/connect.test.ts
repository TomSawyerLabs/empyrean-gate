import { describe, expect, test } from "bun:test";
import { suggestConnections } from "./connect";
import type { PatchNodeType, PatchParamDef } from "../types";

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
  category: PatchNodeType["category"],
  inputs: [string, PatchNodeType["inputs"][number]["shape"]][],
  outputs: [string, PatchNodeType["outputs"][number]["shape"]][],
  params: string[] = [],
): PatchNodeType => ({
  id,
  label: id,
  category,
  inputs: inputs.map(([name, shape]) => ({ name, shape })),
  outputs: outputs.map(([name, shape]) => ({ name, shape })),
  params: params.map(num),
});

const registry: PatchNodeType[] = [
  T("time", "input", [["reset", "event"]], [["out", "scalar"], ["wrap", "event"]], ["rate"]),
  T("slider", "input", [], [["out", "scalar"]], ["value"]),
  T("tap", "input", [], [["tap", "event"]]),
  T("smooth", "scalar", [], [["out", "scalar"]], ["in", "time"]),
  T("envelope", "scalar", [["trigger", "event"]], [["out", "scalar"]], ["attack"]),
  T("noise", "generator", [], [["out", "field_scalar"]], ["speed", "scale"]),
  T("colorize", "field", [["in", "field_scalar"]], [["out", "field_color"]], ["hue"]),
  T("blend", "combine", [["base", "field_color"], ["over", "field_color"]], [["out", "field_color"]], ["opacity"]),
  T("output", "sink", [["in", "field_color"]], [], ["master"]),
  T("subpatch", "combine", [], [["out", "field_color"]]),
];

describe("suggestConnections", () => {
  test("from a scalar output: scalar ops first, knobs after shaped inputs, nothing that cannot take a number", () => {
    const s = suggestConnections(registry, { shape: "scalar", dir: "out" });
    const ids = s.map((x) => `${x.type.id}.${x.port}`);
    // Scalar tools lead (both take the number through a knob, so by name).
    expect(ids.slice(0, 2)).toEqual(["envelope.attack", "smooth.in"]);
    expect(ids).toContain("noise.speed");
    expect(ids).toContain("output.master");
    // A number may drive a grey field input through the blessed adapter,
    // but that is an adapter, so it ranks behind every exact match.
    const colorize = s.find((x) => x.type.id === "colorize")!;
    expect(colorize.port).toBe("hue");
    expect(colorize.exact).toBe(true);
    expect(ids).not.toContain("tap.tap");
    expect(ids.some((id) => id.startsWith("subpatch"))).toBe(false);
  });

  test("from an event output: only event inputs, inputs and scalar tools first", () => {
    const s = suggestConnections(registry, { shape: "event", dir: "out" });
    expect(s.map((x) => `${x.type.id}.${x.port}`)).toEqual(["envelope.trigger", "time.reset"]);
    expect(s.every((x) => x.exact && !x.viaParam)).toBe(true);
  });

  test("from a colour-field input: generators and field ops that produce it, grey fields as adapters", () => {
    const s = suggestConnections(registry, { shape: "field_color", dir: "in" });
    const ids = s.map((x) => x.type.id);
    expect(ids.slice(0, 2)).toEqual(["colorize", "blend"]);
    const noise = s.find((x) => x.type.id === "noise")!;
    expect(noise.exact).toBe(false);
    expect(ids.indexOf("noise")).toBeGreaterThan(ids.indexOf("blend"));
    expect(ids).not.toContain("slider");
  });

  test("from a number input: sliders and clocks before everything else", () => {
    const s = suggestConnections(registry, { shape: "scalar", dir: "in" });
    expect(s.slice(0, 2).map((x) => x.type.id)).toEqual(["slider", "time"]);
    expect(s.find((x) => x.type.id === "time")!.port).toBe("out");
  });

  test("the same registry gives the same list twice", () => {
    const a = suggestConnections(registry, { shape: "scalar", dir: "out" });
    const b = suggestConnections([...registry].reverse(), { shape: "scalar", dir: "out" });
    expect(a.map((x) => x.type.id)).toEqual(b.map((x) => x.type.id));
  });
});

describe("a Debug node", () => {
  const withDebug = [...registry, T("debug", "debug", [["in", "any"]], [])];

  test("is offered for a wire from any output, last, as an exact fit", () => {
    for (const shape of ["scalar", "event", "field_scalar", "field_color", "points", "effects", "texture"] as const) {
      const s = suggestConnections(withDebug, { shape, dir: "out" });
      const last = s[s.length - 1];
      expect(last.type.id).toBe("debug");
      expect(last.port).toBe("in");
      expect(last.exact).toBe(true);
    }
  });

  test("is never offered as a producer: it has no outputs", () => {
    const s = suggestConnections(withDebug, { shape: "scalar", dir: "in" });
    expect(s.some((x) => x.type.id === "debug")).toBe(false);
  });
});
