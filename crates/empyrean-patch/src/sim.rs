//! A self-contained patch host: one compiled patch, its control-rate state,
//! the transient effects and dabs it draws, and the exact GPU records the
//! generated shader reads, packed fresh every frame.
//!
//! This is what the browser playground runs (through `empyrean-patch-wasm`):
//! it plays the role of the engine loop for a single patch, without audio
//! devices, sACN, scenes or games. Inputs the real gate gets from hardware or
//! the network (audio features, phone motion, PRO DJ LINK, taps) are plain
//! fields and methods here, fed by whatever the host has.
//!
//! The per-frame order mirrors `engine/mod.rs`: evaluate the patch (which may
//! emit effects), then age and pack effects and dabs, then step the rotation.

use crate::PatchDoc;
use crate::abi::{
    AudioUniform, Globals, GpuDab, GpuEffect, GpuTouch, MAX_AUDIO_SOURCES, MAX_DABS, MAX_EFFECTS,
    SCOPE_FLOATS,
};
use crate::audio::AudioChain;
use crate::codegen::{self, Program};
use crate::effects::{Dab, DabPoint, EffectCfg, EffectKind, PenKind, Spin};
use crate::eval::{DJ_EVENT_COUNT, DjLinkInputs, EvalInputs, Runtime};
use crate::touch::{TouchColor, TouchInput, Touches};

/// The array being simulated. Defaults are the gate's (`config.rs`).
#[derive(Debug, Clone, Copy)]
pub struct Geometry {
    pub spokes: u32,
    pub pixels: u32,
    /// Inner radius over outer radius, 0..1.
    pub inner_over_outer: f32,
}

impl Default for Geometry {
    fn default() -> Self {
        Self {
            spokes: 64,
            pixels: 378,
            inner_over_outer: 8.0 / 25.0,
        }
    }
}

impl Geometry {
    pub fn leds(&self) -> u32 {
        self.spokes * self.pixels
    }
}

/// What [`Sim::update`] had to do to apply an edited document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Update {
    /// Same graph, new knob values: applied in place, no state lost.
    Params,
    /// The graph changed: the evaluator was rebuilt. `shader_changed` says
    /// whether the host must rebuild its pipelines too (the generated WGSL
    /// differs); scalar-only rewiring keeps the same shader.
    Program { shader_changed: bool },
}

pub struct Sim {
    geometry: Geometry,
    doc: PatchDoc,
    prog: Program,
    rt: Runtime,
    /// Live effects and dabs with the sim time they were born at; age is
    /// `time - born`, as the engine reads `born.elapsed()` at pack time.
    effects: Vec<(EffectCfg, f32, u32)>,
    dabs: Vec<(Dab, f32)>,
    spin: Spin,
    touches: Touches,
    gpu_touches: Vec<GpuTouch>,
    time: f32,
    effect_seq: u64,

    /// Per-source audio features (source 0 is what the Audio node defaults to).
    /// Set directly, or let [`Sim::feed_audio`] fill a source from samples.
    pub audio: [AudioUniform; MAX_AUDIO_SOURCES],
    /// Sample-fed sources: their analysis chain and sample rate.
    chains: [Option<(AudioChain, f32)>; MAX_AUDIO_SOURCES],
    /// Binding 6: per-source waveform ring + spectrum.
    scope: Vec<f32>,
    /// Phone motion, radians (yaw/pitch/roll) and a 0..1 decaying shake.
    pub yaw: f32,
    pub pitch: f32,
    pub roll: f32,
    pub shake: f32,
    /// PRO DJ LINK state; fire events with [`Sim::fire_dj_event`].
    pub dj_link: DjLinkInputs,
    /// Master brightness 0..1 and master speed (phase rate multiplier).
    pub master: f32,
    pub master_speed: f32,
    /// Master hue pull: target hue in turns, amount 0..1 (0 = off), looseness.
    pub hue_target: f32,
    pub hue_amount: f32,
    pub hue_loose: f32,
    /// Dimensions of the frame the host uploads to the VIDEO buffer; zero
    /// width or height means no video.
    pub video_width: u32,
    pub video_height: u32,
    /// Bit k: the host has uploaded Still image cell k (see
    /// `program().images` and [`Sim::images`]).
    pub image_mask: u32,

