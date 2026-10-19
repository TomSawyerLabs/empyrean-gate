//! The node-graph ("patch") pattern paradigm: typed dataflow graphs whose sink is
//! the sACN pixel array. This crate is everything about a patch that does not
//! need the host: document model, node-type registry, validation/topological
//! order, the WGSL codegen, the control-rate evaluator, the built-in presets,
//! and the GPU records the generated shader reads.
//!
//! It has no I/O and no GPU dependency, so the same code runs in the desktop
//! engine (`src-tauri`, which adds the on-disk store and the wgpu pipeline) and
//! in the browser (`crates/empyrean-patch-wasm`).
//! Design doc: `plans/node-graph.md`.

pub mod abi;
pub mod audio;
pub mod code;
pub mod codegen;
pub mod convert;
pub mod effects;
pub mod eval;
pub mod flatten;
pub mod links;
pub mod migrate;
pub mod presets;
pub mod reference;
pub mod registry;
pub mod script;
pub mod sim;
pub mod touch;
pub mod validate;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// On-disk schema version. Bump on incompatible changes; loaders refuse newer
/// formats (an older app must never silently mangle a newer patch file).
/// 2: the Output adds nothing that isn't wired (effects and pen strokes are
/// streams). 3: Still image nodes carry their own image ([`NodeInst::media`]).
/// 4: Sub-patch nodes carry another document ([`NodeInst::sub`]; Clips carry
/// a sprite sheet in `media`). 5: Code nodes carry their ports and body
/// ([`NodeInst::code`]). 6: Note nodes carry text ([`NodeInst::text`]).
/// 7: Full random, Random walk and Smooth noise are Random's modes, Radial
/// gradient is Rainbow with no turns.
/// Older files are upgraded by [`migrate::migrate`].
pub const PATCH_FORMAT: u32 = 7;

/// Pictures a patch may carry (Still image and Clip nodes), each its own
/// media cell on the GPU.
pub const MAX_PATCH_IMAGES: usize = 4;
/// Longest accepted image data URL (a 256×256 WebP is ~20–60 KB; PNG more).
pub const MAX_MEDIA_BYTES: usize = 600_000;

pub const MAX_PATCH_NODES: usize = 256;
pub const MAX_PATCH_EDGES: usize = 1024;

/// The data type flowing on a wire — the whole type system. Wires connect only
/// matching shapes, plus two blessed adapters (see [`Shape::accepts`]). Fields
/// come in two domains: the plane (`Field*`, defined at every position) and
/// the LEDs (`Led*`, defined only at the gate's physical LEDs); `validate`
/// infers which a wire carries and refuses LED data where a node would read
/// it somewhere else (see `validate::led_nodes`).
/// `Shape::description` says more, for agents and the editor
/// (`registry::shapes_json`, `shapes()` in the wasm build).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    /// Control-rate f32, evaluated on the CPU every frame: audio bands, sliders,
    /// LFOs, IMU axes. The cheap glue between everything else.
    Scalar,
    /// Discrete trigger, no value: it fired this frame or it didn't (a beat, a
    /// tap, a touch-down, a counter wrapping).
    Event,
    /// A scalar function over the polar domain (angle, radius). Symbolic on the
    /// GPU — compiled inline into WGSL, never materialized.
    FieldScalar,
    /// An RGB function over the polar domain. Every generator's output.
    FieldColor,
    /// A scalar per physical LED (spoke × pixel): defined only at the LEDs,
    /// so it can't be moved or sampled between them without Resample.
    LedScalar,
    /// An RGB colour per physical LED, as [`Shape::LedScalar`].
    LedColor,
    /// Bounded GPU array of point sprites (touch dabs, particles).
    Points,
    /// Bounded stream of triggered show effects (burst, strobe, sweep, pulse).
    Effects,
    /// Materialized 2D RGBA buffer (video frames, feedback).
    Texture,
    /// The sink: final per-pixel RGB mapped to the fixtures → sACN + preview.
    Pixels,
}

impl Shape {
    /// Every shape, in declaration order.
    pub const ALL: [Shape; 10] = [
        Shape::Scalar,
        Shape::Event,
        Shape::FieldScalar,
        Shape::FieldColor,
        Shape::LedScalar,
        Shape::LedColor,
        Shape::Points,
        Shape::Effects,
        Shape::Texture,
        Shape::Pixels,
    ];

