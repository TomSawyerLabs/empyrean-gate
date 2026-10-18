import { describe, expect, test } from "bun:test";
import { addLayer, layerFor, moveLayer, removeLayer } from "./layers";
import {
  PATCH_FORMAT,
  nodeInputs,
  nodeParams,
  splitLayer,
  type PatchDoc,
  type PatchNodeType,
} from "../types";

const blend: PatchNodeType = {
  id: "blend",
  label: "Blend",
  category: "combine",
  layered: { names: ["over", "mode", "opacity"], max: 4 },
  inputs: [
    { name: "base", shape: "field_color" },
    { name: "over", shape: "field_color" },
  ],
  outputs: [{ name: "out", shape: "field_color" }],
  params: [
    { name: "mode", label: "Mode", min: 0, max: 4, default: 0, integrate: false, kind: { select: ["add", "multiply"] } },
    { name: "opacity", label: "Opacity", min: 0, max: 1, default: 1, integrate: false, kind: "number" },
  ],
};
const gen = (id: string): PatchNodeType => ({
  id,
  label: id,
  category: "generator",
  inputs: [],
  outputs: [{ name: "out", shape: "field_color" }],
  params: [],
});
const registry = new Map([blend, gen("plasma"), gen("fire"), gen("noise")].map((t) => [t.id, t]));

const wire = (from: string, to: string, port: string) => ({
  from: { node: from, port: "out" },
  to: { node: to, port },
});

/** Noise under Plasma under Fire in a three-layer Blend into Output, layer
 * 2's opacity set and exposed. */
function doc(): PatchDoc {
  return {
    format: PATCH_FORMAT,
    id: "",
    name: "t",
    description: "",
    nodes: [
      { id: "a", kind: "noise", name: "", params: {}, pos: [0, 0] },
      { id: "b", kind: "plasma", name: "", params: {}, pos: [0, 100] },
      { id: "c", kind: "fire", name: "", params: {}, pos: [0, 200] },
      { id: "m", kind: "blend", name: "", params: { opacity2: 0.5, mode3: 1 }, pos: [200, 0], layers: 3 },
      { id: "o", kind: "output", name: "", params: {}, pos: [400, 0] },
    ],
    edges: [wire("a", "m", "base"), wire("b", "m", "over2"), wire("c", "m", "over3"), wire("m", "o", "in")],
    exposed: [{ node: "m", param: "opacity2", label: "Opacity 2" }],
  };
}

const into = (d: PatchDoc, id: string) =>
  Object.fromEntries(d.edges.filter((e) => e.to.node === id).map((e) => [e.to.port, e.from.node]));

describe("instance ports", () => {
  test("each layer past the first adds its input and params", () => {
    const n = doc().nodes[3];
    expect(nodeInputs(blend, n).map((p) => p.name)).toEqual(["base", "over", "over2", "over3"]);
    expect(nodeParams(blend, n).map((p) => p.label)).toEqual([
      "Mode", "Opacity", "Mode 2", "Opacity 2", "Mode 3", "Opacity 3",
    ]);
    expect(splitLayer(blend, "over3", 3)).toEqual({ name: "over", k: 3 });
    expect(splitLayer(blend, "over4", 3)).toBeNull();
    expect(splitLayer(blend, "over03", 3)).toBeNull();
    expect(splitLayer(blend, "base", 3)).toBeNull();
  });
});

describe("addLayer / removeLayer / moveLayer", () => {
  test("a layer added inside the stack moves the ones above it up", () => {
    const d = doc();
    expect(addLayer(d, blend, "m", 2)).toBe("over2");
    expect(d.nodes[3].layers).toBe(4);
    expect(into(d, "m")).toEqual({ base: "a", over3: "b", over4: "c" });
    expect(d.nodes[3].params).toEqual({ opacity3: 0.5, mode4: 1 });
    expect(d.exposed).toEqual([{ node: "m", param: "opacity3", label: "Opacity 3" }]);
    // Full (max 4 here).
    expect(addLayer(d, blend, "m", 5)).toBeNull();
  });

  test("removing a layer takes its wire and values, and closes the gap", () => {
    const d = doc();
    expect(removeLayer(d, blend, "m", 2)).toBe(true);
    expect(d.nodes[3].layers).toBe(2);
    expect(into(d, "m")).toEqual({ base: "a", over2: "c" });
    expect(d.nodes[3].params).toEqual({ mode2: 1 });
    expect(d.exposed).toEqual([]);
    expect(removeLayer(d, blend, "m", 1)).toBe(true);
    expect(into(d, "m")).toEqual({ base: "a", over: "c" });
    expect(d.nodes[3].params).toEqual({ mode: 1 });
    expect("layers" in d.nodes[3]).toBe(false);
    expect(removeLayer(d, blend, "m", 1)).toBe(false);
  });

  test("moving a layer carries its wire, values and a custom label", () => {
    const d = doc();
    d.exposed[0].label = "Plasma fade";
    expect(moveLayer(d, blend, "m", 2, 3)).toBe(true);
    expect(into(d, "m")).toEqual({ base: "a", over3: "b", over2: "c" });
    expect(d.nodes[3].params).toEqual({ opacity3: 0.5, mode2: 1 });
    expect(d.exposed).toEqual([{ node: "m", param: "opacity3", label: "Plasma fade" }]);
    expect(moveLayer(d, blend, "m", 3, 1)).toBe(true);
    expect(into(d, "m")).toEqual({ base: "a", over: "b", over3: "c" });
  });
});

describe("layerFor", () => {
  test("on a Blend's own taken input: a new layer just above it", () => {
    const d = doc();
    expect(layerFor(d, registry, { node: "m", port: "over2" }, "field_color")).toEqual({ node: "m", at: 3 });
    expect(layerFor(d, registry, { node: "m", port: "base" }, "field_color")).toEqual({ node: "m", at: 1 });
    // A grey field fits a colour layer; a Points wire does not.
    expect(layerFor(d, registry, { node: "m", port: "base" }, "field_scalar")).not.toBeNull();
    expect(layerFor(d, registry, { node: "m", port: "base" }, "points")).toBeNull();
  });

  test("on an input a Blend feeds: a new top layer, unless the Blend feeds more", () => {
    const d = doc();
    expect(layerFor(d, registry, { node: "o", port: "in" }, "field_color")).toEqual({ node: "m", at: 4 });
    d.edges.push(wire("m", "x", "in"));
    expect(layerFor(d, registry, { node: "o", port: "in" }, "field_color")).toBeNull();
  });

  test("a full Blend takes no more", () => {
    const d = doc();
    d.nodes[3].layers = 4;
    expect(layerFor(d, registry, { node: "o", port: "in" }, "field_color")).toBeNull();
    expect(layerFor(d, registry, { node: "m", port: "over2" }, "field_color")).toBeNull();
  });
});
