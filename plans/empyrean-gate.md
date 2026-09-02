# Empyrean Gate — pattern generator

## Goal

Greenfield Tauri + React desktop app that generates visual patterns for the Empyrean
Gate — a radial array of lights above a dance floor — and outputs them over sACN
(E1.31). GPU-computed patterns (Vulkan, no fallback), live preview UI, settings page,
audio-reactive (beat + multi-band features from DJ audio input), effects triggered by
keyboard/mouse/touch. CI builds a standalone binary (no installer/updater).

## Physical installation (defaults; ALL configurable in-app — user is unsure of exact numbers)

- 64 spokes of LED strip in a radial array ("wagon wheel" viewed from below).
- 16× Advatek Pixlite Mk4-S controllers. Each box has **8 outputs but only 4 are
  wired** — every other output — giving 64 strings, 1 string = 1 spoke. The unused
  half is deliberate: the rig is intended to double to 128 spokes later.
- **378 px per spoke** (confirmed 2026-08-23 against the existing controller patch;
  matches the 64×378 Uprising recordings the Archive tab replays).
- Major (outer) diameter 50 ft → outer radius 25 ft. Minor radius ~15–20 ft diameter →
  default inner radius 8 ft (configurable; user unsure).
- LED density 30 or 60 LED/m (default 60, configurable; only affects physical-space mapping).
- **Strings are fed from the outside**: pixel 0 = outer radius (50 ft dia), last pixel =
  innermost radius. **Confirmed 100% by the user 2026-08-23** — treat as fixed, not an
  assumption. Spoke direction matters for chases.
- **Indexing conventions** (they differ on purpose; this is a classic off-by-one trap):
  spokes and pixels are **0-based** everywhere — config, engine, Test tab, Settings hint.
  Universes and channels are **1-based**, because that is the wire format and what
  controller software shows. `start_universe: 1` is literally universe 1; channel 1 is the
  first slot after the DMX start code (`property_count = 1 + data_len`, start code 0x00 at
  byte 125, slots from 126 — verified, no off-by-one). The controller's own strip labels
  are a *third* numbering: with stride 6 and the odd outputs wired, LightJams "Strip 01,
  03, 05 … 127" correspond to our spokes 0, 1, 2 … 63 (strip = 2·spoke + 1). Cross-
  reference by **universe number**, which is unambiguous in both systems.
- Protocol: sACN over UDP 5568. Unicast to controller IPs (configurable) or multicast
  239.255.u.u. 378 px = 1134 ch → 3 universes/spoke of data (170 px per universe: two
  full at 510 ch, then 38 px = 114 ch), each spoke starting on a fresh universe
  boundary → 192 universes transmitted.
- **Universe stride is 6, not 3** (`output.universe_stride`, added 2026-08-23). The
  installed patch allocates a 6-universe block per spoke because strips sit on every
  other PixLite output, so spoke N starts at `1 + 6N`: 001.001–003.114, 007.001–009.114,
  … 379.001–381.114. Universes 4–6, 10–12, … are reserved for the doubling and stay
  dark. Set the field to 0 to pack spokes with no gaps.

## Open: spoke order and rotational direction (the last unknown in the mapping)

The addressing is settled and test-pinned; **which physical spoke each universe block
drives is not**. The strips are in a defined physical order, so this is a measurement, not
a design question — take it once and lock it in:

- Unknown 1: does our spoke index advance the same rotational direction as the patch, or
  does the structure need **mirroring**?
- Unknown 2: is our spoke 0 the same strip the patch calls first, or is there an **origin
  offset** (a rotation)?

Neither shows up in the universe numbers — all 64 spokes light correctly either way, but
chases sweep the wrong way and/or start on the wrong side of the room. Reading the wire
cannot settle it either: `sacn-listen` proves universe 7 carries a spoke's worth of
pixels, not which physical arm that is. Measure with the Test tab: pixel index 0 → spoke 0
position 0 (which physical spoke, which end); pixel index `pixels_per_spoke` → spoke 1
position 0 (which neighbour ⇒ direction). Requires sACN output enabled *and* reaching the
rig — as of 2026-08-23 LightJams outranks Gate on priority, so Gate must win the handover
before any of this is visible.

If mirroring or an offset turns out to be needed, it belongs in config (a spoke-order
mapping), not in per-pattern math — every layer and effect derives angle from the spoke
index, so one mapping at the boundary fixes all of them at once.

## Decisions already made (don't re-ask)

- **wgpu locked to `Backends::VULKAN`** — satisfies "Vulkan for open-source portability"
  with far better ergonomics than raw ash; WGSL compiles to SPIR-V on Vulkan. No fallback
  backends; adapter failure = clear fatal error surfaced in UI.
- Patterns computed from scratch every frame in one compute dispatch (layer stack loop
  per pixel). No CPU-side pattern math.
