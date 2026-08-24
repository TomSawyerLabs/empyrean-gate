# Autopilot walk × shader phase — the "stuttery / jumpy" layers

## Goal

Two operator feedback bundles filed on 2026-08-24 complain about motion quality:

| id | complaint | layer |
| --- | --- | --- |
| `20260824-060811-f7b23a` | "spoke chase looks stuttery" | SpokeChase, alone |
| `20260824-060718-f98d8c` | "Spiral layer is very jumpy at times" | Spiral, alone |

Both are real, both are reproducible from the bundles, and both are caused by the
autopilot walk feeding parameters into the shader in places where a small
parameter change is *not* a small visual change. Nothing is wrong with the frame
pipeline.

**Status: fixed and shipped (v0.7.1+), not yet verified on the gate.** The
diagnosis below is confirmed against the recorded pixels; the fixes are the
recommended options of each class, implemented as described in "Fixes applied".

Operator description on 2026-08-24, before being shown the diagnosis, which
matches it exactly: *"somethings go super fast. sometimes it looks like they go
backwards … it's only some of the layers … the fire looks good always. the
meteors are stuttery. and it's getting worse over time."* Fire multiplies phase
by a constant and is on the not-affected list; Meteors is a class A kind; "worse
over time" is the uptime term.

## Environment / context

