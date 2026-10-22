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
  `array<vec4f>`, each cell RGBA as f32, so trails fade smoothly instead of
  sticking at 8-bit steps (half floats were the first idea; see Findings).
  At most `MAX_GRID_REGIONS` = 16 regions of up to 256² cells (16 MiB); each
  host sizes it per program from `Program::grid_bytes` (at least one cell)
  and clears it on a new program.
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
- **Trails' last frame**: its second region holds last frame; after the
  combine pass, a copy pass writes this frame into it. (A parity flip would
  have needed a frame counter in Globals, an ABI change in both hosts; the
  copy is one more cheap dispatch.)
- **Gate**: the patch pipeline gets its own bind group layout and bind group
  (the patch's bindings plus `GRID`), so the layer-stack pipeline keeps its
  8; one pipeline per entry point; `render()` dispatches the grid passes
  first, in the same compute pass. Each `Engine` owns its grid buffer.
- **Browser**: `GateGpu` adds `GRID` to its layout, builds the pass
  pipelines, and dispatches them before `main` in `render()`. `readPreview`
  reuses the grids the main render produced (same patch), so a preview never
  advances Feedback state twice.

### The nodes

1. **Render to texture** (`render_texture`): `in` colour field → `tex`
   Texture. Select `resolution` 128 / 256 / 64 (default 128).
2. **Blur** (`texture_blur`): `tex` → `tex`. Number `radius` (disc radii,
   0–1), Select `resolution`. Separable Gaussian, 33 taps: a horizontal pass
   into scratch, a vertical pass into its region.
3. **Trails** (`texture_trails`): `tex` → `tex`. Each frame: last frame,
   warped by `zoom` (×/s), `spin` (turns/s), `drift_x`/`drift_y`, faded by
   `fade` (s to half), combined with the new input by `mode` (max, add,
   over); then the copy pass. Select `resolution`.
4. **Code node Texture output**: a Code node whose output port is a Texture
   runs its body once per cell (a grid pass) and may read its own last
   frame, which is what cellular automata need. The idiom (designed
   2026-10-20, mirroring how a body already reads a Texture input, where
   `img` is the picture here and `img_at(uv)` anywhere):
   - **One output.** A Code node that makes a Texture makes only that
     (`texture` output shape); its body runs per cell, not per LED, so it
     can't also make fields or scalars. "Split it into two nodes", as the
     field/scalar rule already says.
   - **`c` is the cell's centre** (`plane_ctx`): `c.pos`, `c.rn`, `c.theta`,
     `c.r01` mean what they mean in a field body. `c.spoke`/`c.i` are
     refused (a cell is not an LED), as are LED-data inputs (Resample first,
     the Render to texture rule). `pos_uv(c.pos)` (new lib helper, the
     inverse of `uv_pos`) gives the cell's uv.
   - **`out` is assigned as usual** (starts transparent black each frame).
     **`out_at(uv)`** reads the output's own last frame, bilinear, like a
     Texture input's `_at`. **`out_cell(dx, dy)`** (i32s) reads last frame's
     cell `dx` right and `dy` down of this one, exactly, transparent outside:
     neighbour counts for a CA without texel arithmetic. (`out` stands for
     whatever the output port is called.)
   - **Inputs** are read at the cell: fields at `c` (and `name_at(ctx)`),
     Textures at the cell's uv (and `name_at(uv)`), Scalars, Points and
     Effects as in a field body.
   - **Two regions** (this frame, last frame) and the Trails copy pass;
     resolution 64 / 128 / 256 on the output port (`resolution`, 128 when
     absent), step 8.
   - A port can't be named `<texture output>_at` / `_cell` (they'd shadow
     the helpers); `_at` is already refused for every port.

## Plan / steps

1. Core: `GRID` binding in the prelude, `grid_at`, `plane_ctx`, region
   allocation, `Program::grid_passes`, Render to texture codegen, naga tests
   (main and preview modules). Done in `a7b4347`, Blur and Trails too.
2. Gate engine: patch layout and bind group with `GRID`, pass pipelines,
   dispatch before `main` in all four engines; engine smoke test.
3. Browser runtime: `GRID` binding, pass pipelines, dispatch; preview reuse.
4. Blur and Trails: checked in the browser 2026-10-20 (pictures below).
5. Code node Texture output (idiom above). Done in `773e06a`.
6. Editor: registry groups, icons, thumbnails, mock registry, agent guide,
   behaviour spec; README (gate and site).
7. Checks, merge, web-dist bump, check on dev in Chrome. Done but the
   look on dev (see Progress log).
8. Done 2026-10-21: a Code node's Texture output gets a
   Resolution (64 / 128 / 256), approved by Cameron. Stored on the port as
   `resolution` (cells a side, 128 when absent, so old patches are
   unchanged), not as a node param: a Code node's params are its Scalar
   inputs' knobs, keyed by port name. The port editor shows a Resolution
   select under a Texture output; the tier line, Code reference card and
   agent guide name the size.

