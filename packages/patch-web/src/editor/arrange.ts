// Auto-arrange: a layered, left-to-right layout of the graph by its wires
// (dagre: ranks from the edges, barycenter ordering within a rank,
// Brandes–Köpf coordinates), so a tangled patch reads source → Output the
// way Mermaid lays out a flowchart. Deterministic: the same graph in the same
// document order lays out the same way every time, on every machine, which is
// what makes "Arrange" safe to press again and keeps a diff of a patch file
// quiet.

import dagre from "@dagrejs/dagre";
import type { PatchDoc } from "../types";

export interface NodeSize {
  width: number;
  height: number;
}

/** What a node is assumed to measure before React Flow has measured it. */
export const DEFAULT_SIZE: NodeSize = { width: 180, height: 110 };

/** The arranged graph starts this far from the canvas origin. */
export const ARRANGE_MARGIN = 40;

/** Space between nodes in one rank, and between ranks. */
const NODE_GAP = 36;
const RANK_GAP = 90;

/** New top-left positions for every node of `doc`, keyed by node id. Nodes
 * missing from `sizes` are laid out at [`DEFAULT_SIZE`]. */
export function arrangeDoc(
  doc: PatchDoc,
  sizes: ReadonlyMap<string, NodeSize> = new Map(),
): Map<string, [number, number]> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: NODE_GAP, ranksep: RANK_GAP, edgesep: 20, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const sizeOf = (id: string) => sizes.get(id) ?? DEFAULT_SIZE;
  for (const n of doc.nodes) {
    const s = sizeOf(n.id);
    g.setNode(n.id, { width: s.width, height: s.height });
  }
  for (const e of doc.edges) {
    // Several wires between the same pair are one constraint; a wire from a
    // node to itself says nothing about where it goes.
    if (e.from.node !== e.to.node && g.hasNode(e.from.node) && g.hasNode(e.to.node)) {
      g.setEdge(e.from.node, e.to.node);
    }
  }
  dagre.layout(g);

  // dagre hands back centres; the document keeps top-left corners. Shift the
  // whole drawing so its top-left sits at the margin.
  const corners: [string, number, number][] = [];
  let minX = Infinity;
  let minY = Infinity;
  for (const n of doc.nodes) {
    const p = g.node(n.id);
    const s = sizeOf(n.id);
    const x = p.x - s.width / 2;
    const y = p.y - s.height / 2;
    corners.push([n.id, x, y]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  const out = new Map<string, [number, number]>();
  for (const [id, x, y] of corners) {
    out.set(id, [Math.round(x - minX + ARRANGE_MARGIN), Math.round(y - minY + ARRANGE_MARGIN)]);
  }
  return out;
}