- Gate: `empyreangate`, v0.7.0, Intel Iris Xe (Vulkan), 64 spokes × 352 px.
- Bundles pulled to `C:\Users\camer\AppData\Local\Temp\empyrean-reports\<id>\`
  via `http://empyreangate:9520/reports/<id>/<file>`. Originals live on the gate
  at `C:\Users\entheos\AppData\Roaming\EmpyreanGate\reports\`.
- Both windows: 5 s, 50 frames at 10 Hz, empty timeline (no operator input),
  audio inactive, one layer enabled, `walk_amount` 0.25, `walk_speed` 1.0,
  `walk_depth` 1.0, `master_speed` 1.0.
- Health during both: `fps` 59.999 flat, `frame_time_ms` 0.40, sACN 11520 pps
  across 192 universes, no gpu/sacn errors. **The stutter is not a performance
  problem** — that is the natural first guess and it is wrong.

## Findings

### 1. The walk is white noise at 60 Hz, by construction

`walk_step` (`src-tauri/src/engine/mod.rs:591`) is an OU step run once per
rendered frame with `tau = 45 / walk_speed`. Per frame the deterministic
mean-reversion is negligible (`k = dt/tau = 3.7e-4`) and the innovation term
`gaussian() * sqrt(2k)` dominates: σ ≈ 0.027 in offset units. `walked_layer`
scales param offsets by `0.2 * walk_amount`, so with `walk_amount = 0.25`:

    σ(Δparam_a) ≈ 0.0014 per frame, uncorrelated frame to frame

Over 100 ms that compounds to ≈ 0.0033, which is exactly the per-snapshot
`param_a` jitter seen in both bundles. This is intended behaviour for a *slow
drift*: the position of the parameter wanders on a 45 s scale even though its
increments are white. It only becomes a problem where the shader amplifies the
increment rather than the position.

### 2. SpokeChase: a walked param multiplies the accumulated phase

`src-tauri/src/engine/shaders/gate.wgsl:400`

```wgsl
let speed = 0.2 + L.param_a * 1.5 + aud * A.level * 0.8;
let head  = fract(h + L.phase * speed * 0.2 * dir);
```

`L.phase` is the engine's *accumulated* phase (`mod.rs:1613`,
`layer_phases[i] += speed * master * dt`, f64, never wrapped, reset only when
the layer count changes). Head position is therefore `phase × speed`, so

    Δhead = speed·Δphase        (the intended motion)
          + phase·Δspeed        (an artefact that grows without bound with layer uptime)

Confirmed numerically. Tracking the per-spoke comet head (circular argmax of each
spoke's radial profile) across the 50 frames and least-squares fitting
`shift_px = K·Δparam_a + C·Δphase` gives:

    shift_px = 432.6 · dParamA  +  9.11 · dPhase      (n = 49)

- The `dPhase` coefficient implies a speed factor of **1.035** vs the shader's
  `0.2 + 1.5·param_a` = **1.058** — the model is right.
- The `dParamA` coefficient implies **phase ≈ 33** shader units, i.e. the layer
  slot had been accumulating for ~33 s (uptime was 331 s; phases reset on stack
  resize, `mod.rs:1251`).

At that already-modest phase:

| | per 60 Hz frame |
| --- | --- |
| intended advance | 0.0035 cycles ≈ 1.2 real LEDs |
| walk-induced jump | 0.0135 cycles ≈ 4.7 real LEDs, random sign |

The jitter is ~4× the intended step, uncorrelated frame to frame — a comet that
vibrates more than it travels. Measured 10 Hz displacement bears this out: rms
1.56 px/frame against an intended 0.90 px/frame, with the head running
**backwards** on 9 of 49 frame pairs (and standing still on 7 more), each
reversal lining up with a negative `Δparam_a`.

It gets worse the longer a layer stays in the stack: at 10 minutes of phase the
artefact is ~18× the intended motion; at an hour it is noise.

The `aud * A.level * 0.8` term in the same expression is the same bug with a
much larger driver — with audio live, every level fluctuation teleports the
comets by `phase × 0.8 × Δlevel`. Audio was inactive in both bundles, so this
has probably never been seen for what it is.

**Same pattern, same fix needed, in three more layer kinds:**

| kind | line | offending expression |
| --- | --- | --- |
| Sparkle (8) | `gate.wgsl:411` | `L.phase * (4.0 + L.param_b * 20.0)` |
| Meteors (15) | `gate.wgsl:502` | `L.phase * rate`, `rate = 0.15 + L.param_b * 1.2` |
| Warp (16) | `gate.wgsl:517` | `L.phase * spd`, `spd = (0.5 + L.param_b*2.0) * (1.0 + aud*A.level)` |

Not affected: RadialWaves (`phase * (1.0 + 0.2*fh)`, constant per harmonic),
Interference, Plasma, GradientRadial, NoiseField/NoiseColor, Video rotation
(`param_d` is not in the walk set) — all multiply phase by constants only.

### 3. Spiral: a walked param is floored, so it snaps

`src-tauri/src/engine/shaders/gate.wgsl:375`

```wgsl
let arms  = max(1.0, floor(L.param_a * 12.0));
let twist = (L.param_b * 8.0 - 4.0) * L.scale;
let v0 = sin(arms * ctx.theta + twist * ctx.rn * TAU - L.phase + ...);
```

Here `L.phase` has coefficient 1, so the rotation itself is clean. The problem is
`arms`: the operator's `param_a` is 0.51, i.e. `param_a * 12 = 6.1`, sitting
0.1 above the floor boundary — well inside the walk's wander radius. Every time
the walk dips `param_a` below 0.5 the whole spiral instantly redraws with five
arms instead of six.

Visible in the recorded pixels, not just in the parameters: taking the dominant
angular harmonic of each frame (DFT over the 64 spokes of per-spoke mean
luminance) gives

    6 6 6 6 5 6 6 6 6 6 ... (48 more sixes)

— one flip out, one flip back, inside a 5 s window, matching
`floor(param_a*12)` in the snapshots exactly. At 60 Hz the crossing rate is far
higher than the 10 Hz capture can show. "Very jumpy **at times**" is precisely
right: it happens only while the walked value is parked near a `k/12` boundary,
and does nothing at all elsewhere in the range.

**Same pattern in three more places:** `gate.wgsl:449`
(`turns = floor(param_a*4 + 0.5)`), `gate.wgsl:456`
(Wedges `n = 2 + floor(param_a*14)`), `gate.wgsl:567`
(Video `mirrors = u32(floor(param_b*10 + 0.5))` — `param_b` is walked).

**Two more found while implementing**, both `x > 0.5` direction flips on walked
params, i.e. the same floor-with-two-cells pathology with the most visible
possible consequence — the whole layer reverses:

| kind | line | expression |
| --- | --- | --- |
| SpokeChase | `gate.wgsl:400` | `dir = select(1.0, -1.0, L.param_b > 0.5)` |
| Meteors | `gate.wgsl:301` (`meteor_event`) | `dir_r = select(r01, 1.0 - r01, L.param_c > 0.5)` |

This is the direct answer to "sometimes it looks like they go backwards": with
`param_b`/`param_c` parked near 0.5 the walk flips direction at frame rate.

### 4. Latent, low priority: phase is f32 at the GPU boundary

The engine sends `layer_phases[i] as f32` and originally nothing wrapped it.
Accumulating in f64 is right, but the f32 hand-off quantizes motion once the
value is large: at ~1 hour of layer phase the f32 step is 2.4e-4 (harmless), at
~28 hours it is ~8e-3, i.e. only a couple of representable steps per frame at
speed 1 — visible stepping for an installation left running.

Folding the rate into the accumulator (§ "Fixes applied") made this *sooner* for
three kinds, because their phase now grows at the rate rather than at `speed`.
Sparkle at its fastest runs 24 units/s, which reaches the point where a frame's
0.4 advance rounds to no motion at all in ~3.8 hours — inside a single evening,
not a multi-day run. So this stopped being latent and got fixed; see
"Phase hygiene" below.

## Fixes applied

Both classes took the recommended option. Options 2/3 for class A (drop the
params from the walk, or low-pass them) were rejected: they trade away exactly
the parameters that make those layers interesting and leave the audio term
broken.

### Class A — phase × walked rate → integrate the rate

The shader wants ∫rate·dt but computed phase·rate. Rather than add a second
phase channel, the rate is folded into the *existing* phase integration, because
all four kinds use `L.phase` for nothing else:

- `LayerCfg::phase_rate(audio_level)` in `src-tauri/src/layers.rs` returns the
  kind's rate factor (1.0 for every unaffected kind). It mirrors the shader
  expressions and must be kept in step with them — both sides say so in comments.
- The frame loop multiplies it into `layer_phases[i] += …` at both accumulation
  sites (`engine/mod.rs`, the visible one and the faded-out one).
- The four shader sites now use `L.phase` unscaled: `gate.wgsl` cases 7, 8, 15,
  16. The `speed` / `rate` / `spd` locals are gone.

No new uniform field, no protocol change, and no separate state to transplant.
Nominal behaviour is unchanged (SpokeChase at defaults integrates 0.19 cycles/s,
same as before); what changes is that a rate change is now a rate change instead
of a teleport proportional to uptime. Audio now genuinely speeds those layers up.

`LayerCfg::phase_period()` additionally wraps SpokeChase's phase to 1.0, which is
exact (`fract(h + phase)`) and keeps that kind out of the f32 problem in §4
forever. No other kind has a wrap that is free — see §4.

### Class B — floored params → snap with hysteresis

- `LayerKind::discrete_params()` in `layers.rs` declares, per kind, which of
  `param_a/b/c` the shader quantizes and onto what grid (`floor(v*steps + bias)`;
  `bias` is 0.5 where the shader rounds). Six kinds: Spiral, SpokeChase, Rainbow,
  Wedges, Meteors, Video.
- `walked_discrete()` in `engine/mod.rs` holds the current cell and steps only
  when the walk goes past the boundary by ≥25% of a cell **and** stays there for
  ≥2 s (`DISCRETE_MARGIN`, `DISCRETE_DWELL`). It emits the middle of the held
  cell so the shader lands on it unambiguously.
- An operator slider edit bypasses the dwell entirely: `walked_discrete` tracks
  the cell of the *un-walked* base value and snaps the moment that changes, so
  dragging the arm count is not laggy.

State lives in `LayerWalk::discrete`, so it survives alongside the walk offsets
across scene transitions.

### Tests

`src-tauri/src/engine/mod.rs` gained a `tests` module:

- `gate_wgsl_validates_with_naga` — the layer shader had **no** automated check
  at all before this; the patch codegen did. Parses and validates `gate.wgsl`
  with naga, no GPU needed.
- Four `discrete_walk_*` tests: ignores dithering at the exact 0.51/six-arms
  configuration from the report, steps after a committed excursion, follows an
  operator edit immediately, round-mode grid round-trips.
- `phase_rate_reproduces_the_shader_expressions`.

Also verified against a real device: `cargo run --bin engine-smoke` compiles and
runs the shader on Vulkan (Intel UHD), 1.07 ms mean, 0/120 misses.

## Phase hygiene (the §4 follow-up)

Three mechanisms, applied per kind, so nothing relies on phase staying small:

**Wrap, where a period is exactly invisible.** `LayerCfg::phase_period` now
claims one for every kind whose every use of phase sits inside a trig function
(or a `fract`) with a *constant* multiplier — the period is the smallest value
making each multiplier a whole number of turns:

| kind | multipliers | period |
| --- | --- | --- |
| SpokeChase | `fract(h + phase)` | 1 |
| Spiral | 1 | τ |
| RadialWaves | 1.2 … 2.4 (`1 + 0.2h`, h = 1..=7) | 5τ |
| Plasma | 1, 0.7, 1.3, −1 | 10τ |
| Interference | 0.31, 0.23, 1, 0.8 | 100τ |
| Video | 0.08 | 25τ |

`phase_periods_are_whole_turns_for_every_multiplier` checks the arithmetic rather
than trusting the table.

**Split, where phase is an integer index.** Sparkle, Meteors and Warp hash
`u32(phase)`, so any wrap re-rolls every twinkle, meteor and star at the moment
it happens. `LayerCfg::split_phase` sends the fraction in the existing f32 (full
24-bit resolution, permanently) and the whole number in a new `phase_epoch: u32`
field, taken from the `_pad2` the layer struct already carried — so no change in
size or protocol. Each shader adds its own small per-spoke offset to the
fraction and carries into the epoch, which is exact because both terms are tiny:

```wgsl
let t = L.phase + h0 * 7.0;          // meteors
let epoch = L.phase_epoch + u32(t);
```

Good until the epoch itself overflows u32 — 5.7 years at Sparkle's fastest.
Negative phase (an operator-inverted speed) clamps to zero, which is what the
shaders' `max(t, 0.0)` did before.

**Reset, for the ones with neither.** Fire, NoiseField and NoiseColor feed phase
to fBm/simplex as a z coordinate: no period, no integer to split. The only cure
is to zero the clock, which is a visible jump for every layer at once — so it is
scheduled for an hour when the array cannot be seen. The Gate is outdoors and
washed out by daylight roughly 09:00–17:00, so `render.phase_reset_at` defaults
to local `"12:00"`; `null` disables it, and so does a value that doesn't parse.
The wall clock is consulted once a second, not once a frame, the reset is skipped
while a scene crossfade is in flight (it juggles phases between layer slots), and
a run that starts *after* the hour records the day as done rather than resetting
phases that are seconds old.

This is the one place in the codebase that needs a real timezone rather than the
hand-rolled UTC in `report.rs`, hence a direct dependency on `chrono` — which was
already in the tree, so it costs one crate to compile and nothing else.

## Verification (2026-08-24, this workstation)

Both signatures were re-measured against the fixed build, using the same two
analyses that found them. Method: an isolated headless backend
(`EMPYREAN_CONFIG` in a temp dir, port 9521, bind 127.0.0.1, **sACN output
disabled** so nothing reaches real hardware), one layer in the stack with the
parameters the operator had, autopilot on at `walk_amount` 0.25, left running
60 s, then a 10 s report filed over the WebSocket API and analysed offline.
Harness: `C:\Users\camer\AppData\Local\Temp\empyrean-verify\capture.ts`.

| measurement | original report | fixed build |
| --- | --- | --- |
| SpokeChase: `Δparam_a` coefficient | 432.6 px per unit | **0.2 px per unit** |
| …implied layer phase in the artefact | 33 | **0** |
| …measured vs intended advance | 1.56 vs 0.90 px/frame | **1.00 vs 1.01 px/frame** |
| …frame pairs running backwards | 9 of 49 (7 more stalled) | **0 of 99** |
| Spiral: arm flips | 2 in 5 s | **0 in 10 s** |
| Spiral: `param_a` as rendered | dithering 0.498–0.525 | **pinned at 0.5416667** |

That last row is `walked_discrete` working exactly as designed: 0.5416667 is
6.5/12, the centre of cell 6, so the walk has to commit a real excursion before
the arm count can change at all.

Caveat: this ran on the workstation's Intel UHD, not the Gate's Iris Xe, and for
a minute rather than a night. It confirms the mechanisms are gone, not that a
long show is clean.

## Known remaining instances (deliberately not changed)

### The patch node graph has a weaker version of class A

`src-tauri/src/patch/codegen.rs` ports several `gate.wgsl` bodies, and its
`{phase}` is an integrated wire, so most are already correct — `warp` (line 626)
and `spiral` (361) multiply phase by 1, and `spoke_chase` (463) bakes `dir` as a
literal constant, so none of those can exhibit the bug. Two can, but only if the
user wires the rate input to something varying:

| node | line | expression |
| --- | --- | --- |
| `sparkle` | 479, 482 | `{phase} * tw_rate`, `tw_rate = 4 + {twinkle} * 20` |
| `beat_rings` (meteors body) | 602 | `{phase} * rate`, `rate = 0.15 + {tail} * 1.2` |

Left alone on purpose: the node graph has no autopilot walk driving those inputs,
so the "gets worse over time" failure needs a deliberate patch to provoke, and
the fix would change the semantics of a user-facing node parameter. Worth doing
if anyone reports it, or next time that codegen is opened.

### Nothing on the layer path — see "Phase hygiene" above

## Progress log

- [x] Pulled both bundles off the gate over the tailnet.
- [x] Ruled out fps / GPU / sACN as the cause (status block, fps_history).
- [x] Confirmed SpokeChase artefact quantitatively (head tracking + 2-term fit).
- [x] Confirmed Spiral arm flip in the recorded pixels (angular DFT).
- [x] Swept the shader for both patterns; 4 kinds in class A, 4 in class B.
- [x] Found two more class B sites during implementation: the SpokeChase and
      Meteors direction flips, which are what "goes backwards" refers to.
- [x] Implemented class A (rate integrated CPU-side) and class B (grid snap with
      margin + dwell), with tests and the first naga check on `gate.wgsl`.
- [x] Phase hygiene (§4): wrap where a period is exact, split epoch/fraction for
      the hash-indexed kinds, scheduled daily reset for the noise-driven ones.
      `cargo test` 137 pass; `engine-smoke` runs the shader on Vulkan.
- [x] Verified locally: both signatures gone on an isolated headless instance
      driven with the operators' own layer parameters — see "Verification".
- [ ] **Next (needs you):** cut a release through CI and let `empyreangate`
      update onto it, then re-file a report from the rig after a long uptime.
      Open questions for the room: whether `DISCRETE_DWELL` of 2 s feels right,
      and whether 12:00 local is the right hour for the phase reset (it is a
      visible jump on the noise layers).

## Things not to do

- Don't chase this as a performance/timing problem. Frame pacing was perfect in
  both captures.
- Don't "fix" it by turning the walk down. Lower `walk_amount` scales the
  artefact linearly but so does uptime; it reappears later in the show.
- Don't trust the 10 Hz capture for anything sub-100 ms. It is enough to
  identify these two mechanisms because both leave a signature in the parameter
  stream, but it cannot see 60 Hz frame pacing.
