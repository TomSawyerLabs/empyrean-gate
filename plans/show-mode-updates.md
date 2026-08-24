# Updates you can see and steer from show mode

## Goal

Today the update machinery is invisible from show mode and, if `auto_install` is on,
acts without telling you. Cameron's call (2026-08-24), verbatim in substance:

> update mid show as long as the handoff works is ok. maybe add a checkbox to disable
> the auto update? should be available in show mode. Still do download and offer a quick
> update manually if automatic is off. automatically leave show mode at ~9am so that
> automatic self installs work daily even if disabled during a show.

So four things, in priority order:

1. **Keep mid-show installs.** The two-phase handover is what makes them cost a frame;
   no guard on sACN or show mode. Nothing to do here — this is a decision *not* to
   build the guard I proposed.
2. **A show-mode-reachable toggle for auto-update.** Suppress the automatic install for
   tonight without leaving show mode and without going to Settings.
3. **Always stage the download, even when auto-install is off.** So a manual update is
   one tap and instant, rather than a tap and a 40 MB wait.
4. **Leave show mode at a scheduled local time (~09:00).** So a rig left in show mode
   with auto-update suppressed still picks updates up daily, at an hour when nobody is
   watching the array.

## Environment / context

- `updater.rs` — the check loop, `download_and_launch`, promotion. `asset_name()` now
  also picks the AppImage when running as one.
- `config.rs` — `UpdateConfig { auto_check, auto_install }`.
- `protocol.rs` — `status.update_available: Option<String>`, `status.update_state: String`.
- `App.tsx` — `useShowMode` (localStorage `empyrean-show-mode` + Tauri `setFullscreen`),
  `.show-controls` (currently only ⚑ Report and ⤢ Exit), `VersionChip` (inside the
  `<header class="topbar">` that show mode hides).
- Checks: `bun run typecheck`, `test:layout`, `test:behavior`, `cargo test --lib`.
- **`src-tauri/src/config.rs` has a test pinning `tests/fixtures/default-config.json` to
  `AppConfig::default()`.** Any config field must update the fixture in the same commit.

## Decisions already made (don't re-ask)

1. No guard on installing mid-show. The handover is trusted; that is the whole point of
   it. (Reverses the recommendation I made — Cameron's call, and he is right that a
   one-frame swap is not worth blocking on.)
2. The scheduled show-mode exit follows the **existing precedent**,
   `render.phase_reset_at`: an `Option<String>` of `"HH:MM"` in local wall-clock time,
   with `None` meaning never. That field exists for the same class of reason (do the
   visible-but-necessary thing when the Gate is washed out by daylight), so it should
   look the same and use the same `chrono` local-time handling.
3. The new field lives on `UpdateConfig`, not `RenderConfig` — it exists to serve
   updates, and grouping it with `auto_install` is what makes it legible.

## Design

### Staging, split from launching

`download_and_launch` becomes two steps. The check loop stages unconditionally once a
newer version is found; the install request only *launches* what is already staged.

- Already-present versioned sibling of plausible size counts as staged — no re-download
  across restarts, and it composes with the existing "superseded siblings are deleted at
  next startup" cleanup.
- Staging is ~40 MB pulled without being asked. That is the explicit instruction, and it
  is what makes a manual update instant. Worth noting in the README so it is not a
  surprise on a metered link.

`status.update_staged: bool` tells the UI whether a tap installs instantly or downloads
first.

### Show-mode controls

`.show-controls` gains, only when an update is available:

- an install button (label reflects staged vs not), and
- an auto-update checkbox bound to `update.auto_install`.

Deliberately conditional: the show surface is near-empty on purpose, and a checkbox that
is always there costs more than it earns.

### Scheduled exit

`useShowMode` grows a minute-resolution timer: when local wall-clock crosses
`update.leave_show_at` and show mode is on, turn it off. Frontend, because show mode is
frontend — the backend has no notion of it at all (confirmed: no `show_mode` anywhere in
`src-tauri/`).