    /// What the editor calls it.
    pub fn label(self) -> &'static str {
        match self {
            Shape::Scalar => "Scalar (number)",
            Shape::Event => "Event",
            Shape::FieldScalar => "Grey field (Field<f32>)",
            Shape::FieldColor => "Colour field (Field<color>)",
            Shape::LedScalar => "Grey LEDs (Led<f32>)",
            Shape::LedColor => "Colour LEDs (Led<color>)",
            Shape::Points => "Points",
            Shape::Effects => "Effects",
            Shape::Texture => "Texture",
            Shape::Pixels => "Pixels",
        }
    }

    /// What flows on a wire of this shape, where it is computed, and what it
    /// may connect to — for a person or an agent composing a patch. Keep in
    /// step with [`Shape::accepts`].
    pub fn description(self) -> &'static str {
        match self {
            Shape::Scalar => {
                "One number per frame, computed on the CPU: audio bands, sliders, LFOs, touch position, phone tilt. Every Number param of every node is also a Scalar input of the same name: its knob is the fallback while nothing is wired (a knob is held to its range, a wired value is not). A Scalar can drive any Scalar input and any grey-field input (as a uniform field, the same value at every pixel), but not a colour-field input directly: go through Colorize or Palette."
            }
            Shape::Event => {
                "A trigger that fires on a frame and carries no value: a beat, a tap, a touch-down, a counter wrapping. Events connect only to Event inputs, which exist only on CPU nodes (Envelope, Counter, Toggle, Random, Delay, Event effect …). Envelope, Toggle, Counter and Random turn events into Scalars; Threshold turns a Scalar into events."
            }
            Shape::FieldScalar => {
                "Field<f32>: one number per position on the plane, computed on the GPU as a function of where it is (gradients, masks, Coordinate, Touch mask, Field math, noise). Compiled inline into the patch shader, never stored, and defined everywhere, so Transform can move it. It drives grey-field inputs, and colour-field inputs as greyscale (RGB = the value, alpha = the value clamped to 0..1). A grey-field input also accepts a Scalar (as a uniform field) and Grey LEDs."
            }
            Shape::FieldColor => {
                "Field<color>: an RGB colour per position on the plane plus a 0..1 coverage alpha, computed on the GPU — nearly every generator's output. RGB may exceed 1 (the Output soft-clips); the alpha is what Blend's alpha_over and Brightness of's alpha measure read. Defined everywhere, so Transform can move it. It connects only to colour-field inputs (Transform, Blend, Color adjust, Brightness of, Output …); a colour-field input also accepts a grey field (as greyscale) and LED data, but not a Scalar."
            }
            Shape::LedScalar => {
                "Led<f32>: one number per physical LED (spoke × pixel), defined only at the LEDs — Full random field, or a Code node that reads `c.spoke` or `c.i`. A node fed LED data hands on LED data (Blend of an LED input is LED too). It drives grey and colour inputs like a grey field, except an input that reads its source somewhere else (Transform's `in`, a Code node's `name_at`): there it needs Resample first, which turns the LEDs into a plane picture."
            }
            Shape::LedColor => {
                "Led<color>: an RGB colour plus coverage alpha per physical LED, defined only at the LEDs (a node fed LED data hands on LED data). It drives colour inputs like a colour field, except one that reads its source somewhere else (Transform's `in`, a Code node's `name_at`): put Resample in between, which turns the LEDs into a plane picture. Plane data needs nothing to reach LED inputs: drawing samples it at each LED."
            }
            Shape::Points => {
                "A bounded stream of point sprites: the live-draw dabs from Touch strokes, each with its own position, pen, colour and age. Connects only to Points inputs (Render points), which draw it into a colour field."
            }
            Shape::Effects => {
                "A bounded stream of triggered show effects (bursts, strobes, sweeps, figures …) from Triggered effects (clients) and Event effect nodes. Connects only to Effects inputs: Render effects draws it into a colour field, and an Event effect's `in` merges it into that node's own stream. Render effects draws only the effects whose sources are wired into it."
            }
            Shape::Texture => {
                "A materialized RGBA picture: the live video (Video in), a picture stored in the patch (Still image in) or a sprite-sheet animation (Clip). Connects only to Texture inputs (Texture sample), which map it onto the disc as a colour field."
            }
            Shape::Pixels => {
                "The final per-pixel RGB sent to the LEDs and the preview. Reserved for the sink: no node port has this shape today (the Output node takes a colour field)."
            }
        }
    }

    /// Whether a wire carrying `from` may drive an input of this shape.
    /// Two adapters are blessed because both compile to trivial WGSL:
    /// Scalar → grey (uniform field) and grey → colour (grayscale). Nothing
    /// else converts implicitly. Judged by value type alone: the domain
    /// (plane or LEDs) is `validate`'s business, since whether LED data may
    /// flow in depends on whether the node samples that input elsewhere.
    pub fn accepts(self, from: Shape) -> bool {
        self == from
            || (self.is_grey_field() && (from == Shape::Scalar || from.is_grey_field()))
            || (self.is_color_field() && from.is_field())
    }

    /// A per-position GPU value, grey or colour, plane or LEDs.
    pub fn is_field(self) -> bool {
        self.is_grey_field() || self.is_color_field()
    }

    pub fn is_grey_field(self) -> bool {
        matches!(self, Shape::FieldScalar | Shape::LedScalar)
    }

    pub fn is_color_field(self) -> bool {
        matches!(self, Shape::FieldColor | Shape::LedColor)
    }

    pub fn is_led(self) -> bool {
        matches!(self, Shape::LedScalar | Shape::LedColor)
    }

    /// The same value type on the LEDs (a field shape; others unchanged).
    pub fn on_leds(self) -> Shape {
        match self {
            Shape::FieldScalar => Shape::LedScalar,
            Shape::FieldColor => Shape::LedColor,
            other => other,
        }
    }
}

