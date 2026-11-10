# Guardrail modes: Guided, Standard, Expert

## Goal

The user, 2026-11-09, replying to the no-hard-cuts amendment:

> "I don't like the 'rules'. I'm thinking more the app has 2 or 3
> modes/guardrails. Beginners need guardrails so that it doesn't go bad.
> Advanced users need no guardrails so they can explore the limits of
> expression. Some users might like a nice in-between."

Answers to the design questions (2026-11-09):

- **Levels:** three of them. "Can the expert mode add d/dt control limits on a
  per-slider way?"
- **Scope:** per device.
- **Blackout:** "blackout is a show button. not safety."
- **What Guided limits besides fades:** narrower ranges, and scene changes never
  cut.

So the fades in `plans/no-hard-cuts.md` stop being fixed policy. They become what
a device's guardrail level turns on.

## Environment / context

- **Worktree:** `C:/Users/camer/.t3/worktrees/Empyrean/guardrail-modes`.
- **Branch:** `guardrail-modes`, stacked on `instant-blackout` (PR #10: master
  brightness made instant, `5ee512e`).
- **Exploration map (file:line):**
  - **Device id:** `ws.ts:140`, `localStorage empyrean-client-id`, sent in
    `Hello`. `handle_msg(ctx, msg, client_id, …)` at `server.rs:2189` has it.
  - **Per-device server record:** `ClientRecord {id, name, revoked, admin}`
    (`config.rs:412`), broadcast as `ClientInfo` (`protocol.rs:625`).
  - **Writes:** every operator write goes through `state.update_config`
    (`state.rs:1368`). Nothing records who made a change.
  - **Messages that write controls:**
    - `SetMaster` (`server.rs:2471`)
    - `SetMasterHue` (`:2488`)
    - `UpdateLayer` (`:2699`). It replaces the whole layer, so diff old and new.
    - `SetConfig` (`:2418`). A full replace.
    - `ActivateStack` / `TakeReady` (`:2509`, `:2528`) use
      `render.manual_transition_secs`, read at `engine/mod.rs:2180`.
  - **Engine per-layer loop:** `engine/mod.rs:3063-3137`.
  - **Per-layer vectors:** `layer_phases`, `layer_walks`, `layer_target`,
    `layer_env` and `layer_enable_env`. They are index-addressed, resized at
    about `:2626`, shifted at transition end (`:2555`) and swapped at the
    ready take (`:2232`).
  - **Client sends:** throttled to about 10 Hz (`useThrottled`,
    `state.tsx:201`). The engine sees fader drags as 10 Hz steps.
  - **No shared slider component.** The three wrappers are `Settings.tsx:1383`
    `Slider`, `LayerQuickEdit.tsx:34` `QuickSlider` and `ReadyLayerEditor.tsx:30`.
    The master clusters are in `Live.tsx` (~534-626) and `Control.tsx`
    (~253-287).

## Design

**One mechanism:** every continuous control has a **rate limit** (its d/dt cap,
in units per second; none means instant). The engine moves each rendered value
toward its config value no faster than that. A level is a preset of rate limits,
plus Guided's range clamps and minimum scene transition.

**Attribution:** the rate that applies is the rate of whoever last wrote that
control. The server keeps a map from control (master field, or (layer index,
field)) to rate. `handle_msg` fills it from the sender's level before it
writes. Changes with no device behind them (scheduler, performance replay) use
the Standard rates. Structural layer edits (add, remove, move) clear the
per-layer entries and snap the engine's slew state: a reorder is not a slider
move.

**Levels** (the starting numbers, tuned in code):

- **Guided:**
  - Master brightness: a full swing in 0.25 s. Blackout fades this fast.
  - Layer toggles: 1 s.
  - Every other slider: a full swing in about 0.5 s; hue in 2 s.
  - Narrower ranges, server-enforced: master speed 0.25–2, layer speed ±2,
    scale 0.25–3, layer brightness ≤ 1.25, walk depth ≤ 1.5, walk speed
    0.25–2.
  - Scene changes take at least 1.5 s.