Fires at most once per crossing. Compare "have we already fired for today's date" rather
than "is it 09:00 right now", so a machine asleep or a tab backgrounded across the
boundary still exits on its next tick instead of missing the day.

## Plan / steps

1. [ ] `config.rs`: `UpdateConfig::leave_show_at: Option<String>`, default `"09:00"`.
       Update `tests/fixtures/default-config.json`.
2. [ ] `protocol.rs` + `types.ts`: `status.update_staged: bool`.
3. [ ] `updater.rs`: split stage/launch; always stage on a found update; report staged.
4. [ ] `App.tsx`: show-mode install button + auto-update checkbox; scheduled exit in
       `useShowMode`.
5. [ ] `styles.css`: the two new show-mode controls.
6. [ ] Settings: expose `leave_show_at` beside the other update settings.
7. [ ] Tests: a behaviour spec for the show-mode controls; a Rust test for the
       HH:MM parse/crossing logic.
8. [ ] README: the staging behaviour and the scheduled exit.

## Things not to do

- Don't guard the install on `output.enabled` or show mode. Explicitly rejected above.
- Don't put the auto-update checkbox on screen unconditionally — show mode is meant to
  be nearly empty.
- Don't let staging re-download something already sitting beside the exe.
- Don't add a config field without updating the fixture; the Rust suite fails on drift,
  deliberately.

## Findings / gotchas

- **Two fixtures, not one.** `config.rs` pins `default-config.json`, and there is a
  second guard on `default-status.json`. Adding `update_staged` to the *status* struct
  failed `default_status_fixture_is_current` until that fixture was updated too. The
  guard earned its keep immediately.
- **The mock backend already had what the tests needed.** `/mock/status?client=<id>`
  patches the status for one client, added by a concurrent session for the sACN
  contention banner. No mock changes were required — worth grepping `tests/` for an
  existing pattern before building one.
- **The "mark today handled on mount" branch is load-bearing.** Without it, switching
  show mode on at 21:00 immediately kicks you back out, because 21:00 is past 09:00.
  Keying on the date the exit last fired, rather than on "is it past the hour", is what
  makes it fire once per day and still survive a machine asleep across the boundary.
- Playwright's `page.clock` drives this honestly: install at 22:00, fast-forward to
  02:00 (still in show mode — catches firing early), then to 09:30 (out — catches never
  firing). The test discriminates both failure directions.

## Progress log

- [x] Established that the backend has no notion of show mode, that the version chip
      lives inside the hidden topbar, and that auto-install is currently unguarded.
- [x] 1. `update.leave_show_at`, default `"09:00"`, + config fixture.
- [x] 2. `status.update_staged` + status fixture + `types.ts`.
- [x] 3. `updater.rs`: `download_and_launch` split into `stage` + `launch`; staging is
      idempotent (an existing plausible sibling is reused across restarts) and happens
      at check time whenever auto-install is off.
- [x] 4. `ShowModeUpdate` component + the scheduled exit in `useShowMode`.
- [x] 5. `.show-update` styles.
- [x] 6. Settings exposes `leave_show_at`.
- [x] 7. `tests/show-mode-updates.spec.ts`, three cases, wired into `test:behavior` on
      both engines. 163 Rust tests, 64 layout cases, 50 behaviour cases all green.
- [x] 8. README.
- [ ] Not done: no test drives an actual staged-then-install round trip. The mock has no
      release to serve, so `stage`/`launch` are covered by reasoning and the existing
      update-flow scripts, not by an automated test.

## Honest note

The first full behaviour run after wiring these in failed both new UI cases on both
engines, and I could not reproduce it in seven subsequent runs. Rather than call it
noise, the readiness helper now waits for `.app.show-mode` to actually be applied
instead of assuming React had got there by the time `data-connected` flipped — which was
a real ordering assumption, and the only one those two cases shared. If it recurs, that
is the place to look first.
