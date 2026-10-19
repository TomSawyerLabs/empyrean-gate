# Compile every patch shader in a real browser

## Goal

The patch core's WGSL is tested only by naga, the compiler wgpu uses on the
desktop app. Browsers compile it with their own: Chrome and Edge with Tint,
Safari with WebKit's, Firefox with naga. Tint is stricter than naga in places,
and one of those reached the dev Preview: the Full random field node's
`a * b ^ c` passed every crate test, but Chrome refused the shader ("mixing
'*' and '^' requires parenthesis"). It was found only because we happened to
render it by hand.

The goal: CI compiles every shader the core can generate (each node kind, each
Select option, wired and unwired, every preset, Convert to Code output) in
Chrome, so a Tint-only rejection fails the build instead of a visitor's
Preview. First, audit what ships today.

## Environment / context

- Gate repo worktree: `C:\Users\camer\.t3\worktrees\Empyrean\browser-shaders`,
  branch `browser-shaders` off origin/master `b519f14`.
- The wasm core exposes `registry()`, `shapes()`, `presets()`,
  `convertToCode`, and `PatchSim` (`wgsl()`, `previewWgsl()`).
  `PatchRuntime.setPatch(doc)` builds the real pipelines and puts any compile
  error in `getStatus().error`.
- The demo page (`packages/patch-web/demo`, vite) exposes `globalThis.rt`.
- CI: `.github/workflows/checks.yml`. The `patch-web` job builds the wasm,
  typechecks, and runs `bun test src`. The `ui` job already installs
  Playwright Chromium and WebKit.

## Decisions already made (don't re-ask)

- Use Chrome's own compiler (Tint), not a re-implementation or a lint for one
  rule: the point is to catch whatever Chrome rejects, including rules we have
  not met yet.

## Plan / steps

1. Audit: compile the whole corpus in local Chrome; list every failure. Done.
2. Fix whatever fails (codegen or `patch_lib.wgsl`), with naga still passing.
   Done.
3. A Playwright spec in `packages/patch-web` that builds the corpus from the
   wasm core and compiles it in Chromium on SwiftShader. Done:
   `browser/corpus.ts`, `browser/shaders.spec.ts`, `playwright.config.ts`,
   `bun run test:browser`.
4. Wire it into the `patch-web` CI job; confirm it runs on the Ubuntu runner.
   ← current (SwiftShader on Linux is unproven until the runner does it)
5. README and plan updates. Done.

## Findings / gotchas

- **No GPU needed.** Playwright's full Chromium (`channel: "chromium"`, new
  headless) with `--enable-unsafe-webgpu --enable-features=Vulkan
  --use-webgpu-adapter=swiftshader` gets a SwiftShader adapter
  (`google/swiftshader`, fallback) and Tint reports the same error Chrome did
  on the bad line. The default `chromium-headless-shell` gets no adapter at
  all, with any flags.
- Playwright WebKit has no `navigator.gpu`, so Safari's WGSL compiler cannot
  be checked this way.
- **Audit result (2026-10-18):** the corpus is 262 documents, giving 294
  distinct shaders. Tint accepts every one: nothing else that shipped is
  refused by Chrome. Module validation takes ~6 s in total.
- **But Perlin noise never finished building on SwiftShader.** The module
  validated in 16 ms; `createComputePipelineAsync` had not returned after
  90 s (a real Intel GPU: 0.55 s for the whole Noise Garden preset). The
  cause was `perlin_grad`, a twelve-case `switch`, inlined eight times per
  `perlin3`. It hangs even at one octave, so the loop was not the problem. A
  branchless form (`select` on bits of `h % 12`) gives bit-identical results
  (`x - y` is exactly `x + (-y)`) and builds in 75 ms. With it, all 294
  pipelines build, the slowest in 1.5 s, ~33 s in total.
- **A stuck build blocks every build after it** in the same GPU process, so
  the spec stops at the first pipeline over budget and names it, rather than
  timing out ten minutes later with no culprit.
- **The corpus found a Convert to Code bug.** An eight-layer Blend converts to
  17 inputs (base, plus an over and an opacity per layer), more than a Code
  node may have (16), so the converted patch could not run. Convert now
  refuses with the reason. The editor used to log a refused conversion to the
  console only; the node panel now shows it under the button.
- **Negative checks:** with `a * b ^ c` put back, naga still passes all 131
  crate tests and the spec fails in 6 s, naming every affected shader with
  the line and Chrome's message. With the `switch` put back, it fails in 22 s
  naming `perlin_noise (main)`.
- `cargo clippy` on the crate fails on existing `3.142` literals in
  `registry.rs`, and the crate is not rustfmt-formatted; CI runs neither, so
  this work leaves both alone.

## Progress log

- [x] Audit the corpus in Chrome (nothing Tint refuses; Perlin hangs SwiftShader)
- [x] Fix failures (branchless `perlin_grad`; Convert refuses a too-wide Blend)
- [x] Browser spec (3 tests, ~45 s locally; both regressions caught)
- [ ] CI: confirm SwiftShader WebGPU on the Ubuntu runner
- [x] README / plan

## Open questions for the user

(none yet)

## Things not to do

- Don't use `chromium-headless-shell` (Playwright's default headless) for
  this: it has no WebGPU adapter.
- Don't write a twelve-way `switch` in a helper that gets inlined many times
  (see Perlin above): SwiftShader may never finish building it.
- Don't keep timing pipelines after one goes over budget: the rest queue
  behind it.
