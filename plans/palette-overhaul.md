# Palette overhaul — fewer, better-sorted node types, with pictures

Status: **done** (2026-10-19). Gate master up to 43aa016; site dev
4d486cb + bot bump 840f077; checked on the dev Preview (groups, thumbnails,
People, Hue pull, no sideways scroll). Waiting only on Cameron's review of
the calls listed under "Open questions".

## Goal

Cameron: "list of node types needs an overhaul. it's too long." The palette
listed 73 kinds in eight evaluator-shaped groups ("Scalar ops", "Field ops"),
with Generators alone holding 28, finished looks (Fire, Cosmic drift) mixed
with primitives (Solid, Coordinate). Approved in one go ("do all 3 at once",
"boil the ocean"):

1. **Purpose groups**: a UI-only `group` on every registry node, names below.
2. **Generators split** into Building blocks and Patterns; Patterns as a
   thumbnail grid.
3. **Filter box** with keyboard (type, arrows, Enter) and a Recent row.
4. **Merge near-duplicates** (Random family, Gradient + Radial gradient) with a
   patch-format migration — last.
5. "More thumbnails and icons all around": an icon for every node kind and
   group, shown in the palette, on canvas nodes, in the wire-drop popover
   and in the node panel; thumbnails for every node with a picture or a curve.
6. "Don't hide nodes. All nodes should have a browser stand-in at least."

## Environment / context

