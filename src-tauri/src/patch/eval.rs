//! Control-rate evaluation: Scalar/Event nodes run here on the CPU every
//! frame, in the engine thread, and their results land in the GPU parameter
//! slab laid out by codegen. All time integration (LFO phases, `rate` params)
//! honors master speed, matching the layer stack's phase behavior — and like
//! layer phases, integration state lives here so live edits never cause
//! visual discontinuities.

use super::PatchDoc;
use super::codegen::Program;
use super::registry::{self, ParamKind};
use crate::engine::AudioUniform;
use crate::layers::MAX_AUDIO_SOURCES;
use crate::state::DJ_EVENT_COUNT;
use std::collections::HashMap;
use std::f32::consts::TAU;

pub struct EvalInputs<'a> {
    pub dt: f32,
    pub master_speed: f32,
    pub audio: &'a [AudioUniform; MAX_AUDIO_SOURCES],
    pub yaw: f32,
    pub pitch: f32,
    pub roll: f32,
    pub shake: f32,
    /// Monotonic count of triggered effects (taps, pads, beat-taps) — the Tap
    /// node fires an event whenever it advances.
    pub effect_seq: u64,
    pub dj_link: DjLinkInputs,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DjLinkInputs {
    pub active: f32,
    pub energy: f32,
    pub deck: f32,
    pub deck_side: f32,
    pub event_deck: f32,
    pub event_side: f32,
    pub playing: f32,
    pub on_air: f32,
    pub deck_1_on_air: f32,
    pub deck_2_on_air: f32,
    pub looping: f32,
    pub mix: f32,
    pub mix_activity: f32,
    pub beat_in_bar: f32,
    pub phrase_active: f32,
    pub phrase_kind: f32,
    pub phrase_progress: f32,
    pub phrase_fill: f32,
    pub event_seq: [u64; DJ_EVENT_COUNT],
}

const DJ_EVENT_PORTS: [&str; DJ_EVENT_COUNT] = [
    "play",
    "cue",
    "cue_release",
    "on_air_event",
    "off_air_event",
    "loop_start",
    "loop_wrap",
    "loop_end",
    "jump",
    "phrase_change",
    "fill_in",
];

#[derive(Clone)]
struct NodeState {
    /// Phase accumulator (time, lfo).
    acc: f64,
    /// One-pole state (smooth).
    y: f32,
    /// Seconds since the last trigger (envelope); INFINITY = never fired.
    env_t: f32,
    /// Previous beat phase, for wrap detection (audio).
    prev_beat: f32,
    /// Last seen effect_seq (tap); MAX = not yet initialized, so pre-existing
    /// effects never fire a spurious tap on the first frame.
    prev_seq: u64,
    /// Last seen sequence for every PRO DJ LINK event output.
    prev_dj_seq: [u64; DJ_EVENT_COUNT],
}

impl Default for NodeState {
    fn default() -> Self {
        Self {
            acc: 0.0,
            y: 0.0,
            env_t: f32::INFINITY,
            prev_beat: 0.0,
            prev_seq: u64::MAX,
            prev_dj_seq: [u64::MAX; DJ_EVENT_COUNT],
        }
    }
}

/// One compiled patch, live: owns the document, the program, and all
/// control-rate state. Rebuilt whenever the active patch or its file changes.
#[derive(Clone)]
pub struct Runtime {
    doc: PatchDoc,
    prog: Program,
    state: Vec<NodeState>,
    /// Accumulators for integrated slab slots (GPU phases).
    slot_acc: Vec<f64>,
    slab: Vec<f32>,
    /// Per-node scalar outputs of the current frame, port name → value.
    outputs: Vec<HashMap<String, f32>>,
    /// Event ports that fired this frame.
    events: Vec<Vec<&'static str>>,
}

impl Runtime {
    pub fn new(doc: PatchDoc, prog: Program) -> Self {
        let n = doc.nodes.len();
        let slab = vec![0.0; prog.slab_len];
        let slot_acc = vec![0.0; prog.slots.len()];
        Self {
            doc,
            prog,
            state: vec![NodeState::default(); n],
            slot_acc,
            slab,
            outputs: vec![HashMap::new(); n],
            events: vec![Vec::new(); n],
        }
    }

