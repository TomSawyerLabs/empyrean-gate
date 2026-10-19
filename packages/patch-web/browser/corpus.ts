// Every kind of shader the patch core can generate, as documents: each node
// kind alone and with every input wired, once per Select option (a Select
// can switch the WGSL a node emits), each Convert to Code result, every
// preset, and every body snippet the editor offers. `shaders.spec.ts`
// compiles them all in a real browser.

import type { PatchCore } from "../src/runtime/core";
import { snippetDocs } from "../src/editor/code-snippets";
import { applies, CODE_KIND, type PatchDoc, type PatchNode, type PatchNodeType, type PatchShape } from "../src/types";

export interface CorpusEntry {
  label: string;
  doc: PatchDoc;
}

export function shaderCorpus(core: PatchCore): CorpusEntry[] {
  const accepts = new Map(core.shapes.map((s) => [s.id, s.accepts]));
  const output = core.registry.find((t) => t.id === "output")!;
  const into = output.inputs[0];

  // A stock source for each shape: the first kind with no inputs that has an
  // output of it.
  const sources = new Map<PatchShape, [kind: string, port: string]>();
  for (const t of core.registry) {
    if (t.inputs.length || t.id === "output" || t.id === CODE_KIND) continue;
    for (const o of t.outputs) if (!sources.has(o.shape)) sources.set(o.shape, [t.id, o.name]);
  }
  const sourceFor = (shape: PatchShape) =>
    sources.get(shape) ?? (accepts.get(shape) ?? []).map((s) => sources.get(s)).find(Boolean);

  const doc = (name: string, nodes: PatchNode[], edges: PatchDoc["edges"]): PatchDoc => ({
    format: core.limits.patchFormat,
    id: name,
    name,
    description: "",
    nodes,
    edges,
    exposed: [],
  });
  const node = (id: string, kind: string, params: Record<string, number> = {}): PatchNode => ({
    id,
    kind,
    name: id,
    params,
    pos: [0, 0],
  });

  /** `t` (as node `n`) wired to the Output, and, when `fed`, every input of
   * it wired from a stock source; a layered kind gets `layers` layers, each
   * fed too. */
  const build = (
    t: PatchNodeType,
    params: Record<string, number>,
    fed: boolean,
    layers = t.layered?.max ?? 1,
  ): PatchDoc => {
    const n = node("n", t.id, params);
    const nodes = [n, node("o", "output")];
    const edges: PatchDoc["edges"] = [];
    const out = t.outputs[0];
    if (out && accepts.get(into.shape)?.includes(out.shape)) {
      edges.push({ from: { node: "n", port: out.name }, to: { node: "o", port: into.name } });
    }
    if (fed) {
      // Only the inputs of the node's mode (Random's `when`).
      const inputs = t.inputs.filter((p) => applies(p, t, n)).map((p) => ({ name: p.name, shape: p.shape }));
      if (t.layered) {
        n.layers = layers;
        for (let k = 2; k <= layers; k++) {
          for (const p of t.inputs) {
            if (t.layered.names.includes(p.name)) inputs.push({ name: `${p.name}${k}`, shape: p.shape });
          }
        }
      }
      inputs.forEach((p, k) => {
        const src = sourceFor(p.shape);
        if (!src) return;
        nodes.push(node(`s${k}`, src[0]));
        edges.push({ from: { node: `s${k}`, port: src[1] }, to: { node: "n", port: p.name } });
      });
    }
    return doc(t.id, nodes, edges);
  };

  const entries: CorpusEntry[] = [];
  for (const t of core.registry) {
    // A Code node is nothing without a body; Convert to Code supplies them.
    if (t.id === "output" || t.id === CODE_KIND) continue;
    const variants: Record<string, number>[] = [{}];
    for (const p of t.params) {
      if (typeof p.kind !== "object") continue;
      p.kind.select.forEach((_, i) => {
        if (i !== p.default) variants.push({ [p.name]: i });
      });
    }
    for (const params of variants) {
      const what = Object.keys(params).length ? ` ${JSON.stringify(params)}` : "";
      entries.push({ label: `${t.id}${what}`, doc: build(t, params, false) });
      if (t.inputs.length) entries.push({ label: `${t.id}${what}, inputs wired`, doc: build(t, params, true) });
    }
    if (t.convertible) {
      for (const fed of t.inputs.length ? [false, true] : [false]) {
        const label = `${t.id} as Code${fed ? ", inputs wired" : ""}`;
        // Two layers: every layer at once is more ports than a Code node has.
        try {
          entries.push({ label, doc: core.convertToCode(build(t, {}, fed, 2), "n") });
        } catch (e) {
          throw new Error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
  for (const p of core.presets) entries.push({ label: `preset "${p.name}"`, doc: p });
  entries.push(...snippetDocs(core.limits.patchFormat, into.name));
  return entries;
}
