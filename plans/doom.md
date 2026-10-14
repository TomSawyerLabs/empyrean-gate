# DOOM on the Gate — "yes, it runs DOOM"

## Goal

Make the honest answer to "can you play DOOM on this?" be **yes**: single-player
shareware DOOM (E1M1 onward) rendered across the 64-spoke array, controlled from
a phone, reached through a secret code rather than a tab, and self-ending with a
short timeout when the player walks away so the show gets its array back.

## Environment / context

- Repo: `TomSawyerLabs/empyrean-gate`, worktree `C:\Users\camer\.t3\worktrees\Empyrean\t3code-7f335ed4`
  (branch `t3code/7f335ed4`). Rust 1.99, MSVC 2022 Community installed (the `cc`
  crate finds it via vswhere; `cl` is not on PATH, which is fine).
- The array: 64 spokes × 378 px, radius 0.32..1.0 (middle 32 % is a hole), viewed
  from below with no canonical "up". Angular pitch at the rim ≈ 0.098 units; a
  planar 320-px-wide image mapped across the disc gets ~16 DOOM px per spoke at
  the rim and ~5 at the hole. Radial resolution is ~19× finer than angular.
- Game mode already exists (`plans/game-mode.md`): `GameKind` enum, `GameSim`
  enum dispatch, `GameRuntime` in the frame loop, a packed-RGB `GAME` storage
  buffer (binding 9) the shader looks up, 2 s crossfade, effects/drawing
  suppression, GAME MODE banner, Games tab, playlist cues. Starting a game is
  loopback-only and refused while a playlist runs.
- There is **no existing easter-egg / secret-code mechanism** in the UI (grepped:
  nothing). Tabs are hash routes (`/#games`); guests see Live and Games only.
- Shader storage buffers in use: bindings 2,3,4,5,6,7,9 = 7 of wgpu's default
  limit of 8 per stage. Reusing (and enlarging) the GAME buffer avoids the edge.
- Upstream sources, fetched into scratch dirs under `$TEMP`:
  - doomgeneric `ozkl/doomgeneric` @ `e257a09527062bfb986b6e5e0780839b6cbd5b71`
    (2026-10-11), tarball sha256
    `26f8f60daa6c6e4d3c01e5eac9fb700d592dede803d13ac848154ff356b2a2e7`. GPL-2.0.
  - `doom1.wad` shareware 1.9 from Debian non-free
    (`doom-wad-shareware_1.9.fixed.orig.tar.gz`): 4,196,020 bytes, MD5
    `f0cefca49926d00903cf57551d901abe` (the canonical one), SHA-256
    `1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771`.

## Decisions already made (don't re-ask)

1. **DOOM is a `GameKind` (`doom`)**, not a new subsystem. It rides the existing
   crossfade, suppression, banner, status, admin Stop, and the GAME buffer. The
   difference from the grid games is a *raster* substrate: the "cells" are a
   320×200 frame and the shader maps it planarly instead of polar-lookup.
2. **The DOOM engine runs in a child process**, not in the engine thread.
   doomgeneric's `I_Error` ends in `exit(-1)` (and pops a MessageBox on Windows
   without `-nogui`); 1993 C code with globals must never be able to take the
   lights down, and a child can be killed/respawned cleanly where in-process
   DOOM cannot be re-initialised. The child is **this same executable** run as
   `empyrean-gate --doom-host` (branch in `main.rs` before any Tauri/logging
   init), so the release pipeline, signing and self-update need no second
   binary. Frames come back over stdout, keys go in over stdin, stderr is
   logged. DOOM's own `printf` chatter is diverted to stderr inside the child
   (a C shim dup2s fd 1 → fd 2 and hands Rust the original handle for frames).
3. **Shareware `doom1.wad` is embedded in the binary** (`include_bytes!`, +4 MB)
   and written to `<config dir>/EmpyreanGate/doom/` on first start, hash
   checked. The show machine is often on a LAN with no internet, so a runtime
   download is out; Freedoom is bigger and is not "DOOM". Vendored in git under
   `src-tauri/doom/`.
4. **Frame format: 8-bit indexed + palette** (`CMAP256`): 64 KB + 768 B per
   frame at 35 fps instead of 256 KB. The parent applies the palette when it
   packs the frame for the GPU.
5. **Secret code**: the hidden page is `/#doom` (any client, guest or admin), and
   typing `doom` on a keyboard anywhere in the UI (outside a text field) jumps
   there — that is how the Gate machine's own window reaches it, since Tauri has
   no URL bar. Nothing in the nav lists it. The Games tab shows a DOOM card to
   **admins only** (so the operator can Stop it and knows the code).
6. **Anyone on the LAN who knows the code can start it**, even while a playlist
   runs (unlike the other games — the operator at a party should not have to
   stop the show to say "yes"). The engine already gives the manual game
   precedence over the cue and resumes the cue when DOOM ends. Anyone can also
   stop it; admins from the banner, the player from the page.
