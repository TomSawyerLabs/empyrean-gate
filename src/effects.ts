import type { MotionEffectKind, ShapeKind } from "./types";

/** Motion effects — fired from a pad or a key, they travel across the array. */
export const EFFECTS: { kind: MotionEffectKind; label: string; key: string }[] = [
  { kind: "burst", label: "Burst", key: "1" },
  { kind: "strobe", label: "Strobe", key: "2" },
  { kind: "swoosh", label: "Swoosh", key: "3" },
  { kind: "collapse", label: "Collapse", key: "4" },
  { kind: "bloom", label: "Bloom", key: "5" },
  { kind: "pinwheel", label: "Pinwheel", key: "6" },
  { kind: "twinkle", label: "Twinkle", key: "7" },
  { kind: "wipe", label: "Wipe", key: "8" },
];

/** Figures stamped where they are tapped. Keys are mnemonic, not positional —
 *  the number row was already spoken for and `s`/`h` are what an operator
 *  reaches for in the dark. */
export const SHAPES: { kind: ShapeKind; label: string; key: string }[] = [
  { kind: "star", label: "Star", key: "s" },
  { kind: "heart", label: "Heart", key: "h" },
  { kind: "flower", label: "Flower", key: "f" },
  { kind: "diamond", label: "Diamond", key: "d" },
  { kind: "triangle", label: "Triangle", key: "t" },
  { kind: "moon", label: "Moon", key: "m" },
];

export const EFFECT_PADS = [...EFFECTS, ...SHAPES];

const SHAPE_KINDS = new Set<string>(SHAPES.map((s) => s.kind));

export function isShape(kind: string): kind is ShapeKind {
  return SHAPE_KINDS.has(kind);
}

/** How a stamp's size behaves over its life. Sent as `grow` on the trigger. */
export type GrowMode = "static" | "grow" | "shrink";

export const GROW_MODES: { mode: GrowMode; label: string; grow: number }[] = [
  { mode: "static", label: "Hold", grow: 0 },
  { mode: "grow", label: "Grow", grow: 1 },
  { mode: "shrink", label: "Shrink", grow: -1 },
];

export function growValue(mode: GrowMode): number {
  return GROW_MODES.find((m) => m.mode === mode)?.grow ?? 0;
}

/** A shape fired from a pad or a key has no tap to sit on, so it lands in the
 *  middle of the array at a size that fills it. */
export const CENTERED_SHAPE = { angle: 0, radius: 0, size: 2.4 };
