# RDP into the gate machine corrupts the show window state

## Goal

Stop an RDP session into the gate computer from (a) thrashing the app window
during connect and (b) permanently persisting the RDP session's window geometry
over the real show geometry.

## Environment / context

- Gate machine: `empyreangate`, Windows, user `entheos`.
  - SSH: `ssh empyreangate` → `empyreangate.headscale.tomsawyerlabs.com`, user `entheos`.
  - Tailnet IP `100.64.0.2`, LAN IP `10.255.15.5`.
- App: `C:\Users\entheos\Desktop\empyrean-gate-v0.5.7.exe` (self-updating, runs
  from Desktop). Observed as PID 4056 during this session.
- Config dir: `%APPDATA%\EmpyreanGate\` (config.json, logs\empyrean-gate.log).
- Window state: `%APPDATA%\com.empyrean.gate\.window-state.json` — written by
  `tauri-plugin-window-state` 2.4.1.
- Web UI / control server: port 9520 on the gate machine.

## Findings

### The app itself is healthy — this is not a runaway loop in our code

Measured 2026-08-23 ~11:28 local, while an RDP session was active:

- `empyrean-gate` PID 4056: **0.7% of machine** CPU over a 5 s sample.
- All `msedgewebview2` children combined: **2.5% of one core** over 5 s.
- `empyrean-gate.log` tail is clean — no errors, no warnings. Last entry is
  normal startup at `2026-08-23T18:25:10Z` (11:25:10 local):
  engine on `Intel(R) Iris(R) Xe Graphics (Vulkan)`, server on `0.0.0.0:9520`.

So whatever the visible thrash was, it was **window-manager level**, not a hot
loop in the Rust engine or a runaway ResizeObserver in the webview.

### The 5 s rewrite of `.window-state.json` is ours and is benign

`.window-state.json` mtime advances every **exactly 5.00 s**:

```
11:29:09.928  mtime=11:29:06.462
11:29:11.494  mtime=11:29:11.465
11:29:16.021  mtime=11:29:11.465
11:29:17.538  mtime=11:29:16.470
```

That is `src-tauri/src/lib.rs:363-370` — a deliberate thread:

```rust
// The handover exit path is process::exit, which skips graceful window
// teardown — save window state periodically so at most ~5 s of window
// moves can be lost.
loop {
    std::thread::sleep(std::time::Duration::from_secs(5));
    let _ = handle.save_window_state(StateFlags::all());
}
```

**Do not "fix" this by removing the timer** — it exists so a self-update
handover (`process::exit`) doesn't lose window geometry. See "Things not to do".

### What RDP actually did

`query session` while connected:

```
>services                          0  Disc
 rdp-tcp#0   entheos               1  Active
 console                           4  Conn
 rdp-tcp                       65536  Listen
```

RDP **took over** the `entheos` console session. Consequences:

1. The physical gate display is at the logon screen (console = session 4, no
   user) for as long as the RDP session is attached. The show display is dark
   while you're RDP'd in.
2. The app window was re-laid-out into the RDP session's virtual display.
3. Window state settled at **2268x1373 at (713,352)**, `fullscreen: false`,
   `maximized: false` — i.e. RDP-session geometry, windowed.
4. The 5 s periodic save then **persisted that** over the real show geometry.

Geometry was confirmed stable (not still looping) across 6 samples at 11:29:38
→ 11:29:51. The thrash is a **transient during session/display handoff**, not an
ongoing loop — it settles once RDP finishes negotiating the display.

The durable damage is #4: the saved state is now RDP geometry, so the window
comes back windowed at 2268x1373 instead of full-bleed on the gate display.

### Web UI not reachable from the dev machine

`http://100.64.0.2:9520/version` and `http://10.255.15.5:9520/version` both
fail (curl HTTP 000) from the dev workstation over tailnet. The firewall rule
(`src-tauri/src/firewall.rs`) is port-scoped inbound; likely scoped to a profile
that excludes the tailscale interface. Not investigated further — the designed
path is an iPad on the show LAN, which is unaffected.

## Plan / steps

1. [x] Confirm the app is not in a CPU-burning loop — it isn't.
2. [x] Identify the 5 s file churn — it's our own periodic save, benign.
3. [x] Establish what RDP did to the session and the window state.
4. [x] User restarted the app, which cleared the immediate symptom.
5. [x] Land the remote-session guard on the periodic save (`session.rs` +
   `lib.rs`). Compiles clean, no new clippy warnings.
