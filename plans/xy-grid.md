# Rendered textures: a stored x/y grid on the GPU

## Goal

Cameron (2026-10-18, in `plans/field-domains.md`): a stored rectangular x/y
grid "could be a good idea too"; 2026-10-19: "keep going". Render a plane
field into a grid once per frame, so blur and grid-space feedback become
cheap, and so a Code node can compute a grid cell by cell.

## Status

Approved design choices 2026-10-19 (below). Building in the gate worktree
`C:\Users\camer\.t3\worktrees\Empyrean\field-domains`, branch `xy-grid` →
gate master. Coordination: `.agents.txt` in the `playground` worktree (Agent
I, round 4).

## Decisions already made (don't re-ask)

- **A rendered grid is a Texture**, not a new wire type (Cameron chose "Reuse
  Texture", 2026-10-19). Texture's square already touches the disc's rim, the
  same square a plane grid covers, so Texture sample and Code nodes read
  rendered grids as they read video and images, and the grid tools work on
  video, Still image and Clip too.
- **First round, all four** (Cameron, 2026-10-19): Render to texture, Blur,
  Feedback trails, Code node texture output.
- Fields stay symbolic; only nodes whose output is a Texture materialize, and
  a field becomes a Texture only through an explicit node (Render to
  texture), as agreed in `plans/field-domains.md`.
- A patch with no rendered texture stays one dispatch (binding:
  `plans/one-look-model.md`, "single dispatch for pure-field looks").

## Environment / context

- Gate repo, crate `crates/empyrean-patch` (codegen, registry, validate, WGSL
  prelude `shaders/patch_lib.wgsl`), gate renderer
  `src-tauri/src/engine/mod.rs` (+ `minis.rs`), browser runtime
  `packages/patch-web/src/runtime/{gpu.ts,index.ts}`, editor
  `packages/patch-web/src/editor`.
- Both runtimes run the WGSL from `codegen::compile` (browser via the wasm
  crate), with the same binding numbers.

## How it works today (survey, 2026-10-19)

- One WGSL module per patch: prelude, one `n{i}_f(c: Ctx)` per GPU node,
  then one `@compute main`, one invocation per LED. A preview module shares
  the node functions with a per-node thumbnail `main`.
- No GPU textures or samplers anywhere. "Texture" is binding 7 `VIDEO`, an
  `array<u32>` of packed RGBA8 cells: cell 0 the live video, 1–4 Still image
  / Clip (`MAX_PATCH_IMAGES` = 4, `IMAGE_SIZE` = 256). `video_at`,
  `image_at`, `clip_at` filter bilinearly by hand; `texture_source_expr`
  (codegen) picks one for a Texture wire.
- The only GPU state is Feedback: `OUT` is two frames long and `finish`
  copies the old value before writing.
- One compute dispatch per frame in each runtime. The gate's shared bind
  group layout already uses all 8 storage buffers (bindings 2–9); the patch
  prelude leaves out 2 (layers) and 9 (game). The browser's layout lists only
  the patch's bindings.
- The gate has four `Engine` instances (main, outgoing crossfade, ready bus,
  mini previews), each with its own buffers.
- No field is evaluated on the CPU; thumbnails and the CLI use Dawn under
  Node. So nothing here needs a CPU reference.

## Design

- **Grid buffer**: a new read_write storage binding `GRID` (binding 11),
  `array<vec2u>`, each cell RGBA as four half floats (`pack2x16float`), so
  trails fade smoothly instead of sticking at 8-bit steps. Fixed size:
  `MAX_GRID_REGIONS` regions of 256² cells (8 regions = 4 MiB), allocated
  once by each host.
- **Grid nodes** (output Texture, not media sources) each own a region, or two
  (Feedback: this frame and last; Blur: a scratch region for the separable
  pass). Codegen assigns regions in graph order; validate refuses a patch
  that needs more than the budget.
- **Passes**: each grid node contributes one or more `@compute` entry points
  (`grid_{i}_{k}`), one invocation per cell, run before `main` in graph order
  (a dispatch's writes are visible to the next). `Program::grid_passes` lists
  entry name and cell count. The preview module has the same passes.
- **Sampling**: `texture_source_expr` gains `grid_at(base, res, uv)`
  (bilinear, like `image_at`). A grid node's thumbnail samples its region.
- **Plane context for a cell**: a `plane_ctx(pos)` helper builds a `Ctx` from
  a position (`theta`, `r01`, `rn` from `pos`; `spoke`/`i` from the nearest
  LED, like `led_cell`). A Render to texture input is a sampled input, so LED
  data must go through Resample (the existing rule).
- **Feedback ping-pong**: which of the two regions is "this frame" flips each
  frame by a frame-parity value the host already advances (to confirm:
  Globals frame counter), so no copy pass.
- **Gate**: the patch pipeline gets its own bind group layout and bind group
  (the patch's bindings plus `GRID`), so the layer-stack pipeline keeps its
  8; one pipeline per entry point; `render()` dispatches the grid passes
  first, in the same compute pass. Each `Engine` owns its grid buffer.
- **Browser**: `GateGpu` adds `GRID` to its layout, builds the pass
  pipelines, and dispatches them before `main` in `render()`. `readPreview`
  reuses the grids the main render produced (same patch), so a preview never
  advances Feedback state twice.

### The nodes

1. **Render to texture** (`render_texture`): `in` colour field → `out`
   Texture. Select `resolution` 64 / 128 / 256 (default 128).
2. **Blur** (`texture_blur`): `in` Texture → `out` Texture. Number `radius`
   (in the disc's units), Select `resolution`. Separable Gaussian: a
   horizontal pass into scratch, a vertical pass into its region.
3. **Trails** (`texture_feedback`, name to settle): `in` Texture → `out`
   Texture. Each frame: last frame, sampled zoomed / rotated / drifted and
   faded by `decay`, combined with the new input (Select: Max, Add, Mix).
   Select `resolution`.
4. **Code node Texture output**: a Code node whose output port is a Texture
   runs its body once per cell (a grid pass) with `pos`/`uv` for the cell,
   and may read its own last frame (to design: the body idiom, e.g.
   `prev_at(uv)`), which is what cellular automata need.

## Plan / steps

1. Core: `GRID` binding in the prelude, `grid_at`, `plane_ctx`, region
   allocation, `Program::grid_passes`, Render to texture codegen, naga tests
   (main and preview modules). ← current
2. Gate engine: patch layout and bind group with `GRID`, pass pipelines,
   dispatch before `main` in all four engines; engine smoke test.
3. Browser runtime: `GRID` binding, pass pipelines, dispatch; preview reuse.
4. Blur and Trails.
5. Code node Texture output (design its idiom in this plan first).
6. Editor: registry groups, icons, thumbnails, mock registry, agent guide,
   behaviour spec; README (gate and site).
7. Checks, merge, web-dist bump, check on dev in Chrome.

## Findings / gotchas

- `plans/node-graph.md` says a "VIDEO binding + sampler" exists; there is no
  sampler or GPU texture at all (survey 2026-10-19).
- Feedback's same-dispatch read/write of `OUT` is order-dependent between
  invocations; grid ping-pong regions avoid that for the new nodes.

## Progress log

- [x] Survey and design choices (2026-10-19)
- [ ] Steps 1–7

## Open questions for Cameron

None.

## Things not to do

- Don't add a grid pass to patches without a grid node (single-dispatch rule).
- Don't bind `GRID` into the gate's shared layout: it is at the 8
  storage-buffer limit; the patch pipeline gets its own layout.
- Don't store grids as RGBA8: decaying trails stall at low values.
