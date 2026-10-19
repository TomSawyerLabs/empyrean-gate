// Finding a node kind by typing: every word of the query must turn up in the
// kind's label, id, group or description, and kinds whose label starts with
// the words rank first. Shared by the palette and the wire-drop chooser.

import { groupOf } from "../groups";
import type { PatchNodeType } from "../types";

/** How well `t` matches `query` (lower is better); null when a word of the
 * query is nowhere in it. An empty query matches everything equally. */
export function matchScore(t: PatchNodeType, query: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const label = t.label.toLowerCase();
  const labelWords = label.split(/[^a-z0-9]+/);
  const id = t.id.toLowerCase();
  const group = groupOf(t).label.toLowerCase();
  const description = (t.description ?? "").toLowerCase();
  let score = 0;
  for (const w of words) {
    if (label.startsWith(w)) score += 0;
    else if (labelWords.some((lw) => lw.startsWith(w))) score += 1;
    else if (label.includes(w) || id.includes(w)) score += 2;
    else if (group.includes(w)) score += 4;
    else if (description.includes(w)) score += 6;
    else return null;
  }
  return score;
}

/** The kinds matching `query`, best first (ties in the given order). */
export function searchTypes(types: readonly PatchNodeType[], query: string): PatchNodeType[] {
  return types
    .map((t, i) => ({ t, i, s: matchScore(t, query) }))
    .filter((m): m is { t: PatchNodeType; i: number; s: number } => m.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((m) => m.t);
}
