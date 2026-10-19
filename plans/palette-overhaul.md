# Palette overhaul — fewer, better-sorted node types, with pictures

Status: **in progress** (started 2026-10-18).

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

## Groups

| id | Label | Kinds |
| --- | --- | --- |
| controls | Controls | time, slider, globals |
| live | Live input | audio, imu, touch, touch_dabs, tap, effects_in, dj_link |
| media | Media | video_in, image_in, clip, texture_sample |
| shape | Shape a signal | scalar_math, map_range, mix, clamp, smooth, threshold |
| motion | Motion | lfo, envelope, sequence |
| random | Randomness | random, full_random, random_walk, smooth_noise |
| events | Events | counter, toggle, delay, event_merge, event_effect |
| blocks | Building blocks | solid, gradient, gradient_radial, coordinate, perlin_noise, random_field, touch_mask, feedback |
| patterns | Patterns | rainbow, plasma, spiral, radial_waves, wedges, interference, spoke_chase, breathe, sparkle, noise_field, noise_color, fire, meteors, warp, cosmic_drift, earth_current, beat_rings, waveform, spectrum, touch_glow |
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
2. ◀ Registry `group` + TS type + `GROUPS`; tests.
3. Icons (`editor/icons.tsx`) for every kind and group; coverage test.
4. `Palette.tsx`: filter + keyboard, Recent, collapsible groups (remembered),
   details strip, Patterns/Blocks thumbnail grid, Sub-patches group; icons on
   canvas nodes, wire-drop popover, node panel.
5. Thumbnail generator (`scripts/thumbnails.ts`): atlas + scalar traces;
   showcase params/inputs per kind.
6. Stand-ins: hue pull, video stand-in, simulated visitors (runtime + site).
7. Merges: Random family → Random (Mode), Gradient + Radial → Gradient
   (Shape); format 7 migration; presets, convert, docs.
8. Docs (READMEs, agent guide), behaviour spec, push, site README/plan,
   Preview check.

## Findings / gotchas

- Local `master` in the main gate checkout is stale (faee0ec); work from
  `origin/master`.
- `cli/host.ts loadWebGpu` resolves `webgpu` next to the bundle or from the
  cwd: run the bundled generator with cwd = a dir that has `webgpu`
  installed (scratch: `%TEMP%\empyrean-dawn`).

## Progress log

- [x] Survey + plan
- [ ] Groups
- [ ] Icons
- [ ] Palette UI
- [ ] Thumbnails
- [ ] Stand-ins
- [ ] Merges
- [ ] Docs, spec, push, Preview

## Open questions for the user

(none yet)

## Things not to do

- Don't hide any node kind in any host.
- Don't edit `groove.ts`'s DJ deck or the site's DJ fieldset (Agent K).
- Don't bump the site's `bun.lock` by hand (the bot does).
- Don't use `title=` for descriptions.
