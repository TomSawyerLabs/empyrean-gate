//! Code nodes: a node whose ports and body are data on the instance
//! ([`crate::NodeInst::code`]). The body is WGSL. Which tier runs it follows
//! from the ports: all Scalar/Event → the CPU, every frame, through the
//! interpreter in [`crate::script`] (a WGSL subset, total and bounded, so a
//! submission can never run anything native); any field output → the GPU,
//! where the body is pasted into a generated function with the lib's helpers
//! in scope (see `codegen`).
//!
//! User text reaches WGSL in exactly two places, both here: port names, which
//! must pass [`check_ident`], and the body, which only ever goes through
//! [`rewrite_body`]. Everything else the generator writes is mangled.
//! Design: `plans/code-node.md`.

use crate::Shape;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;

/// The node kind whose interface and body live on the instance.
pub const KIND: &str = "code";
/// Longest accepted body.
pub const MAX_CODE_BYTES: usize = 8192;
/// Ports per direction.
pub const MAX_CODE_PORTS: usize = 16;
/// Longest accepted port name.
pub const MAX_IDENT_LEN: usize = 32;

/// One declared port. `min`/`max`/`default` only mean something for a
/// Scalar input, where they make the port a knob like a built-in node's
/// Number param (the knob value is the unwired fallback).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CodePort {
    pub name: String,
    pub shape: Shape,
    pub min: f32,
    pub max: f32,
    pub default: f32,
}

impl Default for CodePort {
    fn default() -> Self {
        Self {
            name: String::new(),
            shape: Shape::Scalar,
            min: 0.0,
            max: 1.0,
            default: 0.0,
        }
    }
}

/// A Code node's interface and body.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CodeDef {
    pub inputs: Vec<CodePort>,
    pub outputs: Vec<CodePort>,
    pub body: String,
}

/// Where a Code node runs, decided by its ports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    /// Scalar/Event ports only: interpreted every frame.
    Cpu,
    /// At least one field output: compiled into the patch shader.
    Gpu,
}

impl CodeDef {
    pub fn input(&self, name: &str) -> Option<&CodePort> {
        self.inputs.iter().find(|p| p.name == name)
    }

    pub fn output(&self, name: &str) -> Option<&CodePort> {
        self.outputs.iter().find(|p| p.name == name)
    }

    /// The output that stands for the node where one is needed: `out`, else
    /// the first declared.
    pub fn principal(&self) -> Option<&CodePort> {
        self.output("out").or_else(|| self.outputs.first())
    }

    /// The tier the ports imply, or why they imply none. Points, Effects,
    /// Texture and Pixels ports are refused: each needs its own binding
    /// idiom in the body (a follow-up).
    pub fn tier(&self) -> Result<Tier, String> {
        if self.outputs.is_empty() {
            return Err("a Code node needs at least one output".into());
        }
        let field = |s: Shape| matches!(s, Shape::FieldScalar | Shape::FieldColor);
        let control = |s: Shape| matches!(s, Shape::Scalar | Shape::Event);
        for p in self.inputs.iter().chain(&self.outputs) {
            if !field(p.shape) && !control(p.shape) {
                return Err(format!(
                    "port \"{}\": {:?} ports are not supported on Code nodes yet",
                    p.name, p.shape
                ));
            }
        }
        if self.outputs.iter().any(|p| field(p.shape)) {
            for p in &self.outputs {
                if !field(p.shape) {
                    return Err(format!(
                        "output \"{}\": a Code node that makes a field runs on the GPU, where a {:?} output cannot exist; split it into two nodes",
                        p.name, p.shape
                    ));
                }
            }
            for p in &self.inputs {
                if p.shape == Shape::Event {
                    return Err(format!(
                        "input \"{}\": events only reach CPU nodes; a Code node that makes a field runs on the GPU",
                        p.name
                    ));
                }
            }
            Ok(Tier::Gpu)
        } else {
            for p in &self.inputs {
                if field(p.shape) {
                    return Err(format!(
                        "input \"{}\": a field can only be read by a node that makes a field (this one outputs scalars, so it runs on the CPU)",
                        p.name
                    ));
                }
            }
            Ok(Tier::Cpu)
        }
    }

