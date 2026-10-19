//! Patch format upgrades. Every host runs [`migrate`] where a document enters
//! it (the gate's store, presets, the wasm entry points, imports), never inside
//! `compile`: a Program's node indices must match the document the evaluator
//! holds.
//!
//! **1 → 2** (plans/explicit-output.md): format 1's Output silently composited
//! every live effect and every pen dab on top of the graph unless a Render
//! effects / Render points node was reachable. Format 2's Output shows only
//! what is wired into it, and Event effect's stream is a wire. The upgrade adds
//! exactly the wiring the old epilogue implied, so a patch looks the same:
//!
//! - effects: Triggered effects → every Event effect (chained) → a new Render
//!   effects added over the output; or, where Render effects already existed,
//!   those nodes are fed the chain instead (they used to draw every effect);
//! - dabs: Touch strokes → a new Render points ("as drawn") added over the
//!   output, unless a Render points was already wired in.
//!
//! Overlays are added with Blend (add), effects first, as the epilogue did.
//! One difference remains: an Output `master` other than 1 now also scales
//! them (the epilogue added them after it).

use crate::{Edge, NodeInst, PATCH_FORMAT, PatchDoc, PortRef};
use std::collections::BTreeMap;

/// Upgrade `doc` to [`PATCH_FORMAT`] in place. Returns whether it changed.
/// Newer formats are left alone (validation refuses them).
pub fn migrate(doc: &mut PatchDoc) -> bool {
    // Sub-patches carry whole documents of their own (format 4).
    let mut changed = false;
    for n in &mut doc.nodes {
        if let Some(sub) = n.sub.as_deref_mut() {
            changed |= migrate(sub);
        }
    }
    if doc.format >= PATCH_FORMAT {
        return changed;
    }
    if doc.format <= 1 {
        v1_to_v2(doc);
    }
    if doc.format <= 2 {
        v2_to_v3(doc);
    }
    // 3 → 4 adds fields (`sub`, Clip nodes), 4 → 5 `code`, 5 → 6 `text`:
    // additions only, nothing that exists changes.
    doc.format = PATCH_FORMAT;
    true
}

/// **2 → 3**: a Still image node used to show whatever the host's live
/// video/image feed was (the same buffer as Video in). Nodes now carry their
/// own image, so one without becomes the Video in it effectively was.
fn v2_to_v3(doc: &mut PatchDoc) {
    for n in &mut doc.nodes {
        if n.kind == "image_in" && n.media.is_none() {
            n.kind = "video_in".to_string();
        }
    }
}

fn port(node: &str, port: &str) -> PortRef {
    PortRef {
        node: node.to_string(),
        port: port.to_string(),
    }
}

fn wire(doc: &mut PatchDoc, from: PortRef, to: PortRef) {
    doc.edges.retain(|e| e.to != to);
    doc.edges.push(Edge { from, to });
}

fn upstream(doc: &PatchDoc, node: &str, port_name: &str) -> Option<PortRef> {
    doc.edges
        .iter()
        .find(|e| e.to.node == node && e.to.port == port_name)
        .map(|e| e.from.clone())
}

/// A fresh node id based on `base`.
fn fresh_id(doc: &PatchDoc, base: &str) -> String {
    let taken = |id: &str| doc.nodes.iter().any(|n| n.id == id);
    if !taken(base) {
        return base.to_string();
    }
    (2..)
        .map(|k| format!("{base}{k}"))
        .find(|id| !taken(id))
        .expect("an unused id")
}

fn add_node(doc: &mut PatchDoc, base: &str, kind: &str, pos: [f32; 2], params: &[(&str, f32)]) -> String {
    let id = fresh_id(doc, base);
    doc.nodes.push(NodeInst {
        id: id.clone(),
        kind: kind.to_string(),
        name: String::new(),
        params: params
            .iter()
            .map(|(k, v)| (k.to_string(), *v))
            .collect::<BTreeMap<_, _>>(),
        pos,
        media: None,
        code: None,
        text: None,
        sub: None,
        source: None,
        linked: false,
        source_rev: None,
        collapsed: false,
        layers: 0,
    });
    id
}

