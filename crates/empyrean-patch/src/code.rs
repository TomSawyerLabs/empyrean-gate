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
use schemars::JsonSchema;
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct CodePort {
    /// The port's name, also its identifier in the body: a letter, then
    /// letters, digits and underscores (at most 32), no `__`, not ending in
    /// `_at`, and not a WGSL keyword or builtin or a name the patch shader
    /// already uses.
    pub name: String,
    /// scalar or event (a CPU-tier node), field_scalar or field_color (a
    /// GPU-tier node, which takes no event inputs and has only field outputs).
    /// led_scalar and led_color are GPU-tier too: an output so declared is
    /// LED data whatever the body reads; an input so declared takes the same
    /// wires as its field twin.
    pub shape: Shape,
    /// Scalar inputs only: the knob's lowest value.
    pub min: f32,
    /// Scalar inputs only: the knob's highest value.
    pub max: f32,
    /// Scalar inputs only: the knob's value until it is set or wired.
    pub default: f32,
    /// A Scalar input that is a rate: the engine integrates it over time
    /// (× master speed) and the body sees the accumulated phase, like a
    /// built-in node's `speed` knob. Only meaningful on the GPU tier (a CPU
    /// body integrates for itself with `dt`).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub integrate: bool,
}

impl Default for CodePort {
    fn default() -> Self {
        Self {
            name: String::new(),
            shape: Shape::Scalar,
            min: 0.0,
            max: 1.0,
            default: 0.0,
            integrate: false,
        }
    }
}

