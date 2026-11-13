# Frame spikes and dead-layer skipping

## Goal

The VJ needs to see, before the rig glitches, that the engine is struggling.
The existing **load** sparkline (Live ring, Control meters) shows average render
load, but a benchmark showed the glitches are **frame-time spikes**, not average
load, and that layer count barely matters. So:

1. Show spikes: worst frame per second and missed frames, next to load.
2. Find where in the frame loop the spikes come from.
3. Cheap, correct skips for layers / frames that can't contribute
   (opacity 0, master 0, brightness 0 in additive blends).

## Environment / context

- Frame loop: `src-tauri/src/engine/mod.rs`, `run_frames`. Pacing at the
  "Pace the loop." comment (sleep to 2 ms before deadline, then spin);
  `dt` = real frame interval.
- Old load metric = only `render_with_urgency` (program dispatch + readback).
  It did NOT count the Ready bus render, mini bus, outgoing (handoff) bus,
  CPU prep, sACN send or status assembly.
- Status struct: `src-tauri/src/protocol.rs` (`RuntimeStatus`), TS mirror in
  `src/types.ts`. Meters: `src/Sparkbars.tsx`, used in `src/Live.tsx`
  (ring-meters) and `src/Control.tsx` (meter-stack). Banner: `LoadBanner` in
  `src/App.tsx`.
- Bench: `cargo run --release --bin engine-smoke -- --layers N --frames 300`
  (from `src-tauri`). First release build takes >10 min; run it in the background.

## Decisions already made (don't re-ask)

- User approved (2026-11-13): do (1) spike readout + spike diagnosis and
  (2) the opacity/master/brightness skips. Per-layer cost readout only if the
  show machine shows expensive layer kinds.
- "Static frame" reuse not pursued: phases advance every frame, so identical
  inputs are rare.

## Findings / gotchas

- Bench (`engine-smoke`) on this machine (Intel, 24,192 px, 300 frames),
  2026-11-13: median 1.27 ms @1 layer, 1.86 @8, 2.32 @16 → ~0.07 ms/layer.
  Misses over 16.7 ms: 32/300 @1 layer, 14 @4, 8 @8, 0 @12, 16 @16. They
  don't track layer count.
- **The real engine doesn't show those spikes.** Release backend, headless,
  this machine, 2026-11-13 ~10:30 AM PST (18:30Z):
  - Default stack, no clients: load 2–3 %, 0 hitches in 90 s, worst 18.2 ms.
  - All 12 layers on, a 60 fps full-res preview with acks, minis subscribed:
    load 2–4 %, 0 hitches in 90 s, worst 17.9 ms (program 0.2 ms, minis
    0.3 ms, 1.2 ms late wake).
  - So the bench's spikes come from its own harness (likely its synchronous
    readback), not the engine. The engine has huge headroom here; field
    stutter seen before was display hot-plug / GPU reset (already bannered).
- The first loop frame's "interval" is engine start-up (343 ms seen). It is
  now ignored (`9cfbeb1`).
- Brightness 0 is NOT a no-op for every blend: Multiply and AlphaOver with
  rgb 0 paint black. Only Add/Screen/Max skip it. Video and the BRC maps draw
  ink that isn't scaled by brightness, so they never skip. Opacity 0 is the
  identity for every mode.
- Master-0 skip rejected: readback runs one frame behind, so skipping the
  dispatch would flash a stale frame when master comes back up, and time
  saved during a blackout can't prevent a visible glitch.
- `bun test src` failures in packages/patch-web = stale gitignored
  `packages/patch-web/wasm/` → `bun run build:wasm` there.

## Plan / steps

1. [x] Skips: opacity-0 and brightness-0 (additive) layers off Program and
   Ready dispatch (`9189b6c`).
2. [x] Frame-loop stage timing; load counts the whole loop; per-second
   hitches + worst frame; slowest-frame breakdown and rate-limited log
   (`3f9ce37`, `9cfbeb1`).
3. [x] Hitches meter on Live + Control, slow-frame line on Control, Patch
   status card, banner text (`3f9ce37`).
4. [x] Real backend run, results above.
5. [x] README.
6. [ ] Next time on the show machine: watch the hitches meter and the
   "slow frame:" log lines; if it hitches, the breakdown names the stage.
   Run `engine-smoke --layers N` there too, and only build a per-layer cost
   readout if some layer kinds turn out expensive.

## Progress log

- [x] Benchmark layer scaling.
- [x] Skips, instrumentation, UI, tests (394 Rust lib, 240 unit, load-banner +
  layout Playwright on Chromium).
- [ ] Show-machine check (step 6), needs the machine.

## Open questions for the user

(none)

## Things not to do

- Don't add a per-layer meter on the strength of this machine's numbers.
- Don't trust `engine-smoke` tail latencies as engine behaviour (see above).
- Don't junction node_modules into a temp worktree and then remove the
  worktree: the delete follows the junction (emptied node_modules once).
