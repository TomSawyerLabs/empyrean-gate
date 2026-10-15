// The patch core (crates/empyrean-patch-wasm), loaded once. Everything that
// knows a document rule or a GPU layout is in there; this file only parses
// its JSON answers into types.

import init, * as wasm from "../../wasm/patch.js";
import type { PatchDoc, PatchNodeType } from "../types";

export type { PatchSim } from "../../wasm/patch.js";

export interface Limits {
  patchFormat: number;
  maxNodes: number;
  maxEdges: number;
  maxEffects: number;
  maxDabs: number;
  audioSources: number;
  scopeWave: number;
  scopeSpectrum: number;
  scopeFloats: number;
  maxSlabFloats: number;
  maxPreviewNodes: number;
  miniPixels: number;
  globalsBytes: number;
  audioBytes: number;
  effectBytes: number;
  dabBytes: number;
  djEvents: number;
}

export interface PatchCore {
  registry: PatchNodeType[];
  presets: PatchDoc[];
  limits: Limits;
  /** Effect kinds by wire name, in GPU-id order. */
  effectKinds: string[];
  /** The gate's own pre-flight check: `[]` when the patch can run. */
  validate(doc: PatchDoc): string[];
  /** Compile a patch for an array of `spokes` × `pixels`; throws the
   * validation/codegen message when it cannot run. */
  createSim(doc: PatchDoc, spokes: number, pixels: number, innerOverOuter: number): wasm.PatchSim;
}

let loading: Promise<PatchCore> | null = null;

/** Load (once) and return the patch core. */
export function loadPatchCore(): Promise<PatchCore> {
  loading ??= init().then(() => ({
    registry: JSON.parse(wasm.registry()) as PatchNodeType[],
    presets: JSON.parse(wasm.presets()) as PatchDoc[],
    limits: JSON.parse(wasm.limits()) as Limits,
    effectKinds: JSON.parse(wasm.effect_kinds()) as string[],
    validate(doc: PatchDoc) {
      const r = JSON.parse(wasm.validate(JSON.stringify(doc))) as {
        ok: boolean;
        errors?: string[];
      };
      return r.ok ? [] : (r.errors ?? ["invalid patch"]);
    },
    createSim(doc, spokes, pixels, innerOverOuter) {
      return new wasm.PatchSim(JSON.stringify(doc), spokes, pixels, innerOverOuter);
    },
  }));
  return loading;
}