/// One saved graph: an Empyrean Gate patch document. Nodes (instances of the
/// registry's node types) joined by edges (wires from an output port to an
/// input port) into an acyclic graph; it renders when exactly one `output`
/// node has a colour field wired into it. The file is the unit of
/// composition: a patch that exposes params becomes a Sub-patch node in other
/// patches. Every field is optional on input (missing ones take defaults).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct PatchDoc {
    /// Patch format version (currently 7). Older documents are upgraded on
    /// load; a newer one is refused rather than misread.
    pub format: u32,
    /// Stable identity (UUID string); filenames may change with renames.
    pub id: String,
    /// Display name.
    pub name: String,
    /// What the patch looks like or does, in a sentence or two.
    pub description: String,
    /// Who made it, when that is not the crew: a playground submission
    /// carries the sender's name here, and the public floor's `/health`
    /// shows it next to the patch on air. Empty for the crew's own patches.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub credit: String,
    /// The operator instances (at most 256). Ids must be unique.
    pub nodes: Vec<NodeInst>,
    /// The wires (at most 1024). An input takes at most one wire, shapes must
    /// be compatible (see the shapes table), and the graph must be acyclic.
    pub edges: Vec<Edge>,
    /// Params promoted to remote play surfaces (the Control tab) and, when
    /// this patch is used as a Sub-patch, to that node's input ports.
    pub exposed: Vec<ExposedParam>,
}

impl Default for PatchDoc {
    fn default() -> Self {
        Self {
            format: PATCH_FORMAT,
            id: String::new(),
            name: String::new(),
            description: String::new(),
            credit: String::new(),
            nodes: Vec::new(),
            edges: Vec::new(),
            exposed: Vec::new(),
        }
    }
}

