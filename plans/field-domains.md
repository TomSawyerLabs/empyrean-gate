# Field domains: the gate's LEDs vs. the plane

## Goal

Cameron (2026-10-18), while discussing sub-patches with typed inputs and
outputs: "we need a distinction between a data type that matches the shape of
our display, and one that matches things as mapped to a 2d grid".

Settle that distinction in the type system first, because sub-patch
inlets/outlets (the follow-on feature) need it to name their shapes.

## Status

Approved 2026-10-18; building in the `field-domains` worktree
(`C:\Users\camer\.t3\worktrees\Empyrean\field-domains`, branch
`field-domains` → gate master). Coordination: `.agents.txt` in the
`playground` worktree (Agent I, round 2).

## Decisions already made (don't re-ask)

- The split is the gate's spoke × pixel layout (LEDs) vs. a continuous plane.
  (Cameron: "yes".)
- The plane stays continuous (symbolic functions, as fields are now). Texture
  is the explicit "render to a grid" step. (Cameron: "sounds good".)
- A stored rectangular x/y grid as its own type "could be a good idea too":
  logged as future work below, not part of this round.
- Rewrite the generators that are LED-keyed only by accident so they work in
  the plane. (Cameron: "sounds good".)
- Sub-patch inlets/outlets come after this, using these shapes.
- Don't mix commits with other agents' in shared worktrees; this work has its
  own worktree.

## Design (as built)

- `Shape` gains `LedScalar` and `LedColor` (`led_scalar`, `led_color`).
  `FieldScalar` / `FieldColor` keep their names and mean the plane.
- `accepts` judges value type only (grey, colour, scalar), never domain: a
  colour-field input takes a plane or an LED colour. Domain is judged by one
  rule in `validate`, below.
- **Domain inference** (validate, after the topo sort): a node is *LED* when
  one of its outputs is declared `led_*`, when it is a GPU Code node whose
  body reads `c.spoke` or `c.i`, or when any wired field input comes from an
  LED node. Exception: the new Resample node always hands on the plane. An
  LED node's field outputs resolve to `led_*`.
- **Sampled inputs** read their input somewhere other than the LED being
  drawn: Transform's `in` (registry), and a Code node's field input whose
  `<name>_at(` the body calls. An LED source wired into a sampled input is a
  `PatchError::LedSampled` that names the fix (put a Resample between).
- **Resample** (new node, LEDs → plane): Nearest (the LED the position falls
  on) or Smooth (blends the four surrounding LEDs, 4× the upstream cost).
  Transparent outside the ring. Built on a `led_ctx` helper that builds the
  exact `Ctx` of an LED, so any upstream LED function evaluates correctly.
- Plane → LEDs needs no node: sampling at the LED's position is what drawing
  already does.
- `Full random field` is the built-in LED source (its `out` becomes
  `led_scalar`; only that port shape changes, because Agent L is merging the
  Random family).
- The editor mirrors the inference (registry data: `led_*` outputs and
  `sampled` inputs) to draw LED wires distinctly and refuse an LED wire into
  a sampled input at drag time. `validate` stays the authority.

## How it works today

- `Shape` (`crates/empyrean-patch/src/lib.rs`) has two field shapes,
  `FieldScalar` (grey) and `FieldColor`, documented as "a function over the
  polar domain". Both are symbolic: compiled inline into WGSL and evaluated
  once per LED, never stored.
- `Texture` is the only materialized grid: a square RGBA buffer (video, Still
  image, Clip). `texture_sample` maps it onto the disc, its square touching
  the rim.
- The per-LED context (`shaders/patch_lib.wgsl`, `struct Ctx`) carries both
  the physical LED (`spoke`, `i`) and its position (`theta`, `r01`, `rn`,
  `pos`, cartesian with the rim at |pos| = 1).