    /// Every structural check: port counts and names, body size, a tier,
    /// and for the CPU tier a body that parses. Returns the tier.
    pub fn check(&self) -> Result<Tier, String> {
        if self.inputs.len() > MAX_CODE_PORTS || self.outputs.len() > MAX_CODE_PORTS {
            return Err(format!("at most {MAX_CODE_PORTS} inputs and {MAX_CODE_PORTS} outputs"));
        }
        if self.body.len() > MAX_CODE_BYTES {
            return Err(format!(
                "body is {} bytes; the limit is {MAX_CODE_BYTES}",
                self.body.len()
            ));
        }
        let mut seen: HashSet<&str> = HashSet::new();
        for (dir, p) in self
            .inputs
            .iter()
            .map(|p| ("input", p))
            .chain(self.outputs.iter().map(|p| ("output", p)))
        {
            check_ident(&p.name).map_err(|e| format!("{dir} \"{}\": {e}", p.name))?;
            if !seen.insert(p.name.as_str()) {
                return Err(format!("two ports are named \"{}\"", p.name));
            }
            if p.shape == Shape::Scalar && dir == "input" {
                if !(p.min.is_finite() && p.max.is_finite() && p.default.is_finite()) {
                    return Err(format!("input \"{}\": its range must be finite", p.name));
                }
                if p.min > p.max {
                    return Err(format!("input \"{}\": min is above max", p.name));
                }
            }
        }
        let tier = self.tier()?;
        if tier == Tier::Cpu {
            crate::script::compile(self).map_err(|e| e.to_string())?;
        }
        Ok(tier)
    }
}

/// Names the lib already uses at module scope (`fn`, `const`, `struct`,
/// bindings), scanned once from the WGSL source so a new helper can never be
/// shadowed by a port without this list knowing.
fn lib_globals() -> &'static HashSet<&'static str> {
    static GLOBALS: OnceLock<HashSet<&'static str>> = OnceLock::new();
    GLOBALS.get_or_init(|| {
        let mut set = HashSet::new();
        for line in crate::codegen::PATCH_LIB_WGSL.lines() {
            let line = line.trim_start();
            let rest = if let Some(r) = line.strip_prefix("fn ") {
                r
            } else if let Some(r) = line.strip_prefix("const ") {
                r
            } else if let Some(r) = line.strip_prefix("struct ") {
                r
            } else if let Some(at) = line.find("var<") {
                // `@group(0) @binding(n) var<storage, read> NAME:` / `var<private> NAME`
                match line[at..].find("> ") {
                    Some(close) => &line[at + close + 2..],
                    None => continue,
                }
            } else {
                continue;
            };
            let name: &str = rest
                .split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_'))
                .next()
                .unwrap_or("");
            if !name.is_empty() {
                set.insert(name);
            }
        }
        set
    })
}

/// Names the generated code and the interpreter use around the body.
const OURS: &[&str] = &["c", "c0", "ctx", "dt", "state", "PI", "TAU", "out_"];

/// Whether `name` may be a port: a plain identifier that is not a WGSL
/// keyword, reserved word or builtin, not one of the lib's globals, not
/// something the generator writes, and not ending in `_at` (the resample
/// form of a field input).
pub fn check_ident(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("a port needs a name".into());
    }
    if name.len() > MAX_IDENT_LEN {
        return Err(format!("names are at most {MAX_IDENT_LEN} characters"));
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphabetic() {
        return Err("a name starts with a letter".into());
    }
    if !chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
        return Err("a name is letters, digits and underscores".into());
    }
    if name.contains("__") {
        return Err("a name cannot contain a double underscore".into());
    }
    if name.ends_with("_at") {
        return Err("names ending in _at are reserved for resampling a field input".into());
    }
    if generated_name(name) {
        return Err("names like n3_… are reserved for generated code".into());
    }
    if WGSL_RESERVED.contains(&name) {
        return Err(format!("\"{name}\" is a WGSL keyword"));
    }
    if WGSL_BUILTIN.contains(&name) {
        return Err(format!("\"{name}\" is a WGSL builtin"));
    }
    if lib_globals().contains(name) || OURS.contains(&name) {
        return Err(format!("\"{name}\" is already used by the patch shader"));
    }
    Ok(())
}

