// The Code node's body editor: CodeMirror 6 with a WGSL mode, completion and
// hover docs fed by the patch core's reference (and the node's own ports),
// search and multiple selections, and the host's errors as marks on the
// body's lines. One instance per
// panel; the document is kept in sync with the patch (undo in the patch
// replaces the text here, edits here go to the patch coalesced).

import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  rectangularSelection,
  type Tooltip,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
  type StringStream,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import type { CodeFnRef, CodePort, CodeReference, PatchShape } from "../types";
import { signatureHelp } from "./code-signature";
import { snippetsFor } from "./code-snippets";

// --- WGSL, as a stream mode --------------------------------------------------

const KEYWORDS = new Set([
  "let", "var", "const", "if", "else", "for", "while", "loop", "break", "continue", "return",
  "fn", "struct", "switch", "case", "default", "discard", "continuing", "override", "alias",
]);
const TYPES = new Set([
  "f32", "i32", "u32", "bool", "f16", "vec2f", "vec3f", "vec4f", "vec2", "vec3", "vec4", "vec2i",
  "vec3i", "vec4i", "vec2u", "vec3u", "vec4u", "mat2x2f", "mat3x3f", "mat4x4f", "mat2x2",
  "mat3x3", "mat4x4", "array", "ptr", "atomic", "Ctx",
]);
/** Names the generated code and the interpreter put in scope. */
const SPECIAL = new Set(["c", "c0", "ctx", "G", "P", "AUDIO", "FX", "DABS", "SCOPE", "VIDEO", "TOUCH", "state", "dt", "PI", "TAU"]);

interface ModeState {
  depth: number;
  comment: boolean;
}

const NUMBER = /^(0[xX][0-9a-fA-F]+[iu]?|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fhiu]?)/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
const OPERATOR = /^(&&|\|\||==|!=|<=|>=|\+=|-=|\*=|\/=|%=|\+\+|--|->|[-+*/%<>=!&|^~,;:.])/;

