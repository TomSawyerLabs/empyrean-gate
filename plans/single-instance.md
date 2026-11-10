# One gate, one process

## Goal

Launching the gate app while it is already running must never leave two
processes alive. Cameron found the show computer (running an older build) with
four gate windows open, some "linked" and some apparently showing different
shows. A second launch should either bring the running window forward and exit,
or take over cleanly. It must never park forever as a silent second instance.

## Environment / context

- Launch path: `src-tauri/src/main.rs` → `lib.rs::run` → `lib.rs::start_backend`.
- Instance detection is by control port (default 9520, `config.server.port`):
  `port_in_use` is a TCP connect to `127.0.0.1:<port>`.
- Endpoints the second launch talks to (all loopback):
  `GET /version`, `POST /focus`, `GET /handover/state`, `POST /handover`
  (`src-tauri/src/server.rs`).
- Every UI window (any process) asks its own process for the configured port
  and connects to `127.0.0.1:<port>`, i.e. to whichever process owns it
  (`src/ws.ts::resolveBase`). So all *connected* windows show one backend.
- A window that cannot reach a backend already shows the "Backend unreachable"
  overlay after 2 s (`src/App.tsx::DisconnectedOverlay`, since `987e911`).
- Process test harness: `scripts/update-flow-test.ts` (real processes, isolated
  config + port 9538).

## Behaviour before this change

1. A running instance NEWER than the new launch: focus it, exit. (Since v0.5.2.)
2. Same or older version running: the new launch always TAKES OVER (two-phase
   handover, old process exits). So double-clicking the icon on a running show
   restarted the backend.
3. Takeover commit failed (old process unresponsive, auth rejected, pre-handover
   build): the new process logged `takeover commit failed … holding sACN until
   the old process releases the control port` and waited **forever**, window
   open, engine running its own copy of the show from disk. Each further launch
   that failed the same way added another one. This is the leading explanation
   for the four windows.

## Decisions already made (don't re-ask)

- Cameron approved all three proposed changes on 2026-11-09:
  same-build relaunch focuses and exits; failed takeover is time-limited; a
  window without a backend says so loudly. The third already exists
  (DisconnectedOverlay), so no new UI work.
- "Same build" = same version AND same executable size AND mtime. A promoted
  launcher copy keeps the source's mtime (CopyFileExW), so it counts as the same
  build; a locally rebuilt dev binary does not, so dev takeover still works.
- Headless exception: if the running instance is headless and the new launch
  has a window, take over as before. Focusing a headless instance would show
  nothing. A headless launch over a running windowed instance of the same build
  exits.
- Older running instances don't report a build identity, so they are treated as
  "different build" and taken over, as today. The fix applies from the first
  release that has it onward.

## Plan / steps

- [x] Diagnose from code (no logs: `empyreangate` offline on the tailnet).
- [x] `/version` reports `{version, exe: {size, mtime_ms}, headless}`.
- [x] `start_backend(headless)`: same build → focus + exit (with the headless
      exception). Pure `decide_launch` with 5 unit tests. `autostart::sync` now
      runs after the decision, so a launch that yields no longer re-points
      launch-at-login at its own (possibly older) exe.
- [x] Failed commit: wait up to 10 s for the port to free; if it doesn't and the
      holder still answers `/version`, focus it and exit. Only an unresponsive
      holder is waited out.
- [x] `scripts/update-flow-test.ts` steps 5 (same-build relaunch exits) and 6
      (a holder that answers but refuses the handover: the newcomer exits).
- [x] `cargo test --lib` 370 passed; update-flow test PASS (all 6 steps);
      `tsc -b` clean; README "One instance at a time" bullet.
- [ ] Ship in the next release (v0.18.0) so the gate gets it on self-update.
- [ ] When `empyreangate` is back on the tailnet: read
      `%APPDATA%/EmpyreanGate/logs/empyrean-gate.log` for `takeover commit failed`
      to confirm what happened in the field.

## Findings / gotchas

- 2026-11-09 6:49 PM PST (02:49Z): the first `cargo build` died with `No space left
  on device`; C: had 0 GB free. `~/.cargo/build` had grown from 150 GB (3 AM prune)
  to 209 GB in one day, mostly one build dir (`db/5435e429051dec/debug`, 32 GB to
  prune). Ran `~/.cargo/prune-build-dir.ps1` by hand (the same thing its 3 AM task
  does): removed 59 GB, back to the 150 GB cap, 66 GB free. A daily cap can't keep
  up with that growth rate, and the other ~780 GB on C: is outside cargo.

- `cargo build` can't overwrite a running exe on Windows, so a dev rebuild is a
  different file anyway (different size/mtime) and keeps taking over.

## Things not to do

- Don't use a named mutex as the guard. The port is the identity everything else
  keys on (handover, focus, UI), and a mutex would block the update successor,
  which must overlap the old process during handover.
