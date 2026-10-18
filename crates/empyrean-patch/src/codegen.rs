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

use super::code;
use super::registry;
use super::validate::{self, Validated};
use super::{NodeInst, PatchDoc, Shape};
use std::collections::HashMap;
use std::fmt::Write as _;

/// Capacity of the GPU parameter slab (f32 slots). 256 nodes × ~8 params fits.
pub const MAX_SLAB_FLOATS: usize = 2048;

/// Mini-preview cell cap: bounds the preview dispatch (spokes × pixels × N
/// invocations) and the batch bandwidth. Patches past the cap preview their
/// first N field nodes in graph order.
pub const MAX_PREVIEW_NODES: usize = 32;
/// Radial samples per spoke in a mini-preview cell. The polar math is fully
/// normalized (`r01 = i / (pixels - 1)`), so a shorter spoke renders the same
/// pattern — 16 samples is plenty for a thumbnail under ~120 px.
pub const MINI_PIXELS: u32 = 16;
/// Scalar-meter cap for the same reason (each is only 8 bytes per batch, but
/// the meta list and the UI both want a bound).
pub const MAX_PREVIEW_SCALARS: usize = 64;

/// The runtime library every generated shader starts with: bindings, the
/// per-pixel `Ctx`, noise/colour helpers, and the effect/dab renderers.
pub const PATCH_LIB_WGSL: &str = include_str!("../shaders/patch_lib.wgsl");

/// Everything the engine + evaluator need to run one compiled patch.
#[derive(Debug, Clone)]
pub struct Program {
    pub wgsl: String,
    pub slab_len: usize,
    pub slots: Vec<SlabSlot>,
    /// CPU (Scalar/Event) node indices in dependency order.
    pub cpu_order: Vec<usize>,
    /// (to_node, to_port) → (from_node, from_port), for CPU-side input lookup.
    pub wires: HashMap<(usize, String), (usize, String)>,
    /// Companion module for per-node mini previews: same node functions and
    /// parameter slab, but the entry point renders `preview_cells[slot]`'s
    /// output into `OUT[slot * spokes * pixels + pix]`. Empty when the patch
    /// has no field nodes to preview.
    pub preview_wgsl: String,
    /// What each preview cell slot renders.
    pub preview_cells: Vec<PreviewCell>,
    /// CPU node scalar outputs (doc node index, port) for amplitude meters.
    pub preview_scalars: Vec<(usize, String)>,
    /// Where each GPU Code node's body sits in `wgsl` (and `preview_wgsl`,
    /// which shares the node functions), so a shader error can point at the
    /// user's own lines (see [`Program::relocate_error`]).
    pub code_lines: Vec<CodeLines>,
    /// Still image nodes and their media cell (1..=MAX_PATCH_IMAGES), in
    /// document order; the host uploads each node's image to its cell.
    pub images: Vec<(usize, u32)>,
    /// The document this program was generated from, with every sub-patch
    /// inlined: every node index above refers to it.
    pub doc: PatchDoc,
    /// Live param changes addressed to a sub-patch node, mapped to the
    /// inlined node (see `flatten::Flat::aliases`).
    pub aliases: HashMap<(String, String), (String, String)>,
}

/// One f32 in the parameter slab, filled by the evaluator every frame.
#[derive(Debug, Clone)]
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

/// One mini-preview cell: a node's principal output (`port` None: its `out`,
/// or what a stream/texture source would draw), or one more field output of
/// a Code node, by name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewCell {
    pub node: usize,
    pub port: Option<String>,
}

impl Program {
    /// The key of each preview cell, in slot order: the node id, or
    /// `"<id>:<port>"` for a Code node's extra outputs. Hosts prefix it with
    /// `node:` to name the mini.
    pub fn preview_keys(&self) -> Vec<String> {
        self.preview_cells
            .iter()
            .map(|c| {
                let id = &self.doc.nodes[c.node].id;
                match &c.port {
                    Some(p) => format!("{id}:{p}"),
                    None => id.clone(),
                }
            })
            .collect()
    }
}

/// Where a GPU Code node's body landed in the generated module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeLines {
    /// Doc node index (into `Program::doc`).
    pub node: usize,
    /// 1-based line of `wgsl` holding the body's first line.
    pub first: usize,
    /// Lines in the body.
    pub count: usize,
}

impl Program {
    /// For a 1-based line of `wgsl`, the Code node whose body holds it and
    /// the 1-based line within that body.
    pub fn code_line(&self, line: usize) -> Option<(usize, usize)> {
        self.code_lines
            .iter()
            .find(|c| line >= c.first && line < c.first + c.count)
            .map(|c| (c.node, line - c.first + 1))
    }