    globals: Globals,
    fx: Vec<GpuEffect>,
    gpu_dabs: Vec<GpuDab>,
    slab: Vec<f32>,
}

impl Sim {
    /// Validate and compile `doc` for `geometry`.
    pub fn new(doc: PatchDoc, geometry: Geometry) -> Result<Self, String> {
        let prog = codegen::compile(&doc)?;
        let rt = Runtime::new(doc.clone(), prog.clone());
        let slab = vec![0.0; prog.slab_len];
        let mut sim = Self {
            geometry,
            doc,
            prog,
            rt,
            effects: Vec::new(),
            dabs: Vec::new(),
            spin: Spin::default(),
            touches: Touches::new(),
            gpu_touches: Vec::new(),
            time: 0.0,
            effect_seq: 0,
            audio: [AudioUniform::default(); MAX_AUDIO_SOURCES],
            chains: Default::default(),
            scope: vec![0.0; SCOPE_FLOATS * MAX_AUDIO_SOURCES],
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            shake: 0.0,
            dj_link: DjLinkInputs::default(),
            master: 1.0,
            master_speed: 1.0,
            hue_target: 0.0,
            hue_amount: 0.0,
            hue_loose: 0.0,
            video_width: 0,
            video_height: 0,
            image_mask: 0,
            globals: Globals::default(),
            fx: Vec::new(),
            gpu_dabs: Vec::new(),
            slab,
        };
        sim.pack_globals(0.0);
        Ok(sim)
    }

    pub fn geometry(&self) -> Geometry {
        self.geometry
    }

    pub fn doc(&self) -> &PatchDoc {
        &self.doc
    }

    /// The compiled program: `wgsl` (main), `preview_wgsl` (per-node
    /// thumbnails), slab length, and which nodes the previews show.
    pub fn program(&self) -> &Program {
        &self.prog
    }

    /// Apply an edited document. Knob-only edits keep all evaluator state
    /// (LFO phases, smoothing, envelopes), so turning a knob never jumps the
    /// pattern; anything structural rebuilds the evaluator. On error the
    /// running patch is left as it was.
    pub fn update(&mut self, doc: PatchDoc) -> Result<Update, String> {
        let prog = codegen::compile(&doc)?;
        let same_graph = prog.wgsl == self.prog.wgsl
            && prog.preview_wgsl == self.prog.preview_wgsl
            && prog.cpu_order == self.prog.cpu_order
            && prog.wires == self.prog.wires
            && self.doc.nodes.len() == doc.nodes.len()
            && self
                .doc
                .nodes
                .iter()
                .zip(&doc.nodes)
                .all(|(a, b)| a.id == b.id && a.kind == b.kind);
        if same_graph {
            for node in &doc.nodes {
                for (param, value) in &node.params {
                    self.rt.set_param(&node.id, param, *value);
                }
            }
            self.doc = doc;
            return Ok(Update::Params);
        }
        let shader_changed =
            prog.wgsl != self.prog.wgsl || prog.preview_wgsl != self.prog.preview_wgsl;
        let mut rt = Runtime::new(doc.clone(), prog.clone());
        // Phases, timers and smoothing carry over: an edit never jumps.
        rt.adopt_state(&self.rt);
        self.rt = rt;
        self.slab = vec![0.0; prog.slab_len];
        self.prog = prog;
        self.doc = doc;
        Ok(Update::Program { shader_changed })
    }

    /// Live knob change (an exposed param on a play surface).
    pub fn set_param(&mut self, node: &str, param: &str, value: f32) {
        self.rt.set_param(node, param, value);
        if let Some(n) = self.doc.nodes.iter_mut().find(|n| n.id == node) {
            n.params.insert(param.to_string(), value);
        }
    }

    /// A tap or pad press, as from a client: advances the Tap node's sequence,
    /// and is placed in composition space like the engine does (see
    /// `SharedState::trigger_effect`).
    pub fn trigger_effect(&mut self, mut cfg: EffectCfg) {
        self.effect_seq += 1;
        if cfg.kind != EffectKind::Rotate {
            cfg.angle -= self.spin.angle;
            cfg.rotation -= self.spin.angle;
        }
        self.push_effect(cfg, 0);
    }

