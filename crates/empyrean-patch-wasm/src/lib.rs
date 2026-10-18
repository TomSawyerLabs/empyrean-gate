//! JavaScript bindings for the patch core: the same registry, validation,
//! codegen and evaluator the gate runs, for the browser playground.
//!
//! Documents cross the boundary as JSON strings (the exact on-disk patch
//! format). GPU records cross as bytes laid out by `empyrean_patch::abi`, so JS
//! uploads them as-is and never needs to know a struct layout.

use empyrean_patch::PatchDoc;
use empyrean_patch::abi::{
    AudioUniform, MAX_AUDIO_SOURCES, MAX_DABS, MAX_EFFECTS, SCOPE_FLOATS, SCOPE_SPECTRUM,
    SCOPE_WAVE,
};
use empyrean_patch::effects::{DabPoint, EffectCfg, EffectKind, PenKind};
use empyrean_patch::eval::{DJ_EVENT_COUNT, DjLinkInputs};
use empyrean_patch::sim::{Geometry, Sim, Update};
use serde_json::json;
use wasm_bindgen::prelude::*;

/// Parse a patch and upgrade it to the current format, as every host does
/// where a document comes in.
fn parse_doc(json: &str) -> Result<PatchDoc, JsError> {
    let mut doc: PatchDoc =
        serde_json::from_str(json).map_err(|e| JsError::new(&format!("not a patch: {e}")))?;
    empyrean_patch::migrate::migrate(&mut doc);
    Ok(doc)
}

/// Upgrade a patch document to the current format (see
/// `empyrean_patch::migrate`); returns the upgraded JSON. Hosts run it where
/// a document comes in (storage, files) so the editor shows what renders.
#[wasm_bindgen]
pub fn migrate(doc: &str) -> Result<String, JsError> {
    Ok(serde_json::to_string(&parse_doc(doc)?).expect("patch serializes"))
}

/// The node palette (`GET /patch/registry` on the gate), as JSON. Every
/// node, port and param carries a `description`.
#[wasm_bindgen]
pub fn registry() -> String {
    empyrean_patch::registry::palette_json().to_string()
}

/// The wire shapes as JSON `[{"id", "label", "description", "accepts"}]`:
/// what flows on each kind of wire and which shapes may drive an input of
/// it (`accepts`, shape ids as in patch JSON and `registry()`).
#[wasm_bindgen]
pub fn shapes() -> String {
    empyrean_patch::registry::shapes_json().to_string()
}

/// The JSON Schema (draft 2020-12) of a patch document, as a JSON string:
/// the structure `validate` and `PatchSim` accept, with a `description` on
/// every field. Which node kinds, ports and params exist is `registry()`'s.
#[wasm_bindgen]
pub fn schema() -> String {
    empyrean_patch::patch_schema().to_string()
}

/// The built-in starter patches (`GET /patch/presets`), as a JSON array.
#[wasm_bindgen]
pub fn presets() -> String {
    serde_json::to_string(empyrean_patch::presets::presets()).expect("presets serialize")
}

/// Check a patch exactly as the gate does before it will run it. Returns
/// `{"ok":true}` or `{"ok":false,"errors":["..."]}`.
#[wasm_bindgen]
pub fn validate(doc: &str) -> String {
    let doc = match parse_doc(doc) {
        Ok(doc) => doc,
        Err(_) => {
            return json!({ "ok": false, "errors": ["not a patch"] }).to_string();
        }
    };
    if doc.format > empyrean_patch::PATCH_FORMAT {
        return json!({
            "ok": false,
            "errors": [format!("patch format {} is newer than this build understands", doc.format)],
        })
        .to_string();
    }
    match empyrean_patch::validate::validate(&doc) {
        Err(errors) => json!({
            "ok": false,
            "errors": errors.iter().map(|e| e.to_string()).collect::<Vec<_>>(),
        })
        .to_string(),
        // Validation passing is not the whole story: codegen has its own
        // limits (parameter slab size, not-yet-renderable kinds).
        Ok(_) => match empyrean_patch::codegen::compile(&doc) {
            Ok(_) => json!({ "ok": true }).to_string(),
            Err(e) => json!({ "ok": false, "errors": [e] }).to_string(),
        },
    }
}

