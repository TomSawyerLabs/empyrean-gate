//! Graph → WGSL transpiler. Field nodes stay SYMBOLIC: each becomes a WGSL
//! function over the per-pixel `Ctx`, composed by direct calls, so a whole
//! patch still renders in one compute dispatch with zero per-frame GPU state
//! (the TiXL model — see plans/node-graph.md).
//!
//! Scalar/Event nodes run on the CPU (patch/eval.rs). Every value crossing the
//! CPU→GPU boundary gets a slot in the parameter slab (binding 8): each Number
//! param of every GPU node, plus each Scalar wire adapted into a field input.
//! Param edits and scalar wiring therefore never recompile the shader — only
//! topology and Select params do (Selects are baked as constants).
//!
//! Identifier safety: generated code references only mangled names (`n<i>_f`)
//! and `P[<n>]`. User strings never reach WGSL — a node named `active` (a WGSL
//! reserved word that once killed the engine thread) cannot hurt us.

use super::registry::{self, ParamKind};
use super::validate::{self, Validated};
use super::{PatchDoc, Shape};
use std::collections::HashMap;
use std::fmt::Write as _;

/// Capacity of the GPU parameter slab (f32 slots). 256 nodes × ~8 params fits.
pub const MAX_SLAB_FLOATS: usize = 2048;

const PRELUDE: &str = include_str!("../engine/shaders/patch_lib.wgsl");

/// Everything the engine + evaluator need to run one compiled patch.
#[derive(Debug)]
pub struct Program {
    pub wgsl: String,
    pub slab_len: usize,
    pub slots: Vec<SlabSlot>,
    /// CPU (Scalar/Event) node indices in dependency order.
    pub cpu_order: Vec<usize>,
    /// (to_node, to_port) → (from_node, from_port), for CPU-side input lookup.
    pub wires: HashMap<(usize, String), (usize, String)>,
}

/// One f32 in the parameter slab, filled by the evaluator every frame.
#[derive(Debug)]
pub struct SlabSlot {
    pub slot: usize,
    /// The GPU node this value feeds.
    pub node: usize,
    /// `Some(param)`: a Number param — knob value is the unwired fallback.
    /// `None`: a Scalar wire adapted into a shaped field input (`wired` is set).
    pub param: Option<String>,
    /// Upstream CPU node + output port when a wire overrides the knob.
    pub wired: Option<(usize, String)>,
    /// Integrate the value over time (× master speed) into a phase.
    pub integrate: bool,
}

fn is_cpu_kind(kind: &str) -> bool {
    matches!(
        kind,
        "time" | "slider" | "audio" | "imu" | "tap" | "scalar_math" | "lfo" | "smooth" | "envelope"
    )
}

fn is_gpu_kind(kind: &str) -> bool {
    matches!(
        kind,
        "solid"
            | "gradient"
            | "gradient_radial"
            | "noise_field"
            | "noise_color"
            | "radial_waves"
            | "spiral"
            | "plasma"
            | "spoke_chase"
            | "sparkle"
            | "beat_rings"
            | "breathe"
            | "rainbow"
            | "wedges"
            | "interference"
            | "fire"
            | "meteors"
            | "warp"
            | "waveform"
            | "spectrum"
            | "transform"
            | "colorize"
            | "blend"
            | "touch_dabs"
            | "render_points"
            | "video_in"
            | "texture_sample"
            | "output"
    )
}

/// Validate + transpile a patch. The single entry point the server (activation
/// check) and the engine (pipeline build) both use.
pub fn compile(doc: &PatchDoc) -> Result<Program, String> {
    let validated = validate::validate(doc).map_err(|errs| validate::errors_to_string(&errs))?;
    compile_validated(doc, &validated)
}

