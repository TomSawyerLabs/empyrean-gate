// The palette's groups: which group each node kind is in comes from the
// registry (crate `registry::Group`); what a group is called, what it is for,
// its order and how the palette lays it out live here, for the editor and for
// the agent guide alike.

import type { PatchGroup, PatchNodeType } from "./types";

export interface GroupDef {
  id: PatchGroup;
  label: string;
  /** What the group is for, in a phrase. */
  blurb: string;
  /** `grid`: kinds shown as thumbnails (their picture says more than their
   * name); `list`: icon and label. */
  layout: "list" | "grid";
}

/** Every group, in palette order. */
export const GROUPS: readonly GroupDef[] = [
  { id: "controls", label: "Controls", blurb: "Time, sliders and the crew's master controls", layout: "list" },
  { id: "live", label: "Live input", blurb: "Music, phone motion, touch, taps, strokes and PRO DJ LINK", layout: "list" },
  { id: "media", label: "Media", blurb: "Video, pictures and clips", layout: "list" },
  { id: "shape", label: "Shape a signal", blurb: "Arithmetic and shaping of one number", layout: "list" },
  { id: "motion", label: "Motion", blurb: "Numbers that move on their own", layout: "list" },
  { id: "random", label: "Randomness", blurb: "Random numbers, held, jittering or wandering", layout: "list" },
  { id: "events", label: "Events", blurb: "Count, latch, delay and merge triggers; turn them into effects", layout: "list" },
  { id: "blocks", label: "Building blocks", blurb: "Plain fields to build a look from", layout: "grid" },
  { id: "patterns", label: "Patterns", blurb: "Finished looks, each a whole pattern on its own", layout: "grid" },
  { id: "color", label: "Color & space", blurb: "Colour, measure, combine and move fields", layout: "list" },
  { id: "draw", label: "Draw streams", blurb: "Paint strokes and effects onto the array", layout: "list" },
  { id: "structure", label: "Structure", blurb: "Output, sub-patches, code and notes", layout: "list" },
];

const BY_ID = new Map(GROUPS.map((g) => [g.id, g]));

/** Where a registry from a gate that sends no `group` puts each category. */
const FALLBACK: Record<PatchNodeType["category"], PatchGroup> = {
  input: "live",
  scalar: "shape",
  generator: "patterns",
  field: "color",
  combine: "color",
  texture: "media",
  sink: "structure",
  code: "structure",
};

/** The group `t` is listed under. */
export function groupOf(t: PatchNodeType): GroupDef {
  return BY_ID.get(t.group ?? FALLBACK[t.category]) ?? BY_ID.get(FALLBACK[t.category])!;
}

/** `types` in palette groups, in palette order, each group in registry
 * order; groups with no kinds are left out. */
export function grouped(types: Iterable<PatchNodeType>): { group: GroupDef; types: PatchNodeType[] }[] {
  const by = new Map<PatchGroup, PatchNodeType[]>();
  for (const t of types) {
    const id = groupOf(t).id;
    by.set(id, [...(by.get(id) ?? []), t]);
  }
  return GROUPS.filter((g) => by.has(g.id)).map((group) => ({ group, types: by.get(group.id)! }));
}