/// Sizes the host needs to allocate its GPU buffers and build its UI.
#[wasm_bindgen]
pub fn limits() -> String {
    json!({
        "patchFormat": empyrean_patch::PATCH_FORMAT,
        "maxNodes": empyrean_patch::MAX_PATCH_NODES,
        "maxEdges": empyrean_patch::MAX_PATCH_EDGES,
        "maxEffects": MAX_EFFECTS,
        "maxDabs": MAX_DABS,
        "audioSources": MAX_AUDIO_SOURCES,
        "scopeWave": SCOPE_WAVE,
        "scopeSpectrum": SCOPE_SPECTRUM,
        "scopeFloats": SCOPE_FLOATS,
        "maxSlabFloats": empyrean_patch::codegen::MAX_SLAB_FLOATS,
        "maxPreviewNodes": empyrean_patch::codegen::MAX_PREVIEW_NODES,
        "miniPixels": empyrean_patch::codegen::MINI_PIXELS,
        "globalsBytes": std::mem::size_of::<empyrean_patch::abi::Globals>(),
        "audioBytes": std::mem::size_of::<AudioUniform>() * MAX_AUDIO_SOURCES,
        "effectBytes": std::mem::size_of::<empyrean_patch::abi::GpuEffect>(),
        "dabBytes": std::mem::size_of::<empyrean_patch::abi::GpuDab>(),
        "djEvents": DJ_EVENT_COUNT,
        "maxTouches": empyrean_patch::touch::MAX_TOUCHES,
        "maxImages": empyrean_patch::MAX_PATCH_IMAGES,
        "imageSize": empyrean_patch::abi::IMAGE_SIZE,
        "mediaBufferBytes": empyrean_patch::abi::MEDIA_BUFFER_BYTES,
        "maxMediaBytes": empyrean_patch::MAX_MEDIA_BYTES,
        "touchBytes": std::mem::size_of::<empyrean_patch::abi::GpuTouch>(),
    })
    .to_string()
}

/// What a Code node body may use (`reference::Reference` as JSON): the
/// shader lib's helpers with docs, its structs and globals, and the CPU
/// tier's builtins. Feeds the editor's completion and hover docs.
#[wasm_bindgen(js_name = codeReference)]
pub fn code_reference() -> String {
    empyrean_patch::reference::code_reference_json().to_string()
}

/// "Convert to Code": node `id` of the patch becomes a Code node with the
/// same wires and knob values and a body that reproduces it (see the
/// crate's `convert`). Returns the new document; throws when the node
/// cannot be converted.
#[wasm_bindgen(js_name = convertToCode)]
pub fn convert_to_code(doc: &str, id: &str) -> Result<String, JsError> {
    let mut doc = parse_doc(doc)?;
    empyrean_patch::convert::convert(&mut doc, id).map_err(|e| JsError::new(&e))?;
    Ok(serde_json::to_string(&doc).expect("patch serializes"))
}

/// Effect kinds in GPU-id order, by their serde (wire) names.
#[wasm_bindgen]
pub fn effect_kinds() -> String {
    serde_json::to_string(&EffectKind::ALL).expect("kinds serialize")
}

/// One running patch.
#[wasm_bindgen]
pub struct PatchSim {
    sim: Sim,
}

#[wasm_bindgen]
impl PatchSim {
    /// Compile `doc` (patch JSON) for an array of `spokes` × `pixels` LEDs.
    /// Throws with the validation/codegen message if it cannot run.
    #[wasm_bindgen(constructor)]
    pub fn new(
        doc: &str,
        spokes: u32,
        pixels: u32,
        inner_over_outer: f32,
    ) -> Result<PatchSim, JsError> {
        let geometry = Geometry {
            spokes: spokes.max(1),
            pixels: pixels.max(1),
            inner_over_outer,
        };
        let sim = Sim::new(parse_doc(doc)?, geometry).map_err(|e| JsError::new(&e))?;
        Ok(PatchSim { sim })
    }

    /// Apply an edited document. Returns `"params"` (knobs only, applied in
    /// place), `"program"` (graph changed, same shader) or `"shader"` (rebuild
    /// the GPU pipelines from `wgsl()` / `previewWgsl()`). Throws, leaving the
    /// running patch untouched, if the new document cannot run.
    pub fn update(&mut self, doc: &str) -> Result<String, JsError> {
        let update = self
            .sim
            .update(parse_doc(doc)?)
            .map_err(|e| JsError::new(&e))?;
        Ok(match update {
            Update::Params => "params",
            Update::Program {
                shader_changed: false,
            } => "program",
            Update::Program {
                shader_changed: true,
            } => "shader",
        }
        .into())
    }

