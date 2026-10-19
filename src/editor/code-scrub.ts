// Number scrubbing in the Code body: Alt-drag a number literal sideways to
// change it, live (each step is an edit, so the patch re-renders as you
// drag). Shift moves ten times as fast, Ctrl / ⌘ a tenth as fast. On a touch
// screen, scrub mode (the phone key row's ⇔) makes a plain drag on a number
// do the same. A drag is one undo step.

import { Prec, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Pixels of drag per step. */
const PX_PER_STEP = 4;

export interface NumberLiteral {
  /** Offsets in the text searched. */
  from: number;
  to: number;
  value: number;
  /** Digits after the point (0 for an integer, or for `2.`). */
  decimals: number;
  /** Written with a point (`2.`, `2.0`): a float, kept a float. */
  point: boolean;
  /** WGSL suffix: `u`, `i`, `f`, `h` or "". */
  suffix: string;
}

const LITERAL = /(?:\d+\.\d*|\.\d+|\d+)[fhiu]?/g;

/** The number literal of `text` at or touching `col`, if any. Hex and
 * exponent forms are left alone, and so are digits inside a name. */
export function numberAt(text: string, col: number): NumberLiteral | null {
  for (const m of text.matchAll(LITERAL)) {
    const from = m.index;
    const to = from + m[0].length;
    if (col < from || col > to) continue;
    const before = text[from - 1] ?? "";
    const after = text[to] ?? "";
    if (/[\w.]/.test(before) || /[\w.]/.test(after)) return null;
    const suffix = /[fhiu]$/.test(m[0]) ? m[0].slice(-1) : "";
    const digits = suffix ? m[0].slice(0, -1) : m[0];
    const dot = digits.indexOf(".");
    return {
      from,
      to,
      value: Number(digits),
      decimals: dot < 0 ? 0 : digits.length - dot - 1,
      point: dot >= 0,
      suffix,
    };
  }
  return null;
}

/** The literal `lit` moved by `steps` of its own last digit (times
 * `scale`), written as it was: same decimals (more when `scale` is finer),
 * same suffix, a `u` held at 0. A negative value is bracketed unless the
 * text before it (`prev`, its last non-space character) makes a bare minus
 * safe. */
export function scrubbedText(lit: NumberLiteral, steps: number, scale = 1, prev = ""): string {
  const extra = scale < 1 ? Math.round(-Math.log10(scale)) : 0;
  const decimals = lit.decimals + extra;
  const step = 10 ** -lit.decimals * scale;
  let v = lit.value + steps * step;
  if (lit.suffix === "u") v = Math.max(0, v);
  if (!lit.point) v = Math.round(v);
  let s: string;
  if (lit.point) s = decimals === 0 ? `${Math.round(Math.abs(v))}.` : Math.abs(v).toFixed(decimals);
  else s = String(Math.abs(Math.round(v)));
  s += lit.suffix;
  if (v < 0 && Number(s.replace(/[fhiu]$/, "")) !== 0) {
    return prev === "" || /[(,=*/<>!&|?:[{]$/.test(prev) ? `-${s}` : `(-${s})`;
  }
  return s;
}

// --- the extension -------------------------------------------------------------

/** Turn scrub mode (a plain drag scrubs, for touch) on or off. */
export const setScrubMode = StateEffect.define<boolean>();

export const scrubMode = StateField.define<boolean>({
  create: () => false,
  update(on, tr) {
    for (const e of tr.effects) if (e.is(setScrubMode)) on = e.value;
    return on;
  },
});

/** Start scrubbing if (x, y) is on a number; true when it did. */
function start(view: EditorView, event: MouseEvent | PointerEvent): boolean {
  if (view.state.readOnly) return false;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
  const line = view.state.doc.lineAt(pos);
  const lit = numberAt(line.text, pos - line.from);
  if (!lit) return false;
  event.preventDefault();

  const from = line.from + lit.from;
  const original = line.text.slice(lit.from, lit.to);
  const prev = /\S?(?=\s*$)/.exec(line.text.slice(0, lit.from))?.[0] ?? "";
  const startX = event.clientX;
  let current = original;
  let frame = 0;
  let pending: PointerEvent | null = null;
  view.dom.classList.add("code-scrubbing");

  const write = (text: string, history: boolean) => {
    if (text === current && !history) return;
    view.dispatch({
      changes: { from, to: from + current.length, insert: text },
      annotations: history ? undefined : Transaction.addToHistory.of(false),
      userEvent: "input.scrub",
    });
    current = text;
  };
  const apply = () => {
    frame = 0;
    if (!pending) return;
    const e = pending;
    pending = null;
    const scale = e.shiftKey ? 10 : e.ctrlKey || e.metaKey ? 0.1 : 1;
    const steps = Math.trunc((e.clientX - startX) / PX_PER_STEP);
    write(scrubbedText(lit, steps, scale, prev), false);
  };
  const move = (e: PointerEvent) => {
    pending = e;
    frame ||= requestAnimationFrame(apply);
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (frame) cancelAnimationFrame(frame);
    apply();
    view.dom.classList.remove("code-scrubbing");
    if (current === original) return;
    // One undo step for the whole drag: back to the start unrecorded, then
    // the final value recorded.
    const final = current;
    write(original, false);
    write(final, true);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  return true;
}

/** Number scrubbing (see the top of this file). Must come before
 * `rectangularSelection`: an Alt-drag that starts on a number scrubs, any
 * other is a column selection. */
export function scrubbing(): Extension {
  return [
    scrubMode,
    Prec.highest(
      EditorView.domEventHandlers({
        mousedown(e, view) {
          return e.button === 0 && e.altKey ? start(view, e) : false;
        },
        pointerdown(e, view) {
          return e.pointerType !== "mouse" && view.state.field(scrubMode) ? start(view, e) : false;
        },
        mousemove(e, view) {
          // With Alt held, a number under the pointer shows it can be dragged.
          let over = false;
          if (e.altKey && !view.state.readOnly) {
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos !== null) {
              const line = view.state.doc.lineAt(pos);
              over = numberAt(line.text, pos - line.from) !== null;
            }
          }
          view.contentDOM.classList.toggle("code-scrub-hover", over);
          return false;
        },
      }),
    ),
    EditorView.contentAttributes.compute([scrubMode], (s): Record<string, string> =>
      s.field(scrubMode) ? { class: "code-scrub-mode" } : {},
    ),
    EditorView.baseTheme({
      ".cm-content.code-scrub-hover, &.code-scrubbing .cm-content": { cursor: "ew-resize" },
      // Scrub mode on a touch screen: a drag on the text scrubs, never scrolls.
      ".cm-content.code-scrub-mode": { touchAction: "none" },
    }),
  ];
}