    /// Apply a live param change (exposed-param play surface) without any
    /// recompile — the next `eval` picks the value up from the doc.
    pub fn set_param(&mut self, node_id: &str, param: &str, value: f32) {
        if let Some(n) = self.doc.nodes.iter_mut().find(|n| n.id == node_id) {
            if let Some(def) = registry::lookup(&n.kind).and_then(|ty| ty.param(param)) {
                n.params
                    .insert(param.to_string(), sanitize_param(def, value));
            }
        }
    }

    fn param(&self, node: usize, param: &str) -> f32 {
        let inst = &self.doc.nodes[node];
        let Some(def) = registry::lookup(&inst.kind).and_then(|ty| ty.param(param)) else {
            return 0.0;
        };
        sanitize_param(def, inst.param(param))
    }

    /// A CPU node's input: the wired upstream output, else the knob value.
    fn input(&self, node: usize, port: &str) -> f32 {
        let raw = match self.prog.wires.get(&(node, port.to_string())) {
            Some((from, from_port)) => self.outputs[*from].get(from_port).copied().unwrap_or(0.0),
            None => self.param(node, port),
        };
        let inst = &self.doc.nodes[node];
        match registry::lookup(&inst.kind).and_then(|ty| ty.param(port)) {
            Some(def) => sanitize_param(def, raw),
            None => finite_or(raw, 0.0),
        }
    }

    fn event_fired(&self, node: usize, port: &str) -> bool {
        match self.prog.wires.get(&(node, port.to_string())) {
            Some((from, from_port)) => self.events[*from].iter().any(|p| *p == from_port.as_str()),
            None => false,
        }
    }