    /// The main compute shader: one invocation per LED, writes packed RGB to
    /// binding 4.
    pub fn wgsl(&self) -> String {
        self.sim.program().wgsl.clone()
    }

    /// The thumbnail shader: `previewNodes().length` cells of
    /// `spokes × pixels`, same bindings. Empty when nothing is previewable.
    #[wasm_bindgen(js_name = previewWgsl)]
    pub fn preview_wgsl(&self) -> String {
        self.sim.program().preview_wgsl.clone()
    }

    /// The key of each preview cell, in cell order: a node id, or
    /// `"<id>:<port>"` for a Code node's extra field outputs (the mini is
    /// `node:<key>`).
    #[wasm_bindgen(js_name = previewNodes)]
    pub fn preview_nodes(&self) -> Vec<String> {
        self.sim.program().preview_keys()
    }

    /// `[[nodeId, port], ...]` for each value in `scalarValues()`.
    #[wasm_bindgen(js_name = previewScalars)]
    pub fn preview_scalars(&self) -> String {
        let doc = self.sim.flat_doc();
        let list: Vec<(&str, &str)> = self
            .sim
            .program()
            .preview_scalars
            .iter()
            .map(|(i, port)| (doc.nodes[*i].id.as_str(), port.as_str()))
            .collect();
        serde_json::to_string(&list).expect("scalars serialize")
    }

    /// Where each GPU Code node's body sits in `wgsl()` (and `previewWgsl()`):
    /// `[{"node": id, "first": line, "count": lines}, ...]`, 1-based.
    #[wasm_bindgen(js_name = codeLines)]
    pub fn code_lines(&self) -> String {
        let doc = self.sim.flat_doc();
        let list: Vec<serde_json::Value> = self
            .sim
            .program()
            .code_lines
            .iter()
            .map(|c| json!({ "node": doc.nodes[c.node].id, "first": c.first, "count": c.count }))
            .collect();
        serde_json::to_string(&list).expect("code lines serialize")
    }

    /// `msg` with every `wgsl:L:C` location inside a Code node's body
    /// rewritten as `Code node "<name>" line N:C` (see the crate's
    /// `Program::relocate_error`).
    #[wasm_bindgen(js_name = relocateError)]
    pub fn relocate_error(&self, msg: &str) -> String {
        self.sim.program().relocate_error(msg)
    }

    /// Floats in the parameter slab (binding 8).
    #[wasm_bindgen(js_name = slabLen)]
    pub fn slab_len(&self) -> usize {
        self.sim.program().slab_len
    }

    /// Advance one frame.
    pub fn step(&mut self, dt: f32) {
        self.sim.step(dt);
    }

    /// Binding 0 bytes.
    pub fn globals(&self) -> Vec<u8> {
        bytemuck::bytes_of(self.sim.globals()).to_vec()
    }

    /// Binding 0 bytes for the mini-preview pass (`previewWgsl()`): spokes of
    /// `limits().miniPixels` samples.
    #[wasm_bindgen(js_name = previewGlobals)]
    pub fn preview_globals(&self) -> Vec<u8> {
        bytemuck::bytes_of(&self.sim.preview_globals()).to_vec()
    }

    /// Binding 1 bytes (every source).
    pub fn audio(&self) -> Vec<u8> {
        bytemuck::cast_slice(self.sim.audio_records()).to_vec()
    }

    /// Binding 3 bytes: the live effects only.
    pub fn effects(&self) -> Vec<u8> {
        bytemuck::cast_slice(self.sim.effect_records()).to_vec()
    }

    /// Binding 5 bytes: the live dabs only.
    pub fn dabs(&self) -> Vec<u8> {
        bytemuck::cast_slice(self.sim.dab_records()).to_vec()
    }

    /// Binding 10 bytes: the live touch records only (the binding itself is a
    /// fixed `limits().maxTouches`-long uniform array).
    pub fn touches(&self) -> Vec<u8> {
        bytemuck::cast_slice(self.sim.touch_records()).to_vec()
    }

