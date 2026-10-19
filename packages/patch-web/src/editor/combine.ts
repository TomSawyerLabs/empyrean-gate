// Drop-to-combine: a second wire dropped on an input that already has one
// does not bounce off. A combining node goes in between (a Blend for colour
// fields, Field math for grey ones, Merge events, Math for numbers): the wire
// that was there becomes its lower input, the new one its upper, and its
// output takes the input. Pure, so it is unit-tested on a small registry.

import { shapeAccepts, type PatchDoc, type PatchNodeType, type PatchShape } from "../types";

export interface Combiner {
  /** The node type that combines two wires of this shape. */
  kind: string;
  /** Its input for the wire that was already there (Blend's `base`). */
  lower: string;
  /** Its input for the wire being dropped (Blend's `over`). */
  upper: string;
  out: string;
}

/** What combines two wires into an input of each shape. Points, effects and
 * textures have no combiner: a second wire into one is refused as before. */
export const COMBINERS: Partial<Record<PatchShape, Combiner>> = {
  field_color: { kind: "blend", lower: "base", upper: "over", out: "out" },
  field_scalar: { kind: "field_math", lower: "a", upper: "b", out: "out" },
  led_color: { kind: "blend", lower: "base", upper: "over", out: "out" },
  led_scalar: { kind: "field_math", lower: "a", upper: "b", out: "out" },
  event: { kind: "event_merge", lower: "a", upper: "b", out: "out" },
  scalar: { kind: "scalar_math", lower: "a", upper: "b", out: "out" },
};

/** The shape a port of a built-in type takes in (a Number param is a Scalar
 * input) or puts out. */
function portOf(t: PatchNodeType, name: string, dir: "in" | "out"): PatchShape | null {
  if (dir === "out") return t.outputs.find((p) => p.name === name)?.shape ?? null;
  const shaped = t.inputs.find((p) => p.name === name);
  if (shaped) return shaped.shape;
  return t.params.some((p) => p.name === name && p.kind === "number") ? "scalar" : null;
}

/** The combiner for an input of shape `into` that already takes a wire of
 * shape `existing` and is offered one of shape `incoming`, if the registry
 * has it and both wires fit it. */
export function combinerFor(
  registry: ReadonlyMap<string, PatchNodeType>,
  into: PatchShape,
  existing: PatchShape,
  incoming: PatchShape,
): Combiner | null {
  const c = COMBINERS[into];
  const t = c && registry.get(c.kind);
  if (!c || !t) return null;
  const lower = portOf(t, c.lower, "in");
  const upper = portOf(t, c.upper, "in");
  const out = portOf(t, c.out, "out");
  if (!lower || !upper || !out) return null;
  return shapeAccepts(lower, existing) && shapeAccepts(upper, incoming) && shapeAccepts(into, out)
    ? c
    : null;
}

export interface PortRef {
  node: string;
  port: string;
}

/** Put a `c` node (id `id`, at `pos`) between the wire already into `into`
 * and that input, and wire `incoming` to its upper input. The new node starts
 * minimized: it is plumbing until someone opens it. False (and `d`
 * untouched) when nothing is wired into `into`. */
export function insertCombiner(
  d: PatchDoc,
  into: PortRef,
  incoming: PortRef,
  c: Combiner,
  id: string,
  pos: [number, number],
): boolean {
  const i = d.edges.findIndex((e) => e.to.node === into.node && e.to.port === into.port);
  if (i < 0) return false;
  const [old] = d.edges.splice(i, 1);
  d.nodes.push({ id, kind: c.kind, name: "", params: {}, pos, collapsed: true });
  d.edges.push(
    { from: old.from, to: { node: id, port: c.lower } },
    { from: incoming, to: { node: id, port: c.upper } },
    { from: { node: id, port: c.out }, to: into },
  );
  return true;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The first spot for a `size` box near `want` (its top-left) that overlaps
 * none of `taken`: straight there, then stepping below and above in turn,
 * then a column further left. Falls back to `want`. */
export function freeSpot(
  want: [number, number],
  size: { width: number; height: number },
  taken: readonly Rect[],
  gap = 16,
): [number, number] {
  const clear = (x: number, y: number) =>
    taken.every(
      (r) =>
        x + size.width + gap <= r.x ||
        r.x + r.width + gap <= x ||
        y + size.height + gap <= r.y ||
        r.y + r.height + gap <= y,
    );
  const dy = size.height + gap;
  for (let col = 0; col < 4; col++) {
    const x = want[0] - col * (size.width + gap);
    for (let k = 0; k < 9; k++) {
      // 0, +1, −1, +2, −2, … steps.
      const step = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2;
      const y = want[1] + step * dy;
      if (clear(x, y)) return [Math.round(x), Math.round(y)];
    }
  }
  return [Math.round(want[0]), Math.round(want[1])];
}
