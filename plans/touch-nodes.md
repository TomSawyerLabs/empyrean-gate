# Touch as patch nodes

Status: **in progress** (branch `patch-crate`, worktree
`C:\Users\camer\.t3\worktrees\Empyrean\playground`). Companion to
`plans/node-graph.md`; the browser side is the empyreangate.org playground
(`plans/pattern-playground.md` in that repo).

## Goal

Cameron (2026-10-15): "the 'taps' need to have their own representation in the
nodes. I want users to be able to define their own touch interactions
entirely. this should be true in the web editor and the real gate."

A patch decides what a finger does. Raw touches (which finger, down / move /
up, where, how long held, how fast, whose color) reach the graph as nodes, and
a patch that uses them owns the touch surface: no built-in tap effect or pen
is applied on top.

## What exists today (2026-10-15)

- Touch reaches the engine only as `trigger_effect` (a finished effect at a
  position) or `paint` (pen dabs). No pointer id, no release, no hold, no
  velocity, no pressure, no per-client identity (GateCanvas keeps pointer ids
  local; `DabPoint` is `{angle, radius, dir}`).
- The `tap` node fires on any `effect_seq` advance: no position, no source.
- Ownership precedent: wiring `render_points` / `render_effects` to the output
  turns off that stream's automatic overlay (`codegen.rs`, `finish()`).
- Public floor: per-connection token bucket (40 msg/s), allowlist by message
  kind (`draw`, `effects`, `games`), clamps on size/count.
- Games turn canvas taps into `game_input`; effects and dabs are suppressed
  while a game runs.

## Design

### Input: a raw touch stream

- Client message `touch { points: [{ id, phase: "down"|"move"|"up", angle,
  radius }], hue, saturation, brightness }`. `id` is the client's pointer id;
  the server namespaces it by connection, so fingers from different phones
  never collide. Moves are batched (33 ms, like paint); downs and ups are sent
  immediately so short taps are never lost.
- `empyrean_patch::touch::Touches` (pure, shared by engine and browser):
  active fingers keyed by `(source, id)`, each with position, down time and
  position, velocity (smoothed), color, and a release time. Released fingers
  linger for a fade window (2 s) so fields can fade them out, then drop. Cap
  32 fingers (oldest released first, then oldest active). Per frame it reports
  the downs and ups that happened since the last frame (counters, so a
  down+up inside one frame is still a tap).
- GPU: `GpuTouch` records in a new storage buffer, **binding 10** (9 is the
  game grid), plus `touch_count` appended to `Globals` (both WGSL copies).
  Record: angle, radius (physical, like dabs), age since down, age since up
  (negative while held), hue/sat/bright, speed, dir.

### Nodes (registry, so both editors get them)

- **Touch** (`touch`, CPU, Input): which finger it follows is a Select —
  *Latest* (most recent down), *First* (longest held), *Any* (aggregates).
  Outputs: `down`, `up` (Event); `active`, `count`, `angle`, `radius`, `x`,
  `y`, `held` (s), `speed`, `dir`, `hue` (Scalar). With *Any*, `down`/`up`
  fire for every finger and the position outputs follow the latest one.
  Wire `down` → Event effect `trigger`, `angle`/`radius`/`hue` into its knobs,
  and a tap becomes any effect at the finger.
- **Touch mask** (`touch_mask`, GPU, Field<f32>): every finger at once as a
  soft blob. Params: radius, softness, fade (s after release), grow (radius
  growth per second held), trail (how far the blob stretches back along the
  finger's motion).
- **Touch glow** (`touch_glow`, GPU, Field<color>): the same blobs in each
  toucher's own color.

### Ownership

A patch containing any touch node **owns touch**. The engine reports it in
status (`patch_touch: true`) and every canvas surface (Live, public floor,
playground) switches from its tap/pen tool to raw touch while that patch is on
air. Effect pads, buttons and keys keep working (they are not touches). Games
still take the canvas while they run.

### Public floor

Raw touch needs its own allowlist entry (`touch`, default on wherever `draw`
is), the same token bucket, at most 64 points per message and 5 active fingers
per connection.

## Decisions (made by Claude, 2026-10-15; reopen if wrong)

- Ownership by presence of a touch node, mirroring the render_points rule,
  rather than raw touches always flowing alongside the built-in tools: "define
  their own touch interactions entirely" rules out a tool firing too.
- The old `tap` node stays (it means "an effect was triggered", still useful
  for pads) and is relabelled **Effect taps**.

## Plan / steps

1. **[current]** Crate: `touch` module (Touches tracker, GpuTouch,
   limits), Globals `touch_count`, registry nodes, evaluator for `touch`,
   codegen for `touch_mask` / `touch_glow`, patch_lib.wgsl Touch struct +
   binding 10, `uses_touch(doc)`, Sim integration, tests.
2. wasm + patch-web: `touch()` input, binding 10, `usesTouch`.
3. Engine: buffer + binding 10 in the shared layout, gate.wgsl Globals field,
   SharedState touches, protocol `Touch`, LAN server, public server
   (allowlist, clamps), status `patch_touch`.
4. UI: GateCanvas raw-touch mode (ids, down/move/up); Live and public floor
   switch to it when `patch_touch`.
5. Preset "Touch ripples" that rebuilds today's tap-burst in-graph plus a
   finger-glow layer.
6. Playground: raw touch when the patch uses touch nodes; rebuild web-dist;
   site dependency bump; push `dev` (never `master`).
7. Docs (README, node-graph plan), tests across the board.

## Progress log

- [x] Survey of today's touch flow (2026-10-15)
- [ ] Steps 1–7

## Things not to do

- Don't push `master` in either repo (Cameron, 2026-10-15). Gate work stays
  on `patch-crate`; the site ships via `dev`.
- Don't put pointer identity into effects/dabs; raw touch is its own stream.
