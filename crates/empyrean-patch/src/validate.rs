//! Structural + type validation and topological ordering. Everything the
//! editor needs to refuse bad wires at drag time is expressed here once, and
//! the engine re-checks on activation — the backend never trusts a client.

use super::code;
use super::registry::{self, NodeType};
use super::{MAX_MEDIA_BYTES, MAX_PATCH_EDGES, MAX_PATCH_IMAGES, MAX_PATCH_NODES, NodeInst, PATCH_FORMAT, PatchDoc, Shape};
use std::collections::{HashMap, HashSet};
use std::fmt;

/// A structurally valid patch, ready for evaluation/codegen.
#[derive(Debug)]
pub struct Validated {
    /// Indices into `doc.nodes` in dependency order: every node appears after
    /// all nodes feeding it.
    pub order: Vec<usize>,
    /// Index of the single `output` sink. `None` is structurally legal (a
    /// patch mid-edit) but not renderable — activation requires `Some`.
    pub output: Option<usize>,
    /// Per node (indexed like `doc.nodes`): whether its field outputs carry
    /// LED data rather than the plane (see [`led_nodes`]).
    pub led: Vec<bool>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PatchError {
    NewerFormat {
        format: u32,
    },
    TooLarge {
        nodes: usize,
        edges: usize,
    },
    DuplicateNode {
        node: String,
    },
    UnknownKind {
        node: String,
        kind: String,
    },
    UnknownNode {
        node: String,
    },
    UnknownOutput {
        node: String,
        port: String,
    },
    /// Unknown input port, or a `Select` param (those are not connectable).
    BadInput {
        node: String,
        port: String,
    },
    ShapeMismatch {
        from: String,
        to: String,
        detail: String,
    },
    /// LED data wired into an input its node reads somewhere other than the
    /// LED being drawn (see [`led_nodes`]).
    LedSampled {
        from: String,
        to: String,
    },
    /// Two wires into the same input.
    InputBusy {
        node: String,
        port: String,
    },
    MultipleOutputNodes,
    /// Nodes involved in a dependency cycle.
    Cycle {
        nodes: Vec<String>,
    },
    ExposedUnknown {
        node: String,
        param: String,
    },
    TooManyImages {
        count: usize,
    },
    /// A sub-patch could not be inlined (see `flatten`).
    Subpatch {
        detail: String,
    },
    BadMedia {
        node: String,
        detail: String,
    },
    /// A Code node's ports or body are unusable (see `code::CodeDef::check`).
    Code {
        node: String,
        detail: String,
    },
    /// Note text on the wrong kind, or too long.
    Note {
        node: String,
        detail: String,
    },
    /// `layers` on a kind that has none, or more than `registry::MAX_LAYERS`.
    BadLayers {
        node: String,
        layers: u32,
    },
}

impl fmt::Display for PatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NewerFormat { format } => write!(
                f,
                "patch format {format} is newer than this app understands ({PATCH_FORMAT}) — update the app"
            ),
            Self::TooLarge { nodes, edges } => write!(
                f,
                "patch too large ({nodes} nodes / {edges} edges; limits {MAX_PATCH_NODES} / {MAX_PATCH_EDGES})"
            ),
            Self::DuplicateNode { node } => write!(f, "duplicate node id \"{node}\""),
            Self::UnknownKind { node, kind } => {
                write!(f, "node \"{node}\" has unknown kind \"{kind}\"")
            }
            Self::UnknownNode { node } => write!(f, "edge references unknown node \"{node}\""),
            Self::UnknownOutput { node, port } => {
                write!(f, "node \"{node}\" has no output \"{port}\"")
            }
            Self::BadInput { node, port } => write!(
                f,
                "node \"{node}\" has no connectable input \"{port}\" (select params can't be wired)"
            ),
            Self::ShapeMismatch { from, to, detail } => {
                write!(f, "can't connect {from} → {to}: {detail}")
            }
            Self::LedSampled { from, to } => write!(
                f,
                "can't connect {from} → {to}: {from} is LED data, defined only at the gate's LEDs, and {to} reads its input at other positions; put a Resample between them"
            ),
            Self::InputBusy { node, port } => {
                write!(f, "input \"{port}\" of node \"{node}\" already has a wire")
            }
            Self::MultipleOutputNodes => write!(f, "a patch may have only one Output node"),
            Self::TooManyImages { count } => write!(
                f,
                "a patch may carry at most {MAX_PATCH_IMAGES} Still images ({count} here)"
            ),
            Self::BadMedia { node, detail } => write!(f, "node \"{node}\": {detail}"),
            Self::Code { node, detail } => write!(f, "Code node \"{node}\": {detail}"),
            Self::Note { node, detail } => write!(f, "node \"{node}\": {detail}"),
            Self::BadLayers { node, layers } => write!(
                f,
                "node \"{node}\" has {layers} layers: only a Blend has layers, at most {}",
                registry::MAX_LAYERS
            ),
            Self::Subpatch { detail } => f.write_str(detail),
            Self::Cycle { nodes } => write!(f, "dependency cycle through: {}", nodes.join(", ")),
            Self::ExposedUnknown { node, param } => {
                write!(f, "exposed param \"{param}\" not found on node \"{node}\"")
            }
        }
    }
}

