/* @ts-self-types="./patch.d.ts" */

/**
 * One running patch.
 */
export class PatchSim {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PatchSimFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_patchsim_free(ptr, 0);
    }
    /**
     * Binding 1 bytes (every source).
     * @returns {Uint8Array}
     */
    audio() {
        const ret = wasm.patchsim_audio(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Where each GPU Code node's body sits in `wgsl()` (and `previewWgsl()`):
     * `[{"node": id, "first": line, "count": lines}, ...]`, 1-based.
     * @returns {string}
     */
    codeLines() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.patchsim_codeLines(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Binding 5 bytes: the live dabs only.
     * @returns {Uint8Array}
     */
    dabs() {
        const ret = wasm.patchsim_dabs(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Draw a stroke: `pen` by name (`"glow"`, `"comet"`, ...) and `points`
     * as flat `[angle, radius, dir, ...]` triples in physical space.
     * @param {string} pen
     * @param {Float32Array} points
     * @param {number} hue
     * @param {number} saturation
     * @param {number} brightness
     * @param {number} size
     * @param {number} intensity
     */
    draw(pen, points, hue, saturation, brightness, size, intensity) {
        const ptr0 = passStringToWasm0(pen, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(points, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.patchsim_draw(this.__wbg_ptr, ptr0, len0, ptr1, len1, hue, saturation, brightness, size, intensity);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Binding 3 bytes: the live effects only.
     * @returns {Uint8Array}
     */
    effects() {
        const ret = wasm.patchsim_effects(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Feed mono microphone samples into audio source `source`; the gate's own
     * feature extraction and beat tracking run on them.
     * @param {number} source
     * @param {number} sample_rate
     * @param {Float32Array} samples
     */
    feedAudio(source, sample_rate, samples) {
        const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.patchsim_feedAudio(this.__wbg_ptr, source, sample_rate, ptr0, len0);
    }
    /**
     * Fire PRO DJ LINK event output `index` (play, cue, cue_release,
     * on_air_event, off_air_event, loop_start, loop_wrap, loop_end, jump,
     * phrase_change, fill_in).
     * @param {number} index
     */
    fireDjEvent(index) {
        wasm.patchsim_fireDjEvent(this.__wbg_ptr, index);
    }
    /**
     * Binding 0 bytes.
     * @returns {Uint8Array}
     */
    globals() {
        const ret = wasm.patchsim_globals(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The running patch's Still images as JSON
     * `[{"node": id, "slot": cell, "media": dataUrl | null}]`: upload each
     * node's picture (IMAGE_SIZE², RGBA) to its cell of the media buffer and
     * call `setImageLoaded`.
     * @returns {string}
     */
    images() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.patchsim_images(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Compile `doc` (patch JSON) for an array of `spokes` × `pixels` LEDs.
     * Throws with the validation/codegen message if it cannot run.
     * @param {string} doc
     * @param {number} spokes
     * @param {number} pixels
     * @param {number} inner_over_outer
     */
    constructor(doc, spokes, pixels, inner_over_outer) {
        const ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.patchsim_new(ptr0, len0, spokes, pixels, inner_over_outer);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        PatchSimFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Binding 0 bytes for the mini-preview pass (`previewWgsl()`): spokes of
     * `limits().miniPixels` samples.
     * @returns {Uint8Array}
     */
    previewGlobals() {
        const ret = wasm.patchsim_previewGlobals(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The key of each preview cell, in cell order: a node id, or
     * `"<id>:<port>"` for a Code node's extra field outputs (the mini is
     * `node:<key>`).
     * @returns {string[]}
     */
    previewNodes() {
        const ret = wasm.patchsim_previewNodes(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * `[[nodeId, port], ...]` for each value in `scalarValues()`.
     * @returns {string}
     */
    previewScalars() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.patchsim_previewScalars(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The thumbnail shader: `previewNodes().length` cells of
     * `spokes × pixels`, same bindings. Empty when nothing is previewable.
     * @returns {string}
     */
    previewWgsl() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.patchsim_previewWgsl(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `msg` with every `wgsl:L:C` location inside a Code node's body
     * rewritten as `Code node "<name>" line N:C` (see the crate's
     * `Program::relocate_error`).
     * @param {string} msg
     * @returns {string}
     */
    relocateError(msg) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(msg, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.patchsim_relocateError(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Current values for `previewScalars()`.
     * @returns {Float32Array}
     */
    scalarValues() {
        const ret = wasm.patchsim_scalarValues(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Binding 6: waveform + spectrum for every source.
     * @returns {Float32Array}
     */
    scope() {
        const ret = wasm.patchsim_scope(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Audio features for one source, in `AudioUniform` field order:
     * level, bass, mid, treble, onset, beat_phase, bpm, bpm_conf, bass_att,
     * mid_att, treble_att.
     * @param {number} source
     * @param {Float32Array} f
     */
    setAudio(source, f) {
        const ptr0 = passArrayF32ToWasm0(f, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.patchsim_setAudio(this.__wbg_ptr, source, ptr0, len0);
    }
    /**
     * PRO DJ LINK scalars in `DjLinkInputs` field order: active, energy,
     * deck, deck_side, event_deck, event_side, playing, on_air,
     * deck_1_on_air, deck_2_on_air, looping, mix, mix_activity, beat_in_bar,
     * phrase_active, phrase_kind, phrase_progress, phrase_fill.
     * @param {Float32Array} f
     */
    setDjLink(f) {
        const ptr0 = passArrayF32ToWasm0(f, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.patchsim_setDjLink(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Master hue pull (target in turns, amount 0..1, looseness 0..1).
     * @param {number} target
     * @param {number} amount
     * @param {number} loose
     */
    setHuePull(target, amount, loose) {
        wasm.patchsim_setHuePull(this.__wbg_ptr, target, amount, loose);
    }
    /**
     * Mark media cell `slot` as holding (or not) its Still image.
     * @param {number} slot
     * @param {boolean} loaded
     */
    setImageLoaded(slot, loaded) {
        wasm.patchsim_setImageLoaded(this.__wbg_ptr, slot, loaded);
    }
    /**
     * Master brightness 0..1 and speed multiplier.
     * @param {number} brightness
     * @param {number} speed
     */
    setMaster(brightness, speed) {
        wasm.patchsim_setMaster(this.__wbg_ptr, brightness, speed);
    }
    /**
     * Phone motion: yaw/pitch/roll in radians, shake 0..1.
     * @param {number} yaw
     * @param {number} pitch
     * @param {number} roll
     * @param {number} shake
     */
    setMotion(yaw, pitch, roll, shake) {
        wasm.patchsim_setMotion(this.__wbg_ptr, yaw, pitch, roll, shake);
    }
    /**
     * Live knob change; no recompile.
     * @param {string} node
     * @param {string} param
     * @param {number} value
     */
    setParam(node, param, value) {
        const ptr0 = passStringToWasm0(node, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.patchsim_setParam(this.__wbg_ptr, ptr0, len0, ptr1, len1, value);
    }
    /**
     * Size of the RGBA8 frame the host keeps in the VIDEO buffer; 0 × 0
     * for none.
     * @param {number} width
     * @param {number} height
     */
    setVideo(width, height) {
        wasm.patchsim_setVideo(this.__wbg_ptr, width, height);
    }
    /**
     * Floats in the parameter slab (binding 8).
     * @returns {number}
     */
    slabLen() {
        const ret = wasm.patchsim_slabLen(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Binding 8.
     * @returns {Float32Array}
     */
    slab() {
        const ret = wasm.patchsim_slab(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Advance one frame.
     * @param {number} dt
     */
    step(dt) {
        wasm.patchsim_step(this.__wbg_ptr, dt);
    }
    /**
     * Silence a sample-fed audio source.
     * @param {number} source
     */
    stopAudio(source) {
        wasm.patchsim_stopAudio(this.__wbg_ptr, source);
    }
    /**
     * One raw pointer event: `phase` is `"down"`, `"move"` or `"up"`;
     * `angle`/`radius` in the physical frame (as `screenToPolar` gives them);
     * the toucher's color (hue < 0 = white). `source` tells devices apart
     * (0 for a single surface).
     * @param {number} source
     * @param {number} id
     * @param {string} phase
     * @param {number} angle
     * @param {number} radius
     * @param {number} hue
     * @param {number} saturation
     * @param {number} brightness
     */
    touch(source, id, phase, angle, radius, hue, saturation, brightness) {
        const ptr0 = passStringToWasm0(phase, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.patchsim_touch(this.__wbg_ptr, source, id, ptr0, len0, angle, radius, hue, saturation, brightness);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Binding 10 bytes: the live touch records only (the binding itself is a
     * fixed `limits().maxTouches`-long uniform array).
     * @returns {Uint8Array}
     */
    touches() {
        const ret = wasm.patchsim_touches(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Fire an effect from its JSON (`EffectCfg`: `{"kind":"burst",...}`,
     * missing fields take defaults), like a tap on the gate's preview.
     * @param {string} cfg
     */
    triggerEffect(cfg) {
        const ptr0 = passStringToWasm0(cfg, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.patchsim_triggerEffect(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Apply an edited document. Returns `"params"` (knobs only, applied in
     * place), `"program"` (graph changed, same shader) or `"shader"` (rebuild
     * the GPU pipelines from `wgsl()` / `previewWgsl()`). Throws, leaving the
     * running patch untouched, if the new document cannot run.
     * @param {string} doc
     * @returns {string}
     */
    update(doc) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.patchsim_update(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Whether the running patch reads raw touch, and so owns the touch
     * surface: send it `touch` events instead of applying a tap/pen tool.
     * @returns {boolean}
     */
    usesTouch() {
        const ret = wasm.patchsim_usesTouch(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Whether the running patch reads the live video: upload frames only then.
     * @returns {boolean}
     */
    usesVideo() {
        const ret = wasm.patchsim_usesVideo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The main compute shader: one invocation per LED, writes packed RGB to
     * binding 4.
     * @returns {string}
     */
    wgsl() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.patchsim_wgsl(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) PatchSim.prototype[Symbol.dispose] = PatchSim.prototype.free;

/**
 * What a Code node body may use (`reference::Reference` as JSON): the
 * shader lib's helpers with docs, its structs and globals, and the CPU
 * tier's builtins. Feeds the editor's completion and hover docs.
 * @returns {string}
 */
export function codeReference() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.codeReference();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * "Convert to Code": node `id` of the patch becomes a Code node with the
 * same wires and knob values and a body that reproduces it (see the
 * crate's `convert`). Returns the new document; throws when the node
 * cannot be converted.
 * @param {string} doc
 * @param {string} id
 * @returns {string}
 */
export function convertToCode(doc, id) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.convertToCode(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Effect kinds in GPU-id order, by their serde (wire) names.
 * @returns {string}
 */
export function effect_kinds() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.effect_kinds();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Sizes the host needs to allocate its GPU buffers and build its UI.
 * @returns {string}
 */
export function limits() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.limits();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Upgrade a patch document to the current format (see
 * `empyrean_patch::migrate`); returns the upgraded JSON. Hosts run it where
 * a document comes in (storage, files) so the editor shows what renders.
 * @param {string} doc
 * @returns {string}
 */
export function migrate(doc) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.migrate(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * The built-in starter patches (`GET /patch/presets`), as a JSON array.
 * @returns {string}
 */
export function presets() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.presets();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * The node palette (`GET /patch/registry` on the gate), as JSON. Every
 * node, port and param carries a `description`.
 * @returns {string}
 */
export function registry() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.registry();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * The JSON Schema (draft 2020-12) of a patch document, as a JSON string:
 * the structure `validate` and `PatchSim` accept, with a `description` on
 * every field. Which node kinds, ports and params exist is `registry()`'s.
 * @returns {string}
 */
export function schema() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.schema();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * The wire shapes as JSON `[{"id", "label", "description", "accepts"}]`:
 * what flows on each kind of wire and which shapes may drive an input of
 * it (`accepts`, shape ids as in patch JSON and `registry()`).
 * @returns {string}
 */
export function shapes() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.shapes();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Check a patch exactly as the gate does before it will run it. Returns
 * `{"ok":true}` or `{"ok":false,"errors":["..."]}`.
 * @param {string} doc
 * @returns {string}
 */
export function validate(doc) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.validate(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./patch_bg.js": import0,
    };
}

const PatchSimFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_patchsim_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('patch_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
