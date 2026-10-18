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

## The Code node reference lists internals and leaves most helpers undocumented

`codeReference()` (`crates/empyrean-patch/src/reference.rs`) is read off
`patch_lib.wgsl`, so it lists every top-level `fn`, including ones a Code
body must not call (`finish`, which writes the output buffer) or has no use
for (the noise internals `mod289v3`, `permute4`, …, the stamp/effect/dab
helpers), and bindings like `OUT` and `PREVIEW`. Most helpers have no `///`
doc (`hsv2rgb`, `snoise3`, `fbm3`, `hash01`, `wave_at`/`spec_at`, the
`sd_*` shapes), nor do `Ctx.spoke` and `Ctx.i`. Seen while building the
agent guide (`packages/patch-web/src/agent/guide.ts`, which hides `finish`
and the noise internals itself) on 2026-10-17. It matters because the
editor's completion and the agents' guide both show this list as "what a
body may use": a mark for internals (or a `_` prefix the parser skips) and
docs on the helpers would fix both.
