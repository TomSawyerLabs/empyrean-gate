# No hard cuts — every toggle ramps from zero

## Goal

From three idj captures (2026-09-02, one thought split across three dictations):

> "For the [Empyrean] gate we need … toggles to never toggle on immediately"
> "Everything should be a slider that starts on zero and slides on, so you never
> have jarring something-just-turns-on"
> "Even test modes"

Nothing that affects light output should snap on (or off). Every boolean toggle rides
a short envelope; the rig never pops.

## Environment / context

- Repo: `~/git/Personal Projects/Empyrean` (Empyrean Gate app, Rust engine in
  `src-tauri/src`, frame loop is `engine/mod.rs::run_frames`).
- `dt` is computed once per frame (`engine/mod.rs` ~1807); every existing envelope
  uses it. Existing fade idioms: one-pole (`x += (goal-x)*(dt/tau).min(1.0)`),
  exponential one-pole (`1-exp(-dt/tau)`), and linear-then-smoothstep (game fade,
  scene transitions, `eased_crossfade`).
- The engine **already renders the show underneath test mode** (output discarded
  while armed) and `eased_crossfade(outgoing, incoming, linear, out)` already exists
  and smoothsteps internally — so a true show↔test crossfade is nearly free.

## Decisions already made (don't re-ask)

- Fade times are constants (like `GAME_FADE_SECS`), not config knobs, until asked.
- Turning sACN output **off** stays instant — the Settings UI promises "goes dark
  immediately" and E1.31 termination packets are the point. Only turning **on** ramps.
- The self-update **handover must stay seamless**: when the successor adopts the
  predecessor's sACN sequence (`sacn_resume_pending`), the output-on ramp is skipped
  (env forced to 1.0) so a mid-show update doesn't dip the rig.
- `MasterDropDetector` (audio-drop blackout, tau 0.085 s) is deliberately fast —
  untouched.
- Test-mode blink/patterns stay binary while armed (they're hardware evidence);
  only arm/disarm crossfades.

## Plan / steps

1. [x] Survey every instant on/off path (Explore agent — see findings).
2. [x] Test mode arm/disarm crossfade (`test_mix` linear ramp, `eased_crossfade`
   between `normal_rgb` and the test frame; covers auto-exit disarm).
3. [x] Layer enable envelope (`layer_enable_env`, ~1 s linear + smoothstep,
   multiplied into opacity next to the walk env; newly added layers and boot start
   at 0 and fade in; transition-grown slots start at 1 so scene crossfades aren't
   double-faded; env carried across the scene-transition shift-down).
4. [x] Master brightness one-pole glide (Blackout quick-setting, slider jumps).
5. [x] sACN output-on fade-up from black (`output_env`, scale bytes into a scratch
   buf before `send_frame`; preview untouched; handover exempt).
6. [x] Master hue enable/amount glide (one-pole on `hue_amount`).
7. [x] Unit test for the extracted frame-scale helper.
8. [x] `cargo test --lib` green (238 passed, 0 failed); commit.

## Findings / gotchas

- Survey highlights (full detail in the exploration, engine `run_frames` spans
  1461–3580): test substitution at ~3114 was a whole-frame binary swap; layer
  `enabled` was `continue` — a one-frame vanish; `SetMaster` landed raw on the next
  frame; output enable popped the whole rig.
- `eased_crossfade` takes **linear** progress (smoothsteps internally) — don't
  pre-ease.
- Envelope vectors are index-addressed and get shifted down at scene-transition end
  (~1938) — `layer_enable_env` must join `layer_phases`/`layer_walks`/`layer_target`/
  `layer_env` in that shift and in the resizes (~2006).
- During a scheduled transition `render_layers` = outgoing ++ incoming, so the vec
  *growing* is ambiguous: growth while `render_transition_active` = scene change
  (default env 1.0), growth otherwise = AddLayer (default 0.0 → fade in).
- Disabled layers historically froze their phase (the `continue` skipped the phase
  update). Preserved: once fully faded out and `!enabled`, same early `continue`.
- The repo does not conform to default `cargo fmt` / `cargo clippy` (widespread
  pre-existing diffs and warnings in untouched files) — neither is an enforced
  check here; only new code was kept rustfmt-clean.
- The working tree is shared: a peer thread has uncommitted changes to README,
  protocol.rs, updater.rs and several frontend files (update-download-progress
  work). This task deliberately stayed inside `engine/mod.rs` + `testmode.rs` and
  staged only its own files.

## Progress log

- [x] idj notes read via agent API (`https://idj.isozilla.com`, token from
  `idea-du-jour/.claude/skills/idj-triage/.env.local`).
- [x] Codebase surveyed; implementation done in `engine/mod.rs` (+ testmode.rs
  module-doc touch-up, Settings.tsx hint).
- [x] Tests added: frame-scale helper, ramp step math.
- [x] Committed.
- [x] Commented back on the three idj items (left open for the user to verify on
  hardware and close).

## Things not to do

- Don't ramp output-off / E1.31 termination.
- Don't smooth inside `testmode.rs` render (frames are evidence); the fade lives in
  the engine's substitution site.
- Don't add a per-frame allocation on the sACN path — scratch buffers only.
- Don't touch `MasterDropDetector`/`AudioBrightnessFollower` taus.

## Follow-ups (not in this pass)

- Video layer start still pops on (`video_active` u32 gate in `gate.wgsl`); fading
  it needs a shader-side mix or an engine-side video-layer opacity env.
- Game start instantly zeroes effects/dabs (`game_suppress`) even though the world
  crossfades; could scale by `1 - game_mix` instead.
- Ready bus (off-air) layer toggles still pop in its preview — cosmetic only.
- Beat-taps enable, `SetConfig` full-replace paths (could call
  `request_render_transition()`), per-cue `transition_secs: 0`.