const wgsl = StreamLanguage.define<ModeState>({
  name: "wgsl",
  startState: () => ({ depth: 0, comment: false }),
  copyState: (s) => ({ ...s }),
  token(stream: StringStream, state: ModeState): string | null {
    if (state.comment) {
      if (stream.match(/^.*?\*\//)) state.comment = false;
      else stream.skipToEnd();
      return "blockComment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "lineComment";
    }
    if (stream.match("/*")) {
      state.comment = true;
      return "blockComment";
    }
    if (stream.match(NUMBER)) return "number";
    if (stream.match(IDENT)) {
      const word = stream.current();
      const afterDot = stream.start > 0 && stream.string.charAt(stream.start - 1) === ".";
      if (afterDot) return "member";
      if (word === "true" || word === "false") return "bool";
      if (KEYWORDS.has(word)) return "keyword";
      if (TYPES.has(word)) return "typeName";
      if (SPECIAL.has(word)) return "special";
      if (stream.peek() === "(") return "fn";
      return "variableName";
    }
    const ch = stream.peek();
    if (ch === "{") {
      stream.next();
      state.depth++;
      return "bracket";
    }
    if (ch === "}") {
      stream.next();
      state.depth = Math.max(0, state.depth - 1);
      return "bracket";
    }
    if (ch === "(" || ch === ")" || ch === "[" || ch === "]") {
      stream.next();
      return "bracket";
    }
    if (ch === "@") {
      stream.next();
      stream.match(IDENT);
      return "meta";
    }
    if (stream.match(OPERATOR)) return "operator";
    stream.next();
    return null;
  },
  indent(state: ModeState, textAfter: string): number {
    const closes = /^\s*\}/.test(textAfter) ? 1 : 0;
    return Math.max(0, state.depth - closes) * 2;
  },
  tokenTable: {
    fn: t.function(t.variableName),
    member: t.propertyName,
    special: t.special(t.variableName),
  },
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{"] },
  },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "#c792ea" },
  { tag: t.typeName, color: "#7cc0ff" },
  { tag: t.number, color: "#f2c94c" },
  { tag: t.bool, color: "#f78c6c" },
  { tag: [t.lineComment, t.blockComment], color: "#6f6a8a", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#82aaff" },
  { tag: t.propertyName, color: "#ffcb6b" },
  { tag: t.special(t.variableName), color: "#38d1c2" },
  { tag: t.operator, color: "#89ddff" },
  { tag: t.meta, color: "#8a85a8" },
]);

const theme = EditorView.theme(
  {
    "&": {
      fontSize: "12px",
      backgroundColor: "var(--pe-bg, #0d0a1a)",
      color: "#e8e4ff",
      border: "1px solid #2a2445",
      borderRadius: "4px",
    },
    "&.cm-focused": { outline: "1px solid #7c5cff" },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      lineHeight: "1.45",
      minHeight: "180px",
      maxHeight: "60vh",
    },
    ".cm-content": { padding: "6px 0", caretColor: "#e8e4ff" },
    ".cm-cursor": { borderLeftColor: "#e8e4ff" },
    ".cm-gutters": { backgroundColor: "transparent", color: "#4f4a70", border: "none" },
    ".cm-activeLine": { backgroundColor: "#ffffff08" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#8a85a8" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#3b3270" },
    ".cm-matchingBracket": { backgroundColor: "#7c5cff44", outline: "none" },
    ".cm-tooltip": {
      backgroundColor: "#1b1630",
      border: "1px solid #2a2445",
      color: "#e8e4ff",
      fontSize: "12px",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "ui-monospace, Menlo, Consolas, monospace" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#2d2652" },
    ".cm-completionDetail": { opacity: "0.6", fontStyle: "normal" },
    ".cm-completionInfo": { fontFamily: "system-ui, sans-serif", maxWidth: "320px" },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy #ff8a8a" },
    ".cm-diagnostic-error": { borderLeftColor: "#ff8a8a" },
    ".cm-panels": { backgroundColor: "#1b1630", color: "#e8e4ff" },
    ".cm-panels-top": { borderBottom: "1px solid #2a2445" },
    ".cm-search": { fontFamily: "system-ui, sans-serif", fontSize: "12px", padding: "4px 6px" },
    ".cm-search input, .cm-search button, .cm-search label": { margin: "2px 4px 2px 0", fontSize: "12px" },
    ".cm-search input[type=checkbox]": { marginRight: "3px", verticalAlign: "middle" },
    ".cm-textfield": {
      backgroundColor: "var(--pe-bg, #0d0a1a)",
      color: "#e8e4ff",
      border: "1px solid #2a2445",
      borderRadius: "3px",
      padding: "2px 5px",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "#2d2652",
      color: "#e8e4ff",
      border: "1px solid #3b3270",
      borderRadius: "3px",
      padding: "2px 8px",
    },
    ".cm-panel.cm-search [name=close]": { color: "#8a85a8", fontSize: "16px", padding: "0 6px" },
    ".cm-searchMatch": { backgroundColor: "#f2c94c33", outline: "1px solid #f2c94c66" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#f2c94c66" },
    ".cm-selectionMatch": { backgroundColor: "#7c5cff33" },
    ".code-hover": { padding: "4px 8px", maxWidth: "360px", fontFamily: "system-ui, sans-serif" },
    ".code-hover code": { fontFamily: "ui-monospace, Menlo, Consolas, monospace", color: "#82aaff" },
  },
  { dark: true },
);

// --- what the body can use -------------------------------------------------

/** What completion and hover know about the node being edited. */
export interface CodeScope {
  tier: "cpu" | "gpu" | null;
  inputs: CodePort[];
  outputs: CodePort[];
  reference: CodeReference | null;
}

const SHAPE_WORD: Record<PatchShape, string> = {
  scalar: "scalar",
  event: "event",
  field_scalar: "grey field (f32)",
  field_color: "colour field (vec4f)",
  points: "points",
  effects: "effects",
  texture: "texture",
  pixels: "pixels",
};

/** WGSL builtins worth offering (the GPU tier), with signatures. */
const WGSL_BUILTINS: CodeFnRef[] = [
  ["abs", "abs(x)", "Absolute value, per component."],
  ["floor", "floor(x)", "Round down."],
  ["ceil", "ceil(x)", "Round up."],
  ["round", "round(x)", "Round to nearest, halves to even."],
  ["fract", "fract(x)", "x - floor(x), 0..1."],
  ["trunc", "trunc(x)", "Round toward zero."],
  ["sign", "sign(x)", "-1, 0 or 1."],
  ["sqrt", "sqrt(x)", "Square root."],
  ["inverseSqrt", "inverseSqrt(x)", "1 / sqrt(x)."],
  ["exp", "exp(x)", "e^x."],
  ["exp2", "exp2(x)", "2^x."],
  ["log", "log(x)", "Natural log."],
  ["log2", "log2(x)", "Log base 2."],
  ["pow", "pow(x, y)", "x^y."],
  ["sin", "sin(x)", "Sine, radians."],
  ["cos", "cos(x)", "Cosine, radians."],
  ["tan", "tan(x)", "Tangent, radians."],
  ["asin", "asin(x)", "Arc sine."],
  ["acos", "acos(x)", "Arc cosine."],
  ["atan", "atan(x)", "Arc tangent."],
  ["atan2", "atan2(y, x)", "Angle of (x, y), radians."],
  ["min", "min(a, b)", "The smaller, per component."],
  ["max", "max(a, b)", "The larger, per component."],
  ["clamp", "clamp(x, lo, hi)", "x held to lo..hi."],
  ["mix", "mix(a, b, t)", "a + (b - a) * t."],
  ["step", "step(edge, x)", "0 below edge, 1 from it."],
  ["smoothstep", "smoothstep(lo, hi, x)", "0 below lo, 1 above hi, a smooth ramp between."],
  ["saturate", "saturate(x)", "clamp(x, 0, 1)."],
  ["fma", "fma(a, b, c)", "a * b + c."],
  ["length", "length(v)", "Length of a vector."],
  ["distance", "distance(a, b)", "length(a - b)."],
  ["normalize", "normalize(v)", "v / length(v)."],
  ["dot", "dot(a, b)", "Dot product."],
  ["cross", "cross(a, b)", "Cross product of two vec3."],
  ["reflect", "reflect(i, n)", "i - 2 * dot(n, i) * n."],
  ["select", "select(if_false, if_true, cond)", "if_true when cond, else if_false."],
  ["any", "any(v)", "Any component true."],
  ["all", "all(v)", "All components true."],
  ["degrees", "degrees(rad)", "Radians to degrees."],
  ["radians", "radians(deg)", "Degrees to radians."],
  ["vec2f", "vec2f(x, y)", "A 2-vector (one value splats)."],
  ["vec3f", "vec3f(x, y, z)", "A 3-vector (one value splats)."],
  ["vec4f", "vec4f(x, y, z, w)", "A 4-vector, e.g. vec4f(rgb, 1.0)."],
  ["f32", "f32(x)", "Convert to f32."],
  ["u32", "u32(x)", "Convert to u32."],
  ["i32", "i32(x)", "Convert to i32."],
].map(([name, signature, doc]) => ({ name, signature, doc }));

const CTX_FALLBACK: { name: string; type: string; doc: string }[] = [
  { name: "theta", type: "f32", doc: "spoke angle, radians" },
  { name: "r01", type: "f32", doc: "0 = outer end of the spoke, 1 = inner end" },
  { name: "rn", type: "f32", doc: "radius, 1 = outer edge" },
  { name: "pos", type: "vec2f", doc: "cartesian, outer edge at |pos| = 1" },
  { name: "spoke", type: "u32", doc: "spoke index" },
  { name: "i", type: "u32", doc: "pixel index along the spoke" },
];

const SWIZZLES = ["x", "y", "z", "w", "r", "g", "b", "a", "xy", "xyz", "rgb", "rg", "xyzw", "rgba"];

/** The part of a signature after the name: `(h, s, v) -> vec3f`. */
function detailOf(fn: CodeFnRef): string {
  return fn.signature.startsWith(fn.name) ? fn.signature.slice(fn.name.length) : fn.signature;
}

function fnCompletion(fn: CodeFnRef, boost = 0): Completion {
  return {
    label: fn.name,
    type: "function",
    detail: detailOf(fn),
    info: fn.doc || undefined,
    boost,
    apply: (view, _c, from, to) => {
      const insert = `${fn.name}()`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length - 1 },
      });
    },
  };
}

