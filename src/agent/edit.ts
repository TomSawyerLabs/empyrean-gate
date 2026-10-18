// Small edits to a patch, for an agent that should not have to resend the
// whole document to turn one knob: a list of operations applied in order to
// a copy. Each operation checks what it refers to and throws a message that
// says which one failed and why; whether the result can run is the patch
// core's `validate`, as for any document.

import { arrangeDoc } from "../editor/arrange";
import type { CodeDef, PatchDoc, PatchNode, PatchPortRef } from "../types";

/** A port as `{ node, port }` or as the string `"node.port"`. */
export type PortRef = PatchPortRef | string;

export type PatchOp =
  | {
      op: "add_node";
      /** Default: the next free `n<k>`. */
      id?: string;
      kind: string;
      name?: string;
      params?: Record<string, number>;
      /** A Code node's ports and body. */
      code?: CodeDef;
      /** A Sub-patch node's document. */
      sub?: PatchDoc;
      /** A Blend's number of layers (default 1). */
      layers?: number;
      /** Default: placed right of the graph (or use `arrange`). */
      pos?: [number, number];
    }
  | { op: "remove_node"; node: string }
  /** A Blend's number of layers; fewer drops the top ones, wires and all. */
  | { op: "set_layers"; node: string; layers: number }
  | {
      op: "set_params";
      node: string;
      /** Knob values by param name; null returns a knob to its default. */
      params: Record<string, number | null>;
    }
  | { op: "set_code"; node: string; code: Partial<CodeDef> }
  | { op: "rename_node"; node: string; name: string }
  | {
      op: "connect";
      from: PortRef;
      to: PortRef;
    }
  | { op: "disconnect"; to: PortRef; from?: PortRef }
  | { op: "set_info"; name?: string; description?: string }
  | { op: "expose"; node: string; param: string; label?: string }
  | { op: "unexpose"; node: string; param: string };

export const OP_NAMES = [
  "add_node",
  "remove_node",
  "set_layers",
  "set_params",
  "set_code",
  "rename_node",
  "connect",
  "disconnect",
  "set_info",
  "expose",
  "unexpose",
] as const;

function port(ref: PortRef, what: string): PatchPortRef {
  if (typeof ref === "string") {
    const dot = ref.lastIndexOf(".");
    if (dot <= 0 || dot === ref.length - 1) throw new Error(`${what} "${ref}" is not "node.port"`);
    return { node: ref.slice(0, dot), port: ref.slice(dot + 1) };
  }
  if (!ref || typeof ref.node !== "string" || typeof ref.port !== "string") {
    throw new Error(`${what} must be "node.port" or { node, port }`);
  }
  return { node: ref.node, port: ref.port };
}