7. **One controller at a time.** The first connection to send a key owns the
   controls; others see who is playing. Owner disconnect releases every held
   key immediately and frees the controls; if nobody takes them within
   `DOOM_LEAVE_SECS` (15 s) DOOM ends. No key input for `DOOM_IDLE_SECS` (90 s)
   also ends it. Both are the "short timeout if the player leaves".
8. **Straight into E1M1** (`-warp 1 1 -skill N`, default 3 = Hurt me plenty,
   skill pickable on the start screen) — no title demo loop holding the array.
9. **The phone is the HUD**: health / armor / ammo / map / kills come from a C
   shim reading `players[consoleplayer]` and are mirrored in status, since the
   array cannot show readable text. The array shows the game view only.
10. **Mapping** (shader): the 4:3 frame is placed in the disc plane with its
    centre pushed outward so the crosshair sits at r ≈ 0.5 instead of in the
    hole; the screen's "down" direction is `game_turn`, set by tapping the
    array preview on the phone ("face me"). Tangential box filtering so spokes
    average the pixels they cover rather than sparkle.
11. Behind a Cargo feature `doom` (default on) so a platform where the C build
    breaks can still ship (`--no-default-features --features shader-hot-reload`).
12. **Every release ships both variants** (user, 2026-10-14): the default assets
    include DOOM; `-nodoom` twins are plain MIT. Built in the same job after the
    default assets are staged (only this crate recompiles). The updater's
    `asset_name` carries the variant so an install never switches sides, the
    bundle license metadata says `MIT AND GPL-2.0-or-later` (overridden to MIT
    for the nodoom build), and `THIRD-PARTY-LICENSES.md` (full GPL-2 text) is
    attached to every release.
13. `prodjlink-rs`: `Compellerai/prodjlink-rs` is MIT but is a *different*
    single-file crate under the same name; the app's pin (`anweiss`) is still
    unlicensed. Left as the README caveat, not a switch.

## Licensing (flag, not a blocker)

doomgeneric / the Doom source are GPL-2.0. Linking them into `empyrean-gate`
makes the *distributed binary* a combined GPL-2 work even though this repo's own
code stays MIT. The vendored tree keeps its LICENSE; the README license section
says so. The shareware IWAD is freely redistributable as shareware (Debian ships
it in non-free; its hashes are recorded in `src-tauri/doom/README.md`).

## Plan / steps

1. [x] Explore game mode, shader, protocol, server gating, hash routing, CI.
2. [x] Fetch pinned doomgeneric + verified doom1.wad into scratch dirs.
3. [x] Vendor: `src-tauri/doom/doomgeneric/` (core .c/.h only, no platform
       files, sound backends, Makefiles), `src-tauri/doom/shim.c`,
       `src-tauri/doom/doom1.wad`, `src-tauri/doom/README.md`.
4. [x] `build.rs`: `cc` build behind feature `doom` (defines `CMAP256`,
       `DOOMGENERIC_RESX=320`, `DOOMGENERIC_RESY=200`, per-OS defines).
5. [x] `src-tauri/src/doom/host.rs`: child side — `DG_*` externs in Rust, stdin
       key reader, stdout frame writer, `run_host()`; `main.rs` branch.
6. [x] `src-tauri/src/doom/mod.rs`: parent side — WAD provisioning, spawn,
       frame reader thread, `DoomSim` (GameSim arm): latest frame → packed RGB,
       keys, orientation, stats, idle/leave expiry, child-death handling.
7. [x] `game/mod.rs`: `GameKind::Doom`, `GameSim::Doom`, `raster()`, `key()`,
       `expired()`, `orientation()`; `GameControl` gets `keys`, `controller`,
       `mirror`, `ended` (skill rides the existing `species` knob, 1–5).
8. [x] Protocol/state/server: `ClientMsg::GameKey` / `GameRelease`,
       `SetGameMode.species` + `.claim`, `SetGameConfig.mirror`,
       `GameModeStatus.doom` + `.ended`, open gates for DOOM start/stop,
       controller handling on disconnect, status fixture regen.
9. [x] Engine: enlarge GAME buffer, `game_style`/`game_turn` globals (the two
       pads), raster upload path, expiry → `set_game_mode(None)`, summary.
10. [x] Shader: `doom_color` planar path with tangential box filter.
11. [x] Frontend: types, ws wrapper, `Doom.tsx` (start screen, HUD, held-key
        controls, face-me canvas, keyboard), hidden `doom` tab + typed code in
        `App.tsx`, banner ▶ Play → `#doom` when DOOM runs, admin card in Games.
        Alignment row added on request: ↺ ↻ nudge a sixteenth of a turn, 180°,
        ⇋ Flip (mirror); `[` `]` `\` on a keyboard. Nudges ride the face-me
        input (absolute angle) and chain off the last value sent, not status.
12. [x] Tests: Rust (codec, key map, expiry, round trip), Playwright
        `doom.spec.ts`, layout matrix entry for `#doom` with a running game.