/** Variables of type Ctx in `doc`: the context itself and what
 * `ctx_transform` produced. */
function ctxNames(doc: string): Set<string> {
  const names = new Set(["c", "c0", "ctx"]);
  for (const m of doc.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)\s*(?::\s*Ctx)?\s*=\s*ctx_transform\(/g)) names.add(m[1]);
  for (const m of doc.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)\s*:\s*Ctx\b/g)) names.add(m[1]);
  return names;
}

/** The functions an input port gives the body: `<name>_at` to sample it
 * elsewhere, and a buffer's `<name>_on`. */
function portFns(p: CodePort): CodeFnRef[] {
  const n = p.name;
  switch (p.shape) {
    case "points":
    case "effects": {
      const rec = p.shape === "points" ? "Dab" : "Effect";
      const fns = [{ name: `${n}_at`, signature: `${n}_at(k: u32) -> ${rec}`, doc: `The k-th of the live ${p.shape} (0..${n}_count); a zeroed ${rec} past the end.` }];
      if (p.shape === "effects") {
        fns.push({ name: `${n}_on`, signature: `${n}_on(k: u32) -> bool`, doc: `Whether effect k belongs to the chain wired into ${n} (the Effects buffer holds every chain's).` });
      }
      return fns;
    }
    case "texture":
      return [{ name: `${n}_at`, signature: `${n}_at(uv: vec2f) -> vec4f`, doc: `The texture wired into ${n} at uv (0..1, y down), RGBA.` }];
    case "field_scalar":
    case "field_color":
      return [
        {
          name: `${n}_at`,
          signature: `${n}_at(ctx: Ctx) -> ${p.shape === "field_color" ? "vec4f" : "f32"}`,
          doc: `The ${n} input sampled at another position, e.g. ${n}_at(ctx_transform(c, angle, zoom, 0.0, 0.0)).`,
        },
      ];
    default:
      return [];
  }
}

