//! On-disk patch storage: one pretty-printed JSON file per patch in
//! `<config dir>/patches/`. Identity is the `id` field (UUID string), not the
//! filename — files are named `<name slug>-<id prefix>.json` for humans and
//! renamed to follow patch renames. `EMPYREAN_CONFIG` relocates the config
//! file and therefore this directory too (tests, isolated instances).

use super::{PATCH_FORMAT, PatchDoc, flatten, links};
use serde::Serialize;
use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// What `PatchList` returns — enough for a palette/browser without shipping
/// every graph to every client.
#[derive(Debug, Clone, Serialize)]
pub struct PatchSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub nodes: usize,
    /// Every node kind it uses, its sub-patches' insides included (the
    /// patch browser's topics).
    pub kinds: Vec<String>,
    /// Its Sub-patch nodes (the patch browser's tree).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub subpatches: Vec<SubpatchSummary>,
}

/// A Sub-patch node, as the patch browser lists it.
#[derive(Debug, Clone, Serialize)]
pub struct SubpatchSummary {
    pub node: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub linked: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub subpatches: Vec<SubpatchSummary>,
}

fn summary(doc: PatchDoc) -> PatchSummary {
    let mut kinds = BTreeSet::new();
    collect_kinds(&doc, &mut kinds);
    PatchSummary {
        subpatches: subpatches(&doc),
        kinds: kinds.into_iter().collect(),
        nodes: doc.nodes.len(),
        id: doc.id,
        name: doc.name,
        description: doc.description,
    }
}

fn collect_kinds(doc: &PatchDoc, kinds: &mut BTreeSet<String>) {
    for n in &doc.nodes {
        kinds.insert(n.kind.clone());
        if let Some(sub) = &n.sub {
            collect_kinds(sub, kinds);
        }
    }
}

fn subpatches(doc: &PatchDoc) -> Vec<SubpatchSummary> {
    doc.nodes
        .iter()
        .filter(|n| n.kind == flatten::KIND)
        .map(|n| SubpatchSummary {
            node: n.id.clone(),
            name: if !n.name.is_empty() {
                n.name.clone()
            } else {
                n.sub.as_ref().map(|s| s.name.clone()).filter(|s| !s.is_empty()).unwrap_or_else(|| "Sub-patch".into())
            },
            source: n.source.clone(),
            linked: n.linked,
            subpatches: n.sub.as_deref().map(subpatches).unwrap_or_default(),
        })
        .collect()
}

pub fn patches_dir() -> PathBuf {
    crate::config::config_path()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("patches")
}

/// All readable patches, sorted by name. Unparseable files are skipped with a
/// warning — one hand-edited broken file must not hide the rest.
pub fn list(dir: &Path) -> Vec<PatchSummary> {
    let mut out: Vec<PatchSummary> = read_all(dir).into_iter().map(|(_, doc)| summary(doc)).collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn load(dir: &Path, id: &str) -> Result<PatchDoc, String> {
    find(dir, id)
        .map(|(_, doc)| doc)
        .ok_or_else(|| format!("no patch with id {id}"))
}

/// Persist a patch. Assigns an id when missing (returns it via the doc),
/// stamps the current format, and follows renames by moving the file.
pub fn save(dir: &Path, doc: &mut PatchDoc) -> Result<PathBuf, String> {
    if doc.format > PATCH_FORMAT {
        // A newer app's file must not be rewritten (and downgraded) by this one.
        return Err(format!(
            "patch format {} is newer than this app understands ({PATCH_FORMAT})",
            doc.format
        ));
    }
    // An older document (an import, a follower syncing from an older leader)
    // is upgraded before it is stamped current.
    crate::patch::migrate::migrate(doc);
    doc.format = PATCH_FORMAT;
    if doc.id.is_empty() {
        doc.id = uuid::Uuid::new_v4().to_string();
    }
    if doc.name.trim().is_empty() {
        doc.name = "Untitled".into();
    }
    fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    let path = dir.join(file_name(doc));
    let json = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))?;

    // A rename produces a fresh slug — drop EVERY other file carrying this id
    // so the store never yields duplicates. (Not `find`: directory enumeration
    // order is filesystem-dependent, and on APFS the fresh file can enumerate
    // first, which left the stale one alive. Caught by CI on macOS.)
    for (other_path, other_doc) in read_all(dir) {
        if other_doc.id == doc.id && other_path != path {
            let _ = fs::remove_file(&other_path);
        }
    }
    Ok(path)
}

