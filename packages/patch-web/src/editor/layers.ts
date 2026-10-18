// A Blend's layers (`PatchNode.layers`; crate `NodeInst::layers`). Adding a
// layer inside the stack, removing one or moving one renumbers the layers
// above it, their wires, knob values and exposed entries following, so the
// numbers stay 1..N with no gaps. And a second wire dropped on an input
// that a Blend feeds (or on the Blend itself) becomes a new layer of that
// Blend rather than another Blend. Pure, so it is unit-tested on a small
// registry.

import {
  layerCount,
  layerName,
  nodeParams,
  shapeAccepts,
  splitLayer,
  type PatchDoc,
  type PatchNodeType,
  type PatchShape,
} from "../types";
import type { PortRef } from "./combine";

/** The repeated input of a layered type: the port each layer's wire goes
 * into (Blend's `over`). */
export function layerInput(def: PatchNodeType): string | null {
  return def.layered?.names.find((n) => def.inputs.some((p) => p.name === n)) ?? null;
}

/** Renumber node `id`'s layers: layer k becomes `to(k)`, or is dropped (its
 * wires, values and exposures with it) when that is null. An exposed knob
 * still wearing its layer's label is relabelled for the new layer. */
function relayer(
  d: PatchDoc,
  def: PatchNodeType,
  id: string,
  to: (k: number) => number | null,
  count: number,
): void {
  const node = d.nodes.find((n) => n.id === id);
  if (!node) return;
  const before = layerCount(def, node);
  // undefined: not a layer name, left alone; null: dropped.
  const rename = (port: string): string | null | undefined => {
    const s = splitLayer(def, port, before);
    if (!s) return undefined;
    const k = to(s.k);
    return k === null ? null : layerName(s.name, k);
  };
  const oldLabels = new Map(nodeParams(def, node).map((p) => [p.name, p.label]));
  d.edges = d.edges.flatMap((e) => {
    const port = e.to.node === id ? rename(e.to.port) : undefined;
    if (port === undefined) return [e];
    return port === null ? [] : [{ ...e, to: { node: id, port } }];
  });
  const params: Record<string, number> = {};
  for (const [name, value] of Object.entries(node.params)) {
    const renamed = rename(name);
    if (renamed !== null) params[renamed ?? name] = value;
  }
  node.params = params;
  if (count > 1) node.layers = count;
  else delete node.layers;
  const newLabels = new Map(nodeParams(def, node).map((p) => [p.name, p.label]));
  d.exposed = d.exposed.flatMap((x) => {
    const param = x.node === id ? rename(x.param) : undefined;
    if (param === undefined) return [x];
    if (param === null) return [];
    const label = x.label === oldLabels.get(x.param) ? (newLabels.get(param) ?? x.label) : x.label;
    return [{ ...x, param, label }];
  });
}

/** A new, empty layer at position `at` (1 = straight over the base,
 * count + 1 = on top) of node `id`; the layers from `at` up move one up.
 * Returns the new layer's input (`over2` …), or null when the node is full
 * or not layered. */
export function addLayer(d: PatchDoc, def: PatchNodeType, id: string, at: number): string | null {
  const node = d.nodes.find((n) => n.id === id);
  const input = layerInput(def);
  if (!node || !def.layered || !input) return null;
  const count = layerCount(def, node);
  if (count >= def.layered.max || at < 1 || at > count + 1) return null;
  relayer(d, def, id, (k) => (k >= at ? k + 1 : k), count + 1);
  return layerName(input, at);
}

/** Remove layer `k` of node `id`, its wire and knob values with it; the
 * layers above move down. The last layer stays (false). */
export function removeLayer(d: PatchDoc, def: PatchNodeType, id: string, k: number): boolean {
  const node = d.nodes.find((n) => n.id === id);
  if (!node) return false;
  const count = layerCount(def, node);
  if (count <= 1 || k < 1 || k > count) return false;
  relayer(d, def, id, (j) => (j === k ? null : j > k ? j - 1 : j), count - 1);
  return true;
}

/** Move layer `from` of node `id` to position `to`, the layers between
 * shifting to make room. */
export function moveLayer(d: PatchDoc, def: PatchNodeType, id: string, from: number, to: number): boolean {
  const node = d.nodes.find((n) => n.id === id);
  if (!node) return false;
  const count = layerCount(def, node);
  if (from === to || from < 1 || to < 1 || from > count || to > count) return false;
  relayer(
    d,
    def,
    id,
    (j) => {
      if (j === from) return to;
      if (from < to && j > from && j <= to) return j - 1;
      if (from > to && j >= to && j < from) return j + 1;
      return j;
    },
    count,
  );
  return true;
}

/** Where a wire of shape `incoming`, dropped on `into` (which already has
 * a wire), goes as a layer instead of into a new Blend:
 * - `into` is a taken input of a layered node itself: a new layer just
 *   above that one (above the base, for the base);
 * - the wire already into `into` comes from a layered node that feeds
 *   nothing else: a new top layer on that node.
 * Null when neither holds, the node is full, or the wire doesn't fit. */
export function layerFor(
  d: PatchDoc,
  registry: ReadonlyMap<string, PatchNodeType>,
  into: PortRef,
  incoming: PatchShape,
): { node: string; at: number } | null {
  const room = (id: string) => {
    const node = d.nodes.find((n) => n.id === id);
    const def = node && registry.get(node.kind);
    const input = def && layerInput(def);
    const shape = input && def.inputs.find((p) => p.name === input)?.shape;
    if (!node || !def?.layered || !shape || !shapeAccepts(shape, incoming)) return null;
    const count = layerCount(def, node);
    return count < def.layered.max ? { def, count } : null;
  };
  const target = room(into.node);
  if (target) {
    const s = splitLayer(target.def, into.port, target.count);
    if (s && s.name === layerInput(target.def)) return { node: into.node, at: s.k + 1 };
    if (!s && target.def.inputs.some((p) => p.name === into.port)) return { node: into.node, at: 1 };
  }
  const existing = d.edges.find((e) => e.to.node === into.node && e.to.port === into.port);
  if (!existing) return null;
  const source = room(existing.from.node);
  const feeds = d.edges.filter((e) => e.from.node === existing.from.node).length;
  return source && feeds === 1 ? { node: existing.from.node, at: source.count + 1 } : null;
}
