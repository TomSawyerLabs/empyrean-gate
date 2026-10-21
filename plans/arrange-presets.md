# Arrange the built-in patches

Status: **in progress (2026-10-21)**, third part: the site tests the arranged layout broke (worktree `C:\Users\camer\.t3\worktrees\empyreangate.org\arrange-tests`, branch `arrange-tests` → site `dev`). DJ Stereo Master Flow shipped: gate `74388f8`, site dev `bbc4f35`, checked on the Preview. Arranging: gate master `9cb8fc7` (ISSUES `640a5ab`), site dev `ee557a2` (bot bump), verified on the Preview., worktree
`C:\Users\camer\.t3\worktrees\Empyrean\arrange-presets`, branch
`arrange-presets` → gate `master`.

## Goal

Cameron (2026-10-20): "We need to 'arrange' all of the built-in patches."
The editor's ⇆ Arrange (`packages/patch-web/src/editor/arrange.ts`, dagre,
left to right by the wires) exists, but the built-in presets were laid out
by hand and by agents: some have nodes on top of each other (Beat Pulse's
`overlay` and `overlay2` share `[630, 250]`), wires running right to left,
nodes at negative coordinates. Every built-in should open looking the way
Arrange leaves it, and stay that way as presets are added or edited.

## Environment / context

- The built-ins: `crates/empyrean-patch/src/presets/*.json` (19 files,
  `include_str!` in `presets.rs`, so they reach the gate, the wasm core and
  the website through web-dist). Format 7, one node per line, edited as text.
  No preset has Sub-patches (no nested `nodes`).
- Arrange in the editor (`PatchEditor.tsx` `arrangeNodes`) feeds dagre the
  nodes' **measured** sizes from React Flow; `arrangeDoc` falls back to
  `DEFAULT_SIZE` (180 × 110) for unmeasured nodes. The agent's `arranged()`
  (`agent/edit.ts`) always uses `DEFAULT_SIZE`.
- Measured sizes depend on what the card shows: a live mini needs the
  WebGPU runtime. The demo editor (`packages/patch-web/demo/editor.tsx`, `bun
  run demo`) runs the real core and runtime; the shader check's Chromium
  setup (`channel: "chromium"` + SwiftShader) gives it a WebGPU adapter.
- `mutateDoc` always pushes an undo step, so the site's spec ("Arrange …
  then Undo enables Redo", `tests/playground.spec.ts` in empyreangate.org)
  still holds when the preset is already arranged.

## Decisions already made (don't re-ask)

- **Arrange exactly as the editor does**, with sizes measured in the real
  editor (desktop viewport, WebGPU on so minis show), not `DEFAULT_SIZE`
  offline: that is what a person pressing ⇆ Arrange on a built-in gets.
- **A re-runnable script**, not a one-off edit: `bun run arrange-presets`
  in `packages/patch-web` (after `build:wasm`). It rewrites only the `pos`
  of each node line, keeping the files' text layout.
- **A size-independent guard** in the unit tests rather than "Arrange is a
  no-op": measured sizes change whenever a node card changes, and an exact
  check would fail all presets for a cosmetic change. The guard: in every
  built-in, every wire runs left to right, and no two nodes overlap at
  `DEFAULT_SIZE`.

- **DJ Stereo Master Flow ships as the 19th built-in** (Cameron, 2026-10-21,
  "Finish and ship it"): its `flow` node is a Code node with the id, ports
  and knobs `stereo_flow` was given, so all 60 wires and both exposed knobs
  stand; no new registry kind for one preset.
