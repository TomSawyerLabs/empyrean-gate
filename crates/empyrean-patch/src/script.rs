//! The CPU tier of Code nodes: an interpreter for a subset of WGSL, so a
//! scalar/event Code node is written in the same language as a field one
//! and the gate never runs native code from a patch.
//!
//! The subset: `let`/`var`, assignment (`=`, `+=` …, `++`/`--`, `_ =`),
//! `if`/`else`, `for`, `while`, `loop`, `break`/`continue`/`return`, blocks,
//! both comment styles, numeric and boolean literals, the arithmetic,
//! comparison and logical operators with WGSL precedence, and the scalar
//! builtins by their WGSL names. Values are `f32` or `bool` and coerce
//! loosely (a bool is 1/0 in arithmetic, a number is true when non-zero), so
//! nothing can fail at run time: evaluation is total, every loop is bounded
//! by a per-frame step budget, and outputs are made finite by the caller.
//!
//! In scope inside a body: every input by name (Scalar → number, Event →
//! "fired this frame"), every output by name (written; number or bool, zero
//! at the start of each frame), `dt` (seconds since the last frame), `PI`,
//! `TAU`, and `state.<name>`: numbers that persist across frames.
//! Design: `plans/code-node.md`.

use crate::Shape;
use crate::code::CodeDef;
use std::collections::HashMap;
use std::f32::consts::{PI, TAU};
use std::fmt;

/// Statements (loop iterations included) one frame of one node may run.
pub const MAX_STEPS: usize = 10_000;
/// Nesting of expressions and blocks the parser accepts.
const MAX_DEPTH: usize = 64;
/// `state.<name>` slots per node.
const MAX_STATE: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub line: usize,
    pub col: usize,
    pub message: String,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}:{}: {}", self.line, self.col, self.message)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Value {
    Num(f32),
    Bool(bool),
}

impl Value {
    pub fn num(self) -> f32 {
        match self {
            Value::Num(v) => v,
            Value::Bool(b) => f32::from(b),
        }
    }

