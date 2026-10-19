# Field domains: the gate's LEDs vs. the plane

## Goal

Cameron (2026-10-18), while discussing sub-patches with typed inputs and
outputs: "we need a distinction between a data type that matches the shape of
our display, and one that matches things as mapped to a 2d grid".

Settle that distinction in the type system first, because sub-patch
inlets/outlets (the follow-on feature) need it to name their shapes.

## Status

Design only. Nothing is built. Waiting on Cameron's answers below.

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

## Proposal (not yet agreed)

Make the domain part of the shape, alongside grey/colour:

| | Grey | Colour |
| --- | --- | --- |
| **Plane** (continuous 2D, position-keyed) | plane grey | plane colour |
| **LEDs** (one value per physical LED, spoke × pixel) | LED grey | LED colour |

- Plane → LEDs is lossless and free (sample at each LED's position), so it is
  an implicit wire, as scalar → field is now.
- LEDs → plane is lossy and needs a choice (nearest LED, or smooth across
  spoke and ring), so it is an explicit node.
- Transform, warps, blurs and anything that samples elsewhere take plane
  inputs only. Wiring an LED-keyed source into one then needs the explicit
  conversion, instead of silently not moving.
- Output takes LED colour, so plane colour reaches it through the implicit
  conversion.
- `Texture` stays the materialized grid (images, video, feedback). Whether it
  also counts as "plane" data (sample-able anywhere) is open question 2.
- Several LED-keyed generators could become plane-native by hashing angle
  sectors and radial cells instead of `spoke` and `i`. They would look the
  same on the gate and gain Transform. Only `random_field`'s per-LED mode,
  physical indexing and per-LED feedback are LED-keyed by nature.

## Open questions for Cameron

1. Is the split above the one you mean: the gate's spoke × pixel layout vs. a
   continuous 2D plane? Or do you mean a rectangular x/y grid as its own
   materialized type, separate from both?
2. Should the plane be continuous (functions, as fields are now) or
   materialized onto a fixed x/y grid like Texture? Continuous costs nothing
   until something needs neighbours; a grid makes blur and feedback cheap.
   Recommendation: continuous, with Texture as the explicit "render to a grid"
   step.
3. Rewrite the LED-keyed generators that don't need to be (sparkle, meteors,
   spoke chase, starfield) as plane-native? Recommendation: yes, where the
   look survives.

## Progress log

- [x] Survey shapes, `Ctx`, and which kinds key on the physical LED
  (2026-10-18)
- [ ] Cameron's answers to the open questions
- [ ] Then: sub-patch inlets/outlets (Patch in / Patch out nodes), using the
  agreed shapes

## Things not to do

- Don't start sub-patch inlets/outlets before the shapes are settled; their
  port shapes depend on this.