- **Standard** (the in-between, and today's behavior):
  - Patterns fade: layer toggles take 1 s, master hue glides.
  - Live controls are instant: master brightness (so Blackout), master speed,
    floor level, and layer sliders.
- **Expert:**
  - Nothing is limited by default: layer toggles cut and hue snaps.
  - Per-slider rate limits the Expert sets for their own device, stored on that
    device's `ClientRecord`.

**The same in every mode:**

- Correctness fixes are not guardrails: the beat phase lock and the stepped
  walk params (`plans/beat-phase-lock.md`).
- The automatic fades: sACN output-on fade-up, video start, test-mode
  crossfade, the walk envelope, and scheduled scene transitions.

## Decisions already made (don't re-ask)

- **Three levels, per device.** New devices start at Standard, so nothing
  changes for existing rigs.
- **Blackout is always instant** (user, 2026-11-09: "blackout should always be
  instantaneous"), on press and on release. Quick-setting shortcuts send
  `SetMaster { instant: true }`, which notes a no-limit rate whatever the
  device's level; the device's ranges still apply. The master *fader* still
  glides in Guided.
- **No level lock** (user: "no. or, not yet"). Any device may change its own
  level.
- **Rate limits** (linear d/dt), not time constants: the user asked for d/dt.
- **Per-slider custom limits apply in Expert only.** The other levels are fixed
  presets.

## Plan / steps

1. [x] `src-tauri/src/guardrails.rs`:
   - `Level`, `Control` (master fields and layer fields), the rate table per
     level, Guided ranges, `GuardrailCfg {level, rates}`.
   - A slew helper that handles hue wrap.
   - Unit tests.
2. [x] Config and protocol:
   - `ClientRecord.guardrail` (serde default).
   - `ClientInfo` carries it.
   - `SetClientGuardrail` for the device itself, and for the local operator on
     any device.
3. [x] Attribution:
   - A writer-rate map on `SharedState`.
   - `handle_msg` fills it for `SetMaster`, `SetMasterHue`, `UpdateLayer`
     (diff), `SetConfig` (diff) and the layer structure messages.
   - Guided range clamps on those writes.
4. [x] Engine:
   - Slew master brightness, speed, floor, hue amount and the layer fields per
     frame using the map.
   - The layer enable envelope uses the writer's toggle rate.
   - The slew state joins the per-layer vector bookkeeping, and snaps on a
     structural change or a kind change.
5. [x] Guided minimum scene transition for `ActivateStack` / `TakeReady` from a
   Guided device.
6. [x] Frontend:
   - Level picker for this device (Settings), and level shown in the roster.
   - Guided ranges on the master clusters and the layer slider wrappers.
   - Expert per-slider rate editor.
7. [x] README, `plans/no-hard-cuts.md` points here, tests, `engine-smoke`,
   frontend typecheck/tests, commit, PR (base `instant-blackout`).

## Findings / gotchas

- Ready-bus edits (`PrepareStack`) are not clamped on the server; only the UI
  narrows them. Saved scenes keep their own values when a Guided device plays
  them. The ranges limit what a Guided device *dials in*, not what it may play.

- Fader drags reach the engine as 10 Hz steps (client throttle). In Expert,
  with no limit, that stair-step is visible on the rig. This existed before;
  candidate follow-up: interpolate across one throttle interval in transport,
  separately from guardrails.
- Index-addressed per-layer state is already misaligned after a remove or move
  (pre-existing). The new slew state snaps on structure changes instead of
  inheriting a neighbour's values.

## Progress log

- [x] Master brightness instant (PR #10). This is the Standard and Expert
  behavior.
- [x] Design agreed (answers above).
- [x] Steps 1–7 (`b127b4d` backend, then the UI and docs commit).
  - `cargo test --release --lib`: 373 passed. `bun run typecheck`: clean.
  - **End-to-end check** against a headless release backend on :9541 with an
    isolated config. Script: `guardrail-e2e.ts` in the session scratchpad. It
    confirmed:
    - A device can set its own level.
    - Guided clamps master speed 4 → 2 and layer scale 5 → 3.
    - The local operator can set another device's level, and Expert rates are
      stored.
    - Expert is unclamped.
  - `bun run test:unit`: 201/202. The one failure is `patch core` missing
    `wasm/patch.js`, which this fresh worktree hasn't built. That is
    environment, not this change.
- [ ] Watch it on the rig: Guided Blackout fade, Expert per-slider limits.

## Open questions for the user

None. (A level lock was declined for now, 2026-11-09.)

## Things not to do

- Don't put guardrail checks only in the UI: the server clamps, because Guided
  must hold whatever client sends.
- Don't slew structural layer edits (add, remove, move) across slots: snap.
