/* tslint:disable */
/* eslint-disable */

/**
 * One running patch.
 */
export class PatchSim {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Run a `prepare`d document; returns what `update` would have. Consumes
     * `prepared`.
     */
    apply(prepared: PreparedPatch): string;
    /**
     * Binding 1 bytes (every source).
     */
    audio(): Uint8Array;
    /**
     * Where each GPU Code node's body sits in `wgsl()` (and `previewWgsl()`):
     * `[{"node": id, "first": line, "count": lines}, ...]`, 1-based.
     */
    codeLines(): string;
    /**
     * Binding 5 bytes: the live dabs only.
     */
    dabs(): Uint8Array;
    /**
     * Draw a stroke: `pen` by name (`"glow"`, `"comet"`, ...) and `points`
     * as flat `[angle, radius, dir, ...]` triples in physical space.
     */
    draw(pen: string, points: Float32Array, hue: number, saturation: number, brightness: number, size: number, intensity: number): void;
    /**
     * Binding 3 bytes: the live effects only.
     */
    effects(): Uint8Array;
    /**
     * Feed mono microphone samples into audio source `source`; the gate's own
     * feature extraction and beat tracking run on them.
     */
    feedAudio(source: number, sample_rate: number, samples: Float32Array): void;
    /**
     * Fire PRO DJ LINK event output `index` (play, cue, cue_release,
     * on_air_event, off_air_event, loop_start, loop_wrap, loop_end, jump,
     * phrase_change, fill_in).
     */
    fireDjEvent(index: number): void;
    /**
     * Binding 0 bytes.
     */
    globals(): Uint8Array;
    /**
     * The grid passes to dispatch, in order, before `main` each frame, and
     * the bytes of the grid buffer (binding 11) they use:
     * `{"bytes": n, "passes": [{"entry": name, "cells": n}, ...]}`. No
     * passes and 0 bytes for a patch that renders no texture.
     */
    gridPasses(): string;
    /**
     * The running patch's Still images as JSON
     * `[{"node": id, "slot": cell, "media": dataUrl | null}]`: upload each
     * node's picture (IMAGE_SIZE², RGBA) to its cell of the media buffer and
     * call `setImageLoaded`.
     */
    images(): string;
    /**
     * Compile `doc` (patch JSON) for an array of `spokes` × `pixels` LEDs.
     * Throws with the validation/codegen message if it cannot run.
     */
    constructor(doc: string, spokes: number, pixels: number, inner_over_outer: number);
    /**
     * Compile an edited document without running it: a host builds the
     * pipelines for its shader while this patch keeps rendering, then
     * `apply`s it between two frames. Throws, as `update` does, if the
     * document cannot run.
     */
    prepare(doc: string): PreparedPatch;
    /**
     * Binding 0 bytes for the mini-preview pass (`previewWgsl()`): spokes of
     * `limits().miniPixels` samples.
     */
    previewGlobals(): Uint8Array;
    /**
     * The key of each preview cell, in cell order: a node id, or
     * `"<id>:<port>"` for a Code node's extra field outputs (the mini is
     * `node:<key>`).
     */
    previewNodes(): string[];
    /**
     * `[[nodeId, port], ...]` for each value in `scalarValues()`.
     */
    previewScalars(): string;
    /**
     * The thumbnail shader: `previewNodes().length` cells of
     * `spokes × pixels`, same bindings. Empty when nothing is previewable.
     */
    previewWgsl(): string;
    /**
     * `msg` with every `wgsl:L:C` location inside a Code node's body
     * rewritten as `Code node "<name>" line N:C` (see the crate's
     * `Program::relocate_error`).
     */
    relocateError(msg: string): string;
    /**
     * Current values for `previewScalars()`.
     */
    scalarValues(): Float32Array;
    /**
     * Binding 6: waveform + spectrum for every source.
     */
    scope(): Float32Array;
    /**
     * Audio features for one source, in `AudioUniform` field order:
     * level, bass, mid, treble, onset, beat_phase, bpm, bpm_conf, bass_att,
     * mid_att, treble_att.
     */
    setAudio(source: number, f: Float32Array): void;
    /**
     * PRO DJ LINK scalars in `DjLinkInputs` field order: active, energy,
     * deck, deck_side, event_deck, event_side, playing, on_air,
     * deck_1_on_air, deck_2_on_air, looping, mix, mix_activity, beat_in_bar,
     * phrase_active, phrase_kind, phrase_progress, phrase_fill.
     */
    setDjLink(f: Float32Array): void;
    /**
     * Master hue pull (target in turns, amount 0..1, looseness 0..1).
     */
    setHuePull(target: number, amount: number, loose: number): void;
    /**
     * Mark media cell `slot` as holding (or not) its Still image.
     */
    setImageLoaded(slot: number, loaded: boolean): void;
    /**
     * Master brightness 0..1 and speed multiplier.
     */
    setMaster(brightness: number, speed: number): void;
    /**
     * Phone motion: yaw/pitch/roll in radians, shake 0..1.
     */
    setMotion(yaw: number, pitch: number, roll: number, shake: number): void;
    /**
     * Live knob change; no recompile.
     */
    setParam(node: string, param: string, value: number): void;
    /**
     * Size of the RGBA8 frame the host keeps in the VIDEO buffer; 0 × 0
     * for none.
     */
    setVideo(width: number, height: number): void;
    /**
     * Whether `prepared` needs pipelines other than this patch's (its
     * shader differs from the one running now).
     */
    shaderChanged(prepared: PreparedPatch): boolean;
    /**
     * Floats in the parameter slab (binding 8).
     */
    slabLen(): number;
    /**
     * Binding 8.
     */
    slab(): Float32Array;
    /**
     * Advance one frame.
     */
    step(dt: number): void;
    /**
     * Silence a sample-fed audio source.
     */
    stopAudio(source: number): void;
    /**
     * One raw pointer event: `phase` is `"down"`, `"move"` or `"up"`;
     * `angle`/`radius` in the physical frame (as `screenToPolar` gives them);
     * the toucher's color (hue < 0 = white). `source` tells devices apart
     * (0 for a single surface).
     */
    touch(source: number, id: number, phase: string, angle: number, radius: number, hue: number, saturation: number, brightness: number): void;
    /**
     * Binding 10 bytes: the live touch records only (the binding itself is a
     * fixed `limits().maxTouches`-long uniform array).
     */
    touches(): Uint8Array;
    /**
     * Fire an effect from its JSON (`EffectCfg`: `{"kind":"burst",...}`,
     * missing fields take defaults), like a tap on the gate's preview.
     */
    triggerEffect(cfg: string): void;
    /**
     * Apply an edited document. Returns `"params"` (knobs only, applied in
     * place), `"program"` (graph changed, same shader) or `"shader"` (rebuild
     * the GPU pipelines from `wgsl()` / `previewWgsl()`). Throws, leaving the
     * running patch untouched, if the new document cannot run.
     */
    update(doc: string): string;
    /**
     * Whether the running patch reads raw touch, and so owns the touch
     * surface: send it `touch` events instead of applying a tap/pen tool.
     */
    usesTouch(): boolean;
    /**
     * Whether the running patch reads the live video: upload frames only then.
     */
    usesVideo(): boolean;
    /**
     * The main compute shader: one invocation per LED, writes packed RGB to
     * binding 4.
     */
    wgsl(): string;
}

