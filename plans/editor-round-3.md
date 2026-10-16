# Patch editor, round 3: the missing nodes (2026-10-16)

Status: **in progress** (gate worktree `C:\Users\camer\.t3\worktrees\Empyrean\playground`,
branch `patch-crate`, kept fast-forwarded to gate `master`). Site follows via
CI web-dist and the site's `dev` branch (never the site's `master`).

Another agent ("playground-mobile", see the uncommitted `.agents.txt` in this
worktree and in the site checkout) works in the same trees on the playground's
mobile layout and the submission system. Own hunks only, no amend/rebase of
pushed commits.

## Goal

Cameron (2026-10-16): "keep going on the implementations and fixes you
identified". The list I had proposed after the Math/modulo fix, in the order I
recommended:

1. **Map range**: in, in range, out range, optional clamp.
2. **Mix** (a→b by t) and **Clamp**.
3. **Random**: a new value on a trigger and/or its own clock, with glide.
4. **Event tools**: Counter (its `wrap` is "every Nth"), Toggle, Threshold
   (scalar → rise/fall events), Delay (with echoes), Merge (with an open
   gate), Step sequencer.

Left for later (not asked for yet): field math, polar fields, colour
adjust/palette, feedback & sub-patches, editor undo/duplicate.

He also asked why Video in didn't get the per-node treatment Still image got.
Answered in chat; see "Open questions".

## Environment / context

- Crate `crates/empyrean-patch`: nodes are declared in `src/registry.rs`
  (append-only Select lists; every Number param doubles as a Scalar input),
  CPU nodes are evaluated in `src/eval.rs` (`Runtime::eval`, per-node
  `NodeState`, events are per-frame port-name lists), and `codegen.rs`
  `is_cpu_kind` is the activation gate (a registry kind missing from both kind
  lists compiles to "not renderable yet").
- Scalar outputs of CPU nodes get mini meters automatically
  (`Program::preview_scalars`); the editor's palette groups by registry
  category, so new ScalarOp nodes need no TypeScript.
- Tests: `cargo test` in `crates/` (crate), `cargo test` in `src-tauri`
  (app), `bun run test:behavior` (Playwright against the mock backend).
- Web: gate `master` push → CI `web-dist` branch → site `bun update
  @empyrean-gate/patch-web` → push site `dev` → dev.empyreangate.org.

## Decisions (made by Claude; reopen if wrong)

- Events stay events: no implicit event→scalar adapter. Envelope (impulse),
  Toggle (latch), Counter (count) and Random (sample) are the conversions.
- Every-Nth is Counter's `wrap` (Wrap at = N), not a separate node.
- Delay and Envelope run in real seconds (not × master speed); Random's own
  clock and Time/LFO honour master speed like every other rate.
- Random is deterministic per node id (xorshift seeded from the id), so a
  saved patch replays the same sequence and previews are reproducible.
- Toggle's inputs are `toggle`/`set`/`clear` and its outputs `out`/`on`/`off`
  so no input shares a name with an output.

## Plan / steps

1. **Done.** Registry + eval + `is_cpu_kind` for the ten nodes, with eval
   tests for each and a codegen test that every registry kind compiles.
2. **Done.** Preset "Step and Sample": a Time clock steps a Step sequencer
   through hues, its wrap triggers a glided Random (scale) and a Toggle →
   Smooth (spiral fade); Envelope → Map range drives brightness. Mock backend
   unchanged (its registry is a two-node stub).
3. **Now.** README (gate) paragraph done; push gate `master`; wait for CI
   web-dist; bump the site's `bun.lock`; push site `dev`; check the Preview.

## Progress log

- [x] Steps 1–2 (2026-10-16). Tests: crate 81 (ten new eval cases incl.
      determinism and glide of Random, hysteresis of Threshold, Delay echoes,
      Merge gating), app 336.
- [ ] Step 3: gate `master` → web-dist → site `dev` → Preview check.

## Open questions for the user

1. **Per-node video.** Not built. On the gate, video is one live input: a
   connected browser decodes a playlist entry and streams frames over the
   websocket (`StartVideo` / `VIDEO_FRAME_MAGIC`); there is no decoder on the
   gate itself and only one feed at a time. A Still image is ~20–60 KB and
   lives inside the patch JSON, so a file or submission is self-contained; a
   video can't (submissions cap at 3 MB) and the gate couldn't play it
   anyway. Options, cheapest first: (a) leave Video in as "the show's video
   feed", a host input like Mic; (b) a "Clip" node: a short looping clip
   stored in the patch as a few dozen small frames (GIF-like, ~200 KB),
   decoded on both hosts like Still image; (c) several live feeds (more media
   cells, several StartVideo owners, more bandwidth) with Video in picking
   feed 1..N. My recommendation: (b) if people want their own moving
   pictures; (a) otherwise.

## Things not to do

- Never push the website's `master`. Gate `master` is fine; ask before a
  release tag.
- Don't `cargo fmt` the whole tree (reformats dozens of untouched files);
  `rustfmt <file>` only on files this round touches, and check the diff.
- Don't touch `packages/patch-web/src/editor/PatchEditor.tsx` or
  `editor.css` without a note in `.agents.txt`: the other agent is in them.
