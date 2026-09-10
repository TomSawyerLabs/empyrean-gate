# Shape definition controls

## Goal

The stamped figures read as blobs more than as figures. The rim is a fixed
`clamp(0.14 * radius, 0.035, 0.11)` and the interior fill is a hardcoded `0.35`,
so a full-size star carries a 0.11-wide outline *and* a lit interior — which is
most of a disc. Give the operator the two knobs that actually control legibility
(**Edge** thickness and **Fill** brightness), reachable from a context menu on
the shape pads rather than a settings tab.

## Environment / context

- `shape_stamp(sd, radius)` in `src-tauri/src/engine/shaders/gate.wgsl` is the
  single place every figure's look is decided; six `case` arms call it.
- The struct triple that must stay in lockstep: `EffectCfg` (serde, what clients
  send) → `GpuEffect` (`#[repr(C)]`, bytemuck) → `struct Effect` in the WGSL.
  Currently 12 scalars. `layers.rs`'s `every_effect_kind_has_a_shader_case` test
  guards the arms; nothing guards the struct layout, so it gets checked by eye
  and by the probe.
- `scripts/shape-probe.ts` renders what the shader actually produces to a PNG by
  diffing two preview frames. It is how the shapes were tuned originally and is
  the only honest check that "thinner" reads better.
- Array geometry: 64 spokes, so the gap between spokes is `rn * TAU / 64` — 0.031
  at the hole, **0.098 at the rim**. That is the floor on what an outline can
  resolve tangentially, and it is not a constant. (An early version of this doc
  said 0.078, which is the pitch at r = 0.8, not at the rim.)

## Decisions already made (don't re-ask)

- **Two knobs, not three.** Edge (outline width) and Fill (interior). A third
  "sharpness" was considered and dropped: narrowing the Gaussian already sharpens
  the falloff, so it would have been a second control for the same effect.
- **The mapping preserves today's look at `edge: 0.5`, but the default is not
  0.5.** Reproducing the old render exactly was the original plan, until the
  probe made it obvious that the old render *is* the complaint. `0.5 / 0.35`
  still means "what it used to look like" so the scale has a known anchor; the
  shipped default is **`edge: 0.3`, `fill: 0.15`** — comfortably above the local
  resolution floor at every radius.
- **Edge is a position above the local resolution floor, not an absolute width.**
  The first version let it go below the spoke pitch on the argument that dotting
  was "the physical trade being asked for". That was wrong: nobody wants a dashed
  star, and the array's limit varies 3.1x with radius, so an absolute width is
  unanswerable anyway. The shader floors it per pixel; the control picks how far
  above. See the antialiasing section.
- **Style is global across shapes, not per-shape.** The complaint is that figures
  in general read as blobs. One style, edited from any shape pad, persisted in
  localStorage next to the live colour and quick-setting preferences.
- **The context menu is the same gesture as the layer one** — `useHoldMenu`, so
  long-press and right-click both work, and the popover shell is extracted from
  `LayerQuickEdit` so the two cannot drift apart.

## Plan / steps

1. `EffectCfg` / `GpuEffect` / WGSL `Effect` gain `edge` and `fill`.
2. `shape_stamp(sd, radius, edge, fill)`, six call sites updated.
3. Extract the popover shell from `LayerQuickEdit` into `QuickPopover`.
4. `shapeStyle.ts` (defaults + persistence) and `ShapeQuickEdit.tsx`.
5. Wire the hold gesture onto the shape pads in Live and Control.
6. `shape-probe.ts` gains `--edge` / `--fill`; look at the result before believing
   it is better.
7. Tests, README, screenshots.

## Antialiasing: what the array's sampling actually is

Normalised to an outer radius of 1, with 64 spokes and 378 px:

| | spacing | vs radial |
|---|---|---|
| radial, along a spoke | 0.0018 | — |
| tangential at the hole (r = 0.32) | 0.031 | 17x coarser |
| tangential at the rim (r = 1.0) | 0.098 | **54x coarser** |

