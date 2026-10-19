// Quick fixes for the errors a Code body gets, as edits to the body: from
// the core's own checks (both tiers: `return <value>`, unbalanced brackets,
// unbounded loops in a field body, writing to an input or a `let`) and the
// shader compilers' (a missing `;`, a name that does not exist). Pure: the
// editor turns each into a lint action, recomputed against the text at the
// moment it is applied.

import { blankComments } from "./code-signature";

export interface BodyEdit {
  from: number;
  to: number;
  insert: string;
}

export interface QuickFix {
  name: string;
  changes: BodyEdit[];
}

export interface FixContext {
  /** Output port names, the principal (`out`) first. */
  outputs: string[];
  /** Names the body can use (ports, helpers, builtins, globals); its own
   * `let`/`var`s are added from the text. */
  names: string[];
  tier: "cpu" | "gpu" | null;
}

/** How many iterations a loop made bounded by a fix may run. */
export const FIX_LOOP_BOUND = 256;

/** The fixes for the error `message` reported at offset `at` of `body`. */
export function fixesFor(message: string, at: number, body: string, ctx: FixContext): QuickFix[] {
  const code = blankComments(body);
  const fixes: QuickFix[] = [];
  const word = /^[A-Za-z_]\w*/.exec(body.slice(at))?.[0] ?? "";

  if (/return a value|returning a value/i.test(message)) {
    // The GPU check points at `return`, the interpreter at the value after it.
    const lineStart = code.lastIndexOf("\n", at - 1) + 1;
    const back = /\breturn\s*$/.exec(code.slice(lineStart, at));
    const r = word === "return" ? at : back ? lineStart + back.index : -1;
    if (r >= 0) fixes.push(...returnFixes(body, code, r, ctx));
  }
  const unclosed = /this `([{(])` is never closed/.exec(message);
  if (unclosed) fixes.push(closeFix(body, code, at, unclosed[1] as "{" | "("));
  if (/this `[})]` closes nothing/.test(message)) {
    fixes.push({ name: "Remove it", changes: [{ from: at, to: at + 1, insert: "" }] });
  }
  if (/is not allowed in a field body/.test(message) && (word === "while" || word === "loop")) {
    const f = boundLoopFix(body, code, at, word);
    if (f) fixes.push(f);
  }
  if (/needs a fixed bound/.test(message) && word === "for") {
    const f = capForFix(body, code, at);
    if (f) fixes.push(f);
  }
  const input = /`([A-Za-z_]\w*)` is an input(?:, and inputs are read-only|; inputs cannot be assigned)/.exec(message);
  if (input) fixes.push(copyInputFix(body, code, input[1]));
  const letAssigned = /`([A-Za-z_]\w*)` is a `let`/.exec(message);
  if (letAssigned) {
    const f = letToVarFix(code, letAssigned[1]);
    if (f) fixes.push(f);
  }
  if (/expected [`'"]?;[`'"]?/.test(message)) {
    let i = at;
    while (i > 0 && /\s/.test(code[i - 1])) i--;
    if (i > 0) fixes.push({ name: "Insert `;`", changes: [{ from: i, to: i, insert: ";" }] });
  }
  if (/not declared|unresolved|no definition|not a function|unknown identifier|undefined/i.test(message)) {
    // Backticks (the core) or single quotes (naga, Tint); double quotes hold
    // a node's name.
    const quoted = /[`']([A-Za-z_]\w*)[`']/.exec(message)?.[1];
    const name = quoted ?? word;
    const start = body.slice(at, at + name.length) === name ? at : findWordOnLine(body, at, name);
    if (name && start >= 0) {
      for (const s of closestNames(name, [...ctx.names, ...declared(code)])) {
        fixes.push({ name: `Change to \`${s}\``, changes: [{ from: start, to: start + name.length, insert: s }] });
      }
    }
  }
  return fixes;
}

// --- the individual fixes ----------------------------------------------------

/** Index just past the `;` that ends the statement starting at `from`
 * (brackets balanced), or the body's end. */
function statementEnd(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (ch === ";" && depth === 0) return i + 1;
  }
  return code.length;
}

function returnFixes(body: string, code: string, at: number, ctx: FixContext): QuickFix[] {
  const end = statementEnd(code, at);
  const semi = code[end - 1] === ";";
  const value = body.slice(at + "return".length, semi ? end - 1 : end).trim();
  if (!value) return [];
  // Nothing after it but closing braces: the body ends here anyway.
  const last = code.slice(end).trim() === "" && braceDepth(code, at) === 0;
  return ctx.outputs.slice(0, 3).map((o) => ({
    name: `Assign \`${o}\` instead`,
    changes: [{ from: at, to: end, insert: last ? `${o} = ${value};` : `${o} = ${value};\n${indentAt(body, at)}return;` }],
  }));
}

function closeFix(body: string, code: string, at: number, open: "{" | "("): QuickFix {
  if (open === "{") {
    const tail = body.endsWith("\n") ? "}\n" : "\n}";
    return { name: "Close it at the end", changes: [{ from: body.length, to: body.length, insert: tail }] };
  }
  let eol = body.indexOf("\n", at);
  if (eol < 0) eol = body.length;
  let i = eol;
  while (i > at && /\s/.test(code[i - 1])) i--;
  if (code[i - 1] === ";") i--;
  return { name: "Close it at the end of the line", changes: [{ from: i, to: i, insert: ")" }] };
}

/** `for (var i = 0u; i < 256u; i++)` with a name not used in the body. */
function boundedHead(code: string, init = "0u", bound = `${FIX_LOOP_BOUND}u`): [head: string, name: string] {
  const used = new Set(declared(code).concat(code.match(/[A-Za-z_]\w*/g) ?? []));
  const name = ["i", "k", "j", "n", "step"].find((n) => !used.has(n)) ?? "loop_i";
  return [`for (var ${name} = ${init}; ${name} < ${bound}; ${name}++)`, name];
}

function boundLoopFix(body: string, code: string, at: number, word: "while" | "loop"): QuickFix | null {
  const [head] = boundedHead(code);
  if (word === "loop") {
    return { name: `Make it a \`for\` of at most ${FIX_LOOP_BOUND}`, changes: [{ from: at, to: at + 4, insert: head }] };
  }
  const open = code.indexOf("(", at);
  const close = open < 0 ? -1 : matching(code, open);
  const brace = close < 0 ? -1 : code.indexOf("{", close);
  if (close < 0 || brace < 0 || code.slice(close + 1, brace).trim()) return null;
  const cond = body.slice(open + 1, close).trim();
  const inner = indentAt(body, at) + "  ";
  return {
    name: `Make it a \`for\` of at most ${FIX_LOOP_BOUND}`,
    changes: [
      { from: at, to: close + 1, insert: head },
      { from: brace + 1, to: brace + 1, insert: `\n${inner}if (!(${cond})) { break; }` },
    ],
  };
}

function capForFix(body: string, code: string, at: number): QuickFix | null {
  const open = code.indexOf("(", at);
  const close = open < 0 ? -1 : matching(code, open);
  if (close < 0) return null;
  const parts = splitTop(code.slice(open + 1, close), ";");
  if (parts.length !== 3) return null;
  const v = /\b(?:var|let)\s+([A-Za-z_]\w*)\s*(?::\s*\w+\s*)?=\s*([^;]*)/.exec(parts[0].text);
  if (!v) return null;
  const init = v[2].trim();
  const bound = /u$/.test(init) ? `${FIX_LOOP_BOUND}u` : /\./.test(init) ? `${FIX_LOOP_BOUND}.0` : `${FIX_LOOP_BOUND}`;
  const condFrom = open + 1 + parts[1].start;
  const condTo = condFrom + parts[1].text.length;
  const cond = body.slice(condFrom, condTo).trim();
  const brace = code.indexOf("{", close);
  if (brace < 0 || code.slice(close + 1, brace).trim()) return null;
  const changes: BodyEdit[] = [{ from: condFrom, to: condTo, insert: ` ${v[1]} < ${bound}` }];
  if (cond) {
    changes.push({ from: brace + 1, to: brace + 1, insert: `\n${indentAt(body, at)}  if (!(${cond})) { break; }` });
  }
  return { name: `Cap it at ${FIX_LOOP_BOUND} iterations`, changes };
}

function copyInputFix(body: string, code: string, input: string): QuickFix {
  const copy = freshName(code, `${input}_v`);
  // The copy goes after any opening comment lines.
  let start = 0;
  for (const line of body.split("\n")) {
    if (!/^\s*(\/\/.*)?$/.test(line)) break;
    start += line.length + 1;
  }
  start = Math.min(start, body.length);
  const changes: BodyEdit[] = [{ from: start, to: start, insert: `var ${copy} = ${input};\n` }];
  for (const m of code.matchAll(new RegExp(`\\b${input}\\b`, "g"))) {
    if (code[m.index - 1] === ".") continue;
    changes.push({ from: m.index, to: m.index + input.length, insert: copy });
  }
  return { name: `Work on a copy (\`var ${copy} = ${input};\`)`, changes };
}

function letToVarFix(code: string, name: string): QuickFix | null {
  const m = new RegExp(`\\blet(\\s+${name}\\b)`).exec(code);
  if (!m) return null;
  return { name: "Make it a `var`", changes: [{ from: m.index, to: m.index + 3, insert: "var" }] };
}

// --- "did you mean" -----------------------------------------------------------

/** Edit distance (insert, delete, substitute; a swap of neighbours is one). */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Up to three names close to `name` (case differences count as close). */
export function closestNames(name: string, names: string[]): string[] {
  const limit = Math.max(1, Math.floor(name.length / 3));
  const seen = new Set<string>();
  return names
    .filter((n) => n !== name && !seen.has(n) && seen.add(n))
    .map((n) => ({ n, d: n.toLowerCase() === name.toLowerCase() ? 0.5 : distance(name, n) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n))
    .slice(0, 3)
    .map((x) => x.n);
}

// --- small text helpers ---------------------------------------------------------

/** Names the body declares itself. */
function declared(code: string): string[] {
  return [...code.matchAll(/\b(?:let|var|const)\s+([A-Za-z_]\w*)/g)].map((m) => m[1]);
}

function freshName(code: string, base: string): string {
  const used = new Set(code.match(/[A-Za-z_]\w*/g) ?? []);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

/** The `)` matching the `(` at `open`, or -1. */
function matching(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** `text` split at `sep` outside brackets, with each part's offset. */
function splitTop(text: string, sep: string): { text: string; start: number }[] {
  const parts: { text: string; start: number }[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      parts.push({ text: text.slice(start, i), start });
      start = i + 1;
    }
  }
  parts.push({ text: text.slice(start), start });
  return parts;
}

/** How many `{` are open at `at`. */
function braceDepth(code: string, at: number): number {
  let depth = 0;
  for (let i = 0; i < at; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth = Math.max(0, depth - 1);
  }
  return depth;
}

/** The leading whitespace of the line holding `at`. */
function indentAt(body: string, at: number): string {
  const lineStart = body.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(body.slice(lineStart))![0];
}

/** Where `name` appears as a word on the line holding `at`, or -1. */
function findWordOnLine(body: string, at: number, name: string): number {
  const lineStart = body.lastIndexOf("\n", at - 1) + 1;
  let lineEnd = body.indexOf("\n", at);
  if (lineEnd < 0) lineEnd = body.length;
  const m = new RegExp(`\\b${name}\\b`).exec(body.slice(lineStart, lineEnd));
  return m ? lineStart + m.index : -1;
}