    /// Evaluate one frame; returns the parameter slab for the GPU.
    pub fn eval(&mut self, inp: &EvalInputs) -> &[f32] {
        let dt = finite_or(inp.dt, 0.0).clamp(0.0, 0.5);
        let ms = finite_or(inp.master_speed, 0.0).max(0.0);

        for i in 0..self.prog.cpu_order.len() {
            let node = self.prog.cpu_order[i];
            self.events[node].clear();
            let kind = self.doc.nodes[node].kind.clone();
            match kind.as_str() {
                "time" => {
                    let rate = self.input(node, "rate");
                    self.state[node].acc += (rate * ms * dt) as f64;
                    let v = self.state[node].acc as f32;
                    self.outputs[node].insert("out".into(), v);
                }
                "slider" => {
                    let v = self.input(node, "value");
                    self.outputs[node].insert("out".into(), v);
                }
                "audio" => {
                    let src =
                        (self.param(node, "source").round() as usize).min(MAX_AUDIO_SOURCES - 1);
                    let a = &inp.audio[src];
                    let o = &mut self.outputs[node];
                    o.insert("level".into(), a.level);
                    o.insert("bass".into(), a.bass);
                    o.insert("mid".into(), a.mid);
                    o.insert("treble".into(), a.treble);
                    o.insert("onset".into(), a.onset);
                    o.insert("beat_phase".into(), a.beat_phase);
                    o.insert("bpm".into(), a.bpm);
                    o.insert("tempo".into(), a.bpm / 120.0);
                    let st = &mut self.state[node];
                    if a.bpm > 0.0 && a.beat_phase < st.prev_beat - 0.5 {
                        self.events[node].push("beat");
                    }
                    st.prev_beat = a.beat_phase;
                }
                "imu" => {
                    let o = &mut self.outputs[node];
                    o.insert("yaw".into(), inp.yaw);
                    o.insert("pitch".into(), inp.pitch);
                    o.insert("roll".into(), inp.roll);
                    o.insert("shake".into(), inp.shake);
                }
                "tap" => {
                    let st = &mut self.state[node];
                    if st.prev_seq != u64::MAX && inp.effect_seq > st.prev_seq {
                        self.events[node].push("tap");
                    }
                    st.prev_seq = inp.effect_seq;
                }
                "dj_link" => {
                    let dj = inp.dj_link;
                    let o = &mut self.outputs[node];
                    o.insert("active".into(), dj.active);
                    o.insert("energy".into(), dj.energy);
                    o.insert("deck".into(), dj.deck);
                    o.insert("deck_side".into(), dj.deck_side);
                    o.insert("event_deck".into(), dj.event_deck);
                    o.insert("event_side".into(), dj.event_side);
                    o.insert("playing".into(), dj.playing);
                    o.insert("on_air".into(), dj.on_air);
                    o.insert("deck_1_on_air".into(), dj.deck_1_on_air);
                    o.insert("deck_2_on_air".into(), dj.deck_2_on_air);
                    o.insert("looping".into(), dj.looping);
                    o.insert("mix".into(), dj.mix);
                    o.insert("mix_activity".into(), dj.mix_activity);
                    o.insert("beat_in_bar".into(), dj.beat_in_bar);
                    o.insert("phrase_active".into(), dj.phrase_active);
                    o.insert("phrase_kind".into(), dj.phrase_kind);
                    o.insert("phrase_progress".into(), dj.phrase_progress);
                    o.insert("phrase_fill".into(), dj.phrase_fill);
                    let st = &mut self.state[node];
                    for (event, port) in DJ_EVENT_PORTS.iter().enumerate() {
                        if st.prev_dj_seq[event] != u64::MAX
                            && dj.event_seq[event] > st.prev_dj_seq[event]
                        {
                            self.events[node].push(port);
                        }
                        st.prev_dj_seq[event] = dj.event_seq[event];
                    }
                }
                "scalar_math" => {
                    let a = self.input(node, "a");
                    let b = self.input(node, "b");
                    let v = match self.param(node, "op").round() as u32 {
                        0 => a + b,
                        1 => a - b,
                        2 => a * b,
                        3 => a.min(b),
                        _ => a.max(b),
                    };
                    self.outputs[node].insert("out".into(), v);
                }
                "lfo" => {
                    let rate = self.input(node, "rate").max(0.0);
                    self.state[node].acc += (rate * ms * dt) as f64;
                    let ph = self.state[node].acc.fract() as f32;
                    let w = match self.param(node, "wave").round() as u32 {
                        0 => 0.5 + 0.5 * (TAU * ph).sin(),
                        1 => 1.0 - (2.0 * ph - 1.0).abs(),
                        2 => f32::from(ph < 0.5),
                        _ => ph,
                    };
                    let lo = self.input(node, "min");
                    let hi = self.input(node, "max");
                    self.outputs[node].insert("out".into(), lo + (hi - lo) * w);
                }
                "smooth" => {
                    let x = self.input(node, "in");
                    let seconds = self.input(node, "seconds").max(0.0);
                    let k = if seconds <= 1e-4 {
                        1.0
                    } else {
                        (dt / seconds).min(1.0)
                    };
                    let st = &mut self.state[node];
                    st.y += (x - st.y) * k;
                    let y = st.y;
                    self.outputs[node].insert("out".into(), y);
                }
                "envelope" => {
                    if self.event_fired(node, "trigger") {
                        self.state[node].env_t = 0.0;
                    } else {
                        self.state[node].env_t += dt;
                    }
                    let attack = self.input(node, "attack").max(0.0);
                    let decay = self.input(node, "decay").max(1e-3);
                    let peak = self.input(node, "peak");
                    let t = self.state[node].env_t;
                    let v = if !t.is_finite() {
                        0.0
                    } else if t < attack {
                        peak * (t / attack.max(1e-4))
                    } else {
                        peak * (-(t - attack) / decay).exp()
                    };
                    self.outputs[node].insert("out".into(), v);
                }
                _ => {}
            }
        }

        // Fill the slab: wired value (or knob), integrated where flagged.
        for (k, slot) in self.prog.slots.iter().enumerate() {
            let raw = match (&slot.wired, &slot.param) {
                (Some((from, port)), _) => self.outputs[*from].get(port).copied().unwrap_or(0.0),
                (None, Some(param)) => self.param(slot.node, param),
                (None, None) => 0.0,
            };
            let v = match &slot.param {
                Some(param) => {
                    let inst = &self.doc.nodes[slot.node];
                    registry::lookup(&inst.kind)
                        .and_then(|ty| ty.param(param))
                        .map(|def| sanitize_param(def, raw))
                        .unwrap_or_else(|| finite_or(raw, 0.0))
                }
                None => finite_or(raw, 0.0),
            };
            if slot.integrate {
                self.slot_acc[k] += (v * ms * dt) as f64;
                self.slab[slot.slot] = self.slot_acc[k] as f32;
            } else {
                self.slab[slot.slot] = v;
            }
        }
        &self.slab
    }
}

fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