/// One operator instance in a patch.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct NodeInst {
    /// Unique within the patch (editor-assigned, e.g. "n17").
    pub id: String,
    /// A node type id from the registry (`registry::TYPES`; `registry()` in
    /// the wasm build), e.g. "noise_field" or "output".
    pub kind: String,
    /// Optional user label shown on the node.
    pub name: String,
    /// Knob values by param name; missing entries use the registry default,
    /// and values are held to the param's min..max. A Select param stores
    /// its 0-based option index. A Sub-patch node keys its inner knobs as
    /// "{inner node}.{param}"; a Code node keys its knobs by Scalar input name.
    pub params: BTreeMap<String, f32>,
    /// Editor canvas position, [x, y] (purely presentational).
    pub pos: [f32; 2],
    /// A Still image node's own image, or a Clip node's sprite sheet: a
    /// `data:image/...;base64,` URL of a 256×256 picture (editors resize
    /// before storing; at most 600000 bytes). Carried in the patch so a file
    /// or a submission is self-contained. Only those two kinds may carry one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
    /// A Sub-patch node's own document (see `flatten`): its exposed knobs
    /// are this node's inputs, its Output this node's `out`. Nested at most
    /// four deep.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub: Option<Box<PatchDoc>>,
    /// Where a Sub-patch node's `sub` came from: the id of a saved patch or
    /// of a built-in (`builtin-…`). Absent on a sub-patch older than links,
    /// which is simply its own copy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// The `sub` follows `source`: saving that patch refreshes this copy
    /// everywhere it is linked (see [`links`]), and editors show it
    /// read-only. False: a clone this patch owns and may edit.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub linked: bool,
    /// On a clone: the editor's digest of `source` as it was copied, so the
    /// editor can tell when the source has moved on and offer an update.
    /// Opaque to the crate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_rev: Option<String>,
    /// A Code node's own ports and body (see `code`): its declared inputs
    /// are this node's input ports (Scalar ones are knobs too), its declared
    /// outputs its output ports. Required on a Code node, refused elsewhere.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<Box<code::CodeDef>>,
    /// A Note node's text: a remark on the canvas, nothing more (see
    /// [`registry::NOTE_KIND`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Shown minimized in the editor: a mini with port dots, no labels or
    /// knobs (purely presentational).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
    /// A Blend's number of layers, 1 to 8 (absent means 1). Layer 1 is
    /// `over` / `mode` / `opacity` over `base`; layer k (2..) adds the input
    /// `over{k}`, the Select `mode{k}` and the knob `opacity{k}` (in
    /// `params` and wireable like any knob), composited onto the layers
    /// below in order. An unwired layer above the first is skipped. Only
    /// layered kinds (`registry::layered`) may carry it.
    #[serde(skip_serializing_if = "one_layer")]
    pub layers: u32,
}

fn one_layer(layers: &u32) -> bool {
    *layers <= 1
}

/// A param of a node instance: its name on this instance (`opacity2` for
/// layer 2's copy of `opacity`), its label there ("Opacity 2") and the
/// registry definition it repeats.
#[derive(Debug, Clone)]
pub struct InstParam {
    pub name: String,
    pub label: String,
    pub def: &'static registry::ParamDef,
}

/// A knob: the range of a Number param of a built-in node, or of a Scalar
/// input of a Code node. The knob value is the fallback when nothing is
/// wired in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Knob {
    pub min: f32,
    pub max: f32,
    pub default: f32,
    /// The engine integrates this value over time (× master speed).
    pub integrate: bool,
}

impl NodeInst {
    /// The effective value of a param: the stored knob, or the default.
    pub fn param(&self, name: &str) -> f32 {
        if let Some(v) = self.params.get(name) {
            return *v;
        }
        self.knob(name).map(|k| k.default).unwrap_or(0.0)
    }

    /// A Code node's definition, when this is a Code node that has one.
    pub fn code(&self) -> Option<&code::CodeDef> {
        if self.kind == code::KIND { self.code.as_deref() } else { None }
    }

    /// How many layers this node has: `layers` on a layered kind (held to
    /// 1..=`registry::MAX_LAYERS`), 1 on everything else.
    pub fn layer_count(&self) -> u32 {
        if registry::layered(&self.kind).is_empty() {
            1
        } else {
            self.layers.clamp(1, registry::MAX_LAYERS)
        }
    }