    /// An effect emitted by the patch itself (does not advance Tap).
    fn push_effect(&mut self, cfg: EffectCfg, source: u32) {
        if cfg.kind == EffectKind::Rotate {
            self.spin.impulse(&cfg);
            return;
        }
        if self.effects.len() >= MAX_EFFECTS {
            self.effects.remove(0);
        }
        self.effects.push((cfg, self.time, source));
    }

    /// One live-draw stroke segment (points in physical space).
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        pen: PenKind,
        points: &[DabPoint],
        hue: f32,
        saturation: f32,
        brightness: f32,
        size: f32,
        intensity: f32,
    ) {
        let points = &points[points.len().saturating_sub(MAX_DABS)..];
        let overflow = (self.dabs.len() + points.len()).saturating_sub(MAX_DABS);
        self.dabs.drain(..overflow.min(self.dabs.len()));
        for p in points {
            self.dabs.push((
                Dab::new(
                    pen,
                    *p,
                    self.spin.angle,
                    hue,
                    saturation,
                    brightness,
                    size,
                    intensity,
                ),
                self.time,
            ));
        }
    }

    /// Feed mono samples into audio source `source`, analyzed exactly as the
    /// gate analyzes a local audio device. Fills that source's features and
    /// its slice of the SCOPE buffer.
    pub fn feed_audio(&mut self, source: usize, sample_rate: f32, mono: &[f32]) {
        let Some(slot) = self.chains.get_mut(source) else {
            return;
        };
        if slot.as_ref().is_none_or(|(_, rate)| *rate != sample_rate) {
            *slot = Some((AudioChain::new(sample_rate), sample_rate));
        }
        let (chain, _) = slot.as_mut().expect("chain just ensured");
        chain.feed(mono);
        self.audio[source] = chain.features();
        self.scope[source * SCOPE_FLOATS..(source + 1) * SCOPE_FLOATS]
            .copy_from_slice(&chain.scope());
    }

    /// Stop a sample-fed source: its features and scope go silent.
    pub fn stop_audio(&mut self, source: usize) {
        if let Some(slot) = self.chains.get_mut(source) {
            *slot = None;
            self.audio[source] = AudioUniform::default();
            self.scope[source * SCOPE_FLOATS..(source + 1) * SCOPE_FLOATS].fill(0.0);
        }
    }

    /// One raw pointer event (physical frame). `source` tells fingers from
    /// different devices apart; a single-surface host can pass 0.
    pub fn touch(&mut self, source: u64, input: TouchInput, color: TouchColor) {
        self.touches.apply(source, self.time, input, color);
    }

    /// Whether the running patch reads raw touch (and so owns the surface).
    pub fn uses_touch(&self) -> bool {
        codegen::uses_touch(&self.doc)
    }

    /// The running patch's Still images: (node id, media cell, image data URL
    /// if the node has one). The host uploads each to its cell and marks it in
    /// [`Sim::image_mask`].
    pub fn images(&self) -> Vec<(String, u32, Option<String>)> {
        self.prog
            .images
            .iter()
            .map(|&(i, slot)| {
                let n = &self.doc.nodes[i];
                (n.id.clone(), slot, n.media.clone())
            })
            .collect()
    }

    /// Fire a PRO DJ LINK event output (`eval::DJ_EVENT_*`).
    pub fn fire_dj_event(&mut self, event: usize) {
        if event < DJ_EVENT_COUNT {
            self.dj_link.event_seq[event] = self.dj_link.event_seq[event].wrapping_add(1);
        }
    }

    /// Advance one frame of `dt` seconds and repack every GPU record.
    pub fn step(&mut self, dt: f32) {
        let dt = if dt.is_finite() {
            dt.clamp(0.0, 0.5)
        } else {
            0.0
        };
        self.time += dt;
        self.touches.expire(self.time);
        let touch = self.touches.view(self.time, self.spin.angle);

        let slab = self.rt.eval(&EvalInputs {
            dt,
            master_speed: self.master_speed,
            audio: &self.audio,
            yaw: self.yaw,
            pitch: self.pitch,
            roll: self.roll,
            shake: self.shake,
            effect_seq: self.effect_seq,
            dj_link: self.dj_link,
            touch: &touch,
        });
        self.slab.clear();
        self.slab.extend_from_slice(slab);
        for (cfg, source) in self.rt.take_emitted_effects() {
            self.push_effect(cfg, source);
        }

        let now = self.time;
        self.effects
            .retain(|(cfg, born, _)| now - born < cfg.lifetime());
        self.fx.clear();
        self.fx.extend(
            self.effects
                .iter()
                .map(|(cfg, born, source)| cfg.to_gpu(now - born, 1.0, *source)),
        );

        self.dabs
            .retain(|(dab, born)| now - born < dab.kind.lifetime());
        self.gpu_dabs.clear();
        self.gpu_dabs.extend(
            self.dabs
                .iter()
                .map(|(dab, born)| dab.to_gpu(now - born, 1.0)),
        );

        let rotation = self.spin.step(dt);
        self.gpu_touches = self.touches.gpu(self.time, rotation);
        self.pack_globals(dt);
        self.globals.rotation = rotation;
    }

    fn pack_globals(&mut self, dt: f32) {
        let g = self.geometry;
        self.globals = Globals {
            spokes: g.spokes,
            pixels: g.pixels,
            effect_count: self.fx.len() as u32,
            time: self.time,
            dt,
            master: self.master.clamp(0.0, 1.0),
            inner_over_outer: g.inner_over_outer.clamp(0.0, 1.0),
            tilt_x: self.roll,
            tilt_y: self.pitch,
            shake: self.shake,
            yaw: self.yaw,
            dab_count: self.gpu_dabs.len() as u32,
            touch_count: self.gpu_touches.len() as u32,
            image_mask: self.image_mask,
            video_width: self.video_width,
            video_height: self.video_height,
            video_active: u32::from(self.video_width > 0 && self.video_height > 0),
            video_mix: 1.0,
            rotation: self.spin.angle,
            hue_target: self.hue_target,
            hue_amount: self.hue_amount.clamp(0.0, 1.0),
            hue_loose: self.hue_loose.clamp(0.0, 1.0),
            ..Globals::default()
        };
    }

    /// Binding 0.
    pub fn globals(&self) -> &Globals {
        &self.globals
    }
    /// Binding 0 for the mini-preview pass: the same globals on a spoke of
    /// [`codegen::MINI_PIXELS`] samples, as the engine renders thumbnails.
    pub fn preview_globals(&self) -> Globals {
        Globals {
            pixels: codegen::MINI_PIXELS.min(self.geometry.pixels),
            ..self.globals
        }
    }
    /// Binding 1 (always all sources).
    pub fn audio_records(&self) -> &[AudioUniform; MAX_AUDIO_SOURCES] {
        &self.audio
    }
    /// Binding 6.
    pub fn scope(&self) -> &[f32] {
        &self.scope
    }
    /// Binding 3; `globals().effect_count` records are live.
    pub fn effect_records(&self) -> &[GpuEffect] {
        &self.fx
    }
    /// Binding 5; `globals().dab_count` records are live.
    pub fn dab_records(&self) -> &[GpuDab] {
        &self.gpu_dabs
    }
    /// Binding 10; `globals().touch_count` records are live.
    pub fn touch_records(&self) -> &[GpuTouch] {
        &self.gpu_touches
    }
    /// Binding 8: the parameter slab (`program().slab_len` floats).
    pub fn slab(&self) -> &[f32] {
        &self.slab
    }

    /// Current values of the program's `preview_scalars`, in order (the
    /// editor's amplitude meters).
    pub fn scalar_values(&self) -> Vec<f32> {
        self.prog
            .preview_scalars
            .iter()
            .map(|(node, port)| self.rt.scalar_value(*node, port))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::presets::presets;

    fn sim(name: &str) -> Sim {
        let doc = presets()
            .iter()
            .find(|p| p.name == name)
            .unwrap_or_else(|| panic!("preset {name}"))
            .clone();
        Sim::new(doc, Geometry::default()).expect("preset compiles")
    }

    #[test]
    fn every_preset_runs() {
        for doc in presets() {
            let mut sim = Sim::new(doc.clone(), Geometry::default())
                .unwrap_or_else(|e| panic!("{}: {e}", doc.name));
            for _ in 0..10 {
                sim.step(1.0 / 60.0);
            }
            assert_eq!(sim.slab().len(), sim.program().slab_len, "{}", doc.name);
            assert!(sim.slab().iter().all(|v| v.is_finite()), "{}", doc.name);
            assert_eq!(sim.globals().spokes, 64);
        }
    }

    #[test]
    fn knob_edits_keep_state_and_structure_edits_rebuild() {
        let mut sim = sim(&presets()[0].name);
        for _ in 0..30 {
            sim.step(1.0 / 60.0);
        }
        let mut doc = sim.doc().clone();
        let node = doc
            .nodes
            .iter_mut()
            .find(|n| crate::registry::lookup(&n.kind).is_some_and(|t| !t.params.is_empty()))
            .expect("a node with params");
        let def = &crate::registry::lookup(&node.kind).unwrap().params[0];
        node.params.insert(def.name.to_string(), def.max);
        assert_eq!(sim.update(doc.clone()).unwrap(), Update::Params);

        doc.nodes.retain(|n| n.kind != "output");
        assert!(sim.update(doc).is_err(), "no Output node");
        // Still running the last good program.
        sim.step(1.0 / 60.0);
    }

    #[test]
    fn effects_age_out_and_rotate_spins() {
        let mut sim = sim(&presets()[0].name);
        sim.trigger_effect(EffectCfg {
            kind: EffectKind::Burst,
            ..Default::default()
        });
        sim.step(1.0 / 60.0);
        assert_eq!(sim.globals().effect_count, 1);
        assert!(sim.effect_records()[0].age <= 1.0 / 60.0 + 1e-6);
        for _ in 0..120 {
            sim.step(1.0 / 60.0);
        }
        assert_eq!(sim.globals().effect_count, 0, "Burst lasts 1.2 s");

        sim.trigger_effect(EffectCfg {
            kind: EffectKind::Rotate,
            intensity: 1.0,
            ..Default::default()
        });
        sim.step(1.0 / 60.0);
        sim.step(1.0 / 60.0);
        assert!(sim.globals().rotation > 0.0);
        assert_eq!(
            sim.globals().effect_count,
            0,
            "Rotate never reaches the GPU"
        );
    }

    #[test]
    fn touch_drives_the_touch_node_and_the_gpu_records() {
        use crate::touch::TouchPhase;
        let doc: PatchDoc = serde_json::from_value(serde_json::json!({
            "nodes": [
                { "id": "t", "kind": "touch" },
                { "id": "fx", "kind": "event_effect", "params": { "effect": 1.0 } },
                { "id": "g", "kind": "touch_glow" },
                { "id": "o", "kind": "output" }
            ],
            "edges": [
                { "from": { "node": "t", "port": "down" }, "to": { "node": "fx", "port": "trigger" } },
                { "from": { "node": "t", "port": "angle" }, "to": { "node": "fx", "port": "angle" } },
                { "from": { "node": "g", "port": "out" }, "to": { "node": "o", "port": "in" } }
            ]
        }))
        .unwrap();
        let mut sim = Sim::new(doc, Geometry::default()).expect("compiles");
        assert!(sim.uses_touch());
        sim.step(1.0 / 60.0);
        let finger = |phase| TouchInput {
            id: 3,
            phase,
            angle: 1.0,
            radius: 0.6,
        };
        sim.touch(9, finger(TouchPhase::Down), TouchColor::default());
        sim.step(1.0 / 60.0);
        assert_eq!(sim.globals().touch_count, 1);
        assert_eq!(sim.globals().effect_count, 1, "down -> Event effect fired");
        assert!(
            (sim.effect_records()[0].angle - 1.0).abs() < 1e-5,
            "at the finger"
        );
        sim.touch(9, finger(TouchPhase::Up), TouchColor::default());
        sim.step(1.0 / 60.0);
        assert!(sim.touch_records()[0].released >= 0.0);
        for _ in 0..200 {
            sim.step(1.0 / 60.0);
        }
        assert_eq!(sim.globals().touch_count, 0, "released fingers expire");
    }

    #[test]
    fn dabs_are_bounded() {
        let mut sim = sim(&presets()[0].name);
        let points = vec![
            DabPoint {
                angle: 0.0,
                radius: 0.5,
                dir: 0.0
            };
            MAX_DABS + 10
        ];
        sim.draw(PenKind::Glow, &points, 0.5, 1.0, 1.0, 0.5, 1.0);
        sim.draw(PenKind::Glow, &points[..5], 0.5, 1.0, 1.0, 0.5, 1.0);
        sim.step(1.0 / 60.0);
        assert_eq!(sim.globals().dab_count as usize, MAX_DABS);
    }
}