/** The function named `name` in the body's scope: a port's own, a lib
 * helper (GPU) or interpreter builtin (CPU), or a WGSL builtin. */
export function fnFor(s: CodeScope, name: string): CodeFnRef | null {
  for (const p of s.inputs) {
    const fn = portFns(p).find((f) => f.name === name);
    if (fn) return fn;
  }
  const ref = s.reference;
  return (
    (s.tier === "cpu" ? ref?.cpu_builtins : ref?.helpers)?.find((h) => h.name === name) ??
    WGSL_BUILTINS.find((b) => b.name === name) ??
    null
  );
}

function makeCompletions(scope: () => CodeScope) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const s = scope();
    const doc = ctx.state.doc.toString();
    const ref = s.reference;
    const structFields = (name: string) =>
      ref?.structs.find((x) => x.name === name)?.fields ?? (name === "Ctx" ? CTX_FALLBACK : []);

    // After a dot: the members of what is before it.
    const member = ctx.matchBefore(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/);
    if (member) {
      const base = member.text.slice(0, member.text.indexOf("."));
      const from = member.from + base.length + 1;
      let options: Completion[] = [];
      if (s.tier === "cpu") {
        if (base === "state") {
          const used = new Set([...doc.matchAll(/\bstate\.([A-Za-z_]\w*)/g)].map((m) => m[1]));
          options = [...used].map((n) => ({ label: n, type: "property", detail: "state (kept across frames)" }));
        }
      } else if (ctxNames(doc).has(base)) {
        options = structFields("Ctx").map((f) => ({ label: f.name, type: "property", detail: f.type, info: f.doc || undefined }));
      } else if (base === "G") {
        options = structFields("Globals").map((f) => ({ label: f.name, type: "property", detail: f.type, info: f.doc || undefined }));
      } else {
        options = SWIZZLES.map((n) => ({ label: n, type: "property", boost: -1 }));
      }
      return options.length ? { from, options, validFor: /^\w*$/ } : null;
    }

    const word = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*$/);
    if (!word && !ctx.explicit) return null;
    const from = word ? word.from : ctx.pos;
    const options: Completion[] = [];
    for (const p of s.inputs) {
      const n = p.name;
      for (const fn of portFns(p)) options.push(fnCompletion(fn, 2));
      if (p.shape === "points" || p.shape === "effects") {
        options.push({ label: `${n}_count`, type: "variable", detail: `u32 · live ${p.shape} on this input`, boost: 3 });
      } else if (p.shape === "texture") {
        options.push({ label: n, type: "variable", detail: "vec4f · the texture at this pixel (ring mapping)", boost: 3 });
      } else {
        options.push({ label: n, type: "variable", detail: `input · ${SHAPE_WORD[p.shape]}`, boost: 3 });
      }
    }
    for (const p of s.outputs) {
      options.push({ label: p.name, type: "variable", detail: `output · ${SHAPE_WORD[p.shape]}`, boost: 3 });
    }
    if (s.tier === "cpu") {
      options.push(
        { label: "dt", type: "constant", detail: "f32 · seconds since the last frame", boost: 2 },
        { label: "state", type: "constant", detail: "state.<name> keeps a number across frames", boost: 2 },
        { label: "PI", type: "constant", detail: "f32" },
        { label: "TAU", type: "constant", detail: "f32 · 2π" },
      );
      const builtins = ref?.cpu_builtins.length ? ref.cpu_builtins : WGSL_BUILTINS.filter((b) => !/^(vec|length|distance|normalize|dot|cross|reflect|any|all)/.test(b.name));
      for (const b of builtins) options.push(fnCompletion(b));
    } else {
      options.push(
        { label: "c", type: "constant", detail: "Ctx · this pixel", info: "c.theta, c.r01, c.rn, c.pos, c.spoke, c.i", boost: 2 },
        { label: "G", type: "constant", detail: "Globals · time, dt, spokes, pixels…", boost: 1 },
      );
      for (const g of ref?.globals ?? []) {
        if (g.name === "G") continue;
        options.push({ label: g.name, type: "constant", detail: g.type, info: g.doc || undefined });
      }
      if (!ref) options.push({ label: "TAU", type: "constant", detail: "f32 · 2π" }, { label: "PI", type: "constant", detail: "f32" });
      for (const h of ref?.helpers ?? []) {
        if (h.name.startsWith("_") || h.name === "main") continue;
        options.push(fnCompletion(h, h.doc ? 1 : 0));
      }
      for (const b of WGSL_BUILTINS) options.push(fnCompletion(b));
      for (const ty of ["f32", "u32", "i32", "bool", "vec2f", "vec3f", "vec4f"]) {
        if (!options.some((o) => o.label === ty)) options.push({ label: ty, type: "type" });
      }
    }
    // `if` and `for` come as snippets (code-snippets.ts).
    for (const k of ["let", "var", "else", "while", "loop", "break", "continue", "return", "true", "false"]) {
      options.push({ label: k, type: "keyword", boost: -1 });
    }
    options.push(...snippetsFor(s));
    return { from, options, validFor: /^\w*$/ };
  };
}

