// The patch core (crates/empyrean-patch-wasm), loaded once. Everything that
// knows a document rule or a GPU layout is in there; this file only parses
// its JSON answers into types.

import init, * as wasm from "../../wasm/patch.js";
import type { CodeReference, PatchDoc, PatchNodeType, PatchShapeDef } from "../types";

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
  maxTouches: number;
  touchBytes: number;
  maxImages: number;
  imageSize: number;
  mediaBufferBytes: number;
  maxMediaBytes: number;
}

export interface PatchCore {
  registry: PatchNodeType[];
  /** What a Code node body may use (helpers, structs, globals, CPU builtins). */
  codeReference: CodeReference;
  /** The wire shapes, what flows on each and what each input accepts. */
  shapes: PatchShapeDef[];
  /** JSON Schema (2020-12) of a patch document, from the Rust types. */
  schema: Record<string, unknown>;
  /** "Convert to Code": node `id` of `doc` as a Code node, same wires and
   * knobs, a body that reproduces it. Throws when the kind cannot be. */
  convertToCode(doc: PatchDoc, id: string): PatchDoc;
  presets: PatchDoc[];
  limits: Limits;
  /** Effect kinds by wire name, in GPU-id order. */
  effectKinds: string[];
  /** Upgrade an older patch document to the current format (adds the wiring
   * format 1's Output implied). Run it where documents come in. */
  migrate(doc: PatchDoc): PatchDoc;
  /** The gate's own pre-flight check: `[]` when the patch can run. */
  validate(doc: PatchDoc): string[];
  /** Compile a patch for an array of `spokes` × `pixels`; throws the
   * validation/codegen message when it cannot run. */
  createSim(doc: PatchDoc, spokes: number, pixels: number, innerOverOuter: number): wasm.PatchSim;
}

let loading: Promise<PatchCore> | null = null;

/** Load (once) and return the patch core. In a browser the wasm is fetched
 * next to this module; where `fetch` cannot read files (Node, Bun), pass the
 * bytes of `wasm/patch_bg.wasm`. */
export function loadPatchCore(wasmBytes?: BufferSource): Promise<PatchCore> {
  loading ??= init(wasmBytes ? { module_or_path: wasmBytes } : undefined).then(() => ({
    registry: JSON.parse(wasm.registry()) as PatchNodeType[],
    codeReference: JSON.parse(wasm.codeReference()) as CodeReference,
    shapes: JSON.parse(wasm.shapes()) as PatchShapeDef[],
    schema: JSON.parse(wasm.schema()) as Record<string, unknown>,
    convertToCode(doc, id) {
      return JSON.parse(wasm.convertToCode(JSON.stringify(doc), id)) as PatchDoc;
    },
    presets: JSON.parse(wasm.presets()) as PatchDoc[],
    limits: JSON.parse(wasm.limits()) as Limits,
    effectKinds: JSON.parse(wasm.effect_kinds()) as string[],
    migrate(doc: PatchDoc) {
      return JSON.parse(wasm.migrate(JSON.stringify(doc))) as PatchDoc;
    },
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
