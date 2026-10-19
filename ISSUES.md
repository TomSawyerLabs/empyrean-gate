# Known issues

Short entries that seed a separate fix. Claim one by marking it
`in progress — <thread/branch>` and committing that first.

## `GetState` re-broadcasts the full config to every client

`ClientMsg::GetState` (`src-tauri/src/server.rs`, the `GetState` arm) calls
`state.broadcast_state()`, which serializes and sends the whole `State` to
**every** connected operator-port client, not just the one that asked. A phone
reloading on the LAN costs N full-config sends. Seen while auditing the access
model for `plans/public-floor.md` (2026-10-11); the public listener does not
use it. A per-connection reply (the hello path already builds one) would do.

## Live column A overflows on Linux WebKit at 1400x900 since the Cone shape

The Shapes cluster went from six figures (two rows of three) to seven with the
traffic cone (`e5bcbda`), so `.live-side a` on Live gained a row. With Linux
WebKit's taller font metrics the column overflows the window at the default
desktop size (1400x900) and the Burst pad — the last cluster — sits below the
visible area. Seen on the v0.13.0 release run (2026-10-14): the WebKit project
of `tests/multitouch.spec.ts` ("a synthesized fire swallows…") pressed at the
pad's centre and hit nothing, because `elementFromPoint` landed outside the
scrolled column; the test now scrolls the pad into view first, which hides the
symptom but not the layout. Passes on Windows WebKit and on Chromium, so the
Chromium-only layout gate (`tests/layout.spec.ts`, `MUST_FIT_VERTICALLY` has
Live) cannot see it. Worth a look on a real iPad in landscape, which the
column-balancing comment in `src/Live.tsx` ("span-neutral") was written for.

## `multitouch` duplicate-click test flakes on Windows WebKit

`tests/multitouch.spec.ts` "a synthesized fire swallows the browser's
duplicate click" intermittently sees **2** clicks where it expects 1
(`expect(clicks).toBe(1)`, line ~107), WebKit project only: 1 failure in 4
repeats on clean `master` (faee0ec), 3 in 12 on `patch-crate`, Windows
(2026-10-15). Chromium passes. Looks timing-dependent (the drag router's
swallow window vs WebKit's click delivery under load), not a behaviour change.

## `live-controls` brightness-to-0 test flakes on WebKit under a full run

`tests/live-controls.spec.ts` "brightness can be driven to 0 and back up"
failed once on WebKit in a full `test:behavior` run (Windows, 2026-10-18,
gate 282f593 + a test fix): after dragging the master brightness slider
40 px past its left end, the readout stayed at "0.05" where "0.00" was
expected (`expect(readout).toHaveText("0.00")`, line 62). It passed 36/36
run alone (`--project=webkit --repeat-each=6`). Probably the same
load-dependent drag timing as the `multitouch` flake above; seen while
working on the patch editor, unrelated to it.

## Hover-only `title=` tooltips across the app and the patch editor

About 30 `title=` attributes carry information only a mouse hover reveals
(`grep -rn 'title=' src packages/patch-web/src --include=*.tsx`): the patch
editor's toolbar (Undo/Redo shortcuts, Arrange), the build error chip, the
Sub-patch palette entries, the patch credit, and more in `Live.tsx`,
`Settings.tsx`, `Games.tsx`, `PublicApp.tsx` and others. Cameron's rule: no
`title=` tooltips anywhere, because touch devices (the iPads, phones) never
show them; the information goes inline (a label, hint line or chip) or a
tap-to-expand element, or is dropped. The editor's node view was converted
on 2026-10-17 (ports now carry their shape in `aria-label`); the rest remain.
