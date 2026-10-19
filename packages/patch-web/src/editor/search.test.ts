import { expect, test } from "bun:test";
import type { PatchNodeType } from "../types";
import { matchScore, searchKinds, searchTypes } from "./search";

const kind = (id: string, label: string, description = "", group?: PatchNodeType["group"]): PatchNodeType => ({
  id,
  label,
  category: "generator",
  group,
  description,
  inputs: [],
  outputs: [],
  params: [],
});

const types = [
  kind("noise_field", "Noise field", "Drifting fractal simplex noise.", "patterns"),
  kind("perlin_noise", "Perlin noise", "Classic Perlin gradient noise.", "blocks"),
  kind("plasma", "Plasma", "The classic demoscene plasma.", "patterns"),
  kind("fire", "Fire", "Rising flames.", "patterns"),
];

test("label prefixes rank before word starts, which rank before descriptions", () => {
  expect(searchTypes(types, "noise").map((t) => t.id)).toEqual(["noise_field", "perlin_noise"]);
  expect(searchTypes(types, "classic").map((t) => t.id)).toEqual(["perlin_noise", "plasma"]);
});

test("every word must match somewhere", () => {
  expect(searchTypes(types, "noise perlin").map((t) => t.id)).toEqual(["perlin_noise"]);
  expect(matchScore(types[3]!, "fire water")).toBeNull();
});

test("the group's label matches too", () => {
  expect(searchTypes(types, "building").map((t) => t.id)).toEqual(["perlin_noise"]);
});

test("an empty query matches everything in order", () => {
  expect(searchTypes(types, "  ").map((t) => t.id)).toEqual(types.map((t) => t.id));
});

const random: PatchNodeType = {
  ...kind("random", "Random", "A random value in Min..Max. Hold: held until the next draw.", "motion"),
  category: "scalar",
  params: [
    { name: "mode", label: "Mode", min: 0, max: 3, default: 0, integrate: false, kind: { select: ["Hold", "Every frame", "Walk", "Smooth"] } },
  ],
};

test("a word naming a Select option finds the kind set to it", () => {
  const hits = searchKinds([...types, random], "walk");
  expect(hits.map((h) => [h.type.id, h.preset?.label])).toEqual([["random", "Walk"]]);
  expect(hits[0]!.preset).toEqual({ param: "mode", value: 2, label: "Walk" });
  // The rest of the query still has to match the kind.
  expect(searchKinds([...types, random], "fire walk")).toEqual([]);
  expect(searchKinds([...types, random], "random smooth").map((h) => h.preset?.label)).toEqual(["Smooth"]);
});

test("the default option is not offered again beside the kind itself", () => {
  const hits = searchKinds([random], "random hold");
  expect(hits.map((h) => h.preset?.label)).toEqual([undefined]);
});