/// Longest Note text.
pub const MAX_NOTE_BYTES: usize = 4000;

/// Node kinds whose `media` lives in a media cell of the VIDEO buffer
/// (`abi::MEDIA_CELLS`): Still images and Clips.
pub fn owns_media_cell(kind: &str) -> bool {
    matches!(kind, "image_in" | "clip")
}

/// Collects ALL problems (the editor shows every red wire at once) rather than
/// failing on the first.
pub fn validate(doc: &PatchDoc) -> Result<Validated, Vec<PatchError>> {
    let mut errors = Vec::new();

    if doc.format > PATCH_FORMAT {
        // Refuse outright: later checks would be judging a schema we don't know.
        return Err(vec![PatchError::NewerFormat { format: doc.format }]);
    }
    if doc.nodes.len() > MAX_PATCH_NODES || doc.edges.len() > MAX_PATCH_EDGES {
        return Err(vec![PatchError::TooLarge {
            nodes: doc.nodes.len(),
            edges: doc.edges.len(),
        }]);
    }
    // Sub-patches are judged inlined: the same checks, on what will render.
    if crate::flatten::has_subpatches(doc) {
        let flat = crate::flatten::flatten(doc)
            .map_err(|detail| vec![PatchError::Subpatch { detail }])?;
        return validate(&flat.doc);
    }

    let images = doc.nodes.iter().filter(|n| owns_media_cell(&n.kind)).count();
    if images > MAX_PATCH_IMAGES {
        errors.push(PatchError::TooManyImages { count: images });
    }
    for n in &doc.nodes {
        if let Some(media) = &n.media {
            let detail = if !owns_media_cell(&n.kind) {
                Some("only Still image and Clip nodes carry an image".to_string())
            } else if media.len() > MAX_MEDIA_BYTES {
                Some(format!("its image is too large ({} bytes; limit {MAX_MEDIA_BYTES})", media.len()))
            } else if !media.starts_with("data:image/") || !media.contains(";base64,") {
                Some("its image must be a data:image/...;base64, URL".to_string())
            } else {
                None
            };
            if let Some(detail) = detail {
                errors.push(PatchError::BadMedia { node: n.id.clone(), detail });
            }
        }
        // A Code node's interface is data: refuse what the generator or the
        // interpreter could not take before any wire is judged against it.
        if n.kind == code::KIND {
            let detail = match &n.code {
                None => Some("it has no code (ports and body)".to_string()),
                Some(def) => def.check().err(),
            };
            if let Some(detail) = detail {
                errors.push(PatchError::Code { node: n.id.clone(), detail });
            }
        } else if n.code.is_some() {
            errors.push(PatchError::Code {
                node: n.id.clone(),
                detail: "only Code nodes carry code".to_string(),
            });
        }
        if let Some(text) = &n.text {
            let detail = if n.kind != registry::NOTE_KIND {
                Some("only Note nodes carry text".to_string())
            } else if text.len() > MAX_NOTE_BYTES {
                Some(format!("its text is {} bytes; the limit is {MAX_NOTE_BYTES}", text.len()))
            } else {
                None
            };
            if let Some(detail) = detail {
                errors.push(PatchError::Note { node: n.id.clone(), detail });
            }
        }
        if n.layers > 1 && (registry::layered(&n.kind).is_empty() || n.layers > registry::MAX_LAYERS) {
            errors.push(PatchError::BadLayers { node: n.id.clone(), layers: n.layers });
        }
    }

    // Node ids -> index, kinds resolved. Port shapes are read from the
    // instance (`NodeInst::input_shape` …) so Code nodes' declared ports
    // count; `types` only says whether the kind exists.
    let mut index: HashMap<&str, usize> = HashMap::new();
    let mut types: Vec<Option<&'static NodeType>> = Vec::with_capacity(doc.nodes.len());
    for (i, n) in doc.nodes.iter().enumerate() {
        if index.insert(&n.id, i).is_some() {
            errors.push(PatchError::DuplicateNode { node: n.id.clone() });
        }
        let t = registry::lookup(&n.kind);
        if t.is_none() {
            errors.push(PatchError::UnknownKind {
                node: n.id.clone(),
                kind: n.kind.clone(),
            });
        }
        types.push(t);
    }

    if doc.nodes.iter().filter(|n| n.kind == "output").count() > 1 {
        errors.push(PatchError::MultipleOutputNodes);
    }

    // Edges: endpoints exist, ports exist, shapes compatible, inputs single-wired.
    let mut taken_inputs: HashSet<(usize, &str)> = HashSet::new();
    // Adjacency (from-index -> to-index) for the topo sort; only edges whose
    // endpoints resolved contribute.
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); doc.nodes.len()];
    let mut indegree: Vec<usize> = vec![0; doc.nodes.len()];

    for e in &doc.edges {
        let from_idx = index.get(e.from.node.as_str()).copied();
        let to_idx = index.get(e.to.node.as_str()).copied();
        for (referenced, idx) in [(&e.from.node, from_idx), (&e.to.node, to_idx)] {
            if idx.is_none() {
                errors.push(PatchError::UnknownNode {
                    node: referenced.clone(),
                });
            }
        }
        let (Some(fi), Some(ti)) = (from_idx, to_idx) else {
            continue;
        };
        if types[fi].is_none() || types[ti].is_none() {
            continue;
        }

        let from_shape = doc.nodes[fi].output_shape(&e.from.port);
        if from_shape.is_none() {
            errors.push(PatchError::UnknownOutput {
                node: e.from.node.clone(),
                port: e.from.port.clone(),
            });
        }
        let to_shape = doc.nodes[ti].input_shape(&e.to.port);
        if to_shape.is_none() {
            errors.push(PatchError::BadInput {
                node: e.to.node.clone(),
                port: e.to.port.clone(),
            });
        }
        let (Some(fs), Some(ts)) = (from_shape, to_shape) else {
            continue;
        };

        if !ts.accepts(fs) {
            errors.push(PatchError::ShapeMismatch {
                from: format!("{}.{}", e.from.node, e.from.port),
                to: format!("{}.{}", e.to.node, e.to.port),
                detail: format!("{fs:?} does not flow into {ts:?}"),
            });
            continue;
        }
        if !taken_inputs.insert((ti, e.to.port.as_str())) {
            errors.push(PatchError::InputBusy {
                node: e.to.node.clone(),
                port: e.to.port.clone(),
            });
            continue;
        }
        adj[fi].push(ti);
        indegree[ti] += 1;
    }

    for x in &doc.exposed {
        // Any param of a built-in node (Selects included), or a knob of a
        // Code node.
        let known = index.get(x.node.as_str()).is_some_and(|&i| {
            let n = &doc.nodes[i];
            n.param_def(&x.param).is_some() || n.knob(&x.param).is_some()
        });
        if !known {
            errors.push(PatchError::ExposedUnknown {
                node: x.node.clone(),
                param: x.param.clone(),
            });
        }
    }

    // Kahn's algorithm; anything left over sits on a cycle.
    let mut order = Vec::with_capacity(doc.nodes.len());
    let mut ready: Vec<usize> = (0..doc.nodes.len()).filter(|i| indegree[*i] == 0).collect();
    // Stable order for determinism (codegen output should not shuffle).
    ready.sort_unstable();
    while let Some(i) = ready.pop() {
        order.push(i);
        for &next in &adj[i] {
            indegree[next] -= 1;
            if indegree[next] == 0 {
                ready.push(next);
            }
        }
    }
    if order.len() != doc.nodes.len() {
        let mut on_cycle: Vec<String> = (0..doc.nodes.len())
            .filter(|i| indegree[*i] > 0)
            .map(|i| doc.nodes[i].id.clone())
            .collect();
        on_cycle.sort();
        errors.push(PatchError::Cycle { nodes: on_cycle });
    }

    let led = led_nodes(doc);
    for e in &doc.edges {
        let (Some(&fi), Some(&ti)) = (index.get(e.from.node.as_str()), index.get(e.to.node.as_str())) else {
            continue;
        };
        if led[fi] && carries_field(&doc.nodes[fi], &e.from.port) && sampled_input(&doc.nodes[ti], &e.to.port) {
            errors.push(PatchError::LedSampled {
                from: format!("{}.{}", e.from.node, e.from.port),
                to: format!("{}.{}", e.to.node, e.to.port),
            });
        }
    }

    if !errors.is_empty() {
        return Err(errors);
    }

    let output = doc.nodes.iter().position(|n| n.kind == "output");
    Ok(Validated { order, output, led })
}

