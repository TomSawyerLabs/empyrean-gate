# Node-graph pattern paradigm ("patches")

## Goal

Replace-over-time the fixed layer stack with a visual node-graph editor (TiXL /
TOOLL3 / Node-RED style): chain generators, transforms, inputs (touch, audio, IMU),
and combiners into a dataflow graph whose sink is the sACN pixel array. Graphs
("patches") save/load as local files and are themselves composable as nodes
(sub-patches). Focus is sACN pixel output, not screens.

## Vocabulary

- **Patch** — one saved graph (file). The active patch is what renders.
- **Node** — one operator instance with typed input/output **ports**.
- **Shape** — the data type flowing on a wire (see below).
- **Sub-patch** — a patch with exposed inputs/outputs, usable as a node in
  another patch.

## Data shapes (the type system)

Small, closed set. Wires only connect matching shapes (plus a few blessed
auto-adapters, e.g. Scalar→Field via "constant field", Field<f32>→Field<color>
via colorize-default).

| Shape | Lives on | Examples | Notes |
|---|---|---|---|
| `Scalar` | CPU, per frame | bass energy, beat phase, slider, LFO, IMU tilt | f32 at control rate (frame rate). The cheap glue. |
| `Event` | CPU | beat, tap, key press, effect trigger | discrete, with payload (position, intensity). Drives envelopes/one-shots. |
| `Field<f32>` | GPU (virtual) | masks, height maps, noise | a *function* over the polar domain (angle, radius) — NOT a materialized buffer. Compiled into WGSL inline. |
| `Field<color>` | GPU (virtual) | every current layer kind's output | same, RGB(A). |
| `Points` | GPU buffer | dabs, meteors, particles, touch trails | bounded array of structs (pos, age, hue, size, dir). |
| `Texture` | GPU buffer | video frames, feedback buffers | materialized 2D RGBA. Only shape that costs memory/passes. |
| `Pixels` | GPU buffer | the sink | final per-pixel RGB for the fixture map → sACN + preview. |

"Screens / 2d arrays / point clouds" from the idea map to `Texture`, `Field`,
`Points` respectively. The key TiXL-style insight: **fields stay symbolic** —
a chain of field nodes compiles to one WGSL expression, keeping today's
single-dispatch, zero-state-per-frame model. Only `Texture` nodes (feedback,
video, blur-with-history) materialize.

## Execution model — two rates, one boundary

1. **Control-rate graph (CPU, interpreted)**: Scalar/Event nodes evaluated every
   frame in topo order in the engine thread. Cheap (hundreds of nodes fine).
   This is where LFOs, envelopes, math, smoothing, beat logic, autopilot walk
   live. Outputs that feed GPU nodes land in a **uniform slab** (one `array<f32>`
   binding, index per edge).
2. **Pixel-rate graph (GPU, compiled)**: Field/Points/Texture nodes are
   **transpiled to WGSL** at edit time. Param edits that don't change topology
   just rewrite the uniform slab (no recompile). Topology edits regenerate WGSL
   and rebuild the pipeline through the *existing* error-scope validation path
   (same machinery as shader hot-reload — bad graph surfaces as UI error, old
   pipeline keeps rendering).

This matches the current architecture exactly: audio features already flow
CPU→uniform→GPU. We're generalizing "hardcoded uniforms + switch on kind" into
"generated uniform slab + generated composite expression".

## Node inventory (initial)

- **Sources (Field<color> / Field<f32>)**: all 20 existing layer kinds become
  generator nodes — their WGSL bodies are already isolated functions, reused
  nearly verbatim. Plus Constant, Gradient, SolidColor.
- **Inputs**: AudioFeatures (per source: level/bass/mid/treble/onset/beat →
  Scalars + Event), Waveform/Spectrum (existing SCOPE binding), TouchDabs
  (→ Points), Tap/Key (→ Event), IMU (→ Scalars), Time, Slider (exposed as a
  live control), XYPad (→ 2 Scalars, touch surface).
- **Scalar ops**: math (+ − × mix clamp map-range), Smooth (1-pole), LFO,
  EnvelopeAD (Event→Scalar), BeatDivider, SampleHold, Walk (autopilot OU node).