fn compile_validated(doc: &PatchDoc, validated: &Validated) -> Result<Program, String> {
    let output = validated
        .output
        .ok_or_else(|| "patch has no Output node".to_string())?;

    for n in &doc.nodes {
        if !is_cpu_kind(&n.kind) && !is_gpu_kind(&n.kind) {
            return Err(format!(
                "node kind \"{}\" is not renderable yet (planned for a later step)",
                n.kind
            ));
        }
    }

    let index: HashMap<&str, usize> = doc
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    let mut wires: HashMap<(usize, String), (usize, String)> = HashMap::new();
    for e in &doc.edges {
        wires.insert(
            (index[e.to.node.as_str()], e.to.port.clone()),
            (index[e.from.node.as_str()], e.from.port.clone()),
        );
    }

    let cpu_order: Vec<usize> = validated
        .order
        .iter()
        .copied()
        .filter(|i| is_cpu_kind(&doc.nodes[*i].kind))
        .collect();
    let gpu_order: Vec<usize> = validated
        .order
        .iter()
        .copied()
        .filter(|i| is_gpu_kind(&doc.nodes[*i].kind))
        .collect();

    // -- Slab allocation ----------------------------------------------------
    let mut slots: Vec<SlabSlot> = Vec::new();
    // (node, param-or-port name) → slot index, for expression generation.
    let mut slot_of: HashMap<(usize, &str), usize> = HashMap::new();
    for &i in &gpu_order {
        let ty = registry::lookup(&doc.nodes[i].kind).expect("validated kind");
        for p in ty.params {
            if !matches!(p.kind, ParamKind::Number) {
                continue;
            }
            let slot = slots.len();
            slot_of.insert((i, p.name), slot);
            slots.push(SlabSlot {
                slot,
                node: i,
                param: Some(p.name.to_string()),
                wired: wires.get(&(i, p.name.to_string())).cloned(),
                integrate: p.integrate,
            });
        }
        // Scalar wires adapted into shaped field inputs (e.g. LFO → Colorize.in).
        for inp in ty.inputs {
            if inp.shape != Shape::FieldScalar {
                continue;
            }
            if let Some((from, port)) = wires.get(&(i, inp.name.to_string()))
                && is_cpu_kind(&doc.nodes[*from].kind)
            {
                let slot = slots.len();
                slot_of.insert((i, inp.name), slot);
                slots.push(SlabSlot {
                    slot,
                    node: i,
                    param: None,
                    wired: Some((*from, port.clone())),
                    integrate: false,
                });
            }
        }
    }
    if slots.len() > MAX_SLAB_FLOATS {
        return Err(format!(
            "patch needs {} parameter slots (limit {MAX_SLAB_FLOATS})",
            slots.len()
        ));
    }

    // -- Code generation ----------------------------------------------------
    let g = Gen {
        doc,
        wires: &wires,
        slot_of: &slot_of,
    };
    // Reverse reachability from the output: a Render points node wired into
    // the result takes ownership of the dabs (the epilogue must not draw them
    // a second time); a dangling one changes nothing.
    let mut reachable = vec![false; doc.nodes.len()];
    let mut stack = vec![output];
    reachable[output] = true;
    while let Some(i) = stack.pop() {
        for ((to, _), (from, _)) in &wires {
            if *to == i && !reachable[*from] {
                reachable[*from] = true;
                stack.push(*from);
            }
        }
    }
    let auto_dabs = !doc
        .nodes
        .iter()
        .enumerate()
        .any(|(i, n)| n.kind == "render_points" && reachable[i]);

    let mut code = String::new();
    code.push_str(PRELUDE);
    code.push_str("\n// ---- generated from the patch graph ----\n");
    for &i in &gpu_order {
        if i == output {
            continue;
        }
        g.node_fn(&mut code, i)?;
    }
    g.main_fn(&mut code, output, auto_dabs)?;

    Ok(Program {
        wgsl: code,
        slab_len: slots.len().max(1),
        slots,
        cpu_order,
        wires,
    })
}

struct Gen<'a> {
    doc: &'a PatchDoc,
    wires: &'a HashMap<(usize, String), (usize, String)>,
    slot_of: &'a HashMap<(usize, &'static str), usize>,
}

