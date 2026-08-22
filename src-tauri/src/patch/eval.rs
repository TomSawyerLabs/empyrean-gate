//! Control-rate evaluation: Scalar/Event nodes run here on the CPU every
//! frame, in the engine thread, and their results land in the GPU parameter
//! slab laid out by codegen. All time integration (LFO phases, `rate` params)
//! honors master speed, matching the layer stack's phase behavior — and like
//! layer phases, integration state lives here so live edits never cause
//! visual discontinuities.

use super::PatchDoc;
use super::codegen::Program;
use crate::engine::AudioUniform;
use crate::layers::MAX_AUDIO_SOURCES;
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
}

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
}

impl Default for NodeState {
    fn default() -> Self {
        Self {
            acc: 0.0,
            y: 0.0,
            env_t: f32::INFINITY,
            prev_beat: 0.0,
        }
    }
}

/// One compiled patch, live: owns the document, the program, and all
/// control-rate state. Rebuilt whenever the active patch or its file changes.
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

    /// A CPU node's input: the wired upstream output, else the knob value.
    fn input(&self, node: usize, port: &str) -> f32 {
        match self.prog.wires.get(&(node, port.to_string())) {
            Some((from, from_port)) => self.outputs[*from].get(from_port).copied().unwrap_or(0.0),
            None => self.doc.nodes[node].param(port),
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
        let dt = inp.dt.clamp(0.0, 0.5);
        let ms = inp.master_speed.max(0.0);

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
                    let v = self.doc.nodes[node].param("value");
                    self.outputs[node].insert("out".into(), v);
                }
                "audio" => {
                    let src = (self.doc.nodes[node].param("source").round() as usize)
                        .min(MAX_AUDIO_SOURCES - 1);
                    let a = &inp.audio[src];
                    let o = &mut self.outputs[node];
                    o.insert("level".into(), a.level);
                    o.insert("bass".into(), a.bass);
                    o.insert("mid".into(), a.mid);
                    o.insert("treble".into(), a.treble);
                    o.insert("onset".into(), a.onset);
                    o.insert("beat_phase".into(), a.beat_phase);
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
                "scalar_math" => {
                    let a = self.input(node, "a");
                    let b = self.input(node, "b");
                    let v = match self.doc.nodes[node].param("op").round() as u32 {
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
                    let w = match self.doc.nodes[node].param("wave").round() as u32 {
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
            let v = match (&slot.wired, &slot.param) {
                (Some((from, port)), _) => self.outputs[*from].get(port).copied().unwrap_or(0.0),
                (None, Some(param)) => self.doc.nodes[slot.node].param(param),
                (None, None) => 0.0,
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
        let slab = rt.eval(&inputs(&audio)).to_vec();

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
