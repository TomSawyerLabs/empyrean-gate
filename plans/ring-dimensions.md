# Ring dimensions: the Gate is 60 ft, not 50

## Goal

The repo described the Gate as a 50 ft ring (outer radius 25 ft, inner 8 ft) and
shipped that as the default geometry. It is a 60 ft ring. Use the real dimensions from
the 2022 design drawings everywhere: the docs, the default geometry and everything that
copies it.

## Environment / context

- Branch `ring-dimensions`, worktree `~/.t3/worktrees/Empyrean/ring-dimensions`, PR
  against `master`.
- Source of the dimensions: Entheos "Empyrean Gate: Details" sheets A-06 and A-07,
  dated 2022-04-28, sent by the user 2026-10-22 ("They should be pretty accurate").
  Not in the repo. Transcribed with confidences in the Empyrean Upgrades repo,
  `docs/v1-hardware.md`, sections "Structure and geometry" and "From the 2022 design
  drawings".

| Dimension | Drawing | Feet |
| --- | --- | --- |
| Truss circle outside (Tomcat TC 1212-60D16B, 12") | 60'-0" dia. | r 30.00 |
| Truss circle inside | about 58'-0" dia. | r 29.0 |
| Sail outer edge | 57'-11¾" dia. | r 28.99 |
| Sail inner edge | 13'-0⅛" dia. | r 6.505 |
| Sail radial length | 22'-5⅞" | 22.49 |
| Inner ring (custom Tomcat) | 13'-0" dia. | r 6.5 |
| Strip, 378 px at 60/m | 6.3 m | 20.67 (first to last pixel 20.61) |

## Decisions already made (don't re-ask)

- **Outer radius 28.99 ft**: the config field is where pixel 0 sits, not the truss.
  Strips are fed from the outside (confirmed 2026-08-23), off the truss, so pixel 0 is
  at the sail's outer edge, just inside the 58 ft truss inner edge.
- **Inner radius 8.38 ft**, not the sail's 6.5 ft: the field is where the *last* pixel
  sits, and 378 px at 60/m cannot reach the hub. 28.99 − 377/60 m (20.61 ft) = 8.38.
  Spreading 378 px over the full 22.49 ft sail would imply 55 LED/m, which is not a
  strip anyone sells; 30/m would need 41 ft. So 60/m it is, and about 1.9 ft of each
  sail by the hub is bare (or the strip starts a little in from the outer edge; not
  measured either way).
- **Saved configs on the old default move on their own** (user, 2026-10-25: "why?
  can't we force fix it?"). PR #6 first left them alone: `GeometryConfig` is
  `serde(default)`, but every saved config carries a geometry, so the new default
  never reached the show machine. Now `load()` calls
  `GeometryConfig::migrate_old_default_radii`: a config with exactly 25 / 8 ft gets
  28.99 / 8.38 and is written back, once. Radii anyone set by hand stay. It reaches
  the show machine with the next release (self-update).
- **The games' `HOLE = 0.32` stays** (logged in `ISSUES.md`): retuning five game sims is
  its own job.
- Historical plan docs that quote 0.32 (`doom.md`, `game-mode.md`, `hidden-modes.md`,
  `classic-games.md`, `rendering-gamma-and-aa.md`) describe the design at the time and
  are left as written. `Replay.tsx`'s 0.2416 is the archived Uprising recordings' own
  geometry and is left alone.

## What the change does at runtime

Only the ratio inner/outer reaches rendering: every pixel's normalised radius is
`rn = mix(1, inner/outer, r01)` (`gate.wgsl`, `patch_lib.wgsl`). The ratio goes from
0.320 to 0.289, so a spoke's inner pixels sample fields about 0.03 of the radius
closer to the centre: radial and Cartesian patterns (rings, shapes, Transform, images,
video) shift slightly inward at the hub and are unchanged at the rim. The previews
(operator GateCanvas, public schematic, report contact sheet) draw a smaller hole.
Absolute feet appear only in the Settings sanity check, which now reads consistent
(20.7 ft of strip, 20.6 ft span) where 25 / 8 warned (20.7 vs 17.0).

## Progress log

- [x] Default geometry 28.99 / 8.38 (`src-tauri/src/config.rs`), comments cite the
      drawings.
- [x] Copies of the default ratio: `crates/empyrean-patch/src/sim.rs`,
      `packages/patch-web/src/runtime/index.ts` (`GATE_GEOMETRY`),
      `engine_smoke.rs` (now reads the config default), `scripts/shape-probe.ts`,
      `scripts/game-probe.ts`.
- [x] Settings radius fields step 0.01 ft so the slider can hold the default.
- [x] README intro, this plan, `plans/empyrean-gate.md` (marked as corrected
      2026-10-22).
- [x] `ISSUES.md`: the games' fixed hole.
- [x] Regenerated `tests/fixtures/default-config.json` and the palette thumbnails
      (`thumbs.gen.ts`: the 33 spatial kinds changed; spoke- and strip-based ones such
      as Solid, Gradient and Spoke chase came out identical, as they should).
- [x] Checks, 2026-10-22 on Windows: `cargo test --lib` 364 passed, `crates` 172,
      `cargo check --bin engine-smoke`, `bun run typecheck`, `test:unit` 240,
      patch-web typecheck + `test` 231 + `test:browser` 9, layout gate 136 passed /
      8 skipped, behaviour 182 passed.
- [x] PR opened against `master`.
- [x] Migration of saved 25 / 8 configs on load, with a unit test (2026-10-25).
- [ ] Not done: `docs/*.png` screenshots still show the old hole (32 % vs 29 %); a
      `bun run screenshots` pass would also pick up unrelated UI drift, so it is left
      for a screenshots refresh.

## Open questions for the user

1. ~~Apply the new geometry on the show machine?~~ Automatic now, from the next
   release on. Still worth looking at a few radial patches on the rig after it.
2. If anyone measures where the strip starts on a sail, the inner radius can be
   tightened (outer = start, inner = start − 20.61 ft).

## Things not to do

- Don't set the outer radius to 30 ft (the truss) or the inner to 6.5 ft (the sail):
  the fields are pixel positions, and the pixel pitch would come out 9 % too coarse.