Two consequences. The lattice is wildly anisotropic, and *the anisotropy varies
by 3.1x with radius* — so no constant outline width is right everywhere. The
original fixed `clamp(0.14 * radius, 0.035, 0.11)` was simultaneously too fine to
draw near the rim (it broke into dashes) and needlessly fat near the hole (it
filled in a star's notches).

`shape_stamp` now floors the width at `0.7 * rn * TAU / spokes` — the local
tangential sample spacing — and `edge` positions the outline between that floor
and a fat outline. One setting is then correct at both ends of the spoke, and no
setting can ask for a line the array cannot draw.

**The remaining win, deliberately not taken yet.** The floor above is the
*worst-case* orientation. The correct filter is the anisotropic footprint
projected onto the edge normal, `w = |n·r̂|·Δr + |n·θ̂|·(r·Δθ)`, which would let
edges running radially be ~50x finer than edges running tangentially. For an
exact SDF `|∇sd| = 1`, so the normal is two finite-difference evaluations away —
but the arms would have to be restructured around a `shape_sd(kind, ...)`
dispatcher to evaluate the SDF at neighbouring points. Worth doing; not free.

`fwidth`/`dpdx` cannot help here. They are fragment-shader-only (they difference
across a 2x2 quad of lanes) and this is a compute shader with one invocation per
LED. Subgroup ops would not rescue it either: our tangential neighbour is a
different spoke, 378 elements away in the index.

**Unresolved, and bigger than the width.** `sacn.rs` applies the LED gamma at
packing time and its own comment calls the engine's output "perceptual RGB". So
compositing — including antialiasing coverage — happens in a perceptual space.
Coverage is a linear, area-weighted quantity: a half-covered LED should emit half
the *light*, but writing 0.5 perceptually emits 0.5^2.2 = 0.22. Thin bright lines
on black therefore lose roughly two thirds of their energy, which looks exactly
like "the edges are faint". Fixing it properly is a project-wide colour-management
decision (it would change every layer, pen and effect, not just figures), so it
is written down here rather than changed unilaterally. The 8-bit quantisation
before the gamma LUT is *fine* — perceptual is the right space to quantise in.

## Findings / gotchas

- **The patch renderer carries a second copy of the whole shape system.**
  `engine/shaders/patch_lib.wgsl` has its own `Effect` struct, its own
  `shape_stamp`, and its own six arms. A field added to one and not the other
  does not fail to compile — it silently misreads every field after it, because
  both are bytemuck'd from the same `GpuEffect`. A peer's
  `patch_transient_abi_keeps_full_color_records` test pinning the struct at 48
  bytes is what caught this; it now pins 56 and also asserts both shader copies
  declare the two new fields in the same order.
- **Scaling the clamped width, not the raw one.** `w` was
  `clamp(0.14 * radius, 0.035, 0.11)`. Widening that outer clamp to make room for
  a fatter setting would have quietly changed every full-size figure, because
  `0.14 * 0.91` overshoots the old 0.11 ceiling — the default would have rendered
  differently while claiming not to. The scale multiplies the *clamped* value.
- **The old default was the bug.** The plan started out preserving it exactly.
  The probe made it obvious that a 0.11 outline plus a 0.35 fill is most of a
  disc, which is precisely the "hard to discern" complaint. `edge: 0.5` still
  means "what it used to be" so the scale has an anchor, but the shipped default
  is 0.3 / 0.15.
- **A probe run is only as clean as its config.** The backend repopulates a
  scratch config with the four default layers, so a later probe diffed a figure
  against a live animated stack and produced a colourful mess that looked like a
  rendering bug. Check the baseline frame is actually black; write the scratch
  config with `walk_enabled: false` and `layers: []` and confirm it stayed empty
  after the backend loaded it.
- A greedy regex rewriting the call sites matched into the inner
  `sd_diamond(s.p, s.r)` and put the new arguments on the SDF instead of on
  `shape_stamp`. It typechecked as WGSL right up until naga counted arguments.
  Explicit string pairs, not `.+?`, for edits like this.

## Progress log

- [x] `EffectCfg` / `GpuEffect` / both WGSL `Effect` structs gained `edge`+`fill`.
- [x] `shape_stamp(sd, radius, edge, fill)` in gate.wgsl and patch_lib.wgsl,
      twelve call sites between them.
- [x] Default changed to 0.3 / 0.15 after looking at the probe output.
- [x] `QuickPopover` extracted from `LayerQuickEdit`; both menus share it.
- [x] `shapeStyle.ts` (localStorage + the width/pitch maths), `ShapeQuickEdit`.
- [x] Live and Control shape pads carry the hold gesture; style rides along on
      every stamp from both surfaces.
- [x] `scripts/shape-probe.ts --edge --fill`, and every figure looked at.
- [x] `tests/shape-definition.spec.ts` — 7 cases. Full suite 143 pass, 204 Rust
      tests, typecheck clean. README updated.

## Things not to do

- Don't change one shader's shape code without the other. `gate.wgsl` and
  `patch_lib.wgsl` are independent copies reading the same bytes.
- Don't clamp Edge to the spoke pitch "to stop it looking dotted" — that is the
  control being asked for. Warn, as the menu does, and let the operator choose.
- Don't preserve a default just because it was the default. This one was the
  complaint.
- Don't rewrite shader call sites with a non-greedy regex when the arguments are
  themselves function calls.