/**
 * A document compiled by `PatchSim.prepare`, not yet running. Its shaders
 * read like a running patch's (see `PatchSim`).
 */
export class PreparedPatch {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    gridPasses(): string;
    previewNodes(): string[];
    previewWgsl(): string;
    relocateError(msg: string): string;
    wgsl(): string;
}

/**
 * What a Code node body may use (`reference::Reference` as JSON): the
 * shader lib's helpers with docs, its structs and globals, and the CPU
 * tier's builtins. Feeds the editor's completion and hover docs.
 */
export function codeReference(): string;

/**
 * "Convert to Code": node `id` of the patch becomes a Code node with the
 * same wires and knob values and a body that reproduces it (see the
 * crate's `convert`). Returns the new document; throws when the node
 * cannot be converted.
 */
export function convertToCode(doc: string, id: string): string;

/**
 * Effect kinds in GPU-id order, by their serde (wire) names.
 */
export function effect_kinds(): string;

/**
 * Sizes the host needs to allocate its GPU buffers and build its UI.
 */
export function limits(): string;

/**
 * Upgrade a patch document to the current format (see
 * `empyrean_patch::migrate`); returns the upgraded JSON. Hosts run it where
 * a document comes in (storage, files) so the editor shows what renders.
 */
export function migrate(doc: string): string;

/**
 * The built-in starter patches (`GET /patch/presets`), as a JSON array.
 */
