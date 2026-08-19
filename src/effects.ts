import type { EffectKind } from "./types";

export const EFFECTS: { kind: EffectKind; label: string; key: string }[] = [
  { kind: "burst", label: "Burst", key: "1" },
  { kind: "strobe", label: "Strobe", key: "2" },
  { kind: "swoosh", label: "Swoosh", key: "3" },
  { kind: "collapse", label: "Collapse", key: "4" },
];
