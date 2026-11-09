# Beat phase lock: no jarring jumps at the beat wrap

## Goal

At Decompression (2026-10-19, v0.16.0) the Cathedral Pulse scene's orange edge
glow ("Gilded bell", a `beat_rings` layer) stuttered: from frame to frame the
ring snapped between the centre and the rim. The user asked for a fix at the
core, plus the defensive layers on top ("do it all").

Two independent causes turned out to produce that snap, and both are fixed:

1. **The walk dithered Direction across its threshold (most likely what was
   seen).** Beat Rings' Direction is a flag (`param_b` vs 0.5). Every default
   beat-ring layer sits exactly on 0.5, and BeatRings was missing from
   `LayerKind::discrete_params`, so the autopilot walk (`walk_amount` 0.08 on
   Gilded bell) crossed the threshold continuously and the ring flipped
   between expanding and contracting many times a second.
2. **The beat phase could step backwards across the wrap.** With a positive
   `latency_ms`, a late Pro DJ Link or MIDI clock packet pulls an
   already-wrapped extrapolation back across the wrap (0.01 → 0.96 → 0.01).
   Beat rings map phase to position, so that is also an edge ↔ centre snap.

## Environment / context

- Worktree: `C:/Users/camer/.t3/worktrees/Empyrean/phase-lock`, branch
  `phase-lock` off `origin/master` (12fff27).
- Phase sources:
  - Pro DJ Link / MIDI clock: `src-tauri/src/rhythm.rs` `snapshot()` extrapolates
    `beat_count + (age − latency)·bpm/60` from the last packet/tick and
    re-anchors on the next one.
  - Audio tracker: `crates/empyrean-patch/src/audio/analysis.rs`
    `BeatTracker::feed`. It only re-locks to early onsets (forward jumps) but
    updates at the ~43 Hz hop rate, so the phase is a staircase.
  - Manual BPM: integrated in the frame loop, already smooth.
- Consumer: `engine/mod.rs` `run_frames` builds `audio[i]: AudioUniform` per
  frame. The layer shader (`gate.wgsl`), the patch-graph runtime (`eval.rs`
  `audio` node), beat taps, UI beat events and game mode all read it.
- CI has no GPU: `engine-smoke` only proves the clean "No Vulkan adapter" error
  path there. GPU checks (the seam check) run locally; this machine's Intel UHD
  Vulkan adapter works.

## Decisions already made (don't re-ask)

- Core fix: a phase-locked follower (`engine/phase_lock.rs`) between the clock
  sources and `audio[]`. It never moves backwards. It bends its rate between
  0.75× and 1.5× the tempo with τ = 0.25 s, follows gaps over 0.3 beat at once
  (cue, loop, new track) and snaps on a clock or beat-time switch.
- Half-time locks modulo 2 beats so parity is part of the lock.
- Direction flags compare with `>= 0.5` (matching the walk's `floor` grid).
  Consequence: a flag at exactly 0.5 with the walk **off** now reads as the
  upper cell, the same as it already did with the walk on. SpokeChase and
  Meteors keep the look shows have had since August, and toggling the walk no
  longer flips them.
- Patch-graph `beat_rings` gets an `ends` select. `hold` is the default
  because Front defaults to 0 and an always-on fade would make a fresh node
  invisible. The four presets that wire `beat_phase` use `fade`.
- Beat hits rise over a couple of frames (`beat_hit` in gate.wgsl) rather than
  being allowlisted as intentional jumps. `SEAM_ATTACKS` exists but is empty.

## Plan / steps

1. [x] `PhaseLock` follower + `PhaseUnwrap` + unit tests (`d0f23ae`).
2. [x] Wire into `run_frames`; audio beat counts from unwrapping (`d0f23ae`).
3. [x] DJ Link beat count ignores stale status numbers (`2ded21f`).
4. [x] Step every quantized walked param; `>=` thresholds; shader-scanning
   unit test; layer beat-ring bloom/fade (`86cee12`).
5. [x] Patch `beat_rings` Ends option + presets (`aff03e3`).
6. [x] `engine-smoke` seam check (layers + DJ Link overlay); Breathe and the DJ
   master fan made continuous (`48d8f7c`).
7. [x] README, PR.

## Findings / gotchas

- The `beat_rings` shader and `rhythm.rs` were unchanged between v0.16.0 and
  12fff27: both causes were still live on master.
- A Pro DJ Link source with **zero** latency doesn't straddle the wrap
  backwards: a late packet steps 1.02 → 1.00 and an early one jumps forward.
  The backwards straddle needs `latency_ms > 0` and a packet later than that
  latency. The test source models 5 ms latency and ±20 ms jitter. ±8 ms was
  hidden by 60 fps frame sampling.
- The follower tracks each beat's packet offset; it doesn't average it away.
  Doing so would need τ ≫ one beat and would make real tempo drift settle
  slowly. The test asserts only that it is never further from the true beat
  than the source is.
- DJ Link `beat_count` came from the 5 Hz status packet's beat number, which
  races the beat packet, so it was stale by one beat about half the time. That
  was harmless in normal time and flipped parity in half-time.
- Seam check results on Intel UHD (mean |Δ| per channel, wrap vs mid-beat):
  BeatRings 5.05 vs 6.51, Breathe 37.0 vs 2.0 before and 4.0 vs 2.0 after, DJ
  Link overlay 0.68 vs 0.00 after. Every other layer reads 0.00 for both: they
  don't use the beat phase with default params.
- Shell heredocs mangle `\\n\\` (Rust string continuations) passed through
  Python; use a script file (see the memory note on big Python edit scripts).

## Progress log

- [x] Diagnosis
- [x] All steps above. `cargo test --release --lib --bin engine-smoke`:
  376 + 6 pass. `empyrean-patch`: 172 pass. `engine-smoke` default and
  `--seams` pass on the local GPU.

## Open questions for the user

None. The walk-off 0.5 direction change was approved on 2026-11-09. It is
unknown which clock source and `latency_ms` were in use at Decompression; the
walk-dither cause doesn't depend on either. Left to the user: merging PR #9.

## Things not to do

- Don't "fix" the phase with a plain low-pass: a low-pass on a sawtooth smears
  the wrap itself and lags the beat. The follower predicts forward at the tempo
  and corrects by bending the rate.
- Don't compare walked params with a strict `>` in gate.wgsl. The unit test
  rejects it, because 0.5 then lands in different cells with the walk on and
  off.
- Don't allowlist a beat hit in `SEAM_ATTACKS` when a two-frame rise
  (`beat_hit`) gives the same punch.