fn sanitize_param(def: &registry::ParamDef, value: f32) -> f32 {
    let value = finite_or(value, def.default).clamp(def.min, def.max);
    match def.kind {
        ParamKind::Number => value,
        ParamKind::Select(_) => value.round(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patch::codegen::compile;
    use crate::patch::{Edge, NodeInst, PatchDoc, PortRef};

    fn node(id: &str, kind: &str) -> NodeInst {
        NodeInst {
            id: id.into(),
            kind: kind.into(),
            ..Default::default()
        }
    }

    fn edge(fnode: &str, fport: &str, tnode: &str, tport: &str) -> Edge {
        Edge {
            from: PortRef {
                node: fnode.into(),
                port: fport.into(),
            },
            to: PortRef {
                node: tnode.into(),
                port: tport.into(),
            },
        }
    }

    fn inputs(audio: &[AudioUniform; MAX_AUDIO_SOURCES]) -> EvalInputs<'_> {
        EvalInputs {
            dt: 0.1,
            master_speed: 1.0,
            audio,
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            shake: 0.0,
            effect_seq: 0,
            dj_link: DjLinkInputs::default(),
        }
    }

    fn runtime(doc: PatchDoc) -> Runtime {
        let prog = compile(&doc).expect("compiles");
        Runtime::new(doc, prog)
    }

    #[test]
    fn wired_audio_reaches_the_slab_and_knob_is_fallback() {
        let doc = PatchDoc {
            nodes: vec![
                node("aud", "audio"),
                node("mix", "blend"),
                node("o", "output"),
            ],
            edges: vec![
                edge("aud", "bass", "mix", "opacity"),
                edge("mix", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let mut audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        audio[0].bass = 0.75;
        audio[0].bpm = 128.0;
        let slab = rt.eval(&inputs(&audio)).to_vec();
        assert_eq!(rt.outputs[0]["bpm"], 128.0, "selected clock BPM is exposed");
        assert!(
            (rt.outputs[0]["tempo"] - 128.0 / 120.0).abs() < 1e-6,
            "tempo is normalized around 120 BPM"
        );

        let opacity_slot = rt
            .prog
            .slots
            .iter()
            .find(|s| s.param.as_deref() == Some("opacity"))
            .unwrap()
            .slot;
        assert_eq!(slab[opacity_slot], 0.75, "wire overrides the knob");

        // An unwired param reads its registry default (blend mode aside,
        // opacity default is 1.0 — check via a second blend param, master).
        let master_slot = rt
            .prog
            .slots
            .iter()
            .find(|s| s.param.as_deref() == Some("master"))
            .unwrap()
            .slot;
        assert_eq!(slab[master_slot], 1.0, "knob/default fallback");
    }

    #[test]
    fn wired_and_saved_params_are_bounded_and_finite() {
        let mut slider = node("slider", "slider");
        slider.params.insert("value".into(), 9.0);
        let mut output = node("o", "output");
        output.params.insert("master".into(), f32::NAN);
        let doc = PatchDoc {
            nodes: vec![slider, node("mix", "blend"), output],
            edges: vec![
                edge("slider", "out", "mix", "opacity"),
                edge("mix", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let slab = rt.eval(&inputs(&audio)).to_vec();
        let opacity = rt
            .prog
            .slots
            .iter()
            .find(|s| s.param.as_deref() == Some("opacity"))
            .unwrap()
            .slot;
        let master = rt
            .prog
            .slots
            .iter()
            .find(|s| s.param.as_deref() == Some("master"))
            .unwrap()
            .slot;
        assert_eq!(slab[opacity], 1.0, "wired values clamp to the target knob");
        assert_eq!(
            slab[master], 1.0,
            "non-finite values use the registry default"
        );

        rt.set_param("o", "master", 99.0);
        rt.eval(&inputs(&audio));
        assert_eq!(rt.slab[master], 2.0, "live values clamp to registry bounds");
        rt.set_param("o", "not_a_param", 1.0);
        assert!(!rt.doc.nodes[2].params.contains_key("not_a_param"));
    }

    #[test]
    fn integrated_params_accumulate_with_master_speed() {
        let doc = PatchDoc {
            nodes: vec![node("n", "noise_field"), node("o", "output")],
            edges: vec![edge("n", "out", "o", "in")],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let speed_slot = rt
            .prog
            .slots
            .iter()
            .find(|s| s.param.as_deref() == Some("speed"))
            .unwrap()
            .slot;

        rt.eval(&inputs(&audio));
        let one = rt.slab[speed_slot];
        rt.eval(&inputs(&audio));
        let two = rt.slab[speed_slot];
        // speed default 1.0, dt 0.1 → phase grows 0.1 per frame.
        assert!((one - 0.1).abs() < 1e-5, "{one}");
        assert!((two - 0.2).abs() < 1e-5, "{two}");

        // Halving master speed halves the increment — no discontinuity.
        let mut half = inputs(&audio);
        half.master_speed = 0.5;
        rt.eval(&half);
        assert!((rt.slab[speed_slot] - 0.25).abs() < 1e-5);
    }

    #[test]
    fn beat_event_drives_the_envelope() {
        let doc = PatchDoc {
            nodes: vec![
                node("aud", "audio"),
                node("env", "envelope"),
                node("tint", "colorize"),
                node("o", "output"),
            ],
            edges: vec![
                edge("aud", "beat", "env", "trigger"),
                edge("env", "out", "tint", "in"),
                edge("tint", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let mut audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        audio[0].bpm = 120.0;

        // No beat yet: envelope stays at 0.
        audio[0].beat_phase = 0.3;
        rt.eval(&inputs(&audio));
        audio[0].beat_phase = 0.9;
        rt.eval(&inputs(&audio));
        let env_slot = rt
            .prog
            .slots
            .iter()
            .find(|s| s.param.is_none())
            .unwrap()
            .slot;
        assert_eq!(rt.slab[env_slot], 0.0);

        // Phase wrap = beat: the attack ramp starts (t=0 → 0), rises within a
        // frame, then decays.
        audio[0].beat_phase = 0.05;
        rt.eval(&inputs(&audio));
        audio[0].beat_phase = 0.4;
        rt.eval(&inputs(&audio));
        let risen = rt.slab[env_slot];
        assert!(risen > 0.0, "envelope rose after the beat: {risen}");

        audio[0].beat_phase = 0.7;
        rt.eval(&inputs(&audio));
        assert!(rt.slab[env_slot] < risen, "decaying after the trigger");
    }

    #[test]
    fn tap_event_fires_on_new_effects_only() {
        let doc = PatchDoc {
            nodes: vec![
                node("tap", "tap"),
                node("env", "envelope"),
                node("tint", "colorize"),
                node("o", "output"),
            ],
            edges: vec![
                edge("tap", "tap", "env", "trigger"),
                edge("env", "out", "tint", "in"),
                edge("tint", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let env_slot = rt
            .prog
            .slots
            .iter()
            .find(|s| s.param.is_none())
            .unwrap()
            .slot;

        // Pre-existing effects (seq already 5) must not fire on the first frame.
        let mut inp = inputs(&audio);
        inp.effect_seq = 5;
        rt.eval(&inp);
        rt.eval(&inp);
        assert_eq!(rt.slab[env_slot], 0.0, "no spurious tap at startup");

        // A new effect advances the seq: envelope fires and rises.
        inp.effect_seq = 6;
        rt.eval(&inp);
        rt.eval(&inp);
        assert!(rt.slab[env_slot] > 0.0, "tap fired the envelope");
    }

    #[test]
    fn dj_link_events_fire_once_and_expose_deck_state() {
        let doc = PatchDoc {
            nodes: vec![
                node("link", "dj_link"),
                node("env", "envelope"),
                node("rings", "beat_rings"),
                node("o", "output"),
            ],
            edges: vec![
                edge("link", "jump", "env", "trigger"),
                edge("env", "out", "rings", "brightness"),
                edge("link", "mix", "rings", "front"),
                edge("rings", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let brightness_slot = rt
            .prog
            .slots
            .iter()
            .find(|s| s.wired.as_ref().is_some_and(|(_, port)| port == "out"))
            .unwrap()
            .slot;
        let front_slot = rt
            .prog
            .slots
            .iter()
            .find(|s| s.wired.as_ref().is_some_and(|(_, port)| port == "mix"))
            .unwrap()
            .slot;

        let mut inp = inputs(&audio);
        inp.dj_link.mix = 0.75;
        inp.dj_link.event_seq[crate::state::DJ_EVENT_JUMP] = 4;
        rt.eval(&inp);
        rt.eval(&inp);
        assert_eq!(rt.slab[brightness_slot], 0.0, "no startup event");
        assert_eq!(rt.slab[front_slot], 0.75, "continuous LINK state reaches GPU");

        inp.dj_link.event_seq[crate::state::DJ_EVENT_JUMP] += 1;
        rt.eval(&inp);
        rt.eval(&inp);
        assert!(rt.slab[brightness_slot] > 0.0, "jump fired the envelope");
    }

    #[test]
    fn repeated_dj_link_events_retrigger_on_every_counter_increment() {
        let doc = PatchDoc {
            nodes: vec![
                node("link", "dj_link"),
                node("cue_env", "envelope"),
                node("wrap_env", "envelope"),
                node("cue", "beat_rings"),
                node("wrap", "beat_rings"),
                node("mix", "blend"),
                node("o", "output"),
            ],
            edges: vec![
                edge("link", "cue", "cue_env", "trigger"),
                edge("link", "loop_wrap", "wrap_env", "trigger"),
                edge("cue_env", "out", "cue", "brightness"),
                edge("wrap_env", "out", "wrap", "brightness"),
                edge("cue", "out", "mix", "base"),
                edge("wrap", "out", "mix", "over"),
                edge("mix", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        rt.set_param("cue_env", "attack", 0.0);
        rt.set_param("wrap_env", "attack", 0.0);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let cue_slot = rt
            .prog
            .slots
            .iter()
            .find(|s| {
                s.wired
                    .as_ref()
                    .is_some_and(|(node, port)| {
                        rt.doc.nodes[*node].id == "cue_env" && port == "out"
                    })
            })
            .expect("cue envelope slot")
            .slot;
        let wrap_slot = rt
            .prog
            .slots
            .iter()
            .find(|s| {
                s.wired.as_ref().is_some_and(|(node, port)| {
                    rt.doc.nodes[*node].id == "wrap_env" && port == "out"
                })
            })
            .expect("wrap envelope slot")
            .slot;

        let mut inp = inputs(&audio);
        inp.dj_link.event_seq[crate::state::DJ_EVENT_CUE] = 20;
        inp.dj_link.event_seq[crate::state::DJ_EVENT_LOOP_WRAP] = 30;
        rt.eval(&inp);
        rt.eval(&inp);
        assert_eq!(rt.slab[cue_slot], 0.0, "no startup cue event");
        assert_eq!(rt.slab[wrap_slot], 0.0, "no startup wrap event");

        for event_number in 1..=3 {
            inp.dj_link.event_seq[crate::state::DJ_EVENT_CUE] += 1;
            inp.dj_link.event_seq[crate::state::DJ_EVENT_LOOP_WRAP] += 1;
            rt.eval(&inp);
            assert!(
                rt.slab[cue_slot] > 0.99,
                "cue event {event_number} retriggered"
            );
            assert!(
                rt.slab[wrap_slot] > 0.99,
                "loop wrap event {event_number} retriggered"
            );

            rt.eval(&inp);
            assert!(rt.slab[cue_slot] < 0.99, "cue envelope decayed");
            assert!(rt.slab[wrap_slot] < 0.99, "loop wrap envelope decayed");
        }
    }

    #[test]
    fn set_param_applies_without_recompile() {
        let doc = PatchDoc {
            nodes: vec![
                node("s", "slider"),
                node("tint", "colorize"),
                node("o", "output"),
            ],
            edges: vec![
                edge("s", "out", "tint", "in"),
                edge("tint", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let slot = rt
            .prog
            .slots
            .iter()
            .find(|s| s.param.is_none())
            .unwrap()
            .slot;
        rt.eval(&inputs(&audio));
        assert_eq!(rt.slab[slot], 0.5, "slider default");
        rt.set_param("s", "value", 0.9);
        rt.eval(&inputs(&audio));
        assert_eq!(rt.slab[slot], 0.9, "live param change reached the slab");
    }

    #[test]
    fn lfo_chain_through_math_and_smooth_settles() {
        let doc = PatchDoc {
            nodes: vec![
                node("lfo", "lfo"),
                node("m", "scalar_math"),
                node("sm", "smooth"),
                node("tint", "colorize"),
                node("o", "output"),
            ],
            edges: vec![
                edge("lfo", "out", "m", "a"),
                edge("m", "out", "sm", "in"),
                edge("sm", "out", "tint", "in"),
                edge("tint", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let mut last = 0.0;
        for _ in 0..50 {
            rt.eval(&inputs(&audio));
            let slot = rt
                .prog
                .slots
                .iter()
                .find(|s| s.param.is_none())
                .unwrap()
                .slot;
            last = rt.slab[slot];
        }
        assert!(
            (0.0..=1.0).contains(&last),
            "smoothed LFO stays in range: {last}"
        );
    }
}
