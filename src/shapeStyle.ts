// How stamped figures are drawn: the two controls that decide whether a star
// reads as a star or as a bright blob.
//
// One style for every shape rather than one per shape. The complaint this
// answers is "shapes are hard to discern" in general, and an operator tuning
// legibility for the room is tuning it for all of them at once.

export interface ShapeStyle {
  /** Outline thickness, 0 (hairline) .. 1 (fat). */
  edge: number;
  /** Interior brightness, 0 (outline only) .. 1 (solid). */
  fill: number;
}

/**
 * Must match `EffectCfg::default()` in `src-tauri/src/layers.rs`.
 *
 * 0.3 puts the outline at ~0.077 of the array radius, just inside the 0.078 gap
 * between spokes at the rim — the thinnest line 64 spokes can draw without it
 * breaking into dashes. 0.15 leaves the interior as a hint rather than a wash.
 * `edge: 0.5, fill: 0.35` is what figures looked like before this was a control.
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

/** Roughly what the outline measures as a fraction of the array radius, for a
 *  full-size figure. Shown in the editor so "too thin to draw" is visible
 *  rather than something you discover on the rig. */
export const SPOKE_PITCH = 0.078;

export function edgeWidth(edge: number): number {
  // Mirrors `shape_stamp`: base is the clamped pre-control width at full size.
  const base = 0.11;
  return Math.min(0.2, Math.max(0.01, base * (0.25 + 1.5 * Math.min(1, Math.max(0, edge)))));
}