6. [x] Committed as `9a69892` "Hold window geometry while an RDP session is
   attached" — see "How it got committed" below.
7. [ ] **Current step.** Decide whether to close the exit-path hole and/or add
   self-heal.

## The fix that landed

New `src-tauri/src/session.rs` — `session::is_remote()`, a hand-declared
`GetSystemMetrics(SM_REMOTESESSION)` call, matching the idiom `taskbar.rs`
already uses (the codebase deliberately avoids pulling in the `windows` crate
for one-call needs). Non-Windows targets return `false`.

`src-tauri/src/lib.rs` — the 5 s periodic save now skips while remote, and logs
once on each transition so this is diagnosable from the log next time:

```
remote session attached — holding window geometry, not saving
remote session gone — resuming window geometry saves
```

Effect: an RDP visit no longer overwrites the on-disk show geometry, so the next
app start comes back correct. It deliberately does **not** move the live window.

## Known remaining hole: the exit path

`tauri-plugin-window-state` 2.4.1 keeps an **in-memory cache** that its own
`WindowEvent::Moved`/`Resized` listeners update unconditionally — our guard
cannot stop that. It then writes that cache to disk on `RunEvent::Exit`
(plugin `src/lib.rs:502-504`). So:

- **Covered:** a long RDP visit no longer steadily overwrites disk geometry.
- **Not covered:** quitting or restarting the app *while still RDP'd in* still
  writes the polluted cache to disk once, on exit.

Closing that needs one of:

- Switch `lib.rs:439` from `.run(ctx)` to `.build(ctx)?.run(|app, event| …)` and,
  on `RunEvent::Exit` while remote, rewrite `.window-state.json` from a
  last-known-local snapshot we keep ourselves (the app-level handler runs after
  the plugin's, so it wins).
- Or keep our own snapshot and re-apply it on remote→local transition. Note
  `WindowExt::restore_state` is **not** usable for this — it restores from the
  same polluted in-memory cache, not from disk.

Self-heal (auto re-applying geometry when the remote session detaches) was
deliberately *not* built: it would move the show window on a live rig, which is
a worse failure than needing one F11.

## How it got committed — shared working tree

This work was deliberately left staged-but-uncommitted, because a peer agent
was working in the same tree and had ~3400 insertions across 23 files staged in
the index (discovery.rs, testmode.rs, Test.tsx, README.md, scripts/). Committing
would have swept all of that into one commit.

The peer then **rewrote history** at 12:24 local (reflog: `reset: moving to
6974c8a` at 12:24:55, after re-committing the chain at 12:24:21–12:24:42), and
in doing so split this work out cleanly on its own:

```
9a69892  Hold window geometry while an RDP session is attached
         plans/rdp-window-state-corruption.md | 189 +
         src-tauri/src/lib.rs                 |  20 +
         src-tauri/src/session.rs             |  37 +
```

Verified after the fact: `session.rs` and the plan in `HEAD` are byte-identical
to the working tree, the guard block is intact in `HEAD:src-tauri/src/lib.rs`,
`git status` is clean for all three paths, and `cargo check --lib` passes.

Note the pre-rewrite SHAs (`f0ee5d6`, `6ce643e`, `0faaa61`, `f11d401`,
`dcb5c4d`) are gone from the branch; they are still reachable via the reflog if
anything looks missing.

Safety snapshot of the pre-commit state is at `stash@{0}` — "safety: peer agent
staged changeset + RDP window-state guard". Safe to drop once this is settled.

## Things not to do

- **Don't delete the 5 s periodic save.** It's load-bearing for self-update
  handover (`process::exit` skips window teardown). Guard it, don't remove it.
- **Don't RDP into the gate machine to check on a running show.** It disconnects
  the console session, blanks the physical display, and rewrites window state.
  Use the web UI on port 9520 from a device on the show LAN.
- Don't assume the resize thrash is a webview/ResizeObserver bug — CPU
  measurements rule that out.

## Open questions for the user

1. Is the resize thrash still visibly happening? Measurements say it settled at
   ~11:29, but you reported it live. If it's still going, the diagnosis above is
   incomplete and I need a fresh look while it's happening.
2. Want me to land the `SM_REMOTESESSION` guard now?
3. Should show mode re-assert itself when the console session returns?