/// After `saved` was stored: refresh its linked copies in every other patch,
/// and theirs in turn when that changes them (see [`links`]). Returns the
/// ids of the patches rewritten.
pub fn propagate_links(dir: &Path, saved: &PatchDoc) -> Vec<String> {
    let mut changed = Vec::new();
    let mut seen = HashSet::from([saved.id.clone()]);
    let mut queue = vec![saved.clone()];
    while let Some(source) = queue.pop() {
        for (_, mut doc) in read_all(dir) {
            if doc.id == source.id || !links::links_to(&doc, &source.id) || !links::sync_links(&mut doc, &source) {
                continue;
            }
            match save(dir, &mut doc) {
                Ok(_) => {
                    if !changed.contains(&doc.id) {
                        changed.push(doc.id.clone());
                    }
                    if seen.insert(doc.id.clone()) {
                        queue.push(doc);
                    }
                }
                Err(e) => log::warn!("refreshing the links in {}: {e}", doc.id),
            }
        }
    }
    changed
}

pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    let (path, _) = find(dir, id).ok_or_else(|| format!("no patch with id {id}"))?;
    fs::remove_file(&path).map_err(|e| format!("delete {}: {e}", path.display()))
}

fn find(dir: &Path, id: &str) -> Option<(PathBuf, PatchDoc)> {
    read_all(dir).into_iter().find(|(_, d)| d.id == id)
}

fn read_all(dir: &Path) -> Vec<(PathBuf, PatchDoc)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|text| serde_json::from_str::<PatchDoc>(&text).map_err(|e| e.to_string()))
        {
            Ok(doc) if doc.format > PATCH_FORMAT => {
                log::warn!(
                    "skipping {} (format {} is newer than this app)",
                    path.display(),
                    doc.format
                );
            }
            Ok(doc) if doc.id.is_empty() => {
                log::warn!("skipping {} (missing patch id)", path.display());
            }
            Ok(mut doc) => {
                // Older formats are upgraded as they are read; the file itself
                // is rewritten on the next save.
                crate::patch::migrate::migrate(&mut doc);
                out.push((path, doc));
            }
            Err(e) => log::warn!("skipping unreadable patch {}: {e}", path.display()),
        }
    }
    out
}