## Findings / gotchas

- `plans/node-graph.md` says a "VIDEO binding + sampler" exists; there is no
  sampler or GPU texture at all (survey 2026-10-19).
- Feedback's same-dispatch read/write of `OUT` is order-dependent between
  invocations; grid ping-pong regions avoid that for the new nodes.
- Half floats are out: naga refuses `pack2x16float` without
  `SHADER_FLOAT16_IN_FLOAT32` ("MissingCapabilities"), so cells are `vec4f`.
- WGSL reserves `new` (and the lib had a `from`): pass code uses `fresh` and
  `back`.
- A grid node that reaches no output still costs its passes; kept, so it
  still gets a thumbnail while it is being wired.
- **The playground rendered black after opening a file** (2026-10-20), on
  every patch, with or without this branch: `GateGpu.setProgram` installed
  its pipelines unconditionally after `await`, so the page's first (empty)
  program, still compiling, finished last and replaced the opened one. Proved
  by hooking WebGPU in headless Chrome: the dispatched pipeline was
  "0 of 5" (the first one built); a pipeline built from the same WGSL on the
  runtime's own bind group lit 24,192 LEDs. Fixed on its own in `94ef775`
  (a sequence number; a superseded call drops its pipelines). Before that,
  thumbnails read mean 0 and the ring was dark.
- The site checkout's installed `@empyrean-gate/patch-web` currently fails to
  load (`./djlink` missing from `groove.ts`), so a check without
  `PATCH_WEB_DIR` is not a baseline right now.

## Checking in the browser

From the site checkout: `PATCH_WEB_DIR=<gate>/packages/patch-web bun run dev
-- --port 4195 --strictPort`, then `node check.mjs 4195 <name>` in
`%TEMP%\fd-scripts\grid-check` (installed Chrome, headless, WebGPU flags;
loads `<name>.json` through "Open file…", screenshots, logs GPU errors,
dispatch counts and which pipeline runs). 2026-10-20: spiral → Render →
Trails → Blur → Texture sample shows each stage in its thumbnail, and Blur at
radius 0 vs 0.3 visibly softens the arms on the ring.

## Progress log

- [x] Survey and design choices (2026-10-19)
- [x] Step 1, core (`a7b4347`)
- [x] Playground shader-install race fixed (`94ef775`)
- [x] Step 2, gate engine (`b47f6b8`; engine-smoke `--patch` passes on
  Intel UHD Vulkan with a grid chain; src-tauri 362 + 6 tests pass)
- [x] Step 3, browser runtime (`a49c8fc`; `test:browser` 3/3; renders)
- [x] Step 4, Blur and Trails checked in the browser
- [x] Step 5, Code node Texture output (`773e06a`; a Game of Life body runs
  in the playground; `life` and `trail` snippets compile in Chrome)
- [x] Step 6, editor: icons and thumbnails (`01ab8d9`), patch browser topic
  "Trails and blur", agent guide, gate README. The mock backend's registry
  is a deliberate subset for UI tests and needs none of the new kinds.
  Site README waits for the web-dist bump (step 7).
- [x] Step 7: crate 160, src-tauri 362 + 6 (release), engine-smoke `--patch`,
  hot-reload check, patch-web 173 + `test:browser` 3/3, root typecheck,
  Playwright patch suites 60 and layout 136, all passing. On gate master as
  `a7b4347..6d9e6c0` (CI Checks and Web dist green); site dev web-dist bump
  `46ce1cb` (web-dist `d78266a`) and README `78b4211`, Workers build green.
- [x] A look at dev.empyreangate.org in Chrome: dropped by Cameron
  (2026-10-21). The same patch-web build was checked locally through
  `PATCH_WEB_DIR` (pictures above).
- [x] Step 8, a Code node's texture Resolution: crate 172 tests (sizes,
  save format, and a knob named `resolution` no longer sizing the texture,
  which it did before), src-tauri 362 + 6 + 3, patch-web 231 + `test:browser`
  9/9, typecheck, Playwright `patch-code` 19 (a new spec for the select and
  what is saved). In Chrome, a Game of Life at 64 dispatches 16 workgroups
  per pass and at 256, 256; at 64 the cells are long streaks on the ring, at
  256 fine dots.

## Open questions for Cameron

None open. (1, a Code node texture's resolution: approved and done, step 8.)

## Things not to do

- Don't add a grid pass to patches without a grid node (single-dispatch rule).
- Don't bind `GRID` into the gate's shared layout: it is at the 8
  storage-buffer limit; the patch pipeline gets its own layout.
- Don't store grids as RGBA8: decaying trails stall at low values.
