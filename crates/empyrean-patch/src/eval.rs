//! Control-rate evaluation: Scalar/Event nodes run here on the CPU every
//! frame, in the engine thread, and their results land in the GPU parameter
//! slab laid out by codegen. All time integration (LFO phases, `rate` params)
//! honors master speed, matching the layer stack's phase behavior — and like
//! layer phases, integration state lives here so live edits never cause
//! visual discontinuities.

use super::PatchDoc;
use super::codegen::Program;
use super::registry::{self, ParamKind};
use crate::abi::{AudioUniform, MAX_AUDIO_SOURCES};
use crate::effects::{EffectCfg, EffectKind};
use crate::touch::{FingerState, TouchView};
use std::collections::HashMap;
use std::f32::consts::TAU;

/// PRO DJ LINK event indices into [`DjLinkInputs::event_seq`]; the order
/// matches the Dj Link node's event outputs.
pub const DJ_EVENT_PLAY: usize = 0;
pub const DJ_EVENT_CUE: usize = 1;
pub const DJ_EVENT_CUE_RELEASE: usize = 2;
pub const DJ_EVENT_ON_AIR: usize = 3;
pub const DJ_EVENT_OFF_AIR: usize = 4;
pub const DJ_EVENT_LOOP_START: usize = 5;
pub const DJ_EVENT_LOOP_WRAP: usize = 6;
pub const DJ_EVENT_LOOP_END: usize = 7;
pub const DJ_EVENT_JUMP: usize = 8;
pub const DJ_EVENT_PHRASE: usize = 9;
pub const DJ_EVENT_FILL: usize = 10;
pub const DJ_EVENT_COUNT: usize = 11;

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
    /// Raw touches this frame (composition frame), for the Touch node.
    pub touch: &'a TouchView,
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
    /// Completed cycles through Start→End (time), for its `wrap` event.
    cycle: i64,
    /// Last seen touchdown / release counts and held-finger count (touch);
    /// MAX = not yet initialized, so touches already under way never fire.
    prev_downs: u64,
    prev_ups: u64,
    prev_held: usize,
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
            cycle: 0,
            prev_downs: u64::MAX,
            prev_ups: u64::MAX,
            prev_held: 0,
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
    /// One-shot effects emitted by Event effect nodes during the latest eval,
    /// with each node's `effects::effect_source`.
    emitted_effects: Vec<(EffectCfg, u32)>,
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
            emitted_effects: Vec::new(),
        }
    }

    /// Carry `old`'s running state into this (rebuilt) runtime, so an edit
    /// never makes the pattern jump: every node that still exists (same id
    /// and kind) keeps its CPU state (Time/LFO phases, smoothing, envelopes,
    /// event counters) and last outputs, and every integrated slab slot whose
    /// node and param still exist keeps its accumulated phase. New nodes start
    /// fresh; removed ones are dropped.
    pub fn adopt_state(&mut self, old: &Runtime) {
        let old_index: HashMap<(&str, &str), usize> = old
            .doc
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| ((n.id.as_str(), n.kind.as_str()), i))
            .collect();
        let map: Vec<Option<usize>> = self
            .doc
            .nodes
            .iter()
            .map(|n| old_index.get(&(n.id.as_str(), n.kind.as_str())).copied())
            .collect();
        for (i, j) in map.iter().enumerate() {
            if let Some(j) = *j {
                self.state[i] = old.state[j].clone();
                self.outputs[i] = old.outputs[j].clone();
            }
        }
        for (k, slot) in self.prog.slots.iter().enumerate() {
            if !slot.integrate {
                continue;
            }
            let Some(j) = map[slot.node] else { continue };
            if let Some(ok) = old
                .prog
                .slots
                .iter()
                .position(|s| s.integrate && s.node == j && s.param == slot.param)
            {
                self.slot_acc[k] = old.slot_acc[ok];
            }
        }
    }

    /// The document this runtime evaluates.
    pub fn doc(&self) -> &PatchDoc {
        &self.doc
    }

    /// Drain effects emitted by the most recent frame. Keeping this separate
    /// from `effect_seq` prevents an Event effect from recursively firing Tap.
    pub fn take_emitted_effects(&mut self) -> Vec<(EffectCfg, u32)> {
        std::mem::take(&mut self.emitted_effects)
    }

    /// A CPU node's output as of the latest `eval`, for the mini-preview
    /// amplitude meters. Unknown node/port reads as 0 (a node that has not
    /// evaluated yet is indistinguishable from one outputting zero, which is
    /// exactly what a meter should show).
    pub fn scalar_value(&self, node: usize, port: &str) -> f32 {
        self.outputs
            .get(node)
            .and_then(|o| o.get(port))
            .copied()
            .unwrap_or(0.0)
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
        match self.prog.wires.get(&(node, port.to_string())) {
            // A wired value is not held to the knob's range: that range is the
            // slider's, and clamping it froze `time` → Rotate after one turn.
            // Nodes that need a hard limit apply it themselves.
            Some((from, from_port)) => {
                let raw = self.outputs[*from].get(from_port).copied().unwrap_or(0.0);
                let fallback = registry::lookup(&self.doc.nodes[node].kind)
                    .and_then(|ty| ty.param(port))
                    .map_or(0.0, |def| def.default);
                finite_or(raw, fallback)
            }
            None => self.param(node, port),
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
        self.emitted_effects.clear();
        let dt = finite_or(inp.dt, 0.0).clamp(0.0, 0.5);
        let ms = finite_or(inp.master_speed, 0.0).max(0.0);

        for i in 0..self.prog.cpu_order.len() {
            let node = self.prog.cpu_order[i];
            self.events[node].clear();
            let kind = self.doc.nodes[node].kind.clone();
            match kind.as_str() {
                "time" => {
                    let rate = self.input(node, "rate");
                    let running = self.input(node, "running") > 0.5;
                    let start = self.input(node, "start") as f64;
                    let span = self.input(node, "end") as f64 - start;
                    let mode = self.param(node, "mode").round() as u32;
                    let reset = self.event_fired(node, "reset");
                    let st = &mut self.state[node];
                    if reset {
                        st.acc = 0.0;
                        st.cycle = 0;
                    }
                    if running {
                        st.acc += (rate * ms * dt) as f64;
                    }
                    // Elapsed in units of the Start→End span.
                    let k = if span != 0.0 { st.acc / span } else { 0.0 };
                    let cycle = k.floor() as i64;
                    let f = k - k.floor();
                    let (value, phase) = match mode {
                        // loop
                        1 => (start + span * f, f),
                        // ping-pong
                        2 => {
                            let p = if cycle.rem_euclid(2) == 0 { f } else { 1.0 - f };
                            (start + span * p, p)
                        }
                        // once
                        3 => {
                            let p = k.clamp(0.0, 1.0);
                            (start + span * p, p)
                        }
                        // forever (the original Time)
                        _ => (start + st.acc, f),
                    };
                    let wrapped = if span == 0.0 {
                        false
                    } else if mode == 3 {
                        // Arrived at End (or back at Start, running backwards).
                        let done = k >= 1.0 || k < 0.0;
                        let was = st.cycle != 0;
                        st.cycle = i64::from(done);
                        done && !was
                    } else {
                        let w = cycle != st.cycle && !reset;
                        st.cycle = cycle;
                        w
                    };
                    if wrapped {
                        self.events[node].push("wrap");
                    }
                    let o = &mut self.outputs[node];
                    o.insert("out".into(), value as f32);
                    o.insert("phase".into(), phase as f32);
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
                "touch" => {
                    let view = inp.touch;
                    let first = self.param(node, "follow").round() as u32 == 1;
                    let held = view.held_count();
                    let followed: Option<FingerState> = {
                        let live = view.fingers.iter().filter(|f| f.held);
                        let pick = if first {
                            live.min_by_key(|f| f.seq)
                        } else {
                            live.max_by_key(|f| f.seq)
                        };
                        pick.copied().or(view.last)
                    };
                    let st = &mut self.state[node];
                    if st.prev_downs != u64::MAX {
                        let downs = view.downs > st.prev_downs;
                        let ups = view.ups > st.prev_ups;
                        if first {
                            // The first finger lands / the last one lifts. A
                            // whole tap inside one frame still gives both.
                            if downs && st.prev_held == 0 {
                                self.events[node].push("down");
                            }
                            if ups && held == 0 {
                                self.events[node].push("up");
                            }
                        } else {
                            if downs {
                                self.events[node].push("down");
                            }
                            if ups {
                                self.events[node].push("up");
                            }
                        }
                    }
                    st.prev_downs = view.downs;
                    st.prev_ups = view.ups;
                    st.prev_held = held;
                    let f = followed.unwrap_or_default();
                    let o = &mut self.outputs[node];
                    o.insert("active".into(), f32::from(followed.is_some_and(|f| f.held)));
                    o.insert("count".into(), held as f32);
                    o.insert("angle".into(), f.angle);
                    o.insert("radius".into(), f.radius);
                    o.insert("x".into(), f.x);
                    o.insert("y".into(), f.y);
                    o.insert("held".into(), f.held_for);
                    o.insert("speed".into(), f.speed);
                    o.insert("dir".into(), f.dir);
                    o.insert("hue".into(), if followed.is_some() { f.hue } else { -1.0 });
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
                "event_effect" => {
                    if self.event_fired(node, "trigger") {
                        // Select value zero is None; the remaining values are
                        // deliberately the stable EffectKind::ALL order.
                        let selected = self.param(node, "effect").round() as usize;
                        if let Some(kind) = selected
                            .checked_sub(1)
                            .and_then(|i| EffectKind::ALL.get(i))
                            .copied()
                        {
                            let source = crate::effects::effect_source(&self.doc.nodes[node].id);
                            self.emitted_effects.push((EffectCfg {
                                kind,
                                angle: self.input(node, "angle"),
                                radius: self.input(node, "radius"),
                                intensity: self.input(node, "intensity"),
                                size: self.input(node, "size"),
                                hue: self.input(node, "hue"),
                                saturation: self.input(node, "saturation"),
                                brightness: self.input(node, "brightness"),
                                // The one effect field with no limit downstream.
                                duration: self.input(node, "duration").clamp(0.0, 10.0),
                                rotation: self.input(node, "rotation"),
                                grow: self.input(node, "grow"),
                                edge: self.input(node, "edge"),
                                fill: self.input(node, "fill"),
                            }, source));
                        }
                    }
                }
                "scalar_math" => {
                    let a = self.input(node, "a");
                    let b = self.input(node, "b");
                    // Indices are the registry's op list; appended ops never
                    // renumber existing ones (patches store the index).
                    let v = match self.param(node, "op").round() as u32 {
                        0 => a + b,
                        1 => a - b,
                        2 => a * b,
                        3 => a.min(b),
                        4 => a.max(b),
                        5 if b != 0.0 => a / b,
                        5 => 0.0,
                        // Always in [0, b): `time mod 1` loops 0→1 forever,
                        // negative inputs included.
                        6 if b != 0.0 => a.rem_euclid(b),
                        6 => 0.0,
                        7 => a.powf(b),
                        8 => f32::from(a > b),
                        9 => f32::from(a < b),
                        10 => a.abs(),
                        11 => a.floor(),
                        12 => (TAU * a).sin(),
                        13 => (TAU * a).cos(),
                        _ => 0.0,
                    };
                    let v = finite_or(v, 0.0);
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
            // Knob values were range-checked by `param`; wired ones only need
            // to be finite (see `input`). Every shader loop bound is clamped in
            // WGSL, so an out-of-range value can look odd but never hang.
            let v = match (&slot.wired, &slot.param) {
                (Some(_), Some(param)) => {
                    let fallback = registry::lookup(&self.doc.nodes[slot.node].kind)
                        .and_then(|ty| ty.param(param))
                        .map_or(0.0, |def| def.default);
                    finite_or(raw, fallback)
                }
                _ => finite_or(raw, 0.0),
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
    use crate::codegen::compile;
    use crate::{Edge, NodeInst, PatchDoc, PortRef};

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
            touch: &crate::touch::NO_TOUCH,
        }
    }

    #[test]
    fn touch_node_follows_latest_or_first_and_fires_once_per_change() {
        use crate::touch::{TouchColor, TouchInput, TouchPhase, Touches};
        let doc = |follow: f32| PatchDoc {
            nodes: vec![
                NodeInst {
                    id: "t".into(),
                    kind: "touch".into(),
                    params: [("follow".to_string(), follow)].into(),
                    ..Default::default()
                },
                NodeInst {
                    id: "o".into(),
                    kind: "output".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let c = TouchColor::default();
        let at = |id, phase, angle| TouchInput { id, phase, angle, radius: 0.5 };
        for (follow, expect_second_down, expect_angle) in [(0.0, true, 2.0), (1.0, false, 1.0)] {
            let mut rt = runtime(doc(follow));
            let mut t = Touches::new();
            let frame = |t: &Touches, rt: &mut Runtime| {
                let view = t.view(0.0, 0.0);
                let mut inp = inputs(&audio);
                inp.touch = &view;
                rt.eval(&inp);
                rt.events[0].clone()
            };
            assert!(frame(&t, &mut rt).is_empty());
            t.apply(1, 0.0, at(1, TouchPhase::Down, 1.0), c);
            assert_eq!(frame(&t, &mut rt), vec!["down"]);
            t.apply(1, 0.0, at(2, TouchPhase::Down, 2.0), c);
            assert_eq!(frame(&t, &mut rt).contains(&"down"), expect_second_down);
            assert_eq!(rt.scalar_value(0, "angle"), expect_angle);
            assert_eq!(rt.scalar_value(0, "count"), 2.0);
            t.apply(1, 0.0, at(1, TouchPhase::Up, 1.0), c);
            t.apply(1, 0.0, at(2, TouchPhase::Up, 2.0), c);
            assert_eq!(frame(&t, &mut rt), vec!["up"], "follow {follow}");
            assert_eq!(rt.scalar_value(0, "active"), 0.0);
        }
    }

    /// Reported 2026-10-15: `time` wired into Transform's Rotate spun once and
    /// stopped, because wired values were clamped to the knob's range (Rotate
    /// is ±1 turn; Math's operands were ±8). Wired values now pass through.
    #[test]
    fn wired_values_are_not_held_to_the_knob_range() {
        let doc: PatchDoc = serde_json::from_value(serde_json::json!({
            "nodes": [
                { "id": "t", "kind": "time" },
                { "id": "m", "kind": "scalar_math", "params": { "op": 6, "b": 1 } },
                { "id": "n", "kind": "noise_field" },
                { "id": "x", "kind": "transform" },
                { "id": "o", "kind": "output" }
            ],
            "edges": [
                { "from": { "node": "t", "port": "out" }, "to": { "node": "x", "port": "rotate" } },
                { "from": { "node": "t", "port": "out" }, "to": { "node": "m", "port": "a" } },
                { "from": { "node": "n", "port": "out" }, "to": { "node": "x", "port": "in" } },
                { "from": { "node": "x", "port": "out" }, "to": { "node": "o", "port": "in" } }
            ]
        }))
        .unwrap();
        let rotate_slot = {
            let prog = compile(&doc).unwrap();
            prog.slots
                .iter()
                .find(|s| s.param.as_deref() == Some("rotate"))
                .unwrap()
                .slot
        };
        let mut rt = runtime(doc);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        // dt is clamped to 0.5 s per frame; 25 s of time.
        let mut inp = inputs(&audio);
        inp.dt = 0.5;
        let mut rotate = 0.0;
        for _ in 0..50 {
            rotate = rt.eval(&inp)[rotate_slot];
        }
        assert!((rotate - 25.0).abs() < 1e-3, "Rotate keeps turning: {rotate}");
        let wrapped = rt.scalar_value(1, "out");
        assert!((0.0..1.0).contains(&wrapped), "time mod 1 stays in 0..1: {wrapped}");
        assert!(wrapped.abs() < 1e-3, "25 mod 1 = 0 (time past Math's ±8 knob range)");
    }

    #[test]
    fn math_ops() {
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let eval_op = |op: f32, a: f32, b: f32| {
            let doc: PatchDoc = serde_json::from_value(serde_json::json!({
                "nodes": [
                    { "id": "m", "kind": "scalar_math", "params": { "op": op, "a": a, "b": b } },
                    { "id": "o", "kind": "output" }
                ]
            }))
            .unwrap();
            let mut rt = runtime(doc);
            rt.eval(&inputs(&audio));
            rt.scalar_value(0, "out")
        };
        assert_eq!(eval_op(5.0, 3.0, 2.0), 1.5);
        assert_eq!(eval_op(5.0, 3.0, 0.0), 0.0, "divide by zero is 0, not inf");
        assert_eq!(eval_op(6.0, -0.25, 1.0), 0.75, "modulo wraps negatives into 0..b");
        assert_eq!(eval_op(7.0, 2.0, 3.0), 8.0);
        assert_eq!(eval_op(8.0, 2.0, 1.0), 1.0);
        assert_eq!(eval_op(9.0, 2.0, 1.0), 0.0);
        assert_eq!(eval_op(10.0, -2.5, 0.0), 2.5);
        assert_eq!(eval_op(11.0, -2.5, 0.0), -3.0);
        assert!((eval_op(12.0, 0.25, 0.0) - 1.0).abs() < 1e-6, "sine takes turns");
        assert!((eval_op(13.0, 0.5, 0.0) + 1.0).abs() < 1e-6, "cosine takes turns");
    }

    /// Reported 2026-10-15: any edit reset the timer and the pattern jumped.
    #[test]
    fn a_rebuilt_runtime_keeps_running_state() {
        let doc: PatchDoc = serde_json::from_value(serde_json::json!({
            "nodes": [
                { "id": "t", "kind": "time" },
                { "id": "n", "kind": "noise_field" },
                { "id": "o", "kind": "output" }
            ],
            "edges": [
                { "from": { "node": "t", "port": "out" }, "to": { "node": "n", "port": "threshold" } },
                { "from": { "node": "n", "port": "out" }, "to": { "node": "o", "port": "in" } }
            ]
        }))
        .unwrap();
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let mut inp = inputs(&audio);
        inp.dt = 0.5;
        let mut old = runtime(doc.clone());
        for _ in 0..10 {
            old.eval(&inp);
        }
        let time_before = old.scalar_value(0, "out");
        let speed_slot = old.prog.slots.iter().position(|s| s.param.as_deref() == Some("speed")).unwrap();
        let phase_before = old.slot_acc[speed_slot];
        assert!(time_before > 4.0 && phase_before > 1.0);

        // A structural edit: a new node is added in front.
        let mut edited = doc;
        edited.nodes.insert(0, NodeInst { id: "new".into(), kind: "lfo".into(), ..Default::default() });
        let mut rebuilt = runtime(edited);
        rebuilt.adopt_state(&old);
        rebuilt.eval(&inp);
        let t = rebuilt.doc.nodes.iter().position(|n| n.id == "t").unwrap();
        assert!((rebuilt.scalar_value(t, "out") - (time_before + 0.5)).abs() < 1e-4, "time carries on");
        let k = rebuilt.prog.slots.iter().position(|s| s.param.as_deref() == Some("speed")).unwrap();
        assert!(rebuilt.slot_acc[k] > phase_before, "the noise phase carries on");
    }

    #[test]
    fn time_modes() {
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let run = |params: serde_json::Value, steps: usize| {
            let doc: PatchDoc = serde_json::from_value(serde_json::json!({
                "nodes": [ { "id": "t", "kind": "time", "params": params }, { "id": "o", "kind": "output" } ]
            }))
            .unwrap();
            let mut rt = runtime(doc);
            let mut inp = inputs(&audio);
            inp.dt = 0.25;
            let mut wraps = 0;
            for _ in 0..steps {
                rt.eval(&inp);
                wraps += rt.events[0].iter().filter(|e| **e == "wrap").count();
            }
            (rt.scalar_value(0, "out"), rt.scalar_value(0, "phase"), wraps)
        };
        // 2.5 s at rate 1.
        let (v, _, _) = run(serde_json::json!({}), 10);
        assert!((v - 2.5).abs() < 1e-5, "default is the old Time: {v}");
        let (v, p, w) = run(serde_json::json!({ "mode": 1, "start": 0, "end": 1 }), 10);
        assert!((v - 0.5).abs() < 1e-5 && (p - 0.5).abs() < 1e-5 && w == 2, "loop {v} {p} {w}");
        let (v, _, w) = run(serde_json::json!({ "mode": 2, "start": 10, "end": 12 }), 10);
        assert!((v - 11.5).abs() < 1e-5 && w == 1, "ping-pong at 1.25 of 2: {v} {w}");
        let (v, _, w) = run(serde_json::json!({ "mode": 2, "start": 0, "end": 1 }), 6);
        assert!((v - 0.5).abs() < 1e-5 && w == 1, "ping-pong coming back: {v} {w}");
        let (v, p, w) = run(serde_json::json!({ "mode": 3, "start": 0, "end": 2 }), 12);
        assert!(v == 2.0 && p == 1.0 && w == 1, "once stops at End and fires once: {v} {p} {w}");
        let (v, _, _) = run(serde_json::json!({ "running": 0 }), 10);
        assert_eq!(v, 0.0, "paused");
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
        inp.dj_link.event_seq[DJ_EVENT_JUMP] = 4;
        rt.eval(&inp);
        rt.eval(&inp);
        assert_eq!(rt.slab[brightness_slot], 0.0, "no startup event");
        assert_eq!(rt.slab[front_slot], 0.75, "continuous LINK state reaches GPU");

        inp.dj_link.event_seq[DJ_EVENT_JUMP] += 1;
        rt.eval(&inp);
        rt.eval(&inp);
        assert!(rt.slab[brightness_slot] > 0.0, "jump fired the envelope");
    }

    #[test]
    fn dj_link_event_effect_emits_the_selected_kind_once() {
        let mut fx = node("fx", "event_effect");
        // None is zero; Ring follows EffectKind::ALL[14].
        fx.params.insert("effect".into(), 15.0);
        fx.params.insert("intensity".into(), 1.7);
        let doc = PatchDoc {
            nodes: vec![
                node("link", "dj_link"),
                fx,
                node("bg", "solid"),
                node("o", "output"),
            ],
            edges: vec![
                edge("link", "loop_wrap", "fx", "trigger"),
                edge("link", "event_side", "fx", "angle"),
                edge("bg", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let mut inp = inputs(&audio);
        inp.dj_link.event_side = -1.0;
        inp.dj_link.event_seq[DJ_EVENT_LOOP_WRAP] = 7;

        rt.eval(&inp);
        assert!(rt.take_emitted_effects().is_empty(), "no startup event");
        inp.dj_link.event_seq[DJ_EVENT_LOOP_WRAP] += 1;
        rt.eval(&inp);
        let emitted = rt.take_emitted_effects();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].0.kind, EffectKind::Ring);
        assert_eq!(emitted[0].0.angle, -1.0, "scalar DJ data can place effects");
        assert_eq!(emitted[0].0.intensity, 1.7);

        rt.eval(&inp);
        assert!(rt.take_emitted_effects().is_empty(), "event fires only once");
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
        inp.dj_link.event_seq[DJ_EVENT_CUE] = 20;
        inp.dj_link.event_seq[DJ_EVENT_LOOP_WRAP] = 30;
        rt.eval(&inp);
        rt.eval(&inp);
        assert_eq!(rt.slab[cue_slot], 0.0, "no startup cue event");
        assert_eq!(rt.slab[wrap_slot], 0.0, "no startup wrap event");

        for event_number in 1..=3 {
            inp.dj_link.event_seq[DJ_EVENT_CUE] += 1;
            inp.dj_link.event_seq[DJ_EVENT_LOOP_WRAP] += 1;
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
