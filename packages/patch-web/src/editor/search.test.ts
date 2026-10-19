import { expect, test } from "bun:test";
import type { PatchNodeType } from "../types";
import { matchScore, searchTypes } from "./search";

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