    /// The registry name behind a port or param name of this instance:
    /// `over3` is `over` on a Blend with three layers or more; anything else
    /// is itself.
    fn layer_base<'a>(&self, name: &'a str) -> &'a str {
        match registry::split_layer(&self.kind, name) {
            Some((base, k)) if k <= self.layer_count() => base,
            _ => name,
        }
    }

    /// The registry definition of a param of a built-in node (Selects
    /// included), layer copies resolved. `None` on a Code node.
    pub fn param_def(&self, name: &str) -> Option<&'static registry::ParamDef> {
        if self.code().is_some() {
            return None;
        }
        registry::lookup(&self.kind)?.param(self.layer_base(name))
    }

    /// Every param of a built-in node (Selects included), in declaration
    /// order and then layer by layer. Empty on a Code node.
    pub fn params_of(&self) -> Vec<InstParam> {
        let Some(t) = registry::lookup(&self.kind).filter(|_| self.code().is_none()) else {
            return Vec::new();
        };
        let mut out: Vec<InstParam> = t
            .params
            .iter()
            .map(|def| InstParam { name: def.name.to_string(), label: def.label.to_string(), def })
            .collect();
        for k in 2..=self.layer_count() {
            for &name in registry::layered(&self.kind) {
                if let Some(def) = t.param(name) {
                    out.push(InstParam {
                        name: registry::layer_name(name, k),
                        label: format!("{} {k}", def.label),
                        def,
                    });
                }
            }
        }
        out
    }

    /// Whether this node runs on the CPU (Scalar/Event tier). A Code node
    /// follows its ports; a Code node whose ports make no sense counts as
    /// CPU, so validation (which refuses it) is the only place it matters.
    pub fn is_cpu(&self) -> bool {
        if let Some(s) = self.boundary_shape() {
            return matches!(s, Shape::Scalar | Shape::Event);
        }
        match self.code() {
            Some(def) => def.tier().unwrap_or(code::Tier::Cpu) == code::Tier::Cpu,
            None => registry::is_cpu_kind(&self.kind),
        }
    }

    /// Whether this node is compiled into the patch shader (field tier).
    pub fn is_gpu(&self) -> bool {
        if let Some(s) = self.boundary_shape() {
            return s.is_field();
        }
        match self.code() {
            Some(def) => def.tier() == Ok(code::Tier::Gpu),
            None => registry::is_gpu_kind(&self.kind),
        }
    }

    /// The knob behind `name`: a Number param (not a Select) of a built-in
    /// node, or a Scalar input of a Code node.
    pub fn knob(&self, name: &str) -> Option<Knob> {
        if let Some(def) = self.code() {
            let p = def.input(name).filter(|p| p.shape == Shape::Scalar)?;
            return Some(Knob {
                min: p.min,
                max: p.max,
                default: p.default,
                integrate: p.integrate,
            });
        }
        let p = self.param_def(name)?;
        match p.kind {
            registry::ParamKind::Number => Some(Knob {
                min: p.min,
                max: p.max,
                default: p.default,
                integrate: p.integrate,
            }),
            registry::ParamKind::Select(_) => None,
        }
    }

    /// Every knob of this node, in declaration order, with its name.
    pub fn knobs(&self) -> Vec<(String, Knob)> {
        if let Some(def) = self.code() {
            return def
                .inputs
                .iter()
                .filter(|p| p.shape == Shape::Scalar)
                .filter_map(|p| self.knob(&p.name).map(|k| (p.name.clone(), k)))
                .collect();
        }
        self.params_of()
            .into_iter()
            .filter_map(|p| self.knob(&p.name).map(|k| (p.name, k)))
            .collect()
    }

    /// Shape of an input port: a shaped input, a Number param's implicit
    /// Scalar port, or a Code node's declared input. `None` for unknown
    /// ports and for Select params (which cannot be wired).
    pub fn input_shape(&self, name: &str) -> Option<Shape> {
        if let Some(def) = self.code() {
            return def.input(name).map(|p| p.shape);
        }
        if let Some(s) = self.boundary_shape()
            && name == "in"
        {
            return Some(s);
        }
        registry::lookup(&self.kind)?.input_shape(self.layer_base(name))
    }

    pub fn output_shape(&self, name: &str) -> Option<Shape> {
        if let Some(def) = self.code() {
            return def.output(name).map(|p| p.shape);
        }
        if let Some(s) = self.boundary_shape() {
            return (name == "out").then_some(s);
        }
        registry::lookup(&self.kind)?.output_shape(name)
    }

    /// A Patch in or Patch out's shape, from its `shape` Select (see
    /// `registry::BOUNDARY_SHAPES`): both its ports carry it, and it decides
    /// the tier. `None` for any other node.
    pub fn boundary_shape(&self) -> Option<Shape> {
        registry::is_boundary(&self.kind).then(|| {
            let i = self.param("shape").round().max(0.0) as usize;
            registry::BOUNDARY_SHAPES[i.min(registry::BOUNDARY_SHAPES.len() - 1)]
        })
    }

    /// The shaped inputs (not knobs) of this node, in declaration order.
    pub fn shaped_inputs(&self) -> Vec<(String, Shape)> {
        if let Some(s) = self.boundary_shape() {
            return vec![("in".to_string(), s)];
        }
        if let Some(def) = self.code() {
            return def
                .inputs
                .iter()
                .filter(|p| p.shape != Shape::Scalar)
                .map(|p| (p.name.clone(), p.shape))
                .collect();
        }
        let Some(t) = registry::lookup(&self.kind) else {
            return Vec::new();
        };
        let mut out: Vec<(String, Shape)> =
            t.inputs.iter().map(|p| (p.name.to_string(), p.shape)).collect();
        for k in 2..=self.layer_count() {
            for &name in registry::layered(&self.kind) {
                if let Some(p) = t.inputs.iter().find(|p| p.name == name) {
                    out.push((registry::layer_name(name, k), p.shape));
                }
            }
        }
        out
    }

    /// The output ports of this node, in declaration order.
    pub fn outputs(&self) -> Vec<(String, Shape)> {
        if let Some(def) = self.code() {
            return def.outputs.iter().map(|p| (p.name.clone(), p.shape)).collect();
        }
        registry::lookup(&self.kind)
            .map(|t| t.outputs.iter().map(|p| (p.name.to_string(), p.shape)).collect())
            .unwrap_or_default()
    }
}