| What | Where |
| --- | --- |
| Gate repo | `github.com/TomSawyerLabs/empyrean-gate`, commits to `master` (Cameron OK'd master for the gate; ask before release tags) |
| My worktree | `C:\Users\camer\.t3\worktrees\Empyrean\palette-overhaul`, branch `palette-overhaul` → fast-forward gate `master` |
| Registry | `crates/empyrean-patch/src/registry.rs` (`TYPES`, `palette_json`) |
| Editor | `packages/patch-web/src/editor/PatchEditor.tsx` (shared with other agents: keep hunks small), new `Palette.tsx`, `icons.tsx` |
| Thumbnail render | Node + Dawn (`webgpu` package) through `cli/host.ts` `headlessRuntime`; Dawn does not load in Bun |
| Site | `empyreangate.org` `dev` (never master); the web-dist bump bot moves `bun.lock`, never by hand |
| Coordination | `.agents.txt` in the gate's `playground` worktree and the site checkout: Agent L |

Other agents active at the start: J "playground-navigation" (PatchEditor.tsx
browser panel, own worktree), K "dj-link-sim" (runtime/djlink.ts, groove.ts,
site Playground.tsx DJ fieldset). **dj_link's stand-in is K's**; don't touch
groove.ts's DJ part.

## Decisions already made (don't re-ask)

- Group names as proposed (Cameron: "those names are fine").
- Thumbnails and icons everywhere (Cameron: "more thumbnails and icons all
  around please").
- Merges happen, but last.
- No node is hidden in any host; every node gets at least a browser stand-in.
- Groups live in Rust (`Group` enum on `NodeType`, so a new node cannot
  compile without one); labels/icons/order live in the editor (`GROUPS`).
  `category` stays: it is the shape/eval class and drives the `cat-*` colours.
- No `title=` tooltips (tooltips skill): the palette shows the focused or
  hovered node's description in a details strip at its foot.
- Thumbnails ship as one generated atlas of sampled LED colours (64 spokes ×
  24 samples per kind), drawn client-side by `runtime/ring.ts renderRing`, so
  they are tiny and crisp at any DPR. Rendered PNGs were ~6–14 KB each at
  96 px (prototype, 2026-10-18), ~0.5 MB for the set.
- Merges (my call, within "do 4"): Gradient and Radial gradient are *not*
  duplicates (grey ramp vs colour bands), but Radial gradient is exactly
  Rainbow with 0 turns, so it folds into Rainbow. The Random family folds into
  Random with a Mode. With Random alone, the Randomness group went: Random is
  in Motion (11 groups, 69 kinds).
- Mode-only ports/params are a general registry feature (`When`), not a
  Random special case; the palette search also matches Select options so
  "walk" still finds Random · Walk.
- Simulated visitors default **off** on the site (they would change how the
  presets that render effects look); every visitor-driven node's panel
  offers the switch.

## Groups (as built)

| id | Label | Kinds |
| --- | --- | --- |
| controls | Controls | time, slider, globals |
| live | Live input | audio, imu, touch, touch_dabs, tap, effects_in, dj_link |
| media | Media | video_in, image_in, clip, texture_sample |
| shape | Shape a signal | scalar_math, map_range, mix, clamp, smooth, threshold |
| motion | Motion | lfo, envelope, sequence, random (Hold / Every frame / Walk / Smooth) |
| events | Events | counter, toggle, delay, event_merge, event_effect |
| blocks | Building blocks | solid, gradient, coordinate, perlin_noise, random_field, touch_mask, feedback (+ resample, field-domains) |
| patterns | Patterns | rainbow (Turns 0 = the old Radial gradient), plasma, spiral, radial_waves, wedges, interference, spoke_chase, breathe, sparkle, noise_field, noise_color, fire, meteors, warp, cosmic_drift, earth_current, beat_rings, waveform, spectrum, touch_glow |
| color | Color & space | colorize, palette, color_adjust, luminance, field_math, transform, blend |
| draw | Draw streams | render_points, render_effects |
| structure | Structure | subpatch, code, note, output |

## Browser stand-in audit (2026-10-18)

| Kind | Browser today | Gap → plan |
| --- | --- | --- |
| globals | Brightness, Speed sliders | `hue`/`hue_amount` always 0: runtime never calls `setHuePull` → expose it, add a Hue pull control |
| video_in | "Stand-in video…" file picker in the node panel | Black until a file is chosen → a built-in synthetic feed by default (+ camera) |
| tap, effects_in, touch_dabs, touch | Pointer on the preview (Tap/Draw tools) | Black until clicked; locked out when the patch has Touch nodes → "simulated visitors" stand-in (taps, strokes, fingers) |
| imu | Simulate / Use phone motion buttons, hand sliders | OK |
| audio | Synthetic 122 BPM groove by default, mic button | OK |
| dj_link | `grooveDjLink`, frozen | **Agent K's simulator** — not mine |
| image_in, clip | The node's own picture | Same as the gate: black without one. OK |

## Plan / steps

1. ✅ Survey, worktree, `.agents.txt` entries, this plan.
2. ✅ Registry `group` + TS type + `GROUPS` (gate a1dfea9).
3. ✅ Icons for every kind and group, coverage test (3cc6382).
4. ✅ `Palette.tsx`: filter + keyboard, Recent, folds, details strip,
   thumbnail grid, drag onto the canvas; icons on nodes, panel, chooser
   (3cc6382); new nodes clear of the globals card, the foot holds still
   (1ddc1fa). Spec `patch-palette`.
5. ✅ Stand-ins: TestFilm + camera, visitors, hue pull, synthetic motion
   (efd2588); synthetic scope, PNG pictures headless (5413395-ish, rebased).
6. ✅ Thumbnails: `bun run thumbnails`, 44 rings + 20 traces, test, review
   page `demo/thumbs.html`.
7. ✅ Merges, format 7, `When`, option search (55b85c8).
8. ✅ Site: People fieldset (simulated visitors), Video in source buttons
   (film / camera / file), Hue pull + Pull toward in the globals card,
   site motion.ts replaced by patch-web's; specs (site 411bb39). The site's
   palette has a classic scrollbar: grid columns and rows now shrink
   (gate e585a21, ae897ac; spec "a narrow palette never scrolls sideways").
9. ✅ Site README + `plans/pattern-playground.md` (4d486cb); Preview checked
   in Chrome after the 840f077 bump.

## Findings / gotchas

- Local `master` in the main gate checkout is stale (faee0ec); work from
  `origin/master`.
- Recent chips must not carry `.palette-item`: a dozen specs (gate and site)
  click `.palette-item` by text, and a chip repeating an entry made those
  strict-mode violations. Sub-patch entries stay `.palette-sub` only, too.
- Inline descriptions (phone sheet) are `aria-describedby` + `aria-hidden`,
  so a button's accessible name stays its label.
- Under 3 Playwright workers plus other load, 28 patch specs failed by
  timeout; serially (or 2 workers) they pass. Re-run alone before believing.
- `demo/editor.html` (`bun run demo` in patch-web) is the editor over the real
  registry with SwiftShader WebGPU: the quickest visual check.
- **Shared cargo build dir**: `~/.cargo/config.toml` puts every project's
  intermediates in one `build-dir`; the wasm cdylib's file has no hash, so
  two worktrees building at once swapped outputs (my wasm had field-domains'
  `resample`). Build with `CARGO_BUILD_BUILD_DIR=<worktree>/crates/target/build-private`.
- `EMPYREAN_UPDATE_PRESETS=1 cargo test` rewrites presets through serde
  (6,000-line diff, hand formatting lost). Edit preset JSON as text instead.
- The browser shader corpus wired every input of a kind; with modes it must
  wire only the mode's (`applies`), or Convert to Code is (rightly) refused.
- The gate's frontend typecheck runs without a wasm build: the editor must
  never import `runtime/core.ts` (even as a type). `Geometry` lives in
  `runtime/geometry.ts` for that.
- A palette foot that changes height on hover moved entries out from under
  the pointer between mouse-down and mouse-up: fixed height.
- Visitors' taps are seeded and sparse (~0.6/s): thumbnail captures of
  effects take the brightest of 16 frames over ~5 s.
- `cli/host.ts loadWebGpu` resolves `webgpu` next to the bundle or from the
  cwd: run the bundled generator with cwd = a dir that has `webgpu`
  installed (scratch: `%TEMP%\empyrean-dawn`).

## Progress log

- [x] Survey + plan
- [x] Groups
- [x] Icons
- [x] Palette UI
- [x] Stand-ins (runtime)
- [x] Thumbnails
- [x] Merges (format 7)
- [x] Gate READMEs
- [x] Site UI for the stand-ins (411bb39)
- [x] Site README, plan line, Preview check (4d486cb, 840f077)

## Open questions for the user

1. Calls I made inside "do 4": Radial gradient folded into Rainbow (Turns 0)
   instead of into Gradient (they differ: colour bands vs a grey ramp); the
   Randomness group went once Random was one kind. Keep? (Recommend yes.)
2. Simulated visitors start **off** on the site, so presets that render
   effects look as on a quiet night. On by default instead? (Recommend off.)
3. Format 7: the released gate (v0.15.0) refuses patches saved by the
   playground now, until the next release. Cut one when convenient?
4. The shared cargo build dir race (gate ISSUES.md): fix per workspace, or
   keep the workaround?

Cosmetic, not done: in the site's narrower palette, a few long names break
mid-word in the thumbnail grid ("Interferen-ce").

## Things not to do

- Don't hide any node kind in any host.
- Don't edit `groove.ts`'s DJ deck or the site's DJ fieldset (Agent K).
- Don't run `EMPYREAN_UPDATE_PRESETS=1` to bump preset formats (see above).
- Don't build the wasm without a private build dir while other agents work.
- Don't bump the site's `bun.lock` by hand (the bot does).
- Don't use `title=` for descriptions.
