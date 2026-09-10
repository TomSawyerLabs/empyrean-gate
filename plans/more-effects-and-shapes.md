# More effects and shapes

## Goal

The effect pads had four entries (Burst, Strobe, Swoosh, Collapse). Add more
triggered effects, and add a family of **shapes** — recognizable figures (star,
heart, …) stamped onto the array — as a second pad next to them.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\Empyrean`, branch `master`.
- Effects are transient GPU-side draws, evaluated per pixel in
  `src-tauri/src/engine/shaders/gate.wgsl` (`effect_color`).
- The full surface for adding a kind is small:
  - `src-tauri/src/layers.rs` — `EffectKind` enum, `EffectKind::ALL` (position in
    `ALL` *is* the GPU id), `default_duration`.
  - `gate.wgsl` — one `case` per kind in `effect_color`.
  - `src/types.ts` — `EffectKind` string union (serde snake_case).
  - `src/effects.ts` — the pad list the UI renders and the keyboard binds.
- Array geometry: 64 spokes × 378 px, `rn` spans `inner/outer = 8/25 = 0.32` .. 1.0,
  so **the middle 32% of the radius is a physical hole**. Angular resolution is
  5.6° (0.078 world units of arc at r = 0.8); radial resolution is ~19× finer.
- `cargo test` has `gate_wgsl_validates_with_naga` — the shader is parsed and
  validated by the same naga version wgpu 29 uses, so WGSL mistakes fail in tests
  rather than at runtime on the rig.

## Decisions already made (don't re-ask)

- **Shapes are placed by tapping the array**, not fired from a pad. This was the
  user's clarification mid-task: *"as in for tapping to generate them, either
  static sized, or growing/shrinking."* So a shape pad button **selects** the
  shape as the array's tap tool, the way the pen buttons do, and every press then
  stamps that figure where it lands at the Size slider's size. A tap with no shape
  selected is still a burst; a drag still draws with the current pen.
- **Two new `EffectCfg` fields** carry that: `rotation` (the figure's own spin,
  because `angle`/`radius` are now the tap position) and `grow` (scale drift over
  the life: `1 + grow·t`, so 0 holds, +1 doubles, −1 closes to a point). They took
  `GpuEffect`'s two pad floats, so the GPU struct did not change size.
- **Shapes are their own `EffectKind`s**, not one kind with a shape parameter.
  `EffectCfg` had no free parameter field, and one pad per shape is what a show
  operator wants — a single tap, not a selector then a tap.
- **New kinds are appended to `EffectKind::ALL`**, so the existing GPU ids 0–3 do
  not move. Nothing persists a numeric effect id (reports store the serde name),
  but keeping them stable is free.
- **Control's shape pad fires centre-array instead of selecting**, because that
  tab has no array to aim at. `CENTERED_SHAPE` in `src/effects.ts` is that shot.
- **Shapes render as a bright rim plus a dimmer fill.** Rim width tracks the
  stamp but is clamped to 0.035–0.11 of the array radius: wider than the 0.078
  spoke pitch out at the rim so an edge crossing the spokes reads as a line rather
  than a dotted one, and never so wide that a star's notches fill in. Fill is kept
  at 0.35 so a stamp does not white out the layer stack under it.
- **Exact SDFs (Inigo Quilez's) for star / triangle / moon**, not polar radius
  functions: an exact Euclidean distance gives a uniform rim width all the way
  round. Flower and heart are polar (see Findings for why the heart moved).
- **Keys**: motion effects on `1`–`8` (App-wide, they fire), shapes on mnemonic
  letters `s h f d t m` (Live only, they select — matching what their pads do).
  `App.tsx`'s handler gained a modifier guard so `Ctrl+R` / `Ctrl+1` no longer
  fire an effect as a side effect of adding letter keys.

## Plan / steps

1. ✅ Read the existing effect path end to end (UI pad → ws → state → GPU buffer →
   shader) and the Live layout CSS.
2. ✅ Backend: add 10 kinds to `EffectKind` + durations.
3. ✅ Shader: SDF/stamp helpers and one case per new kind.
4. ✅ Frontend types + split pad lists (`EFFECTS`, `SHAPES`).
5. ✅ `ShapeIcon` glyphs; Live and Control get a Shapes pad; keyboard covers both.
6. ✅ CSS for the shapes cluster in all three Live layout modes.
7. ✅ Tests: naga validation, kind-count/id assertions, `bun run typecheck`,
   Playwright layout + behaviour suites.
8. ✅ README updated.

## The new kinds

Motion (keys 1–8; 1–4 unchanged):

| Kind | What it does |
|---|---|
| Burst | (existing) ring shockwave from the tapped point |
| Strobe | (existing) whole-array flash |
| Swoosh | (existing) bright arm sweeping one revolution |
| Collapse | (existing) wave falling from the rim to the centre |
| Bloom | iris opening outward from the centre, petal-modulated, with a trailing glow |
| Pinwheel | five spiral arms that whip up to speed and fade |
| Twinkle | glitter storm over the whole array, swelling then decaying |
| Wipe | a straight bar sweeping across the disc with a lit wake |

Shapes (keys `s h f d t m`), stamped where tapped, pop-in then hold then fade:

| Kind | Notes |
|---|---|
| Star | 5-pointed, exact SDF, slow spin |
| Heart | polar curve, double-beat pulse on the scale |
| Flower | 6-petal rosette that opens from a circle as it lands, slow spin |
| Diamond | rhombus, exact |
| Triangle | equilateral, exact |
| Moon | crescent, exact |

## Verifying that a star looks like a star

`scripts/shape-probe.ts` is the tool this was built with, and the reason the
shapes are right rather than merely plausible. It connects to a running backend,
subscribes to the preview, and for each named effect captures a frame before the
trigger and one partway through it, then writes the **difference** to a PNG in
`test-results/shapes/`. The difference is what isolates the effect from whatever
layer stack is live, so it works against a real show without touching it.

```
# a scratch config so the layer stack is empty and nothing persists
mkdir -p test-results/probe-config && printf '{"layers":[]}' > test-results/probe-config/config.json
EMPYREAN_CONFIG="$PWD/test-results/probe-config/config.json" \
  src-tauri/target/debug/empyrean-gate.exe --headless &

