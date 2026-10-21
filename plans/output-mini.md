# The Output node gets a mini

Status: **built and tested (2026-10-21), gate `43b1d82`**. Worktree
`C:\Users\camer\.t3\worktrees\Empyrean\output-mini`, branch `output-mini` →
gate `master`; the site picks it up through the web-dist bump.

## Goal

Cameron (2026-10-21, playground): "why doesn't the output node have a mini?"
then "make the needed changes". Every node carries a live mini while the
preview runs, except the Output: minis show what a node hands on, the Output
has no output port, and `preview_style` in the crate refused it outright. Give
it a ring like any field node, so a collapsed patch, a phone, or a canvas with
the preview scrolled away still shows the result next to the graph.

## Decisions

- **The Output's cell is the frame the gate shows**: its `in`, times its
  Master, then hue pull and the crew's master brightness, soft-clipped like
  every cell. Not the raw `in` (that is already the upstream node's mini).
- **Its cell comes first** among the preview cells, so the
  `MAX_PREVIEW_NODES` cut (32) never drops it on a big patch.
- Hosts need no change: the gate engine and the wasm name cells through
  `Program::preview_keys()`; the editor only has to draw a ring for a node
  with no output port.

## Steps

1. Crate (`codegen.rs`): `PreviewStyle::Final` for `output`, emitted first;
   tests updated (the two that asserted the Output had no cell) and a new one.
2. Editor (`PatchEditor.tsx`): the Output node shows a ring (expanded and
   minimized). README / patch-web README sentences.
3. Build wasm, crate tests, patch-web typecheck/tests, browser shader check,
   gate UI specs touching minis.
4. Fast-forward `master`, push; CI rebuilds web-dist and bumps the site;
   check on the dev Preview.

## Progress log

- [x] 1 crate: `PreviewStyle::Final`, Output cell first; crate 162/162
      (new `output_cell_is_the_final_frame_and_survives_the_cap`).
- [x] 2 editor + docs: ring on the Output; `navigation::outputMini` keys an
      inner Output on its Sub-patch's id; README sentence.
- [x] 3 checks: patch-web typecheck + 213 unit tests green; gate patch specs
      14/14, full behaviour suite 144/144 (Chromium), browser shader check 3/3.
- [ ] 4 landed and seen on the Preview

## Findings / gotchas

- Inside a Sub-patch the inner Output does not exist in the flattened patch
  (`flatten` folds it into the Sub-patch), so `flatId` would name a cell that
  never comes. `outputMini` points it at the Sub-patch's own cell instead,
  which is what that document hands on.
- Feedback reads black in every preview cell (`feedback_at` under PREVIEW:
  the preview module has no last frame), so on a Feedback patch the Output's
  mini is the frame without its trail. Accepted; noted in the codegen comment.
- The crate is not rustfmt- or clippy-clean on `master` (many pre-existing
  diffs, four clippy errors about PI); CI does not gate on either.
- Gate specs: run with `PW_PORT=<free port>`, since `reuseExistingServer`
  would otherwise test another worktree's server on 9531.