/// One end of a wire: a port on a node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PortRef {
    /// The node's `id`.
    pub node: String,
    /// The port's name: an output port at the `from` end; at the `to` end a
    /// shaped input, or the name of a Number param (every Number param is
    /// also a Scalar input).
    pub port: String,
}

/// A wire from one node's output port to another node's input port.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Edge {
    /// The output end.
    pub from: PortRef,
    /// The input end.
    pub to: PortRef,
}

/// A param promoted out of the graph: playable from the Control tab on any
/// client, and a port when this patch is used as a sub-patch block.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct ExposedParam {
    /// The node's `id`.
    pub node: String,
    /// The param's name (any param of a built-in node, Selects included, or a
    /// Code node's Scalar input).
    pub param: String,
    /// What the Control tab and a Sub-patch port call it; empty falls back
    /// to "{node}.{param}".
    pub label: String,
}

/// The JSON Schema (draft 2020-12) of a patch document ([`PatchDoc`] and
/// everything nested in it, sub-patches included), generated from the serde
/// types so it follows their renames and defaults; field doc comments become
/// its `description`s (re-flowed: a doc comment's line wrapping is dropped,
/// its paragraph breaks kept). Structure only: which kinds, ports and params
/// exist is the registry's business, and `validate` checks the graph.
pub fn patch_schema() -> serde_json::Value {
    fn reflow(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(map) => {
                for (k, x) in map.iter_mut() {
                    match x {
                        serde_json::Value::String(s) if k == "description" => {
                            *s = s
                                .split("\n\n")
                                .map(|para| para.split_whitespace().collect::<Vec<_>>().join(" "))
                                .collect::<Vec<_>>()
                                .join("\n\n");
                        }
                        _ => reflow(x),
                    }
                }
            }
            serde_json::Value::Array(items) => items.iter_mut().for_each(reflow),
            _ => {}
        }
    }
    let mut schema = schemars::schema_for!(PatchDoc).to_value();
    reflow(&mut schema);
    schema
}

