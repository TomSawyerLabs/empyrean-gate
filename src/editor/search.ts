// Finding a node kind by typing: every word of the query must turn up in the
// kind's label, id, group or description, and kinds whose label starts with
// the words rank first. A word that names an option of a kind's Select param
// also finds that kind set to it: "walk" offers Random in Walk mode,
// "multiply" Blend and Math set to multiply. Shared by the palette and the
// wire-drop chooser.

import { groupOf } from "../groups";
import type { PatchNodeType } from "../types";

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** How well `t` matches `query` (lower is better); null when a word of the
 * query is nowhere in it. An empty query matches everything equally. */
export function matchScore(t: PatchNodeType, query: string): number | null {
  const label = t.label.toLowerCase();
  const labelWords = label.split(/[^a-z0-9]+/);
  const id = t.id.toLowerCase();
  const group = groupOf(t).label.toLowerCase();
  const description = (t.description ?? "").toLowerCase();
  let score = 0;
  for (const w of words(query)) {
    if (label.startsWith(w)) score += 0;
    else if (labelWords.some((lw) => lw.startsWith(w))) score += 1;
    else if (label.includes(w) || id.includes(w)) score += 2;
    else if (group.includes(w)) score += 4;
    else if (description.includes(w)) score += 6;
    else return null;
  }
  return score;
}

/** A kind found by the search, and for an option match the Select value the
 * new node should start with. */
export interface SearchHit {
  type: PatchNodeType;
  preset?: { param: string; value: number; label: string };
}

/** The Select options of `t` that a word of `query` names (a word of the
 * option's label starts with it, three letters at least), when every word
 * matches the kind or the option. */
function optionHits(t: PatchNodeType, query: string): { hit: SearchHit; score: number }[] {
  const ws = words(query);
  const out: { hit: SearchHit; score: number }[] = [];
  for (const p of t.params) {
    if (typeof p.kind !== "object") continue;
    p.kind.select.forEach((option, value) => {
      const opt = option.toLowerCase();
      const optWords = opt.split(/[^a-z0-9]+/);
      const named = ws.filter((w) => w.length >= 3 && optWords.some((ow) => ow.startsWith(w)));
      if (!named.length) return;
      const rest = ws.filter((w) => !named.includes(w)).join(" ");
      const kindScore = rest ? matchScore(t, rest) : 0;
      if (kindScore === null) return;
      out.push({ hit: { type: t, preset: { param: p.name, value, label: option } }, score: kindScore + 0.5 });
    });
  }
  return out;
}

/** The kinds matching `query`, best first (ties in the given order); with a
 * query, also kinds set to a Select option the query names. */
export function searchKinds(types: readonly PatchNodeType[], query: string): SearchHit[] {
  const found: { hit: SearchHit; score: number; i: number }[] = [];
  types.forEach((t, i) => {
    const s = matchScore(t, query);
    if (s !== null) found.push({ hit: { type: t }, score: s, i });
    if (!words(query).length) return;
    for (const o of optionHits(t, query)) {
      // The default option is the kind itself, already listed when it matched.
      const p = t.params.find((q) => q.name === o.hit.preset!.param)!;
      if (s !== null && o.hit.preset!.value === p.default) continue;
      found.push({ ...o, i });
    }
  });
  return found.sort((a, b) => a.score - b.score || a.i - b.i).map((f) => f.hit);
}

/** The kinds matching `query`, best first (ties in the given order). */
export function searchTypes(types: readonly PatchNodeType[], query: string): PatchNodeType[] {
  return searchKinds(types, query)
    .filter((h) => !h.preset)
    .map((h) => h.type);
}