    /// Whether the running patch reads raw touch, and so owns the touch
    /// surface: send it `touch` events instead of applying a tap/pen tool.
    #[wasm_bindgen(js_name = usesTouch)]
    pub fn uses_touch(&self) -> bool {
        self.sim.uses_touch()
    }

    /// One raw pointer event: `phase` is `"down"`, `"move"` or `"up"`;
    /// `angle`/`radius` in the physical frame (as `screenToPolar` gives them);
    /// the toucher's color (hue < 0 = white). `source` tells devices apart
    /// (0 for a single surface).
    #[allow(clippy::too_many_arguments)]
    pub fn touch(
        &mut self,
        source: u32,
        id: u32,
        phase: &str,
        angle: f32,
        radius: f32,
        hue: f32,
        saturation: f32,
        brightness: f32,
    ) -> Result<(), JsError> {
        use empyrean_patch::touch::{TouchColor, TouchInput, TouchPhase};
        let phase = match phase {
            "down" => TouchPhase::Down,
            "move" => TouchPhase::Move,
            "up" => TouchPhase::Up,
            other => return Err(JsError::new(&format!("unknown touch phase \"{other}\""))),
        };
        self.sim.touch(
            u64::from(source),
            TouchInput {
                id,
                phase,
                angle,
                radius,
            },
            TouchColor {
                hue,
                saturation,
                brightness,
            },
        );
        Ok(())
    }

    /// Binding 8.
    pub fn slab(&self) -> Vec<f32> {
        self.sim.slab().to_vec()
    }

    /// Current values for `previewScalars()`.
    #[wasm_bindgen(js_name = scalarValues)]
    pub fn scalar_values(&self) -> Vec<f32> {
        self.sim.scalar_values()
    }

    /// Live knob change; no recompile.
    #[wasm_bindgen(js_name = setParam)]
    pub fn set_param(&mut self, node: &str, param: &str, value: f32) {
        self.sim.set_param(node, param, value);
    }

    /// Fire an effect from its JSON (`EffectCfg`: `{"kind":"burst",...}`,
    /// missing fields take defaults), like a tap on the gate's preview.
    #[wasm_bindgen(js_name = triggerEffect)]
    pub fn trigger_effect(&mut self, cfg: &str) -> Result<(), JsError> {
        let cfg: EffectCfg =
            serde_json::from_str(cfg).map_err(|e| JsError::new(&format!("bad effect: {e}")))?;
        self.sim.trigger_effect(cfg);
        Ok(())
    }

