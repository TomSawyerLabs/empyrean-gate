// Signature help for the Code body: while the caret is inside a call's
// parentheses, a tooltip above the call shows the function's parameters
// with the one being typed in bold, and its doc line.

import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import type { CodeFnRef } from "../types";

/** How far back from the caret to look for the open parenthesis. */
const LOOK_BACK = 2000;

const NOT_CALLS = new Set(["if", "for", "while", "switch", "return", "loop"]);

export interface CallSite {
  /** Offset of the call's name. */
  from: number;
  name: string;
  /** Which argument the caret is in, from 0. */
  arg: number;
}

/** `text` with comments blanked to spaces (offsets kept). */
function blankComments(text: string): string {
  return text.replace(/\/\/[^\n]*|\/\*[\s\S]*?(\*\/|$)/g, (m) => m.replace(/[^\n]/g, " "));
}

/** The innermost call whose parentheses hold `pos`, if any: scans back for
 * an unclosed `(` with a name before it, counting the commas at its depth. */
export function callAt(doc: string, pos: number): CallSite | null {
  const start = Math.max(0, pos - LOOK_BACK);
  const text = blankComments(doc.slice(start, pos));
  let depth = 0;
  let commas = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ")" || ch === "]") depth++;
    else if (ch === "[") depth = Math.max(0, depth - 1);
    else if (ch === "(") {
      if (depth > 0) {
        depth--;
        continue;
      }
      let j = i;
      while (j > 0 && /\s/.test(text[j - 1])) j--;
      const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(text.slice(0, j));
      if (!m || NOT_CALLS.has(m[0])) return null;
      return { from: start + m.index, name: m[0], arg: commas };
    } else if (depth === 0 && ch === ",") commas++;
    else if (depth === 0 && (ch === ";" || ch === "{" || ch === "}")) return null;
  }
  return null;
}

/** A signature's parameter list, split at its top-level commas:
 * `mix(a, b, t)` → `["a", "b", "t"]`; the text before and after it. */
export function splitSignature(sig: string): { head: string; params: string[]; tail: string } {
  const open = sig.indexOf("(");
  if (open < 0) return { head: sig, params: [], tail: "" };
  let depth = 0;
  let close = -1;
  for (let i = open; i < sig.length; i++) {
    if (sig[i] === "(") depth++;
    else if (sig[i] === ")" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return { head: sig, params: [], tail: "" };
  const inner = sig.slice(open + 1, close);
  const params: string[] = [];
  let cur = "";
  depth = 0;
  for (const ch of inner) {
    if (ch === "(" || ch === "<") depth++;
    if (ch === ")" || ch === ">") depth--;
    if (ch === "," && depth === 0) {
      params.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) params.push(cur.trim());
  return { head: sig.slice(0, open + 1), params, tail: sig.slice(close) };
}

function tooltipFor(state: EditorState, lookup: (name: string) => CodeFnRef | null): Tooltip | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const call = callAt(state.doc.toString(), sel.head);
  if (!call) return null;
  const fn = lookup(call.name);
  if (!fn) return null;
  const { head, params, tail } = splitSignature(fn.signature);
  return {
    pos: call.from,
    above: true,
    strictSide: false,
    arrow: false,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "code-signature";
      const code = document.createElement("code");
      code.append(head);
      params.forEach((p, i) => {
        if (i) code.append(", ");
        if (i === Math.min(call.arg, params.length - 1)) {
          const b = document.createElement("b");
          b.textContent = p;
          code.append(b);
        } else code.append(p);
      });
      code.append(tail);
      dom.append(code);
      if (fn.doc) {
        const d = document.createElement("div");
        d.textContent = fn.doc;
        dom.append(d);
      }
      return { dom };
    },
  };
}

/** Signature help, finding functions with `lookup`. */
export function signatureHelp(lookup: (name: string) => CodeFnRef | null): Extension {
  const field = StateField.define<Tooltip | null>({
    create: (state) => tooltipFor(state, lookup),
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value;
      return tooltipFor(tr.state, lookup);
    },
    provide: (f) => showTooltip.from(f),
  });
  return [
    field,
    EditorView.baseTheme({
      ".code-signature": { padding: "3px 8px", maxWidth: "420px", fontFamily: "system-ui, sans-serif" },
      ".code-signature code": { fontFamily: "ui-monospace, Menlo, Consolas, monospace", color: "#82aaff" },
      ".code-signature b": { color: "#ffcb6b", fontWeight: "600" },
      ".code-signature div": { opacity: "0.75", marginTop: "2px" },
    }),
  ];
}
