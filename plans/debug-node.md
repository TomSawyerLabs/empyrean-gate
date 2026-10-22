# Debug node: a tap that shows any wire

Status: **built and tested; on gate `master` (`7c2344f`) and the
empyreangate.org `dev` Preview** (bump `b348e80`, README `3982361`), not
yet in a gate release. Full detail on the gate (2026-10-22) is built and
tested; see its section.

## Goal

Cameron (2026-10-21): "a new 'debug' node type. something that is just a
'tap' that can visualize any step in the chain. like a dedicated 'mini'.
Only renders in the editor (show can opt in to rendering them)."

A Debug node has one input that takes a wire of any shape and no outputs.
Its only job is a large live view of whatever is wired into it: a ring for a
field, a stream or a texture, a meter for a Scalar, a fire strip for an
Event. It never changes what reaches the Output.

## Decisions already made (don't re-ask)

- **Show opt-in is per node** (Cameron, 2026-10-21, chose "Per-node flag →
  Live strip"): each Debug node has a "Show on Live" setting saved in the
  patch. While that patch is on air, the gate's Live tab shows a strip of
  the flagged taps' minis. With none flagged (the default) Live shows
  nothing and subscribes to nothing for them.
- **Id `debug`, label "Debug".** `tap` is taken (Effect taps, an input
  node).
- **The input's shape is whatever is wired in**, not a Select like Patch
  in/out: drop any wire on it. A new port-only shape, `Shape::Any`, accepts
  every wire shape; it is never carried on a wire.
- **No cost in the show's render.** The Debug node is neither a CPU nor a GPU
  node: nothing in the main shader, nothing in `eval`. Its view is a preview
  cell (rings) or a meter ref (scalars, events), which only run while
  something subscribes to minis (`mini_watchers` on the gate, `miniRefs` in
  the browser).
- **Debug cells and meters come first** in the preview lists (cells right
  after the Output's own, which another thread put first on 2026-10-21), so
  the 32-cell and 64-meter caps never drop a tap someone placed on purpose.
- **Keys are the Debug node's own**: ring `node:<debug id>`, meter
  `scalar:<debug id>:in`. `Runtime::scalar_value` follows the wire into a
  Debug node's `in`, so neither host needs to know the source.

## Design

Crate (`crates/empyrean-patch`):

- `Shape::Any` (label "Any"): `accepts` everything but `Pixels`/`Any`.
- `registry`: `Category::Debug` (`debug`), node `debug` in Group Structure,
  input `in: Any`, Select `live` ("Editor only" / "Editor and Live").
  `DEBUG_KIND`.
- `codegen`: skip it like a Note; preview cells for wired Debug nodes first,
  their expression is the source's value (colour, grey, or the source's
  stream/texture preview, `n{src}_pv`, emitted once per source).
  `preview_scalars` gets `(debug, "in")` first for Scalar/Event taps.
  `debug_taps(doc)` lists the flagged ones for the gate's status.
- `eval`: `scalar_value(debug, "in")` reads the wire's source.

Editor (`packages/patch-web`): a Debug node view with a large ring/meter
(no head clutter), port colour from the wire, palette entry, icon, thumb;
`ParamPanel` shows the view large too.

Gate app: status `patch_taps` (flagged taps of the active patch, with the
tapped shape); Live renders a strip of minis for them.

## Plan / steps

1. **Done** (`7b36ca2`). Crate: shape, registry, codegen, eval, tests.
2. **Done** (`bea531d`). patch-web: types, editor view, panel, `MiniTap`,
   icons/thumbs, connect suggestions, corpus, guide.
3. **Done** (`03fded4`). Gate app: status `patch_taps`, Live strip, spec
   `tests/live-taps.spec.ts`.
4. **Done.** README (gate, patch-web, site), web-dist published from gate
   master, site bump on `dev` (dispatched by hand: the schedule lagged).

## Findings / gotchas

- The patch shader the show runs is byte-identical with or without Debug
  nodes (test `debug_nodes_leave_the_shown_shader_alone`, Debug nodes last
  in the document so other node indices hold).
- A stream source drawn by its own cell and a Debug cell would emit
  `n{i}_pv` twice (a WGSL redefinition); `preview_main_fn` emits each once.
- The shared mini stage (192 px) blurred a 160 px ring at 2× DPR; it now
  grows to the largest view asked for (≤ 512) and draws into a corner.
- Seen in the demo (Chrome, WebGPU): rings for a colour and a grey field,
  a meter with its window range for an LFO, a fire strip for Time's wrap,
  the Live badge, the unwired hint, the panel's 220 px view.
- Minimized nodes' face meters (any node, not just Debug) spill past the
  node's right edge: logged in ISSUES.md, not fixed here.

## Progress log

- [x] Step 1: crate 167 tests pass.
- [x] Step 2: patch-web typecheck, 215 unit tests, browser shader corpus
      (Chrome compiles every shader incl. "debug fed <shape>").
- [x] Step 3: gate typecheck, cargo test --lib 362, test:behavior 179/180
      (the one failure the known WebKit multitouch flake in ISSUES.md;
      passes alone), layout gate, live-taps on Chromium.
- [x] Step 4: gate CI green on `7c2344f` (Checks, Web dist); site Preview
      built; checked on dev.empyreangate.org in Chrome: rings, meter,
      fire strip, Live badge all live. A test patch "Debug node check
      (Claude, safe to delete)" was left in Cameron's playground library.
- Rebased once onto the Output's mini (`43b1d82`, another thread): the
  Output's cell is slot 0, Debug cells follow it.

## Full detail on the gate (built 2026-10-22)

Cameron (2026-10-21): "Having it everywhere would be nice", then "sounds
good" to the plan below. It covers building it on the gate and renaming the
option.

**Decisions:**
- The Select's second choice is labelled **"Full detail"**, not "Every
  LED": the views average the real LEDs down to what the screen can hold.
  It keeps value 1, so saved patches are unchanged.
- **No checkbox.** The node's Resolution is the only switch. Each client
  asks for as many samples per spoke as it can draw; the gate box-averages
  the full cell down to that for each client.

**Design:**
1. **Engine** (`src-tauri/src/engine/mod.rs`):
   - `PatchShader` gains `taps`, the Full detail module
     (`Program::full_wgsl`), set only on the preview shader.
     `PatchCompiler::build` builds its `main` pipeline into
     `PatchPipelines::taps`.
   - `Engine::render_taps(globals, cells)` runs that pipeline after
     `render`, on the same queue, so it reads this frame's textures. It
     uses its own globals, output and ping-pong staging, with the readback
     one call behind, as `render` does.
2. **Mini bus** (`minis.rs`): after the preview dispatch, render the taps
   with the show's own globals (real pixel count). The batch carries
   `detail` cells, keyed by slot in `patch_nodes` (a Full detail tap keeps
   its mini cell), plus `detail_pixels`. It renders only while someone
   watches (`mini_watchers`).
3. **Wire:** a patch batch (kind 1) gains a tail after its scalars: u16
   detail pixels, u16 count, then cells (u16 slot, pad, spokes × pixels
   RGB). `SubscribeMiniPreviews { detail }` is the samples per spoke the
   client can draw (0: no tail). `encode_minis` box-averages to
   `min(detail, pixels)`.
4. **Client:**
   - `ws.ts` parses the tail.
   - `MiniHub` lets a detail cell stand in for its mini in `apply` and
     `keep`, counts it in `keepCost`, and subscribes with `detail` from
     patch-web's `ringSamples` (the `fitCell` formula at the largest
     stage; half that on phones).
