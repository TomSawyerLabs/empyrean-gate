# Open: colour space and anisotropic antialiasing

**Status: unresolved, deliberately.** This is a brief for a fresh agent picking
this up in its own worktree. Nothing here is started. Two independent questions
about how the Gate turns maths into light, both found while making the stamped
figures (star, heart, …) legible, both larger than figures.

Read `plans/shape-definition.md` for how the figures got where they are; this
file is self-contained for the two open problems.

---

## The two questions

1. **Antialiasing is isotropic on a wildly anisotropic array.** The current
   filter width is the *worst-case* orientation. Projecting the sample footprint
   onto the edge normal would let edges running radially be up to ~50× finer than
   edges running tangentially. Not started.
2. **Compositing happens in a perceptual space, but coverage is a linear
   quantity.** A half-covered LED emits 22% of the light instead of 50%. Thin
   bright lines lose about two thirds of their energy. Not changed, because the
   blast radius is every layer, pen and effect.

They interact: (2) is probably why thin edges look faint, and (1) is why they
have to be thick in the first place. Fixing (1) without (2) may just make faint
lines thinner.

---

## Verified facts

Checked in the source, not recalled. Line numbers drift — grep the names.

| fact | where |
|---|---|
| One compute invocation per LED; no fragment stage anywhere | `engine/shaders/gate.wgsl` `@compute fn main` |
| Shader packs float → 8-bit RGB | `gate.wgsl`, `u32(acc.r * 255.0 + 0.5)` |
| Soft clip before packing: linear to 0.8, compressed knee, hard cap | same place, `let knee = vec3f(0.8)` |
| **Gamma is applied only on the sACN path**, via a 256-entry LUT | `sacn.rs`, `gamma_lut`, `*d = self.gamma_lut[*s as usize]` |
| LUT is `out = (in/255)^2.2 * 255`, default `led_gamma: 2.2` | `sacn.rs` LUT build; `config.rs` |
| `sacn.rs` calls the engine's output "perceptual RGB data" in its own doc comment | `send_frame` |
| **The preview fan-out sends the same pre-gamma buffer** | `engine/mod.rs`, `state.preview.send(...)` takes `rgb` before `send_frame`'s LUT |
| The patch renderer has an independent copy of the shape system | `engine/shaders/patch_lib.wgsl` — own `Effect`, own `shape_stamp`, own arms |
| `GpuEffect` is pinned at 56 bytes and both shader copies are asserted in step | `layers.rs`, `patch_transient_abi_keeps_full_color_records` |

### The sampling lattice

Normalised so the outer radius is 1. 64 spokes, 378 px, inner/outer = 8/25 = 0.32.

| | spacing | vs radial |
|---|---|---|
| radial, along a spoke | 0.0018 | — |
| tangential at the hole (r = 0.32) | 0.031 | 17× coarser |
| tangential at the rim (r = 1.0) | 0.098 | **54× coarser** |

Tangential spacing is `rn * TAU / spokes`. Two consequences: the lattice is
extremely anisotropic, **and the anisotropy varies 3.1× with radius**.

---

## Already shipped — do not redo

`shape_stamp` (both shader copies) floors the outline width at `0.7 * rn * TAU /
spokes`, the local tangential spacing, and the operator's `Edge` control picks a
position between that floor and a fat outline. This removed the dashing near the
rim and the notch-filling near the hole. Commit `f3e2c6c`.

That floor is the **worst-case orientation** — it assumes every edge runs
tangentially. That is what question 1 improves on.

---

## Question 1: project the footprint onto the edge normal

The correct filter width for an anisotropic lattice is the footprint projected
onto the direction the signal changes in:

```
w = |n·r̂| · Δr  +  |n·θ̂| · (r · Δθ)
```

where `n` is the unit edge normal, `Δr = 0.0018`, `r·Δθ = rn * TAU / spokes`.
An edge running radially (normal tangential) keeps the wide filter it needs; an
edge running tangentially (normal radial) can be ~50× finer. Figures would get
dramatically crisper in the direction the array can actually resolve.

**Getting `n`.** For an exact SDF `|∇sd| = 1`, so the normal is the gradient, and
the gradient is two finite-difference evaluations away:

```wgsl
let e = vec2f(0.001, 0.0);
let n = normalize(vec2f(sd_at(p + e.xy) - sd_at(p - e.xy),
                        sd_at(p + e.yx) - sd_at(p - e.yx)));
```

**The blocker is structural, not mathematical.** `shape_stamp` receives a *scalar*
`sd`, not the SDF. To evaluate at neighbouring points, the six `case` arms have to
be restructured around a dispatcher — roughly `fn shape_sd(kind: u32, p: vec2f, r:
f32, t: f32) -> f32` — with the per-shape extras that currently live in the arms
(the heart's `beat`, the flower's `open`, the star's and flower's spin) folded in
or passed through. Then `shape_stamp` calls it three times. In **both** shaders.

Cost: 3× the SDF evaluations per shape pixel. 24,192 pixels × up to 32 effects,
on a GPU, at 60 fps — measure it with `cargo run --bin engine-smoke`, but it is
very unlikely to matter.

**`fwidth`/`dpdx` cannot be used.** They are fragment-shader-only — they work by
differencing across a 2×2 quad of lanes, and this is a compute shader. Subgroup
ops would not rescue it either: the tangential neighbour is a different spoke,
`pixels_per_spoke` (378) elements away in the flat index, so no plausible lane
packing puts it in the same quad. The analytic route above is the right one.

