// Connection hints: when a wire is dragged from a port and dropped on empty
// canvas, which node types could sit at the other end, and through which
// port. Filtered by the shape rules (`shapeAccepts`) and sorted so the likely
// answer is near the top: an exact shape match before an adapter, a shaped
// input before a knob, the categories that usually follow this kind of data
// first, then by name. Pure, so it is unit-tested on a small registry.

import { fitsInput } from "./domains";
import {
  applies,
  BOUNDARY_SHAPES,
  DEBUG_KIND,
  PATCH_IN_KIND,
  PATCH_OUT_KIND,
  SUBPATCH_KIND,
  onLeds,
  type PatchNodeType,
  type PatchShape,
} from "../types";

export interface Suggestion {
  type: PatchNodeType;
  /** The port on `type` the wire would land on (an input when dragging from
   * an output, an output when dragging from an input). */
  port: string;
  /** Same shape at both ends (no adapter). */
  exact: boolean;
  /** The port is a knob (a Number param) rather than a shaped input. */
  viaParam: boolean;
  /** Params the new node starts with: a Patch in / Patch out takes the
   * wire's shape. */
  params?: Record<string, number>;
}

export interface DragFrom {
  shape: PatchShape;
  /** "out": the wire starts at an output and wants a consumer; "in": it
   * starts at an input and wants a producer. */
  dir: "out" | "in";
  /** Dragging from an input that reads its source somewhere else
   * (Transform's `in`): LED data won't do there. */
  sampled?: boolean;
}

type Category = PatchNodeType["category"];

const ALL: Category[] = ["input", "scalar", "generator", "field", "combine", "texture", "sink"];

/** Who usually consumes this kind of data, most likely first. */
const CONSUMERS: Partial<Record<PatchShape, Category[]>> = {
  scalar: ["scalar", "generator", "field", "combine", "texture", "sink", "input"],
  event: ["scalar", "input", "generator", "field", "combine", "texture", "sink"],
  field_scalar: ["field", "combine", "sink", "generator", "texture", "scalar", "input"],
  field_color: ["combine", "field", "sink", "texture", "generator", "scalar", "input"],
  led_scalar: ["field", "combine", "sink", "generator", "texture", "scalar", "input"],
  led_color: ["field", "combine", "sink", "texture", "generator", "scalar", "input"],
  points: ["field", "combine", "sink", "generator", "texture", "scalar", "input"],
  effects: ["field", "combine", "sink", "generator", "texture", "scalar", "input"],
  texture: ["texture", "field", "combine", "sink", "generator", "scalar", "input"],
};

/** Who usually produces this kind of data, most likely first. */
const PRODUCERS: Partial<Record<PatchShape, Category[]>> = {
  scalar: ["input", "scalar", "generator", "field", "combine", "texture", "sink"],
  event: ["input", "scalar", "generator", "field", "combine", "texture", "sink"],
  field_scalar: ["generator", "field", "combine", "input", "texture", "scalar", "sink"],
  field_color: ["generator", "field", "combine", "texture", "input", "scalar", "sink"],
  led_scalar: ["generator", "field", "combine", "input", "texture", "scalar", "sink"],
  led_color: ["generator", "field", "combine", "texture", "input", "scalar", "sink"],
  points: ["input", "generator", "field", "combine", "texture", "scalar", "sink"],
  effects: ["input", "scalar", "generator", "field", "combine", "texture", "sink"],
  texture: ["input", "texture", "generator", "field", "combine", "scalar", "sink"],
};

/** The same value type, whichever domain (an LED colour wire is an exact
 * fit for a colour-field input). */
function sameValue(a: PatchShape, b: PatchShape): boolean {
  return onLeds(a) === onLeds(b);
}

function rank(order: Category[] | undefined, c: Category): number {
  const i = (order ?? ALL).indexOf(c);
  return i < 0 ? ALL.length : i;
}

/** Every connectable input of a type: shaped inputs, then knobs (as scalars). */
function inputsOf(t: PatchNodeType): { name: string; shape: PatchShape; viaParam: boolean }[] {
  // As a node just added has them: at its default mode.
  return [
    ...t.inputs.filter((p) => applies(p, t)).map((p) => ({ name: p.name, shape: p.shape, viaParam: false })),
    ...t.params
      .filter((p) => p.kind === "number" && applies(p, t))
      .map((p) => ({ name: p.name, shape: "scalar" as PatchShape, viaParam: true })),
  ];
}

/** Node types that could take the other end of a wire from `from`, best
 * first, each with the port it would use. Sub-patches are left out: their
 * ports depend on the patch inside. */
export function suggestConnections(registry: Iterable<PatchNodeType>, from: DragFrom): Suggestion[] {
  const out: (Suggestion & { score: number })[] = [];
  const order = from.dir === "out" ? CONSUMERS[from.shape] : PRODUCERS[from.shape];
  for (const t of registry) {
    if (t.id === SUBPATCH_KIND) continue;
    // A Patch out takes a wire from an output, a Patch in hands one to an
    // input, each shaped to the wire (any shape it can carry). Last in the
    // list: they fit every wire, so they would otherwise crowd out the
    // nodes that do something with it.
    if (t.id === PATCH_OUT_KIND || t.id === PATCH_IN_KIND) {
      const shape = BOUNDARY_SHAPES.indexOf(from.shape);
      if (shape < 0 || from.dir !== (t.id === PATCH_OUT_KIND ? "out" : "in")) continue;
      const port = from.dir === "out" ? "in" : "out";
      out.push({ type: t, port, exact: true, viaParam: false, params: { shape }, score: 1000 });
      continue;
    }
    // A Debug node takes any wire from an output, as it is: offered for
    // every one, just ahead of Patch out for the same reason.
    if (t.id === DEBUG_KIND) {
      if (from.dir === "out") out.push({ type: t, port: "in", exact: true, viaParam: false, score: 999 });
      continue;
    }
    const candidates =
      from.dir === "out"
        ? inputsOf(t)
            .filter((p) => fitsInput(p.shape, !p.viaParam && (t.sampled?.includes(p.name) ?? false), from.shape))
            .map((p) => ({ port: p.name, exact: sameValue(p.shape, from.shape), viaParam: p.viaParam }))
        : t.outputs
            .filter((p) => applies(p, t) && fitsInput(from.shape, from.sampled ?? false, p.shape))
            .map((p) => ({ port: p.name, exact: sameValue(p.shape, from.shape), viaParam: false }));
    if (candidates.length === 0) continue;
    // The best port of this type: exact before adapter, shaped before knob,
    // then the type's own order (its first port is its main one).
    candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(a.viaParam) - Number(b.viaParam));
    const best = candidates[0];
    const score =
      (best.exact ? 0 : 100) + (best.viaParam ? 50 : 0) + rank(order, t.category) * 2;
    out.push({ type: t, port: best.port, exact: best.exact, viaParam: best.viaParam, score });
  }
  out.sort((a, b) => a.score - b.score || a.type.label.localeCompare(b.type.label));
  return out.map(({ score: _, ...s }) => s);
}

/** What to call a shape in a tooltip or a hint. */
export const SHAPE_LABEL: Record<PatchShape, string> = {
  scalar: "number",
  event: "event",
  field_scalar: "field (grey)",
  field_color: "field (colour)",
  led_scalar: "LEDs (grey)",
  led_color: "LEDs (colour)",
  points: "points",
  effects: "effects",
  texture: "texture",
  pixels: "pixels",
  any: "any",
};
