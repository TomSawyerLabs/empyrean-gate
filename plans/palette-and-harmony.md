# Palette slots and colour harmony as a pattern input

## Goal

Let patterns take their colour from a shared, named palette instead of each layer
carrying a hard-coded hue — and let a layer sit at a *harmonic offset* from a palette
slot (complement, triad, split-complement, analogous) so a stack stays in key when the
palette moves.

Two things Cameron was explicit about (2026-08-23):

- **Tapping a swatch must not re-key the whole piece.** An instant global colour change
  is jarring on a live rig. Colour should move because a slot was *deliberately* changed
  or because it is slowly cycling — not as a side effect of picking a pen colour.
- **There will be more than one colour selector.** Different layers want different
  colours. A single global "live colour" is the wrong shape.

The interesting motion is the **auto-cycle**: a slot drifts through the spectrum on its
own and every layer keyed to it — and to its complement, its triad — moves with it,
staying in harmony the whole way.

## Environment / context

- Colour maths already lands: `src/liveColors.ts` exports `hsvToHex`, `HUE_HARMONIES`
  and `harmonize`. `src/ColorWheel.tsx` is the reusable HSV wheel (commit `97237de`).
  The palette editor should reuse both rather than growing a second definition of
  "complementary".
- Layers today: `LayerCfg` in `src/types.ts` / `config.rs` carries `hue`, `hue_range`,
  `saturation`, `brightness`. The engine resolves the final hue at
  `src-tauri/src/engine/mod.rs:617` — `out.hue = l.hue + w.offsets[2] * 0.12 * a` — which
  is the one place a palette lookup has to slot into.
- **The backend has no concept of a "live colour" at all.** The Live tab's swatch is
  client-side only; it rides along on individual effect and pen messages
  (`EffectCfg.hue`) and is never persisted. Anything palette-driven is new config,
  new protocol, and a new default-config fixture.
- `src-tauri/src/config.rs:840` has a test pinning `tests/fixtures/default-config.json`
  to `AppConfig::default()`. Any config change must update the fixture in the same
  commit or the Rust suite fails — deliberately, so the layout gate never tests a UI
  nobody runs.
- Checks: `bun run typecheck`, `bun run test:layout`, `bun run test:behavior`,
  `cargo test --lib` (in `src-tauri`).

## Decisions already made (don't re-ask)

1. Do **both** of the shapes offered: a per-layer harmony source on the classic layer
   stack, **and** a Patch-graph node. Not one or the other.
2. The harmony set is the full one, not just complement: same, complement,
   split-complement ±150°, triad ±120°, analogous ±30°. Already encoded as
   `HUE_HARMONIES`.
3. Picking a Live swatch does **not** drive the palette. They stay separate concepts;
   binding one to the other, if wanted, is an explicit action.
4. Auto-cycle is the headline feature, not an afterthought.

## Proposed design

### Palette slots

`AppConfig.palette: Vec<PaletteSlot>`, each:

| field | meaning |
|---|---|
| `name` | operator-facing label ("Primary", "Wash", "Accent") |
| `hue`, `saturation`, `brightness` | the slot's colour |
| `cycle_rate` | hue turns per second; `0.0` = static |
| `follows` | `None` = independent, or `Some { slot, harmony }` = derived |

`follows` is what makes cycling coherent: set "Accent" to follow "Primary" at
`complement`, cycle Primary, and Accent tracks 180° away forever. Without it, every slot
would have to be cycled at an identical rate and hand-aligned, which drifts.

Guard: `follows` chains must not form a cycle. Resolve iteratively with a visited set
and treat a loop as `Fixed` rather than looping forever in the render path.

### Layer colour source

`LayerCfg` gains `hue_source`:

- `Fixed` — today's behaviour, `hue` is used as-is. Must stay the default so existing
  stacks and saved scenes are untouched.
- `Palette { slot, harmony }` — hue comes from the slot, offset by the harmony.
  `hue_range`, `saturation` and `brightness` stay per-layer.

Open question 2 below covers whether saturation/brightness should follow too.

### Engine

Snapshot the resolved palette once per frame (advance each cycling slot by `dt *
cycle_rate`, then resolve `follows`), then substitute at `engine/mod.rs:617`. Per-frame,
not per-pixel — it is a handful of floats and the shader already takes `hue` as a
uniform.

Cycle phase lives in engine state, not config, so it is not written to disk 60× a
second.

### Patch node

A `palette` node emitting the resolved slot colour, with slot and harmony as node
params, wired into pattern colour inputs. Reuses the same resolver as the layer path.

### UI

- **Palette editor** — the slot list, each row a swatch opening `ColorWheel`, plus a
  cycle-rate control and the follows/harmony selector.
- **Per-layer selector** on Control: source (Fixed / slot), harmony when a slot is
  chosen, with the `hue` slider disabled and showing the resolved value when not Fixed.
- **Live** — at minimum the palette visible as a cluster so an operator can see what the
  rig is keyed to and nudge it.

## Open questions for the user

1. **Slot count.** Fixed set of three (Primary / Secondary / Accent), or a user-addable
   list? *Recommendation: user-addable, seeded with three.* The `follows` field means
   extra slots are cheap to keep in harmony, and a fixed three will feel short the first
   time a stack wants four.
2. **Does a slot drive saturation and brightness too, or hue only?** *Recommendation:
   hue only by default, with a per-layer "follow saturation/brightness" toggle.* Layers
   deliberately differ in how washed-out they are, and forcing a shared saturation would
   flatten a stack that currently reads as depth.
3. **Where does the palette editor live** — Live, Control, or both? *Recommendation:
   Control owns the editor, Live gets a compact read-and-nudge cluster.* Live is the
   performance surface and already has nine clusters.
4. **Should cycling be beat-locked** as well as free-running — a hue step per bar rather
   than a continuous drift? The rhythm clock is already there and trustworthy
   (`status.rhythm`). *Recommendation: ship free-running first, treat beat-locked as a
   follow-up.*

## Things not to do

- Don't wire the Live swatch to a palette slot implicitly. That is exactly the jarring
  behaviour this design exists to avoid.
- Don't write cycle phase into `AppConfig` — it would thrash the config file and the
  saved-scene diffs.
- Don't change the default of `hue_source`. Existing stacks, saved scenes and the
  default-config fixture all assume `Fixed`.
- Don't re-derive the harmony offsets in Rust from a fresh table of magic numbers
  without pinning them to the same values as `HUE_HARMONIES`, or the wheel's preview
  chips and the rig will disagree about what "triad" means.

## Progress log

- [x] Colour wheel shipped (`97237de`) — reusable, with the harmony offsets exported.
- [ ] Blocked on the four open questions above before the Rust config change.
