// The large view's key row on a touch screen: the symbols a phone keyboard
// hides a page away, Tab, the arrows, undo / redo, and scrub mode (a drag on
// a number changes it, code-scrub.ts). The keys never take focus, so the
// on-screen keyboard stays up; text goes through CodeMirror's own input
// handlers, so a `(` still brings its `)`.

import { useState } from "react";
import { cursorCharLeft, cursorCharRight, indentMore, redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { setScrubMode } from "./code-scrub";

/** Type `text` at the selection as if from the keyboard. */
export function typeText(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  const insert = () =>
    view.state.update({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
    });
  if (view.state.facet(EditorView.inputHandler).some((h) => h(view, from, to, text, insert))) return;
  view.dispatch(insert());
}

const SYMBOLS = ["(", ")", "{", "}", ";", ".", ",", "=", "+", "-", "*", "/", "<", ">", "_", "!"];

export function CodeKeys({ view }: { view: () => EditorView | null }) {
  const [scrub, setScrub] = useState(false);
  const run = (f: (v: EditorView) => void, focus: boolean) => {
    const v = view();
    if (!v) return;
    f(v);
    if (focus) v.focus();
  };
  const key = (
    label: string,
    aria: string,
    f: (v: EditorView) => void,
    extra?: { pressed?: boolean; focus?: boolean },
  ) => (
    <button
      key={aria}
      type="button"
      aria-label={aria}
      aria-pressed={extra?.pressed}
      // Keep the editor focused (and the keyboard up).
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(f, extra?.focus ?? true)}
    >
      {label}
    </button>
  );
  return (
    <div className="code-keys" role="toolbar" aria-label="Code keys">
      {key("⇥", "Tab", (v) => {
        if (v.state.selection.ranges.some((r) => !r.empty)) indentMore(v);
        else typeText(v, "  ");
      })}
      {SYMBOLS.map((s) => key(s, s, (v) => typeText(v, s)))}
      {key("←", "Left", (v) => cursorCharLeft(v))}
      {key("→", "Right", (v) => cursorCharRight(v))}
      {key("↶", "Undo", (v) => undo(v))}
      {key("↷", "Redo", (v) => redo(v))}
      {key(
        "⇔",
        "Scrub numbers by dragging",
        (v) => {
          v.dispatch({ effects: setScrubMode.of(!scrub) });
          setScrub(!scrub);
        },
        // Not focused: a drag needs no keyboard.
        { pressed: scrub, focus: false },
      )}
    </div>
  );
}