function makeHover(scope: () => CodeScope) {
  return hoverTooltip((view, pos): Tooltip | null => {
    const s = scope();
    const line = view.state.doc.lineAt(pos);
    const text = line.text;
    const col = pos - line.from;
    let start = col;
    let end = col;
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    while (end < text.length && /\w/.test(text[end])) end++;
    if (start === end) return null;
    const word = text.slice(start, end);
    let title = "";
    let doc = "";
    const ref = s.reference;
    if (start > 0 && text[start - 1] === ".") {
      let bs = start - 1;
      while (bs > 0 && /\w/.test(text[bs - 1])) bs--;
      const base = text.slice(bs, start - 1);
      const struct = ctxNames(view.state.doc.toString()).has(base) ? "Ctx" : base === "G" ? "Globals" : null;
      const field = struct && (ref?.structs.find((x) => x.name === struct)?.fields ?? (struct === "Ctx" ? CTX_FALLBACK : [])).find((f) => f.name === word);
      if (!field) return null;
      title = `${base}.${field.name}: ${field.type}`;
      doc = field.doc;
    } else {
      const port = [...s.inputs, ...s.outputs].find((p) => p.name === word);
      const fn = fnFor(s, word);
      if (port) {
        title = `${port.name}: ${SHAPE_WORD[port.shape]}`;
        doc = s.inputs.includes(port) ? (port.shape === "scalar" ? `input knob ${port.min}..${port.max}, default ${port.default}` : "input") : "output";
      } else if (fn) {
        title = fn.signature;
        doc = fn.doc;
      } else if (word === "dt" && s.tier === "cpu") {
        title = "dt: f32";
        doc = "Seconds since the last frame.";
      } else {
        return null;
      }
    }
    return {
      pos: line.from + start,
      end: line.from + end,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "code-hover";
        const code = document.createElement("code");
        code.textContent = title;
        dom.appendChild(code);
        if (doc) {
          const p = document.createElement("div");
          p.textContent = doc;
          dom.appendChild(p);
        }
        return { dom };
      },
    };
  });
}