fn file_name(doc: &PatchDoc) -> String {
    let slug: String = doc
        .name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() {
        "patch".into()
    } else {
        slug
    };
    let id8 = &doc.id[..doc.id.len().min(8)];
    format!("{slug}-{id8}.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("empyrean-patch-test-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            Self(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample(name: &str) -> PatchDoc {
        PatchDoc {
            name: name.into(),
            ..Default::default()
        }
    }

    #[test]
    fn a_format_1_file_loads_upgraded() {
        let tmp = TempDir::new("migrate");
        let dir = &tmp.0;
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("old-11111111.json"),
            r#"{"format":1,"id":"11111111-old","name":"Old","nodes":[
                {"id":"n","kind":"noise_field"},{"id":"o","kind":"output"}],
               "edges":[{"from":{"node":"n","port":"out"},"to":{"node":"o","port":"in"}}]}"#,
        )
        .unwrap();
        let doc = load(dir, "11111111-old").unwrap();
        assert_eq!(doc.format, PATCH_FORMAT);
        // The overlays format 1 drew implicitly are now wired in.
        assert!(doc.nodes.iter().any(|n| n.kind == "render_effects"));
        assert!(doc.nodes.iter().any(|n| n.kind == "render_points"));
        crate::patch::codegen::compile(&doc).expect("compiles");
    }

    #[test]
    fn saving_a_patch_refreshes_its_linked_copies_down_the_chain() {
        use crate::patch::NodeInst;
        let tmp = TempDir::new("links");
        let dir = &tmp.0;
        let solid = |id: &str| NodeInst { id: id.into(), kind: "solid".into(), ..Default::default() };
        let link = |id: &str, to: &PatchDoc| NodeInst {
            id: id.into(),
            kind: flatten::KIND.into(),
            sub: Some(Box::new(links::snapshot(to))),
            source: Some(to.id.clone()),
            linked: true,
            ..Default::default()
        };
        let mut a = PatchDoc { nodes: vec![solid("x")], ..sample("A") };
        save(dir, &mut a).unwrap();
        let mut b = PatchDoc { nodes: vec![link("sa", &a)], ..sample("B") };
        save(dir, &mut b).unwrap();
        let mut c = PatchDoc { nodes: vec![link("sb", &b)], ..sample("C") };
        save(dir, &mut c).unwrap();
        let mut d = sample("Unrelated");
        save(dir, &mut d).unwrap();

        a.nodes.push(solid("y"));
        save(dir, &mut a).unwrap();
        let mut changed = propagate_links(dir, &a);
        changed.sort();
        let mut want = vec![b.id.clone(), c.id.clone()];
        want.sort();
        assert_eq!(changed, want);
        let c = load(dir, &c.id).unwrap();
        let inner_a = c.nodes[0].sub.as_ref().unwrap().nodes[0].sub.as_ref().unwrap();
        assert_eq!(inner_a.nodes.len(), 2, "C sees A's new node through B");

        let listed = list(dir);
        let c_sum = listed.iter().find(|s| s.id == c.id).unwrap();
        assert_eq!(c_sum.subpatches[0].name, "B");
        assert!(c_sum.subpatches[0].linked);
        assert_eq!(c_sum.subpatches[0].subpatches[0].source.as_deref(), Some(a.id.as_str()));
        assert_eq!(c_sum.kinds, vec!["solid".to_string(), flatten::KIND.to_string()]);
    }

    #[test]
    fn save_load_list_delete_round_trip() {
        let tmp = TempDir::new("roundtrip");
        let dir = &tmp.0;

        let mut a = sample("Warm Wash");
        let path = save(dir, &mut a).unwrap();
        assert!(!a.id.is_empty(), "save assigns an id");
        assert!(
            path.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("warm-wash-")
        );

        let mut b = sample("Beat Rings");
        save(dir, &mut b).unwrap();

        let all = list(dir);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "Beat Rings", "sorted by name");

        let loaded = load(dir, &a.id).unwrap();
        assert_eq!(loaded.name, "Warm Wash");

        delete(dir, &a.id).unwrap();
        assert_eq!(list(dir).len(), 1);
        assert!(load(dir, &a.id).is_err());
        assert!(delete(dir, &a.id).is_err());
    }

    #[test]
    fn rename_moves_the_file_and_keeps_one_copy() {
        let tmp = TempDir::new("rename");
        let dir = &tmp.0;

        let mut doc = sample("First Name");
        let old_path = save(dir, &mut doc).unwrap();
        doc.name = "Second Name".into();
        let new_path = save(dir, &mut doc).unwrap();

        assert_ne!(old_path, new_path);
        assert!(!old_path.exists(), "old file removed on rename");
        assert_eq!(list(dir).len(), 1);
        assert_eq!(load(dir, &doc.id).unwrap().name, "Second Name");
    }

    #[test]
    fn broken_files_are_skipped_not_fatal() {
        let tmp = TempDir::new("broken");
        let dir = &tmp.0;

        let mut ok = sample("Good");
        save(dir, &mut ok).unwrap();
        fs::write(dir.join("junk.json"), "{ not json").unwrap();
        fs::write(
            dir.join("future.json"),
            format!(
                r#"{{"format":{},"id":"f","name":"future"}}"#,
                PATCH_FORMAT + 1
            ),
        )
        .unwrap();

        let all = list(dir);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Good");
    }

    #[test]
    fn newer_format_docs_are_not_rewritten() {
        let tmp = TempDir::new("nodowngrade");
        let mut doc = sample("From The Future");
        doc.format = PATCH_FORMAT + 1;
        assert!(save(&tmp.0, &mut doc).is_err());
    }

    #[test]
    fn empty_name_gets_a_placeholder() {
        let tmp = TempDir::new("noname");
        let mut doc = sample("   ");
        save(&tmp.0, &mut doc).unwrap();
        assert_eq!(doc.name, "Untitled");
        assert_eq!(list(&tmp.0)[0].name, "Untitled");
    }
}
