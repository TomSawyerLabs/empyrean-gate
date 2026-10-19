// Live values in a CPU Code body: at the end of each line that declares a
// `let` / `var` (or first uses a `state.` name), what it held on the latest
// frame, faint, refreshed as the meters are. The runtime reports them as
// meters keyed `@<line>:<col>:<name>` / `@state:<name>` (crate
// `script::Script::probe_keys`), so the gate and the browser runtime both
// serve them through `scalar:<node>:<key>`.

import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { blankComments } from "./code-signature";

/** The latest value of a probe key, or undefined when there is none. */
export type LiveValue = (key: string) => number | undefined;

/** Re-read the values (the meters moved, or the source came or went). */
export const liveTick = StateEffect.define<null>();

export interface LiveEntry {
  /** 0-based line. */
  line: number;
  name: string;
  key: string;
}

const encoder = new TextEncoder();

/** The probe keys `body` declares, by line, as the crate would key them
 * (`let`/`var` at the name's byte column; `state.x` once, where first used). */
export function liveEntries(body: string): LiveEntry[] {
  // Matched on the text with comments blanked; columns counted on the
  // original (a blanked `é` is one space, but two bytes to the crate).
  const original = body.split("\n");
  const lines = blankComments(body).split("\n");
  const out: LiveEntry[] = [];
  const states = new Set<string>();
  lines.forEach((text, line) => {
    for (const m of text.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g)) {
      const at = m.index + m[0].length - m[1].length;
      const col = encoder.encode(original[line]!.slice(0, at)).length + 1;
      out.push({ line, name: m[1], key: `@${line + 1}:${col}:${m[1]}` });
    }
    for (const m of text.matchAll(/\bstate\s*\.\s*([A-Za-z_]\w*)/g)) {
      if (states.has(m[1])) continue;
      states.add(m[1]);
      out.push({ line, name: `state.${m[1]}`, key: `@state:${m[1]}` });
    }
  });
  return out;
}

/** A value as the body would write it, short. */
export function formatLive(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(2);
  return String(Number(v.toPrecision(4)));
}

class LiveWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: LiveWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "code-live";
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function build(view: EditorView, value: LiveValue | null): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!value) return builder.finish();
  const doc = view.state.doc;
  const byLine = new Map<number, string[]>();
  for (const e of liveEntries(doc.toString())) {
    const v = value(e.key);
    // NaN: the runtime has no value for it yet (a branch never taken).
    if (v === undefined || Number.isNaN(v)) continue;
    const list = byLine.get(e.line) ?? [];
    list.push(`${e.name} = ${formatLive(v)}`);
    byLine.set(e.line, list);
  }
  for (const [line, parts] of [...byLine].sort((a, b) => a[0] - b[0])) {
    if (line >= doc.lines) continue;
    const end = doc.line(line + 1).to;
    builder.add(end, end, Decoration.widget({ widget: new LiveWidget(parts.join("   ")), side: 1 }));
  }
  return builder.finish();
}

/** Live values, read through `value()` (null: nothing to show). The host
 * dispatches `liveTick` when the values move. */
export function liveValues(value: () => LiveValue | null): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view, value());
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(liveTick)))) {
            this.decorations = build(u.view, value());
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.baseTheme({
      ".code-live": {
        marginLeft: "2em",
        color: "#6f6a8a",
        fontStyle: "italic",
        whiteSpace: "pre",
        pointerEvents: "none",
      },
    }),
  ];
}
