# Seamless patch swap — the old patch plays until the new one is built

## Goal

Cameron (2026-10-21): "when a new patch is compiled, can we keep the old
version of the patch running until the compilation is done so it doesn't skip
a beat? on the website and the real app".

Today both runtimes stall while a changed patch's shader compiles:

- **Web runtime** (`packages/patch-web/src/runtime/index.ts`, used by the
  editor's preview and empyreangate.org's playground): `setPatch` updates the
  sim to the new document *first*, then sets `pending`, and `advance` renders
  nothing until `GateGpu.setProgram` resolves. The canvas freezes on its last
  frame for the whole pipeline build (on SwiftShader, up to ~1.5 s).
- **Gate app** (`src-tauri/src/engine/mod.rs`, `run_frames`): the frame loop
  itself loads the patch file, runs codegen, decodes Still images and calls
  `Engine::set_patch_shader`, which builds the pipelines synchronously
  (`create_shader_module` + `create_compute_pipeline` + `block_on(pop scope)`).
  sACN output and the preview freeze for the whole build. The thumbnail bus
  (`minis.rs`) builds the preview module synchronously in the same loop, and a
  handoff (`render_transition_epoch`) builds the outgoing patch into the
  outgoing bus synchronously at the moment the crossfade starts.

Wanted: the running patch keeps rendering, untouched, until the new patch's
pipelines are ready; then the swap happens between two frames, with the new
program adopting phases and timers as it already does.

## Environment / context

- Gate repo `TomSawyerLabs/empyrean-gate`; this work in worktree
  `C:\Users\camer\.t3\worktrees\Empyrean\seamless-swap`, branch
  `seamless-swap` from `origin/master` d502ed0. Lands on gate `master`
  (pushing gate master is fine; ask before release tags).
- Site repo `empyreangate.org` consumes the web package through the gate's
  `web-dist` branch; its "Web dist bump" bot moves the pin to site `dev`.
  Site `master` must not be pushed.
- wgpu 29 in `src-tauri` with `default-features = false`. Each `Engine`
  (program, outgoing/handoff, ready, minis) owns its **own** device, so
  pipelines cannot move between buses.
- Patch crate `crates/empyrean-patch` (`sim.rs`: `Sim::update` compiles and
  applies in one step); wasm wrapper `crates/empyrean-patch-wasm`.

## Decisions already made (don't re-ask)

- Both runtimes, same contract: old program renders until the new one's
  pipelines exist; a superseded build is discarded, never installed.
- A brand-new sim (first patch, `restart`, after `setPatch(null)`) still holds
  frames until its pipeline exists: there is nothing older to show.

## Plan / steps

### Web (patch crate, wasm, patch-web runtime)

1. [x] `Sim::prepare(doc) -> Prepared` (compile + nothing applied) and
   `Sim::apply(Prepared) -> Update` (classify against the *current* program,
   then install, adopting state at apply time). `update` = prepare + apply.
2. [x] wasm: `PatchSim.prepare(doc)` returns a `PreparedPatch` (its `wgsl`,
   `previewWgsl`, `previewNodes`, `gridPasses`, `relocateError`) plus
   `PatchSim.needsShader(prepared)` and `PatchSim.apply(prepared)`.
3. [x] `GateGpu`: split `setProgram` into `build(...) -> GpuProgram` (async,
   installs nothing) and `install(program)` (sync). Build reuses an identical
   in-flight/installed build (same sources) so a knob edit during a build, or
   `restart`, does not compile twice.
4. [x] `PatchRuntime.setPatch`: prepare; if no shader change apply at once;
   otherwise build while the live sim + pipelines keep rendering, then (if
   still the latest call) apply + install in the same tick. `pending` stays
   (capture waits on it) but no longer holds frames, except for a fresh sim.
   A shader error now leaves the old patch running and active.
5. [x] Unit test with a fake GPU: frames keep rendering the old program during
   a build; the swap happens on resolve; a superseded build is never
   installed; a knob edit during a build lands.

### Gate app (src-tauri)

6. [x] Enable wgpu's `std` feature so error scopes are thread-local (without
   it they are global to all threads, and a worker's scope would catch the
   frame loop's errors).
7. [x] `Engine`: split pipeline building into a `Send` handle
   (`PatchCompiler { device, patch_layout }`) that builds `PatchPipelines` on
   any thread, and `install_patch(pipelines)` on the engine. Pipelines carry
   the id of the engine they were built for.
8. [x] A background patch builder thread: load + codegen + image decode +
   pipelines for the program bus, the outgoing bus (kept as a standby for the
   next handoff) and the minis bus. Latest request wins.
9. [x] Frame loop: request a build when `(active_patch, patch_epoch)` changes,
   keep rendering the current patch, install when the matching result
   arrives. Clearing the patch stays immediate.
