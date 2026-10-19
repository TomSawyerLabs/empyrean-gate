//! Control-rate evaluation: Scalar/Event nodes run here on the CPU every
//! frame, in the engine thread, and their results land in the GPU parameter
//! slab laid out by codegen. All time integration (LFO phases, `rate` params)
//! honors master speed, matching the layer stack's phase behavior — and like
//! layer phases, integration state lives here so live edits never cause
//! visual discontinuities.

use super::codegen::Program;
use super::registry::ParamKind;
use super::script;
use super::{NodeInst, PatchDoc, Shape};
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
    /// The crew's master brightness (0..1) and hue pull (target in turns,
    /// amount 0 while off), read by the Gate globals node.
    pub master_brightness: f32,
    pub master_hue: f32,
    pub master_hue_amount: f32,
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
    /// Event count (counter) or step position (sequence).
    count: i64,
    /// xorshift state (random); 0 = not seeded yet.
    rng: u64,
    /// Random: the value being glided from, the one glided to, and seconds
    /// into the glide.
    from: f32,
    target: f32,
    glide_t: f32,
    /// Latched booleans (toggle, threshold); None = first frame not seen.
    latch: Option<bool>,
    /// Seconds until each pending delayed event fires (delay).
    pending: Vec<f32>,
    /// A Code node's `state.<name>` slots, by name so they survive an edit
    /// that reorders the body's uses of them.
    code_state: HashMap<String, f32>,
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
            count: 0,
            rng: 0,
            from: 0.0,
            target: 0.0,
            glide_t: 0.0,
            latch: None,
            pending: Vec::new(),
            code_state: HashMap::new(),
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
    events: Vec<Vec<String>>,
    /// How many times each event port has fired since the runtime (or the one
    /// it adopted state from) started: what an event's meter shows, since a
    /// one-frame pulse is invisible at the meters' sample rate.
    event_counts: Vec<HashMap<String, u32>>,
    /// One-shot effects emitted by Event effect nodes during the latest eval,
    /// with each node's `effects::effect_source`.
    emitted_effects: Vec<(EffectCfg, u32)>,
    /// The compiled body of every CPU Code node (`None` elsewhere). A
    /// validated document always compiles; a body that somehow does not
    /// simply outputs zeros.
    scripts: Vec<Option<script::Script>>,
}

