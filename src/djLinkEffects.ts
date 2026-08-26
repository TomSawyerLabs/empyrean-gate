import { EFFECT_PADS } from "./effects";
import type { DjLinkEffectsConfig, DjLinkEventKind, EffectCfg, EffectKind } from "./types";

export const DJ_LINK_EVENTS: { kind: DjLinkEventKind; label: string }[] = [
  { kind: "play", label: "Play" },
  { kind: "cue", label: "Cue / cue play" },
  { kind: "cue_release", label: "Cue release" },
  { kind: "on_air", label: "On air" },
  { kind: "off_air", label: "Off air" },
  { kind: "loop_start", label: "Loop start" },
  { kind: "loop_wrap", label: "Loop wrap" },
  { kind: "loop_end", label: "Loop end" },
  { kind: "jump", label: "Hot Cue / seek" },
  { kind: "phrase_change", label: "Phrase change" },
  { kind: "fill_in", label: "Fill-in" },
];

export const DJ_EFFECT_OPTIONS = EFFECT_PADS.map(({ kind, label }) => ({ kind, label }));

export function djEffect(kind: EffectKind, overrides: Partial<EffectCfg> = {}): EffectCfg {
  return {
    kind, angle: 0, radius: 0.5, intensity: 1.2, size: 1, hue: -1,
    saturation: 0.9, brightness: 1, duration: 0, rotation: 0, grow: 0,
    edge: 0.3, fill: 0.15, ...overrides,
  };
}

export function defaultDjLinkEffects(): DjLinkEffectsConfig {
  return {
    play: [djEffect("burst", { intensity: 1.4, size: 1.25, radius: 0.7, duration: 1.1 })],
    cue: [djEffect("burst", { intensity: 1.15, size: 0.7, radius: 0.82, duration: 0.7 })],
    cue_release: [djEffect("collapse", { intensity: 0.8, size: 0.7, radius: 0.82, duration: 0.65 })],
    on_air: [djEffect("swoosh", { intensity: 1.5, size: 1.8, radius: 0.8, duration: 1.35 })],
    off_air: [djEffect("collapse", { intensity: 1.1, size: 1.2, radius: 0.8, duration: 1.1 })],
    loop_start: [djEffect("ring", { intensity: 1.7, size: 1.1, duration: 1.2 })],
    loop_wrap: [djEffect("ring", { intensity: 1.35, size: 0.85, duration: 0.75 })],
    loop_end: [djEffect("ring", { intensity: 1.15, size: 1.2, duration: 0.9 })],
    jump: [
      djEffect("burst", { intensity: 2, size: 1.5, radius: 0.85, duration: 1.25 }),
      djEffect("strobe", { intensity: 1, duration: 0.22 }),
    ],
    phrase_change: [],
    fill_in: [],
  };
}

export function cloneDjLinkEffects(value?: DjLinkEffectsConfig): DjLinkEffectsConfig {
  return structuredClone(value ?? defaultDjLinkEffects());
}