10. [x] Handoff installs the standby pipelines (no compile at Take); falls
    back to a synchronous build only if the standby is not for that shader.
11. [x] Minis install the prebuilt preview pipeline.
12. [x] Tests: `cargo test`, clippy on the new code; `engine-smoke --patch`
    builds on another thread while rendering, then installs (real GPU); an
    A/B of the whole app, headless, against master (Findings). The frame
    loop itself has no unit test: `run_frames` is one function of locals.

### Ship

13. [x] Gate: commit per logical step, push `master`; README/docs where the
    behaviour is described. Wait for `web-dist`, then the site bot's bump on
    `dev`; check the playground on the dev Preview.

## Findings / gotchas

- **A/B on the real app** (2026-10-21): release builds of `d502ed0` and this
  branch, each run headless in a sandbox (`EMPYREAN_CONFIG=<temp>/config.json`
  with `server.bind` 127.0.0.1, `update.auto_check` false, output off;
  `EMPYREAN_PORT`), probed by a script that watches the preview on one
  socket and saves edits on another. Every shader edit made unique (a Code
  node constant) so the driver's pipeline cache can't hide the compile.
  Worst preview gap per save, with the machine quiet (CPU 13-43 %; the
  preview runs ~35 fps, so ~34 ms is one frame):

  | Edit                          | master `d502ed0`        | this branch            |
  | ----------------------------- | ----------------------- | ---------------------- |
  | none (baseline, 3 s)          | 34 ms                   | 34 ms                  |
  | 8 shader edits, each new      | 73-77 ms, every one     | 33-38 ms (median 34.5) |
  | 4 patch switches (A/B/A/B)    | 117 ms on the first     | 34 ms                  |
  | 8 knob edits (same shader)    | 34 ms (driver cache)    | 33-41 ms               |

  An earlier pair under another session's Playwright load: master 221-327 ms
  on every shader edit, this branch 34-39 ms; a second loaded run of the
  branch was discarded (its own baseline showed 516 ms gaps).
- One socket for both preview and saves conflates two things: the server
  handles a client's messages and its preview frames in one loop, so a slow
  `patch_save` delays that client's frames even when the engine never stalls.
- The probe's hello needs a `client_id` (alphanumeric, `-_.`), or the
  server answers `denied: Invalid client identity.`
- Clippy and rustfmt are not clean on master (`doom/host.rs` denies,
  `registry.rs` PI lints, long-standing fmt drift); only the new code was
  held to them.

- `GateGpu.setProgram` already builds before installing (old pipelines keep
  existing), but the runtime's `pending` flag holds frames, and the sim was
  already switched to the new document, so the old pipeline could not have
  been run anyway (slab layout differs). Hence the prepare/apply split.
- Before this change a shader *error* cleared `pending` with the sim already
  on the new document and the old pipeline installed: a mismatch. Fixed by
  never applying a document whose pipelines failed.
- wgpu 29 without `std`: "With the `std` feature enabled, this stack is
  thread-local. Without, this is global to all threads." (`wgpu/src/api/device.rs`).
  `cargo tree -e features -i wgpu` showed only `vulkan` + `wgsl`.

## Progress log

- [x] Survey both runtimes (2026-10-21).
- [x] Web: crate `Sim::prepare/apply` (c1cf35c), runtime build/install split
  with a fake-GPU unit test (98583cc). `bun test` 230 pass, typecheck clean.
- [x] Gate app: `PatchCompiler` / `BuiltPatch` / `install_patch`,
  `engine/patch_build.rs` worker, frame loop + deferred handoff + standby,
  minis install prebuilt, wgpu `std`. `cargo test --lib --bin engine-smoke`
  362 + 6 pass. `engine-smoke --patch` on the Intel UHD: background build
  13.3 ms, 9 frames rendered meanwhile, worst frame 1.68 ms.
- [x] End to end on a sandboxed headless app (see Findings for how).
- [x] Gate master `9187d1e` (Checks + Web dist green); web-dist `518c8ee`;
  the site bot bumped `dev` (`0fd78f6`). On the dev Preview (Chrome): the
  Playground bundle carries the new runtime (`shaderChanged`), four Code
  node edits through `window.empyrean.setPatch` applied with `ok: true`
  (each ~220-270 ms to install), no console errors. Frame timing could not
  be measured there: Chrome ran the page at ~1 rAF/s (window in the
  background), so the timing evidence is the fake-GPU unit test and the
  gate A/B above.
- [ ] Not done, Cameron's call: a gate release tag, to put this on the
  show machine.

## Open questions for the user

(none yet)

## Things not to do

- Don't install a build for a document that a newer `setPatch` / patch epoch
  superseded.
- Don't move a pipeline between engines: each bus has its own device.
