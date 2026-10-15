# Patch editor, round 2 (feedback 2026-10-15)

Status: **done; on gate `master` and the site's `dev` Preview** (gate `master`, worktree
`C:\Users\camer\.t3\worktrees\Empyrean\playground`, branch `patch-crate`
fast-forwarded to `master`). Site follows via web-dist and `dev`.

## Goal

Cameron, from people using the playground:

1. "any change to the UI resets the timer which causes jumps. this is not ok."
2. "timer needs more controls, like to repeat automatically, min/max, etc."
3. "the 'still image' input seems to share a single image/video for all nodes.
   it's config should be on the right, not a global setting"
4. (earlier) a user couldn't make an image spin with `time`: fixed in
   `1e60868` (wired values were clamped to knob ranges; Math gained modulo).

## Findings

- Structural edits (add/remove/rewire a node, change a Select) rebuild the
  evaluator (`Sim::update` → `Runtime::new`), losing every Time/LFO
  accumulator, smoothing state and integrated slab phase. On the gate, the
  engine rebuilds the active patch's Runtime on **every** save (patch_epoch),
  knob turns included, so live edits jump on the real rig too.
- Time is `acc += rate·speed·dt`, nothing else.
- Video in and Still image both read the one VIDEO buffer (binding 7); the
  playground's picker is global; the gate's comes from its Media tab.

## Design

1. **State carries across rebuilds.** `Runtime::adopt_state(&old)`: every node
   that still exists (same id and kind) keeps its CPU state; every integrated
   slab slot whose (node id, param) still exists keeps its accumulator. Used by
   `Sim::update` and by the engine when it rebuilds the patch already on air.
2. **Time node.** Params: rate, start, end, mode (forever / loop / ping-pong /
   once); `reset` event input; outputs `out`, `phase` (0..1 through the
   range), `wrap` event. Defaults reproduce today's node (forever from 0).
3. **Per-node images.** (Format 3.) Image nodes carry their own image in the
   patch; up to N image slots on the GPU; picked in the node's side panel.

## Plan / steps

1. **Done** (`f49a085`). State carry (crate + engine), tests.
2. **Done** (`81346d5`). Time node, tests.
3. **Done** (`022d932`, `7330f48`). Per-node images (format 3): crate,
   engine decode + media cells, runtime upload, side-panel picker; site
   moved its video picker onto Video in (`aca9085`).
4. **Done**. Gate master → CI web-dist `e205690` → site `dev` `aca9085`;
   verified on the Preview.

## Progress log

- [x] Steps 1–4 (2026-10-15). Tests: crate 74, app 336 (incl. image
      decode), engine-smoke `--patch` renders a Still image on Vulkan, gate
      behaviour suite incl. tests/patch-image.spec.ts, site playground spec
      (12, 3 skipped without WebGPU) + unit 23. In Chrome:
      two Still images (red, blue) each render their own picture (mask 6);
      the side-panel picker stores a 256×256 WebP; the Preview shows the new
      Time controls and the picker.
- [ ] Missing-node proposals from the same day (Map range, Mix/Clamp,
      Random, event tools, step sequencer, field math, colour adjust, undo /
      duplicate): waiting on Cameron's pick.

## Things not to do

- Never push the website's `master` (production stays dark). Gate `master`
  is fine; ask before a release tag.