bun scripts/shape-probe.ts star heart flower diamond triangle moon
bun scripts/shape-probe.ts --size 1 --radius 0.6 --at 0.85 --grow -1 star
```

`shader-hot-reload` is a default feature, so editing `gate.wgsl` and re-running
the probe needs no `cargo build` — only a restart at worst.

## Findings / gotchas

- **WGSL is not GLSL** on three points that bit the port of iq's SDFs:
  - `vec2f - f32` does not broadcast. `p - 0.5*max(p.x+p.y,0.0)` has to be
    `p - vec2f(0.5 * max(p.x + p.y, 0.0))`.
  - `%` on floats is C-style truncation, not GLSL `mod`. The star SDF needs a
    floor-based `fmod_pos` or the wedge folding is wrong for negative angles.
  - `atan2(y, x)` argument order — iq writes `atan(p.x, p.y)`, i.e.
    `atan2(p.x, p.y)`.
- `smoothstep(a, b, x)` with `a >= b` is indeterminate in WGSL, so the Wipe wake
  uses an explicit `clamp` ramp instead of a reversed smoothstep.
- **iq's exact heart SDF renders as a disc here, and was replaced.** Its cleft
  between the lobes is only 0.104 of a 1.104-tall figure — 9%. Under a 0.11-wide
  rim glow on 64 spokes that is not a cleft at all; the probe image was a filled
  blob with two dark corners. The classic polar heart
  `r = 2 − 2sin a + sin a·√|cos a| / (sin a + 1.4)` has a notch that goes all the
  way to the origin and reads instantly. It is measured about the notch, not the
  centre: in heart units the figure is 4.64 × 4.48 and its middle is 1.68 below
  the notch, hence `unit = s.r / 2.32` and the `1.68 * unit` offset.
- **The first rim formula washed out the whole array.** `0.24 × radius` was
  derived from "0.1 world units at `SHAPE_UNIT`", but a centre-array stamp has a
  radius of ~0.9, not 0.38 — so the rim came out at 0.22 and every pixel in the
  ring was within one rim of some edge. The rim now clamps to 0.035–0.11
  regardless of figure size, because the array's resolution does not scale with
  the figure.
- **Twinkle's density was tied to `size` far too steeply** (`0.3 × swell × size`,
  size up to 3) — at a large size it lit 70% of the array, which is a wash and not
  glitter. Now `clamp(0.07 × size, 0.02, 0.35)`.
- The centre hole means a *filled* stamp loses its middle regardless; that is what
  pushed the design to rim-first rather than fill-first.
- **Pre-existing, fixed here: portrait mode crushed every cluster to ~20px.**
  Adding a cluster made it obvious (the committed `docs/live-tall.png` shows the
  same bug with fewer clusters). A cluster is an inline-size *container*, and size
  containment means its intrinsic width is measured as if it had no content — i.e.
  zero. A grid track has a definite width so it never showed, but the portrait
  `flex-flow: row wrap` sizes from content, so every cluster collapsed and spilled
  its labels over its neighbours. It read as overlapping panels; they were 20px
  wide with `overflow: visible`. The portrait block now drops containment and
  `height: 100%` — both are column-mode instructions.
- A `@container live-cluster` rule **cannot style `.cluster.effects` itself** —
  that element *is* the container, and a container query only matches its
  descendants. The button rule inside the same block applied and the
  `grid-template-columns` silently did not, which looked like a specificity
  problem and was not.

## Progress log

- [x] Traced the effect path; confirmed only 4 files define a kind.
- [x] `EffectKind` + `ALL` + `SHAPES` + `default_duration`, ids 0-3 unchanged.
- [x] `EffectCfg`/`GpuEffect`/WGSL `Effect` gained `rotation` + `grow` in the two
      pad floats; three call sites took `..Default::default()`.
- [x] `gate.wgsl`: `fmod_pos` / `rot2` / `shape_scale` / `stamp_frame` /
      `shape_stamp` / `shape_hold` helpers, five figures, ten new `case` arms.
- [x] `src/types.ts` (`MotionEffectKind` / `ShapeKind`), `src/effects.ts`
      (`EFFECTS`, `SHAPES`, `GROW_MODES`, `CENTERED_SHAPE`).
- [x] `src/ShapeIcon.tsx`; Live's shape pad selects the tap tool and its canvas
      stamps; Control's fires centre-array; `App.tsx` ignores modified keypresses.
- [x] `src/styles.css`: `.cluster.shapes` 3-col icon grid, tighter side-column
      effect button, corner stack in the top-left, phone row, portrait repair.
- [x] `scripts/shape-probe.ts`, and every figure and effect looked at as the
      shader actually renders it.
- [x] Rust tests: id stability, a shader `case` arm per kind, serde round-trip.
- [x] `cargo test` (150 pass, naga validates the shader), `bun run typecheck`,
      full `playwright test` (92 pass), `docs/*.png` regenerated.
- [x] README effect list and the stale cluster-count comments updated.

## Things not to do

- Don't reorder `EffectKind::ALL` - the position is the GPU id and the shader
  `case` arms are literal numbers. `every_effect_kind_has_a_shader_case` catches a
  missing arm; only `effect_gpu_ids_are_stable_and_dense` catches a reorder.
- Don't give a shape trigger a random `angle` the way the motion pads do - for a
  shape that is the tap position. `rotation` is the spin.
- Don't raise the shape fill to make stamps brighter - raise the rim. A high fill
  swamps the layer stack, which is the thing the stamp is supposed to sit on.
- Don't reach for a `@container live-cluster` rule to restyle a cluster itself.
- Don't trust a shape by reading the SDF. Run the probe and look at it - every
  problem in the Findings above was invisible in the source and obvious in the PNG.