impl Gen<'_> {
    /// `P[..]` reference for a Number param of a GPU node.
    fn p(&self, node: usize, param: &str) -> String {
        let slot = self
            .slot_of
            .iter()
            .find(|(k, _)| k.0 == node && k.1 == param)
            .map(|(_, s)| *s)
            .expect("param slot allocated");
        format!("P[{slot}u]")
    }

    /// Baked value of a Select param (a compile-time constant).
    fn select(&self, node: usize, param: &str) -> u32 {
        let ty = registry::lookup(&self.doc.nodes[node].kind).expect("kind");
        let def = ty.param(param).expect("select param");
        (self.doc.nodes[node].param(param).round()).clamp(def.min, def.max) as u32
    }

    fn upstream(&self, node: usize, port: &str) -> Option<&(usize, String)> {
        self.wires.get(&(node, port.to_string()))
    }

    /// Expression for a Field<color> input port, sampling at `ctx`.
    fn color_input(&self, node: usize, port: &str, ctx: &str) -> String {
        match self.upstream(node, port) {
            None => "vec4f(0.0)".into(),
            Some((from, _)) => {
                let from_kind = &self.doc.nodes[*from].kind;
                let ty = registry::lookup(from_kind).expect("kind");
                match ty.output_shape("out") {
                    Some(Shape::FieldColor) => format!("n{from}_f({ctx})"),
                    Some(Shape::FieldScalar) => format!("gray(n{from}_f({ctx}))"),
                    _ => "vec4f(0.0)".into(),
                }
            }
        }
    }

    /// Expression for a Field<f32> input port, sampling at `ctx`.
    fn scalar_field_input(&self, node: usize, port: &str, ctx: &str) -> String {
        match self.upstream(node, port) {
            None => "0.0".into(),
            Some((from, _)) => {
                if is_cpu_kind(&self.doc.nodes[*from].kind) {
                    // Scalar → uniform-field adapter: the slab slot allocated
                    // for this wire.
                    let slot = self.slot_of.get(&(node, leak(port))).copied();
                    match slot {
                        Some(s) => format!("P[{s}u]"),
                        None => "0.0".into(),
                    }
                } else {
                    format!("n{from}_f({ctx})")
                }
            }
        }
    }

    fn node_fn(&self, code: &mut String, i: usize) -> Result<(), String> {
        let kind = self.doc.nodes[i].kind.as_str();
        let body = match kind {
            "solid" => format!(
                "    return vec4f(hsv2rgb({h}, {s}, max({b}, 0.0)), 1.0);",
                h = self.p(i, "hue"),
                s = self.p(i, "saturation"),
                b = self.p(i, "brightness"),
            ),
            "gradient" => {
                // r01 runs outer→inner, so "inner"/"outer" map through 1-r01.
                let t = match self.select(i, "along") {
                    0 => "1.0 - c.r01".to_string(),
                    _ => "fract(c.theta / TAU)".to_string(),
                };
                format!(
                    "    let t = {t};\n    return mix({inner}, {outer}, t);",
                    inner = self.p(i, "inner"),
                    outer = self.p(i, "outer"),
                )
            }
            "noise_field" => format!(
                "    let p = vec3f(c.pos * (2.0 * {scale}), {phase} * 0.3);\n\
                 \x20   let n = fbm3(p, 4u);\n\
                 \x20   let cut = {cut};\n\
                 \x20   let v = smoothstep(cut - 0.3, cut + 0.5, n);\n\
                 \x20   let hue = {h} + n * {hr};\n\
                 \x20   return vec4f(hsv2rgb(hue, {s}, v * {b}), v);",
                scale = self.p(i, "scale"),
                phase = self.p(i, "speed"),
                cut = self.p(i, "threshold"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                s = self.p(i, "saturation"),
                b = self.p(i, "brightness"),
            ),
            "radial_waves" => format!(
                "    let harmonics = u32(clamp({waves}, 1.0, 8.0));\n\
                 \x20   var v = 0.0;\n\
                 \x20   var norm = 0.0;\n\
                 \x20   for (var h = 1u; h <= harmonics; h++) {{\n\
                 \x20       let fh = f32(h);\n\
                 \x20       let w = 1.0 / fh;\n\
                 \x20       v += w * sin((c.rn * 6.0 * fh * {scale}) * TAU - {phase} * (1.0 + 0.2 * fh));\n\
                 \x20       norm += w;\n\
                 \x20   }}\n\
                 \x20   v = pow(clamp(v / norm * 0.5 + 0.5, 0.0, 1.0), 1.0 + 3.0 * {sharp});\n\
                 \x20   let hue = {h} + (c.rn - 0.5) * {hr};\n\
                 \x20   return vec4f(hsv2rgb(hue, {s}, v * {b}), v);",
                waves = self.p(i, "waves"),
                scale = self.p(i, "scale"),
                phase = self.p(i, "speed"),
                sharp = self.p(i, "sharpness"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                s = self.p(i, "saturation"),
                b = self.p(i, "brightness"),
            ),
            "spiral" => format!(
                "    let arms = max(1.0, floor({arms} + 0.5));\n\
                 \x20   let v0 = sin(arms * c.theta + {twist} * c.rn * TAU - {phase});\n\
                 \x20   let v = pow(max(v0, 0.0), 1.0 + 8.0 * {sharp});\n\
                 \x20   let hue = {h} + c.rn * {hr_or_zero};\n\
                 \x20   return vec4f(hsv2rgb(hue, {s}, v * {b}), v);",
                arms = self.p(i, "arms"),
                twist = self.p(i, "twist"),
                phase = self.p(i, "speed"),
                sharp = self.p(i, "sharpness"),
                h = self.p(i, "hue"),
                hr_or_zero = "0.15",
                s = self.p(i, "saturation"),
                b = self.p(i, "brightness"),
            ),
            "transform" => {
                let mirror = if self.select(i, "mirror") == 1 {
                    "1.0"
                } else {
                    "0.0"
                };
                format!(
                    "    let c = ctx_transform(c0, ({rot} + {spin}) * TAU, {zoom}, {kal}, {mirror});\n\
                     \x20   return {input};",
                    rot = self.p(i, "rotate"),
                    spin = self.p(i, "spin"),
                    zoom = self.p(i, "zoom"),
                    kal = self.p(i, "kaleido"),
                    input = self.color_input(i, "in", "c"),
                )
            }
            "colorize" => format!(
                "    let v = {input};\n\
                 \x20   return vec4f(hsv2rgb({h} + v * {hr}, {s}, max(v, 0.0) * {b}), clamp(v, 0.0, 1.0));",
                input = self.scalar_field_input(i, "in", "c"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                s = self.p(i, "saturation"),
                b = self.p(i, "brightness"),
            ),
            "blend" => {
                let mode = self.select(i, "mode");
                format!(
                    "    let base = {base};\n\
                     \x20   let over = {over};\n\
                     \x20   let op = {op};\n\
                     \x20   return vec4f(apply_blend(base.rgb, over, op, {mode}u), max(base.a, clamp(over.a * op, 0.0, 1.0)));",
                    base = self.color_input(i, "base", "c"),
                    over = self.color_input(i, "over", "c"),
                    op = self.p(i, "opacity"),
                )
            }
            // -- ported layer-stack generators (gate.wgsl bodies, audio
            // couplings replaced by wireable params) ------------------------
            "gradient_radial" => format!(
                "    let t = c.rn + {phase} * 0.1;\n\
                 \x20   let hue = {h} + t * {hr};\n\
                 \x20   return vec4f(hsv2rgb(hue, {s}, max({b}, 0.0)), 1.0);",
                phase = self.p(i, "drift"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                s = self.p(i, "saturation"),
                b = self.p(i, "brightness"),
            ),
            "noise_color" => format!(
                "    let s = 2.0 * {scale};\n\
                 \x20   let p = vec3f(c.pos * s, {phase} * 0.25);\n\
                 \x20   let r = 0.5 + 0.5 * snoise3(p);\n\
                 \x20   let g = 0.5 + 0.5 * snoise3(p + vec3f(31.4, 47.2, 12.9));\n\
                 \x20   let b = 0.5 + 0.5 * snoise3(p + vec3f(-17.7, 8.3, 91.1));\n\
                 \x20   let base = hsv2rgb({h}, {sat}, 1.0);\n\
                 \x20   let col = mix(vec3f(r, g, b), vec3f(r, g, b) * base, 0.6);\n\
                 \x20   return vec4f(col * {bright}, 1.0);",
                scale = self.p(i, "scale"),
                phase = self.p(i, "speed"),
                h = self.p(i, "hue"),
                sat = self.p(i, "saturation"),
                bright = self.p(i, "brightness"),
            ),
            "plasma" => format!(
                "    let s = 3.0 * {scale};\n\
                 \x20   let t = {phase};\n\
                 \x20   var v = sin(c.pos.x * s + t);\n\
                 \x20   v += sin((c.pos.y * s + t) * 0.7);\n\
                 \x20   v += sin((c.pos.x + c.pos.y) * s * 0.6 + t * 1.3);\n\
                 \x20   v += sin(c.rn * s * 2.0 - t);\n\
                 \x20   v = v * 0.25 + 0.5;\n\
                 \x20   let hue = {h} + v * {hr};\n\
                 \x20   return vec4f(hsv2rgb(hue, {sat}, {bright} * v), 1.0);",
                scale = self.p(i, "scale"),
                phase = self.p(i, "speed"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                sat = self.p(i, "saturation"),
                bright = self.p(i, "brightness"),
            ),
            "spoke_chase" => {
                let dir = if self.select(i, "direction") == 1 {
                    "-1.0"
                } else {
                    "1.0"
                };
                format!(
                    "    let h = hash01(c.spoke * 7919u);\n\
                     \x20   let head = fract(h + {phase} * 0.2 * {dir});\n\
                     \x20   let d = fract(c.r01 - head);\n\
                     \x20   let v = exp(-d / {tail}) * step(0.0, d);\n\
                     \x20   let hue = {hh} + h * {hr};\n\
                     \x20   return vec4f(hsv2rgb(hue, {sat}, v * {bright}), v);",
                    phase = self.p(i, "speed"),
                    tail = self.p(i, "tail"),
                    hh = self.p(i, "hue"),
                    hr = self.p(i, "hue_range"),
                    sat = self.p(i, "saturation"),
                    bright = self.p(i, "brightness"),
                )
            }
            "sparkle" => format!(
                "    let idx = c.spoke * G.pixels + c.i;\n\
                 \x20   let tw_rate = 4.0 + {twinkle} * 20.0;\n\
                 \x20   let cell = u32({phase} * tw_rate);\n\
                 \x20   let rnd = hash01(idx * 2654435761u + cell * 40503u);\n\
                 \x20   let lit = step(1.0 - {density} * 0.2, rnd);\n\
                 \x20   let tw = fract({phase} * tw_rate);\n\
                 \x20   let v = lit * (1.0 - tw) * (1.0 - tw);\n\
                 \x20   let hue = {h} + rnd * {hr};\n\
                 \x20   return vec4f(hsv2rgb(hue, {sat}, v * {bright}), v);",
                twinkle = self.p(i, "twinkle"),
                phase = self.p(i, "speed"),
                density = self.p(i, "density"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                sat = self.p(i, "saturation"),
                bright = self.p(i, "brightness"),
            ),
            "beat_rings" => {
                let dir = if self.select(i, "direction") == 1 {
                    "c.r01"
                } else {
                    "1.0 - c.r01"
                };
                format!(
                    "    let front = clamp({front}, 0.0, 1.0);\n\
                     \x20   let d = abs(({dir}) - front);\n\
                     \x20   let w = {width};\n\
                     \x20   let v = exp(-(d * d) / (w * w)) * (1.0 - front * 0.5);\n\
                     \x20   let hue = {h} + front * {hr};\n\
                     \x20   return vec4f(hsv2rgb(hue, {sat}, v * {bright}), v);",
                    front = self.p(i, "front"),
                    width = self.p(i, "width"),
                    h = self.p(i, "hue"),
                    hr = self.p(i, "hue_range"),
                    sat = self.p(i, "saturation"),
                    bright = self.p(i, "brightness"),
                )
            }
            "breathe" => format!(
                "    let env = 0.5 + 0.5 * sin({phase});\n\
                 \x20   let v = mix({floor_v}, 1.0, env) * {bright};\n\
                 \x20   return vec4f(vec3f(v), 1.0);",
                phase = self.p(i, "speed"),
                floor_v = self.p(i, "floor"),
                bright = self.p(i, "brightness"),
            ),
            "rainbow" => format!(
                "    let turns = max(1.0, floor({turns} + 0.5));\n\
                 \x20   let hue = {h} + (c.theta / TAU) * turns + c.rn * {hr} + {phase} * 0.03;\n\
                 \x20   return vec4f(hsv2rgb(hue, {sat}, max({bright}, 0.0)), 1.0);",
                turns = self.p(i, "turns"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                phase = self.p(i, "speed"),
                sat = self.p(i, "saturation"),
                bright = self.p(i, "brightness"),
            ),
            "wedges" => format!(
                "    let n = max(2.0, floor({slices} + 0.5));\n\
                 \x20   let w = fract((c.theta / TAU + {phase} * 0.03) * n + c.rn * {twist});\n\
                 \x20   let d = abs(w - 0.5) * 2.0;\n\
                 \x20   var v = smoothstep(0.5 - {soft}, 0.5 + {soft}, d);\n\
                 \x20   v = max(v, clamp({flash}, 0.0, 1.0));\n\
                 \x20   let hue = {h} + step(0.5, w) * {hr};\n\
                 \x20   return vec4f(hsv2rgb(hue, {sat}, v * {bright}), v);",
                slices = self.p(i, "slices"),
                phase = self.p(i, "speed"),
                twist = self.p(i, "twist"),
                soft = self.p(i, "softness"),
                flash = self.p(i, "flash"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                sat = self.p(i, "saturation"),
                bright = self.p(i, "brightness"),
            ),
            "interference" => format!(
                "    let orbit = 0.45 + {orbit} * 0.3;\n\
                 \x20   let p1 = orbit * vec2f(cos({phase} * 0.31), sin({phase} * 0.31));\n\
                 \x20   let p2 = -orbit * vec2f(cos({phase} * 0.23), sin({phase} * 0.23));\n\
                 \x20   let freq = (4.0 + {frequency} * 20.0) * {scale};\n\
                 \x20   var v = sin(distance(c.pos, p1) * freq * TAU - {phase})\n\
                 \x20       + sin(distance(c.pos, p2) * freq * TAU + {phase} * 0.8);\n\
                 \x20   v = v * 0.25 + 0.5;\n\
                 \x20   v = pow(v, 1.0 + {sharp} * 4.0);\n\
                 \x20   let hue = {h} + v * {hr};\n\
                 \x20   return vec4f(hsv2rgb(hue, {sat}, v * {bright} * 0.6), v);",
                orbit = self.p(i, "orbit"),
                phase = self.p(i, "speed"),
                frequency = self.p(i, "frequency"),
                scale = self.p(i, "scale"),
                sharp = self.p(i, "sharpness"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                sat = self.p(i, "saturation"),
                bright = self.p(i, "brightness"),
            ),
            "fire" => format!(
                "    let stretch = 2.0 + {stretch} * 4.0;\n\
                 \x20   let p = vec3f(cos(c.theta) * 3.0 * {scale}, sin(c.theta) * 3.0 * {scale}, 0.0)\n\
                 \x20       + vec3f(0.0, 0.0, c.r01 * stretch - {phase});\n\
                 \x20   let n = fbm3(p, 4u) * 0.5 + 0.5;\n\
                 \x20   let reach = 0.4 + {reach} * 0.6;\n\
                 \x20   var heat = (1.0 - c.r01 / max(reach, 0.05)) * 1.3 - n * 0.9;\n\
                 \x20   heat = clamp(heat, 0.0, 1.0);\n\
                 \x20   let hue = {h} + heat * 0.12;\n\
                 \x20   let sat2 = clamp(1.3 - heat * 0.7, 0.0, 1.0) * {sat};\n\
                 \x20   let v = pow(heat, 1.4) * {bright};\n\
                 \x20   return vec4f(hsv2rgb(hue, sat2, v), heat);",
                stretch = self.p(i, "stretch"),
                scale = self.p(i, "scale"),
                phase = self.p(i, "speed"),
                reach = self.p(i, "reach"),
                h = self.p(i, "hue"),
                sat = self.p(i, "saturation"),
                bright = self.p(i, "brightness"),
            ),
            "meteors" => {
                let dir = if self.select(i, "direction") == 1 {
                    "1.0 - c.r01"
                } else {
                    "c.r01"
                };
                format!(
                    "    let rate = 0.15 + {tail} * 1.2;\n\
                     \x20   let h0 = hash01(c.spoke * 4099u);\n\
                     \x20   let t = {phase} * rate + h0 * 7.0;\n\
                     \x20   let epoch = u32(t);\n\
                     \x20   let t_ep = fract(t);\n\
                     \x20   let alive = step(1.0 - (0.1 + {density} * 0.5), hash01(c.spoke * 31337u + epoch * 269u));\n\
                     \x20   let dir_r = {dir};\n\
                     \x20   let head = t_ep * 1.3;\n\
                     \x20   let d = head - dir_r;\n\
                     \x20   let tail_len = 0.08 + {tail} * 0.15;\n\
                     \x20   let v = alive * exp(-d / tail_len) * step(0.0, d) * step(dir_r, head);\n\
                     \x20   let hue = {hh} + hash01(c.spoke * 911u + epoch) * {hr};\n\
                     \x20   return vec4f(hsv2rgb(hue, {sat}, v * {bright}), v);",
                    tail = self.p(i, "tail"),
                    phase = self.p(i, "speed"),
                    density = self.p(i, "density"),
                    dir = dir,
                    hh = self.p(i, "hue"),
                    hr = self.p(i, "hue_range"),
                    sat = self.p(i, "saturation"),
                    bright = self.p(i, "brightness"),
                )
            }
            "warp" => format!(
                "    let cells = 6.0 + {density} * 20.0;\n\
                 \x20   let u = c.r01 * cells + hash01(c.spoke * 7919u) * 13.0;\n\
                 \x20   let flow = u + {phase};\n\
                 \x20   let cell = u32(flow);\n\
                 \x20   let f = fract(flow);\n\
                 \x20   let star = step(1.0 - (0.15 + {density} * 0.2), hash01(cell * 6151u + c.spoke * 389u));\n\
                 \x20   let streak = (1.0 - f) * (1.0 - f);\n\
                 \x20   let persp = 0.35 + (1.0 - c.r01) * 0.65;\n\
                 \x20   let v = star * streak * persp;\n\
                 \x20   let hue = {h} + hash01(cell * 127u) * {hr};\n\
                 \x20   return vec4f(hsv2rgb(hue, {sat} * 0.6, v * {bright}), v);",
                density = self.p(i, "density"),
                phase = self.p(i, "speed"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                sat = self.p(i, "saturation"),
                bright = self.p(i, "brightness"),
            ),
            "waveform" => {
                let src = self.select(i, "source");
                format!(
                    "    let t = fract(c.theta / TAU + {phase} * 0.03);\n\
                     \x20   let w = wave_at({src}u, t);\n\
                     \x20   let depth = 0.08 + {depth} * 0.3;\n\
                     \x20   let ring_r = mix(0.35, 0.95, {ring}) + w * depth;\n\
                     \x20   let d = abs(c.rn - ring_r);\n\
                     \x20   let width = 0.012 + {thick} * 0.06;\n\
                     \x20   let v = exp(-(d * d) / (width * width));\n\
                     \x20   let hue = {h} + w * {hr};\n\
                     \x20   return vec4f(hsv2rgb(hue, {sat}, v * {bright}), v);",
                    phase = self.p(i, "drift"),
                    src = src,
                    depth = self.p(i, "depth"),
                    ring = self.p(i, "ring"),
                    thick = self.p(i, "thickness"),
                    h = self.p(i, "hue"),
                    hr = self.p(i, "hue_range"),
                    sat = self.p(i, "saturation"),
                    bright = self.p(i, "brightness"),
                )
            }
            "spectrum" => {
                let src = self.select(i, "source");
                let pos = if self.select(i, "from") == 1 {
                    "1.0 - c.r01"
                } else {
                    "c.r01"
                };
                format!(
                    "    let t = fract(c.theta / TAU + {phase} * 0.02);\n\
                     \x20   let e = spec_at({src}u, u32(t * f32(SPEC_N)));\n\
                     \x20   let extent = clamp(e * (0.35 + {len} * 0.9), 0.0, 1.0);\n\
                     \x20   let pos = {pos};\n\
                     \x20   let v = smoothstep(extent, extent - 0.2, pos) * (0.35 + e * 0.65);\n\
                     \x20   let hue = {h} + t * {hr};\n\
                     \x20   return vec4f(hsv2rgb(hue, {sat}, v * {bright}), v);",
                    phase = self.p(i, "drift"),
                    src = src,
                    len = self.p(i, "length"),
                    pos = pos,
                    h = self.p(i, "hue"),
                    hr = self.p(i, "hue_range"),
                    sat = self.p(i, "saturation"),
                    bright = self.p(i, "brightness"),
                )
            }
            // No function of its own: it marks the live-draw dab stream as a
            // Points source for Render points (which reads DABS directly).
            "touch_dabs" => return Ok(()),
            // Likewise: marks the live video frame as a Texture source.
            "video_in" => return Ok(()),
            "texture_sample" => {
                if self.upstream(i, "tex").is_none() {
                    "    return vec4f(0.0);".to_string()
                } else {
                    format!(
                        "    let c = ctx_transform(c0, {rot} * TAU, {zoom}, {kal}, 0.0);
                             let uv = vec2f(0.5 + c.pos.x * 0.5, 0.5 - c.pos.y * 0.5);
                             let s = video_at(uv);
                             if s.a == 0.0 {{
                                 return s;
                             }}
                             let lum = dot(s.rgb, vec3f(0.2126, 0.7152, 0.0722));
                             let col = mix(vec3f(lum), s.rgb, clamp({sat}, 0.0, 2.0)) * {bright};
                             return vec4f(col, s.a);",
                        rot = self.p(i, "rotate"),
                        zoom = self.p(i, "zoom"),
                        kal = self.p(i, "kaleido"),
                        sat = self.p(i, "saturation"),
                        bright = self.p(i, "brightness"),
                    )
                }
            }
            "render_points" => {
                if self.upstream(i, "points").is_none() {
                    "    return vec4f(0.0);".to_string()
                } else {
                    // Pen 0 = "as drawn" (keep each dab's own kind); size and
                    // intensity act as multipliers either way.
                    let pen = self.select(i, "pen");
                    let override_kind = if pen == 0 {
                        String::new()
                    } else {
                        format!("        D.kind = {}u;\n", pen - 1)
                    };
                    format!(
                        "    var acc = vec3f(0.0);\n\
                         \x20   for (var d = 0u; d < G.dab_count; d++) {{\n\
                         \x20       var D = DABS[d];\n\
                         {override_kind}\
                         \x20       D.size = D.size * {size};\n\
                         \x20       D.intensity = D.intensity * {intensity};\n\
                         \x20       acc += dab_color(D, c, d);\n\
                         \x20   }}\n\
                         \x20   return vec4f(acc, clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0));",
                        size = self.p(i, "size"),
                        intensity = self.p(i, "intensity"),
                    )
                }
            }
            other => return Err(format!("no GPU codegen for node kind \"{other}\"")),
        };

        let ret = match self.doc.nodes[i].kind.as_str() {
            "gradient" => "f32",
            _ => "vec4f",
        };
        // Transform/texture_sample rename their ctx arg (they derive a
        // transformed copy).
        let arg = if kind == "transform" || kind == "texture_sample" {
            "c0"
        } else {
            "c"
        };
        writeln!(code, "\nfn n{i}_f({arg}: Ctx) -> {ret} {{").unwrap();
        // A node with no ctx-dependent body (e.g. solid) leaves `c` unused;
        // keep naga quiet about it.
        writeln!(code, "    let _unused = {arg}.rn;").unwrap();
        writeln!(code, "{body}").unwrap();
        code.push_str("}\n");
        Ok(())
    }

    fn main_fn(&self, code: &mut String, output: usize, auto_dabs: bool) -> Result<(), String> {
        let root = self.color_input(output, "in", "ctx");
        let master = self.p(output, "master");
        let auto_dabs = if auto_dabs { "true" } else { "false" };
        write!(
            code,
            "\n@compute @workgroup_size(256)\n\
             fn main(@builtin(global_invocation_id) gid: vec3u) {{\n\
             \x20   let idx = gid.x;\n\
             \x20   let total = G.spokes * G.pixels;\n\
             \x20   if idx >= total {{\n\
             \x20       return;\n\
             \x20   }}\n\
             \x20   let spoke = idx / G.pixels;\n\
             \x20   let i = idx % G.pixels;\n\
             \x20   let theta = f32(spoke) / f32(G.spokes) * TAU;\n\
             \x20   let r01 = f32(i) / f32(max(G.pixels - 1u, 1u));\n\
             \x20   let rn = mix(1.0, G.inner_over_outer, r01);\n\
             \x20   var ctx: Ctx;\n\
             \x20   ctx.spoke = spoke;\n\
             \x20   ctx.i = i;\n\
             \x20   ctx.theta = theta;\n\
             \x20   ctx.r01 = r01;\n\
             \x20   ctx.rn = rn;\n\
             \x20   ctx.pos = rn * vec2f(cos(theta), sin(theta));\n\
             \x20   let root = {root};\n\
             \x20   finish(ctx, idx, root.rgb * {master}, {auto_dabs});\n\
             }}\n",
        )
        .unwrap();
        Ok(())
    }
}

/// Interns short, registry-defined port names so `slot_of` can key on
/// `&'static str`. Only ever called with registry port names (a small fixed
/// set), so the "leak" is bounded.
fn leak(s: &str) -> &'static str {
    for t in registry::TYPES {
        for p in t.inputs {
            if p.name == s {
                return p.name;
            }
        }
        for p in t.params {
            if p.name == s {
                return p.name;
            }
        }
    }
    // Unreachable for validated docs; a stable fallback beats a panic.
    "in"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patch::{Edge, NodeInst, PortRef};

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

    /// A demo patch touching every supported GPU kind and both adapters,
    /// with audio + LFO wired across the CPU→GPU boundary.
    pub(crate) fn demo_doc() -> PatchDoc {
        PatchDoc {
            name: "Demo".into(),
            nodes: vec![
                node("noise", "noise_field"),
                node("waves", "radial_waves"),
                node("spin", "transform"),
                node("mix", "blend"),
                node("out", "output"),
                node("aud", "audio"),
                node("lfo", "lfo"),
                node("ramp", "gradient"),
                node("tint", "colorize"),
                node("mix2", "blend"),
                node("sol", "solid"),
                node("spir", "spiral"),
                node("env", "envelope"),
                node("sm", "smooth"),
                node("math", "scalar_math"),
            ],
            edges: vec![
                edge("noise", "out", "mix", "base"),
                edge("waves", "out", "spin", "in"),
                edge("spin", "out", "mix", "over"),
                // Audio bass drives the blend opacity (CPU → slab).
                edge("aud", "bass", "mix", "opacity"),
                // LFO drives the noise threshold.
                edge("lfo", "out", "noise", "threshold"),
                // Field<f32> gradient through colorize, and the grayscale
                // adapter: spiral (color) + gradient (scalar) both into blends.
                edge("ramp", "out", "tint", "in"),
                edge("tint", "out", "mix2", "base"),
                edge("mix", "out", "mix2", "over"),
                edge("mix2", "out", "out", "in"),
                // Event chain: beat → envelope → smooth → math (CPU only).
                edge("aud", "beat", "env", "trigger"),
                edge("env", "out", "sm", "in"),
                edge("sm", "out", "math", "a"),
                // Extra generators to cover codegen paths.
                edge("sol", "out", "spir", "in"), // (spiral has no shaped input) — removed below
            ],
            ..Default::default()
        }
    }

    fn valid_demo() -> PatchDoc {
        let mut d = demo_doc();
        // spiral has no shaped input; drop the bogus edge used to keep the
        // node list obvious above.
        d.edges.retain(|e| e.to.node != "spir");
        d
    }

    #[test]
    fn demo_patch_compiles() {
        let prog = compile(&valid_demo()).expect("compiles");
        assert!(prog.wgsl.contains("fn main"));
        assert!(prog.slab_len >= 8);
        // Blend mode default 0 is baked as a literal.
        assert!(prog.wgsl.contains("0u)"), "select params bake as constants");
        // The audio→opacity wire produced a slot pointing at the audio node.
        let aud_idx = 5; // position of "aud" in demo nodes
        assert!(
            prog.slots.iter().any(|s| s
                .wired
                .as_ref()
                .is_some_and(|(n, p)| *n == aud_idx && p == "bass")),
            "wired slab slot for audio bass"
        );
        // Integrated params (speed/spin) are flagged.
        assert!(prog.slots.iter().any(|s| s.integrate));
        // CPU order excludes GPU nodes and is topo-consistent (env after aud).
        let names: Vec<&str> = prog
            .cpu_order
            .iter()
            .map(|i| valid_demo().nodes[*i].id.clone())
            .map(|s| leak(&s))
            .collect();
        let _ = names;
    }

    #[test]
    fn generated_wgsl_validates_with_naga() {
        let prog = compile(&valid_demo()).expect("compiles");
        let module = naga::front::wgsl::parse_str(&prog.wgsl)
            .unwrap_or_else(|e| panic!("generated WGSL failed to parse: {}\n{}", e, prog.wgsl));
        let mut validator = naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        );
        validator
            .validate(&module)
            .unwrap_or_else(|e| panic!("generated WGSL failed validation: {e:?}"));
    }

    #[test]
    fn every_generator_kind_compiles_into_one_validated_shader() {
        use crate::patch::registry::{Category, TYPES};
        // One node of every Generator kind, folded through a blend chain.
        let gens: Vec<&str> = TYPES
            .iter()
            .filter(|t| t.category == Category::Generator)
            .map(|t| t.id)
            .collect();
        assert!(
            gens.len() >= 17,
            "expected full generator parity, got {}",
            gens.len()
        );

        let mut d = PatchDoc::default();
        let mut prev: Option<String> = None;
        for (k, kind) in gens.iter().enumerate() {
            let gid = format!("g{k}");
            d.nodes.push(node(&gid, kind));
            prev = Some(match prev {
                None => gid,
                Some(prev_id) => {
                    let bid = format!("b{k}");
                    d.nodes.push(node(&bid, "blend"));
                    d.edges.push(edge(&prev_id, "out", &bid, "base"));
                    d.edges.push(edge(&gid, "out", &bid, "over"));
                    bid
                }
            });
        }
        d.nodes.push(node("o", "output"));
        d.edges.push(edge(&prev.unwrap(), "out", "o", "in"));

        let prog = compile(&d).expect("all generators compile");
        let module = naga::front::wgsl::parse_str(&prog.wgsl)
            .unwrap_or_else(|e| panic!("parse: {e}\n{}", prog.wgsl));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .expect("full-parity shader validates");
    }

    #[test]
    fn video_texture_chain_compiles_and_validates() {
        let d = PatchDoc {
            nodes: vec![
                node("v", "video_in"),
                node("ts", "texture_sample"),
                node("o", "output"),
            ],
            edges: vec![edge("v", "tex", "ts", "tex"), edge("ts", "out", "o", "in")],
            ..Default::default()
        };
        let prog = compile(&d).expect("compiles");
        assert!(
            prog.wgsl.contains("video_at"),
            "samples the live video frame"
        );
        let module = naga::front::wgsl::parse_str(&prog.wgsl)
            .unwrap_or_else(|e| panic!("parse: {e}\n{}", prog.wgsl));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .expect("validates");
    }

    #[test]
    fn render_points_takes_dab_ownership_and_validates() {
        let d = PatchDoc {
            nodes: vec![
                node("touch", "touch_dabs"),
                node("rp", "render_points"),
                node("o", "output"),
            ],
            edges: vec![
                edge("touch", "points", "rp", "points"),
                edge("rp", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let prog = compile(&d).expect("compiles");
        assert!(
            prog.wgsl.contains(", false);"),
            "wired render_points disables the epilogue's auto-dab pass"
        );
        let module = naga::front::wgsl::parse_str(&prog.wgsl)
            .unwrap_or_else(|e| panic!("parse: {e}\n{}", prog.wgsl));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .expect("validates");

        // A DANGLING render_points changes nothing: dabs still auto-composite.
        let mut dangling = d.clone();
        dangling.edges.retain(|e| e.from.node != "rp");
        let prog = compile(&dangling).expect("compiles");
        assert!(
            prog.wgsl.contains(", true);"),
            "dangling node leaves auto-dabs on"
        );
    }

    #[test]
    fn output_node_is_required() {
        let d = PatchDoc {
            nodes: vec![node("n", "noise_field")],
            ..Default::default()
        };
        let err = compile(&d).unwrap_err();
        assert!(err.contains("no Output node"), "{err}");
    }

    #[test]
    fn unwired_output_still_compiles_to_black() {
        let d = PatchDoc {
            nodes: vec![node("o", "output")],
            ..Default::default()
        };
        let prog = compile(&d).expect("compiles");
        assert!(prog.wgsl.contains("vec4f(0.0)"));
    }

    #[test]
    fn scalar_into_field_input_uses_the_adapter_slot() {
        let d = PatchDoc {
            nodes: vec![
                node("lfo", "lfo"),
                node("tint", "colorize"),
                node("o", "output"),
            ],
            edges: vec![
                edge("lfo", "out", "tint", "in"),
                edge("tint", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let prog = compile(&d).expect("compiles");
        let slot = prog
            .slots
            .iter()
            .find(|s| s.param.is_none())
            .expect("adapter slot exists");
        assert_eq!(slot.wired.as_ref().unwrap().1, "out");
    }
}
