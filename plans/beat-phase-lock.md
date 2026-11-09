# Beat phase lock — no backwards steps across the beat wrap

## Goal

At Decompression (2026-10-19, v0.16.0) the Cathedral Pulse scene's orange edge
glow ("Gilded bell", a `beat_rings` layer) flickered: from frame to frame the
ring snapped between the outer edge and the center. Cause: the beat phase every
layer reads sometimes steps *backwards* across the 1.0 → 0.0 wrap (0.98 → 0.01 →
0.99 → 0.02), and `beat_rings` maps phase 0 to "bright ring at the edge" and
phase ≈ 1 to "dim ring at the center". The user asked for the fix at the core
plus the defensive layers on top ("do it all").

## Environment / context

- Worktree: `C:/Users/camer/.t3/worktrees/Empyrean/phase-lock`, branch
  `phase-lock` off `origin/master` (12fff27).
- Phase sources (all non-monotonic today):
  - Pro DJ Link / MIDI clock: `src-tauri/src/rhythm.rs` `snapshot()` extrapolates
    `beat_count + age·bpm/60` from the last packet/tick, then re-anchors on the
    next one. A late packet means the estimate already wrapped, then gets pulled
    back. `latency_ms` defaults to 0, so the re-anchor lands exactly on the wrap.
  - Audio tracker: `crates/empyrean-patch/src/audio/analysis.rs` `BeatTracker::feed`
    re-locks to an onset up to 20 % of a period after the predicted beat — a
    backwards step of up to 0.2. Updates only at the ~43 Hz hop rate.
  - Manual BPM: integrated in the frame loop, already smooth.
- Consumer: `engine/mod.rs` `run_frames` builds `audio[i]: AudioUniform` per
  frame (`beat_phase: effective_beat_phase(base_phase, base_count, beat_time)`).
  Both the layer shader (`gate.wgsl`) and the patch-graph runtime (`eval.rs`
  `audio` node → `beat_phase`, `beat` event) read that same array, as do beat
  taps, UI beat events and game mode.
- Beat counting: `raw_beat_count` (audio sources) counts a beat whenever phase
  drops by > 0.5, so a backwards straddle double-counts, which flips half-time
  parity (a half-cycle jump in Half beat-time).
- CI has no GPU: `engine-smoke` only proves the clean "No Vulkan adapter" error
  path there. GPU checks run locally.

## Decisions already made (don't re-ask)

- Fix at the core with a phase-locked follower between the clock sources and
  `audio[]`, not per-shader patches. The follower never moves backwards.
- Lock modulo a quantum: 1 beat normally, 2 beats in Half beat-time (so the
  half-time parity is part of what is locked).
- Large errors (cue / loop jump / new track) jump straight to the source — the
  music itself cut there. Small errors are absorbed by bending the tempo.
- Source switches (manual ↔ external ↔ audio, beat-time change) snap.
- Shader defence in depth: `beat_rings` (layer and patch node) gets a short
  bloom-in at the start of the beat, so even a bad phase can't pop a full-bright
  ring at the edge for one frame.
- A seam check in `engine-smoke` renders every layer kind just before and just
  after the wrap and flags large jumps; intended beat attacks (kick flashes) are
  an explicit, commented allowlist.

## Plan / steps

1. [ ] `PhaseLock` follower (new `src-tauri/src/engine/phase_lock.rs`) + unit tests.
2. [ ] Unwrap audio/manual phase into a continuous beat total (fixes the
   double-count) and wire the follower into `run_frames`.
3. [ ] `beat_rings` bloom-in: `gate.wgsl` case 9 and `codegen.rs` patch node.
4. [ ] `engine-smoke` seam check (default run + `--seams`).
5. [ ] cargo test, engine-smoke locally, commit, PR.

## Findings / gotchas

- The `beat_rings` shader and `rhythm.rs` are unchanged between v0.16.0 and
  12fff27: the bug as seen in October is still live on master.

## Progress log

- [x] Diagnosis (see Goal).

## Open questions for the user

(none)

## Things not to do

- Don't "fix" it by smoothing the phase with a plain low-pass: a low-pass on a
  sawtooth smears the wrap itself and lags the beat. The follower must predict
  forward at the tempo and correct by bending the rate.
