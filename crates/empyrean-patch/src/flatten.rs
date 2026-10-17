//! Sub-patches. A `subpatch` node carries another document in
//! [`NodeInst::sub`]; its inner `exposed` knobs are the node's input ports
//! (named `"{inner node}.{param}"`, knob values kept in the node's own
//! `params` under the same keys) and whatever feeds the inner Output is its
//! `out`. [`flatten`] inlines every sub-patch so validation, codegen and
//! evaluation only ever see plain nodes:
//!
//! - inner nodes are renamed `"{sub}/{inner}"`, except the inner root (the
//!   node wired into the inner Output), which takes the sub-patch's own id so
//!   wires from `{sub}.out` and the node's thumbnail keep working;
//! - an inner Output with nothing wired in (or an empty sub-patch) becomes a
//!   black Solid, so the node renders as nothing rather than failing;
//! - wires and exposed entries of the outer document that point at a
//!   sub-patch port are rewritten to the inner node and param, and
//!   [`Flat::aliases`] remembers the mapping for live param changes.

use crate::{Edge, NodeInst, PatchDoc, PortRef};
use std::collections::HashMap;

/// The node kind that embeds another document.
pub const KIND: &str = "subpatch";
/// Sub-patches inside sub-patches, at most this deep.
pub const MAX_SUBPATCH_DEPTH: usize = 4;

/// A document with every sub-patch inlined.
#[derive(Debug, Clone)]
pub struct Flat {
    pub doc: PatchDoc,
    /// `(sub-patch node, "{inner}.{param}")` → `(flattened node, param)`, so
    /// a knob change addressed to the sub-patch reaches the inner node.
    pub aliases: HashMap<(String, String), (String, String)>,
}

/// The input port a sub-patch offers for an inner node's exposed param.
pub fn port_name(node: &str, param: &str) -> String {
    format!("{node}.{param}")
}

pub fn has_subpatches(doc: &PatchDoc) -> bool {
    doc.nodes.iter().any(|n| n.kind == KIND)
}

/// Inline every sub-patch (recursively). A document without any comes back
/// as a plain copy.
pub fn flatten(doc: &PatchDoc) -> Result<Flat, String> {
    let mut aliases = HashMap::new();
    let doc = flatten_at(doc, 0, &mut aliases)?;
    Ok(Flat { doc, aliases })
}

fn black(id: &str, pos: [f32; 2]) -> NodeInst {
    NodeInst {
        id: id.to_string(),
        kind: "solid".to_string(),
        params: [("brightness".to_string(), 0.0)].into(),
        pos,
        ..Default::default()
    }
}

