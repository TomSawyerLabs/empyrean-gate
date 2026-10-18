# Noise nodes

Status: **done (2026-10-18)**: on gate `master` and the site's dev Preview., worktree
`C:\Users\camer\.t3\worktrees\Empyrean\noise-nodes`, branch `noise-nodes`
→ gate `master`.

## Goal

Cameron (2026-10-18): "add some noise generator blocks. Full random, random
walks, perlin noise field (with different harmonics)." The palette had
Random (sample and hold) and two coloured simplex generators (Noise field,
Color noise), but nothing that is plain noise you can wire into anything.

## Environment / context

- Crate: `crates/empyrean-patch`. A node is a registry entry
  (`src/registry.rs`: `TYPES`, plus `is_cpu_kind` / `is_gpu_kind`), and then:
  - CPU (Scalar/Event) kinds: a `match` arm in `src/eval.rs`; optionally a
    Convert-to-Code script template in `src/convert.rs` (`cpu_template_kind`
    + `cpu_template`), checked frame by frame against the built-in by
    `check_template` when deterministic.
  - GPU (field) kinds: a WGSL body in `src/codegen.rs` `body_of`. Helpers go
    in `shaders/patch_lib.wgsl`; every top-level `fn` with a `///` doc there
    shows up in the Code node reference automatically (`src/reference.rs`).
    GPU kinds convert to Code automatically (`gpu_kinds_convert_and_compile`).
- Every registry kind is compiled by `codegen::every_registry_kind_compiles`
  and must describe every port and param (`every_node_port_and_param_is_described`).
- The site playground and the gate both read the registry from the crate
  (wasm build / backend); the gate app's UI tests use a two-node mock registry
  (`scripts/mock-backend.ts`) and are unaffected.
- FieldScalar wires into a colour input as grey, so a grey noise field can go
  straight into Output, or through Colorize / Palette / Field math.

## Decisions already made (don't re-ask)

- Both tiers where the ask is ambiguous ("full random" and "random walk" did
  not say control value or picture). Five nodes:
  1. **Full random** (`full_random`, CPU): a fresh value every frame in
     Min..Max; Distribution Uniform / Bell. xorshift seeded by node id, like
     Random.
  2. **Random walk** (`random_walk`, CPU): Brownian wander (Wander = typical
     travel per √second as a fraction of the range, × master speed), Pull
     back toward the middle, a `step` event that jumps by Jump, `reset` back
     to the middle; Edges Bounce / Wrap / Stick.
  3. **Smooth noise** (`smooth_noise`, CPU): 1-D Perlin over time with
     Harmonics, Roughness, Spacing; the scalar sibling of the field.
     Hash is `fract(sin(x) * 43758.5453)` in both eval and its Code
     template, with the id-derived offset baked into the template, so the
     conversion matches the built-in exactly.
  4. **Perlin noise** (`perlin_noise`, GPU, grey field): classic 3-D gradient
     noise (new `perlin3` / `perlin_fbm` in patch_lib.wgsl), Scale,
     Harmonics (octaves 1..8), Roughness (amplitude ratio), Spacing
     (frequency ratio), Style Smooth / Billowy / Ridged, Contrast, Speed
     (evolution, integrated), Seed.
  5. **Full random field** (`random_field`, GPU, grey field): per-LED white
     noise ("static"), re-rolled Rate times a second (integrated), Grain
     LED / Spoke / Ring, Seed.
- No field random walk: a per-pixel walk needs per-pixel state (Feedback
  could fake it); not asked for clearly enough to build.

## Plan / steps

1. [x] Registry entries (+ `is_cpu_kind` / `is_gpu_kind`).
2. [x] eval.rs arms + unit tests (determinism, range, bounce/wrap, pull, reset).
3. [x] patch_lib.wgsl `perlin3`, `perlin_fbm`; codegen bodies; rendered in Chrome.
4. [x] Convert templates for the three CPU kinds; `check_template` for Smooth noise.
5. [x] Preset "Noise Garden" (`presets/noise-garden.json`).
6. [x] Pushed (gate `81f8724`, Checks green), web-dist `2522ca8`, site bump `fa7c389` on `dev`; the Preview's palette lists all five and the preset.

## Findings / gotchas

- **naga is laxer than Chrome's WGSL compiler (Tint).** `a * b ^ c` passed
  every crate test (naga-validated) but Chrome refused it: "mixing '*' and
  '^' requires parenthesis". Parenthesize mixed bitwise/arithmetic; only a
  real browser render catches it.
- **Rendering locally:** `bun run build:wasm` then `bunx vite --config
  demo/vite.config.ts` in packages/patch-web, and headless Chrome with
  `--enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist`
  (the T3 preview browser has no WebGPU adapter). The demo exposes `rt`
  (`rt.setPatch(doc)`). The first ~6 s after page load render dark (start-up),
  so warm up on one patch before judging another.
- **Perlin normalization:** dividing the octave sum by the sum of weights
  shrinks the spread as harmonics grow (Smooth spanned ~0.35..0.65 and read
  as flat grey). Measured with a numpy port of `perlin3` (200k samples):
  with root-sum-square normalization Smooth has sd 0.27 at 1, 4 or 8
  harmonics; |n| has mean 0.22, (1-|n|)² mean 0.633. Gains chosen so the
  2nd..98th percentiles land at about 0..1: Smooth 0.5 + 0.9·s, Billowy
  0.4 + 1.6·s, Ridged 0.5 + 1.15·s.
- CPU nodes read params directly; `integrate` (rate) only matters for GPU
  slab params, so CPU kinds accumulate their own phase (as LFO does).

## Progress log

- [x] 2026-10-18: five nodes, preset, crate tests 130/130 (3 new eval
      tests, 1 new convert test, Smooth noise in `check_template`), patch-web
      unit 58/58, typecheck clean; all nine field variants and the preset
      rendered in headless Chrome (WebGPU).
- [x] 2026-10-18: shipped; Preview palette and preset menu checked.

## Open questions for the user

(none yet)

## Things not to do

- Don't work in the shared `playground` worktree (branch `patch-crate`).