/// A Code node's interface and body.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct CodeDef {
    /// Declared input ports, at most 16.
    pub inputs: Vec<CodePort>,
    /// Declared output ports, 1 to 16; `out` (else the first) is the one the
    /// node's thumbnail shows.
    pub outputs: Vec<CodePort>,
    /// The body (at most 8192 bytes): WGSL statements that read the inputs
    /// and assign every output by name. A GPU-tier body runs per pixel with
    /// the patch shader's helpers in scope; a CPU-tier body is a scalar WGSL
    /// subset run every frame (see the Code reference, `codeReference()`).
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
        let field = |s: Shape| s.is_field();
        let control = |s: Shape| matches!(s, Shape::Scalar | Shape::Event);
        let buffer = |s: Shape| matches!(s, Shape::Points | Shape::Effects | Shape::Texture);
        for p in &self.outputs {
            if !field(p.shape) && !control(p.shape) {
                return Err(format!(
                    "output \"{}\": a Code node cannot make {:?} (those streams come from the host); it makes fields, scalars or events",
                    p.name, p.shape
                ));
            }
        }
        for p in &self.inputs {
            if !field(p.shape) && !control(p.shape) && !buffer(p.shape) {
                return Err(format!("input \"{}\": {:?} is not an input a Code node can take", p.name, p.shape));
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
                if field(p.shape) || buffer(p.shape) {
                    return Err(format!(
                        "input \"{}\": a {:?} can only be read by a node that makes a field (this one outputs scalars, so it runs on the CPU)",
                        p.name, p.shape
                    ));
                }
            }
            Ok(Tier::Cpu)
        }
    }

    /// Whether a GPU body reads field input `name` somewhere else
    /// (`name_at(…)`), which LED data can't support (see
    /// `validate::led_nodes`). Comments don't count.
    pub fn samples(&self, name: &str) -> bool {
        let at = format!("{name}_at");
        matches!(self.tier(), Ok(Tier::Gpu))
            && tokens(&self.body).iter().any(|t| t.kind == TokKind::Ident && t.text == at)
    }

    /// Whether a GPU body keys on the physical LED (`c.spoke` or `c.i`), so
    /// what it makes is LED data. Comments don't count.
    pub fn reads_leds(&self) -> bool {
        if !matches!(self.tier(), Ok(Tier::Gpu)) {
            return false;
        }
        let toks = tokens(&self.body);
        (0..toks.len().saturating_sub(2)).any(|k| {
            // `c` itself, not a member named `c` (`x.c.i`).
            (k == 0 || toks[k - 1].text != ".")
                && toks[k].text == "c"
                && toks[k + 1].text == "."
                && matches!(toks[k + 2].text, "spoke" | "i")
        })
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
        match tier {
            Tier::Cpu => {
                crate::script::compile(self).map_err(|e| e.to_string())?;
            }
            Tier::Gpu => {
                check_gpu_body(self)?;
                // LED data has nothing between the LEDs to read.
                if let Some(p) = self.inputs.iter().find(|p| p.shape.is_led() && self.samples(&p.name)) {
                    return Err(format!(
                        "input \"{0}\" is LED data, defined only at the LEDs: read it as `{0}` (this LED), not `{0}_at`; to sample it elsewhere, declare it a field and wire it through Resample",
                        p.name
                    ));
                }
            }
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
const OURS: &[&str] = &["c", "c0", "ctx", "dt", "master_speed", "state", "PI", "TAU", "out_"];

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
/// node's resampling function `n<node>_in_<field input>`, and every bare
/// `return;` replaced by `return <record>;` so a body can end early (the
/// generated function returns its outputs as a record). Comments are copied
/// through untouched; nothing else in the text changes. WGSL has no string
/// literals, so identifiers and comments are the only lexical structure
/// that matters.
pub fn rewrite_body(body: &str, node: usize, field_inputs: &[&str], effects_inputs: &[&str], record: &str) -> String {
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
            if ident == "return" && body[end..].trim_start().starts_with(';') {
                out.push_str("return ");
                out.push_str(record);
            } else {
                if let Some(base) = ident.strip_suffix("_at").filter(|b| field_inputs.contains(b)) {
                    out.push_str(&format!("n{node}_in_{base}"));
                } else if let Some(base) = ident.strip_suffix("_on").filter(|b| effects_inputs.contains(b)) {
                    out.push_str(&format!("n{node}_on_{base}"));
                } else {
                    out.push_str(ident);
                }
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

/// Longest literal bound a `for` in a field body may run to.
pub const MAX_LOOP: u32 = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokKind {
    Ident,
    Number,
    Punct,
}

#[derive(Debug, Clone, Copy)]
struct Tok<'a> {
    text: &'a str,
    kind: TokKind,
    line: usize,
    col: usize,
}

/// The identifiers, numbers and punctuation of a WGSL body, with positions;
/// comments and whitespace skipped.
fn tokens(body: &str) -> Vec<Tok<'_>> {
    const PUNCT: &[&str] = &[
        "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "++", "--", "&&", "||", "->", "<<", ">>",
    ];
    let mut out = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0;
    let mut line = 1;
    let mut line_start = 0;
    while i < bytes.len() {
        let b = bytes[i];
        let col = i - line_start + 1;
        if b == b'\n' {
            line += 1;
            line_start = i + 1;
            i += 1;
        } else if b.is_ascii_whitespace() {
            i += 1;
        } else if b == b'/' && bytes.get(i + 1) == Some(&b'/') {
            i = body[i..].find('\n').map_or(bytes.len(), |n| i + n);
        } else if b == b'/' && bytes.get(i + 1) == Some(&b'*') {
            let end = body[i + 2..].find("*/").map_or(bytes.len(), |n| i + 2 + n + 2);
            for (k, ch) in body[i..end].bytes().enumerate() {
                if ch == b'\n' {
                    line += 1;
                    line_start = i + k + 1;
                }
            }
            i = end;
        } else if b.is_ascii_alphabetic() || b == b'_' {
            let end = i + body[i..].bytes().take_while(|c| c.is_ascii_alphanumeric() || *c == b'_').count();
            out.push(Tok { text: &body[i..end], kind: TokKind::Ident, line, col });
            i = end;
        } else if b.is_ascii_digit() || (b == b'.' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit)) {
            let end = i + body[i..].bytes().take_while(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'.').count();
            out.push(Tok { text: &body[i..end], kind: TokKind::Number, line, col });
            i = end;
        } else {
            let rest = &body[i..];
            let text = PUNCT.iter().find(|p| rest.starts_with(**p)).copied().unwrap_or_else(|| {
                let ch = rest.chars().next().unwrap();
                &rest[..ch.len_utf8()]
            });
            out.push(Tok { text, kind: TokKind::Punct, line, col });
            i += text.len();
        }
    }
    out
}

fn at(t: &Tok<'_>, msg: impl Into<String>) -> String {
    format!("line {}:{}: {}", t.line, t.col, msg.into())
}

/// The value of a numeric literal token (`64`, `64u`, `3.0`), if it is one.
fn literal(t: &Tok<'_>) -> Option<f64> {
    if t.kind != TokKind::Number {
        return None;
    }
    t.text.trim_end_matches(['u', 'i', 'f', 'h']).parse().ok()
}

/// What a GPU body may not do, caught before the shader compiler sees it,
/// each with a position so the editor can mark the line:
/// - `loop` and `while`, and a `for` without a literal bound (or a buffer
///   count: `<points input>_count`, `G.dab_count`…): an unbounded loop in a
///   compute shader hangs the GPU, and the host recovers only by losing the
///   device;
/// - `return <value>` (outputs are assigned by name);
/// - unbalanced `{}` / `()`;
/// - writing to an input;
/// - the engine's own names (`OUT`, `P`, `PREVIEW`, `finish`, `main`).
pub fn check_gpu_body(def: &CodeDef) -> Result<(), String> {
    let toks = tokens(&def.body);
    let inputs: Vec<&str> = def.inputs.iter().map(|p| p.name.as_str()).collect();
    let counts: Vec<String> = def
        .inputs
        .iter()
        .filter(|p| matches!(p.shape, Shape::Points | Shape::Effects))
        .map(|p| format!("{}_count", p.name))
        .collect();
    let mut braces: Vec<&Tok<'_>> = Vec::new();
    let mut parens: Vec<&Tok<'_>> = Vec::new();
    for (k, t) in toks.iter().enumerate() {
        let next = toks.get(k + 1);
        let prev = if k > 0 { toks.get(k - 1) } else { None };
        match t.kind {
            TokKind::Ident => match t.text {
                "loop" | "while" => {
                    return Err(at(t, format!(
                        "`{}` is not allowed in a field body: a loop without a fixed bound can hang the GPU. Use `for (var i = 0u; i < N; i++)` with a literal N (up to {MAX_LOOP})",
                        t.text
                    )));
                }
                "for" => check_for(&toks, k, &counts)?,
                "return" => {
                    if next.is_some_and(|n| n.text != ";") {
                        return Err(at(t, "return a value: assign the output by name instead (`out = …;`), then `return;` if the body must stop early"));
                    }
                }
                "OUT" | "P" | "PREVIEW" | "finish" | "main" => {
                    // `P` as a struct member (`x.P`) is someone's own name.
                    if !prev.is_some_and(|p| p.text == ".") {
                        return Err(at(t, format!("`{}` belongs to the engine; a body reads its inputs and sets its outputs", t.text)));
                    }
                }
                name if inputs.contains(&name) => {
                    let declared = prev.is_some_and(|p| p.kind == TokKind::Ident && matches!(p.text, "let" | "var" | "const"));
                    let assigns = next.is_some_and(|n| n.kind == TokKind::Punct && matches!(n.text, "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "++" | "--"));
                    let member = prev.is_some_and(|p| p.text == ".");
                    if assigns && !declared && !member {
                        return Err(at(t, format!("`{name}` is an input, and inputs are read-only; `var x = {name};` makes a copy to change")));
                    }
                }
                _ => {}
            },
            TokKind::Punct => match t.text {
                "{" => braces.push(t),
                "}" => {
                    if braces.pop().is_none() {
                        return Err(at(t, "this `}` closes nothing"));
                    }
                }
                "(" => parens.push(t),
                ")" => {
                    if parens.pop().is_none() {
                        return Err(at(t, "this `)` closes nothing"));
                    }
                }
                _ => {}
            },
            TokKind::Number => {}
        }
    }
    if let Some(t) = braces.last() {
        return Err(at(t, "this `{` is never closed"));
    }
    if let Some(t) = parens.last() {
        return Err(at(t, "this `(` is never closed"));
    }
    Ok(())
}

/// `for ( init ; cond ; update )`: the condition must compare a name with a
/// literal (≤ `MAX_LOOP`), a buffer input's `_count`, or a bounded engine
/// count (`G.dab_count`, `G.effect_count`, `G.touch_count`, `G.spokes`,
/// `G.pixels`).
fn check_for(toks: &[Tok<'_>], k: usize, counts: &[String]) -> Result<(), String> {
    let t = &toks[k];
    let hint = format!("a `for` in a field body needs a fixed bound in its condition, e.g. `i < 64u` (up to {MAX_LOOP}), or a buffer count such as `points_count` or `G.dab_count`");
    if toks.get(k + 1).is_none_or(|n| n.text != "(") {
        return Err(at(t, &hint));
    }
    // The condition: between the first and second `;` at paren depth 1.
    let mut depth = 0;
    let mut semis = Vec::new();
    let mut close = None;
    for (j, x) in toks.iter().enumerate().skip(k + 1) {
        match x.text {
            "(" => depth += 1,
            ")" => {
                depth -= 1;
                if depth == 0 {
                    close = Some(j);
                    break;
                }
            }
            ";" if depth == 1 => semis.push(j),
            _ => {}
        }
    }
    let (Some(close), [a, b]) = (close, semis.as_slice()) else {
        return Err(at(t, &hint));
    };
    let _ = close;
    let cond: Vec<&Tok<'_>> = toks[a + 1..*b].iter().collect();
    let bounded = |x: &Tok<'_>, rest: &[&Tok<'_>]| -> bool {
        // A literal, `<input>_count`, a `let` clamped to a literal, or
        // `G.<bounded field>`.
        if literal(x).is_some_and(|v| v >= 0.0 && v <= f64::from(MAX_LOOP)) {
            return true;
        }
        if x.kind == TokKind::Ident && (counts.iter().any(|c| c == x.text) || clamped_let(toks, x.text)) {
            return true;
        }
        x.text == "G"
            && rest.len() >= 2
            && rest[0].text == "."
            && matches!(rest[1].text, "dab_count" | "effect_count" | "touch_count" | "spokes" | "pixels")
    };
    let is_op = |x: &Tok<'_>| x.kind == TokKind::Punct && matches!(x.text, "<" | "<=" | ">" | ">=" | "!=");
    let ok = match cond.as_slice() {
        [v, op, bound, rest @ ..] if v.kind == TokKind::Ident && is_op(op) => bounded(bound, rest) && (rest.is_empty() || bound.text == "G"),
        [bound, op, v] if is_op(op) && v.kind == TokKind::Ident => bounded(bound, &[]),
        [g, dot, field, op, v] if is_op(op) && v.kind == TokKind::Ident => bounded(g, &[dot, field]),
        _ => false,
    };
    if ok { Ok(()) } else { Err(at(t, &hint)) }
}

/// Whether `name` is a `let` whose whole initializer is `clamp(…, lo, LIT)`
/// or `min(…, LIT)` (optionally inside `u32(…)` / `i32(…)`) with the literal
/// at most `MAX_LOOP`: a loop bound that cannot run away, the way the
/// built-in generators write theirs (`let harmonics = u32(clamp(waves, 1.0,
/// 8.0));`).
fn clamped_let(toks: &[Tok<'_>], name: &str) -> bool {
    let Some(k) = toks.windows(3).position(|w| {
        w[0].kind == TokKind::Ident && w[0].text == "let" && w[1].text == name && w[2].text == "="
    }) else {
        return false;
    };
    let end = toks[k + 3..].iter().position(|t| t.text == ";").map(|n| k + 3 + n);
    let Some(end) = end else { return false };
    let mut init: &[Tok<'_>] = &toks[k + 3..end];
    // Strip an outer `u32( … )` / `i32( … )`.
    if init.len() >= 3 && matches!(init[0].text, "u32" | "i32") && init[1].text == "(" && init.last().is_some_and(|t| t.text == ")") {
        init = &init[2..init.len() - 1];
    }
    if init.len() < 4 || !matches!(init[0].text, "clamp" | "min") || init[1].text != "(" || init.last().is_some_and(|t| t.text != ")") {
        return false;
    }
    // Top-level arguments of the call.
    let mut args: Vec<Vec<&Tok<'_>>> = vec![Vec::new()];
    let mut depth = 0;
    for t in &init[2..init.len() - 1] {
        match t.text {
            "(" => depth += 1,
            ")" => depth -= 1,
            "," if depth == 0 => {
                args.push(Vec::new());
                continue;
            }
            _ => {}
        }
        args.last_mut().unwrap().push(t);
    }
    let lit = |a: &Vec<&Tok<'_>>| a.len() == 1 && literal(a[0]).is_some_and(|v| v >= 0.0 && v <= f64::from(MAX_LOOP));
    match init[0].text {
        "clamp" => args.len() == 3 && lit(&args[2]),
        _ => args.len() == 2 && (lit(&args[0]) || lit(&args[1])),
    }
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
            inputs: vec![CodePort { name: "a".into(), shape: Shape::Scalar, min: 2.0, max: 1.0, default: 0.0, integrate: false }],
            outputs: vec![port("out", Shape::Scalar)],
            body: String::new(),
        };
        assert!(bad_range.check().is_err());
    }

    #[test]
    fn gpu_bodies_are_screened() {
        let gpu = |body: &str, inputs: &[(&str, Shape)]| CodeDef {
            inputs: inputs.iter().map(|(n, s)| port(n, *s)).collect(),
            outputs: vec![port("out", Shape::FieldColor)],
            body: body.into(),
        };
        let ok = |body: &str, inputs: &[(&str, Shape)]| {
            gpu(body, inputs).check().unwrap_or_else(|e| panic!("{body:?}: {e}"));
        };
        let err = |body: &str, inputs: &[(&str, Shape)]| gpu(body, inputs).check().unwrap_err();
        ok("for (var i = 0u; i < 64u; i++) { out += vec4f(0.01); }", &[]);
        ok("for (var i = 0; i <= 7; i++) {}", &[]);
        ok("for (var i = 0u; 16u > i; i++) {}", &[]);
        ok("for (var i = 0u; i < G.dab_count; i++) {}", &[]);
        ok("for (var i = 0u; i < pts_count; i++) { let D = pts_at(i); }", &[("pts", Shape::Points)]);
        ok("// while in a comment\n/* loop */ out = vec4f(1.0);", &[]);
        ok("let n = u32(clamp(waves, 1.0, 8.0));\nfor (var h = 1u; h <= n; h++) {}", &[("waves", Shape::Scalar)]);
        ok("let n = min(u32(waves), 32u);\nfor (var h = 0u; h < n; h++) {}", &[("waves", Shape::Scalar)]);
        assert!(err("let n = u32(waves);\nfor (var h = 0u; h < n; h++) {}", &[("waves", Shape::Scalar)]).contains("fixed bound"));
        assert!(err("let n = clamp(waves, 1.0, 8.0) * 1000.0;\nfor (var h = 0u; h < u32(n); h++) {}", &[("waves", Shape::Scalar)]).contains("fixed bound"));
        ok("if a > 0.5 { return; }", &[("a", Shape::Scalar)]);
        ok("var x = a; x += 1.0; let b = vec4f(x); out = b;", &[("a", Shape::Scalar)]);
        ok("let q = s.P;", &[("s", Shape::FieldColor)]);
        // LED inputs are read at this LED only.
        ok("out = snow; // not snow_at(c)", &[("snow", Shape::LedColor)]);
        assert!(err("out = snow_at(c);", &[("snow", Shape::LedColor)]).contains("Resample"));
        ok("out = img_at(c);", &[("img", Shape::FieldColor)]);
        let e = err("out = vec4f(1.0);\nloop { }", &[]);
        assert!(e.starts_with("line 2:1:") && e.contains("hang"), "{e}");
        assert!(err("while true { }", &[]).contains("`while`"));
        assert!(err("for (var i = 0u; i < n; i++) {}", &[]).contains("fixed bound"));
        assert!(err("for (var i = 0u; i < 100000u; i++) {}", &[]).contains("fixed bound"));
        assert!(err("for (var i = 0u; ; i++) {}", &[]).contains("fixed bound"));
        assert!(err("for (var i = 0u; i < a_count; i++) {}", &[("a", Shape::Scalar)]).contains("fixed bound"));
        assert!(err("return vec4f(1.0);", &[]).contains("assign the output"));
        assert!(err("OUT[0] = 1u;", &[]).contains("engine"));
        assert!(err("finish(c, 0u, vec3f(0.0));", &[]).contains("engine"));
        let e = err("a = 2.0;", &[("a", Shape::Scalar)]);
        assert!(e.contains("read-only"), "{e}");
        assert!(err("a += 1.0;", &[("a", Shape::Scalar)]).contains("read-only"));
        assert!(err("if true { out = vec4f(1.0);", &[]).contains("never closed"));
        assert!(err("out = vec4f(1.0)); }", &[]).contains("closes nothing"));
        // CPU bodies are not screened this way (`loop` is fine there, bounded by the step budget).
        let cpu = CodeDef {
            inputs: vec![],
            outputs: vec![port("out", Shape::Scalar)],
            body: "loop { out += 1.0; if out > 3.0 { break; } }".into(),
        };
        assert_eq!(cpu.check().unwrap(), Tier::Cpu);
    }

    #[test]
    fn buffer_inputs_are_gpu_only() {
        for shape in [Shape::Points, Shape::Effects, Shape::Texture] {
            let gpu = CodeDef {
                inputs: vec![port("b", shape)],
                outputs: vec![port("out", Shape::FieldColor)],
                body: String::new(),
            };
            assert_eq!(gpu.check().unwrap(), Tier::Gpu, "{shape:?}");
            let cpu = CodeDef {
                inputs: vec![port("b", shape)],
                outputs: vec![port("out", Shape::Scalar)],
                body: String::new(),
            };
            assert!(cpu.check().is_err(), "{shape:?}");
            let out = CodeDef {
                inputs: vec![],
                outputs: vec![port("b", shape)],
                body: String::new(),
            };
            assert!(out.check().is_err(), "{shape:?} output");
        }
    }

    #[test]
    fn body_rewrite_touches_only_resample_calls() {
        let body = "// img_at in a comment stays\nlet s = img_at(ctx_transform(c, 0.1, 1.0, 0.0, 0.0));\n/* mask_at */ out = s * mask_at(c).x + 1e5 + img;";
        let got = rewrite_body(body, 7, &["img", "mask"], &[], "N7Out(out)");
        assert_eq!(
            got,
            "// img_at in a comment stays\nlet s = n7_in_img(ctx_transform(c, 0.1, 1.0, 0.0, 0.0));\n/* mask_at */ out = s * n7_in_mask(c).x + 1e5 + img;"
        );
        // A port that is not a field input is left alone.
        assert_eq!(rewrite_body("x_at(c)", 1, &["img"], &[], "R"), "x_at(c)");
        // Unicode in a comment survives.
        assert_eq!(rewrite_body("// héllo\nout = 1.0;", 1, &[], &[], "R"), "// héllo\nout = 1.0;");
        // An Effects input's `_on` form.
        assert_eq!(rewrite_body("if fx_on(e) { let E = fx_at(e); }", 2, &["fx"], &["fx"], "R"), "if n2_on_fx(e) { let E = n2_in_fx(e); }");
        // A bare return becomes a return of the record; `return x;` is left
        // for the compiler to refuse; a `returned` identifier is untouched.
        assert_eq!(
            rewrite_body("if a { return; }\nreturn ;\nreturn x;\nlet returned = 1.0;", 3, &[], &[], "N3Out(out)"),
            "if a { return N3Out(out); }\nreturn N3Out(out) ;\nreturn x;\nlet returned = 1.0;"
        );
    }
}
