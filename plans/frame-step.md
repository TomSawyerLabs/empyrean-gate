# Frame by frame: pause, step, and (opt-in) step back

Status: **in progress** (branch `frame-step`, worktree
`~/.t3/worktrees/Empyrean/debug-node`, from gate master `0490c12`).
Follows `plans/debug-node.md`.

## Goal

Cameron (2026-10-21), after the Debug node: "should we add a frame by frame
mode?" then "go for it. can we have an opt-in feature that enables saving
past frames to be able to step backwards on systems that can handle it?"

Minis and Debug views sample at 10 Hz while the patch runs at ~60, so what
happens inside a frame (a one-frame event, Random's every-frame value, a
Threshold chattering) can't be seen. Pause the patch, step it a frame at a
time, watch every view change; and, when the person opts in, keep the last
N seconds of frames so they can step backwards too.

## Decisions already made (don't re-ask)

- **Browser runtime steps for real; the gate only freezes.** The gate runs
  one patch for the real lights: pausing it from the Patch tab would freeze
  the show. There, "pause" freezes the editor's minis and Debug views (the
  lights keep running) (my recommendation, Cameron: "go for it").
- **Step back is opt-in** ("Keep past frames", off by default), with a
  length the person picks and its memory cost shown. Past frames are
  *recordings*, not re-simulations: patch state (timers, walks, envelopes,
  Trails) can't run backwards, and a live mic or camera can't be replayed.
  Play from a past frame goes back to the live frame.
- **No agent tools for it**: `snapshot` already pauses and steps.

## Design

Shared editor (`packages/patch-web/src/editor`):

- `FrameTransport` (transport.ts), the host's side: `canStep` (the browser
  runtime) or freeze only (the gate); `state()` (paused, frame, time,
  `back`: frames behind live shown, `kept`: past frames available,
  `keepSeconds`); `pause`, `play`, `step(n)` (negative: back), `setKeep
  (seconds)` → error text or null, `keepCost(seconds)` → bytes.
- A transport bar on the canvas (bottom centre): ⏸/▶, ◀ ▶ step (Shift: 10),
  frame and time, "N back", and a Keep past frames menu (Off, 2, 10, 30,
  60 s with the cost; choices over a quarter of `navigator.deviceMemory`
  disabled). Keys: K play/pause, `,` `.` step (Shift ×10). The choice is
  remembered in localStorage (`empyrean-keep-frames`).
- The status dot shows "Paused" instead of a stall while paused.

Browser runtime (`runtime/index.ts`, `runtime/history.ts`, `gpu.ts`):

- `paused`: the rAF loop keeps running but only redraws the views (so a
  resize or a shown past frame still draws). Host `start`/`stop` stay as
  they are, independent of it.
- `step(n)` forward at the live frame: n frames of 1/60 s, each rendered,
  with the minis refreshed and a meter sample per frame.
- A paused edit (knob, wire) re-renders the live frame with dt 0, so the
  change shows without time moving; Feedback stays right because the frame
  before it is put back first.
- `FrameHistory`: a GPU ring of frames (LED frame + preview cells, GPU→GPU
  copies each frame, chunked under `maxBufferSize`) and a CPU ring of meter
  values, frame numbers and times. Always at least 2 slots (the live frame
  and the one before, for the paused re-render); the person's choice adds
  more. A shader change (new preview layout) clears it. With history on, the
  preview dispatch runs every frame instead of every 100 ms.
- Showing a past frame copies it into the view's buffer and the preview
  buffer, reads the cells back and rebuilds the meters from the recorded
  values; going live copies the live frame back.

Gate app (`src/miniPreview.ts`, `src/Patch.tsx`): `MiniHub` freezes (holds
cells and meters) and, with Keep past frames on, keeps the last N seconds
of batches (10 a second) to step through.

## Plan / steps

1. **Done** (`26a6477`). Runtime + GPU history + transport interface.
2. **Done** (`157cb21`). Editor transport bar, keys, status "paused"; demo.
3. **Done** (`37eb77c`). Gate: MiniHub freeze + kept batches, Patch tab.
4. **Current.** README (gate, patch-web), push gate master; site: pass
   `transport` to the editor after the web-dist bump, README, push `dev`,
   check the Preview.

## Findings / gotchas

- `finish()` (patch_lib.wgsl) moves `OUT[idx]` into the second half before
  writing the new frame (Feedback's frame N−1). Anything written into the
  first half (a past frame shown) must be put back before the next real
  frame, or Feedback sees the wrong previous frame.
- The status heartbeat (`PatchStatus.beat`, STALL_MS) reads "no frames" as
  stalled; a pause must say so instead.
- **Feedback reads the frame two back** (the second half of OUT before
  `finish` moves the first into it): rendering a paused frame again only
  matched once *both* halves were put back (frames 1 and 2 behind live), so
  three frames are always kept. Logged in ISSUES.md as its own bug.
- `transport.ts` and `Transport.tsx` collide on Windows (case-insensitive):
  the bar is `TransportBar.tsx`.
- GNU sed in Git Bash rewrites CRLF files as LF; edit with the CRLF-keeping
  script instead (content is unaffected, Git normalizes).
- In the demo the bar's keys go to the Keep select while it has focus (by
  design, it is a field); it now blurs after a choice.
- The demo tab in Chrome ran at a few fps (backgrounded by the extension),
  so frames in it don't match wall time; the browser spec steps at 60 Hz.

## Progress log

- [x] Step 1: browser/frames.spec.ts (5) on SwiftShader WebGPU: one frame
      per step and nothing else; kept frames byte for byte; play goes live;
      paused edit of a Feedback patch identical; per-frame meters.
- [x] Step 2: checked in Chrome (demo): K pauses, Shift+. steps 10, `,`
      back, "3 back", per-frame Debug meters, status "paused".
- [x] Step 3: src/miniPreview.test.ts (3), tests/frame-step.spec.ts; gate
      test:behavior 181 passed, layout 136 passed, test:unit 231.
- [ ] Step 4

## Open questions for the user

1. (from plans/debug-node.md) Full-resolution Debug rings: still open.

## Things not to do

- Don't pause the gate's engine from the editor: it is the show.
- Don't re-simulate to go back (restart and replay): exact only with the
  stand-ins, wrong with a mic or camera.
- Don't push site `master`.
