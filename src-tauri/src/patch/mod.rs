//! The node-graph ("patch") pattern paradigm: typed dataflow graphs whose sink is
//! the sACN pixel array. This module is the CPU-side core — document model,
//! node-type registry, validation/topological order, and the on-disk patch store.
//! The WGSL codegen (engine side) consumes [`validate::Validated`].
//! Design doc: `plans/node-graph.md`.

pub mod registry;
pub mod store;
pub mod validate;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// On-disk schema version. Bump on incompatible changes; loaders refuse newer
/// formats (an older app must never silently mangle a newer patch file).
pub const PATCH_FORMAT: u32 = 1;

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
}

impl NodeInst {
    /// The effective value of a param: the stored knob, or the registry default.
    pub fn param(&self, name: &str) -> f32 {
        if let Some(v) = self.params.get(name) {
            return *v;
        }
        registry::lookup(&self.kind)
            .and_then(|t| t.param(name))
            .map(|p| p.default)
            .unwrap_or(0.0)
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
    }
}