/// Which nodes hand on LED data (indexed like `doc.nodes`). A node does when
/// it declares an LED output (Full random field, a Code node's `led_*`
/// port), when it is a GPU Code node that keys on the physical LED (`c.spoke`
/// or `c.i`), when it is a Sub-patch whose inner Output is fed LED data, or
/// when a field wire brings it LED data. Resample never does: turning LED
/// data into the plane is its whole job. Only field wires carry the domain
/// on, so a node that measures LED data into a Scalar hands on a plain
/// Scalar. A node's field outputs all share its domain. Solved to a fixed
/// point, so it needs no ordering and ends on a graph with a cycle too (which
/// `validate` refuses anyway); the editor mirrors it (patch-web
/// `editor/domains.ts`).
pub fn led_nodes(doc: &PatchDoc) -> Vec<bool> {
    let index: HashMap<&str, usize> = doc.nodes.iter().enumerate().map(|(i, n)| (n.id.as_str(), i)).collect();
    let mut led: Vec<bool> = doc
        .nodes
        .iter()
        .map(|n| {
            n.kind != registry::RESAMPLE_KIND
                && (declares_led(n) || n.code().is_some_and(|d| d.reads_leds()) || subpatch_led(n))
        })
        .collect();
    let mut changed = true;
    while changed {
        changed = false;
        for e in &doc.edges {
            let (Some(&f), Some(&t)) = (index.get(e.from.node.as_str()), index.get(e.to.node.as_str())) else {
                continue;
            };
            if led[f]
                && !led[t]
                && doc.nodes[t].kind != registry::RESAMPLE_KIND
                && carries_field(&doc.nodes[f], &e.from.port)
            {
                led[t] = true;
                changed = true;
            }
        }
    }
    led
}