/// `n<digits>_…`: what the generator names node functions.
fn generated_name(name: &str) -> bool {
    let rest = match name.strip_prefix('n') {
        Some(r) => r,
        None => return false,
    };
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    digits > 0 && rest[digits..].starts_with('_')
}

/// The body with every `<field input>_at` identifier replaced by that
/// node's resampling function `n<node>_in_<field input>`. Comments are copied
/// through untouched; nothing else in the text changes. WGSL has no string
/// literals, so identifiers and comments are the only lexical structure
/// that matters.
pub fn rewrite_body(body: &str, node: usize, field_inputs: &[&str]) -> String {
    let mut out = String::with_capacity(body.len() + 64);
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'/' && bytes.get(i + 1) == Some(&b'/') {
            let end = body[i..].find('\n').map_or(bytes.len(), |n| i + n);
            out.push_str(&body[i..end]);
            i = end;
        } else if b == b'/' && bytes.get(i + 1) == Some(&b'*') {
            let end = body[i + 2..].find("*/").map_or(bytes.len(), |n| i + 2 + n + 2);
            out.push_str(&body[i..end]);
            i = end;
        } else if b.is_ascii_alphabetic() || b == b'_' {
            let end = i + body[i..]
                .bytes()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == b'_')
                .count();
            let ident = &body[i..end];
            match ident
                .strip_suffix("_at")
                .filter(|base| field_inputs.contains(base))
            {
                Some(base) => {
                    out.push_str(&format!("n{node}_in_{base}"));
                }
                None => out.push_str(ident),
            }
            i = end;
        } else if b.is_ascii_digit() {
            // A number: digits, letters (suffixes, hex, exponents) and dots,
            // so `1e5_at` can never be mistaken for an identifier.
            let end = i + body[i..]
                .bytes()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'.')
                .count();
            out.push_str(&body[i..end]);
            i = end;
        } else {
            let ch = body[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// WGSL keywords and reserved words (naga `keywords/wgsl.rs`, spec
/// 2025-08-09 §keyword-summary).
const WGSL_RESERVED: &[&str] = &[
    "alias", "break", "case", "const", "const_assert", "continue", "continuing", "default",
    "diagnostic", "discard", "else", "enable", "false", "fn", "for", "if", "let", "loop",
    "override", "requires", "return", "struct", "switch", "true", "var", "while", "NULL", "Self",
    "abstract", "active", "alignas", "alignof", "as", "asm", "asm_fragment", "async",
    "attribute", "auto", "await", "become", "cast", "catch", "class", "co_await", "co_return",
    "co_yield", "coherent", "column_major", "common", "compile", "compile_fragment", "concept",
    "const_cast", "consteval", "constexpr", "constinit", "crate", "debugger", "decltype",
    "delete", "demote", "demote_to_helper", "do", "dynamic_cast", "enum", "explicit", "export",
    "extends", "extern", "external", "fallthrough", "filter", "final", "finally", "friend",
    "from", "fxgroup", "get", "goto", "groupshared", "highp", "impl", "implements", "import",
    "inline", "instanceof", "interface", "layout", "lowp", "macro", "macro_rules", "match",
    "mediump", "meta", "mod", "module", "move", "mut", "mutable", "namespace", "new", "nil",
    "noexcept", "noinline", "nointerpolation", "non_coherent", "noncoherent", "noperspective",
    "null", "nullptr", "of", "operator", "package", "packoffset", "partition", "pass", "patch",
    "pixelfragment", "precise", "precision", "premerge", "priv", "protected", "pub", "public",
    "readonly", "ref", "regardless", "register", "reinterpret_cast", "require", "resource",
    "restrict", "self", "set", "shared", "sizeof", "smooth", "snorm", "static", "static_assert",
    "static_cast", "std", "subroutine", "super", "target", "template", "this", "thread_local",
    "throw", "trait", "try", "type", "typedef", "typeid", "typename", "typeof", "union",
    "unless", "unorm", "unsafe", "unsized", "use", "using", "varying", "virtual", "volatile",
    "wgsl", "where", "with", "writeonly", "yield",
];

/// WGSL predeclared types, enumerants and builtin functions. Shadowable in
/// WGSL, but a port named `mix` would break the body's own `mix()` calls.
const WGSL_BUILTIN: &[&str] = &[
    "bool", "i32", "u32", "f32", "f16", "array", "atomic", "vec2", "vec3", "vec4", "vec2f",
    "vec3f", "vec4f", "vec2i", "vec3i", "vec4i", "vec2u", "vec3u", "vec4u", "vec2h", "vec3h",
    "vec4h", "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3",
    "mat4x4", "mat2x2f", "mat3x3f", "mat4x4f", "ptr", "sampler", "sampler_comparison",
    "texture_1d", "texture_2d", "texture_2d_array", "texture_3d", "texture_cube",
    "texture_cube_array", "texture_multisampled_2d", "texture_depth_multisampled_2d",
    "texture_external", "texture_storage_1d", "texture_storage_2d", "texture_storage_2d_array",
    "texture_storage_3d", "texture_depth_2d", "texture_depth_2d_array", "texture_depth_cube",
    "texture_depth_cube_array", "read", "write", "read_write", "function", "private",
    "workgroup", "uniform", "storage", "bitcast", "all", "any", "select", "arrayLength", "abs",
    "acos", "acosh", "asin", "asinh", "atan", "atanh", "atan2", "ceil", "clamp", "cos", "cosh",
    "countLeadingZeros", "countOneBits", "countTrailingZeros", "cross", "degrees", "determinant",
    "distance", "dot", "dot4U8Packed", "dot4I8Packed", "exp", "exp2", "extractBits",
    "faceForward", "firstLeadingBit", "firstTrailingBit", "floor", "fma", "fract", "frexp",
    "insertBits", "inverseSqrt", "ldexp", "length", "log", "log2", "max", "min", "mix", "modf",
    "normalize", "pow", "quantizeToF16", "radians", "reflect", "refract", "reverseBits", "round",
    "saturate", "sign", "sin", "sinh", "smoothstep", "sqrt", "step", "tan", "tanh", "transpose",
    "trunc", "dpdx", "dpdxCoarse", "dpdxFine", "dpdy", "dpdyCoarse", "dpdyFine", "fwidth",
    "fwidthCoarse", "fwidthFine", "textureDimensions", "textureGather", "textureGatherCompare",
    "textureLoad", "textureNumLayers", "textureNumLevels", "textureNumSamples", "textureSample",
    "textureSampleBias", "textureSampleCompare", "textureSampleCompareLevel", "textureSampleGrad",
    "textureSampleLevel", "textureSampleBaseClampToEdge", "textureStore", "atomicLoad",
    "atomicStore", "atomicAdd", "atomicSub", "atomicMax", "atomicMin", "atomicAnd", "atomicOr",
    "atomicXor", "atomicExchange", "atomicCompareExchangeWeak", "pack4x8snorm", "pack4x8unorm",
    "pack4xI8", "pack4xU8", "pack4xI8Clamp", "pack4xU8Clamp", "pack2x16snorm", "pack2x16unorm",
    "pack2x16float", "unpack4x8snorm", "unpack4x8unorm", "unpack4xI8", "unpack4xU8",
    "unpack2x16snorm", "unpack2x16unorm", "unpack2x16float", "storageBarrier",
    "workgroupBarrier", "workgroupUniformLoad", "textureBarrier", "subgroupBallot",
    "subgroupAdd", "subgroupAll", "subgroupAny", "subgroupBroadcast", "subgroupElect",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn port(name: &str, shape: Shape) -> CodePort {
        CodePort {
            name: name.into(),
            shape,
            ..Default::default()
        }
    }

    #[test]
    fn identifiers_are_policed() {
        assert!(check_ident("speed").is_ok());
        assert!(check_ident("hue2").is_ok());
        assert!(check_ident("my_input").is_ok());
        for bad in [
            "", "2x", "_x", "a__b", "img_at", "n3_f", "n12_in_x", "let", "smooth", "mix", "f32",
            "G", "P", "OUT", "hsv2rgb", "Ctx", "snoise3", "TAU", "dt", "state", "c",
        ] {
            assert!(check_ident(bad).is_err(), "{bad:?} should be refused");
        }
        assert!(check_ident(&"a".repeat(MAX_IDENT_LEN + 1)).is_err());
    }

    #[test]
    fn lib_globals_are_found() {
        let g = lib_globals();
        for name in ["G", "P", "FX", "OUT", "DABS", "SCOPE", "VIDEO", "TOUCH", "PREVIEW", "Ctx", "TAU", "hsv2rgb", "finish"] {
            assert!(g.contains(name), "{name} missing from the lib scan");
        }
    }

    #[test]
    fn tiers_follow_the_ports() {
        let cpu = CodeDef {
            inputs: vec![port("a", Shape::Scalar), port("go", Shape::Event)],
            outputs: vec![port("out", Shape::Scalar), port("fire", Shape::Event)],
            body: "out = a; fire = go;".into(),
        };
        assert_eq!(cpu.check().unwrap(), Tier::Cpu);
        let gpu = CodeDef {
            inputs: vec![port("a", Shape::Scalar), port("img", Shape::FieldColor)],
            outputs: vec![port("out", Shape::FieldColor), port("mask", Shape::FieldScalar)],
            body: "out = img * a;".into(),
        };
        assert_eq!(gpu.check().unwrap(), Tier::Gpu);
        let mixed = CodeDef {
            inputs: vec![],
            outputs: vec![port("out", Shape::FieldColor), port("level", Shape::Scalar)],
            body: String::new(),
        };
        assert!(mixed.check().is_err());
        let field_into_cpu = CodeDef {
            inputs: vec![port("img", Shape::FieldColor)],
            outputs: vec![port("out", Shape::Scalar)],
            body: String::new(),
        };
        assert!(field_into_cpu.check().is_err());
        let event_into_gpu = CodeDef {
            inputs: vec![port("go", Shape::Event)],
            outputs: vec![port("out", Shape::FieldScalar)],
            body: String::new(),
        };
        assert!(event_into_gpu.check().is_err());
        let points = CodeDef {
            inputs: vec![port("pts", Shape::Points)],
            outputs: vec![port("out", Shape::FieldColor)],
            body: String::new(),
        };
        assert!(points.check().is_err());
        assert!(CodeDef::default().check().is_err(), "no outputs");
        let dup = CodeDef {
            inputs: vec![port("a", Shape::Scalar)],
            outputs: vec![port("a", Shape::Scalar)],
            body: String::new(),
        };
        assert!(dup.check().is_err());
        let huge = CodeDef {
            outputs: vec![port("out", Shape::Scalar)],
            body: "x".repeat(MAX_CODE_BYTES + 1),
            ..Default::default()
        };
        assert!(huge.check().is_err());
        let bad_range = CodeDef {
            inputs: vec![CodePort { name: "a".into(), shape: Shape::Scalar, min: 2.0, max: 1.0, default: 0.0 }],
            outputs: vec![port("out", Shape::Scalar)],
            body: String::new(),
        };
        assert!(bad_range.check().is_err());
    }

    #[test]
    fn body_rewrite_touches_only_resample_calls() {
        let body = "// img_at in a comment stays\nlet s = img_at(ctx_transform(c, 0.1, 1.0, 0.0, 0.0));\n/* mask_at */ out = s * mask_at(c).x + 1e5 + img;";
        let got = rewrite_body(body, 7, &["img", "mask"]);
        assert_eq!(
            got,
            "// img_at in a comment stays\nlet s = n7_in_img(ctx_transform(c, 0.1, 1.0, 0.0, 0.0));\n/* mask_at */ out = s * n7_in_mask(c).x + 1e5 + img;"
        );
        // A port that is not a field input is left alone.
        assert_eq!(rewrite_body("x_at(c)", 1, &["img"]), "x_at(c)");
        // Unicode in a comment survives.
        assert_eq!(rewrite_body("// héllo\nout = 1.0;", 1, &[]), "// héllo\nout = 1.0;");
    }
}