**Worth considering instead/as well:** the same reasoning applies to every layer
that draws a hard edge (`beat_rings`, `wedges`, `spoke_chase`, `spiral`), to the
pens in `dab_color`, and to the motion effects. A shared
`aa_width(ctx, normal) -> f32` helper would serve all of them. Whether to
generalise or keep it to figures is a judgement call — figures are where it was
noticed.

---

## Question 2: what colour space is the engine actually in?

The pipeline today: shader composites in some space → clamps to 0..1 → quantises
to 8 bits → sACN applies `x^2.2` → LED PWM.

**The problem.** Antialiasing coverage is a linear, area-weighted quantity: an
LED half-covered by a shape should emit half the light. The shader writes 0.5,
the LUT emits `0.5^2.2 = 0.22`. A one-sample-wide antialiased line therefore
loses roughly two thirds of its energy. This is the classic gamma-incorrect-AA
artifact and it looks exactly like "the edges are faint and hard to see" — which
is where this whole investigation started.

The same argument applies to `apply_blend`'s additive and screen modes, to
`master` scaling, and to the soft clip: all of them are doing linear-light maths
on perceptually-encoded values.

**What is NOT wrong:** quantising to 8 bits *before* the gamma expansion is
correct. Perceptual is the right space to quantise in — that is what gamma
encoding is for. Do not "fix" that.

**Options, roughly in increasing order of blast radius:**

- **(a) Leave it, document it.** It is a deliberate artistic space; many lighting
  tools composite this way and operators are used to it.
- **(b) Gamma-correct only the AA coverage ramp** inside `shape_stamp`. Small and
  contained, but makes figures inconsistent with pens and layers, and the "rim"
  is an artistic brightness profile as much as a coverage estimate, so it is not
  obviously coverage to correct.
- **(c) Composite in linear throughout** and encode once at the end. Correct, and
  changes the look of every existing scene, preset, saved stack and recorded
  performance. Everything the user has tuned by eye shifts.

**This needs Cameron's decision, not an agent's.** (c) is right in a textbook and
possibly wrong for a show that has been tuned against (a) for months. Do the
measurement and present it; do not unilaterally reharmonise the whole instrument.

---

## How to verify — and the trap

`scripts/shape-probe.ts` renders what the shader actually produces by triggering
an effect and diffing two preview frames into a PNG. It is the only honest check
of a rendering change; use it before believing anything.

```bash
mkdir -p test-results/probe && python -c "import json;json.dump({'layers':[],'render':{'walk_enabled':False},'beat_taps':{'enabled':False},'output':{'enabled':False}},open('test-results/probe/config.json','w'))"
EMPYREAN_CONFIG="$PWD/test-results/probe/config.json" ./src-tauri/target/debug/empyrean-gate.exe --headless &
bun scripts/shape-probe.ts --size 2.0 --edge 0 star heart moon
```

`shader-hot-reload` is a default feature, so editing the WGSL needs no rebuild —
restart the backend at worst.

**Trap 1 — the probe cannot see gamma.** The preview fan-out sends the buffer
*before* the sACN LUT. Nothing you do to `led_gamma`, and no gamma change made at
the packing stage, will show up in a probe image. To evaluate question 2 you must
either apply the LUT client-side in the probe (add a `--gamma` flag that maps
`(v/255)^2.2`), or measure on real hardware with a camera. **Do not conclude a
gamma change "looks fine" from a probe PNG.**

**Trap 2 — the scratch config repopulates.** The backend fills an empty config
with the four default layers. A probe run against a live animated stack produces
a colourful mess that looks like a rendering bug. Confirm the baseline frame is
actually black, and re-check `layers` is still `[]` after the backend has loaded
it.

**Trap 3 — two shaders.** `gate.wgsl` and `patch_lib.wgsl` carry independent
copies of the shape system reading the same bytemuck'd `GpuEffect`. A field added
to one and not the other does not fail to compile; it silently misreads every
field after it. `cargo test --lib` catches the struct size and field order.

**Trap 4 — do not rewrite shader call sites with a non-greedy regex.** The
arguments are themselves function calls; `shape_stamp\((.+?), s\.r\)` matches into
`sd_diamond(s.p, s.r)` and puts the new arguments on the SDF. Use explicit string
pairs.

---

## What is the agent's call, and what is not

**Agent's call:** the dispatcher refactor and the normal-projected width
(question 1). It is strictly better, it is verifiable in the probe, and it
changes only how crisp figures are — no scene retuning. Do it, measure it with
`engine-smoke`, show before/after probe images.

**Cameron's call:** anything in question 2 beyond measurement. Build the
comparison — probe images with the LUT applied client-side, ideally a photo of
the real array — and present the options. Do not land (c).

---

## Success criteria

- A figure's radially-running edges are visibly finer than its tangentially-
  running ones, at both the hole and the rim, in probe images.
- No dashing at any `edge` setting, at any radius.
- `cargo test --lib` green (both shaders validate through naga, ABI pinned).
- `bun run typecheck` and `npx playwright test` green.
- `engine-smoke` shows no meaningful frame-time regression.
- Question 2 answered with evidence and a recommendation, not a commit.

---

## Context that is easy to miss

- The array is 64 spokes × 378 px, fed from the **outside**: `i = 0` is the outer
  end of a spoke. `ctx.rn` is physical normalised radius (0.32 … 1.0), `ctx.r01`
  is position along the string (0 = outer).
- Effects are transient and additive on top of the layer stack; `shape_hold(t)`
  is their brightness envelope.
- `EffectCfg` → `GpuEffect` → WGSL `Effect` must stay in lockstep, and there are
  two WGSL copies. 14 f32 = 56 bytes today.
- The repo has several agents working in it at once. Announce via the
  `workspace-contention` skill, and stage only your own hunks.