/// A Sub-patch hands on LED data when what feeds its inner Output does. Its
/// other inputs are knobs, which carry none.
fn subpatch_led(node: &NodeInst) -> bool {
    let Some(inner) = node.sub.as_deref() else {
        return false;
    };
    let Some(output) = inner.nodes.iter().find(|n| n.kind == "output") else {
        return false;
    };
    let Some(feed) = inner.edges.iter().find(|e| e.to.node == output.id && e.to.port == "in") else {
        return false;
    };
    let led = led_nodes(inner);
    inner.nodes.iter().position(|n| n.id == feed.from.node).is_some_and(|i| led[i])
}

/// The shape a node's output really carries: its declared shape, moved onto
/// the LEDs when the node hands on LED data (`led`, from [`led_nodes`]).
pub fn resolved_shape(node: &NodeInst, port: &str, led: bool) -> Option<Shape> {
    node.output_shape(port).map(|s| if led { s.on_leds() } else { s })
}

/// Whether `node` reads field input `port` somewhere other than the LED
/// being drawn: a registry kind's [`registry::sampled_inputs`], or a field
/// input a Code node's body calls `name_at` on.
pub fn sampled_input(node: &NodeInst, port: &str) -> bool {
    match node.code() {
        Some(def) => def.input(port).is_some_and(|p| p.shape.is_field()) && def.samples(port),
        None => registry::sampled_inputs(&node.kind).contains(&port),
    }
}