fn flatten_at(
    doc: &PatchDoc,
    depth: usize,
    aliases: &mut HashMap<(String, String), (String, String)>,
) -> Result<PatchDoc, String> {
    let mut out = PatchDoc {
        format: doc.format,
        id: doc.id.clone(),
        name: doc.name.clone(),
        description: doc.description.clone(),
        credit: doc.credit.clone(),
        nodes: Vec::with_capacity(doc.nodes.len()),
        edges: Vec::with_capacity(doc.edges.len()),
        exposed: Vec::with_capacity(doc.exposed.len()),
    };
    // Each sub-patch node's ports → (flattened node, param).
    let mut ports: HashMap<&str, HashMap<String, (String, String)>> = HashMap::new();

    for n in &doc.nodes {
        if n.kind != KIND {
            let mut m = n.clone();
            m.sub = None;
            out.nodes.push(m);
            continue;
        }
        if depth >= MAX_SUBPATCH_DEPTH {
            return Err(format!(
                "sub-patch \"{}\" is nested too deep (limit {MAX_SUBPATCH_DEPTH})",
                n.id
            ));
        }
        let mut map = HashMap::new();
        match n.sub.as_deref() {
            None => out.nodes.push(black(&n.id, n.pos)),
            Some(inner) => {
                let inner = flatten_at(inner, depth + 1, &mut HashMap::new())?;
                let output = inner.nodes.iter().find(|m| m.kind == "output").map(|m| m.id.clone());
                let root = output.as_ref().and_then(|o| {
                    inner
                        .edges
                        .iter()
                        .find(|e| e.to.node == *o && e.to.port == "in")
                        .map(|e| e.from.clone())
                });
                if let Some(r) = &root
                    && r.port != "out"
                {
                    return Err(format!(
                        "sub-patch \"{}\": its Output is fed from \"{}.{}\", which cannot be its out",
                        n.id, r.node, r.port
                    ));
                }
                let rename = |id: &str| -> String {
                    if root.as_ref().is_some_and(|r| r.node == id) {
                        n.id.clone()
                    } else {
                        format!("{}/{}", n.id, id)
                    }
                };
                for m in &inner.nodes {
                    if Some(&m.id) == output.as_ref() {
                        continue;
                    }
                    let mut m = m.clone();
                    let original = m.id.clone();
                    m.id = rename(&original);
                    // The sub-patch node's own knob values, keyed by port.
                    for (key, v) in &n.params {
                        if let Some((node, param)) = key.split_once('.')
                            && node == original
                        {
                            m.params.insert(param.to_string(), *v);
                        }
                    }
                    out.nodes.push(m);
                }
                if root.is_none() {
                    out.nodes.push(black(&n.id, n.pos));
                }
                for e in &inner.edges {
                    if Some(&e.to.node) == output.as_ref() {
                        continue;
                    }
                    out.edges.push(Edge {
                        from: PortRef {
                            node: rename(&e.from.node),
                            port: e.from.port.clone(),
                        },
                        to: PortRef {
                            node: rename(&e.to.node),
                            port: e.to.port.clone(),
                        },
                    });
                }
                for x in &inner.exposed {
                    map.insert(
                        port_name(&x.node, &x.param),
                        (rename(&x.node), x.param.clone()),
                    );
                }
            }
        }
        for (port, target) in &map {
            aliases.insert((n.id.clone(), port.clone()), target.clone());
        }
        ports.insert(&n.id, map);
    }

    for e in &doc.edges {
        let mut e = e.clone();
        if let Some(map) = ports.get(e.to.node.as_str()) {
            let Some((node, param)) = map.get(&e.to.port) else {
                return Err(format!(
                    "sub-patch \"{}\" has no input \"{}\"",
                    e.to.node, e.to.port
                ));
            };
            e.to = PortRef {
                node: node.clone(),
                port: param.clone(),
            };
        }
        if ports.contains_key(e.from.node.as_str()) && e.from.port != "out" {
            return Err(format!(
                "sub-patch \"{}\" has no output \"{}\"",
                e.from.node, e.from.port
            ));
        }
        out.edges.push(e);
    }
    for x in &doc.exposed {
        let mut x = x.clone();
        if let Some(map) = ports.get(x.node.as_str()) {
            let Some((node, param)) = map.get(&x.param) else {
                return Err(format!(
                    "sub-patch \"{}\" has no knob \"{}\" to expose",
                    x.node, x.param
                ));
            };
            x.node = node.clone();
            x.param = param.clone();
        }
        out.exposed.push(x);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codegen::compile;
    use crate::eval::Runtime;

    fn doc(json: serde_json::Value) -> PatchDoc {
        serde_json::from_value(json).unwrap()
    }

    /// A gradient coloured by Colorize, exposing the hue.
    fn tinted_ramp() -> serde_json::Value {
        serde_json::json!({
            "name": "Tinted ramp",
            "nodes": [
                { "id": "ramp", "kind": "gradient" },
                { "id": "tint", "kind": "colorize", "params": { "hue": 0.1 } },
                { "id": "o", "kind": "output" }
            ],
            "edges": [
                { "from": { "node": "ramp", "port": "out" }, "to": { "node": "tint", "port": "in" } },
                { "from": { "node": "tint", "port": "out" }, "to": { "node": "o", "port": "in" } }
            ],
            "exposed": [ { "node": "tint", "param": "hue", "label": "Hue" } ]
        })
    }

    #[test]
    fn a_sub_patch_becomes_its_nodes_with_the_root_taking_its_id() {
        let outer = doc(serde_json::json!({
            "nodes": [
                { "id": "sl", "kind": "slider" },
                { "id": "s", "kind": "subpatch", "params": { "tint.hue": 0.3 }, "sub": tinted_ramp() },
                { "id": "o", "kind": "output" }
            ],
            "edges": [
                { "from": { "node": "sl", "port": "out" }, "to": { "node": "s", "port": "tint.hue" } },
                { "from": { "node": "s", "port": "out" }, "to": { "node": "o", "port": "in" } }
            ],
            "exposed": [ { "node": "s", "param": "tint.hue", "label": "Hue" } ]
        }));
        let flat = flatten(&outer).unwrap();
        let ids: Vec<&str> = flat.doc.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, vec!["sl", "s/ramp", "s", "o"]);
        let tint = flat.doc.nodes.iter().find(|n| n.id == "s").unwrap();
        assert_eq!(tint.kind, "colorize");
        assert_eq!(tint.params["hue"], 0.3, "the node's knob value reaches the inner param");
        assert!(tint.sub.is_none());
        let edges: Vec<String> = flat
            .doc
            .edges
            .iter()
            .map(|e| format!("{}.{}>{}.{}", e.from.node, e.from.port, e.to.node, e.to.port))
            .collect();
        assert_eq!(edges, vec!["s/ramp.out>s.in", "sl.out>s.hue", "s.out>o.in"]);
        assert_eq!(flat.doc.exposed[0].node, "s");
        assert_eq!(flat.doc.exposed[0].param, "hue");
        assert_eq!(
            flat.aliases[&("s".to_string(), "tint.hue".to_string())],
            ("s".to_string(), "hue".to_string())
        );

        // Compiles like any patch, and live knob changes find their way in.
        let prog = compile(&outer).expect("compiles");
        assert_eq!(prog.doc.nodes.len(), 4);
        let mut rt = Runtime::new(prog);
        rt.set_param("s", "tint.hue", 0.7);
        assert_eq!(rt.doc().nodes.iter().find(|n| n.id == "s").unwrap().params["hue"], 0.7);
    }

    #[test]
    fn nesting_works_to_a_limit_and_empties_render_black() {
        let mut inner = tinted_ramp();
        let mut outer = serde_json::json!({
            "nodes": [
                { "id": "s", "kind": "subpatch", "sub": null },
                { "id": "o", "kind": "output" }
            ],
            "edges": [ { "from": { "node": "s", "port": "out" }, "to": { "node": "o", "port": "in" } } ]
        });
        // Depth 1..=4 is fine; 5 is refused.
        for depth in 1..=5 {
            outer["nodes"][0]["sub"] = inner.clone();
            let result = flatten(&doc(outer.clone()));
            if depth <= MAX_SUBPATCH_DEPTH {
                let flat = result.unwrap_or_else(|e| panic!("depth {depth}: {e}"));
                compile(&flat.doc).unwrap();
            } else {
                assert!(result.unwrap_err().contains("too deep"));
            }
            inner = serde_json::json!({
                "nodes": [
                    { "id": "s", "kind": "subpatch", "sub": inner },
                    { "id": "o", "kind": "output" }
                ],
                "edges": [ { "from": { "node": "s", "port": "out" }, "to": { "node": "o", "port": "in" } } ]
            });
        }

        let empty = doc(serde_json::json!({
            "nodes": [ { "id": "s", "kind": "subpatch" }, { "id": "o", "kind": "output" } ],
            "edges": [ { "from": { "node": "s", "port": "out" }, "to": { "node": "o", "port": "in" } } ]
        }));
        let flat = flatten(&empty).unwrap();
        assert_eq!(flat.doc.nodes[0].kind, "solid");
        assert_eq!(flat.doc.nodes[0].id, "s");
        compile(&empty).expect("an empty sub-patch still compiles");
    }

    #[test]
    fn unknown_ports_are_refused() {
        let outer = doc(serde_json::json!({
            "nodes": [
                { "id": "sl", "kind": "slider" },
                { "id": "s", "kind": "subpatch", "sub": tinted_ramp() },
                { "id": "o", "kind": "output" }
            ],
            "edges": [
                { "from": { "node": "sl", "port": "out" }, "to": { "node": "s", "port": "ramp.inner" } }
            ]
        }));
        assert!(flatten(&outer).unwrap_err().contains("no input \"ramp.inner\""));
        assert!(compile(&outer).unwrap_err().contains("ramp.inner"));
    }
}
