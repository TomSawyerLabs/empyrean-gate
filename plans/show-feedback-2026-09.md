# Show feedback, September 2026 — feature requests and fixes

## Goal

Capture every request Cameron brought back from the last show (dictated
2026-09-09) so none are lost, then land them as separate commits. Items are
numbered for cross-reference; each carries its current status and the code it
touches. This file is the single place to look for "did we do X yet".

## Environment / context

- Repo `~/git/Personal Projects/Empyrean`, branch `master`, v0.10.15 shipped.
- Frontend React 19 + Vite in `src/`; backend Rust/Tauri in `src-tauri/src/`,
  frame loop `engine/mod.rs::run_frames`, WebSocket server `server.rs`.
- Checks: `bun run typecheck`, `bun run test:layout`, `bun run test:behavior`,
  `cargo test --lib` in `src-tauri` (local toolchain works).
- Shared working tree: stage files explicitly, append to
  `.agent-commit-coordination` before pushing.

## Decisions already made (don't re-ask)

- Fade times are constants next to `GAME_FADE_SECS`/`TEST_FADE_SECS`, not config
  knobs (carried over from `plans/no-hard-cuts.md`).
- Turning sACN output off stays instant.
- No per-frame allocation on the sACN path.
- `MasterDropDetector`/`AudioBrightnessFollower` taus untouched.
- Each request lands as its own commit ("most of these changes should be
  separate commits").
- Finished plan docs are deleted in their own commit with a one-line
  explanation.

## The requests

### A. Live controls

1. **Cursor colour left, global colour right; global is a slider, not a toggle.
   Same for flourish.** The per-touch (cursor) colour belongs with the tools on
   the left; the global colour and flourish belong with the global settings on
   the right, and neither is an on/off toggle — just a slider that starts at
   zero. Status: DONE — landed in e6f1e96 ("Live controls: color joins the
   tools, toggles become sliders, faders track the finger"): colours moved to
   the left tools column, master hue's checkbox became the Amount slider (0 =
   off), Flourishes became a 0..1 slider. Nothing further to do.
2. **Multitouch: changing colour while another finger is dragging doesn't seem
   to work.** Status: DONE. Root cause: swatches fire on native `click`, and
   browsers only synthesize `click` for the primary pointer — a second finger
   is non-primary, so its tap never landed. `src/dragRouter.ts` now fires the
   pressed pad on release for non-primary pointers (and absorbs a duplicate
   click if a browser sends one). The shared master-fader drag flag became a
   per-pointer Set. Test: `tests/multitouch.spec.ts`.

### B. Layers and taps

3. **Pro controller can turn off all layers, and taps must stop too.** A guest
   VJ turned every layer off in the right panel, but taps (effects/dabs) kept
   rendering. Effects and dabs are composited after the layer stack in
   `gate.wgsl` and are independent of layer enables. Status: DONE (b7bf3ab):
   `render.floor_level` "Floor input" fader on Live + Control master clusters,
   glided in the engine, scales every effect/dab; quick-setting target; Control
   → Layers has All off / All on.
4. **Enable more layers by default, but toggled off.** Default config seeds a
   small stack; ship more kinds in the default stack with `enabled: false` so
   an operator can switch them on without building them. Status: DONE
   (6b8a028): eight tuned shelf layers, `enabled: false`; Ready names the
   program by enabled layers only.

### C. Clients

5. **Connected-clients indicator on the main dashboard, with recent inputs and
   quick disable toggles.** Show the client list in order, with a cutoff line
   where the preview-viewer limit falls. Today: `status.client_list` exists
   (id/name/connected/revoked/admin), the Live status grid shows a bare count
   (`src/Live.tsx` ~677), revoke lives in Settings → Clients, and the only
   "who sent what" record is the 22 s report timeline (`report.rs`), never
   pushed to the UI. Status: DONE (ba3f0bf): `ClientRoster` under the Live
   "clients" stat and as a Control panel — arrival order, last input + age,
   dashed cutoff at the viewer-slot limit, Block/Unblock (revoke is admin-level
   now, not loopback-only).
6. **Ask clients to pick a name, generated two-word default** from a
   festival / Burning Man / nerdy word list. Today: `SetClientName` exists and
   guests may send it, but the only input for it is in Settings (admin-only),
   so guests never see it; default is `device-<last4>`. Status: DONE
   (b710933): `src/deviceNames.ts` mints "Dusty Badger" on first use; ☺ name
   chip in the top bar / phone menu with a rename dialog; pulses until
   confirmed.
7. **Wi-Fi QR next to the connect QR**, credentials entered manually when
   enabled, shown in the full-page connect modal with a big title and simple
   instructions, separated for clean scanning. Plus an admin button that
   produces a PDF/PNG with a longer-term token for event staff to post.
   Today: QR is server-rendered SVG at `/qr.svg` (`qrcode` crate); the join
   token never expires; no Wi-Fi fields in config; no print/PNG export
   anywhere. Status: DONE (0fbe5be): Settings → Clients holds the Wi-Fi
   credentials; ⊕ Connect shows "1 · Join the Wi-Fi" / "2 · Open the show"
   apart; `public/poster.html` (print → PDF, PNG button) carries the new
   `server.staff_token`, which survives "Rotate token".

### D. Preview

8. **Preview must show on the main page toggle even when "off"**, sacrificing
   frames or resolution if needed, or pre-rendering a short beat-synced clip.
   Status: DONE (c220f20), read as: the layer chips on Live had no thumbnail,
   and off layers had none anywhere. The mini bus now renders off-air layers
   on alternate sweeps (lit layers keep 2× refresh, still one extra dispatch
   per frame) and the Live chip shows a dimmed MiniRing.

### E. Windows / GPU

9. **Disable Windows display reconfiguration?** A second monitor got plugged in
   (extra GPU load for base frames), and a flaky USB-C cable connecting and
   disconnecting reset the GPU driver, causing ~0.5 s stutters. Status: DONE
   as far as an app can go (5461cc8): Windows has no supported way to refuse a
   display hot-plug, so `display.rs` watches the topology, logs every change,
   counts GPU re-inits, and banners it — red "flapping cable" at 3 changes in
   10 min — with the fix (pull the extra display). Not done and not possible
   in-app: stopping the reconfiguration itself.
10. **Warn when a low-quality USB-C link is detected.** Evidence was gathered
    over SSH on the live system; encode the detection in code so it works
    without the system online. Status: PARTLY — the topology watcher above is
    the in-code proxy (connect/disconnect churn is the observable symptom of a
    bad link). Sharpening it against the SSH evidence still needs that
    evidence (prompt in "Open questions").
11. **GPU/CPU load histogram/sparkline**, a dismissible toast with details on
    sustained underperformance, and quick load-shedding options (reduce client
    preview frame rate, side render). Status: DONE (4b47535): load sparkline
    (render time as % of the second) on Live + Control; engine-judged
    `load_warning` (85 % load or <85 % of target fps for 8 s) → dismissible
    toast with: cap phone previews at 15 fps (`server.preview_fps_cap`,
    applied live), pause the Ready bus (`render.ready_bus_paused`), render at
    45 fps.

### F. Patch and Ready

12. **Global sidebar indicator of the active patch** (a patch replaces the
    layer stack; only the Patch tab and the Control "Layers" heading know about
    it today). Status: DONE (a457523): PatchChip in the top bar + phone menu.
13. **Patches into the Ready panel.** Ready holds exactly one `SavedStack`
    (layers only); a patch cannot be prepared off-air. Status: DEFERRED with a
    design, not shipped in v0.11.0. Design: `SavedStack` grows
    `patch: Option<PatchDoc>` (a snapshot, not an id, so Take is atomic and a
    later edit to the saved patch does not change what is on Bus B); the Ready
    bus engine compiles it with `set_patch_shader` and runs its own
    `patch::eval::Runtime` (it already owns phases/walks), the Ready tray gets
    a "PATCHES" row next to the scenes, and Take sets `active_patch` instead
    of clearing it. Cost: a second patch runtime + a compile on prepare; the
    engine's `ready_inputs.patch_params = None` guard becomes "the Ready
    runtime's params". About a day; wants its own plan doc.
14. **How many Ready panels? Per-client opt-in? Separate limit?** Today there is
    exactly one global Ready bus with its own GPU engine. Status: OPEN QUESTION
    (see below).

### G. Windows and dialogs

15. **Floating fullscreen-exit button and its siblings cover other buttons;
    move them to the topbar.** Status: DONE (e00e10f): floating pills removed;
    the top bar (which stays in show mode) carries Report/Record/toggle, and
    the update control joins it as a compact row.
16. **Duplicate background windows** are easy to open by accident; a toast in
    the visible window should offer to close background windows idle/invisible
    for a few minutes. Status: DONE (bc6af75): `src/windowSentry.ts` —
    heartbeats in shared localStorage; the focused window offers to close
    others idle 5+ min that are hidden or duplicate its tab, 60 s countdown,
    Close now / Keep them (30 min snooze). Unit test via `bun run test:unit`.
17. **Close warning only on the last window.** Closing an extra window must not
    warn if other windows remain; only the last one shows the close guard.
    Status: DONE: `CloseRequested` counts app windows; only the last (main or
    aux) is guarded, and `confirm_close` closes every window.
18. **After the last window closes and the show stops outputting**, show a
    temporary window (self-closes in ~30 s) with one button: "If that was a
    mistake… Restart Show ASAP? Click HERE". Status: DONE: `ExitRequested`
    with `code: None` on a live show is held; `state.close_grace` darkens the
    wire (termination packets go out) while the engine keeps rendering;
    `public/restart.html` (served by our own HTTP server, loopback POSTs to
    `/close-grace/{resume,exit}`) stays up 30 s; resume recreates the main
    window from config and output fades back up. Compile-checked + page
    served; the window flow itself needs a manual desktop run.

### H. No hard cuts, round two (continuing `plans/no-hard-cuts.md`)

19. **Video playback start fades in** (`video_mix` uniform, ~1 s, smoothstepped
    like `game_mix`; shader scales the Video layer's opacity). Stop stays
    instant. Status: DONE (this session).
20. **Game start fades effects and drawing out instead of dropping them**
    (intensity × `1 − game_mix`, dropped only once the world is fully on;
    reverse on stop). Status: DONE (this session).
21. **Ready-bus layer enable toggles ride the same envelope** as Program.
    Status: DONE (this session). Beat-taps enable and full `SetConfig` remain
    instant (not in scope unless cheap).

## Plan / steps

1. [x] Pull, rebase local commits onto origin.
2. [x] Capture every request here.
3. [x] H19–H21 engine fades (one commit, 9d8613c).
4. [x] A2 multitouch fix (one commit).
5. [x] Plans cleanup: delete finished plan docs (own commit), wrap up stale
       progress logs.
6. [x] B3, B4, D8, F12, G15, G17, G18 — landed, one commit each.
7. [x] C5, C6, C7, E9, E11, G16 — landed, one commit each.
8. [ ] F13 (deferred, design above), F14 (open question), E10 (needs the
       SSH evidence).
9. [x] v0.11.0 shipped: release run 34432222155 green on tag v0.11.0
       (= 3478dab), all four assets published (windows-x64.exe, linux-x64,
       linux-x64.AppImage, macos-arm64). The show machine can self-update.

## Findings / gotchas

- Not exercised on real hardware this session (no Gate machine attached):
  the close-grace window flow (G18), the idle-window sentry closing a Tauri
  window (G16), the display watcher seeing an actual hot-plug (E9). All are
  compile-checked and unit-tested where a pure part exists; first show-machine
  run should try each once.
- The `bun run test:unit` (Bun test runner) is not yet in CI's Checks
  workflow; a peer session had `.github/workflows/*.yml` in flight, so it was
  left alone. Add `bun run test:unit` after `bun run typecheck` there.
- Carried over from deleted plans (2026-09-09 cleanup): `show-mode-updates`
  never got a test that drives a real staged-then-install round trip (the mock
  backend has no installer); if update-flow regressions appear, that is the
  gap. `walk-phase-jitter` left two taste questions for the room: is the 2 s
  `DISCRETE_DWELL` right, and is 12:00 local the right hour for the daily
  phase reset (a visible jump on noise layers)?

## Open questions for the user

1. **F14 Ready panels.** Recommendation: keep one global Ready bus (it owns a
   whole GPU engine); add per-client *private* Ready only if the show needs it,
   with a separate small cap (2–3) because each is a full render bus.
2. **E10 USB-C evidence.** Prompt to hand to the earlier agent is below.
3. Carried from `plans/rdp-window-state-corruption.md` (fix landed, doc
   deleted): should show mode re-assert itself when the console session
   returns after an RDP visit? Related to E9.

### Prompt for the USB-C investigation agent

> This is for the USB-C error-detection work on the Empyrean Gate show
> machine. Earlier you SSH'ed into the live system and gathered direct
> evidence of a low-quality / flaky USB-C link (display or GPU driver resets,
> connect/disconnect churn, stutters). Please append to
> `plans/show-feedback-2026-09.md` under a new heading "USB-C evidence" —
> the exact commands you ran, the exact log lines / event IDs / counters that
> proved it (Windows Event Log source and IDs, WMI/PnP queries, `dxdiag` or
> driver-reset counters, anything else), and which of those an app running on
> the machine could read without a network. Verbatim output preferred over
> summaries.

## Things not to do

- Don't add config knobs for fade times.
- Don't touch the four version files (package.json, Cargo.toml, Cargo.lock,
  tauri.conf.json) — releases are cut separately.
- Don't use HTML `title=` tooltips anywhere in the new UI.