impl Runtime {
    /// A runtime for `prog`, evaluating the (flattened) document it was
    /// compiled from.
    pub fn new(prog: Program) -> Self {
        let doc = prog.doc.clone();
        let n = doc.nodes.len();
        let slab = vec![0.0; prog.slab_len];
        let slot_acc = vec![0.0; prog.slots.len()];
        let scripts = doc
            .nodes
            .iter()
            .map(|n| {
                n.code()
                    .filter(|_| n.is_cpu())
                    .and_then(|def| script::compile(def).ok())
            })
            .collect();
        Self {
            doc,
            prog,
            state: vec![NodeState::default(); n],
            slot_acc,
            slab,
            outputs: vec![HashMap::new(); n],
            events: vec![Vec::new(); n],
            event_counts: vec![HashMap::new(); n],
            emitted_effects: Vec::new(),
            scripts,
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
                self.event_counts[i] = old.event_counts[j].clone();
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
    /// exactly what a meter should show), except a Code node's live value
    /// (`@…`, `script::Script::probe_keys`) that has none yet: NaN, so the
    /// editor shows nothing rather than a 0 the body never computed.
    pub fn scalar_value(&self, node: usize, port: &str) -> f32 {
        if let Some(v) = self.outputs.get(node).and_then(|o| o.get(port)) {
            return *v;
        }
        let none = if port.starts_with('@') { f32::NAN } else { 0.0 };
        // An event port: its meter value is the running count of fires.
        self.event_counts
            .get(node)
            .and_then(|c| c.get(port))
            .map_or(none, |&n| n as f32)
    }

    /// Apply a live param change (exposed-param play surface) without any
    /// recompile — the next `eval` picks the value up from the doc.
    pub fn set_param(&mut self, node_id: &str, param: &str, value: f32) {
        // A knob of a sub-patch node lives on an inlined inner node.
        let (node_id, param) = match self
            .prog
            .aliases
            .get(&(node_id.to_string(), param.to_string()))
        {
            Some((n, p)) => (n.as_str(), p.as_str()),
            None => (node_id, param),
        };
        if let Some(n) = self.doc.nodes.iter_mut().find(|n| n.id == node_id)
            && has_param(n, param)
        {
            let v = sanitize(n, param, value);
            n.params.insert(param.to_string(), v);
        }
    }

    fn param(&self, node: usize, param: &str) -> f32 {
        let inst = &self.doc.nodes[node];
        if !has_param(inst, param) {
            return 0.0;
        }
        sanitize(inst, param, inst.param(param))
    }

    /// A CPU node's input: the wired upstream output, else the knob value.
    fn input(&self, node: usize, port: &str) -> f32 {
        match self.prog.wires.get(&(node, port.to_string())) {
            // A wired value is not held to the knob's range: that range is the
            // slider's, and clamping it froze `time` → Rotate after one turn.
            // Nodes that need a hard limit apply it themselves.
            Some((from, from_port)) => {
                let raw = self.outputs[*from].get(from_port).copied().unwrap_or(0.0);
                let fallback = self.doc.nodes[node].knob(port).map_or(0.0, |k| k.default);
                finite_or(raw, fallback)
            }
            None => self.param(node, port),
        }
    }

    fn event_fired(&self, node: usize, port: &str) -> bool {
        match self.prog.wires.get(&(node, port.to_string())) {
            Some((from, from_port)) => self.events[*from].iter().any(|p| p == from_port),
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
            // Random runs the body of its mode (see `registry::body`).
            let kind = crate::registry::body(&self.doc.nodes[node].kind, |p| self.param(node, p)).to_string();
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
                        self.events[node].push("wrap".into());
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
                        self.events[node].push("beat".into());
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
                "globals" => {
                    let o = &mut self.outputs[node];
                    o.insert(
                        "brightness".into(),
                        finite_or(inp.master_brightness, 1.0).clamp(0.0, 1.0),
                    );
                    o.insert("speed".into(), ms);
                    o.insert("hue".into(), finite_or(inp.master_hue, 0.0).rem_euclid(1.0));
                    o.insert(
                        "hue_amount".into(),
                        finite_or(inp.master_hue_amount, 0.0).clamp(0.0, 1.0),
                    );
                }
                "tap" => {
                    let st = &mut self.state[node];
                    if st.prev_seq != u64::MAX && inp.effect_seq > st.prev_seq {
                        self.events[node].push("tap".into());
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
                                self.events[node].push("down".into());
                            }
                            if ups && held == 0 {
                                self.events[node].push("up".into());
                            }
                        } else {
                            if downs {
                                self.events[node].push("down".into());
                            }
                            if ups {
                                self.events[node].push("up".into());
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
                            self.events[node].push((*port).into());
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
                "map_range" => {
                    let x = self.input(node, "in");
                    let a = self.input(node, "in_min");
                    let b = self.input(node, "in_max");
                    let c = self.input(node, "out_min");
                    let d = self.input(node, "out_max");
                    let t = if (b - a).abs() < 1e-9 { 0.0 } else { (x - a) / (b - a) };
                    let mut v = c + (d - c) * t;
                    if self.param(node, "clamp").round() as u32 == 1 {
                        v = v.clamp(c.min(d), c.max(d));
                    }
                    self.outputs[node].insert("out".into(), finite_or(v, 0.0));
                }
                "mix" => {
                    let a = self.input(node, "a");
                    let b = self.input(node, "b");
                    let t = self.input(node, "t");
                    self.outputs[node].insert("out".into(), finite_or(a + (b - a) * t, 0.0));
                }
                "clamp" => {
                    let x = self.input(node, "in");
                    let lo = self.input(node, "min");
                    let hi = self.input(node, "max");
                    self.outputs[node].insert("out".into(), x.clamp(lo.min(hi), lo.max(hi)));
                }
                "random" => {
                    let rate = self.input(node, "rate").max(0.0);
                    let lo = self.input(node, "min");
                    let hi = self.input(node, "max");
                    let glide = self.input(node, "glide").max(0.0);
                    let trigger = self.event_fired(node, "trigger");
                    let seed = seed_from_id(&self.doc.nodes[node].id);
                    let st = &mut self.state[node];
                    // The value as of the previous frame, to glide from.
                    let current = |st: &NodeState| {
                        if glide <= 1e-4 || st.glide_t >= glide {
                            st.target
                        } else {
                            st.from + (st.target - st.from) * (st.glide_t / glide)
                        }
                    };
                    let mut fire = trigger;
                    if st.rng == 0 {
                        // First frame: start on a value, silently.
                        st.rng = seed;
                        st.target = lo + (hi - lo) * next_unit(&mut st.rng);
                        st.from = st.target;
                        st.glide_t = glide;
                    }
                    if rate > 0.0 {
                        st.acc += (rate * ms * dt) as f64;
                        if st.acc >= 1.0 {
                            st.acc = st.acc.fract();
                            fire = true;
                        }
                    }
                    if fire {
                        st.from = current(st);
                        st.target = lo + (hi - lo) * next_unit(&mut st.rng);
                        st.glide_t = 0.0;
                        self.events[node].push("changed".into());
                    } else {
                        st.glide_t += dt;
                    }
                    let v = current(st);
                    self.outputs[node].insert("out".into(), finite_or(v, 0.0));
                }
                "full_random" => {
                    let lo = self.input(node, "min");
                    let hi = self.input(node, "max");
                    let bell = self.param(node, "distribution").round() as u32 == 1;
                    let seed = seed_from_id(&self.doc.nodes[node].id);
                    let st = &mut self.state[node];
                    if st.rng == 0 {
                        st.rng = seed;
                    }
                    let u = if bell {
                        // ±3 standard deviations span the range.
                        (0.5 + next_gauss(&mut st.rng) / 6.0).clamp(0.0, 1.0)
                    } else {
                        next_unit(&mut st.rng)
                    };
                    self.outputs[node].insert("out".into(), finite_or(lo + (hi - lo) * u, 0.0));
                }
                "random_walk" => {
                    let wander = self.input(node, "wander").max(0.0);
                    let jump = self.input(node, "jump").max(0.0);
                    let pull = self.input(node, "pull").max(0.0);
                    let (a, b) = (self.input(node, "min"), self.input(node, "max"));
                    let (lo, hi) = (a.min(b), a.max(b));
                    let edges = self.param(node, "edges").round() as u32;
                    let step = self.event_fired(node, "step");
                    let reset = self.event_fired(node, "reset");
                    let seed = seed_from_id(&self.doc.nodes[node].id);
                    let st = &mut self.state[node];
                    let span = hi - lo;
                    let mid = lo + span * 0.5;
                    // The first frame and a reset show the middle itself.
                    let start = st.rng == 0 || reset;
                    if st.rng == 0 {
                        st.rng = seed;
                    }
                    let t = ms * dt;
                    let mut x = if start { mid } else { finite_or(st.y, mid) };
                    if !start && wander > 0.0 && t > 0.0 {
                        // Brownian: the spread grows with the square root of
                        // time, so the drift per second is frame-rate free.
                        x += next_gauss(&mut st.rng) * wander * span * t.sqrt();
                    }
                    if !start && pull > 0.0 {
                        x -= (x - mid) * (pull * t).min(1.0);
                    }
                    if !start && step {
                        x += (2.0 * next_unit(&mut st.rng) - 1.0) * jump * span;
                    }
                    x = if span <= 0.0 {
                        lo
                    } else {
                        match edges {
                            // Reflect: fold onto 0..2 spans, mirror the far half.
                            0 => {
                                let p = ((x - lo) / span).rem_euclid(2.0);
                                lo + span * if p > 1.0 { 2.0 - p } else { p }
                            }
                            1 => lo + (x - lo).rem_euclid(span),
                            _ => x.clamp(lo, hi),
                        }
                    };
                    st.y = finite_or(x, mid);
                    let y = st.y;
                    self.outputs[node].insert("out".into(), y);
                }
                "smooth_noise" => {
                    let speed = self.input(node, "speed").max(0.0);
                    let harmonics = self.input(node, "harmonics").round().clamp(1.0, 8.0) as u32;
                    let roughness = self.input(node, "roughness").clamp(0.0, 1.0);
                    let spacing = self.input(node, "spacing").clamp(1.0, 8.0);
                    let lo = self.input(node, "min");
                    let hi = self.input(node, "max");
                    let base = noise_offset(&self.doc.nodes[node].id);
                    let st = &mut self.state[node];
                    st.acc += f64::from(speed * ms * dt);
                    let v = smooth_noise(st.acc, base, harmonics, roughness, spacing);
                    self.outputs[node].insert("out".into(), finite_or(lo + (hi - lo) * v, 0.0));
                }
                "counter" => {
                    let steps = self.input(node, "steps").round().max(0.0) as i64;
                    let reset = self.event_fired(node, "reset");
                    let count = self.event_fired(node, "count");
                    let st = &mut self.state[node];
                    if reset {
                        st.count = 0;
                    }
                    if count {
                        st.count += 1;
                    }
                    if steps > 0 && st.count >= steps {
                        // Also covers Steps turned down below the count.
                        st.count = 0;
                        if count {
                            self.events[node].push("wrap".into());
                        }
                    }
                    let n = st.count;
                    let o = &mut self.outputs[node];
                    o.insert("out".into(), n as f32);
                    o.insert(
                        "phase".into(),
                        if steps > 0 { n as f32 / steps as f32 } else { 0.0 },
                    );
                }
                "toggle" => {
                    let initial = self.param(node, "initial").round() as u32 == 1;
                    let flip = self.event_fired(node, "toggle");
                    let set = self.event_fired(node, "set");
                    let clear = self.event_fired(node, "clear");
                    let st = &mut self.state[node];
                    let was = *st.latch.get_or_insert(initial);
                    let mut now = was;
                    if flip {
                        now = !now;
                    }
                    if set {
                        now = true;
                    }
                    if clear {
                        now = false;
                    }
                    if now != was {
                        self.events[node].push((if now { "on" } else { "off" }).into());
                    }
                    st.latch = Some(now);
                    self.outputs[node].insert("out".into(), f32::from(now));
                }
                "threshold" => {
                    let x = self.input(node, "in");
                    let level = self.input(node, "level");
                    let half = self.input(node, "hysteresis").max(0.0) * 0.5;
                    let st = &mut self.state[node];
                    let now = match st.latch {
                        Some(true) => x >= level - half,
                        Some(false) => x > level + half,
                        None => x > level,
                    };
                    if let Some(was) = st.latch
                        && was != now
                    {
                        self.events[node].push((if now { "rise" } else { "fall" }).into());
                    }
                    st.latch = Some(now);
                    self.outputs[node].insert("out".into(), f32::from(now));
                }
                "delay" => {
                    let seconds = self.input(node, "seconds").max(0.0);
                    let echoes = self.input(node, "echoes").round().clamp(0.0, 16.0) as usize;
                    let arrived = self.event_fired(node, "in");
                    let st = &mut self.state[node];
                    let mut fire = false;
                    for t in &mut st.pending {
                        *t -= dt;
                    }
                    st.pending.retain(|t| {
                        let due = *t <= 0.0;
                        fire |= due;
                        !due
                    });
                    if arrived {
                        for k in 1..=(echoes + 1) {
                            let at = seconds * k as f32;
                            if at <= 1e-4 {
                                fire = true;
                            } else if st.pending.len() < MAX_PENDING_EVENTS {
                                st.pending.push(at);
                            }
                        }
                    }
                    if fire {
                        self.events[node].push("out".into());
                    }
                }
                "event_merge" => {
                    let open = self.input(node, "open") > 0.5;
                    if open && ["a", "b", "c", "d"].iter().any(|p| self.event_fired(node, p)) {
                        self.events[node].push("out".into());
                    }
                }
                "sequence" => {
                    let steps = (self.input(node, "steps").round() as i64).clamp(1, 8);
                    let reset = self.event_fired(node, "reset");
                    let step = self.event_fired(node, "step");
                    let index = {
                        let st = &mut self.state[node];
                        if reset {
                            st.count = 0;
                        }
                        if step {
                            st.count += 1;
                        }
                        if st.count >= steps {
                            st.count = 0;
                            if step {
                                self.events[node].push("wrap".into());
                            }
                        }
                        st.count
                    };
                    let v = self.input(node, &format!("v{}", index + 1));
                    let o = &mut self.outputs[node];
                    o.insert("out".into(), v);
                    o.insert("index".into(), index as f32);
                }
                "code" => {
                    // The body sees its inputs (a Scalar's wire or knob, an
                    // Event's "fired this frame"), runs with its persistent
                    // slots, and hands back one value per output.
                    let Some(def) = self.doc.nodes[node].code() else { continue };
                    let Some(script) = self.scripts[node].as_ref() else { continue };
                    let inputs: Vec<script::Value> = def
                        .inputs
                        .iter()
                        .map(|p| match p.shape {
                            Shape::Event => script::Value::Bool(self.event_fired(node, &p.name)),
                            _ => script::Value::Num(self.input(node, &p.name)),
                        })
                        .collect();
                    let names = script.state_names();
                    let mut state: Vec<f32> = names
                        .iter()
                        .map(|n| self.state[node].code_state.get(n).copied().unwrap_or(0.0))
                        .collect();
                    let mut probes = Vec::new();
                    let outputs = script.run_probed(&inputs, dt, ms, &mut state, Some(&mut probes));
                    let st = &mut self.state[node];
                    for (name, v) in names.iter().zip(state) {
                        st.code_state.insert(name.clone(), finite_or(v, 0.0));
                    }
                    // What the editor shows beside the body: a value per
                    // `let`/`var`/`state.` under its probe key, read like any
                    // output by the meters (`preview_scalars`). A local this
                    // frame did not reach keeps its last value.
                    for (key, v) in script.probe_keys().zip(probes) {
                        if let Some(v) = v {
                            self.outputs[node].insert(key.to_string(), finite_or(v, 0.0));
                        }
                    }
                    for (p, v) in def.outputs.iter().zip(outputs) {
                        match p.shape {
                            Shape::Event => {
                                if v.truth() {
                                    self.events[node].push(p.name.clone());
                                }
                            }
                            _ => {
                                self.outputs[node].insert(p.name.clone(), finite_or(v.num(), 0.0));
                            }
                        }
                    }
                }
                _ => {}
            }
            for port in &self.events[node] {
                *self.event_counts[node].entry(port.clone()).or_insert(0) += 1;
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
                    let fallback = self.doc.nodes[slot.node].knob(param).map_or(0.0, |k| k.default);
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

/// Delayed events a Delay node holds at once (echoes included).
const MAX_PENDING_EVENTS: usize = 64;

/// FNV-1a of a node id, never zero: the Random node's seed.
fn seed_from_id(id: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in id.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h.max(1)
}

/// xorshift64*: the next value in [0, 1).
fn next_unit(rng: &mut u64) -> f32 {
    let mut x = *rng;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    *rng = x;
    (x.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 40) as f32 / (1u64 << 24) as f32
}

/// A standard normal draw (Box–Muller), from two xorshift values.
fn next_gauss(rng: &mut u64) -> f32 {
    // 1 - u keeps the log's argument in (0, 1].
    let u1 = 1.0 - next_unit(rng);
    let u2 = next_unit(rng);
    (-2.0 * u1.ln()).sqrt() * (TAU * u2).cos()
}

/// Where a Smooth noise node starts in the noise: a whole number from its
/// id, so two nodes wander differently and "Convert to Code" can bake the
/// same number into the body.
pub(crate) fn noise_offset(id: &str) -> f32 {
    (seed_from_id(id) % 1000) as f32
}

/// Lattice points per harmonic before the gradients repeat. Keeps the hash's
/// argument small enough for f32 `sin` however long the gate runs.
pub(crate) const NOISE_PERIOD: f64 = 4096.0;

/// One harmonic of Smooth noise: 1-D Perlin at `x`, about -1..1. The
/// gradient at lattice point `i` is the `fract(sin(i·12.9898)·43758.5453)`
/// hash, in f32 exactly as a Code body computes it.
fn perlin1(x: f64) -> f32 {
    let i = x.floor();
    let f = (x - i) as f32;
    let grad = |i: f64| {
        let i = i.rem_euclid(NOISE_PERIOD) as f32;
        let h = (i * 12.9898).sin() * 43758.5453;
        (h - h.floor()) * 2.0 - 1.0
    };
    let (g0, g1) = (grad(i), grad(i + 1.0));
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    // A 1-D Perlin with slopes in -1..1 peaks at ±0.5.
    2.0 * (g0 * f + (g1 * (f - 1.0) - g0 * f) * u)
}

/// Smooth noise at time `t` (in first-harmonic periods): `harmonics` layers
/// of `perlin1`, each `spacing` times faster and `roughness` times weaker
/// than the one before, offset from each other so they don't line up;
/// normalized to 0..1.
fn smooth_noise(t: f64, base: f32, harmonics: u32, roughness: f32, spacing: f32) -> f32 {
    let mut sum = 0.0;
    let mut norm = 0.0;
    let mut amp = 1.0;
    let mut freq = 1.0f64;
    for k in 0..harmonics {
        sum += amp * perlin1(t * freq + f64::from(base) + 17.0 * f64::from(k));
        norm += amp;
        amp *= roughness;
        freq *= f64::from(spacing);
    }
    (0.5 + 0.5 * sum / norm.max(1e-6)).clamp(0.0, 1.0)
}

fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

/// Whether `name` is something this node stores a value for: a knob, or a
/// Select param of a built-in node.
pub fn has_param(node: &NodeInst, name: &str) -> bool {
    node.knob(name).is_some() || node.param_def(name).is_some()
}

/// `value` held to the param's range: a knob's, or a Select's (rounded to
/// an option index).
pub fn sanitize(node: &NodeInst, name: &str, value: f32) -> f32 {
    if let Some(k) = node.knob(name) {
        return finite_or(value, k.default).clamp(k.min, k.max);
    }
    match node.param_def(name) {
        Some(def) => {
            let value = finite_or(value, def.default).clamp(def.min, def.max);
            match def.kind {
                ParamKind::Number => value,
                ParamKind::Select(_) => value.round(),
            }
        }
        None => 0.0,
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
            master_brightness: 1.0,
            master_hue: 0.0,
            master_hue_amount: 0.0,
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
            assert_eq!(frame(&t, &mut rt).iter().any(|e| e == "down"), expect_second_down);
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
                wraps += rt.events[0].iter().filter(|e| e.as_str() == "wrap").count();
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

    /// A doc whose `clock` Time node loops 0→1 at rate 1, so with dt 0.25 its
    /// `wrap` fires every fourth frame: the event source for the tests below.
    fn clocked(extra_nodes: serde_json::Value, extra_edges: serde_json::Value) -> PatchDoc {
        let mut nodes = vec![
            serde_json::json!({ "id": "clock", "kind": "time", "params": { "mode": 1 } }),
            serde_json::json!({ "id": "o", "kind": "output" }),
        ];
        nodes.extend(extra_nodes.as_array().unwrap().iter().cloned());
        serde_json::from_value(serde_json::json!({ "nodes": nodes, "edges": extra_edges })).unwrap()
    }

    fn step(rt: &mut Runtime, audio: &[AudioUniform; MAX_AUDIO_SOURCES]) {
        let mut inp = inputs(audio);
        inp.dt = 0.25;
        rt.eval(&inp);
    }

    fn fired(rt: &Runtime, id: &str, port: &str) -> bool {
        let i = rt.doc.nodes.iter().position(|n| n.id == id).unwrap();
        rt.events[i].iter().any(|p| p == port)
    }

    fn value(rt: &Runtime, id: &str, port: &str) -> f32 {
        let i = rt.doc.nodes.iter().position(|n| n.id == id).unwrap();
        rt.scalar_value(i, port)
    }

    #[test]
    fn map_mix_and_clamp() {
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let one = |kind: &str, params: serde_json::Value| {
            let doc: PatchDoc = serde_json::from_value(serde_json::json!({
                "nodes": [ { "id": "n", "kind": kind, "params": params }, { "id": "o", "kind": "output" } ]
            }))
            .unwrap();
            let mut rt = runtime(doc);
            rt.eval(&inputs(&audio));
            rt.scalar_value(0, "out")
        };
        // 0..1 → 1..3: 0.25 lands at 1.5; past the range it keeps going
        // unless clamped; an inverted out range flips it.
        let map = |x: f32, clamp: f32| {
            one("map_range", serde_json::json!({ "in": x, "out_min": 1, "out_max": 3, "clamp": clamp }))
        };
        assert_eq!(map(0.25, 0.0), 1.5);
        assert_eq!(map(1.5, 0.0), 4.0);
        assert_eq!(map(1.5, 1.0), 3.0);
        assert_eq!(map(-1.0, 1.0), 1.0);
        assert_eq!(
            one("map_range", serde_json::json!({ "in": 0.25, "out_min": 1, "out_max": 0 })),
            0.75
        );
        assert_eq!(
            one("map_range", serde_json::json!({ "in": 3, "in_min": 2, "in_max": 2 })),
            0.0,
            "an empty in range maps to out_min, not inf"
        );
        assert_eq!(one("mix", serde_json::json!({ "a": 2, "b": 4, "t": 0.25 })), 2.5);
        assert_eq!(one("clamp", serde_json::json!({ "in": 1.5 })), 1.0);
        assert_eq!(one("clamp", serde_json::json!({ "in": -1.5 })), 0.0);
        assert_eq!(one("clamp", serde_json::json!({ "in": 0.5, "min": 1, "max": 0 })), 0.5, "swapped bounds still work");
    }

    #[test]
    fn random_samples_on_trigger_deterministically_and_glides() {
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let doc = clocked(
            serde_json::json!([{ "id": "r", "kind": "random", "params": { "min": 2, "max": 4 } }]),
            serde_json::json!([{ "from": { "node": "clock", "port": "wrap" }, "to": { "node": "r", "port": "trigger" } }]),
        );
        let run = |n: usize| {
            let mut rt = runtime(doc.clone());
            let mut seen = Vec::new();
            for _ in 0..n {
                step(&mut rt, &audio);
                if fired(&rt, "r", "changed") {
                    seen.push(value(&rt, "r", "out"));
                }
            }
            (rt, seen)
        };
        let (rt, seen) = run(12);
        assert_eq!(seen.len(), 3, "one new value per clock wrap: {seen:?}");
        assert!(seen.iter().all(|v| (2.0..=4.0).contains(v)), "{seen:?}");
        assert!(seen.windows(2).any(|w| w[0] != w[1]), "values vary: {seen:?}");
        assert!(value(&rt, "r", "out") >= 2.0, "starts on a value, not 0");
        assert_eq!(run(12).1, seen, "same patch, same sequence");

        // With glide, the output eases to the new value over Glide seconds.
        let doc: PatchDoc = serde_json::from_value(serde_json::json!({
            "nodes": [
                { "id": "once", "kind": "time", "params": { "mode": 3 } },
                { "id": "r", "kind": "random", "params": { "glide": 1.0 } },
                { "id": "o", "kind": "output" }
            ],
            "edges": [ { "from": { "node": "once", "port": "wrap" }, "to": { "node": "r", "port": "trigger" } } ]
        }))
        .unwrap();
        let mut rt = runtime(doc);
        let mut trace = Vec::new();
        for _ in 0..9 {
            step(&mut rt, &audio);
            trace.push(value(&rt, "r", "out"));
        }
        // Frames 1-3 hold the start value; the trigger lands on frame 4 and
        // the value eases over frames 5-8, then holds.
        let (start, end) = (trace[0], trace[7]);
        assert_eq!(trace[3], start, "a glide starts where it was: {trace:?}");
        assert!(end != start, "{trace:?}");
        for w in trace[3..8].windows(2) {
            assert!((w[1] - start).abs() > (w[0] - start).abs(), "eases monotonically: {trace:?}");
        }
        assert_eq!(trace[8], end, "holds at the target: {trace:?}");
        // Self-clocked: rate 2 Hz with dt 0.25 fires every other frame.
        let doc = clocked(
            serde_json::json!([{ "id": "r", "kind": "random", "params": { "rate": 2 } }]),
            serde_json::json!([]),
        );
        let mut rt = runtime(doc);
        let mut changes = 0;
        for _ in 0..8 {
            step(&mut rt, &audio);
            changes += usize::from(fired(&rt, "r", "changed"));
        }
        assert_eq!(changes, 4);
    }

    /// Node `n` of `kind` (with `params`, and the clock's `wrap` into each of
    /// `events`) run for `frames` frames at 60 fps: its `out` every frame.
    fn noise_trace(kind: &str, params: serde_json::Value, events: &[&str], frames: usize) -> Vec<f32> {
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let edges: Vec<_> = events
            .iter()
            .map(|e| serde_json::json!({ "from": { "node": "clock", "port": "wrap" }, "to": { "node": "n", "port": e } }))
            .collect();
        let doc = clocked(
            serde_json::json!([{ "id": "n", "kind": kind, "params": params }]),
            serde_json::Value::Array(edges),
        );
        let mut rt = runtime(doc);
        (0..frames)
            .map(|_| {
                let mut inp = inputs(&audio);
                inp.dt = 1.0 / 60.0;
                rt.eval(&inp);
                value(&rt, "n", "out")
            })
            .collect()
    }

    fn mean(v: &[f32]) -> f32 {
        v.iter().sum::<f32>() / v.len() as f32
    }

    fn spread(v: &[f32]) -> f32 {
        let m = mean(v);
        (v.iter().map(|x| (x - m) * (x - m)).sum::<f32>() / v.len() as f32).sqrt()
    }

    #[test]
    fn full_random_is_fresh_every_frame_within_range() {
        let uniform = noise_trace("random", serde_json::json!({ "mode": 1, "min": 2, "max": 4 }), &[], 4000);
        assert!(uniform.iter().all(|v| (2.0..=4.0).contains(v)));
        assert!(uniform.windows(2).all(|w| w[0] != w[1]), "a new value every frame");
        assert!((mean(&uniform) - 3.0).abs() < 0.05, "{}", mean(&uniform));
        // A uniform 2..4 has a standard deviation of 2/√12 ≈ 0.577.
        assert!((spread(&uniform) - 0.577).abs() < 0.03, "{}", spread(&uniform));
        assert_eq!(
            noise_trace("random", serde_json::json!({ "mode": 1, "min": 2, "max": 4 }), &[], 4000),
            uniform,
            "same patch, same sequence"
        );

        let bell = noise_trace("random", serde_json::json!({ "mode": 1, "min": 2, "max": 4, "distribution": 1 }), &[], 4000);
        assert!(bell.iter().all(|v| (2.0..=4.0).contains(v)));
        assert!((mean(&bell) - 3.0).abs() < 0.03, "{}", mean(&bell));
        // ±3σ spans the range: σ = 1/3.
        assert!((spread(&bell) - 1.0 / 3.0).abs() < 0.03, "{}", spread(&bell));
    }

    #[test]
    fn random_walk_wanders_continuously_inside_its_edges() {
        let still = noise_trace("random", serde_json::json!({ "mode": 2, "wander": 0, "min": 2, "max": 4 }), &[], 50);
        assert!(still.iter().all(|&v| v == 3.0), "starts in the middle and, without wander, stays");

        let walk = noise_trace("random", serde_json::json!({ "mode": 2, "wander": 0.3 }), &[], 3000);
        assert!(walk.iter().all(|v| (0.0..=1.0).contains(v)));
        // A walk, not noise: frame-to-frame moves are tiny (σ = 0.3·√(1/60)
        // ≈ 0.04 of the range), but over time it covers ground.
        let biggest = walk.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
        assert!(biggest < 0.2, "{biggest}");
        let (lo, hi) = walk.iter().fold((1.0f32, 0.0f32), |(lo, hi), &v| (lo.min(v), hi.max(v)));
        assert!(hi - lo > 0.4, "it wanders: {lo}..{hi}");
        assert_eq!(noise_trace("random", serde_json::json!({ "mode": 2, "wander": 0.3 }), &[], 3000), walk);

        // Every edge mode holds the range, even wandering hard.
        for edges in 0..3 {
            let wild = noise_trace("random", serde_json::json!({ "mode": 2, "wander": 2, "edges": edges, "min": -1, "max": 1 }), &[], 2000);
            assert!(wild.iter().all(|v| (-1.0..=1.0).contains(v)), "edges {edges}");
        }
        // Wrap jumps across: some frame goes from near one edge to the other.
        let wrap = noise_trace("random", serde_json::json!({ "mode": 2, "wander": 2, "edges": 1 }), &[], 2000);
        assert!(wrap.windows(2).any(|w| (w[1] - w[0]).abs() > 0.5));

        // Pull keeps it nearer the middle.
        let free = noise_trace("random", serde_json::json!({ "mode": 2, "wander": 0.5 }), &[], 6000);
        let pulled = noise_trace("random", serde_json::json!({ "mode": 2, "wander": 0.5, "pull": 4 }), &[], 6000);
        let off = |v: &[f32]| v.iter().map(|x| (x - 0.5).abs()).sum::<f32>() / v.len() as f32;
        assert!(off(&pulled) < off(&free) * 0.7, "pulled {} vs free {}", off(&pulled), off(&free));

        // `step` jumps (the clock wraps every 60 frames here); `reset`
        // returns to the middle.
        let steps = noise_trace("random", serde_json::json!({ "mode": 2, "wander": 0, "jump": 0.3 }), &["step"], 240);
        let moves: Vec<_> = steps.windows(2).filter(|w| w[0] != w[1]).collect();
        assert!(!moves.is_empty() && moves.len() <= 4, "{moves:?}");
        assert!(moves.iter().all(|w| (w[1] - w[0]).abs() <= 0.3 + 1e-6));
        let reset = noise_trace("random", serde_json::json!({ "mode": 2, "wander": 1 }), &["reset"], 240);
        assert!(reset.iter().any(|&v| v == 0.5), "back to the middle on reset");
    }

    #[test]
    fn smooth_noise_is_smooth_deterministic_and_per_node() {
        let a = noise_trace("random", serde_json::json!({ "mode": 3, "speed": 1, "min": -1, "max": 1 }), &[], 1200);
        assert!(a.iter().all(|v| (-1.0..=1.0).contains(v)));
        let biggest = a.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
        assert!(biggest < 0.15, "smooth: {biggest}");
        assert!(spread(&a) > 0.1, "it moves: {}", spread(&a));
        assert_eq!(noise_trace("random", serde_json::json!({ "mode": 3, "speed": 1, "min": -1, "max": 1 }), &[], 1200), a);

        let frozen = noise_trace("random", serde_json::json!({ "mode": 3, "speed": 0 }), &[], 30);
        assert!(frozen.windows(2).all(|w| w[0] == w[1]));

        // More harmonics, more detail: bigger frame-to-frame changes.
        let rough = |harmonics: f32| {
            let v = noise_trace("random", serde_json::json!({ "mode": 3, "speed": 0.5, "harmonics": harmonics, "roughness": 0.8 }), &[], 1200);
            v.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>()
        };
        assert!(rough(6.0) > rough(1.0) * 1.5, "{} vs {}", rough(6.0), rough(1.0));

        // Two nodes, two different wanders.
        assert_ne!(super::noise_offset("n"), super::noise_offset("n2"));
    }

    #[test]
    fn counter_counts_wraps_and_resets() {
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let doc = clocked(
            serde_json::json!([
                { "id": "c", "kind": "counter", "params": { "steps": 3 } },
                { "id": "every3", "kind": "counter", "params": { "steps": 0 } }
            ]),
            serde_json::json!([
                { "from": { "node": "clock", "port": "wrap" }, "to": { "node": "c", "port": "count" } },
                { "from": { "node": "c", "port": "wrap" }, "to": { "node": "every3", "port": "count" } }
            ]),
        );
        let mut rt = runtime(doc);
        let mut counts = Vec::new();
        for _ in 0..28 {
            step(&mut rt, &audio);
            if fired(&rt, "clock", "wrap") {
                counts.push((value(&rt, "c", "out"), value(&rt, "c", "phase"), fired(&rt, "c", "wrap")));
            }
        }
        assert_eq!(
            counts,
            vec![
                (1.0, 1.0 / 3.0, false),
                (2.0, 2.0 / 3.0, false),
                (0.0, 0.0, true),
                (1.0, 1.0 / 3.0, false),
                (2.0, 2.0 / 3.0, false),
                (0.0, 0.0, true),
                (1.0, 1.0 / 3.0, false),
            ]
        );
        assert_eq!(value(&rt, "every3", "out"), 2.0, "wrap is every Nth; never wraps itself");

        let mut with_reset = rt.doc.clone();
        with_reset.edges.push(edge("clock", "wrap", "c", "reset"));
        let mut rt = runtime(with_reset);
        for _ in 0..8 {
            step(&mut rt, &audio);
        }
        assert_eq!(value(&rt, "c", "out"), 1.0, "reset then count in the same frame");
    }

    #[test]
    fn toggle_latches_and_threshold_fires_edges() {
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let doc = clocked(
            serde_json::json!([
                { "id": "t", "kind": "toggle", "params": { "initial": 1 } },
                // The clock itself ramps 0→1: rises past 0.5 then falls back.
                { "id": "th", "kind": "threshold", "params": { "hysteresis": 0.2 } }
            ]),
            serde_json::json!([
                { "from": { "node": "clock", "port": "wrap" }, "to": { "node": "t", "port": "toggle" } },
                { "from": { "node": "clock", "port": "out" }, "to": { "node": "th", "port": "in" } }
            ]),
        );
        let mut rt = runtime(doc);
        let mut log = Vec::new();
        for _ in 0..8 {
            step(&mut rt, &audio);
            log.push((
                value(&rt, "t", "out"),
                fired(&rt, "t", "on"),
                fired(&rt, "t", "off"),
                value(&rt, "th", "out"),
                fired(&rt, "th", "rise"),
                fired(&rt, "th", "fall"),
            ));
        }
        // Clock values per frame: .25 .5 .75 0(wrap) .25 .5 .75 0(wrap).
        // Threshold 0.5 ± 0.1: above once > 0.6, below once < 0.4.
        assert_eq!(
            log,
            vec![
                (1.0, false, false, 0.0, false, false),
                (1.0, false, false, 0.0, false, false),
                (1.0, false, false, 1.0, true, false),
                (0.0, false, true, 0.0, false, true),
                (0.0, false, false, 0.0, false, false),
                (0.0, false, false, 0.0, false, false),
                (0.0, false, false, 1.0, true, false),
                (1.0, true, false, 0.0, false, true),
            ]
        );
    }

    #[test]
    fn delay_echoes_and_merge_gates() {
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let doc = clocked(
            serde_json::json!([
                { "id": "d", "kind": "delay", "params": { "seconds": 0.5, "echoes": 1 } },
                { "id": "m", "kind": "event_merge" },
                { "id": "shut", "kind": "event_merge", "params": { "open": 0 } }
            ]),
            serde_json::json!([
                { "from": { "node": "clock", "port": "wrap" }, "to": { "node": "d", "port": "in" } },
                { "from": { "node": "clock", "port": "wrap" }, "to": { "node": "m", "port": "a" } },
                { "from": { "node": "d", "port": "out" }, "to": { "node": "m", "port": "c" } },
                { "from": { "node": "d", "port": "out" }, "to": { "node": "shut", "port": "b" } }
            ]),
        );
        let mut rt = runtime(doc);
        let mut log = Vec::new();
        for _ in 0..8 {
            step(&mut rt, &audio);
            log.push((fired(&rt, "clock", "wrap"), fired(&rt, "d", "out"), fired(&rt, "m", "out"), fired(&rt, "shut", "out")));
        }
        // Wrap on frame 4 (t = 1.0); delayed 0.5 s → frame 6; echo → frame 8.
        assert_eq!(
            log,
            vec![
                (false, false, false, false),
                (false, false, false, false),
                (false, false, false, false),
                (true, false, true, false),
                (false, false, false, false),
                (false, true, true, false),
                (false, false, false, false),
                (true, true, true, false),
            ]
        );
    }

    #[test]
    fn sequencer_steps_through_its_values() {
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let doc = clocked(
            serde_json::json!([
                { "id": "s", "kind": "sequence", "params": { "steps": 3, "v1": 5, "v2": 6, "v3": 7, "v4": 8 } }
            ]),
            serde_json::json!([
                { "from": { "node": "clock", "port": "wrap" }, "to": { "node": "s", "port": "step" } }
            ]),
        );
        let mut rt = runtime(doc);
        let mut seen = Vec::new();
        step(&mut rt, &audio);
        assert_eq!((value(&rt, "s", "out"), value(&rt, "s", "index")), (5.0, 0.0), "starts on step 1");
        for _ in 0..16 {
            step(&mut rt, &audio);
            if fired(&rt, "clock", "wrap") {
                seen.push((value(&rt, "s", "out"), fired(&rt, "s", "wrap")));
            }
        }
        assert_eq!(seen, vec![(6.0, false), (7.0, false), (5.0, true), (6.0, false)], "step 4 is never reached");
    }

    fn runtime(doc: PatchDoc) -> Runtime {
        Runtime::new(compile(&doc).expect("compiles"))
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
    fn gate_globals_node_exposes_the_masters() {
        let doc = PatchDoc {
            nodes: vec![
                node("g", "globals"),
                node("mix", "blend"),
                node("o", "output"),
            ],
            edges: vec![
                edge("g", "brightness", "mix", "opacity"),
                edge("g", "hue", "o", "master"),
                edge("mix", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let slot_of = |rt: &Runtime, name: &str| {
            rt.prog
                .slots
                .iter()
                .find(|s| s.param.as_deref() == Some(name))
                .unwrap()
                .slot
        };
        let opacity = slot_of(&rt, "opacity");
        let master = slot_of(&rt, "master");
        let g = rt.doc.nodes.iter().position(|n| n.id == "g").unwrap();

        let mut inp = inputs(&audio);
        inp.master_brightness = 0.3;
        inp.master_hue = 1.25;
        rt.eval(&inp);
        assert!((rt.slab[opacity] - 0.3).abs() < 1e-6, "{}", rt.slab[opacity]);
        assert!((rt.slab[master] - 0.25).abs() < 1e-6, "hue wraps to turns: {}", rt.slab[master]);
        assert_eq!(rt.outputs[g]["speed"], 1.0);
        assert_eq!(rt.outputs[g]["hue_amount"], 0.0);

        // Garbage in stays inside the ranges the gate itself keeps.
        inp.master_brightness = f32::NAN;
        inp.master_hue_amount = 7.0;
        rt.eval(&inp);
        assert_eq!(rt.slab[opacity], 1.0);
        assert_eq!(rt.outputs[g]["hue_amount"], 1.0);
    }

    #[test]
    fn a_cpu_code_node_meters_its_locals_and_state_by_probe_key() {
        // The editor's live values: each `let`/`var`/`state.` of a CPU body
        // is on the meter list after the node's real outputs, and reads as
        // its value (a local: its last value assigned).
        let mut c = node("c", crate::code::KIND);
        let out = crate::code::CodePort {
            name: "out".into(),
            shape: Shape::Scalar,
            ..Default::default()
        };
        c.code = Some(Box::new(crate::code::CodeDef {
            inputs: vec![],
            outputs: vec![out],
            body: "let a = 1.5;
state.t += 2.0;
out = a;".into(),
        }));
        let doc = PatchDoc {
            nodes: vec![c, node("sol", "solid"), node("o", "output")],
            edges: vec![edge("c", "out", "sol", "brightness"), edge("sol", "out", "o", "in")],
            ..Default::default()
        };
        let mut rt = runtime(doc);
        let ci = rt.doc.nodes.iter().position(|n| n.id == "c").unwrap();
        let keys: Vec<&str> = rt
            .prog
            .preview_scalars
            .iter()
            .filter(|(n, _)| *n == ci)
            .map(|(_, p)| p.as_str())
            .collect();
        assert_eq!(keys, ["out", "@1:5:a", "@state:t"]);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let inp = inputs(&audio);
        rt.eval(&inp);
        rt.eval(&inp);
        assert_eq!(rt.scalar_value(ci, "@1:5:a"), 1.5);
        assert_eq!(rt.scalar_value(ci, "@state:t"), 4.0);
        assert_eq!(rt.scalar_value(ci, "out"), 1.5);
        // A live value no frame has computed: NaN (nothing to show), where an
        // unknown port of any other kind still reads 0.
        assert!(rt.scalar_value(ci, "@9:5:never").is_nan());
        assert_eq!(rt.scalar_value(ci, "nope"), 0.0);
    }

    #[test]
    fn event_ports_meter_as_a_running_fire_count() {
        // A looping clock's `wrap` fires once per loop; the meter list carries
        // it and its value climbs by one per fire, surviving a rebuild.
        let mut t = node("t", "time");
        t.params.insert("mode".into(), 1.0); // loop
        t.params.insert("rate".into(), 1.0);
        t.params.insert("end".into(), 0.25);
        let doc = PatchDoc {
            nodes: vec![t, node("n", "noise_field"), node("o", "output")],
            edges: vec![edge("n", "out", "o", "in")],
            ..Default::default()
        };
        let mut rt = runtime(doc.clone());
        let ti = rt.doc.nodes.iter().position(|n| n.id == "t").unwrap();
        assert!(rt.prog.preview_scalars.contains(&(ti, "wrap".to_string())), "events are metered");
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        assert_eq!(rt.scalar_value(ti, "wrap"), 0.0);
        for _ in 0..10 {
            rt.eval(&inputs(&audio)); // dt 0.1: the 0.25 loop wraps every 3 frames
        }
        let fired = rt.scalar_value(ti, "wrap");
        assert!(fired >= 3.0, "{fired}");
        let mut rebuilt = runtime(doc);
        rebuilt.adopt_state(&rt);
        assert_eq!(rebuilt.scalar_value(ti, "wrap"), fired, "the count carries over an edit");
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
