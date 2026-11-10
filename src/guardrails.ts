// Guardrail levels (plans/guardrail-modes.md). Mirrors src-tauri/src/guardrails.rs:
// the server enforces the ranges; the UI narrows its sliders to match so a
// Guided device never drags past where its change will land.

import { useGate } from "./state";
import type { GuardrailCfg, GuardrailControl, GuardrailLevel } from "./types";

export const DEFAULT_GUARDRAIL: GuardrailCfg = { level: "standard", rates: {} };

export const LEVELS: { id: GuardrailLevel; label: string; hint: string }[] = [
  {
    id: "guided",
    label: "Guided",
    hint: "Every change fades in, risky sliders have narrower ranges, and scene changes never cut. Blackout still cuts. For beginners.",
  },
  {
    id: "standard",
    label: "Standard",
    hint: "Patterns fade in and out. Blackout, the master faders and layer sliders act at once.",
  },
  {
    id: "expert",
    label: "Expert",
    hint: "Nothing is smoothed. Set your own speed limit on any slider below.",
  },
];

/** Each limitable control, with its slider span: a limit is shown as "seconds
 *  for a full swing" and stored as span ÷ seconds (units per second). */
export const CONTROLS: { id: GuardrailControl; label: string; span: number }[] = [
  { id: "master_brightness", label: "Master brightness (Blackout)", span: 1 },
  { id: "master_speed", label: "Master speed", span: 4 },
  { id: "floor_level", label: "Floor input", span: 1 },
  { id: "master_hue_amount", label: "Master hue", span: 1 },
  { id: "layer_enable", label: "Layer on/off", span: 1 },
  { id: "layer_opacity", label: "Layer opacity", span: 1 },
  { id: "layer_speed", label: "Layer speed", span: 8 },
  { id: "layer_scale", label: "Layer scale", span: 5 },
  { id: "layer_audio_amount", label: "Layer audio", span: 1 },
  { id: "layer_hue", label: "Layer hue", span: 1 },
  { id: "layer_hue_range", label: "Layer hue range", span: 1 },
  { id: "layer_saturation", label: "Layer saturation", span: 1 },
  { id: "layer_brightness", label: "Layer brightness", span: 2 },
  { id: "layer_tilt_amount", label: "Layer tilt", span: 1 },
  { id: "layer_walk_amount", label: "Layer walk", span: 1 },
  { id: "layer_param_a", label: "Layer param A", span: 1 },
  { id: "layer_param_b", label: "Layer param B", span: 1 },
  { id: "layer_param_c", label: "Layer param C", span: 1 },
  { id: "layer_param_d", label: "Layer param D", span: 1 },
];

/** Guided's narrower ranges (keep in step with `GuardrailCfg::range` and
 *  `walk_range` in guardrails.rs). */
const GUIDED_RANGES: Partial<Record<GuardrailControl | "walk_depth" | "walk_speed", [number, number]>> = {
  master_speed: [0.25, 2],
  layer_speed: [-2, 2],
  layer_scale: [0.25, 3],
  layer_brightness: [0, 1.25],
  walk_depth: [0, 1.5],
  walk_speed: [0.25, 2],
};

/** The slider range for `control` on a device at `cfg`'s level. */
export function guardRange(
  cfg: GuardrailCfg,
  control: GuardrailControl | "walk_depth" | "walk_speed",
  min: number,
  max: number,
): [number, number] {
  const narrow = cfg.level === "guided" ? GUIDED_RANGES[control] : undefined;
  return narrow ? [Math.max(min, narrow[0]), Math.min(max, narrow[1])] : [min, max];
}

/** This device's guardrails, from its own row of the roster. */
export function useGuardrail(): GuardrailCfg {
  const { client, status } = useGate();
  const own = status?.client_list?.find((c) => c.id === client.clientId);
  return own?.guardrail ?? DEFAULT_GUARDRAIL;
}

/** Seconds for a full swing at `rate`, or "" for no limit. */
export function rateToSecs(rate: number | undefined, span: number): string {
  if (!rate || rate <= 0) return "";
  return String(Math.round((span / rate) * 100) / 100);
}

export function secsToRate(secs: string, span: number): number | undefined {
  const s = Number(secs);
  return secs.trim() && Number.isFinite(s) && s > 0 ? span / s : undefined;
}
