//! On-disk patch storage: one pretty-printed JSON file per patch in
//! `<config dir>/patches/`. Identity is the `id` field (UUID string), not the
//! filename — files are named `<name slug>-<id prefix>.json` for humans and
//! renamed to follow patch renames. `EMPYREAN_CONFIG` relocates the config
//! file and therefore this directory too (tests, isolated instances).

use super::{PATCH_FORMAT, PatchDoc};
use serde::Serialize;
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
    let mut out: Vec<PatchSummary> = read_all(dir)
        .into_iter()
        .map(|(_, doc)| PatchSummary {
            id: doc.id,
            name: doc.name,
            description: doc.description,
            nodes: doc.nodes.len(),
        })
        .collect();
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

    // A rename produces a fresh slug — drop any other file carrying this id so
    // the store never yields duplicates.
    if let Some((old, _)) = find(dir, &doc.id) {
        if old != path {
            let _ = fs::remove_file(&old);
        }
    }
    Ok(path)
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
            Ok(doc) => out.push((path, doc)),
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