13. [x] README (feature + license caveat), this plan, commit at logical steps.
14. [x] Run the real backend locally and play from a browser; confirm frames
        reach the preview and keys move the player. Done 2026-10-14 (headless
        backend on :9540 with `EMPYREAN_CONFIG` pointed at a temp dir, driven
        over the WS protocol and through the real page with Playwright).
15. [ ] **(next, needs the rig)** Judge the mapping on the real array: lift,
        width, default facing, whether mirror is needed from the dance floor,
        and whether the 8-tap tangential filter is enough. All constants are
        in `gate.wgsl` (`RASTER_*`) and `src/doom/mod.rs`.

## Findings / gotchas

- `I_Error` → `exit(-1)` and pops `MessageBoxW` unless `-nogui`; `I_ConsoleStdout`
  is false when stdout is a pipe, so `-nogui` is mandatory for the child.
- DOOM's config dir defaults to `.` (cwd) — set the child's cwd to the doom data
  dir so `default.cfg` / saves never land next to the exe.
- With `DOOMGENERIC_RESX/RESY = 320/200`, `fb_scaling` = 1 and `I_FinishUpdate`
  memcpy's the 8-bit `I_VideoBuffer` straight into `DG_ScreenBuffer`
  (CMAP256). `colors[256]` is non-static under CMAP256 — read it from the shim.
- The doomworld shareware zip URL returns an HTML page now; Debian's non-free
  orig tarball and its MD5 are the reliable source.
- Scripted edits via a Bash heredoc mangle a backslash-n escape into a real
  newline even with a quoted delimiter; the layout-spec insertion came out
  broken and the "fix" script re-broke it. Use the Write tool for scripts,
  Edit for one-liners.
- **Respawn loop (found live):** the engine's "is the runtime stale?" check
  compared `sim.theta()` to the spoke count; DOOM's θ is its frame width
  (320), so the child was killed and respawned every frame ("started /
  stopped" pairs 0.4 s apart in the log, zero frames ever). Raster sims are
  now exempt from the θ check.
- **Controls race (found live):** the page used to assert the sticky Run key
  on open, which claimed the controls — so when DOOM started, every open DOOM
  page (a stale preview tab included) raced for them and the phone that
  pressed Start lost. Now the starter's `set_game_mode` carries `claim: true`
  (owner from the first frame), Run is asserted lazily with the first real
  key, and leaving the page sends `game_release`.
- DOOM pushes ~65 frames/s down the pipe (it redraws between tics); the parent
  keeps only the newest, so that is harmless.
- Live run on this machine (Intel UHD, Vulkan): start → first frame in about
  1 s; Fire spends pistol rounds (50 → 46 on the HUD); a second connection's
  key is refused with "Someone else has the DOOM controls right now."; face-me
  and mirror reach status; Quit kills the child after the 2 s fade; a
  controller that vanishes ends DOOM 15.5 s later with "the player left".
- `tests/fixtures/default-status.json` is a drift-guarded serialization of
  `RuntimeStatus::default()`; regenerate with
  `EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture` after adding status fields.

## Progress log

- [x] 2026-10-14 explore + fetch sources.
- [x] vendor + build.rs compiling on Windows (MSVC) — clean on the first try
      with the vcxproj defines + `_CRT_SECURE_NO_WARNINGS`.
- [x] host + parent + sim (11 unit tests).
- [x] protocol/engine/shader.
- [x] frontend (`src/Doom.tsx`, hidden tab, typed code, banner, Games card).
- [x] tests green: `cargo test --lib` (268), `bun run typecheck`,
      `playwright test doom` (5), layout gate's 16 DOOM cases, games/mobile-nav
      unchanged.
- [x] played it for real: see Findings (two live-only bugs found and fixed).
- [ ] seen on the rig (mapping constants may need tuning).

## Open questions for the user

1. GPL: happy with the release binary being a GPL-2 combined work (repo stays
   MIT)? Recommendation: yes for a personal art project; the alternative (a
   separately-distributed DOOM binary) complicates signing and self-update for
   no practical gain.
2. Timeouts are 15 s after the controller disconnects and 90 s with no input.
   Adjust to taste; both are constants in `src-tauri/src/doom/mod.rs`.
3. Mapping on the real array (lift / width / mirror default) — untested on
   hardware; expect a tuning pass with the rig lit.

## Things not to do

- Don't link DOOM into the engine thread "to simplify" — `exit()` in C ends the
  show.
- Don't add a new storage buffer binding for the frame; the GAME buffer is
  enlarged and reused (the stage is at 7 of 8 storage buffers).
- Don't put DOOM in the playlist cue list (`GAME_CUES` in Control.tsx) — a
  scheduled DOOM with nobody playing is a title screen holding the array.
- Don't commit anything from `$TEMP` scratch dirs except the curated vendored
  files.
