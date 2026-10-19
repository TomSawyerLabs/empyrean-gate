// Field domains: the plane (fields defined at every position) and the LEDs
// (data defined only at the gate's physical LEDs). Mirrors the patch core's
// `validate::led_nodes` and `sampled_input`, so the editor can draw LED wires
// as such and refuse an LED wire into an input that reads it somewhere else
// while it is being dragged. The core's `validate` stays the authority. Pure,
// so it is unit-tested on a small registry.

import {
  CODE_KIND,
  RESAMPLE_KIND,
  PATCH_OUT_KIND,
  SUBPATCH_KIND,
  boundaryShape,
  codeTier,
  isFieldShape,
  isLedShape,
  shapeAccepts,
  type CodeDef,
  type PatchDoc,
  type PatchNode,
  type PatchNodeType,
  type PatchShape,
} from "../types";

/** What the domain rule needs from the palette. */
export interface Kinds {
  get(kind: string): PatchNodeType | undefined;
}

/** A body with its comments blanked out (WGSL has no strings, so comments
 * are the only text that isn't code). */
function code(body: string): string {
  return body.replace(/\/\*[\s\S]*?(\*\/|$)/g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Whether a GPU Code body reads field input `name` somewhere else
 * (`name_at(…)`): crate `CodeDef::samples`. */
export function codeSamples(def: CodeDef, name: string): boolean {
  if (codeTier(def) !== "gpu") return false;
  return new RegExp(`(?<![A-Za-z0-9_])${name}_at(?![A-Za-z0-9_])`).test(code(def.body));
}

/** Whether a GPU Code body keys on the physical LED (`c.spoke`, `c.i`), so
 * what it makes is LED data: crate `CodeDef::reads_leds`. A member named `c`
 * (`x.c.i`) doesn't count. */
export function codeReadsLeds(def: CodeDef): boolean {
  if (codeTier(def) !== "gpu") return false;
  return /(?<![A-Za-z0-9_])(?<!\.\s*)c\s*\.\s*(spoke|i)(?![A-Za-z0-9_])/.test(code(def.body));
}

/** Whether `node` reads its field input `port` somewhere other than the LED
 * being drawn: crate `validate::sampled_input`. */
export function isSampledInput(def: PatchNodeType | undefined, node: PatchNode | undefined, port: string): boolean {
  if (node?.code) {
    const p = node.code.inputs.find((x) => x.name === port);
    return p !== undefined && isFieldShape(p.shape) && codeSamples(node.code, port);
  }
  return def?.sampled?.includes(port) ?? false;
}

/** Whether a wire carrying `from` may go into an input of shape `into`
 * that is `sampled` (see `isSampledInput`): the value types fit, and LED data
 * doesn't go where it would be read between the LEDs. */
export function fitsInput(into: PatchShape, sampled: boolean, from: PatchShape): boolean {
  return shapeAccepts(into, from) && !(sampled && isLedShape(from));
}

function outputShape(def: PatchNodeType | undefined, node: PatchNode, port: string): PatchShape | undefined {
  if (node.code) return node.code.outputs.find((p) => p.name === port)?.shape;
  const boundary = boundaryShape(node);
  if (boundary) return port === "out" ? boundary : undefined;
  return def?.outputs.find((p) => p.name === port)?.shape;
}

function declaresLed(def: PatchNodeType | undefined, node: PatchNode): boolean {
  const boundary = boundaryShape(node);
  if (boundary) return isLedShape(boundary);
  const outs = node.code ? node.code.outputs : (def?.outputs ?? []);
  return outs.some((p) => isLedShape(p.shape));
}

/** A Sub-patch hands on LED data when what feeds its inner Output does, or
 * any Patch out inside carries it. (The core judges it inlined, port by
 * port; here a node's outputs share one domain, as everywhere.) */
function subpatchLed(node: PatchNode, kinds: Kinds): boolean {
  const inner = node.sub;
  if (!inner) return false;
  const led = ledNodes(inner, kinds);
  const output = inner.nodes.find((n) => n.kind === "output");
  const feed = output && inner.edges.find((e) => e.to.node === output.id && e.to.port === "in");
  return (
    (feed !== undefined && led.has(feed.from.node)) ||
    inner.nodes.some((n) => n.kind === PATCH_OUT_KIND && led.has(n.id))
  );
}

/** The ids of the nodes that hand on LED data: crate `validate::led_nodes`.
 * A node does when it declares an LED output, when it is a GPU Code node
 * that keys on the physical LED, or when a field wire brings it LED data.
 * Resample never does. Solved to a fixed point, so it needs no ordering and
 * ends even on a graph with a cycle (which the core refuses anyway). */
export function ledNodes(doc: PatchDoc, kinds: Kinds): Set<string> {
  const led = new Set<string>();
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  for (const n of doc.nodes) {
    if (n.kind === RESAMPLE_KIND) continue;
    const def = kinds.get(n.kind);
    const own =
      declaresLed(def, n) ||
      (n.kind === CODE_KIND && n.code !== undefined && codeReadsLeds(n.code)) ||
      (n.kind === SUBPATCH_KIND && subpatchLed(n, kinds));
    if (own) led.add(n.id);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of doc.edges) {
      if (!led.has(e.from.node) || led.has(e.to.node)) continue;
      const from = byId.get(e.from.node);
      const to = byId.get(e.to.node);
      if (!from || !to || to.kind === RESAMPLE_KIND) continue;
      const shape = outputShape(kinds.get(from.kind), from, e.from.port);
      if (shape === undefined || !isFieldShape(shape)) continue;
      led.add(to.id);
      changed = true;
    }
  }
  return led;
}
