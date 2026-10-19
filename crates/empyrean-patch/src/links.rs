//! Linked sub-patches. A Sub-patch node that came from a saved patch or a
//! built-in names it in [`NodeInst::source`](crate::NodeInst::source); while
//! [`linked`](crate::NodeInst::linked) it carries a copy of that source that
//! follows it. The copy stays in `sub`, so compiling, files and submissions
//! never need the library: whoever saves a patch calls [`sync_links`] on the
//! patches that link it (the gate's file store, the playground's browser
//! store), and editors refresh built-ins, which change only with the app.

use crate::PatchDoc;
use crate::flatten::KIND;

/// What a Sub-patch linked to `source` holds: the source, without its id
/// (the node's `source` says where it came from).
pub fn snapshot(source: &PatchDoc) -> PatchDoc {
    let mut copy = source.clone();
    copy.id = String::new();
    copy
}

/// Whether `doc` links the patch `id` anywhere: in its own Sub-patch nodes or
/// inside them, at any depth.
pub fn links_to(doc: &PatchDoc, id: &str) -> bool {
    doc.nodes.iter().filter(|n| n.kind == KIND).any(|n| {
        (n.linked && n.source.as_deref() == Some(id)) || n.sub.as_deref().is_some_and(|s| links_to(s, id))
    })
}

/// Refresh every Sub-patch in `doc` that is linked to `source` (at any
/// depth) with a fresh [`snapshot`]. True when anything changed. A source
/// that links `doc` itself is refused (nothing changes): copying it in would
/// nest the two inside each other without end.
pub fn sync_links(doc: &mut PatchDoc, source: &PatchDoc) -> bool {
    if source.id.is_empty() || (!doc.id.is_empty() && (source.id == doc.id || links_to(source, &doc.id))) {
        return false;
    }
    let fresh = snapshot(source);
    sync_into(doc, &source.id, &fresh)
}

fn sync_into(doc: &mut PatchDoc, id: &str, fresh: &PatchDoc) -> bool {
    let mut changed = false;
    for n in doc.nodes.iter_mut().filter(|n| n.kind == KIND) {
        if n.linked && n.source.as_deref() == Some(id) {
            if n.sub.as_deref().is_none_or(|s| !same(s, fresh)) {
                n.sub = Some(Box::new(fresh.clone()));
                changed = true;
            }
        } else if let Some(sub) = n.sub.as_deref_mut() {
            changed |= sync_into(sub, id, fresh);
        }
    }
    changed
}

fn same(a: &PatchDoc, b: &PatchDoc) -> bool {
    serde_json::to_value(a).ok() == serde_json::to_value(b).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NodeInst;

    fn doc(id: &str, nodes: Vec<NodeInst>) -> PatchDoc {
        PatchDoc { id: id.into(), name: id.into(), nodes, ..Default::default() }
    }

    fn solid(id: &str) -> NodeInst {
        NodeInst { id: id.into(), kind: "solid".into(), ..Default::default() }
    }

    fn sub(id: &str, source: &str, linked: bool, inner: PatchDoc) -> NodeInst {
        NodeInst {
            id: id.into(),
            kind: KIND.into(),
            sub: Some(Box::new(inner)),
            source: Some(source.into()),
            linked,
            ..Default::default()
        }
    }

    #[test]
    fn a_linked_copy_follows_its_source_and_a_clone_does_not() {
        let old = doc("a", vec![solid("x")]);
        let mut parent = doc(
            "p",
            vec![sub("s1", "a", true, snapshot(&old)), sub("s2", "a", false, snapshot(&old))],
        );
        let new = doc("a", vec![solid("x"), solid("y")]);
        assert!(sync_links(&mut parent, &new));
        assert_eq!(parent.nodes[0].sub.as_ref().unwrap().nodes.len(), 2);
        assert_eq!(parent.nodes[0].sub.as_ref().unwrap().id, "");
        assert_eq!(parent.nodes[1].sub.as_ref().unwrap().nodes.len(), 1, "a clone is its own");
        assert!(!sync_links(&mut parent, &new), "already current");
    }

    #[test]
    fn links_inside_a_clone_are_followed_too() {
        let a = doc("a", vec![solid("x")]);
        let inner = doc("", vec![sub("deep", "a", true, snapshot(&a))]);
        let mut parent = doc("p", vec![sub("s", "b", false, inner)]);
        assert!(links_to(&parent, "a"));
        assert!(!links_to(&parent, "b"), "a clone is not a link");
        let a2 = doc("a", vec![solid("x"), solid("y"), solid("z")]);
        assert!(sync_links(&mut parent, &a2));
        let deep = &parent.nodes[0].sub.as_ref().unwrap().nodes[0];
        assert_eq!(deep.sub.as_ref().unwrap().nodes.len(), 3);
    }

    #[test]
    fn a_source_that_links_back_is_refused() {
        let p0 = doc("p", vec![solid("x")]);
        let a = doc("a", vec![sub("back", "p", true, snapshot(&p0))]);
        let mut parent = doc("p", vec![sub("s", "a", true, doc("", vec![]))]);
        assert!(!sync_links(&mut parent, &a));
        let itself = parent.clone();
        assert!(!sync_links(&mut parent, &itself), "nor itself");
    }

    #[test]
    fn link_fields_round_trip_and_stay_out_of_plain_nodes() {
        let parent = doc("p", vec![solid("x"), sub("s", "builtin-scope", true, doc("", vec![]))]);
        let json = serde_json::to_string(&parent).unwrap();
        assert_eq!(json.matches("\"linked\":true").count(), 1);
        assert_eq!(json.matches("\"source\"").count(), 1);
        let back: PatchDoc = serde_json::from_str(&json).unwrap();
        assert!(back.nodes[1].linked);
        assert_eq!(back.nodes[1].source.as_deref(), Some("builtin-scope"));
    }
}
