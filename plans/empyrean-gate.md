# Empyrean Gate — pattern generator

## Goal

Greenfield Tauri + React desktop app that generates visual patterns for the Empyrean
Gate — a radial array of lights above a dance floor — and outputs them over sACN
(E1.31). GPU-computed patterns (Vulkan, no fallback), live preview UI, settings page,
audio-reactive (beat + multi-band features from DJ audio input), effects triggered by
keyboard/mouse/touch. CI builds a standalone binary (no installer/updater).

## Physical installation (defaults; ALL configurable in-app — user is unsure of exact numbers)

- 64 spokes of LED strip in a radial array ("wagon wheel" viewed from below).
- 16× Advatek Pixlite Mk4-S controllers, 4 strings each → 64 strings, 1 string = 1 spoke.
- ~350 px per spoke (default 350, configurable).
- Major (outer) diameter 50 ft → outer radius 25 ft. Minor radius ~15–20 ft diameter →
  default inner radius 8 ft (configurable; user unsure).
- LED density 30 or 60 LED/m (default 60, configurable; only affects physical-space mapping).
- **Strings are fed from the outside**: pixel 0 = outer radius (50 ft dia), last pixel =
  innermost radius. Spoke direction matters for chases.
- Protocol: sACN over UDP 5568. Unicast to controller IPs (configurable) or multicast
  239.255.u.u. 350 px = 1050 ch → 3 universes/spoke (170 px per universe), each spoke
  starts on a fresh universe boundary → 192 universes total by default.

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

## Next session pickup

- Run `bun tauri dev` and eyeball the actual patterns; tune defaults.
- Get real geometry numbers from the user (px/spoke, radii, LED density) and
  controller IPs; test against a PixLite.
- Consider GitHub remote + first CI run.
- Stretch: video layer (decode → texture → sample in shader), auth tokens, sendmmsg/RIO.

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

## Open questions for the user

1. Exact pixel count / density / minor radius — defaults chosen, all editable in
   Settings → Geometry. Update `default-config` when real numbers are known.
2. Show machine OS? CI builds Windows + Linux; add macOS on request.
3. Stretch goal (video file as layer) not in first pass — needs decoder (ffmpeg) +
   texture-sampling layer; architecture leaves room (layer kind + sampled texture).

## Things not to do

- No non-Vulkan wgpu backends, no CPU fallback renderer — error clearly instead.
- Don't default sACN output on.
- Don't add an installer/updater to CI — raw binary artifact only.
