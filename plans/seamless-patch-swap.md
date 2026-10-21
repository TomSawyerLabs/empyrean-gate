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

1. [ ] `Sim::prepare(doc) -> Prepared` (compile + nothing applied) and
   `Sim::apply(Prepared) -> Update` (classify against the *current* program,
   then install, adopting state at apply time). `update` = prepare + apply.
2. [ ] wasm: `PatchSim.prepare(doc)` returns a `PreparedPatch` (its `wgsl`,
   `previewWgsl`, `previewNodes`, `gridPasses`, `relocateError`) plus
   `PatchSim.needsShader(prepared)` and `PatchSim.apply(prepared)`.
3. [ ] `GateGpu`: split `setProgram` into `build(...) -> GpuProgram` (async,
   installs nothing) and `install(program)` (sync). Build reuses an identical
   in-flight/installed build (same sources) so a knob edit during a build, or
   `restart`, does not compile twice.
4. [ ] `PatchRuntime.setPatch`: prepare; if no shader change apply at once;
   otherwise build while the live sim + pipelines keep rendering, then (if
   still the latest call) apply + install in the same tick. `pending` stays
   (capture waits on it) but no longer holds frames, except for a fresh sim.
   A shader error now leaves the old patch running and active.
5. [ ] Unit test with a fake GPU: frames keep rendering the old program during
   a build; the swap happens on resolve; a superseded build is never
   installed; a knob edit during a build lands.

### Gate app (src-tauri)

6. [ ] Enable wgpu's `std` feature so error scopes are thread-local (without
   it they are global to all threads, and a worker's scope would catch the
   frame loop's errors).
7. [ ] `Engine`: split pipeline building into a `Send` handle
   (`PatchCompiler { device, patch_layout }`) that builds `PatchPipelines` on
   any thread, and `install_patch(pipelines)` on the engine. Pipelines carry
   the id of the engine they were built for.
8. [ ] A background patch builder thread: load + codegen + image decode +
   pipelines for the program bus, the outgoing bus (kept as a standby for the
   next handoff) and the minis bus. Latest request wins.
9. [ ] Frame loop: request a build when `(active_patch, patch_epoch)` changes,
   keep rendering the current patch, install when the matching result
   arrives. Clearing the patch stays immediate.
10. [ ] Handoff installs the standby pipelines (no compile at Take); falls
    back to a synchronous build only if the standby is not for that shader.
11. [ ] Minis install the prebuilt preview pipeline.
12. [ ] Tests: builder unit tests (latest wins, error keeps last good); `cargo
    test`, clippy; engine smoke on the real GPU.

### Ship

13. [ ] Gate: commit per logical step, push `master`; README/docs where the
    behaviour is described. Wait for `web-dist`, then the site bot's bump on
    `dev`; check the playground on the dev Preview.

## Findings / gotchas

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

## Open questions for the user

(none yet)

## Things not to do

- Don't install a build for a document that a newer `setPatch` / patch epoch
  superseded.
- Don't move a pipeline between engines: each bus has its own device.