5. Tests, README (gate, patch-web, site), registry description.

**Verified (2026-10-22):**
- `cargo test --lib` 364, crate 172, gate unit 240, patch-web unit 231,
  typechecks.
- `engine-smoke --patch` on the real GPU: the taps cell is the whole frame
  (72,576 bytes), with 84 different LEDs along a spoke.
- `scripts/mini-preview-test.ts` against a real headless backend: Full
  detail cells at the 100 samples asked for, lit.
- Playwright: patch-minis, live-taps, frame-step, public-floor.
- In Chrome against an isolated backend: radial waves at a high count. The
  Mini tap shows a few broad aliased rings, the Full detail tap the real
  fine ones. Seen on the node, in the panel, and in the Live strip.

**Findings:**
- The first run of `scripts/mini-preview-test.ts` after a fresh build timed
  out waiting for the first meta (8 s), and the next four passed. It looks
  like a cold start (a new exe copy, Vulkan init); the script is not in CI.
- Each kept frame-step batch now holds its detail cells too (`keepCost`
  counts them).

**Not doing (yet):** per-key interest. A client watching only the Live
strip still receives detail cells for taps that are not on Live. It's a
small cost (about 3 Mbit/s per tap per desktop client at 192 samples); add
it if it shows up.

## Open questions for the user

1. ~~Resolution~~ Answered (Cameron, 2026-10-21: "make it a toggle";
   2026-10-22: "sounds good" to Full detail on the gate, built above).
   Was:
   Debug's Resolution Select, Mini or Every LED (`e3da1de`, `6246d7b`).
   Every LED is a third module run with the main globals, in the browser
   only. **Open:** the gate's own views show it as a Mini; doing it there
   needs a second GPU engine in the mini bus (its own Vulkan device) or a
   second patch pipeline slot in `Engine`, on the show machine, plus a
   batch kind for cells of another size (a 64 × 378 cell is ~73 KB, ×10/s
   per client).

## Things not to do

- Don't make `debug` a Sink: `exactly_one_sink_type` holds the Output alone.
- Don't push `master` in the site repo; gate `master` is fine.