    pub fn truth(self) -> bool {
        match self {
            Value::Num(v) => v != 0.0,
            Value::Bool(b) => b,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Slot {
    Input(usize),
    Output(usize),
    Local(usize),
    State(usize),
    Dt,
    Pi,
    Tau,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Rem,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone)]
enum Expr {
    Lit(Value),
    Var(Slot),
    Neg(Box<Expr>),
    Not(Box<Expr>),
    Bin(BinOp, Box<Expr>, Box<Expr>),
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
    Call(Builtin, Vec<Expr>),
}

#[derive(Debug, Clone)]
enum Stmt {
    Assign(Slot, Expr),
    Discard(Expr),
    If(Vec<(Expr, Vec<Stmt>)>, Option<Vec<Stmt>>),
    For {
        init: Option<Box<Stmt>>,
        cond: Option<Expr>,
        update: Option<Box<Stmt>>,
        body: Vec<Stmt>,
    },
    While(Expr, Vec<Stmt>),
    Loop(Vec<Stmt>),
    Block(Vec<Stmt>),
    Break,
    Continue,
    Return,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Builtin {
    Abs,
    Floor,
    Ceil,
    Round,
    Fract,
    Trunc,
    Sign,
    Sqrt,
    InverseSqrt,
    Exp,
    Exp2,
    Log,
    Log2,
    Pow,
    Sin,
    Cos,
    Tan,
    Asin,
    Acos,
    Atan,
    Atan2,
    Sinh,
    Cosh,
    Tanh,
    Min,
    Max,
    Clamp,
    Mix,
    Step,
    Smoothstep,
    Saturate,
    Fma,
    Degrees,
    Radians,
    Select,
    F32,
    I32,
    U32,
    Bool,
}

const BUILTINS: &[(&str, Builtin, usize)] = &[
    ("abs", Builtin::Abs, 1),
    ("floor", Builtin::Floor, 1),
    ("ceil", Builtin::Ceil, 1),
    ("round", Builtin::Round, 1),
    ("fract", Builtin::Fract, 1),
    ("trunc", Builtin::Trunc, 1),
    ("sign", Builtin::Sign, 1),
    ("sqrt", Builtin::Sqrt, 1),
    ("inverseSqrt", Builtin::InverseSqrt, 1),
    ("exp", Builtin::Exp, 1),
    ("exp2", Builtin::Exp2, 1),
    ("log", Builtin::Log, 1),
    ("log2", Builtin::Log2, 1),
    ("pow", Builtin::Pow, 2),
    ("sin", Builtin::Sin, 1),
    ("cos", Builtin::Cos, 1),
    ("tan", Builtin::Tan, 1),
    ("asin", Builtin::Asin, 1),
    ("acos", Builtin::Acos, 1),
    ("atan", Builtin::Atan, 1),
    ("atan2", Builtin::Atan2, 2),
    ("sinh", Builtin::Sinh, 1),
    ("cosh", Builtin::Cosh, 1),
    ("tanh", Builtin::Tanh, 1),
    ("min", Builtin::Min, 2),
    ("max", Builtin::Max, 2),
    ("clamp", Builtin::Clamp, 3),
    ("mix", Builtin::Mix, 3),
    ("step", Builtin::Step, 2),
    ("smoothstep", Builtin::Smoothstep, 3),
    ("saturate", Builtin::Saturate, 1),
    ("fma", Builtin::Fma, 3),
    ("degrees", Builtin::Degrees, 1),
    ("radians", Builtin::Radians, 1),
    ("select", Builtin::Select, 3),
    ("f32", Builtin::F32, 1),
    ("i32", Builtin::I32, 1),
    ("u32", Builtin::U32, 1),
    ("bool", Builtin::Bool, 1),
];

/// The names the interpreter knows, for the editor's reference card.
pub fn builtin_names() -> impl Iterator<Item = &'static str> {
    BUILTINS.iter().map(|(n, _, _)| *n)
}

/// A compiled body, ready to run every frame.
#[derive(Debug, Clone)]
pub struct Script {
    stmts: Vec<Stmt>,
    n_locals: usize,
    n_inputs: usize,
    /// Output kinds in declaration order: `true` for an Event.
    output_events: Vec<bool>,
    state_names: Vec<String>,
}

impl Script {
    /// `state.<name>` slots the body uses, in slot order.
    pub fn state_names(&self) -> &[String] {
        &self.state_names
    }

    /// Run one frame. `inputs` are the declared inputs in order (an Event is
    /// `Bool(fired)`), `state` the slots named by [`Script::state_names`].
    /// Returns the declared outputs in order: a Scalar as `Num`, an Event
    /// as `Bool`.
    pub fn run(&self, inputs: &[Value], dt: f32, state: &mut [f32]) -> Vec<Value> {
        debug_assert_eq!(inputs.len(), self.n_inputs);
        debug_assert_eq!(state.len(), self.state_names.len());
        let mut outputs: Vec<Value> = self
            .output_events
            .iter()
            .map(|&ev| if ev { Value::Bool(false) } else { Value::Num(0.0) })
            .collect();
        let mut vm = Vm {
            inputs,
            outputs: &mut outputs,
            state,
            dt,
            locals: vec![Value::Num(0.0); self.n_locals],
            steps: MAX_STEPS,
        };
        vm.exec(&self.stmts);
        for (v, &ev) in outputs.iter_mut().zip(&self.output_events) {
            *v = if ev { Value::Bool(v.truth()) } else { Value::Num(v.num()) };
        }
        outputs
    }
}

/// Parse `def.body` against `def`'s ports.
pub fn compile(def: &CodeDef) -> Result<Script, Error> {
    let toks = lex(&def.body)?;
    let mut p = Parser {
        toks,
        pos: 0,
        scopes: vec![HashMap::new()],
        n_locals: 0,
        state_names: Vec::new(),
        depth: 0,
    };
    for (i, port) in def.inputs.iter().enumerate() {
        p.scopes[0].insert(port.name.clone(), (Slot::Input(i), false));
    }
    for (i, port) in def.outputs.iter().enumerate() {
        p.scopes[0].insert(port.name.clone(), (Slot::Output(i), true));
    }
    // The body is a scope of its own, so a `let` may shadow a port.
    p.scopes.push(HashMap::new());
    let mut stmts = Vec::new();
    while !p.at_eof() {
        stmts.push(p.stmt()?);
    }
    Ok(Script {
        stmts,
        n_locals: p.n_locals,
        n_inputs: def.inputs.len(),
        output_events: def.outputs.iter().map(|o| o.shape == Shape::Event).collect(),
        state_names: p.state_names,
    })
}

// --- lexer -----------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Ident(String),
    Num(f32),
    Punct(&'static str),
    Eof,
}

#[derive(Debug, Clone)]
struct Token {
    tok: Tok,
    line: usize,
    col: usize,
}

const PUNCT: &[&str] = &[
    "&&", "||", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "++", "--", "(", ")", "{",
    "}", ",", ";", ":", ".", "=", "<", ">", "+", "-", "*", "/", "%", "!",
];

fn lex(src: &str) -> Result<Vec<Token>, Error> {
    let mut toks = Vec::new();
    let bytes = src.as_bytes();
    let mut i = 0;
    let mut line = 1;
    let mut line_start = 0;
    let err = |line: usize, col: usize, message: String| Error { line, col, message };
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
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
        } else if b == b'/' && bytes.get(i + 1) == Some(&b'*') {
            let start = (line, col);
            i += 2;
            loop {
                if i + 1 >= bytes.len() {
                    return Err(err(start.0, start.1, "unterminated /* comment".into()));
                }
                if bytes[i] == b'*' && bytes[i + 1] == b'/' {
                    i += 2;
                    break;
                }
                if bytes[i] == b'\n' {
                    line += 1;
                    line_start = i + 1;
                }
                i += 1;
            }
        } else if b.is_ascii_alphabetic() || b == b'_' {
            let end = i + src[i..]
                .bytes()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == b'_')
                .count();
            toks.push(Token {
                tok: Tok::Ident(src[i..end].to_string()),
                line,
                col,
            });
            i = end;
        } else if b.is_ascii_digit() || (b == b'.' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit)) {
            let (value, end) = lex_number(src, i).ok_or_else(|| err(line, col, "bad number".into()))?;
            toks.push(Token {
                tok: Tok::Num(value),
                line,
                col,
            });
            i = end;
        } else {
            let rest = &src[i..];
            match PUNCT.iter().find(|p| rest.starts_with(**p)) {
                Some(p) => {
                    toks.push(Token {
                        tok: Tok::Punct(p),
                        line,
                        col,
                    });
                    i += p.len();
                }
                None => {
                    let ch = rest.chars().next().unwrap();
                    return Err(err(line, col, format!("unexpected character {ch:?}")));
                }
            }
        }
    }
    toks.push(Token {
        tok: Tok::Eof,
        line,
        col: bytes.len() - line_start + 1,
    });
    Ok(toks)
}