fn declares_led(node: &NodeInst) -> bool {
    if let Some(s) = node.boundary_shape() {
        return s.is_led();
    }
    match node.code() {
        Some(def) => def.outputs.iter().any(|p| p.shape.is_led()),
        None => registry::lookup(&node.kind).is_some_and(|t| t.outputs.iter().any(|p| p.shape.is_led())),
    }
}

pub(crate) fn carries_field(node: &NodeInst, port: &str) -> bool {
    node.output_shape(port).is_some_and(Shape::is_field)
}

/// Human-readable single-string form, for `ServerMsg::Error` payloads.
pub fn errors_to_string(errors: &[PatchError]) -> String {
    errors
        .iter()
        .map(|e| e.to_string())
        .collect::<Vec<_>>()
        .join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Edge, ExposedParam, NodeInst, PortRef};

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

    fn doc(nodes: Vec<NodeInst>, edges: Vec<Edge>) -> PatchDoc {
        PatchDoc {
            nodes,
            edges,
            ..Default::default()
        }
    }

    #[test]
    fn valid_patch_orders_dependencies() {
        let d = doc(
            vec![
                node("out", "output"),
                node("mix", "blend"),
                node("noise", "noise_field"),
                node("waves", "radial_waves"),
                node("bass", "audio"),
            ],
            vec![
                edge("noise", "out", "mix", "base"),
                edge("waves", "out", "mix", "over"),
                edge("bass", "bass", "mix", "opacity"),
                edge("mix", "out", "out", "in"),
            ],
        );
        let v = validate(&d).unwrap();
        assert_eq!(v.output, Some(0));
        assert_eq!(v.order.len(), 5);
        let pos = |id: &str| {
            let i = d.nodes.iter().position(|n| n.id == id).unwrap();
            v.order.iter().position(|x| *x == i).unwrap()
        };
        assert!(pos("noise") < pos("mix"));
        assert!(pos("waves") < pos("mix"));
        assert!(pos("bass") < pos("mix"));
        assert!(pos("mix") < pos("out"));
    }

    #[test]
    fn adapters_allow_scalar_and_grayscale_wires() {
        let d = doc(
            vec![
                node("lfo", "lfo"),
                node("ramp", "gradient"),
                node("color", "colorize"),
                node("mix", "blend"),
            ],
            vec![
                // Scalar -> Field<f32> input (uniform-field adapter).
                edge("lfo", "out", "color", "in"),
                // Field<f32> -> Field<color> input (grayscale adapter).
                edge("ramp", "out", "mix", "over"),
            ],
        );
        assert!(validate(&d).is_ok());
    }

    #[test]
    fn shape_mismatch_is_refused() {
        // Scalar straight into a color input: no transitive adapter.
        let d = doc(
            vec![node("lfo", "lfo"), node("mix", "blend")],
            vec![edge("lfo", "out", "mix", "base")],
        );
        let errs = validate(&d).unwrap_err();
        assert!(
            matches!(errs[0], PatchError::ShapeMismatch { .. }),
            "{errs:?}"
        );

        // Event into a Scalar param port.
        let d = doc(
            vec![node("a", "audio"), node("s", "smooth")],
            vec![edge("a", "beat", "s", "in")],
        );
        let errs = validate(&d).unwrap_err();
        assert!(
            matches!(errs[0], PatchError::ShapeMismatch { .. }),
            "{errs:?}"
        );
    }

    #[test]
    fn select_params_are_not_connectable() {
        let d = doc(
            vec![node("lfo", "lfo"), node("mix", "blend")],
            vec![edge("lfo", "out", "mix", "mode")],
        );
        let errs = validate(&d).unwrap_err();
        assert!(matches!(errs[0], PatchError::BadInput { .. }), "{errs:?}");
    }

    #[test]
    fn blend_layers_are_ports_up_to_their_count() {
        let mut mix = node("mix", "blend");
        mix.layers = 2;
        let mut d = doc(
            vec![node("a", "noise_field"), node("lfo", "lfo"), mix],
            vec![edge("a", "out", "mix", "over2"), edge("lfo", "out", "mix", "opacity2")],
        );
        d.exposed.push(ExposedParam { node: "mix".into(), param: "mode2".into(), label: String::new() });
        assert!(validate(&d).is_ok(), "{:?}", validate(&d).err());
        // Past the last layer, and a layer's Select, are not inputs.
        d.edges.push(edge("a", "out", "mix", "over3"));
        d.edges.push(edge("lfo", "out", "mix", "mode2"));
        let errs = validate(&d).unwrap_err();
        assert_eq!(errs.iter().filter(|e| matches!(e, PatchError::BadInput { .. })).count(), 2, "{errs:?}");
    }

    #[test]
    fn layers_only_on_a_blend_and_at_most_eight() {
        let mut noise = node("n", "noise_field");
        noise.layers = 2;
        let mut mix = node("mix", "blend");
        mix.layers = registry::MAX_LAYERS + 1;
        let errs = validate(&doc(vec![noise, mix], vec![])).unwrap_err();
        let bad: Vec<&str> = errs
            .iter()
            .filter_map(|e| match e {
                PatchError::BadLayers { node, .. } => Some(node.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(bad, ["n", "mix"], "{errs:?}");
    }

    #[test]
    fn double_wired_input_is_refused() {
        let d = doc(
            vec![
                node("a", "noise_field"),
                node("b", "radial_waves"),
                node("mix", "blend"),
            ],
            vec![
                edge("a", "out", "mix", "over"),
                edge("b", "out", "mix", "over"),
            ],
        );
        let errs = validate(&d).unwrap_err();
        assert!(matches!(errs[0], PatchError::InputBusy { .. }), "{errs:?}");
    }

    #[test]
    fn cycles_are_reported_with_their_nodes() {
        let d = doc(
            vec![
                node("t1", "transform"),
                node("t2", "transform"),
                node("free", "solid"),
            ],
            vec![edge("t1", "out", "t2", "in"), edge("t2", "out", "t1", "in")],
        );
        let errs = validate(&d).unwrap_err();
        let Some(PatchError::Cycle { nodes }) =
            errs.iter().find(|e| matches!(e, PatchError::Cycle { .. }))
        else {
            panic!("expected cycle error: {errs:?}");
        };
        assert_eq!(nodes, &["t1", "t2"], "free node is not on the cycle");
    }

    #[test]
    fn unknown_things_are_reported() {
        let mut d = doc(
            vec![node("a", "does_not_exist"), node("a", "solid")],
            vec![
                edge("ghost", "out", "a", "in"),
                edge("a", "nope", "a", "nope"),
            ],
        );
        d.exposed.push(ExposedParam {
            node: "a".into(),
            param: "missing".into(),
            label: String::new(),
        });
        let errs = validate(&d).unwrap_err();
        let has = |f: fn(&PatchError) -> bool| errs.iter().any(f);
        assert!(
            has(|e| matches!(e, PatchError::DuplicateNode { .. })),
            "{errs:?}"
        );
        assert!(
            has(|e| matches!(e, PatchError::UnknownKind { .. })),
            "{errs:?}"
        );
        assert!(
            has(|e| matches!(e, PatchError::UnknownNode { .. })),
            "{errs:?}"
        );
        assert!(
            has(|e| matches!(e, PatchError::ExposedUnknown { .. })),
            "{errs:?}"
        );
    }

    #[test]
    fn only_one_output_node() {
        let d = doc(vec![node("o1", "output"), node("o2", "output")], vec![]);
        let errs = validate(&d).unwrap_err();
        assert!(errs.contains(&PatchError::MultipleOutputNodes));
    }

    #[test]
    fn empty_and_outputless_patches_are_structurally_fine() {
        let v = validate(&doc(vec![], vec![])).unwrap();
        assert!(v.order.is_empty() && v.output.is_none());
        let v = validate(&doc(vec![node("n", "noise_field")], vec![])).unwrap();
        assert_eq!(
            v.output, None,
            "renderability is the activation gate, not validity"
        );
    }

    #[test]
    fn newer_format_is_refused_outright() {
        let d = PatchDoc {
            format: PATCH_FORMAT + 1,
            ..Default::default()
        };
        let errs = validate(&d).unwrap_err();
        assert!(matches!(errs[0], PatchError::NewerFormat { .. }));
    }

    #[test]
    fn oversized_patch_is_refused() {
        let nodes = (0..MAX_PATCH_NODES + 1)
            .map(|i| node(&format!("n{i}"), "slider"))
            .collect();
        let errs = validate(&doc(nodes, vec![])).unwrap_err();
        assert!(matches!(errs[0], PatchError::TooLarge { .. }));
    }

    fn code_node(id: &str, inputs: &[(&str, Shape)], outputs: &[(&str, Shape)], body: &str) -> NodeInst {
        let port = |(name, shape): &(&str, Shape)| code::CodePort {
            name: name.to_string(),
            shape: *shape,
            ..Default::default()
        };
        let mut n = node(id, code::KIND);
        n.code = Some(Box::new(code::CodeDef {
            inputs: inputs.iter().map(port).collect(),
            outputs: outputs.iter().map(port).collect(),
            body: body.to_string(),
        }));
        n
    }

    fn led_of(v: &Validated, d: &PatchDoc, id: &str) -> bool {
        v.led[d.nodes.iter().position(|n| n.id == id).unwrap()]
    }

    /// TV snow coloured: LED data carries through a pointwise node and into
    /// the Output, which draws each LED where it is.
    #[test]
    fn led_data_flows_through_pointwise_nodes_to_the_output() {
        let d = doc(
            vec![
                node("snow", "random_field"),
                node("tint", "colorize"),
                node("sky", "gradient"),
                node("mix", "blend"),
                node("o", "output"),
            ],
            vec![
                edge("snow", "out", "tint", "in"),
                edge("sky", "out", "mix", "base"),
                edge("tint", "out", "mix", "over"),
                edge("mix", "out", "o", "in"),
            ],
        );
        let v = validate(&d).expect("LED data may reach the Output");
        assert!(led_of(&v, &d, "snow") && led_of(&v, &d, "tint") && led_of(&v, &d, "mix"));
        assert!(!led_of(&v, &d, "sky"), "a plane source stays plane");
        let tint = &d.nodes[1];
        assert_eq!(resolved_shape(tint, "out", true), Some(Shape::LedColor));
        assert_eq!(resolved_shape(tint, "out", false), Some(Shape::FieldColor));
    }

    #[test]
    fn transform_refuses_led_data_and_resample_admits_it() {
        let wired = |via_resample: bool| {
            let mut nodes = vec![node("snow", "random_field"), node("tint", "colorize"), node("t", "transform"), node("o", "output")];
            let mut edges = vec![edge("snow", "out", "tint", "in"), edge("t", "out", "o", "in")];
            if via_resample {
                nodes.push(node("rs", registry::RESAMPLE_KIND));
                edges.push(edge("tint", "out", "rs", "in"));
                edges.push(edge("rs", "out", "t", "in"));
            } else {
                edges.push(edge("tint", "out", "t", "in"));
            }
            doc(nodes, edges)
        };
        let errs = validate(&wired(false)).unwrap_err();
        assert_eq!(
            errs,
            vec![PatchError::LedSampled {
                from: "tint.out".into(),
                to: "t.in".into()
            }]
        );
        assert!(errs[0].to_string().contains("Resample"), "{}", errs[0]);

        let d = wired(true);
        let v = validate(&d).expect("Resample turns LED data into the plane");
        assert!(led_of(&v, &d, "tint"));
        assert!(!led_of(&v, &d, "rs") && !led_of(&v, &d, "t"));
    }

    #[test]
    fn code_nodes_join_the_domains_through_their_bodies() {
        let field = Shape::FieldColor;
        // Keys on the physical LED: LED data, which Transform refuses.
        let spokes = code_node("k", &[], &[("out", field)], "out = vec4f(f32(c.spoke % 2u));");
        let d = doc(
            vec![spokes.clone(), node("t", "transform"), node("o", "output")],
            vec![edge("k", "out", "t", "in"), edge("t", "out", "o", "in")],
        );
        assert!(matches!(validate(&d).unwrap_err()[..], [PatchError::LedSampled { .. }]));

        // Only in a comment, or as a member of something else: plane.
        for body in ["// c.spoke would key on the LED\nout = vec4f(c.r01);", "let v = c.pos; out = vec4f(v.x);"] {
            let n = code_node("k", &[], &[("out", field)], body);
            let d = doc(
                vec![n, node("t", "transform"), node("o", "output")],
                vec![edge("k", "out", "t", "in"), edge("t", "out", "o", "in")],
            );
            validate(&d).unwrap_or_else(|e| panic!("{body}: {e:?}"));
        }

        // A declared LED output is LED whatever the body reads.
        let declared = code_node("k", &[], &[("out", Shape::LedColor)], "out = vec4f(c.r01);");
        let d = doc(vec![declared, node("o", "output")], vec![edge("k", "out", "o", "in")]);
        assert!(led_of(&validate(&d).unwrap(), &d, "k"));

        // A Code node that samples its input elsewhere refuses LED data; one
        // that reads it in place takes it and hands on LED data.
        let sampler = code_node("s", &[("img", field)], &[("out", field)], "out = img_at(c);");
        let reader = code_node("s", &[("img", field)], &[("out", field)], "out = img * 0.5;");
        for (n, ok) in [(sampler, false), (reader, true)] {
            let d = doc(
                vec![spokes.clone(), n, node("o", "output")],
                vec![edge("k", "out", "s", "img"), edge("s", "out", "o", "in")],
            );
            match validate(&d) {
                Ok(v) => assert!(ok && led_of(&v, &d, "s")),
                Err(e) => assert!(!ok && matches!(e[..], [PatchError::LedSampled { .. }]), "{e:?}"),
            }
        }
    }

    #[test]
    fn sub_patches_are_judged_inlined_for_domains_too() {
        let inner = doc(
            vec![node("snow", "random_field"), node("tint", "colorize"), node("o", "output")],
            vec![edge("snow", "out", "tint", "in"), edge("tint", "out", "o", "in")],
        );
        let mut sub = node("s", crate::flatten::KIND);
        sub.sub = Some(Box::new(inner));
        let d = doc(
            vec![sub, node("t", "transform"), node("o", "output")],
            vec![edge("s", "out", "t", "in"), edge("t", "out", "o", "in")],
        );
        assert!(matches!(validate(&d).unwrap_err()[..], [PatchError::LedSampled { .. }]));
    }
}