impl Default for ExposedParam {
    fn default() -> Self {
        Self {
            node: String::new(),
            param: String::new(),
            label: String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doc_round_trips_through_json() {
        let mut doc = PatchDoc {
            id: "a2fce8f4-0000-4000-8000-000000000001".into(),
            name: "Test".into(),
            ..Default::default()
        };
        doc.nodes.push(NodeInst {
            id: "n1".into(),
            kind: "noise_field".into(),
            params: [("scale".to_string(), 2.0)].into(),
            pos: [10.0, 20.0],
            ..Default::default()
        });
        doc.nodes.push(NodeInst {
            id: "n2".into(),
            kind: "output".into(),
            ..Default::default()
        });
        doc.edges.push(Edge {
            from: PortRef {
                node: "n1".into(),
                port: "out".into(),
            },
            to: PortRef {
                node: "n2".into(),
                port: "in".into(),
            },
        });

        let json = serde_json::to_string_pretty(&doc).unwrap();
        let back: PatchDoc = serde_json::from_str(&json).unwrap();
        assert_eq!(back.format, PATCH_FORMAT);
        assert_eq!(back.nodes.len(), 2);
        assert_eq!(back.nodes[0].param("scale"), 2.0);
        // Unset param falls back to the registry default.
        assert_eq!(back.nodes[0].param("speed"), 1.0);
        assert_eq!(back.edges[0].to.port, "in");
    }

    #[test]
    fn collapsed_is_kept_and_left_out_when_false() {
        let mut node = NodeInst {
            id: "n1".into(),
            kind: "blend".into(),
            ..Default::default()
        };
        assert!(!serde_json::to_string(&node).unwrap().contains("collapsed"));
        node.collapsed = true;
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains(r#""collapsed":true"#));
        let back: NodeInst = serde_json::from_str(&json).unwrap();
        assert!(back.collapsed);
    }

    #[test]
    fn layers_name_the_extra_ports_and_knobs() {
        let mut node = NodeInst {
            id: "mix".into(),
            kind: "blend".into(),
            layers: 3,
            ..Default::default()
        };
        assert_eq!(node.input_shape("over3"), Some(Shape::FieldColor));
        assert_eq!(node.input_shape("opacity2"), Some(Shape::Scalar));
        assert_eq!(node.input_shape("mode2"), None, "a layer's mode is a Select");
        assert_eq!(node.input_shape("over4"), None, "past the last layer");
        assert_eq!(node.input_shape("over03"), None);
        assert_eq!(node.param("opacity3"), 1.0, "a layer's knob defaults like layer 1's");
        let inputs: Vec<String> = node.shaped_inputs().into_iter().map(|(n, _)| n).collect();
        assert_eq!(inputs, ["base", "over", "over2", "over3"]);
        let knobs: Vec<String> = node.knobs().into_iter().map(|(n, _)| n).collect();
        assert_eq!(knobs, ["opacity", "opacity2", "opacity3"]);
        let labels: Vec<String> = node.params_of().into_iter().map(|p| p.label).collect();
        assert_eq!(labels, ["Mode", "Opacity", "Mode 2", "Opacity 2", "Mode 3", "Opacity 3"]);

        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains(r#""layers":3"#));
        node.layers = 1;
        assert!(!serde_json::to_string(&node).unwrap().contains("layers"));
        // Other kinds have one layer whatever they carry.
        let noise = NodeInst { kind: "noise_field".into(), layers: 4, ..Default::default() };
        assert_eq!(noise.layer_count(), 1);
    }

    #[test]
    fn minimal_json_gets_defaults() {
        let doc: PatchDoc = serde_json::from_str(r#"{"name":"x"}"#).unwrap();
        assert_eq!(doc.format, PATCH_FORMAT);
        assert!(doc.nodes.is_empty());
    }

    fn schema_validator() -> jsonschema::Validator {
        jsonschema::validator_for(&patch_schema()).expect("the patch schema is a valid JSON Schema")
    }

    fn schema_errors(v: &jsonschema::Validator, doc: &serde_json::Value) -> Vec<String> {
        v.iter_errors(doc).map(|e| format!("{} at {}", e, e.instance_path())).collect()
    }

    #[test]
    fn schema_describes_the_document() {
        let schema = patch_schema();
        assert_eq!(schema["$schema"], "https://json-schema.org/draft/2020-12/schema");
        assert_eq!(schema["type"], "object");
        for key in ["format", "id", "name", "description", "credit", "nodes", "edges", "exposed"] {
            let p = &schema["properties"][key];
            assert!(p.is_object(), "schema lacks `{key}`");
            assert!(p["description"].is_string(), "`{key}` has no description");
        }
        let defs = &schema["$defs"];
        for def in ["NodeInst", "Edge", "PortRef", "ExposedParam", "CodeDef", "CodePort", "Shape"] {
            assert!(defs[def].is_object(), "schema lacks $defs/{def}");
        }
        for key in ["id", "kind", "params", "pos", "media", "sub", "code", "collapsed", "layers"] {
            assert!(defs["NodeInst"]["properties"][key]["description"].is_string(), "NodeInst.{key}");
        }
        assert_eq!(defs["Edge"]["required"], serde_json::json!(["from", "to"]));
        // Doc-comment wrapping is gone.
        assert!(!defs["NodeInst"]["properties"]["params"]["description"]
            .as_str()
            .unwrap()
            .contains('\n'));
    }

    /// The shipped presets, as stored and as the core writes them back, are
    /// what the schema promises a patch looks like.
    #[test]
    fn every_preset_validates_against_the_schema() {
        let v = schema_validator();
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/presets");
        let mut files = 0;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let doc: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let errors = schema_errors(&v, &doc);
            assert!(errors.is_empty(), "{}: {errors:?}", path.display());
            files += 1;
        }
        assert!(files > 0);
        for doc in presets::presets() {
            let json = serde_json::to_value(doc).unwrap();
            let errors = schema_errors(&v, &json);
            assert!(errors.is_empty(), "{} as serialized: {errors:?}", doc.name);
        }
    }

    #[test]
    fn schema_accepts_nested_documents_and_refuses_malformed_ones() {
        let v = schema_validator();
        let ok = serde_json::json!({
            "name": "nested",
            "nodes": [
                { "id": "s", "kind": "subpatch", "sub": { "nodes": [{ "id": "o", "kind": "output" }] } },
                { "id": "c", "kind": "code", "code": {
                    "inputs": [{ "name": "k", "shape": "scalar", "min": 0, "max": 2, "default": 1 }],
                    "outputs": [{ "name": "out", "shape": "field_color" }],
                    "body": "out = vec4f(k);"
                } },
                { "id": "o", "kind": "output", "params": { "master": 0.5 }, "pos": [1, 2] }
            ],
            "edges": [{ "from": { "node": "s", "port": "out" }, "to": { "node": "o", "port": "in" } }]
        });
        assert_eq!(schema_errors(&v, &ok), Vec::<String>::new());
        for bad in [
            serde_json::json!({ "nodes": [{ "id": "a", "params": { "x": "loud" } }] }),
            serde_json::json!({ "nodes": [{ "id": "a", "pos": [1] }] }),
            serde_json::json!({ "edges": [{ "from": { "node": "a", "port": "out" } }] }),
            serde_json::json!({ "nodes": [{ "id": "c", "code": { "outputs": [{ "name": "o", "shape": "colour" }] } }] }),
            serde_json::json!({ "nodes": [{ "id": "s", "sub": { "nodes": "none" } }] }),
        ] {
            assert!(!v.is_valid(&bad), "accepted {bad}");
        }
    }

    #[test]
    fn shape_adapters() {
        use Shape::*;
        assert!(FieldColor.accepts(FieldColor));
        assert!(FieldScalar.accepts(Scalar), "uniform-field adapter");
        assert!(FieldColor.accepts(FieldScalar), "grayscale adapter");
        assert!(!FieldColor.accepts(Scalar), "no transitive adapter");
        assert!(!Scalar.accepts(Event));
        assert!(!Points.accepts(Texture));
        assert!(Effects.accepts(Effects));
        assert!(!FieldColor.accepts(Effects));
        // Domain is validate's call: value types alone decide here.
        assert!(FieldColor.accepts(LedColor));
        assert!(FieldColor.accepts(LedScalar), "grayscale adapter on the LEDs");
        assert!(LedColor.accepts(FieldColor), "drawing samples the plane at each LED");
        assert!(FieldScalar.accepts(LedScalar));
        assert!(LedScalar.accepts(Scalar), "uniform adapter on the LEDs");
        assert!(!LedScalar.accepts(LedColor), "colour does not narrow to grey");
        assert!(!FieldScalar.accepts(LedColor));
    }
}