/// A WGSL numeric literal at `start`: decimal (`1`, `1.5`, `.5`, `1.`,
/// `1e-3`) or hex (`0x1f`), with an optional `f`/`h`/`i`/`u` suffix.
fn lex_number(src: &str, start: usize) -> Option<(f32, usize)> {
    let bytes = src.as_bytes();
    let mut i = start;
    if bytes[i] == b'0' && matches!(bytes.get(i + 1), Some(b'x' | b'X')) {
        i += 2;
        let digits = i + src[i..].bytes().take_while(u8::is_ascii_hexdigit).count();
        let v = u64::from_str_radix(&src[i..digits], 16).ok()? as f32;
        i = digits;
        if matches!(bytes.get(i), Some(b'i' | b'u')) {
            i += 1;
        }
        return Some((v, i));
    }
    i += src[i..].bytes().take_while(u8::is_ascii_digit).count();
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        i += src[i..].bytes().take_while(u8::is_ascii_digit).count();
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(bytes.get(j), Some(b'+' | b'-')) {
            j += 1;
        }
        let digits = src[j..].bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 {
            i = j + digits;
        }
    }
    let text = &src[start..i];
    let v: f32 = text.parse().ok()?;
    if matches!(bytes.get(i), Some(b'f' | b'h' | b'i' | b'u')) {
        i += 1;
    }
    Some((v, i))
}

// --- parser ----------------------------------------------------------------

struct Parser {
    toks: Vec<Token>,
    pos: usize,
    /// Name → (slot, mutable), innermost scope last.
    scopes: Vec<HashMap<String, (Slot, bool)>>,
    n_locals: usize,
    state_names: Vec<String>,
    depth: usize,
}

impl Parser {
    fn peek(&self) -> &Token {
        &self.toks[self.pos]
    }

    fn at_eof(&self) -> bool {
        self.peek().tok == Tok::Eof
    }

    fn next(&mut self) -> Token {
        let t = self.toks[self.pos].clone();
        if self.pos + 1 < self.toks.len() {
            self.pos += 1;
        }
        t
    }

    fn error<T>(&self, message: impl Into<String>) -> Result<T, Error> {
        let t = self.peek();
        Err(Error {
            line: t.line,
            col: t.col,
            message: message.into(),
        })
    }

    fn is_punct(&self, p: &str) -> bool {
        matches!(&self.peek().tok, Tok::Punct(q) if *q == p)
    }

    fn is_ident(&self, name: &str) -> bool {
        matches!(&self.peek().tok, Tok::Ident(n) if n == name)
    }

    fn eat_punct(&mut self, p: &str) -> bool {
        if self.is_punct(p) {
            self.next();
            true
        } else {
            false
        }
    }

    fn expect_punct(&mut self, p: &str) -> Result<(), Error> {
        if self.eat_punct(p) {
            Ok(())
        } else {
            self.error(format!("expected `{p}`, found {}", self.describe()))
        }
    }

    fn describe(&self) -> String {
        match &self.peek().tok {
            Tok::Ident(n) => format!("`{n}`"),
            Tok::Num(v) => format!("`{v}`"),
            Tok::Punct(p) => format!("`{p}`"),
            Tok::Eof => "the end of the body".into(),
        }
    }

    fn ident(&mut self) -> Result<String, Error> {
        match &self.peek().tok {
            Tok::Ident(n) => {
                let n = n.clone();
                self.next();
                Ok(n)
            }
            _ => self.error(format!("expected a name, found {}", self.describe())),
        }
    }

