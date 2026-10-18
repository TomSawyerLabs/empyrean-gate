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
pub mod effects;
pub mod eval;
pub mod flatten;
pub mod migrate;
pub mod presets;
pub mod registry;
pub mod script;
pub mod sim;
pub mod touch;
pub mod validate;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// On-disk schema version. Bump on incompatible changes; loaders refuse newer
/// formats (an older app must never silently mangle a newer patch file).
/// 2: the Output adds nothing that isn't wired (effects and pen strokes are
/// streams). 3: Still image nodes carry their own image ([`NodeInst::media`]).
/// 4: Sub-patch nodes carry another document ([`NodeInst::sub`]; Clips carry
/// a sprite sheet in `media`). 5: Code nodes carry their ports and body
/// ([`NodeInst::code`]). Older files are upgraded by [`migrate::migrate`].
pub const PATCH_FORMAT: u32 = 5;

/// Pictures a patch may carry (Still image and Clip nodes), each its own
/// media cell on the GPU.
pub const MAX_PATCH_IMAGES: usize = 4;
/// Longest accepted image data URL (a 256×256 WebP is ~20–60 KB; PNG more).
pub const MAX_MEDIA_BYTES: usize = 600_000;

pub const MAX_PATCH_NODES: usize = 256;
pub const MAX_PATCH_EDGES: usize = 1024;

/// The data type flowing on a wire — the whole type system. Wires connect only
/// matching shapes, plus two blessed adapters (see [`Shape::accepts`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    /// Control-rate f32, evaluated on the CPU every frame: audio bands, sliders,
    /// LFOs, IMU axes. The cheap glue between everything else.
    Scalar,
    /// Discrete trigger with payload: a beat, a tap, a key press.
    Event,
    /// A scalar function over the polar domain (angle, radius). Symbolic on the
    /// GPU — compiled inline into WGSL, never materialized.
    FieldScalar,
    /// An RGB function over the polar domain. Every generator's output.
    FieldColor,
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
    /// Whether a wire carrying `from` may drive an input of this shape.
    /// Two adapters are blessed because both compile to trivial WGSL:
    /// Scalar → Field<f32> (uniform field) and Field<f32> → Field<color>
    /// (grayscale). Nothing else converts implicitly.
    pub fn accepts(self, from: Shape) -> bool {
        self == from
            || matches!(
                (from, self),
                (Shape::Scalar, Shape::FieldScalar) | (Shape::FieldScalar, Shape::FieldColor)
            )
    }
}

/// One saved graph. The file is the unit of composition: a patch that exposes
/// ports becomes a node in other patches (sub-patches, plan step 6).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PatchDoc {
    pub format: u32,
    /// Stable identity (UUID string); filenames may change with renames.
    pub id: String,
    pub name: String,
    pub description: String,
    /// Who made it, when that is not the crew: a playground submission
    /// carries the sender's name here, and the public floor's `/health`
    /// shows it next to the patch on air. Empty for the crew's own patches.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub credit: String,
    pub nodes: Vec<NodeInst>,
    pub edges: Vec<Edge>,
    /// Params promoted to remote play surfaces (Control tab) and, later, to
    /// sub-patch input ports.
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct NodeInst {
    /// Unique within the patch (editor-assigned, e.g. "n17").
    pub id: String,
    /// A node type id from [`registry::TYPES`].
    pub kind: String,
    /// Optional user label shown on the node.
    pub name: String,
    /// Knob values by param name; missing entries use the registry default.
    pub params: BTreeMap<String, f32>,
    /// Editor canvas position (purely presentational).
    pub pos: [f32; 2],
    /// A Still image node's own image: a `data:image/...;base64,` URL of a
    /// 256×256 picture (editors resize before storing). Carried in the patch
    /// so a file or a submission is self-contained.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
    /// A Sub-patch node's own document (see [`flatten`]): its exposed knobs
    /// are this node's inputs, its Output this node's `out`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub: Option<Box<PatchDoc>>,
    /// A Code node's own ports and body (see [`code`]): its declared inputs
    /// are this node's input ports (Scalar ones are knobs too), its declared
    /// outputs its output ports.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<Box<code::CodeDef>>,
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

    /// Whether this node runs on the CPU (Scalar/Event tier). A Code node
    /// follows its ports; a Code node whose ports make no sense counts as
    /// CPU, so validation (which refuses it) is the only place it matters.
    pub fn is_cpu(&self) -> bool {
        match self.code() {
            Some(def) => def.tier().unwrap_or(code::Tier::Cpu) == code::Tier::Cpu,
            None => registry::is_cpu_kind(&self.kind),
        }
    }

    /// Whether this node is compiled into the patch shader (field tier).
    pub fn is_gpu(&self) -> bool {
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
                integrate: false,
            });
        }
        let p = registry::lookup(&self.kind)?.param(name)?;
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
        registry::lookup(&self.kind)
            .map(|t| {
                t.params
                    .iter()
                    .filter_map(|p| self.knob(p.name).map(|k| (p.name.to_string(), k)))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Shape of an input port: a shaped input, a Number param's implicit
    /// Scalar port, or a Code node's declared input. `None` for unknown
    /// ports and for Select params (which cannot be wired).
    pub fn input_shape(&self, name: &str) -> Option<Shape> {
        if let Some(def) = self.code() {
            return def.input(name).map(|p| p.shape);
        }
        registry::lookup(&self.kind)?.input_shape(name)
    }

    pub fn output_shape(&self, name: &str) -> Option<Shape> {
        if let Some(def) = self.code() {
            return def.output(name).map(|p| p.shape);
        }
        registry::lookup(&self.kind)?.output_shape(name)
    }

    /// The shaped inputs (not knobs) of this node, in declaration order.
    pub fn shaped_inputs(&self) -> Vec<(String, Shape)> {
        if let Some(def) = self.code() {
            return def
                .inputs
                .iter()
                .filter(|p| p.shape != Shape::Scalar)
                .map(|p| (p.name.clone(), p.shape))
                .collect();
        }
        registry::lookup(&self.kind)
            .map(|t| t.inputs.iter().map(|p| (p.name.to_string(), p.shape)).collect())
            .unwrap_or_default()
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortRef {
    pub node: String,
    pub port: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub from: PortRef,
    pub to: PortRef,
}

/// A param promoted out of the graph: playable from the Control tab on any
/// client, and (later) a port when this patch is used as a sub-patch block.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ExposedParam {
    pub node: String,
    pub param: String,
    pub label: String,
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
    fn minimal_json_gets_defaults() {
        let doc: PatchDoc = serde_json::from_str(r#"{"name":"x"}"#).unwrap();
        assert_eq!(doc.format, PATCH_FORMAT);
        assert!(doc.nodes.is_empty());
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
    }
}
