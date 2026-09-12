# One look model — everything the rig can show is a patch

## Goal

Cameron, 2026-09-12: the layer stack, patches, scene studies, saved stacks,
games, effects and the A/B buses are five overlapping ways to say "a look",
each with its own config shape and its own UI. Collapse them: **a look is a
patch document**, and everything that puts something on the rig — Program,
Bus B, a playlist cue, a performance recording, a follower — holds a look.
Asked as "force everything to run through the patch system, including the
taking of the show as a last layer"; scoped in the plan-presenter session to
the look model first (buses/TAKE-as-node, operator surfaces, and the on-disk
show format are follow-ons, not this plan).

This supersedes the "Migration / coexistence" paragraph of
`plans/node-graph.md` with a staircase; it does not replace that plan's
type system, execution model or editor decisions, all of which stand.

## Environment / context

- Repo `~/git/Personal Projects/Empyrean`, v0.11.0 shipped 2026-09-10.
- Patch system: `src-tauri/src/patch/` (registry 44 node types, codegen to one
  WGSL dispatch, control-rate `eval::Runtime`, file store under
  `<config>/patches/`, 15 built-in presets). Generator parity for the 20
  classic layer kinds is done (`plans/node-graph.md` step 5).
- Layer stack: `layers.rs` (24 kinds — the 20 above plus Video, EntheosWeave,
  BrcMap, BrcPlan, GoldenRose), `config.rs` (`AppConfig.layers`, `SavedStack`
  used by Ready / playlists / performances / 19 scene studies in
  `src/scenes.ts`), engine loop in `engine/mod.rs` (walk envelopes, discrete
  dwell, enable envelopes, mini bus), UI in Live (chips, level rows,
  quick-edit), Control (faders), Ready, Settings.
- Games: `src-tauri/src/game/` (five sims on a polar grid; `game_cells`
  buffer → `game_color()` in `gate.wgsl`; crossfade `GAME_FADE_SECS`).
- Buses: Program + Ready engines, outgoing bus for handoffs, CPU
  `eased_crossfade` of finished frames; mini bus for thumbnails.
- Checks: `cargo test --lib` (250), engine-smoke, layout + behaviour
  Playwright suites, `bun run test:unit`.

## Decisions already made (don't re-ask)

- Vulkan-only, single dispatch for pure-field looks, backend-is-the-app,
  nothing turns on instantly — all binding (`plans/empyrean-gate.md`,
  `plans/no-hard-cuts.md`).
- Layers tab retires only after a full show has run on looks (node-graph plan,
  2026-08-21; reaffirmed by keeping step 6 last below).
- One global Ready bus (F14, 2026-09-10).
- Show-level controls that must survive a look change stay **outside** the
  look: master brightness/speed, master hue, floor input, beat taps, DJ LINK
  effect bindings, sACN output. (Same rule master hue already follows.)
- Scope of this plan: the look model. TAKE-as-a-node / shaped crossfades,
  collapsing the operator surfaces, and a unified on-disk show format are
  separate follow-ons (plan-presenter s-936a87d013bd, page 3 and the scope
  question of 2026-09-12).

## Target model

- **Look** = `PatchDoc` (nodes, edges, exposed params). The file is the unit
  of composition and of sharing (follower, poster, playlist).
- **Program** and **Bus B** each hold a look snapshot. TAKE stays the
  bus-agnostic CPU crossfade of two finished frames (a broken Bus B can never
  break Program; prepare-time compile refuses a bad look).
- **Playlist cue** = look + duration + transition (+ optional game cue while
  games remain a mode). **Performance recording** = initial look + events.
- **Classic layers** become generator nodes → `blend` chain → `output`,
  produced by a converter that is also how every existing config, saved
  stack and scene study crosses over. Blend modes map 1:1; per-layer
  `audio_amount` couplings become explicit `audio` wires (the registry
  already documents the pairing per generator); `walk_amount` becomes a
  `walk` node on the walked params.
- **Node `enabled` flag**: a node can be switched off (codegen bypasses it —
  a blend passes its base through) with the same `LAYER_TOGGLE_SECS`
  envelope the stack has. This is what the Live chips, the shelf of off
  layers, and the mini thumbnails become for a look.
- **Exposed params** replace the per-layer quick-edit: the converter exposes
  each layer's opacity / hue / speed / kind params with the labels the
  quick-edit shows today, so Control's faders and a hold-to-edit popover on a
  node chip are the same surface as before.
