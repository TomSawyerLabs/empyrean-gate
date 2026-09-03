# Per-layer / per-patch-node mini visualizers

## Goal

Every layer in the stack and every node in a patch gets its own small live
visualizer so it's easy to see what each one contributes to the final image.
Works for both output styles: spatial contributions render as a mini ring laid
out like the real hardware; scalar/amplitude outputs render as a level meter
with a short history.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\Empyrean` (github TomSawyerLabs/empyrean-gate
  — remote moved from cinderblock/empyrean-gate, old URL still redirects).
- Shared working tree with other Claude sessions — stage explicitly, append to
  `.agent-commit-coordination` before pushing. Session tag: `empyrean-gate-ring`.
- No local Rust toolchain assumptions verified yet; typecheck via `bun run` scripts.
  (Other sessions noted "no local Rust toolchain" — verify with `cargo check` once.)
- Base: master at 6616b40 (after v0.10.12; guest/admin roles landed in a1bf73d).

## Decisions already made (don't re-ask)

- **Interpretation**: "every patch, every layer" = every *layer* in the stack AND
  every *node* in the node-graph patch editor. "Laid out like real hardware vs
  amplitude output" = spatial wire shapes (FieldColor/FieldScalar/Pixels/Texture)
  get a mini ring; Scalar/Event wires get an amplitude meter.
- **Backend renders the solo frames** on a dedicated low-res Engine bus (the
  `ready_engine` pattern in `engine/mod.rs:1502,2845-2939`): same normalized
  polar math (verified — `gate.wgsl:1450-1461` derives theta/r from indices),
  so a small `spokes × MINI_PIXELS` grid renders identical patterns cheaply.
- **One layer per program frame** on the mini bus (cursor cycling), batch
  published when the cursor wraps — spreads GPU cost, no burst.
- **Frontend uses ONE shared WebGL context** that renders each mini and blits to
  per-widget 2D canvases. Browsers cap ~16 GL contexts (already bitten in round
  3); up to 24 layer rows + N patch nodes would blow past it with GateCanvas.
- Mini previews are guest-visible (previews are "play surface" per
  `server.rs:974-978` doc comment); subscription is refcounted client-side and
  only active while a view showing minis is mounted.
- Layer minis are keyed by **config layer index** (GPU slot index ≠ config index
  — disabled/walked-out layers are skipped when packing, `engine/mod.rs:2414-2426`).

## Plan / steps — ALL DONE (2026-09-02)

1. [x] Read core files (engine, patch, protocol, server, state, frontend).
2. [x] Backend: `engine/minis.rs` MiniBus — solo renders cycling one layer per
   frame, publishes `MiniBatch` over `state.minis` broadcast; idle without
   subscribers (`state.mini_watchers`).
3. [x] Protocol: `SubscribeMiniPreviews`/`UnsubscribeMiniPreviews`,
   `mini_preview_meta` server msg, `MINI_PREVIEW_MAGIC` (0x4547_4D56) batch.
4. [x] Server: `MiniSub` per connection, meta announced on epoch change,
   `encode_minis`; no ack flow (small batches, min_interval throttle only).
5. [x] Frontend: `miniPreview.ts` (MiniHub refcounted subscription + ONE shared
   WebGL stage blitted to per-widget 2D canvases), `MiniViz.tsx`
   (MiniRing/MiniMeter), ws.ts `parseMiniBatch`.
6. [x] Placed: Settings LayerEditor (44px), Live LayerLevelRow (24px, grid grew
   a 4th column), Control LayerFader. Ready editor SKIPPED deliberately — the
   mini bus solos Program layers; the off-air Ready stack would need its own
   sweep for honest cells.
7. [x] Patch nodes: `Program::preview_wgsl` companion module (one thumbnail per
   field node, same slab), CPU scalar outputs in the batch; ring/meters in
   React Flow node bodies (active patch only; meters for wired ports + "out").
8. [x] Verified: tsc, cargo check + 237 lib tests (incl. new preview-module
   naga validation), layout gate 80 passed, behavior 64 passed,
   `scripts/mini-preview-test.ts` end-to-end MINI PASS (isolated backend:
   layer cells lit, patch cell lit, lfo meter moving, mode-flip clear,
   unsubscribe silence). Screenshots eyeballed via Playwright.
9. [x] README updated (Layers bullet).

## Findings / gotchas

- **Meta-vs-status ordering**: `mini_preview_meta` for a patch flip arrives
  BEFORE the 2 Hz status tick reports `patch_active` — a sequential-cursor
  test waiting on status first silently consumes the meta. Cost an hour; the
  test now collects metas out-of-band.
- The mini engine and the patch preview share one Engine: `render()` picks the
  patch pipeline only when `patch_params` is Some, so layer solos and node
  thumbnails coexist; `Pending` labels each ping-pong readback because the
  returned buffer belongs to the PREVIOUS dispatch.

- `Engine::render` is ping-pong: returns the PREVIOUS submission's frame. When
  cycling solo layers, the readback belongs to the previous cursor position —
  label readbacks with the previously-submitted layer index.
- `Engine::new(npix)` creates its own wgpu Instance/device — fine, ready bus
  already does this; mini bus uses tiny npix.
- Patch mode: when `patch_params` is Some, the layer stack isn't rendered at
  all; Control hides layer faders behind `status.patch_active`.
- Remote moved to TomSawyerLabs org (push prints a redirect notice).

## Open questions for the user

(none yet)

## Things not to do

- Don't give each mini its own WebGL context (16-context browser cap).
- Don't render minis when nobody subscribed (venue WiFi bandwidth).
- Don't touch the four version files (package.json, Cargo.toml, Cargo.lock,
  tauri.conf.json).
