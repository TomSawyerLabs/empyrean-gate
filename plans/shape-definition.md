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
- Array geometry: 64 spokes → **0.078 of the array radius between spokes at the
  rim**. That is the hard floor on what an outline can resolve tangentially.

## Decisions already made (don't re-ask)

- **Two knobs, not three.** Edge (rim width) and Fill (interior). A third
  "sharpness" was considered and dropped: narrowing the Gaussian already sharpens
  the falloff, so it would have been a second control for the same effect.
- **The mapping preserves today's look at `edge: 0.5`, but the default is not
  0.5.** Reproducing the old render exactly was the original plan, until the
  probe made it obvious that the old render *is* the complaint. `0.5 / 0.35`
  still means "what it used to look like" so the scale has a known anchor; the
  shipped default is **`edge: 0.3`, `fill: 0.15`**. 0.3 puts the outline at
  ~0.077 of the array radius — just inside the 0.078 spoke pitch at the rim, i.e.
  the thinnest continuous line 64 spokes can draw.
- **Edge is allowed to go below the spoke pitch.** A hairline outline *will* look
  dotted where the boundary runs tangentially. That is the physical trade being
  asked for, so the control exposes it rather than clamping it away; the floor is
  0.010 purely so the stamp does not vanish.
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