fn v1_to_v2(doc: &mut PatchDoc) {
    let Some(output) = doc.nodes.iter().find(|n| n.kind == "output").map(|n| n.id.clone()) else {
        return;
    };
    let out_pos = doc
        .nodes
        .iter()
        .find(|n| n.id == output)
        .map(|n| n.pos)
        .unwrap_or([0.0, 0.0]);

    // What the format-1 epilogue saw: nodes the output reaches.
    let mut reachable = vec![output.clone()];
    let mut i = 0;
    while i < reachable.len() {
        let at = reachable[i].clone();
        for e in &doc.edges {
            if e.to.node == at && !reachable.contains(&e.from.node) {
                reachable.push(e.from.node.clone());
            }
        }
        i += 1;
    }
    let reached = |doc: &PatchDoc, kind: &str| -> Vec<String> {
        doc.nodes
            .iter()
            .filter(|n| n.kind == kind && reachable.contains(&n.id))
            .map(|n| n.id.clone())
            .collect()
    };
    let effect_renders = reached(doc, "render_effects");
    let point_renders = reached(doc, "render_points");
    let events: Vec<String> = doc
        .nodes
        .iter()
        .filter(|n| n.kind == "event_effect")
        .map(|n| n.id.clone())
        .collect();

    let mut overlays: Vec<String> = Vec::new();
    let mut column = 1.0;
    let mut next_pos = |row: f32| {
        let p = [out_pos[0] - 260.0 * column, out_pos[1] + 220.0 * row];
        column += 1.0;
        p
    };

    // -- effects: Triggered effects, then every Event effect, as one chain --
    let head = doc
        .nodes
        .iter()
        .find(|n| n.kind == "effects_in")
        .map(|n| n.id.clone())
        .unwrap_or_else(|| add_node(doc, "effects", "effects_in", next_pos(1.0), &[]));
    let mut end = port(&head, "effects");
    for ev in &events {
        if upstream(doc, ev, "in").is_none() {
            wire(doc, end.clone(), port(ev, "in"));
        }
        end = port(ev, "effects");
    }
    if effect_renders.is_empty() {
        let render = add_node(doc, "effects_render", "render_effects", next_pos(1.0), &[]);
        wire(doc, end, port(&render, "effects"));
        overlays.push(render);
    } else {
        // They drew every effect in format 1; keep it so.
        for render in &effect_renders {
            wire(doc, end.clone(), port(render, "effects"));
        }
    }

    // -- pen strokes ---------------------------------------------------------
    if point_renders.is_empty() {
        let strokes = doc
            .nodes
            .iter()
            .find(|n| n.kind == "touch_dabs")
            .map(|n| n.id.clone())
            .unwrap_or_else(|| add_node(doc, "strokes", "touch_dabs", next_pos(2.0), &[]));
        let render = add_node(doc, "strokes_render", "render_points", next_pos(2.0), &[]);
        wire(doc, port(&strokes, "points"), port(&render, "points"));
        overlays.push(render);
    }

    // -- add each overlay over what the output shows -------------------------
    for overlay in overlays {
        let into = port(&output, "in");
        match upstream(doc, &output, "in") {
            None => wire(doc, port(&overlay, "out"), into),
            Some(current) => {
                let blend = add_node(
                    doc,
                    "overlay",
                    "blend",
                    [out_pos[0] - 130.0, out_pos[1] + 120.0],
                    &[("mode", 0.0), ("opacity", 1.0)],
                );
                wire(doc, current, port(&blend, "base"));
                wire(doc, port(&overlay, "out"), port(&blend, "over"));
                wire(doc, port(&blend, "out"), into);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codegen::compile;
    use crate::effects::effect_source;

    fn v1(json: serde_json::Value) -> PatchDoc {
        let mut doc: PatchDoc = serde_json::from_value(json).unwrap();
        doc.format = 1;
        doc
    }

    #[test]
    fn a_plain_v1_patch_gains_the_overlays_it_used_to_have() {
        let mut doc = v1(serde_json::json!({
            "nodes": [
                { "id": "n", "kind": "noise_field" },
                { "id": "fx", "kind": "event_effect", "params": { "effect": 1.0 } },
                { "id": "o", "kind": "output" }
            ],
            "edges": [{ "from": { "node": "n", "port": "out" }, "to": { "node": "o", "port": "in" } }]
        }));
        assert!(migrate(&mut doc));
        assert_eq!(doc.format, PATCH_FORMAT);
        let prog = compile(&doc).expect("migrated patch compiles");
        // Client effects and the Event effect's stream both reach the output.
        assert!(prog.wgsl.contains("E.source == 0u"));
        assert!(prog.wgsl.contains(&format!("E.source == {}u", effect_source("fx"))));
        // Pen strokes too.
        assert!(prog.wgsl.contains("dab_color(D, c, d)"));
        // Idempotent.
        let again = doc.clone();
        assert!(!migrate(&mut doc));
        assert_eq!(serde_json::to_string(&doc).unwrap(), serde_json::to_string(&again).unwrap());
    }

    #[test]
    fn existing_renderers_are_kept_and_fed_every_effect() {
        let mut doc = v1(serde_json::json!({
            "nodes": [
                { "id": "fxin", "kind": "effects_in" },
                { "id": "ev", "kind": "event_effect" },
                { "id": "re", "kind": "render_effects" },
                { "id": "td", "kind": "touch_dabs" },
                { "id": "rp", "kind": "render_points" },
                { "id": "b", "kind": "blend" },
                { "id": "o", "kind": "output" }
            ],
            "edges": [
                { "from": { "node": "fxin", "port": "effects" }, "to": { "node": "re", "port": "effects" } },
                { "from": { "node": "td", "port": "points" }, "to": { "node": "rp", "port": "points" } },
                { "from": { "node": "re", "port": "out" }, "to": { "node": "b", "port": "base" } },
                { "from": { "node": "rp", "port": "out" }, "to": { "node": "b", "port": "over" } },
                { "from": { "node": "b", "port": "out" }, "to": { "node": "o", "port": "in" } }
            ]
        }));
        let before = doc.nodes.len();
        migrate(&mut doc);
        assert_eq!(doc.nodes.len(), before, "no new nodes: renderers were already wired");
        let prog = compile(&doc).expect("compiles");
        assert!(prog.wgsl.contains(&format!("E.source == {}u", effect_source("ev"))));
        assert!(prog.wgsl.contains("E.source == 0u"));
    }

    #[test]
    fn a_v2_still_image_without_its_own_image_becomes_video_in() {
        let mut doc: PatchDoc = serde_json::from_value(serde_json::json!({
            "format": 2,
            "nodes": [
                { "id": "img", "kind": "image_in" },
                { "id": "ts", "kind": "texture_sample" },
                { "id": "o", "kind": "output" }
            ],
            "edges": [
                { "from": { "node": "img", "port": "tex" }, "to": { "node": "ts", "port": "tex" } },
                { "from": { "node": "ts", "port": "out" }, "to": { "node": "o", "port": "in" } }
            ]
        }))
        .unwrap();
        migrate(&mut doc);
        assert_eq!(doc.nodes[0].kind, "video_in");
        assert!(compile(&doc).unwrap().wgsl.contains("video_at(uv)"));
    }

    #[test]
    fn every_builtin_preset_is_current() {
        for p in crate::presets::presets() {
            assert_eq!(p.format, PATCH_FORMAT, "{} not migrated", p.name);
            compile(p).unwrap_or_else(|e| panic!("{}: {e}", p.name));
        }
    }
}