    /// `msg` with every `wgsl:L:C` location (naga's and WebGPU's habit) that
    /// falls inside a Code node's body rewritten as `Code node "<name>" line
    /// N:C`, so the error reads against what the user typed. Locations
    /// elsewhere in the module are left alone.
    pub fn relocate_error(&self, msg: &str) -> String {
        const KEY: &str = "wgsl:";
        let mut out = String::with_capacity(msg.len());
        let mut rest = msg;
        while let Some(at) = rest.find(KEY) {
            out.push_str(&rest[..at]);
            let after = &rest[at + KEY.len()..];
            let digits = |s: &str| s.bytes().take_while(u8::is_ascii_digit).count();
            let l = digits(after);
            let (line, col, consumed) = match (l > 0, after[l..].strip_prefix(':')) {
                (true, Some(tail)) => {
                    let c = digits(tail);
                    if c > 0 {
                        (after[..l].parse::<usize>().ok(), tail[..c].parse::<usize>().ok(), l + 1 + c)
                    } else {
                        (None, None, 0)
                    }
                }
                _ => (None, None, 0),
            };
            match (line, col, consumed) {
                (Some(line), Some(col), consumed) if consumed > 0 => {
                    if let Some((node, body_line)) = self.code_line(line) {
                        let n = &self.doc.nodes[node];
                        let name = if n.name.is_empty() { n.id.as_str() } else { n.name.as_str() };
                        let _ = write!(out, "Code node \"{name}\" line {body_line}:{col}");
                    } else {
                        out.push_str(&rest[at..at + KEY.len() + consumed]);
                    }
                    rest = &after[consumed..];
                }
                _ => {
                    out.push_str(KEY);
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        out
    }
}

/// How a node's principal output thumbnails. Field nodes render their own
/// function. The stream and texture sources have no function (their
/// consumers read the buffers directly), so they preview as their default
/// consumer would draw them with every knob at 1: the strokes with their own
/// pens, the effects this chain carries, the texture mapped straight onto the
/// ring. The cell shows what the node hands on before any downstream knobs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PreviewStyle {
    Color,
    Gray,
    Points,
    Effects,
    Texture,
}

fn preview_style(node: &NodeInst) -> Option<PreviewStyle> {
    match node.kind.as_str() {
        "output" => return None,
        "touch_dabs" => return Some(PreviewStyle::Points),
        "effects_in" | "event_effect" => return Some(PreviewStyle::Effects),
        "video_in" | "image_in" | "clip" => return Some(PreviewStyle::Texture),
        _ => {}
    }
    // A Code node previews its principal output; built-ins their `out`.
    let shape = match node.code() {
        Some(def) => def.principal().map(|p| p.shape),
        None => registry::lookup(&node.kind)?.output_shape("out"),
    };
    match shape {
        Some(Shape::FieldColor) => Some(PreviewStyle::Color),
        Some(Shape::FieldScalar) => Some(PreviewStyle::Gray),
        _ => None,
    }
}

/// Whether this node gets a mini-preview cell.
pub fn previewable(node: &NodeInst) -> bool {
    preview_style(node).is_some()
}

/// Node kinds that read raw touch. A patch containing any of them owns the
/// touch surface: hosts send it raw touches instead of applying a tap or pen
/// tool (see crate::touch).
pub const TOUCH_KINDS: &[&str] = &["touch", "touch_mask", "touch_glow"];

/// Whether `doc` reads raw touch (and so owns the touch surface).
pub fn uses_touch(doc: &PatchDoc) -> bool {
    doc.nodes.iter().any(|n| TOUCH_KINDS.contains(&n.kind.as_str()))
}

/// Validate + transpile a patch. The single entry point the server (activation
/// check) and the engine (pipeline build) both use.
pub fn compile(doc: &PatchDoc) -> Result<Program, String> {
    // Sub-patches are inlined first; everything below sees plain nodes, and
    // the evaluator holds the same flattened document (`Program::doc`).
    let flat = crate::flatten::flatten(doc)?;
    let validated =
        validate::validate(&flat.doc).map_err(|errs| validate::errors_to_string(&errs))?;
    let mut prog = compile_validated(&flat.doc, &validated)?;
    prog.doc = flat.doc;
    prog.aliases = flat.aliases;
    Ok(prog)
}

fn compile_validated(doc: &PatchDoc, validated: &Validated) -> Result<Program, String> {
    let output = validated
        .output
        .ok_or_else(|| "patch has no Output node".to_string())?;

    for n in &doc.nodes {
        // A Note is text on the canvas: nothing to run.
        if n.kind == registry::NOTE_KIND {
            continue;
        }
        if !n.is_cpu() && !n.is_gpu() {
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
        .filter(|i| doc.nodes[*i].is_cpu())
        .collect();
    let gpu_order: Vec<usize> = validated
        .order
        .iter()
        .copied()
        .filter(|i| doc.nodes[*i].is_gpu())
        .collect();

    // -- Slab allocation ----------------------------------------------------
    let mut slots: Vec<SlabSlot> = Vec::new();
    // (node, param-or-port name) → slot index, for expression generation.
    let mut slot_of: HashMap<(usize, String), usize> = HashMap::new();
    for &i in &gpu_order {
        let node = &doc.nodes[i];
        for (name, knob) in node.knobs() {
            let slot = slots.len();
            slots.push(SlabSlot {
                slot,
                node: i,
                param: Some(name.clone()),
                wired: wires.get(&(i, name.clone())).cloned(),
                integrate: knob.integrate,
            });
            slot_of.insert((i, name), slot);
        }
        // Scalar wires adapted into shaped field inputs (e.g. LFO → Colorize.in).
        for (name, shape) in node.shaped_inputs() {
            if shape != Shape::FieldScalar {
                continue;
            }
            if let Some((from, port)) = wires.get(&(i, name.clone()))
                && doc.nodes[*from].is_cpu()
            {
                let slot = slots.len();
                slots.push(SlabSlot {
                    slot,
                    node: i,
                    param: None,
                    wired: Some((*from, port.clone())),
                    integrate: false,
                });
                slot_of.insert((i, name), slot);
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
    // Still image and Clip nodes own media cells 1.. in document order.
    let images: Vec<(usize, u32)> = doc
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| validate::owns_media_cell(&n.kind))
        .zip(1u32..)
        .map(|((i, _), slot)| (i, slot))
        .collect();
    let g = Gen {
        doc,
        images: &images,
        wires: &wires,
        slot_of: &slot_of,
        symbolic: false,
    };
    let mut code = String::new();
    code.push_str(PATCH_LIB_WGSL);
    code.push_str("\n// ---- generated from the patch graph ----\n");
    let mut code_lines = Vec::new();
    for &i in &gpu_order {
        if i == output {
            continue;
        }
        if doc.nodes[i].kind == code::KIND {
            code_lines.push(g.code_fn(&mut code, i)?);
        } else {
            g.node_fn(&mut code, i)?;
        }
    }
    // Fork before the entry point: the preview module reuses the same node
    // functions (and therefore the same parameter-slab layout) with a per-node
    // thumbnail main instead of the composited one.
    let mut preview_code = code.clone();
    g.main_fn(&mut code, output)?;

    // Field nodes and the stream/texture sources in graph order, then the
    // Event effects (CPU nodes whose effects stream previews like Triggered
    // effects does).
    // A Code node previews every field output: its principal one as the
    // node's cell, the others by port name.
    let preview_cells: Vec<PreviewCell> = gpu_order
        .iter()
        .copied()
        .chain(
            cpu_order
                .iter()
                .copied()
                .filter(|&i| doc.nodes[i].kind == "event_effect"),
        )
        .filter(|&i| previewable(&doc.nodes[i]))
        .flat_map(|i| {
            let node = &doc.nodes[i];
            let mut cells = vec![PreviewCell { node: i, port: None }];
            if let Some(def) = node.code() {
                let principal = def.principal().map(|p| p.name.clone());
                cells.extend(
                    def.outputs
                        .iter()
                        .filter(|p| matches!(p.shape, Shape::FieldColor | Shape::FieldScalar))
                        .filter(|p| Some(&p.name) != principal.as_ref())
                        .map(|p| PreviewCell {
                            node: i,
                            port: Some(p.name.clone()),
                        }),
                );
            }
            cells
        })
        .take(MAX_PREVIEW_NODES)
        .collect();
    let preview_wgsl = if preview_cells.is_empty() {
        String::new()
    } else {
        g.preview_main_fn(&mut preview_code, &preview_cells)?;
        preview_code
    };
    let preview_scalars: Vec<(usize, String)> = cpu_order
        .iter()
        .copied()
        .flat_map(|i| {
            // Events meter too: the runtime reports a fire count for them.
            doc.nodes[i]
                .outputs()
                .into_iter()
                .filter(|(_, shape)| matches!(shape, Shape::Scalar | Shape::Event))
                .map(move |(name, _)| (i, name))
        })
        .take(MAX_PREVIEW_SCALARS)
        .collect();

    Ok(Program {
        wgsl: code,
        slab_len: slots.len().max(1),
        slots,
        cpu_order,
        wires,
        preview_wgsl,
        preview_cells,
        preview_scalars,
        code_lines,
        images,
        doc: PatchDoc::default(),
        aliases: HashMap::new(),
    })
}

struct Gen<'a> {
    doc: &'a PatchDoc,
    images: &'a [(usize, u32)],
    wires: &'a HashMap<(usize, String), (usize, String)>,
    slot_of: &'a HashMap<(usize, String), usize>,
    /// "Convert to Code" mode: knob refs are the knob's (port) name, field
    /// inputs the port's name (`name_at(ctx)` when sampled elsewhere), so a
    /// node's body reads as a Code node body. See `convert`.
    symbolic: bool,
}

/// A built-in GPU node's body as a Code node body would write it: knobs and
/// inputs by port name (see `Gen::symbolic`), one `return` at the end.
pub fn builtin_body(doc: &PatchDoc, node: usize) -> Result<String, String> {
    let wires = HashMap::new();
    let slot_of = HashMap::new();
    let g = Gen {
        doc,
        images: &[],
        wires: &wires,
        slot_of: &slot_of,
        symbolic: true,
    };
    g.body_of(node)
}

impl Gen<'_> {
    /// What a texture input samples: the live video (cell 0) for Video in,
    /// the upstream Still image's own media cell, or the current frame of the
    /// upstream Clip's sheet.
    fn texture_sample_expr(&self, node: usize) -> String {
        if self.symbolic {
            return "tex_at(uv)".to_string();
        }
        match self.upstream(node, "tex") {
            Some((from, _)) => self.texture_source_expr(*from),
            None => "video_at(uv)".to_string(),
        }
    }

    /// The RGBA a texture source node holds at `uv`: the live video frame,
    /// the Still image's own media cell, or the current frame of the Clip's
    /// sheet. Anything else reads as the live video.
    fn texture_source_expr(&self, from: usize) -> String {
        let slot = self
            .images
            .iter()
            .find(|(i, _)| *i == from)
            .map(|(_, s)| *s)
            .unwrap_or(0);
        match self.doc.nodes[from].kind.as_str() {
            "image_in" => format!("image_at({slot}u, uv)"),
            "clip" => {
                let grid = [4u32, 8, 2][self.select(from, "grid").min(2) as usize];
                format!(
                    "clip_at({slot}u, uv, clip_frame({phase}, {frames}, {mode}u, {scrub}), {grid}u)",
                    phase = self.p(from, "fps"),
                    frames = self.p(from, "frames"),
                    mode = self.select(from, "mode"),
                    scrub = self.p(from, "scrub"),
                )
            }
            _ => "video_at(uv)".to_string(),
        }
    }

    /// The effect sources a stream wired into `node.port` carries, walking
    /// back through chained Event effects: 0 for Triggered effects (clients),
    /// each Event effect's `effect_source`. Sorted, unique.
    fn effect_sources(&self, node: usize, port: &str) -> Vec<u32> {
        self.effect_sources_from(self.upstream(node, port).map(|(from, _)| *from))
    }

    /// `effect_sources` for a chain whose head is `head` itself.
    fn effect_sources_from(&self, head: Option<usize>) -> Vec<u32> {
        let mut out = Vec::new();
        let mut at = head;
        // A chain is acyclic (validated) and at most every node long.
        for _ in 0..=self.doc.nodes.len() {
            let Some(i) = at else { break };
            match self.doc.nodes[i].kind.as_str() {
                "effects_in" => {
                    out.push(0);
                    break;
                }
                "event_effect" => {
                    out.push(crate::effects::effect_source(&self.doc.nodes[i].id));
                    at = self.upstream(i, "in").map(|(from, _)| *from);
                }
                _ => break,
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// `P[..]` reference for a knob (Number param, or a Code node's Scalar
    /// input) of a GPU node.
    fn p(&self, node: usize, param: &str) -> String {
        if self.symbolic {
            return crate::convert::port_name(param);
        }
        let slot = self
            .slot_of
            .get(&(node, param.to_string()))
            .copied()
            .expect("param slot allocated");
        format!("P[{slot}u]")
    }

    /// The function that evaluates `from`'s `port`, for a field consumer.
    /// Built-ins have one output, `n{from}_f`; a Code node has one accessor
    /// per declared output.
    fn field_fn(&self, from: usize, port: &str) -> String {
        if self.doc.nodes[from].code().is_some() {
            format!("n{from}_o_{port}")
        } else {
            format!("n{from}_f")
        }
    }

    /// Baked value of a Select param (a compile-time constant).
    fn select(&self, node: usize, param: &str) -> u32 {
        let def = self.doc.nodes[node].param_def(param).expect("select param");
        (self.doc.nodes[node].param(param).round()).clamp(def.min, def.max) as u32
    }

    /// Whether anything is wired into `port` of `node`. Read off the
    /// document, so it holds in symbolic mode too (Convert to Code keeps
    /// the wires).
    fn wired(&self, node: usize, port: &str) -> bool {
        let id = &self.doc.nodes[node].id;
        self.doc.edges.iter().any(|e| e.to.node == *id && e.to.port == port)
    }

    fn upstream(&self, node: usize, port: &str) -> Option<&(usize, String)> {
        self.wires.get(&(node, port.to_string()))
    }

    /// In symbolic mode, a field input by its port name: its value here, or
    /// its `_at` form sampled at `ctx`.
    fn symbolic_input(&self, port: &str, ctx: &str) -> String {
        let name = crate::convert::port_name(port);
        if ctx == "c" { name } else { format!("{name}_at({ctx})") }
    }

    /// Expression for a Field<color> input port, sampling at `ctx`.
    fn color_input(&self, node: usize, port: &str, ctx: &str) -> String {
        if self.symbolic {
            return self.symbolic_input(port, ctx);
        }
        match self.upstream(node, port) {
            None => "vec4f(0.0)".into(),
            Some((from, from_port)) => {
                let f = self.field_fn(*from, from_port);
                match self.doc.nodes[*from].output_shape(from_port) {
                    Some(Shape::FieldColor) => format!("{f}({ctx})"),
                    Some(Shape::FieldScalar) => format!("gray({f}({ctx}))"),
                    _ => "vec4f(0.0)".into(),
                }
            }
        }
    }

    /// Expression for a Field<f32> input port, sampling at `ctx`.
    fn scalar_field_input(&self, node: usize, port: &str, ctx: &str) -> String {
        if self.symbolic {
            return self.symbolic_input(port, ctx);
        }
        match self.upstream(node, port) {
            None => "0.0".into(),
            Some((from, from_port)) => {
                if self.doc.nodes[*from].is_cpu() {
                    // Scalar → uniform-field adapter: the slab slot allocated
                    // for this wire.
                    let slot = self.slot_of.get(&(node, port.to_string())).copied();
                    match slot {
                        Some(s) => format!("P[{s}u]"),
                        None => "0.0".into(),
                    }
                } else {
                    format!("{}({ctx})", self.field_fn(*from, from_port))
                }
            }
        }
    }

    /// A Code node: its body inside a function that binds every port by
    /// name (see `code`). Scalar inputs read the slab; field inputs are
    /// sampled at `c` and also offered as `<name>_at(ctx)` for resampling;
    /// outputs are `var`s zeroed first and gathered into a record, read
    /// through one accessor per port (`n{i}_o_<port>`) and `n{i}_f` for the
    /// principal one. Returns where the body's lines landed.
    fn code_fn(&self, code: &mut String, i: usize) -> Result<CodeLines, String> {
        let node = &self.doc.nodes[i];
        let def = node.code().ok_or("Code node without code")?;
        let ty = |s: Shape| if s == Shape::FieldColor { "vec4f" } else { "f32" };
        let zero = |s: Shape| if s == Shape::FieldColor { "vec4f(0.0)" } else { "0.0" };
        let fields: Vec<&str> = def
            .inputs
            .iter()
            .filter(|p| p.shape != Shape::Scalar)
            .map(|p| p.name.as_str())
            .collect();
        let effects: Vec<&str> = def
            .inputs
            .iter()
            .filter(|p| p.shape == Shape::Effects)
            .map(|p| p.name.as_str())
            .collect();

        writeln!(code, "\nstruct N{i}Out {{").unwrap();
        for p in &def.outputs {
            writeln!(code, "    {}: {},", p.name, ty(p.shape)).unwrap();
        }
        code.push_str("}\n");
        for p in def.inputs.iter().filter(|p| p.shape != Shape::Scalar) {
            let name = &p.name;
            match p.shape {
                // A Points input: the live dabs, `name_at(k)` and `name_count`.
                Shape::Points => writeln!(
                    code,
                    "fn n{i}_in_{name}(k: u32) -> Dab {{\n    var d: Dab;\n    if k < G.dab_count {{\n        d = DABS[k];\n    }}\n    return d;\n}}"
                )
                .unwrap(),
                // An Effects input: the live effects, `name_at(k)`, and
                // `name_on(k)` for the ones this wire carries.
                Shape::Effects => {
                    let sources = self.effect_sources(i, name);
                    let wanted = if sources.is_empty() {
                        "false".to_string()
                    } else {
                        sources.iter().map(|s| format!("E.source == {s}u")).collect::<Vec<_>>().join(" || ")
                    };
                    writeln!(
                        code,
                        "fn n{i}_in_{name}(k: u32) -> Effect {{\n    var e: Effect;\n    if k < G.effect_count {{\n        e = FX[k];\n    }}\n    return e;\n}}\n\
                         fn n{i}_on_{name}(k: u32) -> bool {{\n    if k >= G.effect_count {{\n        return false;\n    }}\n    let E = FX[k];\n    return {wanted};\n}}"
                    )
                    .unwrap();
                }
                // A Texture input: `name_at(uv)` samples the source wired in.
                Shape::Texture => {
                    let expr = match self.upstream(i, name) {
                        Some((from, _)) => self.texture_source_expr(*from),
                        None => "vec4f(0.0)".to_string(),
                    };
                    writeln!(code, "fn n{i}_in_{name}(uv: vec2f) -> vec4f {{\n    let _unused = uv.x;\n    return {expr};\n}}").unwrap();
                }
                _ => {
                    let expr = match p.shape {
                        Shape::FieldColor => self.color_input(i, name, "c"),
                        _ => self.scalar_field_input(i, name, "c"),
                    };
                    writeln!(
                        code,
                        "fn n{i}_in_{name}(c: Ctx) -> {ty} {{\n    let _unused = c.rn;\n    return {expr};\n}}",
                        ty = ty(p.shape),
                    )
                    .unwrap();
                }
            }
        }
        writeln!(code, "fn n{i}_all(c: Ctx) -> N{i}Out {{").unwrap();
        writeln!(code, "    let _unused = c.rn;").unwrap();
        for p in &def.outputs {
            writeln!(code, "    var {}: {} = {};", p.name, ty(p.shape), zero(p.shape)).unwrap();
        }
        for p in &def.inputs {
            let name = &p.name;
            match p.shape {
                Shape::Scalar => writeln!(code, "    let {name} = {};", self.p(i, name)).unwrap(),
                Shape::Points => {
                    let count = if self.upstream(i, name).is_some() { "G.dab_count" } else { "0u" };
                    writeln!(code, "    let {name}_count: u32 = {count};").unwrap();
                }
                Shape::Effects => {
                    let count = if self.effect_sources(i, name).is_empty() { "0u" } else { "G.effect_count" };
                    writeln!(code, "    let {name}_count: u32 = {count};").unwrap();
                }
                Shape::Texture => writeln!(
                    code,
                    "    let {name} = n{i}_in_{name}(vec2f(0.5 + c.pos.x * 0.5, 0.5 - c.pos.y * 0.5));"
                )
                .unwrap(),
                _ => writeln!(code, "    let {name} = n{i}_in_{name}(c);").unwrap(),
            }
        }
        let record = format!(
            "N{i}Out({})",
            def.outputs.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")
        );
        code.push_str("    {\n");
        let first = code.matches('\n').count() + 1;
        let count = def.body.split('\n').count();
        code.push_str(&code::rewrite_body(&def.body, i, &fields, &effects, &record));
        code.push_str("\n    }\n");
        let record = def
            .outputs
            .iter()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        writeln!(code, "    return N{i}Out({record});\n}}").unwrap();
        for p in &def.outputs {
            writeln!(
                code,
                "fn n{i}_o_{name}(c: Ctx) -> {ty} {{\n    return n{i}_all(c).{name};\n}}",
                name = p.name,
                ty = ty(p.shape),
            )
            .unwrap();
        }
        let principal = def.principal().ok_or("Code node without outputs")?;
        writeln!(
            code,
            "fn n{i}_f(c: Ctx) -> {ty} {{\n    return n{i}_all(c).{name};\n}}",
            name = principal.name,
            ty = ty(principal.shape),
        )
        .unwrap();
        Ok(CodeLines {
            node: i,
            first,
            count,
        })
    }

    fn node_fn(&self, code: &mut String, i: usize) -> Result<(), String> {
        let kind = self.doc.nodes[i].kind.as_str();
        let body = self.body_of(i)?;
        if body.is_empty() {
            // A stream/texture source: no function of its own.
            return Ok(());
        }
        let ret = match registry::lookup(kind).and_then(|t| t.output_shape("out")) {
            Some(Shape::FieldScalar) => "f32",
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

    /// The WGSL body of a built-in GPU node (the statements inside its
    /// `n<i>_f`), or an empty string for the stream/texture sources, which
    /// have no function of their own.
    fn body_of(&self, i: usize) -> Result<String, String> {
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
            "perlin_noise" => format!(
                "    let p = vec3f(c.pos * {scale}, {phase});\n\
                 \x20   let v = perlin_fbm(p, {harmonics}, {roughness}, {spacing}, {style}u, u32(max({seed}, 0.0)) * 7919u);\n\
                 \x20   return clamp(0.5 + (v - 0.5) * {contrast}, 0.0, 1.0);",
                scale = self.p(i, "scale"),
                phase = self.p(i, "speed"),
                harmonics = self.p(i, "harmonics"),
                roughness = self.p(i, "roughness"),
                spacing = self.p(i, "spacing"),
                style = self.select(i, "style"),
                seed = self.p(i, "seed"),
                contrast = self.p(i, "contrast"),
            ),
            "random_field" => {
                // The physical LED, spoke or ring: Transform does not move it.
                let cell = match self.select(i, "grain") {
                    1 => "wang_hash(c.spoke + 0x6a09e667u)",
                    2 => "wang_hash(c.i + 0xbb67ae85u)",
                    _ => "wang_hash(c.spoke * 65599u + c.i)",
                };
                format!(
                    "    let roll = u32(max(floor({rate}), 0.0));\n\
                     \x20   let s = wang_hash((u32(max({seed}, 0.0)) * 2654435761u) ^ roll);\n\
                     \x20   return hash01({cell} ^ s);",
                    rate = self.p(i, "rate"),
                    seed = self.p(i, "seed"),
                )
            }
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
                let first = format!(
                    "    let base = {base};\n\
                     \x20   let over = {over};\n\
                     \x20   let op = clamp({op}, 0.0, 1.0);\n\
                     \x20   let over_a = clamp(over.a * op, 0.0, 1.0);\n",
                    base = self.color_input(i, "base", "c"),
                    over = self.color_input(i, "over", "c"),
                    op = self.p(i, "opacity"),
                );
                let composite = format!(
                    "vec4f(apply_blend(base.rgb, over, op, {mode}u), over_a + base.a * (1.0 - over_a))"
                );
                // Layers 2.. composite onto the result in order; an unwired
                // one is left out (a Multiply layer of nothing would
                // blacken everything under it).
                let layers: Vec<u32> = (2..=self.doc.nodes[i].layer_count())
                    .filter(|&k| self.wired(i, &registry::layer_name("over", k)))
                    .collect();
                if layers.is_empty() {
                    format!("{first}    return {composite};")
                } else {
                    let mut body = format!("{first}    var acc = {composite};\n");
                    for k in layers {
                        let name = |n: &str| registry::layer_name(n, k);
                        body.push_str(&format!(
                            "    let over{k} = {over};\n\
                             \x20   let op{k} = clamp({op}, 0.0, 1.0);\n\
                             \x20   let over{k}_a = clamp(over{k}.a * op{k}, 0.0, 1.0);\n\
                             \x20   acc = vec4f(apply_blend(acc.rgb, over{k}, op{k}, {mode}u), over{k}_a + acc.a * (1.0 - over{k}_a));\n",
                            over = self.color_input(i, &name("over"), "c"),
                            op = self.p(i, &name("opacity")),
                            mode = self.select(i, &name("mode")),
                        ));
                    }
                    body.push_str("    return acc;");
                    body
                }
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
            "touch_mask" => format!(
                "    return touch_mask(c, {radius}, {soft}, {fade}, {grow}, {trail}) * {intensity};",
                radius = self.p(i, "radius"),
                soft = self.p(i, "soft"),
                fade = self.p(i, "fade"),
                grow = self.p(i, "grow"),
                trail = self.p(i, "trail"),
                intensity = self.p(i, "intensity"),
            ),
            "touch_glow" => format!(
                "    let g = touch_glow(c, {radius}, {soft}, {fade}, {grow}, {trail});
                     return vec4f(g.rgb * {intensity}, g.a);",
                radius = self.p(i, "radius"),
                soft = self.p(i, "soft"),
                fade = self.p(i, "fade"),
                grow = self.p(i, "grow"),
                trail = self.p(i, "trail"),
                intensity = self.p(i, "intensity"),
            ),
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
            "cosmic_drift" => format!(
                "    // A handful of wide, coherent travellers reads as depth on 64 spokes;\n\
                 \x20   // independent per-pixel stars only read as glitter at this sampling density.\n\
                 \x20   let dir = vec2f(cos(c.theta), sin(c.theta));\n\
                 \x20   let z = c.r01 * (2.2 + {depth} * 2.8) - {phase} * 0.045;\n\
                 \x20   let bend = snoise3(vec3f(dir * 1.15, z * 0.32));\n\
                 \x20   let q = vec3f(dir * (1.25 + bend * 0.16), z);\n\
                 \x20   let cloud = 0.5 + 0.5 * fbm3(q * (0.72 + {depth} * 0.46) + vec3f(0.0, 0.0, {phase} * 0.012), 3u);\n\
                 \x20   let filament_n = snoise3(q * 1.55 + vec3f(8.7, -3.1, {phase} * 0.018));\n\
                 \x20   let filament = pow(clamp(1.0 - abs(filament_n) * 1.7, 0.0, 1.0), 3.0);\n\
                 \x20   var travellers = 0.0;\n\
                 \x20   var traveller_hue = 0.0;\n\
                 \x20   for (var k = 0u; k < 6u; k++) {{\n\
                 \x20       let seed = hash01(k * 1619u + 47u);\n\
                 \x20       let cycle = fract(seed + {phase} * (0.016 + hash01(k * 3571u) * 0.012));\n\
                 \x20       let head = 1.08 - cycle * 1.30;\n\
                 \x20       let behind = c.r01 - head;\n\
                 \x20       let lane = seed * TAU + bend * 0.12 + sin(z * 0.42 + seed * TAU) * 0.035;\n\
                 \x20       let da = ang_dist(c.theta, lane);\n\
                 \x20       let aw = 0.085 + cycle * 0.075;\n\
                 \x20       let across = exp(-(da * da) / (aw * aw));\n\
                 \x20       let tail = exp(-max(behind, 0.0) / (0.055 + {trail} * 0.20));\n\
                 \x20       let body = step(0.0, behind) * step(behind, 0.42) * tail;\n\
                 \x20       let head_glow = exp(-(behind * behind) / 0.0018);\n\
                 \x20       let star = across * max(body * 0.46, head_glow);\n\
                 \x20       if star > travellers {{ traveller_hue = hash01(k * 811u); }}\n\
                 \x20       travellers = max(travellers, star);\n\
                 \x20   }}\n\
                 \x20   let base_hue = {h} + cloud * {hr} * 0.72;\n\
                 \x20   let base_v = (0.060 + cloud * cloud * 0.27 + filament * 0.23) * {bright};\n\
                 \x20   let base = hsv2rgb(base_hue, {sat}, base_v);\n\
                 \x20   let star = hsv2rgb({h} + {hr} * (0.35 + traveller_hue * 0.65), {sat} * 0.28, travellers * {bright} * (1.20 + {pulse} * 0.38));\n\
                 \x20   return vec4f(base + star, 1.0);",
                depth = self.p(i, "depth"),
                phase = self.p(i, "speed"),
                trail = self.p(i, "trail"),
                pulse = self.p(i, "pulse"),
                h = self.p(i, "hue"),
                hr = self.p(i, "hue_range"),
                sat = self.p(i, "saturation"),
                bright = self.p(i, "brightness"),
            ),
            "earth_current" => format!(
                "    // Three broad canopy layers drift at different rates. Their low spatial\n\
                 \x20   // frequencies survive the Gate's 64 angular samples as leafy masses.\n\
                 \x20   let t = {phase} * 0.075;\n\
                 \x20   let base_p = c.pos * (0.78 + {scale} * 0.58);\n\
                 \x20   let gust = vec2f(t * 0.24 + sin(t * 0.61) * 0.10, sin(t * 0.47) * 0.13);\n\
                 \x20   let bend_a = snoise3(vec3f(base_p * 0.58, t * 0.38));\n\
                 \x20   let bend_b = snoise3(vec3f(base_p.yx * 0.54 + vec2f(12.7, -4.8), t * 0.31));\n\
                 \x20   let bend = vec2f(bend_a, bend_b) * (0.10 + {warp} * 0.34);\n\
                 \x20   let q1 = base_p + bend + gust;\n\
                 \x20   let q2 = base_p * 1.31 - bend * 0.72 + gust * 0.63 + vec2f(7.4, -3.2);\n\
                 \x20   let q3 = base_p * 1.82 + bend * 0.46 + gust * 0.38 + vec2f(-5.1, 9.6);\n\
                 \x20   let broad = 0.5 + 0.5 * fbm3(vec3f(q1 * 0.62, t * 0.16), 3u);\n\
                 \x20   let n1 = 0.5 + 0.5 * snoise3(vec3f(q1 * 1.34, t * 0.29));\n\
                 \x20   let n2 = 0.5 + 0.5 * snoise3(vec3f(q2 * 1.58, t * 0.23));\n\
                 \x20   let n3 = 0.5 + 0.5 * snoise3(vec3f(q3 * 1.76, t * 0.19));\n\
                 \x20   let cover = clamp({width}, 0.0, 1.0);\n\
                 \x20   let leaf1 = smoothstep(0.62 - cover * 0.10, 0.78 - cover * 0.05, n1 + broad * 0.11);\n\
                 \x20   let leaf2 = smoothstep(0.66 - cover * 0.09, 0.81 - cover * 0.04, n2 + broad * 0.08);\n\
                 \x20   let leaf3 = smoothstep(0.72 - cover * 0.07, 0.86 - cover * 0.03, n3 + broad * 0.05);\n\
                 \x20   let cluster = smoothstep(0.42, 0.66, broad);\n\
                 \x20   let deep = hsv2rgb({root_hue}, {sat} * 0.92, cluster * (0.030 + broad * 0.080) * {bright});\n\
                 \x20   let forest = hsv2rgb({leaf_hue} + 0.055, {sat} * 0.94, leaf1 * (0.10 + broad * 0.24) * {bright});\n\
                 \x20   let fern = hsv2rgb({leaf_hue} - 0.030, {sat} * 0.86, leaf2 * (0.10 + n2 * 0.32) * {bright});\n\
                 \x20   let sun = hsv2rgb({leaf_hue} - 0.105, {sat} * 0.66, leaf3 * (0.12 + n3 * 0.38 + {pulse} * 0.10) * {bright});\n\
                 \x20   let canopy = max(cluster * 0.42, max(leaf1, max(leaf2, leaf3)));\n\
                 \x20   return vec4f((deep + forest + fern + sun) * smoothstep(0.03, 0.34, canopy), 1.0);",
                phase = self.p(i, "speed"),
                scale = self.p(i, "scale"),
                warp = self.p(i, "warp"),
                width = self.p(i, "width"),
                pulse = self.p(i, "pulse"),
                root_hue = self.p(i, "root_hue"),
                leaf_hue = self.p(i, "leaf_hue"),
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
            "touch_dabs" => return Ok(String::new()),
            // Marker for the live triggered-effect stream. Render effects reads
            // the bounded FX buffer directly.
            "effects_in" => return Ok(String::new()),
            // Likewise: marks the live video frame as a Texture source.
            "video_in" => return Ok(String::new()),
            // Still images use that same browser-decoded RGBA texture, but a
            // separate source node makes the patch's media contract explicit.
            "image_in" => return Ok(String::new()),
            // A Clip is a Still image whose sheet holds frames; sampled by
            // Texture sample through `clip_at`.
            "clip" => return Ok(String::new()),
            "coordinate" => {
                let which = match self.select(i, "which") {
                    // rn runs inner_over_outer..1; after a Transform it is the
                    // transformed radius, which is what a field should see.
                    0 => "clamp((c.rn - G.inner_over_outer) / max(1.0 - G.inner_over_outer, 0.001), 0.0, 1.0)",
                    1 => "fract(c.theta / TAU + 1.0)",
                    2 => "c.pos.x * 0.5 + 0.5",
                    3 => "c.pos.y * 0.5 + 0.5",
                    4 => "f32(c.spoke) / f32(max(G.spokes, 1u))",
                    _ => "c.r01",
                };
                let wrap = if self.select(i, "wrap") == 1 { "fract(t)" } else { "t" };
                format!(
                    "    let t = ({which}) * {scale} + {offset};\n\
                     \x20   return {wrap};",
                    scale = self.p(i, "scale"),
                    offset = self.p(i, "offset"),
                )
            }
            "feedback" => format!(
                "    let fb = feedback_at(c) * clamp({decay}, 0.0, 1.0);\n\
                 \x20   return vec4f(fb, clamp(max(fb.r, max(fb.g, fb.b)), 0.0, 1.0));",
                decay = self.p(i, "decay"),
            ),
            "field_math" => {
                let op = match self.select(i, "op") {
                    0 => "a + b",
                    1 => "a - b",
                    2 => "a * b",
                    3 => "min(a, b)",
                    4 => "max(a, b)",
                    5 => "abs(a - b)",
                    6 => "select(0.0, 1.0, a > b)",
                    7 => "smoothstep(b - 0.1, b + 0.1, a)",
                    8 => "1.0 - a",
                    _ => "pow(max(a, 0.0), b)",
                };
                format!(
                    "    let a = {a};\n\
                     \x20   let b = {b};\n\
                     \x20   return ({op}) * {gain} + {offset};",
                    a = self.scalar_field_input(i, "a", "c"),
                    b = self.scalar_field_input(i, "b", "c"),
                    gain = self.p(i, "gain"),
                    offset = self.p(i, "offset"),
                )
            }
            "luminance" => {
                let measure = match self.select(i, "measure") {
                    0 => "dot(s.rgb, vec3f(0.2126, 0.7152, 0.0722))",
                    1 => "max(s.r, max(s.g, s.b))",
                    _ => "s.a",
                };
                format!(
                    "    let s = {input};\n\
                     \x20   return {measure};",
                    input = self.color_input(i, "in", "c"),
                )
            }
            "color_adjust" => {
                let invert = if self.select(i, "invert") == 1 { "1.0 - rgb" } else { "rgb" };
                format!(
                    "    let s = {input};\n\
                     \x20   let hsv = rgb2hsv(max(s.rgb, vec3f(0.0)));\n\
                     \x20   var rgb = hsv2rgb(hsv.x + {hue}, clamp(hsv.y * {sat}, 0.0, 1.0), hsv.z * max({bright}, 0.0));\n\
                     \x20   rgb = (rgb - vec3f(0.5)) * max({contrast}, 0.0) + vec3f(0.5);\n\
                     \x20   rgb = clamp(rgb, vec3f(0.0), vec3f(4.0));\n\
                     \x20   return vec4f({invert}, s.a);",
                    input = self.color_input(i, "in", "c"),
                    hue = self.p(i, "hue"),
                    sat = self.p(i, "saturation"),
                    bright = self.p(i, "brightness"),
                    contrast = self.p(i, "contrast"),
                )
            }
            "palette" => format!(
                "    let v = {input};\n\
                 \x20   let col = cosine_palette(v * {cycles} + {offset}, {which}u) * max({bright}, 0.0);\n\
                 \x20   return vec4f(col, clamp(v, 0.0, 1.0));",
                input = self.scalar_field_input(i, "in", "c"),
                cycles = self.p(i, "cycles"),
                offset = self.p(i, "offset"),
                which = self.select(i, "palette"),
                bright = self.p(i, "brightness"),
            ),
            "texture_sample" => {
                if !self.symbolic && self.upstream(i, "tex").is_none() {
                    "    return vec4f(0.0);".to_string()
                } else {
                    format!(
                        "    let c = ctx_transform(c0, {rot} * TAU, {zoom}, {kal}, 0.0);
                             let uv = vec2f(0.5 + c.pos.x * 0.5, 0.5 - c.pos.y * 0.5);
                             let s = {sample};
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
                        sample = self.texture_sample_expr(i),
                    )
                }
            }
            "render_points" => {
                if self.symbolic {
                    // The Points port idiom of a Code node (see `code_fn`).
                    let pen = self.select(i, "pen");
                    let override_kind = if pen == 0 { String::new() } else { format!("        D.kind = {}u;\n", pen - 1) };
                    format!(
                        "    var acc = vec3f(0.0);\n\
                         \x20   for (var d = 0u; d < points_count; d++) {{\n\
                         \x20       var D = points_at(d);\n\
                         {override_kind}\
                         \x20       D.size = D.size * size;\n\
                         \x20       D.intensity = D.intensity * intensity;\n\
                         \x20       acc += dab_color(D, c, d);\n\
                         \x20   }}\n\
                         \x20   return vec4f(acc, clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0));"
                    )
                } else if self.upstream(i, "points").is_none() {
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
            "render_effects" => {
                let sources = self.effect_sources(i, "effects");
                if self.symbolic {
                    // The Effects port idiom of a Code node (see `code_fn`).
                    "    var acc = vec3f(0.0);\n\
                     \x20   for (var e = 0u; e < effects_count; e++) {\n\
                     \x20       if !effects_on(e) {\n\
                     \x20           continue;\n\
                     \x20       }\n\
                     \x20       var E = effects_at(e);\n\
                     \x20       E.size = E.size * size;\n\
                     \x20       E.intensity = E.intensity * intensity;\n\
                     \x20       acc += effect_color(E, c);\n\
                     \x20   }\n\
                     \x20   return vec4f(acc, clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0));"
                        .to_string()
                } else if sources.is_empty() {
                    "    return vec4f(0.0);".to_string()
                } else {
                    let wanted = sources
                        .iter()
                        .map(|s| format!("E.source == {s}u"))
                        .collect::<Vec<_>>()
                        .join(" || ");
                    format!(
                        "    var acc = vec3f(0.0);\n\
                         \x20   for (var e = 0u; e < G.effect_count; e++) {{\n\
                         \x20       var E = FX[e];\n\
                         \x20       if !({wanted}) {{\n\
                         \x20           continue;\n\
                         \x20       }}\n\
                         \x20       E.size = E.size * {size};\n\
                         \x20       E.intensity = E.intensity * {intensity};\n\
                         \x20       acc += effect_color(E, c);\n\
                         \x20   }}\n\
                         \x20   return vec4f(acc, clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0));",
                        size = self.p(i, "size"),
                        intensity = self.p(i, "intensity"),
                    )
                }
            }
            other => return Err(format!("no GPU codegen for node kind \"{other}\"")),
        };
        Ok(body)
    }

    fn main_fn(&self, code: &mut String, output: usize) -> Result<(), String> {
        let root = self.color_input(output, "in", "ctx");
        let master = self.p(output, "master");
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
             \x20   let theta = f32(spoke) / f32(G.spokes) * TAU - G.rotation;\n\
             \x20   let r01 = f32(i) / f32(max(G.pixels - 1u, 1u));\n\
             \x20   let rn = mix(1.0, G.inner_over_outer, r01);\n\
             \x20   var ctx: Ctx;\n\
             \x20   ctx.spoke = u32(fract(theta / TAU + 1.0) * f32(G.spokes)) % G.spokes;\n\
             \x20   ctx.i = i;\n\
             \x20   ctx.theta = theta;\n\
             \x20   ctx.r01 = r01;\n\
             \x20   ctx.rn = rn;\n\
             \x20   ctx.pos = rn * vec2f(cos(theta), sin(theta));\n\
             \x20   let root = {root};\n\
             \x20   finish(ctx, idx, root.rgb * {master});\n\
             }}\n",
        )
        .unwrap();
        Ok(())
    }
}

impl Gen<'_> {
    /// The mini-preview entry point: one thumbnail per previewable node (see
    /// [`preview_style`]). Invocation space is `spokes * pixels * slots`; each
    /// slot renders its node's output alone — no master and nothing it does
    /// not carry itself, so the cell shows exactly what that node hands
    /// downstream.
    fn preview_main_fn(&self, code: &mut String, cells: &[PreviewCell]) -> Result<(), String> {
        let mut cases = String::new();
        for (slot, cell) in cells.iter().enumerate() {
            let i = cell.node;
            let node = &self.doc.nodes[i];
            // A Code node's extra output: its own accessor and shape.
            let style = match &cell.port {
                Some(port) => match node.output_shape(port) {
                    Some(Shape::FieldColor) => Some(PreviewStyle::Color),
                    Some(Shape::FieldScalar) => Some(PreviewStyle::Gray),
                    _ => None,
                },
                None => preview_style(node),
            };
            let f = match &cell.port {
                Some(port) => format!("n{i}_o_{port}"),
                None => format!("n{i}_f"),
            };
            let expr = match style {
                Some(PreviewStyle::Color) => format!("{f}(ctx).rgb"),
                Some(PreviewStyle::Gray) => format!("vec3f(clamp({f}(ctx), 0.0, 1.0))"),
                Some(style) => {
                    self.preview_stream_fn(code, i, style);
                    format!("n{i}_pv(ctx)")
                }
                None => return Err(format!("node kind \"{}\" is not previewable", node.kind)),
            };
            let _ = writeln!(cases, "        case {slot}u: {{ acc = {expr}; }}");
        }
        write!(
            code,
            "\n@compute @workgroup_size(256)\n\
             fn main(@builtin(global_invocation_id) gid: vec3u) {{\n\
             \x20   let idx = gid.x;\n\
             \x20   let total = G.spokes * G.pixels;\n\
             \x20   if idx >= total * {slots}u {{\n\
             \x20       return;\n\
             \x20   }}\n\
             \x20   PREVIEW = true;\n\
             \x20   let slot = idx / total;\n\
             \x20   let pix = idx % total;\n\
             \x20   let spoke = pix / G.pixels;\n\
             \x20   let i = pix % G.pixels;\n\
             \x20   let theta = f32(spoke) / f32(G.spokes) * TAU - G.rotation;\n\
             \x20   let r01 = f32(i) / f32(max(G.pixels - 1u, 1u));\n\
             \x20   let rn = mix(1.0, G.inner_over_outer, r01);\n\
             \x20   var ctx: Ctx;\n\
             \x20   ctx.spoke = u32(fract(theta / TAU + 1.0) * f32(G.spokes)) % G.spokes;\n\
             \x20   ctx.i = i;\n\
             \x20   ctx.theta = theta;\n\
             \x20   ctx.r01 = r01;\n\
             \x20   ctx.rn = rn;\n\
             \x20   ctx.pos = rn * vec2f(cos(theta), sin(theta));\n\
             \x20   var acc = vec3f(0.0);\n\
             \x20   switch slot {{\n\
             {cases}\
             \x20       default: {{}}\n\
             \x20   }}\n\
             \x20   let knee = vec3f(0.8);\n\
             \x20   let over = max(acc - knee, vec3f(0.0));\n\
             \x20   acc = min(acc, knee) + over / (1.0 + over * 2.5);\n\
             \x20   acc = clamp(acc, vec3f(0.0), vec3f(1.0));\n\
             \x20   let r = u32(acc.r * 255.0 + 0.5);\n\
             \x20   let g = u32(acc.g * 255.0 + 0.5);\n\
             \x20   let b = u32(acc.b * 255.0 + 0.5);\n\
             \x20   OUT[idx] = r | (g << 8u) | (b << 16u);\n\
             }}\n",
            slots = cells.len(),
        )
        .unwrap();
        Ok(())
    }
}

impl Gen<'_> {
    /// `n{i}_pv`, the preview-only renderer for a stream or texture source:
    /// what Render points / Render effects / Texture sample would draw from it
    /// with every knob at its neutral value.
    fn preview_stream_fn(&self, code: &mut String, i: usize, style: PreviewStyle) {
        let body = match style {
            PreviewStyle::Points => "    var acc = vec3f(0.0);\n\
                 \x20   for (var d = 0u; d < G.dab_count; d++) {\n\
                 \x20       let D = DABS[d];\n\
                 \x20       acc += dab_color(D, c, d);\n\
                 \x20   }\n\
                 \x20   return acc;"
                .to_string(),
            PreviewStyle::Effects => {
                // Its own chain: Triggered effects is source 0; an Event effect
                // carries its own fires plus whatever is chained into `in`.
                let wanted = self
                    .effect_sources_from(Some(i))
                    .iter()
                    .map(|s| format!("E.source == {s}u"))
                    .collect::<Vec<_>>()
                    .join(" || ");
                format!(
                    "    var acc = vec3f(0.0);\n\
                     \x20   for (var e = 0u; e < G.effect_count; e++) {{\n\
                     \x20       let E = FX[e];\n\
                     \x20       if !({wanted}) {{\n\
                     \x20           continue;\n\
                     \x20       }}\n\
                     \x20       acc += effect_color(E, c);\n\
                     \x20   }}\n\
                     \x20   return acc;"
                )
            }
            PreviewStyle::Texture => format!(
                "    let uv = vec2f(0.5 + c.pos.x * 0.5, 0.5 - c.pos.y * 0.5);\n\
                 \x20   let s = {sample};\n\
                 \x20   return select(vec3f(0.0), s.rgb, s.a > 0.0);",
                sample = self.texture_source_expr(i),
            ),
            PreviewStyle::Color | PreviewStyle::Gray => unreachable!("field nodes use n{i}_f"),
        };
        writeln!(code, "\nfn n{i}_pv(c: Ctx) -> vec3f {{").unwrap();
        writeln!(code, "{body}").unwrap();
        code.push_str("}\n");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Edge, NodeInst, PortRef};

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
        let names: Vec<String> = prog
            .cpu_order
            .iter()
            .map(|i| valid_demo().nodes[*i].id.clone())
            .collect();
        let env = names.iter().position(|n| n == "env").unwrap();
        let aud = names.iter().position(|n| n == "aud").unwrap();
        assert!(aud < env, "audio before the envelope it triggers: {names:?}");
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
    fn preview_module_validates_and_lists_field_nodes() {
        let doc = valid_demo();
        let prog = compile(&doc).expect("compiles");
        // Every previewable node (and only those) gets a cell, in graph order.
        assert!(!prog.preview_cells.is_empty());
        for cell in &prog.preview_cells {
            let i = cell.node;
            let kind = &doc.nodes[i].kind;
            assert!(
                previewable(&doc.nodes[i]) && kind != "output",
                "cell for non-previewable node {kind}"
            );
        }
        // CPU scalar outputs become meters — the audio node's bands among them.
        assert!(
            prog.preview_scalars
                .iter()
                .any(|(node, port)| doc.nodes[*node].kind == "audio" && *port == "bass"),
            "audio bass meter missing: {:?}",
            prog.preview_scalars
        );
        // The companion module is real WGSL with its own main.
        let module = naga::front::wgsl::parse_str(&prog.preview_wgsl)
            .unwrap_or_else(|e| panic!("preview WGSL failed to parse: {e}\n{}", prog.preview_wgsl));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .expect("preview WGSL validates");
    }

    /// The stream and texture sources get cells too, each drawn by its
    /// default consumer: strokes with their pens, an effects chain's own
    /// sources, the texture straight onto the ring.
    #[test]
    fn stream_and_texture_sources_get_preview_cells() {
        let doc = PatchDoc {
            nodes: vec![
                node("t", "touch_dabs"),
                node("clients", "effects_in"),
                node("ev", "event_effect"),
                node("v", "video_in"),
                node("img", "image_in"),
                node("clip", "clip"),
                node("bg", "solid"),
                node("o", "output"),
            ],
            edges: vec![
                edge("clients", "effects", "ev", "in"),
                edge("bg", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let prog = compile(&doc).expect("compiles");
        let cells: Vec<&str> = prog
            .preview_cells
            .iter()
            .map(|c| doc.nodes[c.node].id.as_str())
            .collect();
        for id in ["t", "clients", "ev", "v", "img", "clip", "bg"] {
            assert!(cells.contains(&id), "no cell for {id}: {cells:?}");
        }
        assert!(!cells.contains(&"o"));
        let w = &prog.preview_wgsl;
        assert!(w.contains("dab_color(D, c, d)"), "strokes draw their dabs");
        assert!(w.contains("E.source == 0u"), "Triggered effects draws source 0");
        let own = crate::effects::effect_source("ev");
        assert!(
            w.contains(&format!("E.source == 0u || E.source == {own}u"))
                || w.contains(&format!("E.source == {own}u || E.source == 0u")),
            "the Event effect draws its chain and itself"
        );
        assert!(w.contains("video_at(uv)"), "Video in samples the live frame");
        assert!(w.contains("image_at(1u, uv)"), "Still image samples its own cell");
        assert!(w.contains("clip_at(2u, uv"), "Clip samples its sheet");
        validates(w);
    }

    /// The round-4 field nodes, chained, make one shader naga accepts, and
    /// Clip / Feedback reach the helpers they rely on.
    #[test]
    fn field_nodes_clip_and_feedback_validate() {
        let mut clip = node("clip", "clip");
        clip.media = Some("data:image/png;base64,AAAA".into());
        clip.params.insert("grid".into(), 1.0);
        clip.params.insert("mode".into(), 1.0);
        let mut math = node("fm", "field_math");
        math.params.insert("op".into(), 7.0);
        let d = PatchDoc {
            nodes: vec![
                node("co", "coordinate"),
                node("lfo", "lfo"),
                math,
                node("pal", "palette"),
                node("adj", "color_adjust"),
                node("lum", "luminance"),
                node("fb", "feedback"),
                node("spin", "transform"),
                node("mix", "blend"),
                clip,
                node("ts", "texture_sample"),
                node("mix2", "blend"),
                node("o", "output"),
            ],
            edges: vec![
                edge("co", "out", "fm", "a"),
                edge("lfo", "out", "fm", "b"),
                edge("fm", "out", "pal", "in"),
                edge("pal", "out", "adj", "in"),
                edge("adj", "out", "lum", "in"),
                edge("fb", "out", "spin", "in"),
                edge("spin", "out", "mix", "base"),
                edge("lum", "out", "mix", "over"),
                edge("clip", "tex", "ts", "tex"),
                edge("mix", "out", "mix2", "base"),
                edge("ts", "out", "mix2", "over"),
                edge("mix2", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let prog = compile(&d).expect("compiles");
        validates(&prog.wgsl);
        validates(&prog.preview_wgsl);
        assert_eq!(prog.images, vec![(9, 1)], "the clip owns media cell 1");
        assert!(prog.wgsl.contains("clip_at(1u, uv, clip_frame("), "{}", prog.wgsl);
        assert!(prog.wgsl.contains(", 1u, "), "ping-pong mode is baked in");
        assert!(prog.wgsl.contains("), 8u)"), "an 8×8 sheet");
        assert!(prog.wgsl.contains("feedback_at(c)"));
        assert!(prog.wgsl.contains("smoothstep(b - 0.1, b + 0.1, a)"));
        assert!(prog.preview_wgsl.contains("PREVIEW = true;"));
        // The clip's fps is integrated into a frame phase.
        assert!(prog.slots.iter().any(|s| s.node == 9 && s.param.as_deref() == Some("fps") && s.integrate));
    }

    /// A registry kind that neither kind list knows compiles to "not
    /// renderable yet"; every palette entry must be live.
    #[test]
    fn every_registry_kind_compiles() {
        for ty in registry::TYPES {
            if ty.id == "output" {
                continue;
            }
            let mut n = node("n", ty.id);
            if ty.id == code::KIND {
                // A Code node is nothing without its definition.
                n.code = Some(Box::new(code_def(&[], &[("out", Shape::FieldColor)], "out = vec4f(c.r01);")));
            }
            let doc = PatchDoc {
                nodes: vec![n, node("o", "output")],
                ..Default::default()
            };
            compile(&doc).unwrap_or_else(|e| panic!("{}: {e}", ty.id));
        }
    }

    fn code_def(inputs: &[(&str, Shape)], outputs: &[(&str, Shape)], body: &str) -> code::CodeDef {
        let port = |(name, shape): &(&str, Shape)| code::CodePort {
            name: name.to_string(),
            shape: *shape,
            min: 0.0,
            max: 2.0,
            default: 1.0,
            integrate: false,
        };
        code::CodeDef {
            inputs: inputs.iter().map(port).collect(),
            outputs: outputs.iter().map(port).collect(),
            body: body.to_string(),
        }
    }

    fn validate_wgsl(label: &str, wgsl: &str) {
        let module = naga::front::wgsl::parse_str(wgsl)
            .unwrap_or_else(|e| panic!("{label} failed to parse: {e}\n{wgsl}"));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .unwrap_or_else(|e| panic!("{label} failed validation: {e:?}\n{wgsl}"));
    }

    /// A GPU Code node: scalar inputs from the slab (one wired from a CPU
    /// node), a colour and a grey field input (the latter from a CPU node,
    /// through the uniform-field adapter), `_at` resampling, two outputs
    /// read by two consumers, a thumbnail, and body lines on record.
    #[test]
    fn gpu_code_node_compiles_and_validates() {
        let mut c = node("c", code::KIND);
        c.code = Some(Box::new(code_def(
            &[
                ("gain", Shape::Scalar),
                ("spin", Shape::Scalar),
                ("img", Shape::FieldColor),
                ("mask", Shape::FieldScalar),
            ],
            &[("out", Shape::FieldColor), ("edge", Shape::FieldScalar)],
            "// resample the image a quarter turn on, scaled by the grey input\n\
             let turned = img_at(ctx_transform(c, spin * TAU, 1.0, 0.0, 0.0));\n\
             out = vec4f(turned.rgb * gain * mask, 1.0);\n\
             edge = step(0.5, c.r01) * mask_at(c);",
        )));
        let doc = PatchDoc {
            nodes: vec![
                node("lfo", "lfo"),
                node("noise", "noise_color"),
                c,
                node("tint", "colorize"),
                node("mix", "blend"),
                node("o", "output"),
            ],
            edges: vec![
                edge("lfo", "out", "c", "spin"),
                edge("lfo", "out", "c", "mask"),
                edge("noise", "out", "c", "img"),
                edge("c", "out", "mix", "base"),
                edge("c", "edge", "tint", "in"),
                edge("tint", "out", "mix", "over"),
                edge("mix", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let prog = compile(&doc).unwrap_or_else(|e| panic!("{e}"));
        validate_wgsl("main", &prog.wgsl);
        validate_wgsl("preview", &prog.preview_wgsl);
        assert!(prog.wgsl.contains("fn n2_in_img(c: Ctx) -> vec4f"));
        assert!(prog.wgsl.contains("n2_in_img(ctx_transform("), "img_at was rewritten");
        assert!(prog.wgsl.contains("n2_o_edge(ctx)") || prog.wgsl.contains("n2_o_edge(c)"), "Colorize reads the edge port");
        assert!(prog.wgsl.contains("n2_f("), "Blend reads the principal output");
        // Both scalar inputs are knobs in the slab; spin is wired.
        let gain = prog.slots.iter().find(|s| s.node == 2 && s.param.as_deref() == Some("gain")).unwrap();
        assert!(gain.wired.is_none());
        let spin = prog.slots.iter().find(|s| s.node == 2 && s.param.as_deref() == Some("spin")).unwrap();
        assert_eq!(spin.wired, Some((0, "out".to_string())));
        // The grey field input wired from the LFO got an adapter slot.
        assert!(prog.slots.iter().any(|s| s.node == 2 && s.param.is_none() && s.wired.is_some()));
        // The node's cell is its principal output; `edge` gets a cell of its own.
        let keys = prog.preview_keys();
        assert!(keys.contains(&"c".to_string()), "{keys:?}");
        assert!(keys.contains(&"c:edge".to_string()), "{keys:?}");
        assert!(prog.preview_wgsl.contains("n2_o_edge(ctx)"), "the extra cell renders the port");
        // Body lines are on record and resolve back to the body.
        let lines = &prog.code_lines;
        assert_eq!(lines.len(), 1);
        assert_eq!((lines[0].node, lines[0].count), (2, 4));
        let wgsl_lines: Vec<&str> = prog.wgsl.lines().collect();
        assert!(wgsl_lines[lines[0].first - 1].starts_with("// resample"), "{}", wgsl_lines[lines[0].first - 1]);
        assert_eq!(prog.code_line(lines[0].first + 2), Some((2, 3)));
        assert_eq!(prog.code_line(lines[0].first + 4), None);
        let msg = format!("error: no such thing\n ┌─ wgsl:{}:12\n │ and wgsl:3:1 elsewhere", lines[0].first + 1);
        let moved = prog.relocate_error(&msg);
        assert!(moved.contains("Code node \"c\" line 2:12"), "{moved}");
        assert!(moved.contains("wgsl:3:1"), "{moved}");
    }

    /// A CPU Code node sits in the evaluator order, meters its outputs, and
    /// its scalar output reaches the shader like any CPU node's would.
    #[test]
    fn cpu_code_node_is_a_cpu_node() {
        let mut c = node("c", code::KIND);
        c.code = Some(Box::new(code_def(
            &[("beat", Shape::Event), ("level", Shape::Scalar)],
            &[("out", Shape::Scalar), ("tick", Shape::Event)],
            "if beat { state.n += 1.0; } out = level * state.n; tick = beat;",
        )));
        let doc = PatchDoc {
            nodes: vec![node("aud", "audio"), c, node("sol", "solid"), node("o", "output")],
            edges: vec![
                edge("aud", "beat", "c", "beat"),
                edge("aud", "bass", "c", "level"),
                edge("c", "out", "sol", "brightness"),
                edge("sol", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let prog = compile(&doc).unwrap_or_else(|e| panic!("{e}"));
        validate_wgsl("main", &prog.wgsl);
        assert_eq!(prog.cpu_order, vec![0, 1]);
        assert!(prog.code_lines.is_empty());
        assert!(prog.preview_scalars.contains(&(1, "out".to_string())));
        assert!(prog.preview_scalars.contains(&(1, "tick".to_string())));
        assert!(!prog.preview_cells.iter().any(|c| c.node == 1));
        let slot = prog.slots.iter().find(|s| s.node == 2 && s.param.as_deref() == Some("brightness")).unwrap();
        assert_eq!(slot.wired, Some((1, "out".to_string())));
    }

    /// Bad Code nodes are refused with a message naming the node.
    #[test]
    fn broken_code_nodes_are_refused() {
        let refuse = |def: code::CodeDef, what: &str| {
            let mut c = node("c", code::KIND);
            c.code = Some(Box::new(def));
            let doc = PatchDoc {
                nodes: vec![c, node("o", "output")],
                ..Default::default()
            };
            let err = compile(&doc).expect_err(what);
            assert!(err.contains("Code node \"c\""), "{what}: {err}");
            err
        };
        let e = refuse(code_def(&[], &[("out", Shape::Scalar)], "out = ;"), "syntax");
        assert!(e.contains("line 1:7"), "{e}");
        refuse(code_def(&[("let", Shape::Scalar)], &[("out", Shape::Scalar)], ""), "keyword port");
        refuse(code_def(&[], &[], ""), "no outputs");
        refuse(code_def(&[("img", Shape::FieldColor)], &[("out", Shape::Scalar)], ""), "field into cpu");
        // No definition at all, and a definition on the wrong kind.
        let doc = PatchDoc {
            nodes: vec![node("c", code::KIND), node("o", "output")],
            ..Default::default()
        };
        assert!(compile(&doc).unwrap_err().contains("no code"));
        let mut s = node("s", "solid");
        s.code = Some(Box::new(code_def(&[], &[("out", Shape::Scalar)], "")));
        let doc = PatchDoc {
            nodes: vec![s, node("o", "output")],
            ..Default::default()
        };
        assert!(compile(&doc).unwrap_err().contains("only Code nodes"));
    }

    #[test]
    fn every_generator_kind_compiles_into_one_validated_shader() {
        use crate::registry::{Category, TYPES};
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

    /// A Blend with layers composites each wired one onto the result, with
    /// its own mode and opacity; an unwired layer is left out.
    #[test]
    fn blend_layers_fold_in_order() {
        let mut mix = node("mix", "blend");
        mix.layers = 3;
        mix.params.insert("mode3".into(), 2.0);
        let d = PatchDoc {
            nodes: vec![
                node("a", "plasma"),
                node("b", "fire"),
                node("c", "spiral"),
                node("lfo", "lfo"),
                mix,
                node("o", "output"),
            ],
            edges: vec![
                edge("a", "out", "mix", "base"),
                edge("b", "out", "mix", "over"),
                edge("c", "out", "mix", "over3"),
                edge("lfo", "out", "mix", "opacity3"),
                edge("mix", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let prog = compile(&d).expect("a layered blend compiles");
        let module = naga::front::wgsl::parse_str(&prog.wgsl)
            .unwrap_or_else(|e| panic!("parse: {e}\n{}", prog.wgsl));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .expect("layered blend validates");
        // Layer 3 is there in screen mode, layer 2 (unwired) is not.
        assert!(prog.wgsl.contains("acc = vec4f(apply_blend(acc.rgb, over3, op3, 2u)"), "{}", prog.wgsl);
        assert!(!prog.wgsl.contains("over2"), "{}", prog.wgsl);
        // Every layer's opacity is a knob in the slab; layer 3's is wired.
        let mix = d.nodes.iter().position(|n| n.id == "mix").unwrap();
        let knobs: Vec<(&str, bool)> = prog
            .slots
            .iter()
            .filter(|s| s.node == mix)
            .filter_map(|s| s.param.as_deref().map(|p| (p, s.wired.is_some())))
            .collect();
        assert_eq!(knobs, [("opacity", false), ("opacity2", false), ("opacity3", true)]);

        // One layer: the body is the two-input Blend it always was.
        let mut one = d.clone();
        one.nodes[mix].layers = 1;
        one.edges.retain(|e| e.to.port != "over3" && e.to.port != "opacity3");
        let body = builtin_body(&one, mix).unwrap();
        assert!(body.ends_with("return vec4f(apply_blend(base.rgb, over, op, 0u), over_a + base.a * (1.0 - over_a));"), "{body}");
    }

    /// Each Still image node samples its own media cell; Video in samples the
    /// live video (cell 0).
    #[test]
    fn still_images_get_their_own_slots() {
        let d = PatchDoc {
            nodes: vec![
                node("a", "image_in"),
                node("b", "image_in"),
                node("v", "video_in"),
                node("ta", "texture_sample"),
                node("tb", "texture_sample"),
                node("tv", "texture_sample"),
                node("m1", "blend"),
                node("m2", "blend"),
                node("o", "output"),
            ],
            edges: vec![
                edge("a", "tex", "ta", "tex"),
                edge("b", "tex", "tb", "tex"),
                edge("v", "tex", "tv", "tex"),
                edge("ta", "out", "m1", "base"),
                edge("tb", "out", "m1", "over"),
                edge("m1", "out", "m2", "base"),
                edge("tv", "out", "m2", "over"),
                edge("m2", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let prog = compile(&d).expect("compiles");
        assert_eq!(prog.images, vec![(0, 1), (1, 2)]);
        assert!(prog.wgsl.contains("image_at(1u, uv)"));
        assert!(prog.wgsl.contains("image_at(2u, uv)"));
        assert!(prog.wgsl.contains("video_at(uv)"));
        validates(&prog.wgsl);
    }

    #[test]
    fn image_limits_are_validated() {
        let mut d = PatchDoc {
            nodes: (0..crate::MAX_PATCH_IMAGES + 1)
                .map(|k| node(&format!("i{k}"), "image_in"))
                .chain([node("o", "output")])
                .collect(),
            ..Default::default()
        };
        assert!(compile(&d).unwrap_err().contains("at most"));
        d.nodes.truncate(1);
        d.nodes.push(node("o", "output"));
        d.nodes[0].media = Some("https://example.com/x.png".into());
        assert!(compile(&d).unwrap_err().contains("data:image"));
        d.nodes[0].media = Some("data:image/png;base64,AAAA".into());
        compile(&d).expect("a data URL is fine");
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

    fn validates(wgsl: &str) {
        let module =
            naga::front::wgsl::parse_str(wgsl).unwrap_or_else(|e| panic!("parse: {e}
{wgsl}"));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .expect("validates");
    }

    /// Nothing reaches the output unless it is wired (plans/explicit-output.md):
    /// the epilogue composites no effects and no dabs of its own.
    #[test]
    fn the_output_adds_nothing_that_is_not_wired() {
        let d = PatchDoc {
            nodes: vec![node("n", "noise_field"), node("o", "output")],
            edges: vec![edge("n", "out", "o", "in")],
            ..Default::default()
        };
        let prog = compile(&d).expect("compiles");
        assert!(prog.wgsl.contains("finish(ctx, idx, root.rgb * P["));
        let main = prog.wgsl.split("fn main(").nth(1).unwrap();
        assert!(!main.contains("FX[") && !main.contains("DABS["));
        validates(&prog.wgsl);
    }

    #[test]
    fn render_points_draws_the_wired_strokes() {
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
        assert!(prog.wgsl.contains("dab_color(D, c, d)"));
        validates(&prog.wgsl);
    }

    /// A Render effects node draws exactly the sources its chain names:
    /// Triggered effects (clients, source 0) and each chained Event effect.
    #[test]
    fn render_effects_draws_the_sources_its_chain_names() {
        let d = PatchDoc {
            nodes: vec![
                node("clients", "effects_in"),
                node("a", "event_effect"),
                node("b", "event_effect"),
                node("lone", "event_effect"),
                node("render", "render_effects"),
                node("o", "output"),
            ],
            edges: vec![
                edge("clients", "effects", "a", "in"),
                edge("a", "effects", "b", "in"),
                edge("b", "effects", "render", "effects"),
                edge("render", "out", "o", "in"),
            ],
            ..Default::default()
        };
        let prog = compile(&d).expect("compiles");
        let src = |id: &str| crate::effects::effect_source(id);
        assert!(prog.wgsl.contains("E.source == 0u"), "clients at the head");
        assert!(prog.wgsl.contains(&format!("E.source == {}u", src("a"))));
        assert!(prog.wgsl.contains(&format!("E.source == {}u", src("b"))));
        assert!(
            !prog.wgsl.contains(&format!("E.source == {}u", src("lone"))),
            "an unwired Event effect is drawn nowhere"
        );
        validates(&prog.wgsl);

        // Without the head, client effects are not drawn.
        let mut no_clients = d.clone();
        no_clients.edges.retain(|e| e.from.node != "clients");
        let prog = compile(&no_clients).expect("compiles");
        assert!(!prog.wgsl.contains("E.source == 0u"));
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