- **Field ops**: Transform (rotate/zoom/mirror/kaleido — today's video
  treatment, now applicable to *anything*), Colorize (hue/palette),
  FieldMath (add/mul/screen/max/mix/threshold), Mask.
- **Points ops**: RenderPoints (Points→Field via pen-style kernels — today's
  dab renderer), ParticleSim later.
- **Combine**: Blend (the 5 existing modes + opacity), Crossfade
  (Scalar-driven), Switch.
- **Texture**: VideoIn (existing binding), Feedback (ping-pong, decay/zoom —
  unlocks classic video-feedback looks), TextureSample (Texture→Field).
- **Sink**: Output (Field<color> → Pixels, master brightness, tonemap — exactly
  one required per patch).
- **Sub-patch**: any saved patch with exposed ports.

## Files & composability

- Patches are JSON files in `<config-dir>/patches/*.json` (+ embedded presets in
  the binary). `format: 1` version field from day one.
- File = `{ format, id (uuid), name, nodes: [{id, type, params, pos}], edges,
  exposed: [{port, label, kind}], meta }`.
- A patch that declares `exposed` ports appears in the node palette as a block —
  **the file is the unit of composition** (answer to "could they be composable
  blocks themselves": yes, by construction). Sub-patch references are by uuid
  with name fallback; cycles rejected at load.
- Config gains `active_patch`; live edits autosave (matching "no save button"
  UX), with explicit Save-As for presets. Patch switching = crossfade later.
- WS protocol additions: `PatchList`, `PatchGet`, `PatchSave`, `PatchDelete`,
  `PatchActivate`; later `NodeValues` (streamed live scalar values for
  wire/port meters). **Mutating messages are loopback-only** (same trust rule
  as `/handover`) — the graph is edited on the Gate machine only (user
  decision 2026-08-21), which eliminates the co-edit/granular-op protocol
  entirely; whole-patch saves are fine. Remote clients still get patch *play*
  surfaces (exposed params in Control) and preview.

## Editor UI

- New **Patch** tab. Recommendation: **@xyflow/react (React Flow)** rather than
  hand-rolling — pan/zoom canvas, typed handles, edge routing, touch events,
  MIT, tree-shakeable. Hand-rolling a good node canvas is a multi-week project
  orthogonal to the interesting work. (First non-react dependency in the
  frontend — flagged as an open question.)
- Ports color-coded by shape; incompatible connections refused at drag time.
- Param editing in a side panel (reuse existing slider components); `Slider`
  nodes and exposed sub-patch params ALSO surface in the Control tab, so a
  finished patch is playable from a phone without seeing the graph.
- Live feedback (later phase): scalar wires get tiny value meters (Sparkbars
  exists); field nodes get thumbnail previews via optional debug taps
  (materialize small — e.g. 64×64 — only for nodes visible in the editor).
- iPad: React Flow's touch support makes editing *possible* on tablet;
  editor is desktop-first, *playing* patches is touch-first.

## Migration / coexistence

- **End state (user decision 2026-08-21): the Layers tab is retired and
  removed** once patches reach generator parity. Dev-time bridge:
  `active_patch` set → the patch renders (stack ignored); unset → the stack
  renders. At parity, the user's existing layer config auto-converts once
  into a "Classic Stack" patch file (N generator nodes → Blend chain →
  Output), `active_patch` points at it, and the stack render path + Layers UI
  are deleted.
- Effects (burst/strobe/…) become Event→EnvelopeAD→generator sub-patches
  eventually; short-term the FX binding stays as-is and composites after the
  patch output (unchanged behavior).
- Autopilot generalizes: Walk nodes / per-param walk flags instead of the
  hardcoded per-layer walk. Gray-code layer walk maps to walking Blend
  opacities.

## Performance guardrails

- Single dispatch preserved for pure-field patches; each Feedback/Texture node
  adds one small pass — count shown in the editor.
- `engine-smoke --suite` gains a generated-patch workload so codegen cost and
  per-pixel cost regressions are measurable.
- Recompile on topology edit only; target < 100 ms rebuild (current shader
  hot-reload already does this path). Param edits are uniform-slab writes.
- Uniform slab + node counts bounded (e.g. 256 nodes, 64 textures-worth of
  slab) — clear editor error past limits, not silent breakage.

## Plan / steps

- [x] 1. Rust core (committed): `src-tauri/src/patch/` — `Shape` type system
      with the two blessed adapters, `PatchDoc` model (serde, `format: 1`),
      19-type node registry (params double as Scalar ports; Select params
      unconnectable), validation (collects ALL errors; Kahn topo with stable
      order; cycle/multi-output/busy-input rejection), file store
      (`<config>/patches/`, slug-id filenames, rename-follows, skips
      broken/newer files), WS messages `PatchList/Get/Save/Delete/Activate`
      (mutations loopback-gated via `patch_edit_denied`, connection kept
      alive), `config.active_patch` (preserved across stale `SetConfig`
      writes like tokens/clients). 22 unit tests; `cargo check --all-targets`
      clean.
- [x] 2. WGSL codegen + engine integration (committed):
      - `patch/codegen.rs`: graph → WGSL. Field nodes become per-node WGSL
        functions over `Ctx`, composed by calls (symbolic — single dispatch
        preserved). Prelude `engine/shaders/patch_lib.wgsl` (noise/hsv/
        effects/dabs/`ctx_transform` domain transform/`finish` epilogue);
        gate.wgsl untouched. GPU kinds: solid, gradient, noise_field,
        radial_waves, spiral, transform, colorize, blend, output.
      - Parameter slab (binding 8, 2048 f32): every Number param + every
        Scalar→field adapter wire gets a slot; knob edits and scalar wiring
        never recompile. Select params bake as constants (recompile on
        change). `rate()` params (speed/spin) are CPU-integrated phases ×
        master speed — no discontinuities on live speed changes.
      - `patch/eval.rs`: control-rate Runtime (time/slider/audio+beat event/
        imu/scalar_math/lfo/smooth/envelope) fills the slab per frame.
      - Engine: shared bind group grew binding 8; `set_patch_shader` builds
        the patch pipeline through the same error-scope path as hot-reload
        (bad patch → UI error, stack keeps rendering); `run_frames` rebuilds
        on (active_patch id, patch_epoch) change; `patch_params` per frame
        switches the dispatch. Effects + dabs composite in patch mode too.
      - Status: `patch_active` + `patch_error` in RuntimeStatus;
        `SharedState.patch_epoch` bumped by PatchSave/Delete; PatchActivate
        now runs full codegen as its gate.
      - Tests: naga (dev-dep, =wgpu's compiler) validates generated WGSL;
        eval unit tests (wire-overrides-knob, integration × master speed,
        beat→envelope, LFO chain). `engine-smoke --patch` renders a 10-node
        demo on the real Vulkan device (verified: 71936 nonzero bytes).
- [x] 3. Editor MVP (committed): `src/Patch.tsx` on @xyflow/react 12 (lazy
      chunk — phones never load it). Palette from `GET /patch/registry`
      (generated from the Rust registry, so the editor can't drift from
      codegen). Typed color-coded ports (Number params double as Scalar
      handles), shape-checked connections (`shapeAccepts` mirrors
      `Shape::accepts`, one wire per input), param side panel with expose
      toggles, debounced autosave, 2-step delete, Activate/Deactivate with
      live `patch_active`/`patch_error` chips. Editing gated by
      loopback-httpBase (mirrors the server rule); remote = read-only.
      Verified in real Chrome end-to-end: built LFO→noise-threshold patch by
      clicking/dragging, activated, preview brightness pulses with the LFO
      (mean 0→42, peak 238). `scripts/patch-test.ts` covers the protocol
      against an isolated backend (registry/save/activate-renders/refusal/
      deactivate) — spawn it with EMPYREAN_CONFIG + a scratch port, NEVER
      against the default port (a live show instance would be taken over).
- [x] 4. Inputs & control rate (committed): Touch strokes → Points →
      Render points on the GPU (dab loop with "as drawn" pen or per-node
      override, size/intensity as multipliers; reverse-reachability decides
      dab ownership so wired render_points suppresses the epilogue's
      auto-composite and dangling ones don't). Tap node fires an Event off a
      monotonic `effect_seq` (any triggered effect: preview taps, pads,
      beat-taps — sentinel avoids a spurious first-frame fire).
      **Exposed-param play surface**: `PatchParam` WS message open to EVERY
      client (exposed params of the active patch only, registry-clamped),
      persisted to the patch file, applied to the live Runtime through a
      queue with zero pipeline rebuild, broadcast as `PatchParamChanged` so
      Control tabs and the editor stay in sync. Control tab shows the active
      patch's exposed params as faders (and hides the Layers section while a
      patch renders). e2e extended: clamp+persist+broadcast verified,
      non-exposed refused. (AudioFeatures/Time/LFO/Envelope/Smooth/math/
      Slider/IMU landed with step 2's evaluator.)
- [~] 5. **Generator parity DONE** (committed): all 20 layer kinds now exist
      as generator nodes (gradient_radial, noise_color, plasma, spoke_chase,
      sparkle, beat_rings, breathe, rainbow, wedges, interference, fire,
      meteors, warp, waveform, spectrum joined the step-2 set). Ported PURE:
      the stack's baked `audio_amount × band` couplings became wireable
      params instead (beat_rings.front ← audio.beat_phase, wedges.flash ←
      audio.onset, etc.) — explicit wiring is the paradigm. Waveform/Spectrum
      keep their SCOPE source as a Select. Parity test compiles ALL
      generators into one naga-validated shader; GPU smoke passes.
      **Remaining, deliberately deferred for user sign-off after real-show
      validation**: one-time layer config → "Classic Stack" patch migration,
      then removing the Layers tab + stack render path (that deletes the
      pipeline current shows run on — not an autonomous call).
- [ ] 6. Sub-patches: exposed ports, palette integration, uuid refs, cycle
      guard.
- [ ] 7. Texture tier: VideoIn node, Feedback node, TextureSample.
- [ ] 8. Polish: wire meters, node thumbnails, co-edit ops, patch crossfade,
      Walk nodes / autopilot integration.

## Decisions already made (from main project — still binding)

- Vulkan-only wgpu (pinned 29 on this machine), no CPU fallback.
- Backend-primary: patch editing goes over the same WS protocol; the editor is
  just another client (iPad can edit).
- Bun, master branch, CI-only releases, compute-budget broker for builds.

## Decisions from design review (2026-08-21)

1. **Editing is main-computer-only** — patch-mutation WS messages accepted
   from loopback connections only; no co-edit protocol needed. Remote clients
   play patches (exposed params), never rewire them.
2. **Layers tab will be retired and removed** after parity + one-time
   auto-migration of the user's layer config to a patch.
3. Transition bridge: `active_patch` set → patch renders; unset → stack.
   Internal sequencing only; disappears when the stack path is deleted.
4. **React Flow (@xyflow/react)** for the editor canvas — recommended and not
   objected to; proceeding (flag again at step 3 before adding the dep).

## Findings / gotchas

- Existing per-layer `phase` integration (speed changes without discontinuity)
  is reproduced as `rate()` params: CPU-integrated into the slab (step 2).
  **Not yet transplanted on handover** — a mid-show update resets patch
  phases/LFOs (layer stack phases still transplant). TODO alongside step 8.
- Handover: patch state must ride the same GET /handover/state payload or
  mid-show updates would blink the patch away. (Same TODO as above.)
- WGSL reserved words bit us before (`active`); codegen must mangle all
  identifiers (`n<id>_...`), never emit user strings into code. Confirmed
  live in step 2: `gen` is a Rust 2024 reserved keyword and `patch` is a
  WGSL reserved keyword — both bit during implementation.
- The engine's `patch_epoch` rebuild key means saving ANY patch rebuilds the
  active one; harmless (rebuild ≈ ms, saves are user actions).
- Codegen re-evaluates shared subgraphs per consumer (function call per
  wire). Correct semantics under transforms; if profiling ever shows waste,
  memoize per-`Ctx` at same-domain call sites.
- **The t3-code Electron preview tab never fires requestAnimationFrame**, so
  React Flow nodes stay `visibility: hidden` (unmeasured) there forever. Not
  an app bug — verify the editor in real Chrome (claude-in-chrome). Wasted a
  debugging session before `raf: 0` proved it.

## Things not to do

- Don't materialize fields per-node "for simplicity" — that's the slow path
  TiXL avoids; symbolic-until-sink is the core of the design.
- Don't invent a custom binary patch format; JSON + format version.
- Don't block the frame loop on recompiles — build pipeline off-thread, swap on
  validate (hot-reload already models this).