export function presets(): string;

/**
 * The node palette (`GET /patch/registry` on the gate), as JSON. Every
 * node, port and param carries a `description`.
 */
export function registry(): string;

/**
 * The JSON Schema (draft 2020-12) of a patch document, as a JSON string:
 * the structure `validate` and `PatchSim` accept, with a `description` on
 * every field. Which node kinds, ports and params exist is `registry()`'s.
 */
export function schema(): string;

/**
 * The wire shapes as JSON `[{"id", "label", "description", "accepts"}]`:
 * what flows on each kind of wire and which shapes may drive an input of
 * it (`accepts`, shape ids as in patch JSON and `registry()`).
 */
export function shapes(): string;

/**
 * Check a patch exactly as the gate does before it will run it. Returns
 * `{"ok":true}` or `{"ok":false,"errors":["..."]}`.
 */
export function validate(doc: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_patchsim_free: (a: number, b: number) => void;
    readonly __wbg_preparedpatch_free: (a: number, b: number) => void;
    readonly codeReference: () => [number, number];
    readonly convertToCode: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly effect_kinds: () => [number, number];
    readonly limits: () => [number, number];
    readonly migrate: (a: number, b: number) => [number, number, number, number];
    readonly patchsim_apply: (a: number, b: number) => [number, number];
    readonly patchsim_audio: (a: number) => [number, number];
    readonly patchsim_codeLines: (a: number) => [number, number];
    readonly patchsim_dabs: (a: number) => [number, number];
    readonly patchsim_draw: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly patchsim_effects: (a: number) => [number, number];
    readonly patchsim_feedAudio: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly patchsim_fireDjEvent: (a: number, b: number) => void;
    readonly patchsim_globals: (a: number) => [number, number];
    readonly patchsim_gridPasses: (a: number) => [number, number];
    readonly patchsim_images: (a: number) => [number, number];
    readonly patchsim_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly patchsim_prepare: (a: number, b: number, c: number) => [number, number, number];
    readonly patchsim_previewGlobals: (a: number) => [number, number];
    readonly patchsim_previewNodes: (a: number) => [number, number];
    readonly patchsim_previewScalars: (a: number) => [number, number];
    readonly patchsim_previewWgsl: (a: number) => [number, number];
    readonly patchsim_relocateError: (a: number, b: number, c: number) => [number, number];
    readonly patchsim_scalarValues: (a: number) => [number, number];
    readonly patchsim_scope: (a: number) => [number, number];
    readonly patchsim_setAudio: (a: number, b: number, c: number, d: number) => void;
    readonly patchsim_setDjLink: (a: number, b: number, c: number) => void;
    readonly patchsim_setHuePull: (a: number, b: number, c: number, d: number) => void;
    readonly patchsim_setImageLoaded: (a: number, b: number, c: number) => void;
    readonly patchsim_setMaster: (a: number, b: number, c: number) => void;
    readonly patchsim_setMotion: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly patchsim_setParam: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly patchsim_setVideo: (a: number, b: number, c: number) => void;
    readonly patchsim_shaderChanged: (a: number, b: number) => number;
    readonly patchsim_slab: (a: number) => [number, number];
    readonly patchsim_slabLen: (a: number) => number;
    readonly patchsim_step: (a: number, b: number) => void;
    readonly patchsim_stopAudio: (a: number, b: number) => void;
    readonly patchsim_touch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly patchsim_touches: (a: number) => [number, number];
    readonly patchsim_triggerEffect: (a: number, b: number, c: number) => [number, number];
    readonly patchsim_update: (a: number, b: number, c: number) => [number, number, number, number];
    readonly patchsim_usesTouch: (a: number) => number;
    readonly patchsim_usesVideo: (a: number) => number;
    readonly patchsim_wgsl: (a: number) => [number, number];
    readonly preparedpatch_gridPasses: (a: number) => [number, number];
    readonly preparedpatch_previewNodes: (a: number) => [number, number];
    readonly preparedpatch_previewWgsl: (a: number) => [number, number];
    readonly preparedpatch_relocateError: (a: number, b: number, c: number) => [number, number];
    readonly preparedpatch_wgsl: (a: number) => [number, number];
    readonly presets: () => [number, number];
    readonly registry: () => [number, number];
    readonly schema: () => [number, number];
    readonly shapes: () => [number, number];
    readonly validate: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
