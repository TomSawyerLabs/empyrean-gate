// Colour swatches in the Code body: a small square before every colour the
// text spells out in numbers (`vec3f(r, g, b)`, `vec4f(r, g, b, a)`, a
// one-number splat, `hsv2rgb(h, s, v)` with h in turns). Clicking it opens
// the platform's colour picker; picking rewrites the numbers, live, as one
// undo step.

import { Transaction, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export type Rgb = [number, number, number];

interface Arg {
  from: number;
  to: number;
  value: number;
}

export interface ColourCall {
  /** Offset of the function name in the text searched. */
  from: number;
  kind: "rgb" | "splat" | "hsv";
  /** The literal arguments the colour is read from (three, or one splat). */
  args: Arg[];
  rgb: Rgb;
}

const CALL = /\b(vec3f|vec4f|vec3|vec4|hsv2rgb)\s*\(/g;
const NUM = /^\s*(-?(?:\d+\.\d*|\.\d+|\d+)f?)\s*$/;

/** Colour calls in one line of text whose colour is all literals. */
export function colourCalls(text: string): ColourCall[] {
  const calls: ColourCall[] = [];
  for (const m of text.matchAll(CALL)) {
    const open = m.index + m[0].length - 1;
    // Top-level arguments, on this line.
    const args: { from: number; to: number; text: string }[] = [];
    let depth = 0;
    let start = open + 1;
    let close = -1;
    for (let i = open + 1; i < text.length && close < 0; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) close = i;
        else depth--;
      } else if (ch === "," && depth === 0) {
        args.push({ from: start, to: i, text: text.slice(start, i) });
        start = i + 1;
      }
    }
    if (close < 0) continue;
    args.push({ from: start, to: close, text: text.slice(start, close) });
    const lit = (a: { from: number; to: number; text: string }): Arg | null => {
      const n = NUM.exec(a.text);
      if (!n) return null;
      const lead = a.text.indexOf(n[1]);
      return { from: a.from + lead, to: a.from + lead + n[1].length, value: Number(n[1].replace(/f$/, "")) };
    };
    const name = m[1];
    if (name === "hsv2rgb") {
      const hsv = args.length === 3 ? args.map(lit) : [];
      if (hsv.length === 3 && hsv.every(Boolean)) {
        const [h, s, v] = hsv as Arg[];
        calls.push({ from: m.index, kind: "hsv", args: hsv as Arg[], rgb: hsvToRgb(h.value, s.value, v.value) });
      }
      continue;
    }
    if (args.length === 1) {
      const one = lit(args[0]);
      if (one) calls.push({ from: m.index, kind: "splat", args: [one], rgb: [one.value, one.value, one.value] });
      continue;
    }
    const rgb = args.length >= 3 ? args.slice(0, 3).map(lit) : [];
    if (rgb.length === 3 && rgb.every(Boolean)) {
      const a = rgb as Arg[];
      calls.push({ from: m.index, kind: "rgb", args: a, rgb: [a[0].value, a[1].value, a[2].value] });
    }
  }
  return calls;
}

// --- colour conversions ----------------------------------------------------------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The shader lib's `hsv2rgb`: hue in turns (wrapping), s and v 0..1. */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hh = (h - Math.floor(h)) * 6;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 2) % 1) * 2 - 1));
  const i = Math.floor(hh) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][i]!;
  return [r + v - c, g + v - c, b + v - c];
}

