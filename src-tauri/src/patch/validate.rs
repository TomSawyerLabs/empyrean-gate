//! Structural + type validation and topological ordering. Everything the
//! editor needs to refuse bad wires at drag time is expressed here once, and
//! the engine re-checks on activation — the backend never trusts a client.

use super::registry::{self, NodeType};
use super::{MAX_PATCH_EDGES, MAX_PATCH_NODES, PATCH_FORMAT, PatchDoc};
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
            Self::InputBusy { node, port } => {
                write!(f, "input \"{port}\" of node \"{node}\" already has a wire")
            }
            Self::MultipleOutputNodes => write!(f, "a patch may have only one Output node"),
            Self::Cycle { nodes } => write!(f, "dependency cycle through: {}", nodes.join(", ")),
            Self::ExposedUnknown { node, param } => {
                write!(f, "exposed param \"{param}\" not found on node \"{node}\"")
            }
        }
    }
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

    // Node ids -> index, kinds resolved.
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
        let (Some(ft), Some(tt)) = (types[fi], types[ti]) else {
            continue;
        };

        let from_shape = ft.output_shape(&e.from.port);
        if from_shape.is_none() {
            errors.push(PatchError::UnknownOutput {
                node: e.from.node.clone(),
                port: e.from.port.clone(),
            });
        }
        let to_shape = tt.input_shape(&e.to.port);
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
        let known = index
            .get(x.node.as_str())
            .and_then(|i| types[*i])
            .and_then(|t| t.param(&x.param))
            .is_some();
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

    if !errors.is_empty() {
        return Err(errors);
    }

    let output = doc.nodes.iter().position(|n| n.kind == "output");
    Ok(Validated { order, output })
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
    use crate::patch::{Edge, ExposedParam, NodeInst, PortRef};

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
}