- **Autopilot** = `walk` (Scalar out: OU process, `center`, `amount`, `tau`,
  discrete dwell when wired into a quantized param — the registry knows the
  steps) and `autopilot` (N gray-code on/off targets for blend opacities,
  `min_on`, `period`) nodes. The show-level walk speed/depth knobs multiply
  into every `walk` node, as they do into every layer today.
- **Effects and drawing** stay composited by the epilogue for looks that do
  not wire `render_effects` / `render_points`, so the floor works on every
  look without authoring; looks that do wire them own the compositing.
- **Games**: a `game_world` node (Field<color>; kind Select; the sim runs in
  the control-rate runtime the way the eval Runtime does, publishing cells).
  Entering a game = taking a look that contains one. Until that lands, games
  stay a mode that composites over the look, as today.
- **Naming**: keep "patch" in code and files; the UI says **Look** where it
  today says scene/stack/patch. (Open question 1.)

## Plan / steps (each shippable and show-safe; order matters)

1. [ ] **Operator parity for looks.** Node `enabled` flag + envelope in
       codegen/eval; Live chips + level rows + hold-to-edit for the active
       look's top-level generator nodes (reusing the layer components);
       Control faders from exposed params (exists) + node chips; mini
       thumbnails already exist per node. *After this, a look is as
       playable as a stack from every surface.*
2. [ ] **Finish generator parity.** Port EntheosWeave, BrcMap, BrcPlan,
       GoldenRose (56 / 99 / 88 / 66 lines of WGSL, already function-shaped)
       and Video-as-layer parity (`video_in` + `texture_sample` exist; check
       the layer's colour treatment and autopilot params). Add `walk` and
       `autopilot` nodes with the engine's OU / discrete-dwell / gray-code
       code moved into `patch/eval.rs`.
3. [ ] **Classic Stack converter** (`patch/convert.rs`): `Vec<LayerCfg>` +
       scene masters → `PatchDoc`. Tested by rendering every scene study and
       the default stack both ways in engine-smoke and pixel-diffing (a
       tolerance, not equality — the audio couplings are explicit now).
       Scene studies become shipped preset looks generated at build from the
       same converter, so `src/scenes.ts` stops being a second source.
4. [ ] **Buses hold looks.** `SavedStack` → look everywhere: Ready (this is
       F13, for free), playlist cues, performance `SetLook`, follower mirror
       (already a `PatchDoc`). Old configs convert on load; `AppConfig.layers`
       becomes the converted look on first run and is then read-only.
5. [ ] **Game as a node** (`game_world`), keeping the mode-based path until
       every game has run inside a look at a show.
6. [ ] **Flag day** — remove the stack render path, `LayerCfg` UI, the
       Layers section, `SCENE_PRESETS`. Only after a full show on looks.
7. [ ] (follow-on, separate plan) Sub-patches; TAKE-as-a-node for shaped
       crossfades; operator-surface collapse; on-disk show format.

Rough size: steps 1–4 about three weeks of sessions; 5 one week; 6 two days
once allowed. F13 as previously designed is step 4's Ready half and can be
pulled forward if a show needs it first.

## Findings / gotchas

- The four unported kinds are the only generator gap; everything else the
  stack does that patches don't is *engine-side per-layer machinery* (walk,
  enable envelope, discrete dwell) or *UI*. That is why step 1 comes first.
- `eased_crossfade` between two finished frames is what makes Bus B safe;
  TAKE-as-a-node compiles both looks into one shader and gives that up.
  Deliberately a follow-on.
- Mini thumbnails, exposed params, `render_effects`/`render_points`, the
  follower's patch mirror and playlist `patch` cues already exist — the
  redesign is mostly a converter plus moving per-layer engine code into
  nodes, not new infrastructure.

## Progress log

- [x] 2026-09-12: scope agreed (look model first); this plan written;
      presented in plan-presenter s-936a87d013bd page 4.

## Open questions for the user

1. **Name.** "Look" in the UI (scene/stack/patch become one word)? Code keeps
   `patch`. Recommendation: yes.
2. **Games.** Worth a `game_world` node (step 5), or keep games a mode that
   composites over whatever look is on? Recommendation: node, but last.
3. **Start.** Step 1 (operator parity) first, or F13 minimal first because a
   show is coming? Recommendation: step 1 unless a show is within two weeks.

## Things not to do

- Don't remove the stack path before a show has run on looks (binding).
- Don't move master brightness/speed/hue/floor input into the look.
- Don't make TAKE depend on both looks compiling into one shader.
- Don't add a second source of scene studies; generate presets from the
  converter.