    fn enter(&mut self) -> Result<(), Error> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return self.error("nested too deeply");
        }
        Ok(())
    }

    fn leave(&mut self) {
        self.depth -= 1;
    }

    fn lookup(&self, name: &str) -> Option<(Slot, bool)> {
        self.scopes.iter().rev().find_map(|s| s.get(name).copied())
    }

    fn declare(&mut self, name: String, mutable: bool) -> Result<Slot, Error> {
        if matches!(name.as_str(), "dt" | "PI" | "TAU" | "state" | "true" | "false") {
            return self.error(format!("`{name}` cannot be redeclared"));
        }
        if self.scopes.last().unwrap().contains_key(&name) {
            return self.error(format!("`{name}` is already declared in this scope"));
        }
        let slot = Slot::Local(self.n_locals);
        self.n_locals += 1;
        self.scopes.last_mut().unwrap().insert(name, (slot, mutable));
        Ok(slot)
    }

    fn state_slot(&mut self, name: &str) -> Result<Slot, Error> {
        if let Some(i) = self.state_names.iter().position(|n| n == name) {
            return Ok(Slot::State(i));
        }
        if self.state_names.len() >= MAX_STATE {
            return self.error(format!("at most {MAX_STATE} state slots"));
        }
        self.state_names.push(name.to_string());
        Ok(Slot::State(self.state_names.len() - 1))
    }

    // -- statements --

    fn block(&mut self) -> Result<Vec<Stmt>, Error> {
        self.expect_punct("{")?;
        self.enter()?;
        self.scopes.push(HashMap::new());
        let mut stmts = Vec::new();
        while !self.is_punct("}") {
            if self.at_eof() {
                return self.error("expected `}` before the end of the body");
            }
            stmts.push(self.stmt()?);
        }
        self.next();
        self.scopes.pop();
        self.leave();
        Ok(stmts)
    }

    fn stmt(&mut self) -> Result<Stmt, Error> {
        if self.is_punct("{") {
            return Ok(Stmt::Block(self.block()?));
        }
        if self.is_punct(";") {
            self.next();
            return Ok(Stmt::Block(Vec::new()));
        }
        let word = match &self.peek().tok {
            Tok::Ident(n) => n.clone(),
            _ => String::new(),
        };
        match word.as_str() {
            "let" | "var" => {
                let s = self.decl()?;
                self.expect_punct(";")?;
                Ok(s)
            }
            "if" => self.if_stmt(),
            "for" => self.for_stmt(),
            "while" => {
                self.next();
                let cond = self.expr()?;
                let body = self.block()?;
                Ok(Stmt::While(cond, body))
            }
            "loop" => {
                self.next();
                let body = self.block()?;
                Ok(Stmt::Loop(body))
            }
            "break" => {
                self.next();
                self.expect_punct(";")?;
                Ok(Stmt::Break)
            }
            "continue" => {
                self.next();
                self.expect_punct(";")?;
                Ok(Stmt::Continue)
            }
            "return" => {
                self.next();
                if !self.is_punct(";") {
                    return self.error("assign the outputs by name instead of returning a value");
                }
                self.next();
                Ok(Stmt::Return)
            }
            "const" | "override" | "fn" | "struct" | "switch" | "discard" | "continuing" => {
                self.error(format!("`{word}` is not supported in a Code node body"))
            }
            _ => {
                let s = self.simple()?;
                self.expect_punct(";")?;
                Ok(s)
            }
        }
    }

    /// `let`/`var` declaration, without the trailing `;`.
    fn decl(&mut self) -> Result<Stmt, Error> {
        let mutable = self.ident()? == "var";
        let name = self.ident()?;
        if self.eat_punct(":") {
            let ty = self.ident()?;
            if !matches!(ty.as_str(), "f32" | "i32" | "u32" | "bool") {
                return self.error(format!("only f32, i32, u32 and bool values exist here, not `{ty}`"));
            }
        }
        let init = if self.eat_punct("=") {
            self.expr()?
        } else if mutable {
            Expr::Lit(Value::Num(0.0))
        } else {
            return self.error("a `let` needs a value");
        };
        // The initializer is parsed before the name is in scope (`let x = x;`
        // refers to an outer x, as in WGSL).
        let slot = self.declare(name, mutable)?;
        Ok(Stmt::Assign(slot, init))
    }

    /// Assignment, compound assignment, `++`/`--` or `_ = expr`, without
    /// the trailing `;`.
    fn simple(&mut self) -> Result<Stmt, Error> {
        if self.is_ident("_") {
            self.next();
            self.expect_punct("=")?;
            return Ok(Stmt::Discard(self.expr()?));
        }
        let name = match &self.peek().tok {
            Tok::Ident(n) => n.clone(),
            _ => return self.error(format!("expected a statement, found {}", self.describe())),
        };
        let slot = self.lvalue()?;
        let compound = |op: BinOp, slot: Slot, rhs: Expr| {
            Stmt::Assign(slot, Expr::Bin(op, Box::new(Expr::Var(slot)), Box::new(rhs)))
        };
        let one = || Expr::Lit(Value::Num(1.0));
        let s = if self.eat_punct("=") {
            Stmt::Assign(slot, self.expr()?)
        } else if self.eat_punct("+=") {
            compound(BinOp::Add, slot, self.expr()?)
        } else if self.eat_punct("-=") {
            compound(BinOp::Sub, slot, self.expr()?)
        } else if self.eat_punct("*=") {
            compound(BinOp::Mul, slot, self.expr()?)
        } else if self.eat_punct("/=") {
            compound(BinOp::Div, slot, self.expr()?)
        } else if self.eat_punct("%=") {
            compound(BinOp::Rem, slot, self.expr()?)
        } else if self.eat_punct("++") {
            compound(BinOp::Add, slot, one())
        } else if self.eat_punct("--") {
            compound(BinOp::Sub, slot, one())
        } else {
            return self.error(format!(
                "expected `=` after `{name}` (a bare expression does nothing here)"
            ));
        };
        Ok(s)
    }

    /// Something assignable: a `var`, an output, or `state.<name>`.
    fn lvalue(&mut self) -> Result<Slot, Error> {
        let name = self.ident()?;
        if name == "state" {
            self.expect_punct(".")?;
            let field = self.ident()?;
            return self.state_slot(&field);
        }
        match self.lookup(&name) {
            Some((slot, true)) => Ok(slot),
            Some((Slot::Input(_), false)) => {
                self.error(format!("`{name}` is an input; inputs cannot be assigned"))
            }
            Some((_, false)) => self.error(format!("`{name}` is a `let`; declare it with `var` to assign it")),
            None => self.error(format!("`{name}` is not declared")),
        }
    }

    fn if_stmt(&mut self) -> Result<Stmt, Error> {
        let mut arms = Vec::new();
        let mut otherwise = None;
        self.next(); // `if`
        loop {
            let cond = self.expr()?;
            let body = self.block()?;
            arms.push((cond, body));
            if self.is_ident("else") {
                self.next();
                if self.is_ident("if") {
                    self.next();
                    continue;
                }
                otherwise = Some(self.block()?);
            }
            break;
        }
        Ok(Stmt::If(arms, otherwise))
    }

    fn for_stmt(&mut self) -> Result<Stmt, Error> {
        self.next(); // `for`
        self.expect_punct("(")?;
        self.enter()?;
        self.scopes.push(HashMap::new());
        let init = if self.is_punct(";") {
            None
        } else if self.is_ident("let") || self.is_ident("var") {
            Some(Box::new(self.decl()?))
        } else {
            Some(Box::new(self.simple()?))
        };
        self.expect_punct(";")?;
        let cond = if self.is_punct(";") { None } else { Some(self.expr()?) };
        self.expect_punct(";")?;
        let update = if self.is_punct(")") {
            None
        } else {
            Some(Box::new(self.simple()?))
        };
        self.expect_punct(")")?;
        let body = self.block()?;
        self.scopes.pop();
        self.leave();
        Ok(Stmt::For {
            init,
            cond,
            update,
            body,
        })
    }

    // -- expressions, lowest precedence first --

    fn expr(&mut self) -> Result<Expr, Error> {
        self.enter()?;
        let e = self.or_expr();
        self.leave();
        e
    }

    fn or_expr(&mut self) -> Result<Expr, Error> {
        let mut lhs = self.and_expr()?;
        while self.eat_punct("||") {
            let rhs = self.and_expr()?;
            lhs = Expr::Or(Box::new(lhs), Box::new(rhs));
        }
        Ok(lhs)
    }

    fn and_expr(&mut self) -> Result<Expr, Error> {
        let mut lhs = self.rel_expr()?;
        while self.eat_punct("&&") {
            let rhs = self.rel_expr()?;
            lhs = Expr::And(Box::new(lhs), Box::new(rhs));
        }
        Ok(lhs)
    }

    fn rel_expr(&mut self) -> Result<Expr, Error> {
        let lhs = self.add_expr()?;
        let op = match &self.peek().tok {
            Tok::Punct("==") => BinOp::Eq,
            Tok::Punct("!=") => BinOp::Ne,
            Tok::Punct("<") => BinOp::Lt,
            Tok::Punct("<=") => BinOp::Le,
            Tok::Punct(">") => BinOp::Gt,
            Tok::Punct(">=") => BinOp::Ge,
            _ => return Ok(lhs),
        };
        self.next();
        let rhs = self.add_expr()?;
        Ok(Expr::Bin(op, Box::new(lhs), Box::new(rhs)))
    }

    fn add_expr(&mut self) -> Result<Expr, Error> {
        let mut lhs = self.mul_expr()?;
        loop {
            let op = match &self.peek().tok {
                Tok::Punct("+") => BinOp::Add,
                Tok::Punct("-") => BinOp::Sub,
                _ => return Ok(lhs),
            };
            self.next();
            let rhs = self.mul_expr()?;
            lhs = Expr::Bin(op, Box::new(lhs), Box::new(rhs));
        }
    }

    fn mul_expr(&mut self) -> Result<Expr, Error> {
        let mut lhs = self.unary()?;
        loop {
            let op = match &self.peek().tok {
                Tok::Punct("*") => BinOp::Mul,
                Tok::Punct("/") => BinOp::Div,
                Tok::Punct("%") => BinOp::Rem,
                _ => return Ok(lhs),
            };
            self.next();
            let rhs = self.unary()?;
            lhs = Expr::Bin(op, Box::new(lhs), Box::new(rhs));
        }
    }

    fn unary(&mut self) -> Result<Expr, Error> {
        if self.eat_punct("-") {
            self.enter()?;
            let e = self.unary();
            self.leave();
            return Ok(Expr::Neg(Box::new(e?)));
        }
        if self.eat_punct("!") {
            self.enter()?;
            let e = self.unary();
            self.leave();
            return Ok(Expr::Not(Box::new(e?)));
        }
        self.primary()
    }

    fn primary(&mut self) -> Result<Expr, Error> {
        let t = self.peek().clone();
        match t.tok {
            Tok::Num(v) => {
                self.next();
                Ok(Expr::Lit(Value::Num(v)))
            }
            Tok::Punct("(") => {
                self.next();
                let e = self.expr()?;
                self.expect_punct(")")?;
                Ok(e)
            }
            Tok::Ident(name) => {
                self.next();
                match name.as_str() {
                    "true" => return Ok(Expr::Lit(Value::Bool(true))),
                    "false" => return Ok(Expr::Lit(Value::Bool(false))),
                    "dt" => return Ok(Expr::Var(Slot::Dt)),
                    "PI" => return Ok(Expr::Var(Slot::Pi)),
                    "TAU" => return Ok(Expr::Var(Slot::Tau)),
                    "state" => {
                        self.expect_punct(".")?;
                        let field = self.ident()?;
                        return Ok(Expr::Var(self.state_slot(&field)?));
                    }
                    _ => {}
                }
                if self.is_punct("(") {
                    return self.call(&name);
                }
                match self.lookup(&name) {
                    Some((slot, _)) => Ok(Expr::Var(slot)),
                    None => {
                        self.pos -= 1;
                        if BUILTINS.iter().any(|(n, _, _)| *n == name) {
                            self.error(format!("`{name}` is a function: call it with `(`"))
                        } else if matches!(
                            name.as_str(),
                            "vec2f" | "vec3f" | "vec4f" | "vec2" | "vec3" | "vec4"
                        ) {
                            self.error(format!(
                                "`{name}`: vectors exist only on the GPU; a scalar Code node works with numbers"
                            ))
                        } else {
                            self.error(format!("`{name}` is not declared"))
                        }
                    }
                }
            }
            _ => self.error(format!("expected a value, found {}", self.describe())),
        }
    }

    fn call(&mut self, name: &str) -> Result<Expr, Error> {
        let Some((_, builtin, arity)) = BUILTINS.iter().find(|(n, _, _)| *n == name) else {
            self.pos -= 1;
            if matches!(name, "vec2f" | "vec3f" | "vec4f" | "vec2" | "vec3" | "vec4") {
                return self.error(format!(
                    "`{name}`: vectors exist only on the GPU; a scalar Code node works with numbers"
                ));
            }
            return self.error(format!("`{name}` is not a function a scalar Code node can call"));
        };
        self.expect_punct("(")?;
        let mut args = Vec::new();
        if !self.is_punct(")") {
            loop {
                args.push(self.expr()?);
                if !self.eat_punct(",") {
                    break;
                }
            }
        }
        self.expect_punct(")")?;
        if args.len() != *arity {
            return self.error(format!(
                "`{name}` takes {arity} argument{}, got {}",
                if *arity == 1 { "" } else { "s" },
                args.len()
            ));
        }
        Ok(Expr::Call(*builtin, args))
    }
}

