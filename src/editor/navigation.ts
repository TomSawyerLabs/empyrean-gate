// Where the editor is: a patch (a saved one or a built-in) and, inside it,
// the path of Sub-patch nodes down to the document on the canvas. Hosts map
// this to their URL (the playground) and back; the editor keeps the patch
// whole (that is what it saves and what renders) and shows the document at
// the path, writing edits there back into it.

import { SUBPATCH_KIND, type PatchDoc, type PatchNode } from "../types";
import { isBuiltin, sourceRev } from "./links";

export interface EditorLocation {
  /** A saved patch's id or a built-in's (`builtin-…`); "" for a new patch
   * not saved yet. */
  patch: string;
  /** Sub-patch node ids, outermost first; empty for the patch itself. */
  path: string[];
}

export function sameLocation(a: EditorLocation | null, b: EditorLocation | null): boolean {
  return (
    a === b ||
    (a !== null && b !== null && a.patch === b.patch && a.path.length === b.path.length && a.path.every((p, i) => p === b.path[i]))
  );
}

/** The Sub-patch nodes along `path`, outermost first; stops where the path
 * stops making sense (a node gone, or not a Sub-patch with a document). */
export function nodesAlong(root: PatchDoc, path: string[]): PatchNode[] {
  const out: PatchNode[] = [];
  let d = root;
  for (const id of path) {
    const n = d.nodes.find((x) => x.id === id);
    if (!n || n.kind !== SUBPATCH_KIND || !n.sub) break;
    out.push(n);
    d = n.sub;
  }
  return out;
}

/** The longest prefix of `path` that leads somewhere in `root`. */
export function validPath(root: PatchDoc, path: string[]): string[] {
  return nodesAlong(root, path).map((n) => n.id);
}

/** The document shown at `path` (the root itself for an empty path). Not a
 * copy: mutate it only on a copy of the root. */
export function docAt(root: PatchDoc, path: string[]): PatchDoc {
  const along = nodesAlong(root, path);
  return along.length ? along[along.length - 1]!.sub! : root;
}

/** Why the document at `path` can't be edited here, if it can't: the patch
 * is a built-in, or the path goes through a linked Sub-patch (the outermost
 * such node is the one to clone). */
export type Lock =
  | { kind: "builtin"; name: string }
  | { kind: "linked"; node: string; source: string; name: string };

export function lockAt(root: PatchDoc, path: string[]): Lock | null {
  if (isBuiltin(root.id)) return { kind: "builtin", name: root.name };
  const linked = nodesAlong(root, path).find((n) => n.linked);
  return linked ? { kind: "linked", node: linked.id, source: linked.source ?? "", name: linked.sub?.name || linked.name } : null;
}

/** Make every linked Sub-patch along `path` a clone this patch owns, in
 * place, remembering what each copied so the editor can offer an update. */
export function cloneAlong(root: PatchDoc, path: string[]): void {
  for (const n of nodesAlong(root, path)) unlink(n);
}

/** Turn a linked Sub-patch node into a clone, in place. */
export function unlink(n: PatchNode): void {
  if (!n.linked) return;
  delete n.linked;
  if (n.sub) n.source_rev = sourceRev(n.sub);
}

/** What a node at `path` is called in the flattened patch that renders
 * (crate `flatten`): inner nodes are `"{sub}/{inner}"` at every level, and
 * the node wired into an inner Output takes its Sub-patch's id. Minis key on
 * this. */
export function flatId(root: PatchDoc, path: string[], node: string): string {
  if (path.length === 0) return node;
  const along = nodesAlong(root, path);
  const prefix = along.map((n) => n.id);
  const inner = docAt(root, path);
  const out = inner.nodes.find((n) => n.kind === "output");
  const fed = out && inner.edges.find((e) => e.to.node === out.id && e.to.port === "in")?.from.node;
  return node === fed ? prefix.join("/") : `${prefix.join("/")}/${node}`;
}

/** The cell an Output node's mini shows. At the top it has its own, the
 * frame the gate shows. An inner Output is flattened away, so inside a
 * Sub-patch it shows what the Sub-patch hands on: the cell under the
 * Sub-patch's own id. */
export function outputMini(root: PatchDoc, path: string[], node: string): string {
  if (path.length === 0) return node;
  return nodesAlong(root, path)
    .map((n) => n.id)
    .join("/");
}

/** A label for each step of the breadcrumb: the patch, then each Sub-patch
 * node by its name (or its document's). */
export function crumbs(root: PatchDoc, path: string[]): { label: string; path: string[] }[] {
  const out = [{ label: root.name || "Untitled", path: [] as string[] }];
  nodesAlong(root, path).forEach((n, i) => {
    out.push({ label: n.name || n.sub?.name || "Sub-patch", path: path.slice(0, i + 1) });
  });
  return out;
}
