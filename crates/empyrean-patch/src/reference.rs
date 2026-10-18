//! What a Code node body may use, read off the sources that define it so the
//! editor's completion and hover docs can never drift from the shader lib or
//! the interpreter: every top-level `fn` of `patch_lib.wgsl` with its `///`
//! doc, the struct fields (`Ctx`, `Globals`, …) with their comments, the
//! bindings and consts, and the interpreter's builtins with signatures.
//! Served as JSON (`code_reference_json`) by the wasm build and the gate.

use crate::codegen::PATCH_LIB_WGSL;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FnRef {
    pub name: String,
    /// `name(params) -> ret`, as written.
    pub signature: String,
    /// The `///` lines above it, joined; empty when undocumented.
    pub doc: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FieldRef {
    pub name: String,
    pub r#type: String,
    pub doc: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StructRef {
    pub name: String,
    pub fields: Vec<FieldRef>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GlobalRef {
    pub name: String,
    pub r#type: String,
    pub doc: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Reference {
    /// The shader lib's functions, in source order.
    pub helpers: Vec<FnRef>,
    /// The shader lib's structs (`Ctx`, `Globals`, `AudioU`, …).
    pub structs: Vec<StructRef>,
    /// Bindings (`G: Globals`, `P: array<f32>`, …) and consts (`TAU`, …).
    pub globals: Vec<GlobalRef>,
    /// What the CPU tier's interpreter can call.
    pub cpu_builtins: Vec<FnRef>,
}

/// The reference, from the sources.
pub fn reference() -> Reference {
    let mut r = parse_lib(PATCH_LIB_WGSL);
    r.cpu_builtins = crate::script::builtin_reference()
        .map(|(name, signature, doc)| FnRef {
            name: name.to_string(),
            signature: signature.to_string(),
            doc: doc.to_string(),
        })
        .collect();
    r
}

pub fn code_reference_json() -> serde_json::Value {
    serde_json::to_value(reference()).expect("reference serializes")
}

fn ident_at(s: &str) -> &str {
    let n = s
        .bytes()
        .take_while(|b| b.is_ascii_alphanumeric() || *b == b'_')
        .count();
    &s[..n]
}

/// A doc comment accumulator: `///` lines (and, inside structs, `//` lines)
/// that precede a declaration.
fn push_doc(doc: &mut Vec<String>, text: &str) {
    let text = text.trim();
    if !text.is_empty() {
        doc.push(text.to_string());
    }
}

fn parse_lib(src: &str) -> Reference {
    let mut helpers = Vec::new();
    let mut structs = Vec::new();
    let mut globals = Vec::new();
    let mut doc: Vec<String> = Vec::new();
    let mut lines = src.lines().peekable();
    while let Some(raw) = lines.next() {
        let line = raw.trim();
        if let Some(text) = line.strip_prefix("///") {
            push_doc(&mut doc, text);
            continue;
        }
        if line.starts_with("//") || line.is_empty() {
            // A plain comment or a blank line ends a doc block for functions
            // (section banners must not attach to the next helper).
            doc.clear();
            continue;
        }
        if let Some(rest) = line.strip_prefix("fn ") {
            let name = ident_at(rest);
            if !name.is_empty() {
                let sig_end = rest.find('{').unwrap_or(rest.len());
                let signature = rest[..sig_end].trim().to_string();
                helpers.push(FnRef {
                    name: name.to_string(),
                    signature,
                    doc: doc.join(" "),
                });
            }
            doc.clear();
            // Skip the body (braces balance across lines).
            let mut depth = line.matches('{').count() as i64 - line.matches('}').count() as i64;
            while depth > 0 {
                let Some(l) = lines.next() else { break };
                depth += l.matches('{').count() as i64 - l.matches('}').count() as i64;
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("struct ") {
            let name = ident_at(rest).to_string();
            doc.clear();
            let mut fields = Vec::new();
            let mut field_doc: Vec<String> = Vec::new();
            for l in lines.by_ref() {
                let l = l.trim();
                if l.starts_with('}') {
                    break;
                }
                if let Some(text) = l.strip_prefix("//") {
                    push_doc(&mut field_doc, text.trim_start_matches('/'));
                    continue;
                }
                let fname = ident_at(l);
                if fname.is_empty() {
                    continue;
                }
                let after = l[fname.len()..].trim_start();
                let Some(after) = after.strip_prefix(':') else { continue };
                let (ty, trailing) = match after.find("//") {
                    Some(at) => (&after[..at], after[at + 2..].trim()),
                    None => (after, ""),
                };
                let ty = ty.trim().trim_end_matches(',').trim().to_string();
                if !trailing.is_empty() {
                    push_doc(&mut field_doc, trailing);
                }
                if !fname.starts_with('_') {
                    fields.push(FieldRef {
                        name: fname.to_string(),
                        r#type: ty,
                        doc: field_doc.join(" "),
                    });
                }
                field_doc.clear();
            }
            structs.push(StructRef { name, fields });
            continue;
        }
        if let Some(at) = line.find("var<") {
            // `@group(0) @binding(n) var<storage, read> NAME: TYPE;`
            if let Some(close) = line[at..].find("> ") {
                let decl = &line[at + close + 2..];
                let name = ident_at(decl);
                let ty = decl[name.len()..]
                    .trim_start()
                    .strip_prefix(':')
                    .map(|t| t.trim().trim_end_matches(';').trim().to_string())
                    .unwrap_or_default();
                if !name.is_empty() {
                    globals.push(GlobalRef {
                        name: name.to_string(),
                        r#type: ty,
                        doc: doc.join(" "),
                    });
                }
            }
            doc.clear();
            continue;
        }
        if let Some(rest) = line.strip_prefix("const ") {
            let name = ident_at(rest);
            let ty = rest[name.len()..]
                .trim_start()
                .strip_prefix(':')
                .and_then(|t| t.split('=').next())
                .map(|t| t.trim().to_string())
                .unwrap_or_default();
            if !name.is_empty() {
                globals.push(GlobalRef {
                    name: name.to_string(),
                    r#type: ty,
                    doc: doc.join(" "),
                });
            }
            doc.clear();
            continue;
        }
        doc.clear();
    }
    Reference {
        helpers,
        structs,
        globals,
        cpu_builtins: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_lib_is_read_correctly() {
        let r = reference();
        let f = |name: &str| r.helpers.iter().find(|h| h.name == name).unwrap_or_else(|| panic!("{name}"));
        assert_eq!(f("hsv2rgb").signature, "hsv2rgb(h: f32, s: f32, v: f32) -> vec3f");
        assert!(f("ctx_transform").doc.contains("kaleidoscope"), "{:?}", f("ctx_transform").doc);
        assert!(f("cosine_palette").doc.contains("Quilez"));
        assert!(f("snoise3").signature.starts_with("snoise3(v: vec3f)"));
        // One-line helpers are read too, and bodies are skipped whole.
        assert!(r.helpers.iter().any(|h| h.name == "mod289v3"));
        assert!(!r.helpers.iter().any(|h| h.name == "main"), "no entry point in the lib");
        let ctx = r.structs.iter().find(|s| s.name == "Ctx").expect("Ctx");
        let names: Vec<&str> = ctx.fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["spoke", "i", "theta", "r01", "rn", "pos"]);
        let r01 = ctx.fields.iter().find(|f| f.name == "r01").unwrap();
        assert_eq!(r01.r#type, "f32");
        assert!(r01.doc.contains("OUTER"), "{:?}", r01.doc);
        let g = r.structs.iter().find(|s| s.name == "Globals").expect("Globals");
        assert!(g.fields.iter().any(|f| f.name == "time" && f.r#type == "f32"));
        assert!(!g.fields.iter().any(|f| f.name.starts_with("_pad")), "pads hidden");
        let hue = g.fields.iter().find(|f| f.name == "hue_target").unwrap();
        assert!(hue.doc.contains("hue"), "{:?}", hue.doc);
        let gl = |name: &str| r.globals.iter().find(|g| g.name == name).unwrap_or_else(|| panic!("{name}"));
        assert_eq!(gl("G").r#type, "Globals");
        assert_eq!(gl("TAU").r#type, "f32");
        assert!(gl("P").r#type.starts_with("array<f32"));
        assert!(r.cpu_builtins.iter().any(|b| b.name == "mix" && b.signature == "mix(a, b, t)"));
        // It serializes (the hosts ship it as JSON).
        let json = code_reference_json();
        assert!(json["helpers"].as_array().unwrap().len() > 20);
    }
}