// --- errors → marks ----------------------------------------------------------

/** The host's error text, as marks on this node's body. Both tiers report
 * `Code node "<name or id>" line L:C …` (see the crate's `relocate_error`
 * and `script::Error`); anything about another node or without a line is
 * left to the panel's text. */
export function diagnosticsFor(error: string | null | undefined, names: string[], body: string): Diagnostic[] {
  if (!error) return [];
  const out: Diagnostic[] = [];
  const re = /Code node "([^"]+)":? line (\d+):(\d+):? ?/g;
  const lines = body.split("\n");
  let m: RegExpExecArray | null;
  while ((m = re.exec(error))) {
    if (!names.includes(m[1])) continue;
    const line = Math.min(Math.max(1, Number(m[2])), lines.length);
    const col = Math.max(1, Number(m[3]));
    let from = 0;
    for (let i = 0; i < line - 1; i++) from += lines[i].length + 1;
    const lineText = lines[line - 1] ?? "";
    const start = from + Math.min(col - 1, lineText.length);
    const rest = lineText.slice(col - 1);
    const wordLen = rest.match(/^\w+/)?.[0].length ?? (rest.length > 0 ? 1 : 0);
    const tail = error.slice(m.index + m[0].length);
    const next = tail.search(/Code node "|\n/);
    const message = (next >= 0 ? tail.slice(0, next) : tail).replace(/;\s*$/, "").trim();
    out.push({ from: start, to: start + wordLen, severity: "error", message: message || "error here" });
  }
  return out;
}

// --- the component -----------------------------------------------------------

export function CodeEditor({
  value,
  onChange,
  readOnly,
  scope,
  diagnostics,
  ariaLabel,
}: {
  value: string;
  onChange: (body: string) => void;
  readOnly: boolean;
  scope: CodeScope;
  diagnostics: Diagnostic[];
  ariaLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const readOnlyC = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const getScope = () => scopeRef.current;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          // Several carets: Ctrl+D adds the next match, Alt-drag a column.
          EditorState.allowMultipleSelections.of(true),
          rectangularSelection(),
          crosshairCursor(),
          highlightSelectionMatches(),
          search({ top: true }),
          history(),
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          indentUnit.of("  "),
          wgsl,
          syntaxHighlighting(highlight),
          autocompletion({ override: [makeCompletions(getScope)], activateOnTyping: true, maxRenderedOptions: 40 }),
          makeHover(getScope),
          signatureHelp((name) => fnFor(getScope(), name)),
          lintGutter(),
          keymap.of([
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          theme,
          EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
          readOnlyC.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; later props are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The patch is the source of truth: when it changes under us (undo, a
  // load), replace the text without losing more selection than needed.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    const anchor = Math.min(view.state.selection.main.anchor, value.length);
    view.dispatch({ changes: { from: 0, to: current.length, insert: value }, selection: { anchor } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyC.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const len = view.state.doc.length;
    const clipped = diagnostics
      .filter((d) => d.from <= len)
      .map((d) => ({ ...d, to: Math.min(d.to, len) }));
    view.dispatch(setDiagnostics(view.state, clipped));
  }, [diagnostics, value]);

  return <div className="code-editor" ref={host} />;
}