- Frontend: React + TypeScript + Vite, **Bun** (`bun.lock`, per global instructions).
- sACN sender is hand-rolled (~150 lines, well-specified protocol) — no dep risk.
- sACN output defaults **OFF** on first launch (192 universes @ 60 fps is ~14 MB/s of
  UDP; don't flood networks by default). Big toggle in UI.
- Audio: cpal input + rustfft; spectral-flux onset detection, autocorrelation tempo,
  bass/mid/treble bands with slow AGC. All on CPU (tiny), features feed GPU uniforms.
- **Multiple audio inputs in parallel** (user request mid-build): config defines up to 4
  named sources; each source = capture device + channel selection (downmixed to mono for
  analysis), each with its own full analysis chain. Layers/effects carry an
  `audio_source` index selecting which source drives them. Multichannel interfaces (e.g.
  stage feed on ch 1–2, local mic on ch 3) map to separate sources on the same device.
- **Backend is primary; UI is a client** (user request mid-build): frame generation runs
  on a dedicated OS thread (GPU dispatch → readback → sACN) fully independent of any UI.
  The backend hosts an axum HTTP+WebSocket server (default port 9520, bind 0.0.0.0)
  serving the built React bundle and a single JSON+binary WS protocol. The Tauri window
  is just another WS client; phones/laptops on the LAN connect to the same server.
- **Remote inputs over WS**: browser mic → client-side WebAudio feature extraction
  (level/bands/spectral flux) streamed as compact packets; backend runs the same beat
  tracker on them as on local cpal sources (audio source kind = Device | Remote). Phone
  IMU/orientation → control bus (tilt/yaw uniforms, steer effect positions).
- Preview over WS binary frames; per-client fps + pixel decimation so phones on weak
  WiFi can subscribe cheaply. WebGL2 point rendering in React.
- **Headless mode** (user request mid-build): `empyrean-gate --headless` skips the Tauri
  window; backend + web UI only (for headless show machines). No auth for now, but
  `server.auth_token` config field + `token` in the WS Hello exist so tokens can be
  enforced later without protocol/config migration.
- Headless smoke-test binary (`engine-smoke`) inits Vulkan + renders one frame + exits,
  so CI/dev can verify the engine without opening a window.
- Standalone binary via `tauri build --no-bundle`; release builds embed frontend assets.
- Repo branch: `master`.

## Scaling intent (user request mid-build)

~20k pixels today; design must scale to hundreds of thousands, eventually millions,
"without much trouble". Already satisfied: pixel count is pure config, single compute
dispatch (OK to ~16M px), ping-pong staging readback (overlaps compute), zero-alloc
sACN packet scatter. Known walls at ~1M px, deliberately out of scope now:
- Network: ~5900 universes @ 60 fps ≈ 226 MB/s → 10GbE / multiple NICs (hardware).
- Per-packet `send_to` syscalls (~350k/s) → batch with `sendmmsg` (Linux) / RIO
  (Windows). The sender is a clean frame→transport interface so this can be swapped
  without touching the engine.
- GPU→sACN path stays: engine buffer → LUT scatter → resident packets; no per-frame
  allocation anywhere on that path.

## Architecture

```
src/                  React UI (Preview + Settings), WebGL2 preview, keyboard effects
src-tauri/src/
  main.rs             Tauri setup, commands, frame-loop thread spawn
  config.rs           AppConfig (geometry, controllers, audio, output), persisted JSON
  geometry.rs         polar layout, universe mapping
  engine/mod.rs       wgpu Vulkan init, pipeline, frame loop, readback
  engine/shaders/gate.wgsl   layer stack + effects + noise lib, all patterns
  layers.rs           LayerParams / EffectInstance structs (bytemuck ↔ WGSL)
  sacn.rs             E1.31 packet builder + per-universe sequenced sender
  audio.rs            cpal capture, FFT, features, beat tracker
  state.rs            shared EngineState (params written by UI commands, read by loop)
  bin/engine_smoke.rs headless one-frame render test
```

Data flow: UI commands mutate shared state → frame loop (fixed-rate thread) packs
uniforms (time, audio features, layers, effects) → compute dispatch → readback →
sACN sender + preview channel.

## Plan / steps

- [x] git init (master), plan doc
- [x] Scaffold: package.json/Vite/TS, src-tauri (Cargo, tauri.conf.json, capabilities, icons)
- [x] Rust: config + geometry + state + protocol
- [x] Rust: engine (wgpu Vulkan-only, ping-pong readback) + WGSL shader (11 layer kinds,
      4 effects, 3D simplex noise, soft-clip tonemap)
- [x] Rust: sACN sender (allocation-free, prebuilt packet templates)
- [x] Rust: audio (multi-source cpal + channel select, FFT features, beat tracker,
      remote-source chains)
- [x] axum server: embedded web UI + WS protocol, per-client preview throttle/decimate
- [x] Headless mode (`--headless`), auth-token placeholder
- [x] engine-smoke binary; `cargo check --all-targets` clean, zero warnings
- [x] React UI: preview (WebGL2, click-to-burst, keys 1–4), settings (layers/audio/
      output/geometry), remote mic + IMU senders
- [x] E2E test passed: HTTP + WS + 10 preview frames + effect trigger against live
      backend (scripts/e2e-test.ts)
- [x] GitHub Actions CI (windows + linux standalone binary artifacts)
- [x] README
- [x] `bun tauri build --no-bundle` release build validated (17.3 MB standalone exe;
      release engine-smoke passes, checksum matches debug — deterministic)
- [x] Fixed: audio streams / sACN plan no longer rebuilt on unrelated config changes
      (brightness slider was tearing down capture streams via the epoch bump)
- [x] Initial commit on master
- [x] WIP tracker entry added (P:\Projects\WIP\personal\empyrean-gate.md)

## Round 2 (same session, user requests mid-build)

- [x] **PWA**: manifest + minimal network-first service worker (registered only when
      served by the backend, not Tauri/dev) + iOS meta tags + 180/192/512 icons.
      Installable on iPad, standalone fullscreen.
- [x] **Live drawing with pens**: `Paint` WS message streams polar dabs (batch per
      pointer frame, coalesced events); backend keeps ≤512 aged dabs (oldest evicted);
      GPU renders Glow/Ripple/Sparkle pens each frame from scratch (binding 5).
      Collaborative across clients. E2E-tested.
- [x] **UI restructured into 4 hash-routed tabs**: View / Draw / Control / Settings
      (`/#draw` etc. — PWA shortcuts + popped-out windows pin a mode). Tauri app has
      "⧉ New window" (labels `aux-*`, capability added) for separate-window operation.

## Round 3 (first live run feedback, 2026-08-19)

- [x] **sACN egress interface picker** — root cause of "sACNView sees nothing":
      socket bound 0.0.0.0, multicast went out the default-route NIC, not the
      10.255.0.77 lighting network. `output.interface` binds the socket + sets
      IP_MULTICAST_IF (socket2). NIC list via local-ip-address in status.
- [x] Multicast now defaults ON (enable toggle still defaults OFF).
- [x] `sacn_pps` live packets/s in status + HUD ("is it transmitting" truth).
- [x] `sync_to_render` (default on, capped by fps field) + computed LED-wire fps
      ceiling shown in UI (~88 fps at 350 px: 800 kbps × 24 bits + reset).
- [x] **E1.31 universe synchronization** (`sync_universe`, 0=off): data packets carry
      sync address; one sync packet/frame to the selected output destination(s).
      PixLite Mk4 latches tear-free; non-supporting receivers ignore.
- [x] **Fixed: all tabs black after visiting Draw** — server sent PreviewMeta once per
      connection; later canvas mounts resubscribed but never got meta → GL never
      initialized. Meta now re-announced on every SubscribePreview. Also release GL
      contexts on unmount (browser ~16-context cap).
- [x] **Audio loopback sources** — WASAPI loopback via cpal (output device as input);
      picker lists output devices.
- [x] **Autopilot random walk** — OU (mean-reverting) drift per layer param, slider
      value = walk center, per-layer `walk_amount` = radius (the "limit"), global
      enable + speed (tau ≈ 45s/speed). Runtime-only; never rewrites config.
- [x] **6 new layers**: Rainbow, Wedges, Interference, Fire, Meteors, Warp (17 total).
- [x] Shader/pipeline validation now goes through an error scope → broken WGSL (live
      editing) surfaces as a UI error instead of killing the engine thread.
      (Found because `active` is a reserved WGSL keyword — the panic killed the loop.)
- [x] `default-run = "empyrean-gate"` (two-binary crate broke `tauri dev`).
- Unicast question answered: multicast + IGMP snooping is correct; static controller
  IPs would NOT improve performance; unicast only for snooping-less switches/WiFi.

## Round 4 (2026-08-19, later)

- [x] Web UI auto-refresh on stale bundle (compare content-hashed entry script vs
      freshly-fetched /index.html on every WS connect; sessionStorage loop guard).
- [x] **Connect QR**: `/qr.svg?data=` endpoint (qrcode crate, SVG); ⊕ Connect modal
      with per-interface join URL `http://<ip>:<port>/?join=<token>`.
- [x] **Client management**: persistent client ids + names; ClientRecord list in
      config; Clients panel (rename / revoke / unrevoke / forget); revoke kicks live
      (checked on the 2 Hz event tick) and blocks rejoin; `require_token` +
      `rotate_join_token` for real lockout; loopback always allowed; join token
      captured from `?join=` into localStorage and sent in hello.
- [x] **Seamless backend takeover**: new instance detects busy port → warms engine
      (sACN gated by `sacn_hold`) → `POST /handover` (loopback-only) → old instance
      stops sACN BEFORE replying (no two-source overlap), returns config +
      layer_phases → new adopts (phases transplanted via flag) → old exits.
      Verified end-to-end: A exits code 0, B serving in <2 s, sub-second sACN gap.
- [x] `EMPYREAN_CONFIG` env var overrides config path (tests / isolated instances).
- [x] Audio stream error log-throttling (underruns come in bursts).
- [x] Fix: handover exit task originally died with the tokio runtime → zombie
      process; exit now runs on a plain thread, and the headless main loop watches
      the shutdown flag.

### Gotcha (cost a dev-app crash)

Running extra instances of `target\debug\empyrean-gate.exe` while `tauri dev` is
watching → the watcher's relink hits "Access is denied" and `tauri dev` DIES
(taking the desktop window with it). Test spare instances from a COPY of the exe.

## Round 5 (2026-08-19, later)

- [x] **Two-phase handover**: GET /handover/state (prepare, side-effect-free) lets the
      successor adopt config+phases and warm its pipeline while the old instance still
      sends; POST /handover (commit) waits for the engine's quiesce ACK (measured
      6.6 ms) and returns fresh phases (drift correction). Wire gap ≈ 1–2 frame
      periods. Fallback to single-phase for old instances. Verified end-to-end.
- [x] Pushed to **github.com/cinderblock/empyrean-gate** (private). CI matrix now
      windows + linux + macos. (macOS minutes are 10× on private repos — flip public
      or drop macos if quota matters.)
- [x] CI green on ALL targets (run 32281656912, commit `825050f`): linux 8m ✓,
      macos 9m ✓, windows 14m ✓; standalone binary artifacts 7–8 MB each.