    /// Draw a stroke: `pen` by name (`"glow"`, `"comet"`, ...) and `points`
    /// as flat `[angle, radius, dir, ...]` triples in physical space.
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        pen: &str,
        points: &[f32],
        hue: f32,
        saturation: f32,
        brightness: f32,
        size: f32,
        intensity: f32,
    ) -> Result<(), JsError> {
        let pen: PenKind = serde_json::from_value(json!(pen))
            .map_err(|_| JsError::new(&format!("unknown pen \"{pen}\"")))?;
        let points: Vec<DabPoint> = points
            .chunks_exact(3)
            .map(|p| DabPoint {
                angle: p[0],
                radius: p[1],
                dir: p[2],
            })
            .collect();
        self.sim
            .draw(pen, &points, hue, saturation, brightness, size, intensity);
        Ok(())
    }

    /// Audio features for one source, in `AudioUniform` field order:
    /// level, bass, mid, treble, onset, beat_phase, bpm, bpm_conf, bass_att,
    /// mid_att, treble_att.
    #[wasm_bindgen(js_name = setAudio)]
    pub fn set_audio(&mut self, source: usize, f: &[f32]) {
        let Some(a) = self.sim.audio.get_mut(source) else {
            return;
        };
        let at = |i: usize| f.get(i).copied().unwrap_or(0.0);
        *a = AudioUniform {
            level: at(0),
            bass: at(1),
            mid: at(2),
            treble: at(3),
            onset: at(4),
            beat_phase: at(5),
            bpm: at(6),
            bpm_conf: at(7),
            bass_att: at(8),
            mid_att: at(9),
            treble_att: at(10),
            _pad2: 0.0,
        };
    }

    /// Feed mono microphone samples into audio source `source`; the gate's own
    /// feature extraction and beat tracking run on them.
    #[wasm_bindgen(js_name = feedAudio)]
    pub fn feed_audio(&mut self, source: usize, sample_rate: f32, samples: &[f32]) {
        self.sim.feed_audio(source, sample_rate, samples);
    }

    /// Silence a sample-fed audio source.
    #[wasm_bindgen(js_name = stopAudio)]
    pub fn stop_audio(&mut self, source: usize) {
        self.sim.stop_audio(source);
    }

    /// Binding 6: waveform + spectrum for every source.
    pub fn scope(&self) -> Vec<f32> {
        self.sim.scope().to_vec()
    }

    /// Phone motion: yaw/pitch/roll in radians, shake 0..1.
    #[wasm_bindgen(js_name = setMotion)]
    pub fn set_motion(&mut self, yaw: f32, pitch: f32, roll: f32, shake: f32) {
        self.sim.yaw = yaw;
        self.sim.pitch = pitch;
        self.sim.roll = roll;
        self.sim.shake = shake;
    }

    /// PRO DJ LINK scalars in `DjLinkInputs` field order: active, energy,
    /// deck, deck_side, event_deck, event_side, playing, on_air,
    /// deck_1_on_air, deck_2_on_air, looping, mix, mix_activity, beat_in_bar,
    /// phrase_active, phrase_kind, phrase_progress, phrase_fill.
    #[wasm_bindgen(js_name = setDjLink)]
    pub fn set_dj_link(&mut self, f: &[f32]) {
        let at = |i: usize| f.get(i).copied().unwrap_or(0.0);
        let seq = self.sim.dj_link.event_seq;
        self.sim.dj_link = DjLinkInputs {
            active: at(0),
            energy: at(1),
            deck: at(2),
            deck_side: at(3),
            event_deck: at(4),
            event_side: at(5),
            playing: at(6),
            on_air: at(7),
            deck_1_on_air: at(8),
            deck_2_on_air: at(9),
            looping: at(10),
            mix: at(11),
            mix_activity: at(12),
            beat_in_bar: at(13),
            phrase_active: at(14),
            phrase_kind: at(15),
            phrase_progress: at(16),
            phrase_fill: at(17),
            event_seq: seq,
        };
    }

    /// Fire PRO DJ LINK event output `index` (play, cue, cue_release,
    /// on_air_event, off_air_event, loop_start, loop_wrap, loop_end, jump,
    /// phrase_change, fill_in).
    #[wasm_bindgen(js_name = fireDjEvent)]
    pub fn fire_dj_event(&mut self, index: usize) {
        self.sim.fire_dj_event(index);
    }

    /// Master brightness 0..1 and speed multiplier.
    #[wasm_bindgen(js_name = setMaster)]
    pub fn set_master(&mut self, brightness: f32, speed: f32) {
        self.sim.master = brightness;
        self.sim.master_speed = speed;
    }

    /// Master hue pull (target in turns, amount 0..1, looseness 0..1).
    #[wasm_bindgen(js_name = setHuePull)]
    pub fn set_hue_pull(&mut self, target: f32, amount: f32, loose: f32) {
        self.sim.hue_target = target;
        self.sim.hue_amount = amount;
        self.sim.hue_loose = loose;
    }

    /// The running patch's Still images as JSON
    /// `[{"node": id, "slot": cell, "media": dataUrl | null}]`: upload each
    /// node's picture (IMAGE_SIZE², RGBA) to its cell of the media buffer and
    /// call `setImageLoaded`.
    pub fn images(&self) -> String {
        let list: Vec<serde_json::Value> = self
            .sim
            .images()
            .into_iter()
            .map(|(node, slot, media)| json!({ "node": node, "slot": slot, "media": media }))
            .collect();
        serde_json::to_string(&list).expect("images serialize")
    }

    /// Mark media cell `slot` as holding (or not) its Still image.
    #[wasm_bindgen(js_name = setImageLoaded)]
    pub fn set_image_loaded(&mut self, slot: u32, loaded: bool) {
        if slot < 32 {
            if loaded {
                self.sim.image_mask |= 1 << slot;
            } else {
                self.sim.image_mask &= !(1 << slot);
            }
        }
    }

    /// Size of the RGBA8 frame the host keeps in the VIDEO buffer; 0 × 0
    /// for none.
    #[wasm_bindgen(js_name = setVideo)]
    pub fn set_video(&mut self, width: u32, height: u32) {
        self.sim.video_width = width;
        self.sim.video_height = height;
    }
}