function node(doc: PatchDoc, id: string): PatchNode {
  const n = doc.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node "${id}" (nodes: ${doc.nodes.map((x) => x.id).join(", ") || "none"})`);
  return n;
}

/** A layer count as the core takes it: a whole number from 1 to 8. */
function layers(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 8) {
    throw new Error("layers must be a whole number from 1 to 8");
  }
  return value;
}

function freeId(doc: PatchDoc): string {
  const taken = new Set(doc.nodes.map((n) => n.id));
  for (let k = doc.nodes.length + 1; ; k++) if (!taken.has(`n${k}`)) return `n${k}`;
}

/** Where a new node goes when no position is given: a column right of
 * everything, one row further down per node added in the same edit. */
function placement(doc: PatchDoc, added: number): [number, number] {
  if (doc.nodes.length === 0) return [40, 40];
  const right = Math.max(...doc.nodes.map((n) => n.pos[0]));
  const top = Math.min(...doc.nodes.map((n) => n.pos[1]));
  return [right + 260, top + added * 140];
}

/** `doc` with `ops` applied (the input is not changed). `arrange` lays the
 * whole graph out afterwards, as the editor's Arrange button does. Throws
 * `op <n> (<name>): <reason>` on the first operation that cannot apply. */
export function applyOps(doc: PatchDoc, ops: PatchOp[], arrange = false): PatchDoc {
  if (!Array.isArray(ops)) throw new Error("ops must be a list of operations");
  const next = structuredClone(doc);
  let added = 0;
  ops.forEach((o, i) => {
    try {
      applyOne(next, o, () => placement(next, added++));
    } catch (e) {
      const name = o && typeof o === "object" && "op" in o ? String(o.op) : "?";
      throw new Error(`op ${i} (${name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return arrange ? arranged(next) : next;
}

/** `doc` laid out left to right by its wires. */
export function arranged(doc: PatchDoc): PatchDoc {
  const at = arrangeDoc(doc);
  return { ...doc, nodes: doc.nodes.map((n) => ({ ...n, pos: at.get(n.id) ?? n.pos })) };
}

function applyOne(doc: PatchDoc, o: PatchOp, place: () => [number, number]) {
  switch (o?.op) {
    case "add_node": {
      if (typeof o.kind !== "string" || !o.kind) throw new Error("needs a kind");
      const id = o.id ?? freeId(doc);
      if (doc.nodes.some((n) => n.id === id)) throw new Error(`a node "${id}" already exists`);
      doc.nodes.push({
        id,
        kind: o.kind,
        name: o.name ?? "",
        params: { ...(o.params ?? {}) },
        pos: o.pos ?? place(),
        ...(o.code ? { code: structuredClone(o.code) } : {}),
        ...(o.sub ? { sub: structuredClone(o.sub) } : {}),
        ...(o.layers !== undefined && layers(o.layers) > 1 ? { layers: layers(o.layers) } : {}),
      });
      return;
    }
    case "set_layers": {
      const n = node(doc, o.node);
      const count = layers(o.layers);
      // A layered type's only names ending in a number are its layer copies
      // (`over3`, `opacity3`), so these are the layers past the new count.
      const dropped = (name: string) => {
        const k = /^[A-Za-z_]+?([0-9]+)$/.exec(name)?.[1];
        return k !== undefined && Number(k) > count;
      };
      doc.edges = doc.edges.filter((e) => !(e.to.node === n.id && dropped(e.to.port)));
      for (const k of Object.keys(n.params)) if (dropped(k)) delete n.params[k];
      doc.exposed = doc.exposed.filter((x) => !(x.node === n.id && dropped(x.param)));
      if (count > 1) n.layers = count;
      else delete n.layers;
      return;
    }
    case "remove_node": {
      node(doc, o.node);
      doc.nodes = doc.nodes.filter((n) => n.id !== o.node);
      doc.edges = doc.edges.filter((e) => e.from.node !== o.node && e.to.node !== o.node);
      doc.exposed = doc.exposed.filter((x) => x.node !== o.node);
      return;
    }
    case "set_params": {
      const n = node(doc, o.node);
      if (!o.params || typeof o.params !== "object") throw new Error("needs params");
      for (const [k, v] of Object.entries(o.params)) {
        if (v === null) delete n.params[k];
        else if (typeof v === "number" && Number.isFinite(v)) n.params[k] = v;
        else throw new Error(`param "${k}" must be a finite number or null`);
      }
      return;
    }
    case "set_code": {
      const n = node(doc, o.node);
      if (!n.code) throw new Error(`"${o.node}" is a ${n.kind} node, not a Code node`);
      n.code = { ...n.code, ...structuredClone(o.code) };
      return;
    }
    case "rename_node": {
      node(doc, o.node).name = String(o.name ?? "");
      return;
    }
    case "connect": {
      const from = port(o.from, "from");
      const to = port(o.to, "to");
      node(doc, from.node);
      node(doc, to.node);
      // An input takes one wire: a new one replaces what was there.
      doc.edges = doc.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port));
      doc.edges.push({ from, to });
      return;
    }
    case "disconnect": {
      const to = port(o.to, "to");
      const from = o.from === undefined ? null : port(o.from, "from");
      const before = doc.edges.length;
      doc.edges = doc.edges.filter(
        (e) =>
          !(
            e.to.node === to.node &&
            e.to.port === to.port &&
            (!from || (e.from.node === from.node && e.from.port === from.port))
          ),
      );
      if (doc.edges.length === before) throw new Error(`nothing is wired into ${to.node}.${to.port}`);
      return;
    }
    case "set_info": {
      if (o.name !== undefined) doc.name = String(o.name);
      if (o.description !== undefined) doc.description = String(o.description);
      return;
    }
    case "expose": {
      node(doc, o.node);
      doc.exposed = doc.exposed.filter((x) => !(x.node === o.node && x.param === o.param));
      doc.exposed.push({ node: o.node, param: o.param, label: o.label ?? o.param });
      return;
    }
    case "unexpose": {
      doc.exposed = doc.exposed.filter((x) => !(x.node === o.node && x.param === o.param));
      return;
    }
    default:
      throw new Error(`unknown op (one of: ${OP_NAMES.join(", ")})`);
  }
}