- Findings:
  - macOS: wgpu's plain `vulkan` feature is unimplemented there — `Instance::new`
    PANICS. Fixed with target-specific `vulkan-portability` (MoltenVK) + engine init
    wrapped in `catch_unwind` (frame loop and engine-smoke) so init panics surface
    as GPU errors, never dead threads.
  - Fat LTO (`lto = true`, `codegen-units = 1`) made CI Linux jobs take 45+ min
    (2-core runner, cache can't help the LTO relink). Switched to thin LTO +
    `codegen-units = 4` → Linux 8 min WITHOUT cache. rust-cache@v2 was already in
    the workflow; added `cache-on-failure: true` so red runs still prime it.
  - Repo made public on user request (also: free Actions minutes).

## Round 6 (2026-08-19, live-testing feedback)

- [x] **Alt-tab fps drop diagnosed + fixed**: Windows coarsens sleep granularity to
      ~15.6 ms when the app loses foreground → engine pacing overshot. Fixed with
      `timeBeginPeriod(1)` (winmm) in the engine thread. Affects real output, not
      just UI.
- [x] **Unsteady sACN rate fixed**: pacer was `last = now` (drifts + aliases against
      the render tick); now accumulator-scheduled (`next += interval`), and
      sync-to-render sends every rendered frame outright when the cap doesn't bind.
- [x] **pkts/s display steadied**: per-second buckets instead of fractional-window
      division; status reports the last full second.
- [x] **fps + pkt/s history bars** (last 30 s, per-second buckets) in View HUD and
      Control (Sparkbars component; single-series, direct-labeled, text-ink values).
- [x] **UI fixes**: sACN enable row reads as an action ("Enable sACN output") with a
      separate status pill; interface picker text cleaned up; "no save button —
      changes are live" hint + "✓ saved" flash in the top bar on every confirmed
      config change.
- [x] **Gray-code layer walk**: autopilot can now walk WHICH layers play — exactly
      one layer fades in/out per step (4 s envelope), never fewer than
      `walk_min_layers` on (default 2). Off by default; toggle in Control → Autopilot.

## Round 7 (2026-08-19, sACN protocol conformance)

Prompted by "what is the CID, does it change every boot, are we using sACN well?" —
audit found the identity/lifecycle half of E1.31 was unimplemented.

- [x] **Persistent CID** (`output.cid`, UUID v4, generated once in `config::load` like
      the join token). Was `b"EmpyreanGate" + process::id()` → **a new source identity
      every launch**. Consequences that fixes: no more 2.5 s HTP-merge against our own
      ghost after a restart; no burning a slot in controllers that cap sources per
      universe (PixLite: a handful); and handovers are now genuinely seamless because
      the successor process reads the *same* CID out of the config.
      Added `uuid = "1.24.1"` (v4) — the old value was not an RFC 4122 UUID at all.
- [x] **Stream termination** (options bit 6, 3 packets/universe): sent on output
      disable, on app exit, and for universes a reconfigure drops. Previously the rig
      held its last frame through the receiver's source-loss timeout and, on
      hold-last-look controllers, indefinitely. **Deliberately NOT sent on handover**
      (`state.leaving`) — the successor continues the same CID's stream, and
      terminating would blink the rig between instances.
      Exit needed a new `state.sacn_terminated` ack + a ≤500 ms wait in `lib::run`,
      or the process died before the packets left the socket.
- [x] **Universe discovery** (E1.31-2016): prebuilt pages, sent to 239.255.250.214
      every 10 s from inside `send_frame` (only due while transmitting; keeps cadence
      independent of frame rate). This is what makes the source visible in sACNView
      and controller UIs. Toggle: `output.discovery`, default on.
- [x] **Configurable source name** (`output.source_name`, default "Empyrean Gate"),
      64-byte field, truncated on a char boundary.
- [x] **First unit tests in the repo** (7, in `sacn.rs`): discovery packet layout
      field-by-field, 512-universe paging, terminate option bit + sequence + template
      restoration (over a real loopback UDP socket), name truncation, CID byte order.
      CI runs them with `cargo test --release --lib` *after* the release builds, so it
      reuses those artifacts instead of compiling the tree again in the debug profile.
- Declined (agreed with user): per-address priority (start code 0xDD) — an ETC
  convention, not core E1.31, and nothing in this rig consumes it.
- [x] Fixed in Round 8: multicast and controller unicast are now exclusive modes, so
      saved controller addresses no longer duplicate every packet while multicast is on.

## Released

- **v0.1.0** (2026-08-19): https://github.com/cinderblock/empyrean-gate/releases/tag/v0.1.0
  Cut by the tag-triggered Release workflow (checks → 3-target build → publish);
  assets: windows-x64.exe (19.4 MB), linux-x64 (23.8 MB), macos-arm64 (19.7 MB).
  Future releases: `git tag vX.Y.Z && git push origin vX.Y.Z` — CI does the rest.
- **v0.5.1** (2026-08-22): https://github.com/cinderblock/empyrean-gate/releases/tag/v0.5.1
  The first release since v0.4.0, so it carries 60+ commits: control decks,
  scenes/playlists, unattended shows, Pioneer DJ LINK, external MIDI, plus round
  14 (touch hardening, show mode, layout gate, feedback reports, close guard).
  Assets: windows-x64.exe (38 MB), linux-x64 (44 MB), macos-arm64 (39 MB).
  **v0.5.0 was tagged and failed** — no release was published. Two CI-only bugs,
  both now fixed and both worth remembering:
  1. The deck told react-grid-layout `window.innerWidth` while its shell caps at
     1780px, so at 2560x1080 items sat ~380px past the right edge until the
     resize observer corrected. A first-paint horizontal scrollbar; it showed up
     on the slower Linux runner and never locally.
  2. The status fixture guard's line-ending `normalize` was a no-op — it had been
     generated through a shell heredoc that ate a level of escaping, so it
     replaced a newline with a newline. It could only fail where the checkout
     differs from what the test writes, i.e. the Windows leg, which it broke.
     Rewritten on `str::lines` (no escapes to mangle), plus `.gitattributes`
     pinning the fixtures to LF, plus a test for the helper itself.
     **Lesson: don't generate Rust string literals through a shell heredoc.**
  Checks now runs the Rust tests on Windows as well as Linux — a Linux-only
  pre-release gate is not representative of a product whose show machine is
  Windows.

## Round 8 (2026-08-20): self-update

- [x] Updater thread (`updater.rs`): GitHub Releases API check (6 h + startup,
      auto_check default on), download platform asset to a VERSIONED SIBLING file
      (never overwrite the locked running exe), spawn → two-phase takeover → old
      exits. Old versioned binaries cleaned up at later startups. auto_install
      opt-in. `EMPYREAN_FAKE_VERSION` test hook.
- [x] Version chip in the top-bar corner (click = check; lit = click to hot-swap) +
      Settings → Updates panel.
- [x] Verified end-to-end against the real v0.1.0 release: download → spawn →
      handover → successor serving (scripts/update-test.ts).
- [x] v0.2.0 bumped (separate commit, per user rule: bumps never mix with code) and
      tagged; released with all three assets:
      https://github.com/cinderblock/empyrean-gate/releases/tag/v0.2.0
- Note: v0.1.0 binaries predate the updater — first swap to 0.2.0 is manual.

## Round 9 (2026-08-20): windows restore, viewer queue, walk visibility

- [x] Window restore across restarts/self-updates (tauri-plugin-window-state, stable
      aux labels, aux_open recreated at startup, 5 s periodic saves). Needs one
      visual verification pass by the user.
- [x] Preview-slot queue: `server.max_preview_clients` (default 10) rations the
      preview stream (>98% of client bandwidth); control is never gated; FIFO with
      live position banner. queue-test.ts verifies (cap 2, 3 viewers, promotion).
- [x] Phone preview default 20 fps @ 1/6 px ≈ 1.4 Mbps/phone (was ~4.1) — ~10
      viewers ≈ 14 Mbps, comfortable on venue WiFi.
- [x] Walk visibility: global "Walk depth" (0–3) multiplier + "Add missing kinds"
      button so the gray-code layer walk can tour all 19 patterns. (Walk was
      working but too subtle at defaults, and only ever tours stack layers.)
- [x] v0.3.0 tagged (window fix + these features; bump in its own commit).

## Round 10 (2026-08-20): live video input + destination cleanup

- [x] **Video is a first-class GPU layer** (20th layer kind): a bounded RGBA storage
      texture is sampled directly in WGSL and remains composable with blend, opacity,
      audio response, and autopilot. Treatment controls: zoom, 0–10-way mirrored
      kaleidoscope, contrast, rotation/spin, saturation, tint/original-color mix, and
      brightness.
- [x] **iPad/browser transmitter**: Video tab accepts a URL or local video file,
      decodes with the browser's hardware media stack, square-crops to 64/96/128 px,
      and sends binary RGBA frames at 10/15/24 fps. Backpressure drops frames rather
      than queueing latency. The decoder stays mounted offscreen while the operator
      visits Live or Settings, and reconnect/takeover reclaims the source.
- [x] **URL resolution**: direct video, `og:video`, `twitter:player:stream`, and HTML
      `<video>/<source>` are supported. Short-lived opaque proxy paths forward Range
      requests and make canvas extraction CORS-clean. Optional `yt-dlp` fallback is
      probed before returning a provider result; DRM/login-gated pages are not claimed.
- [x] **SSRF defense**: HTTP(S) only, no URL credentials, public IP space only across
      DNS + every redirect, DNS answers pinned to the validated connection, redirect
      cap, bounded HTML inspection, request timeouts, and HTTP authorization matching
      the WS join policy.
- [x] **Single-source ownership**: one connection owns live video frames; another may
      take over deliberately, stale connections cannot inject/stop it, and disconnect
      clears the frame immediately. Source title/owner/dimensions/fps/frame count are
      visible to every client.
- [x] **sACN destination mode is exclusive**: multicast vs controller unicast is now
      an explicit choice. Controller addresses remain saved when switching modes, but
      sequence-identical duplicate packets are no longer emitted.
- [x] Verification: frontend production build + typecheck; all Rust targets compile;
      15 library tests and 6 benchmark tests; Vulkan shader validated with all 20
      layers plus a video-only GPU scenario; isolated-port HTTP/CORS/Range/SSRF tests;
      WS E2E video-frame test; real in-app browser test at desktop, iPad portrait, and
      narrow phone viewports.

## Round 11 (2026-08-20/21): BPM trust, video playlist/cache, firewall, Live speed

- [x] **BPM confidence** (d8472e3): BeatTracker scores peak dominance + clarity +
      stability with quiet gating and octave hysteresis; confidence 0..1 flows
      through AudioUniform/status. Displays show "finding beat…" below 0.35; beat
      events and beat taps are gated too. Manual BPM = confidence 1.0.
- [x] **Video playlist + offline cache** (36aac88): watched folders (scanned every
      10 s, 3 levels deep) and URL adds both land in a persistent playlist; URL
      entries download in the background into `<config>/EmpyreanGate/media-cache/`
      via the MediaResolver (same SSRF defenses), served back at
      `/media/file/{id}` with Range support so playback needs no internet.
      Auto-advance cycles the playlist; prev/next buttons. Verified end-to-end
      with `scripts/playlist-test.ts` (real download, 206 range serve).
- [x] **Windows Firewall one-click authorization** (8e4936e): startup `netsh` check
      sets `firewall_pending` in status; App banner offers Authorize →
      `AuthorizeFirewall` WS msg → elevated (single UAC) port-scoped allow rule
      (TCP <port>, any profile). Port-scoped means it survives every self-update
      binary swap — the per-exe Windows prompt never fires again. Rule name
      "Empyrean Gate". Non-Windows: no-op. First live click failed — nested
      `-Command` strings stripped the quotes in `name="Empyrean Gate"` so the
      elevated netsh got garbage; fixed (d7f23db) by writing a temp .ps1 and
      elevating with `-File`. Full RunAs chain exercised end-to-end from an
      elevated shell (no UAC dialog when already elevated): exit 0, rule
      created. Rule is now live on the dev machine — no banner, no prompts.
- [x] **Master Speed on Live tab** (9460737): master_speed (existing, Control →
      Master) surfaced in the Live size cluster; throttled `set_master`, synced
      from config. Independent of tempo controls (those only retime beat-driven
      values).
- [x] Verification: cargo check --all-targets, cargo test (all pass), tsc + vite
      build. Collaborator branch `codex/production-show-control` appeared on
      origin (not yet reviewed/merged).

## Round 12 (2026-08-21): field-gotcha hardening (user asked "what else is like the firewall issue?")

- [x] **Keep-awake** (a2a848b): `power.rs` calls SetThreadExecutionState every 30 s.
      System sleep blocked while running; display sleep blocked only while sACN
      output is enabled (display sleep kills HDMI/DP display-audio loopback devices
      — observed live). Verified via `powercfg /requests`.
- [x] **Crash-safe config saves** (57e5b09): write+fsync temp → keep `.bak` → rename.
      `load()` falls back to `.bak` and rewrites a good main. Before this, a power
      cut mid-save reset the show AND regenerated the sACN CID. Verified end-to-end
      (corrupted main config; CID survived).
- [x] **sACN bind failures surfaced** (a500fa6): `status.sacn_error` + App warning
      banner. Saved interface is an IP; on a different network the bind failed
      silently and multicast left the default-route NIC while pps looked healthy.
- [x] Already resilient (checked, no change needed): GPU device-loss/render errors
      drop back to engine re-init with 5 s retry; updater downloads are atomic
      (tmp + rename); audio devices wait-don't-switch; firewall rule is port-scoped.

**Ops checklist for the show machine (not fixable in code):**
- Windows Update: set Active Hours / pause updates for the event window (forced
  reboot mid-show is the failure mode).
- Put the exe in a user-writable folder (NOT Program Files) or self-update writes
  will fail; failures do surface in update_state, but only at update time.
- First manual download of the exe trips SmartScreen once ("More info → Run
  anyway") — unsigned binary. Self-updates do NOT retrigger it.
- NIC power management: untick "allow the computer to turn off this device" on
  the show NIC (mostly matters for USB/WiFi adapters).
- Validate Vulkan on the show machine's GPU early (the wgpu-29 pin exists because
  of THIS dev machine's 2022 Intel driver; other hardware may differ).
- ~~No autostart-on-boot yet~~ → BUILT (85e09e6): Settings → Updates → "Launch at
  login". Per-user Run registry key; the exe re-registers itself at startup so
  the entry follows self-update binary swaps. EMPYREAN_CONFIG instances skip it.
- Windows Update active hours: restarts land 09:00–15:00 only (people are STILL
  at the gate at 5am — user call, 2026-08-21). Active hours 15:00→09:00 (the
  18 h max), SmartActiveHoursState=0 so Windows can't auto-adjust them.
  **Conferred onto the show machine automatically**: the in-app Authorize click
  (firewall banner) applies them in the same elevated script as the firewall
  rule. Manual fallback for machines already authorized:
  HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings →
  ActiveHoursStart=15, ActiveHoursEnd=9, SmartActiveHoursState=0 (DWORDs).
  Dev machine already set both ways (manually + by the tested script).
- Intel driver on THIS dev machine (i7-10710U, Comet Lake, 10th gen): on the
  legacy 7th–10th gen branch. Latest is 31.0.101.2141 (security-mostly since
  2023); machine has 30.0.101.1660 (2022-03). Updating is low-risk and MIGHT fix
  the wgpu-30 vkCreateDevice crash (not guaranteed — legacy branch got few
  functional fixes). We are NOT stuck on old Vulkan — driver speaks Vulkan 1.3,
  ample for our compute shader; the pin is wgpu-the-library 29 vs 30, which
  costs nothing functionally today. After any driver update: try wgpu 30, keep
  the pin if it still crashes.

## Round 13 (2026-08-22): handover continues the sACN sequence numbering

Prompted by "when we do the realtime handoff to a new version, does it also sync
the frame/sequence numbers?" — it did not, and the persistent CID from round 7 is
exactly what made that matter.

- **The bug.** `HandoverGrant` carried only config + layer phases. The successor
  built a fresh `SacnSender` whose universes all start at sequence 0. Because both
  instances now present the SAME CID, the receiver carries its per-source sequence
  state across the handover, and E1.31 6.7.2 discards a packet whose delta from the
  last one is in [-20, 0]. So if the outgoing instance happened to stop on a low
  sequence value, the successor's frames were discarded until its counter climbed
  past it — the rig freezing on its last look for up to ~20 frames (~0.33 s at
  60 fps). The counter wraps every ~4.3 s, so the stop value was effectively
  uniform: **~8% of handovers** (20 of 256 values). All universes advance in
  lockstep, so it was all-or-nothing across the whole array.
  Note this was a NEW window opened by round 7: with a per-launch CID the successor
  looked like a different source and got fresh sequence tracking — at the cost of a
  *guaranteed* 2.5 s ghost-merge, which is strictly worse. Round 7 was still right.
- **The fix.** Engine publishes its current sequence to `state.sacn_sequence` after
  each send (one relaxed atomic store); the grant carries it; the successor seeds
  every universe (and the sync counter) at `last + 32` before its first frame.
  Jumping FORWARD is always accepted, so this needs headroom, not precision — 32 is
  comfortably past the 20-wide window and survives universes drifting out of
  lockstep.
- **Only the phase-2 (commit) grant's number is used.** Phase 1 is a prepare: the
  old instance keeps transmitting through our warm-up, so its value is stale by the
  time we send. The commit value is read after the quiesce ack, so it is provably
  the last number that instance will ever put on the wire.
- **`Option<u8>`, not `u8`.** During a real upgrade the grant is produced by the OLD
  binary, which predates the field. `None` = not reported → start fresh, exactly as
  before. A bare `u8` with serde default would have been indistinguishable from a
  genuine 0 and would have had us "resume" from an invented number.
- **Applied immediately before the first send**, not when the grant lands. That is
  the only point that cannot race a re-plan (`configure` resets sequences) or
  `sacn_hold` being lifted. An earlier draft made the resume value sticky inside the
  sender to survive that race; applying it at the send point made the stickiness
  unnecessary and was deleted.
- Tests: all 256 possible stop values resumed and checked against a direct
  implementation of the E1.31 discard rule, sync counter included; plus a test that
  pins the premise (restarting at 0 IS discarded for exactly 20 of them), so the
  fix cannot be quietly regressed into a no-op.

## Round 14 (2026-08-22): touch-screen hardening, show mode, layout gate, feedback reports

Prompted by a live session on the production Windows show machine with a
multi-touch display. Five asks, all in this round.

### Decisions taken with the user (don't re-ask)

- **Multi-touch itself already works** — the correction from the user is that the
  problem is *OS/browser gesture interference*: press-and-hold raises the context
  menu, and stray contacts start pinch-zoom / scroll. So this is gesture
  suppression, not pointer plumbing.
- **"Compile-time" overflow checking is not achievable in CSS.** Agreed
  substitute: a **Playwright layout test in CI** over a viewport matrix that fails
  the build when anything overflows the viewport. (User picked this over a
  dev-only runtime detector.)
- **Report bundles carry a timeline *and* rendered frames**, written to disk on
  the Gate machine and listed/downloadable from the UI.
- **Fullscreen is "show mode"**: it also hides the app chrome so the array fills
  the display. Esc or an unobtrusive corner control brings the UI back.

### Steps

- [x] **Touch/gesture hardening.** `src/touch.ts` suppresses contextmenu (except in
      text fields — pasting an IP into Settings still needs it), Ctrl/⌘+wheel zoom,
      Safari `gesture*` pinch, and Ctrl +/-/0. CSS adds
      `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation` on
      html/body, `overscroll-behavior: none`, `-webkit-touch-callout: none`,
      app-wide `user-select: none` (re-enabled for inputs/code), and
      `touch-action: none` on the whole `.live-page` (not just the canvas — a
      stray contact on the padding used to start a scroll and cancel another
      finger's stroke). `tauri.conf.json` gets `--disable-pinch
      --overscroll-history-navigation=0` (keeping wry's own
      `--disable-features=msWebOOUI,...`, which passing the option replaces) and
      `zoomHotkeysEnabled: false`; aux windows get the same in `open_aux_window`.
- [x] **Windows touch-feedback visuals off** (`src-tauri/src/touch.rs`).
      `SetWindowFeedbackSetting` for all 11 FEEDBACK_TYPE values, on the window
      AND every child HWND (WebView2 hosts content in children — that is where
      touch lands, and the setting does not inherit). Declared as a bare
      `unsafe extern "system"` block against user32 rather than pulling in the
      `windows` crate. Re-applied 4× at 500 ms after startup because the child
      HWNDs appear after the window does. **This is the suspected cause of the
      "square background flashes when I tap" artifact** — the OS contact visual
      forces a repaint that exposes the transparent canvas's backing — with the
      tap-highlight fix as the other candidate. Needs the user to confirm live.
- [x] **Show mode** (`useShowMode` in App.tsx): F11 / ⛶ button toggles native
      fullscreen (`setFullscreen`, capability added) *and* hides the topbar. Esc
      exits, unless a modal is open (it owns Escape first). Persisted in
      localStorage, re-applied on mount — the WebView2 data folder is keyed by the
      app identifier, so it survives restarts and self-update binary swaps. The
      Live tab's top-right corner cluster shifts down 44px to share the corner
      with the exit pill; Report stays reachable in show mode.
- [x] **Layout gate** (`tests/layout.spec.ts` + `playwright.config.ts` +
      `scripts/mock-backend.ts`). 8 viewports × 4 tabs + show mode. Fails on any
      horizontal overflow, any box clipping its own content, or the Live tab
      needing to scroll (except at the ≤700px breakpoint, where a scrolling
      column is the design). Replaced elements and `text-overflow: ellipsis` are
      exempt; anything deliberately off-screen must declare `data-layout-exempt`.
      Runs in the new `checks.yml` on every push and on release tags.
- [x] **Feedback reports** (`src-tauri/src/report.rs`, `src/Report.tsx`,
      `docs/report-bundle.md`). Always-on 22 s ring buffer; 10 Hz snapshots of
      *effective* layer params + audio + control bus; discrete actions in a
      timeline (drawing folded to ≤4 entries/s with running totals); frames
      decimated 8× and stored raw; PNG contact sheet so an agent can see the
      complaint. Written to `<config>/EmpyreanGate/reports/<id>/`, served at
      `/reports` and `/reports/{id}/{file}`, 40 kept.

### Layout bugs the gate found (all real, all fixed)

1. **The reported one.** In portrait (`max-aspect-ratio: 39/50`), `.size-ctl`'s
   base `width: 100%` claimed an entire wrap row, stretching the Size/Speed
   sliders the full window width. Now `min(340px, 100%)` there.
2. `.gate-canvas` sized itself `min(100%, 100vh - 60px)` — a *guess* at the chrome
   height. Whenever the guess was low (a banner showing, a 900×900 aux window) the
   square came out taller than its box and `main` grew a scrollbar. Now sized from
   its container (`height: 100%; width: auto; max-width: 100%; aspect-ratio: 1`).
   **Watch out:** that made the squarish media query's `align-items: center` fatal —
   it shrinks `.live-canvas-wrap` to content height, so `height: 100%` resolves
   against an indefinite height and the canvas collapses to the 300px default,
   dragging the floating corner clusters inward. Removed; the wrap already centers.
   The gate did NOT catch this (a too-small canvas doesn't overflow) — the
   screenshot run did.
3. `.slider-val { width: 40px }` clipped "1.00×" (45px). Now `min-width: 48px`.
4. The topbar overflowed at ≤900px (worse after adding Report + Show mode). Now
   `flex-wrap: wrap` as an invariant backstop, plus icon-only ghost buttons and
   no GPU name below 1150px and no version chip below 950px.
5. `.key-hint` is `position: absolute` (styled for the corner of an effect
   button); reusing it in the topbar sent "F11" to the page's top-right corner.
   Added `.chip-key`, an inline badge. Also gave the icon-only topbar buttons
   `aria-label`s — the accessible name must not vanish with the visible one.

### Verification

- `cargo check --all-targets` clean, zero warnings; 27 lib tests pass (new: report
  timestamps incl. leap/century days, id ordering, frame decimation shape, id
  traversal rejection, and the default-config fixture guard).
- Layout gate: 39 passed, 1 skipped (show mode on phone), 8 viewports.
- `bun scripts/report-test.ts` against a real headless backend on this machine's
  Intel Vulkan: 99 frames, 4 effect entries, 20 paint messages folded to 3 with
  totals intact, 99 snapshots, 374 KB contact sheet, traversal refused.
- `docs/*.png` regenerated from the mock backend (`bun run screenshots`), so they
  no longer depend on this machine's config or GPU.

### Round 14b: merged with 35 upstream commits, then shipped

This checkout was 35 commits behind `origin/master` — a large unreleased body of
work (control decks, saved scenes/playlists, unattended shows, Pioneer DJ LINK,
external MIDI). Merged straight to master on the user's call (2026-08-22).

- Conflicts were mechanical: module lists, both sides adding tests, and the
  engine layer loop (upstream refactored it onto `render_*` effective values for
  scene transitions). The recorder now reads those, plus
  `master_brightness * master_drop_brightness` — strictly more correct than the
  configured values it had.
- **The merge broke the Live tab and the gate caught it.** `status?.rhythm.bpm`
  guards the status object but not the section, so any status without `rhythm`
  throws and white-screens the tab. Fixed the chain, and gave the mock backend a
  `default-status.json` fixture generated from `RuntimeStatus::default()` with
  the same drift guard as the config — the hand-written mock status is what let
  it through.
- **The gate's vertical rule is now off for Live** (`MUST_FIT_VERTICALLY` is
  empty). The control deck is deliberately a scrolling, user-arranged page
  (`.control-deck-page { height: auto; min-height: 100% }`) and its default
  layout is ~930 px tall at a fixed `rowHeight={48}`, so it scrolls at anything
  below 1080p. **Open question for the user** (see below) — left off rather than
  overriding a collaborator's design decision mid-merge.
- Clipping detection is more precise: only boxes that actually *hide* their
  overflow are flagged, so a resizable deck widget scrolling inside itself is no
  longer reported. `.visually-hidden` is exempt.
- **Live-show close guard** (d66a676): `CloseRequested` on the main window is
  refused while sACN is transmitting and handed to the UI to confirm; confirming
  goes back through the normal close path so stream termination still goes out.
  Same confirmation on switching output off, only in the dangerous direction. If
  the UI can't be reached, the close is ALLOWED — a guard that can trap the
  operator with no way to quit is worse than what it guards against.
- Note: upstream added a `package-lock.json`. The project standardizes on Bun +
  `bun.lock`; left in place rather than deleted mid-merge, but it should go.

### Round 14c: self-update was broken for standalone exes (2026-08-23)

Reported from the field after v0.4.0 -> v0.5.1: "it downloads, quits, and then the
new instance isn't running... launching the app again, it briefly says v0.5.1 but
then changes to v0.4.0."

That last detail is the whole diagnosis. The version chip reads `status.version`
from whatever backend the webview is talking to, so showing v0.5.1 *first* proves
the updated instance WAS running and holding the port. Then the freshly-launched
old binary saw a busy port, ran the takeover, and displaced it — a downgrade,
mid-show if a show had been running.

Three defects, all fixed:

1. **The launcher path was never updated.** The successor runs from
   `empyrean-gate-v<version>.exe`; nothing ever replaced the exe the operator
   actually double-clicks. So every manual start re-launched the old version,
   forever. Now the updater passes `--promote-to <launcher path>` and the
   successor copies itself there once the old process releases the lock
   (retried ~6 s), then re-points launch-at-login at that path.
2. **Takeover had no version check.** Any instance could displace any other.
   Now an instance refuses to take the port from a NEWER one: it calls
   `POST /focus` so the running window comes forward, and exits 0. New
   `GET /version` endpoint; absent on pre-0.5.2 instances, which are treated as
   "unknown" and handled as before.
3. **There were no logs.** Release builds are `windows_subsystem = "windows"`, so
   stderr goes nowhere — and a self-update's successor is a *child* process whose
   stderr is even more lost. `logging.rs` tees to
   `<config>/EmpyreanGate/logs/empyrean-gate.log` (5 MB, one generation kept).
   This is why the report could only be symptoms.

`scripts/update-flow-test.ts` reproduces the exact field failure with real
processes on an isolated port/config and asserts all of it: old instance up →
successor takes over → launcher promoted → a stale old binary refuses and exits
with the new one still serving. Passes.

**No manual install needed** (added in v0.5.3, after the user pushed back on
that conclusion — correctly). v0.4.0/v0.5.1 can't pass `--promote-to`, but the
successor doesn't need to be told: if it is running from a versioned download
AND it just displaced an OLDER instance, it scans its own directory for the
launcher (any `*empyrean*` executable that isn't a versioned download) and
promotes over it. The "displaced something older" condition is what makes this
safe — a launcher newer than us can never be a candidate, because we would have
refused to take its port in the first place.

Only gap: a launcher renamed to something without "empyrean" in it can't be
recognised. Logged as a warning rather than failing silently.

`scripts/update-flow-test.ts` covers both paths — with and without
`--promote-to`. Two things it taught, both about the test rather than the code:
`std::fs::copy` uses CopyFileExW on Windows and carries the SOURCE's timestamp
over, so mtime cannot detect a replacement (the fake-old binary now gets padding
bytes appended so size can); and the versioned download must be named
`empyrean-gate-v<version>` matching the binary's own version, or the successor
correctly decides it is not running from a download at all.

### Round 14d: Live fills the window (2026-08-23)

"live seems to be limited in size? full screen should use as much of the screen
as possible" — this settles the question round 14b left open, and it was two
separate caps:

- **Width.** `.control-deck-shell` had `max-width: 1780px; margin: 0 auto`, so a
  1920 or 2560 display got dead margins down both sides. Removed.
- **Height.** `.control-deck-page` is now a full-height flex column and the shell
  takes the leftover height, so the deck has real room to be arranged into. The
  row height itself stays fixed (see below).

**Row height is FIXED — do not make it grow again.** v0.5.4 derived it from the
available height so the deck filled the window; the user's verdict on seeing it
was "the full screen stretches the deck system... maybe revert that?", and they
were right: growing rows stretches every widget with them and the deck stops
resembling what was arranged in the editor. Reverted in v0.5.5. Using the extra
space is the **layout tool's** job — resize the widgets in Edit deck.
(An earlier attempt to make rows *shrink* to fit was worse still: it fits by
clipping the inside of each widget — the pen grid loses its last row, the
effects pad loses a pair. Caught in a 900x900 screenshot.)
When a deck is taller than the window the shell scrolls, which keeps the *page*
from scrolling — a page scrollbar is what turns a touch drag into a scroll
rather than a stroke, and that is the thing actually worth preventing.

Consequently **the gate's `MUST_FIT_VERTICALLY` rule is back on for Live**, which
is the strongest state it has been in. Phones still opt out at the 700px
breakpoint, where stacking and scrolling is the design.

Also: the Patch tab pushed the topbar onto two lines at 1400px, so the
label-collapse breakpoint moved 1150 → 1500. And `docs/live-show-1080p.png` is a
new screenshot taken in show mode at the display's real resolution, since that is
the configuration that actually ships.

Also in this round: the array preview widget had a panel background behind it,
so the ring sat in a black square instead of compositing over the page. The deck
already stripped widget panels in performance mode, but only inside a
`min-width: 1180px` media query — so the square was there on every iPad and
every window below that. Now the preview widget is stripped at any size, and
only it (other widgets are buttons and want their panel; edit mode keeps bounds
visible).

Known, not fixed: the deck's scheduler widget ("Blackout · 0.00 · HOLD") clips
its own text at the default widget size. It lives inside a scrolling widget body
so it is reachable, and it is the deck author's default layout.

### Round 14e: the black square was the APP ICON (2026-08-23)

"The thumbnail used everywhere still has that black square background
everywhere" — after two rounds of chasing this in CSS. A DOM probe walking the
canvas's ancestors at 1920x1080 and 820x1180 found no opaque background at all,
which is what finally made the phrasing land: *the thumbnail used everywhere* is
the app icon, and the sentence right after it was about the taskbar.

Every icon was flattened onto the app's own backdrop: corner pixels were
`(10, 8, 24, 255)`. Fully opaque. Windows drew that square verbatim in the
taskbar, alt-tab, the window corner and pinned shortcuts.

`scripts/rebuild-icons.py` undoes it exactly rather than guessing: the artwork is
additive light on a known flat backdrop, so subtracting the backdrop leaves the
light itself, alpha comes from the residual's strength, and the colour is
un-premultiplied so the ring doesn't darken as it fades. Downsampling happens in
premultiplied space or thin spokes bleed a halo. `icons/source-icon.png` keeps
the original flattened artwork so this is repeatable.

**Lesson worth keeping: "square background" was reported three times and only the
third reading was right.** The first two fixes (tap highlight, widget panel) were
real problems, but they were not this one. A DOM probe would have ruled out CSS
in minutes at any point.

Also this round: **one taskbar button across updates** (`taskbar.rs`). Windows
derives taskbar identity from the exe path unless told otherwise, and a
self-update runs from a new file every time, so each update produced a fresh
button and broke pinning. `SetCurrentProcessExplicitAppUserModelID` with the
app's identifier fixes it; it must run before any window exists.

On "a new binary every time": expected, and transient. Windows cannot overwrite a
running image, so an update downloads `empyrean-gate-v<version>.exe` beside the
launcher and promotes over the launcher from there. Between the update and the
next restart both exist; `cleanup_old_binaries` deletes versioned siblings
`<= current` (skipping the running image) at the next startup, so it does not
accumulate.

### Round 14f: the close guard could wedge the app (2026-08-23)

"did something break multi-window? new windows are white ... and now i can't
close any windows."

Reproduced the app locally with an aux window forced open (`windows.aux_open`),
captured both windows off the real desktop, and drove `WM_CLOSE` at them. On
this machine the aux window renders correctly (dark, full UI) and always closed
— so the white window is NOT reproducible here and its cause is still unknown.
The close failure, though, was a real design flaw of mine and is fixed:

**The guard is now FAIL-OPEN.** It only refuses a close once the UI has called
`set_close_guard_ready`, which happens after its listener is actually attached
and is dropped again on unload. Before this, if the webview never got that far —
a failed load, an older build, a crash on mount — `prevent_close` fired with
nothing listening and the window could never be closed. A guard that can trap the
operator is worse than the accident it prevents.

Second escape hatch: two close attempts within 5 s always go through, so there
is a way out that never requires Task Manager.

Verified end-to-end with the guard armed (sACN "live" but pinned to 127.0.0.1 so
nothing could reach the lighting network): aux window closes immediately, main
window refused once, second attempt closes and the process exits cleanly.

**Windows now declare a dark background colour** (`#0A0814`, both the main window
in tauri.conf.json and aux windows in `open_aux_window`). A webview paints white
until the document's own background applies, so a slow or failed load showed a
white rectangle — which is at least half of what was reported, and is worth
fixing regardless of the root cause. Aux window creation is also logged now, so
a white window on the show machine leaves a trace to read.

### Windows shell gestures (asked 2026-08-22, applied 2026-09-02)

The in-webview gestures are handled (round 14). The remaining ones were the
*shell's* — edge swipes for Action Center / Task View / the taskbar, and the
Win11 three/four-finger touch gestures. No per-window API can swallow those;
they are owned by explorer.exe. The user asked for them off after a 4/5-finger
pinch minimized the app mid-show, so as of 2026-09-02:

1. **Applied** — `HKCU\Control Panel\Desktop\TouchGestureSetting=0` (the
   Settings → Bluetooth & devices → Touch toggle) is written by
   `touch::disable_shell_touch_gestures()` at every app start. Per-user, no
   elevation; may need one sign-out to fully apply the first time.
2. **Applied** — `HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI` →
   `AllowEdgeSwipe=0` joined the elevated Authorize script in `firewall.rs`
   (one UAC prompt, same pattern as the firewall rule and active hours).
   Documented for Win10; verify on the Win11 26xxx show machine after the next
   Authorize click.
3. **Applied differently** — instead of taskbar auto-hide, show mode now also
   sets always-on-top with fullscreen (`App.tsx` useShowMode), so the taskbar
   cannot sit over the bottom edge and eat slider input.
4. Assigned Access / kiosk mode for the show account remains the fallback if
   any of the above fails on the real machine — the only complete answer, and
   the most disruptive.

### Still to confirm with the user (needs the real touch display)

~~0. Should the Live control deck be forced to fit the window (derive `rowHeight`
   from the available height instead of a fixed 48) so the show surface never
   scrolls? Recommendation: yes — a scrolling performance surface means a touch
   drag scrolls the page instead of playing — but it changes a collaborator's
   deliberate design, so it needs a decision. **ANSWERED — done, see round 14d.**
1. Does the tap artifact (square background flash) actually go away? Two fixes
   landed for it; if it persists, the next suspect is WebView2 compositing the
   transparent canvas, and the test is whether an opaque canvas backdrop stops it.
2. Is multi-touch now uninterrupted in practice (no context menu, no zoom/scroll
   stealing strokes)?

## Next session pickup

- **Node-graph patch paradigm designed** — see `plans/node-graph.md` (typed
  dataflow shapes, WGSL codegen, React Flow editor, patch files, sub-patches).
  Awaiting user sign-off on its open questions before implementation.
- Run `bun tauri dev` and eyeball the actual patterns; tune defaults.
- Get real geometry numbers from the user (px/spoke, radii, LED density) and
  controller IPs; test against a PixLite.
- Consider GitHub remote + first CI run.
- Next performance ceiling: batched UDP I/O (`sendmmsg`/RIO) for 100k+ pixel scales.
- Media follow-ups: resilient provider-specific extraction and authenticated/DRM
  sources only if a deployment actually requires them.

## Round 12: unattended show scheduler

- [x] Durable saved playlists with embedded scene snapshots, per-cue dwell and
      crossfade times, reordering, add/remove, naming, repeat, skip, and stop/hold.
- [x] Backend-owned show clock: advances headlessly, persists the active cue, and
      resumes the enabled playlist after a process restart without a controller.
- [x] Smoothstep layer-stack crossfades with incoming phase preservation, so the
      end of a transition does not reset the new scene's motion.
- [x] Nine built-in long-play compositions and a one-click all-night journey
      (35 minutes each, 20 second transitions, repeat forever).
- [x] Accelerated two-scene integration run: transition observed, auto-advance
      confirmed, no GPU error, and active cue restored after restart.
- [ ] Real PixLite/sACN and production Mac mini validation is deliberately deferred
      until the installation hardware is unpacked on playa next week.

## Round 13: restore Replay as a production workflow

- [x] Reversed the product-level intent of `8a8325e`: Archive is again a normal
      production tab and `/#replay` works in desktop, headless web, and PWA builds.
- [x] Restored single-file playback, whole `Uprising-Data` folder indexing,
      metadata titles, recent filesystem references, seeking, looping, and variable
      playback speed. Recordings remain local and stream one frame at a time.
- [x] Kept the shared per-user Vite fixture cache as an optional development
      convenience without making Replay depend on that endpoint.

## Round 14: Program / Ready scene switcher

- [x] Replace the duplicate machine-health checklist with a persistent, independently
      rendered Ready bus: Program and Ready have separate live previews and loading a
      scene into Ready cannot change the Gate output.
- [x] Add an operator Take that crossfades Ready to Program and moves the previous
      Program look back to Ready, plus safe off-air motion and layer-enable adjustments.

## Round 11: external rhythm sources

- [x] Split lighting timing from per-layer audio energy without changing the default
      behavior: Layer Audio still gives every layer the beat belonging to its own
      level/bands/waveform/spectrum source.
- [x] Add a global MIDI Timing Clock adapter (24 PPQN) with tempo/phase extrapolation,
      Start/Continue/Stop, Song Position, exact-port hot-plug recovery, ±250 ms visual
      latency calibration, live health, and optional fallback to a chosen audio source.
- [x] Manual BPM remains the explicit highest-priority override; half/normal/double
      time and beat taps operate on the selected effective lighting clock.
- [x] Add receive-only native PRO DJ LINK beat/status input. It listens on the
      standard UDP 50001/50002 ports, follows tempo-master status or a pinned player,
      handles master handoff, and deliberately never claims a virtual deck identity
      or emits a control packet onto the DJ network.
- [x] Add a real published Boiler Room track-list excerpt plus synthetic deck/BPM/
      cue annotations and a UDP+WebSocket E2E replay (`scripts/pioneer-link-test.ts`).
      No copyrighted audio is stored. Source facts are explicitly distinguished
      from test-only annotations in the fixture.
- [ ] Validate against the actual production deck/mixer models before enabling at a
      show. Add rekordbox track/cue/phrase metadata only after the beat/master path is
      proven on that hardware; official Bridge/TCNet remains an alternate adapter.

## Round 14: persistent production diagnostics

- [x] Replace console-only app logging with console + persistent logs under the
      Empyrean Gate config directory. The current file and three backups are each
      capped at 1 MiB; rotation closes the handle before renaming for Windows safety,
      and any logging I/O failure is non-fatal to show output.
- [x] Show persistent-log health and the exact local path in Settings, with a copy
      action for desktop operators.
- [x] Add a bounded 2 MiB recent-diagnostics download to Settings for desktop and
      authenticated web clients. Credentials travel only in the POST body, responses
      are `no-store`, remote requests require the exact join token (client IDs are
      never treated as credentials), revoked clients are refused, and the export
      redacts the configured join token plus credential-shaped URL query parameters.
- [x] Focused unit coverage for rotation bounds, oversized-record truncation,
      redaction, and diagnostics authorization. Automated Cargo/Vite execution is
      deferred because the mandated compute-budget broker is absent on this machine;
      no unbrokered build was run.

### Production performance baseline

- The production show machine is an older Mac mini than the development Mac; exact
  model/specs are not yet recorded. Treat its release-build benchmark as the real
  performance baseline before increasing layer/pixel load or doing speculative
  optimization.
- On that Mac mini, run
  `cargo run --release --bin engine-smoke -- --suite --warmup 120 --frames 600 --json`
  with the real geometry. Keep the report with the machine model, macOS version, GPU,
  and release version. The existing Intel-iGPU 1.74 ms development result is useful
  headroom evidence, not a production guarantee.
- Continue prioritizing deadline misses/p95-p99 frame time over mean frame time. The
  next known scaling optimization remains batched UDP I/O at 100k+ pixels.

## Round 14: Windows launch at startup

- [x] Added a Settings toggle backed by a per-user Windows Startup-folder shortcut;
      it requires no administrator rights and reports the observed OS state or a
      clear unsupported no-op on non-Windows platforms.
- [x] The shortcut is rewritten to the running executable before updater cleanup,
      so a successful self-update retargets it to the new versioned binary before
      the old target can be removed. Desktop/headless launch mode is preserved.
- [x] Startup changes use a dedicated WebSocket action and are persisted only after
      the OS operation succeeds; stale full-config writes cannot toggle the shortcut.
      Added focused legacy-config, protocol, and non-Windows behavior tests.

## Findings / gotchas

- **wgpu 30 crashes (STATUS_ACCESS_VIOLATION) inside `vkCreateDevice` on this dev
  machine** — Intel UHD Graphics, driver 30.0.101.1660 (2022-03-17, Vulkan 1.3.205).
  Not the validation layer (crashes with `InstanceFlags::empty()` too). **wgpu 29 works
  fine on the same driver** → pinned `wgpu = "29"`. Revisit 30+ after a driver update.
  Consider updating the Intel driver on this machine (user decision, not done).
- wgpu validation layers are off by default (`EMPYREAN_GPU_DEBUG=1` opts in): the
  installed VulkanSDK 1.4.304 validation layer is another crash suspect on this driver.
- Engine perf on the Intel iGPU: 1.74 ms/frame for 22,400 px (default stack, debug
  build) — huge headroom vs the 16.6 ms 60 fps budget.
- cpal 0.18: `Device::name()` is gone → `device.description()?.name()`; `SampleRate`
  is a plain `u32`; `build_input_stream` takes `StreamConfig` by value.

## Round 14 (2026-08-23): match the installed patch, then verify it from the wire

Started from a screenshot of the controller software's patch table and ended with the
live rig's own traffic decoded. What changed:

- `output.universe_stride` (default 6). The rig allocates a 6-universe block per spoke
  and uses 3; strips sit on every other PixLite output, half of each block reserved for
  the doubling. The sender packed spokes tightly, so spoke 1 landed on universe 4 where
  the rig listens on 7, and the error compounded around the ring.
- `pixels_per_spoke` 350 → 378 in the defaults, and **set on the Gate machine itself**
  (2026-08-23, at the user's request) via the WS `set_config` API — editing `config.json`
  would be clobbered by the running process. Confirmed on disk and on the wire.
- Spoke numbering displayed 0-based everywhere; universes/channels stay 1-based. See the
  indexing-conventions bullet at the top.
- New `sacn-listen` binary: passive E1.31 decoder that reports traffic in this
  installation's terms ("universe 7 = spoke 1, px 0-169") and compares each universe's
  used extent against what the config predicts.

Wire evidence (LightJams driving the rig, ~31.7k packets): block starts every 6
universes, offsets 0 and 1 carrying 510 channels, offset 2 carrying exactly 114
(38 px), nothing at all on offsets 3-5, 63 consecutive spoke blocks with no gaps.
The patch is confirmed independently of the screenshot it was derived from.

### Gotchas found the hard way

- **Multicast joins lie at scale.** `join_multicast_v4` returns Ok for all 400 groups;
  the NIC's filter table (commonly 32-64) then drops the rest in hardware, silently.
  130+ universes looked exactly like universes nobody was transmitting. `sacn-listen`
  sweeps in windows above `--window` and says so. Any future receiver must do the same.
- **E1.31 priority outranks, it does not blend.** LightJams transmits at priority 101,
  Gate at 100, on the same 192 universes: receivers follow the highest priority and
  ignore the rest outright — Gate's output never reaches the rig. Only *equal*
  priorities merge (HTP). The user is handling the handover separately.
- **`config::load()` writes to whatever `EMPYREAN_CONFIG` points at** (generates the CID
  and join token when blank, leaves a `.json.bak`). Pointing a tool at
  `tests/fixtures/default-config.json` therefore dirties the fixture and breaks its
  guard test. Restore it afterwards.
- The Gate machine has `require_token: true`; a WS client must send `server.join_token`
  in its hello or gets `denied` after the first `state` message.
- `Instant::now() + Duration::MAX` panics with an overflow. Model "no deadline" as
  `Option<Instant>`.

## Open questions for the user

1. Pixel count and universe map are now confirmed against the installed patch (378
   px/spoke, 6-universe stride) and shipped in `default-config`. Still estimates:
   LED density (60/m) and the minor radius (8 ft) — editable in Settings → Geometry.
2. Show machine OS? CI builds Windows + Linux; add macOS on request.
3. Which public video providers matter in practice? Direct files and standards-based
   metadata work now; changing provider sites remain optional `yt-dlp` territory.

## Things not to do

- **Unbrokered builds.** Wrap every cargo/vite build in the compute-budget broker:
  `node ~/.claude/bin/cpu-slots.mjs run --slots 4 --label "empyrean cargo" -- cargo …`
  (2 slots for vite, 1 per spare app instance). Don't build while `tauri dev` runs —
  it also relinks the same exe (see the dev-app crash gotcha above).
- Cross-compiling on sentinel: evaluated 2026-08-19, declined — Tauri Linux→Windows
  cross builds are fragile; CI artifacts are the remote release builder; sccache (cache
  on sentinel) is the approved-if-wanted accelerator for cold local builds.

- No non-Vulkan wgpu backends, no CPU fallback renderer — error clearly instead.
- Don't default sACN output on.
- Don't add an installer/updater to CI — raw binary artifact only.

## Show machine (empyreangate) — state as of 2026-08-23

Managed over SSH (`ssh empyreangate`, key-only, elevated) via the self-hosted
headscale tailnet — see `plans/headscale-mesh.md` in the ops repo for that layer.

- **Autostart cutover done**: `Lightjams LED Mapper` removed from the Run key;
  `Empyrean Gate` registered (config `autostart: true` + HKCU Run seeded).
  Autologin is on and BIOS boots on power-loss, so power-cycle → show, no hands.
  Teams/OneDrive autostart removed.
- **Drivers updated** (both installed driver-only via signed-payload + pnputil,
  no OEM installers): GPU 31.0.101.3729 → **32.0.101.7088**, NIC I225-V
  1.1.3.28 → **2.1.5.7**. App verified running on the new GPU driver.
  - GOTCHA: 12th-gen iGPU (DEV_46A6) is NOT in Intel's newest "Arc & Iris Xe"
    branch (8xxx) — it needs the split-off "11th–14th Gen" branch (7088).
  - GOTCHA: the NUC OEM driver matches full SUBSYS and OUTRANKS any generic INF
    regardless of version — new driver only binds after `pnputil /delete-driver
    <oemNN>.inf` of the OEM package, then `/scan-devices` (no reboot needed).
  - GOTCHA: editing the app's `config.json` from PowerShell 5.1 with
    `-Encoding utf8` writes a BOM; the app then falls back to its own
    `config.json.bak` (settings survive) and re-saves — which reverted
    `autostart` and deleted the Run key. Edit with
    `[IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($false))`.
- The wgpu-29 pin (this dev machine's old driver) may be re-testable against
  the show machine's new driver when convenient — dev machine driver is still old.
