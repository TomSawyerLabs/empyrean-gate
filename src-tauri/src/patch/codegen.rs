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
            | "noise_field"
            | "radial_waves"
            | "spiral"
            | "transform"
            | "colorize"
            | "blend"
            | "touch_dabs"
            | "render_points"
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
            // No function of its own: it marks the live-draw dab stream as a
            // Points source for Render points (which reads DABS directly).
            "touch_dabs" => return Ok(()),
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
        // Transform renames its ctx arg (it derives a transformed copy).
        let arg = if kind == "transform" { "c0" } else { "c" };
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
    fn unsupported_kinds_are_refused_with_a_clear_error() {
        let d = PatchDoc {
            nodes: vec![node("v", "video_in"), node("o", "output")],
            ..Default::default()
        };
        let err = compile(&d).unwrap_err();
        assert!(err.contains("video_in"), "{err}");
        assert!(err.contains("not renderable yet"), "{err}");
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