/** The shader lib's `rgb2hsv`. */
export function rgbToHsv([r, g, b]: Rgb): Rgb {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = (g - b) / d;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h / 6 + 1) % 1;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function fromHex(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A float literal with at most three decimals and at least one. */
export function lit3(x: number): string {
  const s = String(Math.round(x * 1000) / 1000);
  return s.includes(".") ? s : `${s}.0`;
}

/** The edits (in the searched text's coordinates) that make `call` spell
 * `rgb`. A splat becomes three numbers when the picked colour is not grey. */
export function recolour(call: ColourCall, rgb: Rgb): { from: number; to: number; insert: string }[] {
  if (call.kind === "hsv") {
    const hsv = rgbToHsv(rgb);
    return call.args.map((a, i) => ({ from: a.from, to: a.to, insert: lit3(hsv[i]!) }));
  }
  if (call.kind === "splat") {
    const a = call.args[0]!;
    const grey = rgb[0] === rgb[1] && rgb[1] === rgb[2];
    return [{ from: a.from, to: a.to, insert: grey ? lit3(rgb[0]) : rgb.map(lit3).join(", ") }];
  }
  return call.args.map((a, i) => ({ from: a.from, to: a.to, insert: lit3(rgb[i]!) }));
}

// --- the extension -----------------------------------------------------------------

class SwatchWidget extends WidgetType {
  constructor(
    readonly hex: string,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: SwatchWidget) {
    return other.hex === this.hex && other.pos === this.pos;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "code-swatch";
    el.style.background = this.hex;
    el.title = "Pick a colour";
    el.setAttribute("aria-label", `Colour ${this.hex}; pick another`);
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => {
      e.preventDefault();
      pick(view, this.pos, el);
    });
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

/** Open the colour picker for the call whose name starts at `pos`. */
function pick(view: EditorView, pos: number, anchor: HTMLElement) {
  if (view.state.readOnly) return;
  const line = view.state.doc.lineAt(pos);
  const call = colourCalls(line.text).find((c) => line.from + c.from === pos);
  if (!call) return;
  const first = line.from + call.args[0]!.from;
  const last = line.from + call.args[call.args.length - 1]!.to;
  const original = view.state.sliceDoc(first, last);
  let current = original;

  // A picker closed without a pick sends nothing, so its input lingers
  // until the next one.
  for (const old of document.querySelectorAll(".code-swatch-input")) old.remove();
  const input = document.createElement("input");
  input.type = "color";
  input.value = toHex(call.rgb);
  input.className = "code-swatch-input";
  input.setAttribute("aria-label", "Colour");
  // Next to the swatch, so the picker opens there; invisible.
  const box = anchor.getBoundingClientRect();
  Object.assign(input.style, {
    position: "fixed",
    left: `${box.left}px`,
    top: `${box.bottom}px`,
    width: "1px",
    height: "1px",
    padding: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  (anchor.closest("dialog") ?? document.body).appendChild(input);

  const textFor = (hex: string) => {
    const edits = recolour(call, fromHex(hex));
    // Rebuild the span from the first argument to the last.
    let s = line.text.slice(call.args[0]!.from, call.args[call.args.length - 1]!.to);
    const base = call.args[0]!.from;
    for (const e of [...edits].sort((a, b) => b.from - a.from)) s = s.slice(0, e.from - base) + e.insert + s.slice(e.to - base);
    return s;
  };
  const write = (text: string, history: boolean) => {
    if (text === current && !history) return;
    view.dispatch({
      changes: { from: first, to: first + current.length, insert: text },
      annotations: history ? undefined : Transaction.addToHistory.of(false),
      userEvent: "input.colour",
    });
    current = text;
  };
  input.addEventListener("input", () => write(textFor(input.value), false));
  const done = () => {
    input.remove();
    if (current === original) return;
    const final = current;
    write(original, false);
    write(final, true);
  };
  input.addEventListener("change", done, { once: true });
  try {
    input.showPicker();
  } catch {
    input.click();
  }
}

function swatches(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      for (const c of colourCalls(line.text)) {
        const at = line.from + c.from;
        widgets.push(Decoration.widget({ widget: new SwatchWidget(toHex(c.rgb), at), side: -1 }).range(at));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(widgets, true);
}

/** Colour swatches (see the top of this file). */
export function colourSwatches(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = swatches(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) this.decorations = swatches(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.baseTheme({
      ".code-swatch": {
        display: "inline-block",
        width: "0.85em",
        height: "0.85em",
        margin: "0 3px 0 1px",
        padding: "0",
        border: "1px solid #ffffff55",
        borderRadius: "2px",
        verticalAlign: "-0.1em",
        cursor: "pointer",
      },
    }),
  ];
}