- Its left/right is **`c.pos.y`**, as the gate is drawn: the preview
  (`runtime/ring.ts`) puts spoke 0 at the bottom, so screen-right is +y
  (`touch.rs` says the same, and Transform's mirror flips that axis). The
  first draft used `c.pos.x` and lit top/bottom instead.

- **Both** for the cropped opening view (Cameron, 2026-10-21): the editor's
  `minZoom` is 0.2 (gate `c348981`), and the site's tests pan the canvas to
  the node they click (`tests/canvas.ts` `bringIntoView`), so they no longer
  depend on a patch fitting the window.

## Plan / steps

1. Demo editor exposes its `PatchEditorHandle` (`globalThis.editorRef`).
2. `scripts/arrange-presets.ts`: Vite dev server for the demo, Chromium
   with SwiftShader WebGPU, for each preset file: open a copy, wait for the
   cards to be measured and stable, `editor.arrange()`, read the positions,
   rewrite the `pos` fields.
3. Run it; check every preset in the editor by eye (screenshots).
4. Unit test `src/editor/presets-arranged.test.ts`.
5. README (patch-web + gate) mentions the script; commit; push gate
   master; the site's web-dist bump follows on its own.

## Findings / gotchas

- Playwright and Vite's `createServer` both run fine under Bun on Windows,
  so the script is plain `bun scripts/arrange-presets.ts` (unlike
  `thumbnails`, which needs Node for Dawn).
- Minis only show on the **active** patch (`live` in `PatchNode`:
  `activeId === data.docId`), and `open(doc, true)` blanks the id. The
  script opens each preset under `arrange-<id>` instead, so it is editable
  (not `builtin-`) and active.
- Code Ripple Warp's Code node spans several lines (its `code` object), so
  the rewrite walks `"id"` / `"pos"` pairs inside `"nodes"` rather than
  assuming one node per line.
- Before: 15 of 19 built-ins had wires running right to left and/or nodes
  overlapping at the default card size (Beat Pulse: `overlay` and `overlay2`
  both at `[630, 250]`). After: none. A second run of the script changes
  nothing; parsed JSON with `pos` removed is identical to master's.
- **DJ Stereo Master Flow is not a built-in** (corrected 2026-10-21): the
  file sits in `presets/` but has never been in `SOURCES` (`presets.rs`), so
  there are **18** built-ins, not 19; the script arranged it only because it
  reads every file in the folder. Its `flow` node has kind `stereo_flow`,
  which never existed anywhere (Allison's `75da7b1`, 2026-08-25, added the
  file only; no T3 checkpoint has an implementation either). Commit
  `9cb8fc7`'s message and README said nineteen; `0bcd1af` corrects the
  README.
- `codegen::compile` silently drops a node of unknown kind, so
  `all_presets_compile_and_render` would pass a registered preset like this
  one. `0bcd1af` makes the test also require `validate()` to pass.

- **The arranged presets are wider, and the playground opens them cropped**
  (found 2026-10-21 via the site's ISSUES entry "Two playground tests fail
  every time on Firefox/WebKit at dev `ee557a2`"). At 1280×720 the
  playground's canvas is 504 px wide; the editor sets no `minZoom`, so React
  Flow's default 0.5 caps `fitView`, and Rainbow Sparkle (the opening
  patch) needs ~0.33. Output sits at x = 1290 in a 1280 window in every
  browser. Chromium's tests pass only because its scroll-into-view scrolls
  the canvas's overflow-hidden container; Firefox and WebKit refuse
  ("element is outside of the viewport"). The navigation test's new
  Sub-patch lands at the canvas centre among the cards and its double-click
  fails on WebKit.

## Progress log

Site tests (third part):

- [x] `minZoom` 0.2 alone was not enough: at that zoom Rainbow Sparkle fits,
  but the open Gate globals card (bottom right) covers Output, and Chromium
  failed too. `bringIntoView` drags the canvas background until the node
  sits a third of the way in.
- [x] Both tests pass on all three browsers with the new zoom and with the
  published web-dist; full site suite on local patch-web 309 passed,
  36 skipped; gate `patch-` specs 64 passed; typecheck and unit tests pass
- [x] Pushed gate `c348981` and site dev `9dc260c`; bump `da283bc`
- [x] On the Preview (real Chrome with WebGPU) the zoom floor works (0.47)
  but Output and a Blend still hung 186 px past the right edge: the opening
  fit runs before the cards grow (measured, then minis once the preview
  runs). Pressing fit-view afterwards gave 0.33 and everything in view.
- [x] Editor: after a patch opens the view refits whenever a card changes
  size, until the person moves the view (`onMoveStart` with an event) or
  edits (`mutateDoc`). Spec `tests/patch-fit-follow.spec.ts` (fails without
  the refit); gate `test:behavior` 177/178 (the one failure the known WebKit
  `multitouch` flake from ISSUES.md, 6/6 run alone); site suite on this
  patch-web 309 passed, 36 skipped
- [ ] Commit, push, bump, check on the Preview


DJ Stereo Master Flow (second part):

- [x] Validate guard in `all_presets_compile_and_render` (`0bcd1af`)
- [x] `flow` as a Code node; checked by eye with fixed inputs (moving left,
  moving right, centred) and in the full preset: 60/60 wires, no error
- [x] Added to `SOURCES`; `every_preset_file_is_listed` test
- [x] cargo test 161/161, patch-web tests 212/212, typecheck, `test:browser`
  (Chrome's compiler, every preset) 3/3, re-arranged
- [x] Gate master `74388f8`, CI green; site dev `bbc4f35` (bump dispatched by
  hand: GitHub ran the 15-minute schedule only every few hours); on the
  Preview 19 built-ins, `flow` is a Code node at the committed position,
  `validate` returns no errors

Arranging:

- [x] Demo exposes the editor handle (`globalThis.editorRef`)
- [x] arrange-presets script
- [x] Presets arranged and eyeballed (screenshots of all 19 in the demo)
- [x] Guard test (39 tests; fails on master's Beat Pulse as intended)
- [x] Docs: patch-web README (script), gate README (nineteen presets, arranged)
- [x] Checks: root + patch-web typecheck, patch-web tests 212/212, `cargo test -p empyrean-patch` 160/160
- [x] Gate master `9cb8fc7`, CI green (Checks, Web dist); site dev `ee557a2`; on the Preview `window.empyrean.preset("Beat Pulse")` has the committed positions

## Open questions for the user

(none)

## Things not to do

- Don't arrange with `DEFAULT_SIZE` offline: cards are taller than 110 px
  with params and minis, so the result is not what Arrange gives.
