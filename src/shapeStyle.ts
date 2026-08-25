// How stamped figures are drawn: the two controls that decide whether a star
// reads as a star or as a bright blob.
//
// One style for every shape rather than one per shape. The complaint this
// answers is "shapes are hard to discern" in general, and an operator tuning
// legibility for the room is tuning it for all of them at once.

export interface ShapeStyle {
  /** Outline thickness as a position between the array's resolution limit at
   *  that radius (0) and a fat outline (1). See `shape_stamp` in gate.wgsl. */
  edge: number;
  /** Interior brightness, 0 (outline only) .. 1 (solid). */
  fill: number;
}

/**
 * Must match `EffectCfg::default()` in `src-tauri/src/layers.rs`.
 *
 * `edge` is a position between the array's own resolution limit at that radius
 * (0) and a fat outline (1) — not an absolute width. The shader computes the
 * limit per pixel from the local spoke pitch, so 0.3 sits comfortably above it
 * everywhere: crisp near the hole, automatically wider near the rim where the
 * spokes fan out. 0.15 leaves the interior as a hint rather than a wash.
 */
export const SHAPE_STYLE_DEFAULTS: ShapeStyle = { edge: 0.3, fill: 0.15 };

const STORAGE_KEY = "empyrean-shape-style-v1";

function clamp01(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function loadShapeStyle(): ShapeStyle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...SHAPE_STYLE_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ShapeStyle>;
    return {
      edge: clamp01(parsed.edge, SHAPE_STYLE_DEFAULTS.edge),
      fill: clamp01(parsed.fill, SHAPE_STYLE_DEFAULTS.fill),
    };
  } catch {
    // A corrupt or unreadable entry is not worth failing a show over.
    return { ...SHAPE_STYLE_DEFAULTS };
  }
}

export function saveShapeStyle(style: ShapeStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
  } catch {
    // Private browsing, quota — the style just won't persist.
  }
}
