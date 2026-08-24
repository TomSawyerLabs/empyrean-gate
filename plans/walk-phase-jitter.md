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
pipeline. Fix not yet written — diagnosis below is complete and confirmed
against the recorded pixels.

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
**backwards** on 12 of 49 frame pairs, each reversal lining up with a negative
`Δparam_a`.

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

### 4. Latent, low priority: phase is f32 at the GPU boundary

`mod.rs:1620` sends `layer_phases[i] as f32` and nothing wraps it. Accumulating
in f64 is right, but the f32 hand-off quantizes motion once the value is large:
at ~1 hour of layer phase the f32 step is 2.4e-4 (harmless), at ~28 hours it is
~8e-3, i.e. only a couple of representable steps per frame at speed 1 — visible
stepping for an installation left running. Not what these two reports are about;
worth fixing when the phase plumbing is touched.

## Proposed fixes (not yet implemented — needs a decision)

### Class A — phase × walked rate

The shader wants ∫rate·dt but computes phase·rate. Options:

1. **Integrate the kind-specific rate on the CPU** (recommended). Move the
   `0.2 + 1.5·param_a`-style expressions into Rust, accumulate a second
   per-layer phase alongside the existing one (`layer_phases_kind[i] += rate ·
   l.speed · master · dt`), and pass it as a new uniform field the four kinds
   use in place of `L.phase * rate`. Correct at every frame, removes the uptime
   dependency entirely, and makes audio drive a genuine speed-up instead of a
   teleport. Cost: the rate expression is duplicated CPU-side and must be kept
   in step with the shader.
2. **Drop these params from the walk set per kind** — cheap, no plumbing, but
   loses autopilot variety on exactly the params that make those layers
   interesting, and leaves the audio term broken.
3. **Low-pass the walked value before the shader** — reduces the artefact
   without removing it; still scales with uptime. Not worth it.

### Class B — floored params

1. **Snap the walk to the quantization grid** (recommended): mark discrete
   params per kind, and have `walked_layer` round the walked value to the same
   grid the shader will floor it to, with a dwell/hysteresis (e.g. must exceed
   the boundary by 25% of a step, and hold for ≥2 s) so it steps deliberately
   instead of dithering.
2. **Exclude discrete params from the walk** — simplest; the arm count then only
   changes when the operator changes it.

Either needs a per-kind descriptor of which of `param_a/b/c` are discrete;
`layers.rs` metadata is the natural home.

## Progress log

- [x] Pulled both bundles off the gate over the tailnet.
- [x] Ruled out fps / GPU / sACN as the cause (status block, fps_history).
- [x] Confirmed SpokeChase artefact quantitatively (head tracking + 2-term fit).
- [x] Confirmed Spiral arm flip in the recorded pixels (angular DFT).
- [x] Swept the shader for both patterns; 4 kinds in class A, 4 in class B.
- [ ] Decide fix approach for each class (user).
- [ ] Implement, then re-file a report from the gate to verify.

## Things not to do

- Don't chase this as a performance/timing problem. Frame pacing was perfect in
  both captures.
- Don't "fix" it by turning the walk down. Lower `walk_amount` scales the
  artefact linearly but so does uptime; it reappears later in the show.
- Don't trust the 10 Hz capture for anything sub-100 ms. It is enough to
  identify these two mechanisms because both leave a signature in the parameter
  stream, but it cannot see 60 Hz frame pacing.