// --- interpreter -----------------------------------------------------------

enum Flow {
    Normal,
    Break,
    Continue,
    Return,
}

struct Vm<'a> {
    inputs: &'a [Value],
    outputs: &'a mut [Value],
    state: &'a mut [f32],
    dt: f32,
    locals: Vec<Value>,
    /// Statements left this frame; at zero the body ends.
    steps: usize,
}

impl Vm<'_> {
    fn read(&self, slot: Slot) -> Value {
        match slot {
            Slot::Input(i) => self.inputs[i],
            Slot::Output(i) => self.outputs[i],
            Slot::Local(i) => self.locals[i],
            Slot::State(i) => Value::Num(self.state[i]),
            Slot::Dt => Value::Num(self.dt),
            Slot::Pi => Value::Num(PI),
            Slot::Tau => Value::Num(TAU),
        }
    }

    fn write(&mut self, slot: Slot, v: Value) {
        match slot {
            Slot::Output(i) => self.outputs[i] = v,
            Slot::Local(i) => self.locals[i] = v,
            Slot::State(i) => self.state[i] = v.num(),
            Slot::Input(_) | Slot::Dt | Slot::Pi | Slot::Tau => {}
        }
    }

    fn tick(&mut self) -> bool {
        if self.steps == 0 {
            return false;
        }
        self.steps -= 1;
        true
    }

    fn exec(&mut self, stmts: &[Stmt]) -> Flow {
        for s in stmts {
            if !self.tick() {
                return Flow::Return;
            }
            match self.exec_one(s) {
                Flow::Normal => {}
                other => return other,
            }
        }
        Flow::Normal
    }

    fn exec_one(&mut self, s: &Stmt) -> Flow {
        match s {
            Stmt::Assign(slot, e) => {
                let v = self.eval(e);
                self.write(*slot, v);
                Flow::Normal
            }
            Stmt::Discard(e) => {
                let _ = self.eval(e);
                Flow::Normal
            }
            Stmt::Block(body) => self.exec(body),
            Stmt::If(arms, otherwise) => {
                for (cond, body) in arms {
                    if self.eval(cond).truth() {
                        return self.exec(body);
                    }
                }
                match otherwise {
                    Some(body) => self.exec(body),
                    None => Flow::Normal,
                }
            }
            Stmt::For {
                init,
                cond,
                update,
                body,
            } => {
                if let Some(init) = init {
                    self.exec_one(init);
                }
                loop {
                    if !self.tick() {
                        return Flow::Return;
                    }
                    if let Some(c) = cond
                        && !self.eval(c).truth()
                    {
                        break;
                    }
                    match self.exec(body) {
                        Flow::Break => break,
                        Flow::Return => return Flow::Return,
                        Flow::Normal | Flow::Continue => {}
                    }
                    if let Some(u) = update {
                        self.exec_one(u);
                    }
                }
                Flow::Normal
            }
            Stmt::While(cond, body) => {
                loop {
                    if !self.tick() {
                        return Flow::Return;
                    }
                    if !self.eval(cond).truth() {
                        break;
                    }
                    match self.exec(body) {
                        Flow::Break => break,
                        Flow::Return => return Flow::Return,
                        Flow::Normal | Flow::Continue => {}
                    }
                }
                Flow::Normal
            }
            Stmt::Loop(body) => {
                loop {
                    if !self.tick() {
                        return Flow::Return;
                    }
                    match self.exec(body) {
                        Flow::Break => break,
                        Flow::Return => return Flow::Return,
                        Flow::Normal | Flow::Continue => {}
                    }
                }
                Flow::Normal
            }
            Stmt::Break => Flow::Break,
            Stmt::Continue => Flow::Continue,
            Stmt::Return => Flow::Return,
        }
    }

    fn eval(&self, e: &Expr) -> Value {
        match e {
            Expr::Lit(v) => *v,
            Expr::Var(slot) => self.read(*slot),
            Expr::Neg(x) => Value::Num(-self.eval(x).num()),
            Expr::Not(x) => Value::Bool(!self.eval(x).truth()),
            Expr::And(a, b) => Value::Bool(self.eval(a).truth() && self.eval(b).truth()),
            Expr::Or(a, b) => Value::Bool(self.eval(a).truth() || self.eval(b).truth()),
            Expr::Bin(op, a, b) => {
                let a = self.eval(a).num();
                let b = self.eval(b).num();
                match op {
                    BinOp::Add => Value::Num(a + b),
                    BinOp::Sub => Value::Num(a - b),
                    BinOp::Mul => Value::Num(a * b),
                    BinOp::Div => Value::Num(a / b),
                    BinOp::Rem => Value::Num(a % b),
                    BinOp::Eq => Value::Bool(a == b),
                    BinOp::Ne => Value::Bool(a != b),
                    BinOp::Lt => Value::Bool(a < b),
                    BinOp::Le => Value::Bool(a <= b),
                    BinOp::Gt => Value::Bool(a > b),
                    BinOp::Ge => Value::Bool(a >= b),
                }
            }
            Expr::Call(f, args) => {
                let a = |i: usize| self.eval(&args[i]).num();
                let v = match f {
                    Builtin::Abs => a(0).abs(),
                    Builtin::Floor => a(0).floor(),
                    Builtin::Ceil => a(0).ceil(),
                    Builtin::Round => {
                        // WGSL rounds half to even.
                        let x = a(0);
                        let r = x.round();
                        if (x - x.trunc()).abs() == 0.5 && r % 2.0 != 0.0 { r - x.signum() } else { r }
                    }
                    Builtin::Fract => a(0) - a(0).floor(),
                    Builtin::Trunc => a(0).trunc(),
                    Builtin::Sign => {
                        let x = a(0);
                        if x > 0.0 { 1.0 } else if x < 0.0 { -1.0 } else { 0.0 }
                    }
                    Builtin::Sqrt => a(0).sqrt(),
                    Builtin::InverseSqrt => 1.0 / a(0).sqrt(),
                    Builtin::Exp => a(0).exp(),
                    Builtin::Exp2 => a(0).exp2(),
                    Builtin::Log => a(0).ln(),
                    Builtin::Log2 => a(0).log2(),
                    Builtin::Pow => a(0).powf(a(1)),
                    Builtin::Sin => a(0).sin(),
                    Builtin::Cos => a(0).cos(),
                    Builtin::Tan => a(0).tan(),
                    Builtin::Asin => a(0).asin(),
                    Builtin::Acos => a(0).acos(),
                    Builtin::Atan => a(0).atan(),
                    Builtin::Atan2 => a(0).atan2(a(1)),
                    Builtin::Sinh => a(0).sinh(),
                    Builtin::Cosh => a(0).cosh(),
                    Builtin::Tanh => a(0).tanh(),
                    Builtin::Min => a(0).min(a(1)),
                    Builtin::Max => a(0).max(a(1)),
                    Builtin::Clamp => {
                        let (x, lo, hi) = (a(0), a(1), a(2));
                        x.max(lo).min(hi)
                    }
                    Builtin::Mix => {
                        let (x, y, t) = (a(0), a(1), a(2));
                        x + (y - x) * t
                    }
                    Builtin::Step => f32::from(a(1) >= a(0)),
                    Builtin::Smoothstep => {
                        let (lo, hi, x) = (a(0), a(1), a(2));
                        let t = ((x - lo) / (hi - lo)).clamp(0.0, 1.0);
                        t * t * (3.0 - 2.0 * t)
                    }
                    Builtin::Saturate => a(0).clamp(0.0, 1.0),
                    Builtin::Fma => a(0) * a(1) + a(2),
                    Builtin::Degrees => a(0).to_degrees(),
                    Builtin::Radians => a(0).to_radians(),
                    Builtin::Select => {
                        // select(if_false, if_true, condition), as in WGSL.
                        return if self.eval(&args[2]).truth() {
                            self.eval(&args[1])
                        } else {
                            self.eval(&args[0])
                        };
                    }
                    Builtin::F32 => a(0),
                    Builtin::I32 => a(0).trunc(),
                    Builtin::U32 => a(0).trunc().max(0.0),
                    Builtin::Bool => return Value::Bool(self.eval(&args[0]).truth()),
                };
                Value::Num(v)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::code::CodePort;

    fn def(inputs: &[(&str, Shape)], outputs: &[(&str, Shape)], body: &str) -> CodeDef {
        let port = |(name, shape): &(&str, Shape)| CodePort {
            name: name.to_string(),
            shape: *shape,
            ..Default::default()
        };
        CodeDef {
            inputs: inputs.iter().map(port).collect(),
            outputs: outputs.iter().map(port).collect(),
            body: body.to_string(),
        }
    }

    fn run1(body: &str, inputs: &[(&str, f32)]) -> f32 {
        let ins: Vec<(&str, Shape)> = inputs.iter().map(|(n, _)| (*n, Shape::Scalar)).collect();
        let d = def(&ins, &[("out", Shape::Scalar)], body);
        let s = compile(&d).unwrap_or_else(|e| panic!("{e}"));
        let vals: Vec<Value> = inputs.iter().map(|(_, v)| Value::Num(*v)).collect();
        let mut state = vec![0.0; s.state_names().len()];
        s.run(&vals, 1.0 / 60.0, &mut state)[0].num()
    }

    #[test]
    fn arithmetic_and_precedence() {
        assert_eq!(run1("out = 1.0 + 2.0 * 3.0;", &[]), 7.0);
        assert_eq!(run1("out = (1.0 + 2.0) * 3.0;", &[]), 9.0);
        assert_eq!(run1("out = -a * 2.0 + b;", &[("a", 1.5), ("b", 1.0)]), -2.0);
        assert_eq!(run1("out = 7.0 % 3.0;", &[]), 1.0);
        assert_eq!(run1("out = 1e2 + .5 + 2. + 3u + 0x10;", &[]), 121.5);
        assert_eq!(run1("let x = 2.0; var y = x; y += 3.0; y++; out = y;", &[]), 6.0);
        assert_eq!(run1("out = TAU / PI;", &[]), 2.0);
    }

    #[test]
    fn booleans_coerce_loosely() {
        assert_eq!(run1("out = a > 0.5 && b < 0.5;", &[("a", 1.0), ("b", 0.0)]), 1.0);
        assert_eq!(run1("out = !(a > 0.5) || b == 1.0;", &[("a", 1.0), ("b", 1.0)]), 1.0);
        assert_eq!(run1("out = (a > 0.5) * 3.0;", &[("a", 1.0)]), 3.0);
        assert_eq!(run1("if a { out = 1.0; } else { out = 2.0; }", &[("a", 0.0)]), 2.0);
        assert_eq!(run1("out = select(1.0, 2.0, a > 0.0);", &[("a", 1.0)]), 2.0);
        assert_eq!(run1("out = f32(true) + f32(bool(0.0));", &[]), 1.0);
    }

    #[test]
    fn builtins_match_wgsl() {
        assert_eq!(run1("out = fract(-0.25);", &[]), 0.75);
        assert_eq!(run1("out = round(2.5) + round(3.5);", &[]), 6.0);
        assert_eq!(run1("out = step(0.5, 0.7) + step(0.5, 0.3);", &[]), 1.0);
        assert_eq!(run1("out = smoothstep(0.0, 1.0, 0.5);", &[]), 0.5);
        assert_eq!(run1("out = mix(0.0, 10.0, 0.25);", &[]), 2.5);
        assert_eq!(run1("out = clamp(5.0, 0.0, 1.0) + saturate(-1.0);", &[]), 1.0);
        assert_eq!(run1("out = sign(-3.0) + sign(0.0) + abs(-2.0);", &[]), 1.0);
        assert_eq!(run1("out = i32(2.9) + u32(-1.0) + atan2(0.0, 1.0);", &[]), 2.0);
        assert_eq!(run1("out = min(1.0, 2.0) + max(1.0, 2.0) + pow(2.0, 3.0);", &[]), 11.0);
        assert_eq!(run1("out = degrees(PI) + radians(180.0) - PI;", &[]), 180.0);
    }

    #[test]
    fn control_flow() {
        assert_eq!(
            run1("var s = 0.0; for (var i = 0; i < 5; i++) { if i == 3 { continue; } s += i; } out = s;", &[]),
            7.0
        );
        assert_eq!(run1("var n = 0.0; while n < 10.0 { n += 3.0; } out = n;", &[]), 12.0);
        assert_eq!(run1("var n = 0.0; loop { n++; if n >= 4.0 { break; } } out = n;", &[]), 4.0);
        assert_eq!(run1("out = 1.0; return; out = 2.0;", &[]), 1.0);
        assert_eq!(
            run1("if a > 2.0 { out = 3.0; } else if a > 1.0 { out = 2.0; } else { out = 1.0; }", &[("a", 1.5)]),
            2.0
        );
        assert_eq!(run1("{ let x = 1.0; out = x; } { let x = 2.0; out += x; }", &[]), 3.0);
        // Comments, both styles.
        assert_eq!(run1("// top\nout = 1.0; /* multi\nline */ out += 1.0; // tail", &[]), 2.0);
    }

    #[test]
    fn runaway_loops_stop() {
        let d = def(&[], &[("out", Shape::Scalar)], "var n = 0.0; loop { n++; } out = 5.0;");
        let s = compile(&d).unwrap();
        let out = s.run(&[], 0.016, &mut []);
        // The loop ate the budget; the body ended before `out = 5.0`.
        assert_eq!(out[0], Value::Num(0.0));
        let d = def(&[], &[("out", Shape::Scalar)], "var n = 0.0; while true { n++; } out = n;");
        let s = compile(&d).unwrap();
        let out = s.run(&[], 0.016, &mut []);
        assert_eq!(out[0], Value::Num(0.0));
        let d = def(&[], &[("out", Shape::Scalar)], "var n = 0.0; for (var i = 0.0; i < 20.0; i += 1.0) { n += 1.0; } out = n;");
        assert_eq!(compile(&d).unwrap().run(&[], 0.016, &mut [])[0], Value::Num(20.0));
    }

    #[test]
    fn state_persists_and_events_fire() {
        let d = def(
            &[("beat", Shape::Event), ("gain", Shape::Scalar)],
            &[("out", Shape::Scalar), ("every_other", Shape::Event)],
            "if beat { state.n += 1.0; every_other = state.n % 2.0 == 0.0; }\nstate.t += dt;\nout = state.n * gain;",
        );
        let s = compile(&d).unwrap();
        assert_eq!(s.state_names(), ["n", "t"]);
        let mut state = vec![0.0; 2];
        let frame = |fired: bool, state: &mut Vec<f32>| {
            s.run(&[Value::Bool(fired), Value::Num(2.0)], 0.5, state)
        };
        let o = frame(true, &mut state);
        assert_eq!(o, vec![Value::Num(2.0), Value::Bool(false)]);
        let o = frame(false, &mut state);
        assert_eq!(o, vec![Value::Num(2.0), Value::Bool(false)]);
        let o = frame(true, &mut state);
        assert_eq!(o, vec![Value::Num(4.0), Value::Bool(true)]);
        assert_eq!(state, vec![2.0, 1.5]);
    }

    #[test]
    fn errors_point_at_the_problem() {
        let err = |body: &str| {
            let d = def(&[("a", Shape::Scalar)], &[("out", Shape::Scalar)], body);
            compile(&d).unwrap_err()
        };
        let e = err("out = a +;");
        assert_eq!((e.line, e.col), (1, 10), "{e}");
        let e = err("out = 1.0;\nout = nope;");
        assert_eq!((e.line, e.col), (2, 7), "{e}");
        assert!(e.message.contains("not declared"));
        assert!(err("a = 1.0;").message.contains("input"));
        assert!(err("let x = 1.0; x = 2.0;").message.contains("var"));
        assert!(err("out = vec3f(1.0).x;").message.contains("GPU"));
        assert!(err("out = sin(1.0, 2.0);").message.contains("1 argument"));
        assert!(err("out = foo(1.0);").message.contains("not a function"));
        assert!(err("return 1.0;").message.contains("assign"));
        assert!(err("out = 1.0").message.contains("`;`"));
        assert!(err("let dt = 1.0;").message.contains("redeclared"));
        assert!(err("let x = 1.0; let x = 2.0;").message.contains("already declared"));
        assert!(err("out = 1.0; /* open").message.contains("unterminated"));
        assert!(err("out = 1.0 @ 2.0;").message.contains("unexpected character"));
        assert!(err("var x: vec3f;").message.contains("f32"));
        let deep = format!("out = {}1.0{};", "(".repeat(100), ")".repeat(100));
        assert!(err(&deep).message.contains("nested"));
    }

    #[test]
    fn let_initializer_sees_the_outer_name() {
        assert_eq!(run1("let a = 1.0; { let a = a + 1.0; out = a; }", &[("a", 5.0)]), 2.0);
    }
}
