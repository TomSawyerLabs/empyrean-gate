# Nothing reaches the output unless it's wired

Status: **built and tested; on the empyreangate.org `dev` Preview** (on gate
`master` `3b5cc85`, not yet in a release). Follows `plans/touch-nodes.md`.

## Goal

Cameron (2026-10-15), looking at Touch Ripples: the Event effect node
("tap burst") doesn't connect to the Output, yet its bursts show. The Output's
shader epilogue (`finish()` in patch_lib.wgsl) silently composited every live
effect and every pen dab on top of the graph unless a Render effects / Render
points node was reachable. Decision (Cameron, "Everything explicit"): the
Output shows exactly what is wired into it, for effects a node emits, for
pad/key/client effects, and for pen strokes alike. Existing patches keep
looking the same through a one-time migration.

## Design

- **Effect sources.** `GpuEffect` gains `source: u32`: 0 = triggered by a
  client (pads, keys, taps), otherwise a stable hash of the emitting node's id
  (`effects::effect_source`). Both WGSL copies of `Effect` gain the field; the
  layer stack (gate.wgsl) draws only source 0, so patch-made effects never
  leak onto a scene.
- **Streams are wires.** Event effect gets an `effects` output and an optional
  `effects` input (`in`), so streams chain: Triggered effects → Event effect →
  Event effect → Render effects. A Render effects node draws the sources its
  chain names (client effects if Triggered effects is at the head).
- **`finish()` adds nothing.** No automatic effects or dabs; master, hue pull,
  soft clip and packing only. The codegen reachability / ownership logic goes.
- **Patch format 2.** `migrate()` turns a format-1 patch into the equivalent
  format-2 graph: where the old epilogue would have composited effects, it
  wires Triggered effects through every Event effect into a Render effects
  (or extends existing Render effects chains); where it would have drawn dabs,
  Touch strokes → Render points ("as drawn"); both are added over the
  Output's input with Blend (add). Applied wherever a document enters a host:
  the gate's store (load and save), built-in presets (files rewritten, and
  `presets()` migrates defensively), the wasm entry points, a `/patch/migrate`
  route for the gate app's Import, and the playground's IndexedDB/file loads.
  Known difference: an Output `master` other than 1 now also scales the
  migrated overlays (the old epilogue added them after it).

## Plan / steps

1. **Done** (`c9c984c`). Crate: source field, Event effect ports, codegen filter,
   `finish()` without overlays, `migrate()` + format 2, presets rewritten,
   tests.
2. **Done** (`c9c984c`). Engine/state/Sim: effects carry their source; store migrates;
   `/patch/migrate` route; gate.wgsl draws source 0 only.
3. **Done** (`234263e`, site playground commit). Editor/TS: `PATCH_FORMAT` 2 for new patches; gate Import migrates via the
   route; playground migrates on load/open via wasm.
4. **Done**. Republish web-dist, bump the site, push `dev` (never `master`), verify.

## Progress log

- [x] Steps 1–4 (2026-10-15). Verified: crate 67, app 333 (incl. a store
      test loading a format-1 file upgraded), engine-smoke incl. `--patch`,
      gate UI specs, and in Chrome: an old format-1 Touch Ripples from
      IndexedDB opens with the added wiring; with Touch Ripples (format 2),
      a tap's burst adds ~1.3M units of light when wired through Render
      effects and none beyond the glow (~47K) when that one wire is removed.
- [ ] Follow-up to consider: pads/keys show nothing on a patch that doesn't
      wire Triggered effects, which could puzzle an operator mid-show. A status
      flag (e.g. `patch_shows_effects`) plus a hint on the Live/Control pads.

## Things not to do

- Don't migrate inside `compile()`: Program node indices must match the doc
  the Runtime holds. Migrate at the boundaries where documents enter.
- Don't push `master` in either repo.