- So one field type holds two different kinds of data:
  - **Position-keyed** (most of the 73 kinds): a function of where the LED
    is. It can be transformed, warped, blurred and sampled anywhere
    (`name_at(ctx)`), and it looks the same on any LED layout.
  - **LED-keyed** (7 kinds read `c.spoke` / `c.i`: `random_field`,
    `sparkle`, `spoke_chase`, `meteors`, `warp`, `coordinate`'s spoke-index
    output, and the glitter effect in `render_effects`): a function of
    *which* LED. Transform does not move it (`random_field`'s description
    already says so), sampling it elsewhere returns the same LED's value, and
    it looks different with a different spoke or pixel count, including the
    mini previews' shortened spokes.
- Nothing in the types tells the two apart, so Transform, warps and blurs
  silently do nothing to LED-keyed inputs.

## Open questions for Cameron

None open. (Answered 2026-10-18; see Decisions.)

## Findings / gotchas

- Only one built-in node samples a field input elsewhere: `transform`
  (`ctx_transform` rebinds `c`, then reads `in` at it). `texture_sample`
  samples a Texture, not a field. GPU Code nodes can sample with `name_at`.
- `ctx_transform` copies `spoke` and `i` unchanged, which is why LED-keyed
  nodes ignore Transform today.
- `feedback_at` already finds the nearest LED from the position, so Feedback
  is plane-native (it works under Transform, as its description promises).
  It stays a plane source.
- The accidentally LED-keyed code reads `c.spoke` / `c.i` (or
  `ctx.spoke * G.pixels + ctx.i`): `sparkle`, `spoke_chase`, `meteors`,
  `warp`, `coordinate` (its spoke-index output), the glitter effect
  (`render_effects` case 6) and two dab styles (`render_points` cases 2, 6).
  Rewriting them on a position-derived LED cell gives the same look at the
  LEDs and makes them move with Transform.
- `Shape::Pixels` is reserved and used by no port. Left alone.

## Plan / steps

1. Core shapes: `LedScalar` / `LedColor`, value-type `accepts`, labels and
   descriptions. Done.
2. Validate: domain inference, sampled inputs, `LedSampled`. Tests. Done.
3. Codegen: Led variants wherever field shapes are matched; Code nodes may
   declare `led_*` ports; `led_ctx` + Resample node. Tests (naga). Done;
   both entry points now build their context with `led_ctx`.
4. Registry: Full random field → `led_scalar`; Transform `in` sampled;
   Resample; export `sampled` in the registry JSON. Done.
5. Plane-native rewrites: a `led_cell(c)` helper (shared with
   `feedback_at`; added in step 3), then the seven sites above. Done,
   with a guard test (`only_led_kinds_key_on_the_physical_led`).
6. Editor (patch-web): `PatchShape`, `shapeAccepts`, domain mirror, wire
   class and CSS, drag-time refusal, Code panel shape choices, agent guide.
   Tests. Done: `editor/domains.ts` (+ tests), dotted LED wires and square
   ports, drag-time refusal, spec `patch-led-data`.
7. Docs: shape descriptions, agent guide, gate README, site README/plan.
   ← current (shape descriptions and agent guide done)
8. Checks (cargo test, clippy, bun test, typecheck, behaviour + browser
   shader specs), merge to gate master, web-dist bump, Preview check.
9. Then: sub-patch inlets/outlets.

## Future work (not this round)

- A stored rectangular x/y grid type (render a plane field into a texture so
  blur and grid-space feedback are cheap). Cameron: "could be a good idea
  too".

## Progress log

- [x] Survey shapes, `Ctx`, and which kinds key on the physical LED
  (2026-10-18)
- [x] Cameron's answers (2026-10-18)
- [ ] Steps 1–8 above
- [ ] Then: sub-patch inlets/outlets (Patch in / Patch out nodes), using the
  agreed shapes

## Things not to do

- Don't start sub-patch inlets/outlets before the shapes are settled; their
  port shapes depend on this.
