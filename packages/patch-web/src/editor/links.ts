// Linked sub-patches and the patch browser's view of a library, for any
// store: the gate's (crate `links` + `patch::store`, mirrored here for the
// mock backend), the playground's IndexedDB one, and the editor itself.
// A Sub-patch node names where it came from in `source`; while `linked` its
// `sub` is a copy that follows that source, refreshed by whoever saves it.

import { SUBPATCH_KIND, type PatchDoc, type PatchSummary, type SubpatchSummary } from "../types";

/** Built-ins (presets) have ids with this prefix; they are immutable. */
export const BUILTIN_PREFIX = "builtin-";

export function isBuiltin(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX);
}

/** What a Sub-patch linked to `source` holds: the source, without its id. */
export function snapshot(source: PatchDoc): PatchDoc {
  return { ...structuredClone(source), id: "" };
}

/** Whether `doc` links the patch `id` anywhere, sub-patches' insides
 * included. */
export function linksTo(doc: PatchDoc, id: string): boolean {
  return doc.nodes.some(
    (n) =>
      n.kind === SUBPATCH_KIND &&
      ((n.linked === true && n.source === id) || (n.sub !== undefined && linksTo(n.sub, id))),
  );
}

/** Refresh, in place, every Sub-patch in `doc` linked to `source` (at any
 * depth). True when anything changed. A source that links `doc` itself is
 * refused, as the crate's `sync_links` does. */
export function syncLinks(doc: PatchDoc, source: PatchDoc): boolean {
  if (!source.id || (doc.id && (source.id === doc.id || linksTo(source, doc.id)))) return false;
  const fresh = snapshot(source);
  const freshJson = canonical(fresh);
  const into = (d: PatchDoc): boolean => {
    let changed = false;
    for (const n of d.nodes) {
      if (n.kind !== SUBPATCH_KIND) continue;
      if (n.linked && n.source === source.id) {
        if (!n.sub || canonical(n.sub) !== freshJson) {
          n.sub = structuredClone(fresh);
          changed = true;
        }
      } else if (n.sub) {
        changed = into(n.sub) || changed;
      }
    }
    return changed;
  };
  return into(doc);
}

/** A digest of what a patch does (its nodes, wires and exposed knobs, not
 * its name), stored on a clone as `source_rev` so the editor can tell when
 * the source has moved on. */
export function sourceRev(doc: PatchDoc): string {
  return hash(canonical({ nodes: doc.nodes, edges: doc.edges, exposed: doc.exposed }));
}

/** The browser's summary of a patch: as the gate's `patch::store::list`. */
export function summarize(doc: PatchDoc): PatchSummary {
  const kinds = new Set<string>();
  const collect = (d: PatchDoc) => {
    for (const n of d.nodes) {
      kinds.add(n.kind);
      if (n.sub) collect(n.sub);
    }
  };
  collect(doc);
  const subs = subpatchesOf(doc);
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    nodes: doc.nodes.length,
    kinds: [...kinds].sort(),
    ...(subs.length ? { subpatches: subs } : {}),
  };
}

function subpatchesOf(doc: PatchDoc): SubpatchSummary[] {
  return doc.nodes
    .filter((n) => n.kind === SUBPATCH_KIND)
    .map((n) => {
      const inner = n.sub ? subpatchesOf(n.sub) : [];
      return {
        node: n.id,
        name: n.name || n.sub?.name || "Sub-patch",
        ...(n.source ? { source: n.source } : {}),
        ...(n.linked ? { linked: true } : {}),
        ...(inner.length ? { subpatches: inner } : {}),
      };
    });
}

/** JSON with object keys sorted, so equal documents compare equal whatever
 * order their fields were written in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** cyrb53: a fast 53-bit string hash, as 14 hex digits. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
