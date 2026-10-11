# Public floor — opening some controls to the internet

## Goal

Let strangers on the internet (and phones on the venue Wi-Fi via the same URL)
play the array — tap effects, draw, play the games — through a URL we publish,
without exposing show control, operator secrets, or the show machine's
stability. Three pieces:

1. **Security + performance** so a public URL cannot take the show down or over.
2. **A simpler public UI**, purpose-built for play: the touch surface, the
   current game's controls, a name chip, nothing else.
3. **Secret URLs** that unlock easter eggs for specific groups.

Cameron (2026-10-11): "we're looking to run this again, and are considering
opening a public URL to some controls … Probably also a 'simpler' interface for
the public. Purpose built for games or the type of multisource input that the
VJ is playing." Domain not bought yet; deployment will be cloudflared and/or
Caddy managed outside this repo; LAN DNS overrides will point the same name at
the local IP for direct hosting.

## Environment / context

- Repo `~/git/Personal Projects/Empyrean`, branch `master`, v0.12.1 shipped.
  Origin is `TomSawyerLabs/empyrean-gate`.
- Backend: Rust/axum in `src-tauri/src/server.rs` (one listener, port 9520).
  Frontend: React 19 + Vite, `src/`. Checks: `bun run typecheck`,
  `bun run test:unit`, `bun run test:layout`, `bun run test:behavior`,
  `cargo test --lib` in `src-tauri/`. Local Rust toolchain works.
- Config fixtures: adding a config section requires
  `EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture` (writes
  `tests/fixtures/default-config.json` / `default-status.json`, LF).
- Show machine is `empyreangate` (Windows, Intel Iris Xe), reachable over the
  headscale tailnet when on. Nothing in this task touches it or any proxy —
  per the global rule, infrastructure changes are staged elsewhere (ops repo)
  and need per-change approval. This repo only has to *work behind* a proxy.

## Threat model findings (why the design below is structural)

Read 2026-10-11 from `server.rs`, `protocol.rs`, `state.rs`, `config.rs`:

- **Loopback is the operator.** `client_is_admin` returns true for any
  `127.0.0.1` peer; `require_local_operator`, patch editing, game start/stop,
  token rotation, `POST /handover` (stops sACN and exits the process),
  `POST /close-grace/exit`, `/focus` are all loopback-gated. A reverse proxy
  on the show machine (cloudflared, Caddy) connects from 127.0.0.1, so **every
  internet visitor would be the operator**. Proxying port 9520 can never be
  safe; the public surface must be a separate listener that has no notion of
  loopback privilege.
- **Guests receive the whole config.** `redact_for_remote` blanks only the
  admin token. A LAN guest's `State` carries `join_token`, `staff_token`,
  `wifi_password`, every remembered client's id + admin flag (ids are the
  bearer credential — a guest can Hello as an admin's id and *become* admin),
  and `RuntimeStatus` carries LAN IPs, device names, PRO DJ LINK debug, the
  diagnostics path. None of that can go to the public; and the client-id leak
  is worth closing on the LAN too.
- **Every new client writes config.json and broadcasts the full State to
  everyone.** `Hello` from an unknown id → `update_config` (disk write +
  N-way broadcast). `MAX_CLIENT_RECORDS = 256` then refuses newcomers. A crowd
  of 500 phones fills the list in minutes and makes the Clients panel useless.
  Public sessions must be in-memory, never config records.
- **Open messages with side effects.** Anyone authenticated can: `PatchParam`
  (writes the patch file on every call), `Report` (writes a bundle to disk),
  `CheckUpdate` (hits GitHub), `Imu` (steers the global control bus),
  `AudioFrame`, `SubscribePreview` (≈1.4 Mbps per phone), `GetState`.
- **No rate limiting anywhere**: not messages, not connections, not per IP.
  Flood protection is only the dab/queue eviction in `state.rs`.
- **The preview stream is the bandwidth.** 64 × 378/6 × 3 B × 20 fps ≈
  1.9 Mbps per phone over the venue uplink via cloudflared. 100 public viewers
  would be 190 Mbps. Public preview must default to off, with a tiny
  thumbnail as the operator's opt-in.

## Decisions already made (don't re-ask)

- **Separate public listener, not a role on the main port.** New
  `public_server.rs`, default `127.0.0.1:9521` (proxy on the same host), its
  own router with an allowlist of routes and an allowlist of messages. It never
  consults `config.clients`, never grants admin, never serves the operator UI.
  Reason: a denylist on the existing handler would have to stay correct across
  every future message; a second router can only do what it was written to do.
- **The main listener refuses proxied requests** (`X-Forwarded-For`,
  `CF-Connecting-IP`, `X-Real-IP`, `Forwarded` present → 403 pointing at the
  public port; `server.refuse_proxied`, default on). Defense in depth against
  the one misconfiguration that would be catastrophic.
- **TLS is Caddy's / Cloudflare's job, not the app's.** cloudflared terminates
  TLS at the edge and tunnels plain HTTP to `127.0.0.1:9521`. For the LAN
  direct path (local DNS override → show machine), Caddy on the show machine
  does DNS-01 (Cloudflare DNS plugin) and proxies to 9521. Reasons: the
  Cloudflare API token then lives in Caddy's config, not in the show config
  this app broadcasts; renewal, OCSP, HTTP/2, header hygiene are solved there;
  the ops repo already manages Caddy; a TLS bug in the app would take the
  operator UI down with it. What the app *does* take on: honouring forwarded
  client IPs (for per-IP caps and the roster only, never for privilege),
  same-origin `wss://` (already how `ws.ts` resolves its base), a configured
  public URL for QR/poster, and documented proxy recipes. Revisit only if a
  show has no proxy at all; then the answer is still "run Caddy".
- **Public sessions are ephemeral and in memory.** Bounded registry keyed by
  connection; roster shows them with a Block (id + IP, process lifetime).
- **Public input is a capability set the operator flips live**: `open`
  (master), `allow_draw`, `allow_effects`, `allow_games`, `allow_knobs`, plus
  `input_level` (0..1 multiplier on public dab/effect intensity, separate from
  the LAN "Floor input" fader) and `preview_fps` (0 = off). Defaults: open,
  draw + effects + games on, knobs off, preview off.
- **Secret keys → perks.** A key is `{name, secret, perks, enabled, max_uses,
  uses, flourish}`; redeeming adds the perks to the session. Perks named
  `draw`/`effects`/`games`/`knobs`/`preview` override the public toggles for
  the holder; other perk strings pass through to the UI. Redeem via
  `?key=<secret>` on the public URL, `/k/<secret>` path, or typed in the UI
  (`Unlock { key }`, rate-limited). Signed/expiring tokens and track-triggered
  unlocks are follow-ons (see brainstorm).
- **Same JSON protocol, allowlisted.** The public UI speaks `ClientMsg`, with
  `hello.surface = "public"` so a misdirected full UI gets a clear refusal and
  the mock backend can tell the two apart. Server → public: a small
  `public_state` snapshot (not `State`/`Status`).
- **Vite multi-page**: `public.html` → `src/public/`. Same embedded `dist`.
  Public listener serves `public.html` at `/` and only the assets the public
  page needs.

## Plan / steps

1. [x] Threat model + design; this plan.
2. [x] **Backend hardening of the main listener** (own commit): refuse proxied
   requests; redact client ids / staff token / Wi-Fi password / client_list
   for non-admin remotes. Unit tests.
3. [x] **Config**: `PublicConfig` + `UnlockKey` in `AppConfig.public`;
   migrate defaults; regenerate fixtures; `server.refuse_proxied`.
4. [x] **Public registry + limiter** (`public.rs`): sessions, per-IP counts,
   blocklist, token-bucket limiter, forwarded-IP parsing, key redemption,
   effective capabilities. Unit tests.
5. [x] **Public listener** (`public_server.rs`): supervisor task (start/stop/
   rebind live from config), router (public.html, assets allowlist, `/ws`,
   `/health`), connection caps at upgrade (503 + Retry-After), Origin check,
   hello within 5 s, message allowlist, clamps + input_level scaling, preview
   clamps, 1 Hz `public_state`, strike counter, idle timeout.
6. [x] **Status + admin surface**: `RuntimeStatus.public` (listening, counts,
   player list capped), `BlockPublic`/`UnblockPublic` admin messages, roster
   shows public players.
7. [x] **Public UI** (`src/public/`): slim client with jittered backoff,
   touch surface (GateCanvas via `previewSource`, schematic ring when the
   stream is off), game chips/commands, pens + colours + effect pads, name
   chip, unlock toasts, "floor closed" / "full" states, code entry.
   `play.webmanifest`. Phone-first; layout gate cases.
8. [x] **Settings → Public floor panel**: enable/bind/port/URL, live toggles,
   input level, preview, caps, keys editor with copyable URL + QR, public
   roster + Block. ⊕ Connect gets a "Public" QR when a URL is set.
9. [x] **Tests**: Rust unit; mock-backend public protocol; Playwright
   `public-floor.spec.ts`; `scripts/public-floor-test.ts` against a headless
   backend (allowlist refusals, limiter, unlock, 404 on `/handover`).
10. [x] **Docs**: README section; `docs/public-deploy.md` with cloudflared and
    Caddy (DNS-01) recipes and the "never proxy 9520" warning.
11. [x] Final sweep: all checks green (2026-10-11: cargo 281, unit 1, layout 96, behaviour 94, headless e2e), landed as `c0c078f` + `41d0065`.

## Secret-URL brainstorm (for Cameron)

Options, cheapest first; A+B+D are in scope, C and F are follow-ons.

- **A. Query key** `https://play.example/?key=<secret>` — printed on cards,
  wristbands, a QR in the camp. Stored on the phone (localStorage), redeemed on
  every hello, so the unlock survives reloads. Operator sets name, perks,
  max uses, on/off; sees redemption count. Weakness: a key is a bearer secret
  — one photo of the card and it spreads. Mitigation: `max_uses`, disable,
  rotate the secret (one tap).
- **B. Path key** `https://play.example/k/<secret>` — same mechanism, prettier
  URL, survives link previews that strip queries. Built alongside A.
- **C. Signed, expiring keys** — `<group>.<expires>.<hmac>` minted by the app
  with a server secret; no per-key config, revocable per group, dies at set
  end. Worth it when cards leak or when you want hundreds of distinct cards.
  Not built: adds a minting UI and clock dependence; A/B cover the first show.
- **D. Code word typed in the UI** — "have a code?" in the public app. The MC
  can announce "type FIREFLY now" and the whole floor unlocks together.
  Low-entropy by nature, so attempts are rate-limited per connection and the
  secret can be short-lived (disable after the moment). In scope.
- **E. Where you are** — LAN clients (the venue Wi-Fi) already get more than
  the internet does (the full guest UI). Could add "perks for anyone on the
  venue network" later with zero new mechanism: a key auto-applied to LAN
  joins.
- **F. Time- or music-triggered** — perks that turn on when a given PRO DJ
  LINK track title plays, or during a cue of the playlist. A single hook in the
  rhythm/playlist code could toggle `enabled` on a key. Fun; not built.

What a perk can be: any of the five capability overrides, or any string the
public UI reacts to (planned examples: `big_brush` raises the stroke-size
cap, `strobe` admits the strobe pad). Adding an easter egg = adding a string
and the UI/handler that honours it. Redeeming a key with `flourish` on fires
a bloom at the array's centre so the group sees it land.

## Findings / gotchas

- `GateCanvas` takes a `previewSource` (built for the archive replay), which
  is how the public page reuses the exact same WebGL ring without the
  `useGate` context's full-protocol client: a tiny provider shim satisfies
  `useGate().client` with `send`/`onStatus`/`onMessage`/`onFrame`.
- `redact_for_remote` has only `is_local`; it needs `admin` too, so a LAN
  admin keeps the roster ids it needs to Block while guests get none.
- A `State` broadcast is one serialization per *connection* already
  (`send_json` in each task) — the public listener does not add to that, it
  never subscribes to `state.events`.
- Cloudflare proxies close idle WebSockets after ~100 s; the 1 Hz
  `public_state` keeps them alive. Cloudflare also caps a request body at
  100 MB and a WS message practically at a few MB; we cap text frames at
  16 KiB on the public listener, so neither matters.
- `rust-embed` serves `dist/` by path: `public.html` lands beside
  `index.html`, Vite's `rollupOptions.input` makes both entries; the public
  listener maps `/` to `public.html` and 404s `index.html` on purpose.
- Playwright behaviour specs run on both Chromium and WebKit; the public page
  is phone-first so it goes in the WebKit list too.
- WebKit opens the WebSocket before React's first effect runs on a cold load
  of the public page, so a status listener registered in that effect misses
  the `open` event. The page now reads the client's current state right after
  subscribing. Chromium never showed it.
- The operator UI's `.name-chip-nudge` ("pick a name") is inline inside a
  nowrap chip; at the public header's right edge its clipped box pokes past
  the viewport and the layout gate flags it. On the public page the nudge
  wraps under the name.
- `GateCanvas` with a `previewSource` whose `subscribe` never emits is the
  trick for pointer handling without a stream (the WebGL ring stays
  transparent over the 2D schematic).
- Playwright's strict mode: reusing `.roster-cutoff` for the public section
  header broke the existing roster spec; it is `.roster-section` now.
- The local e2e run: `EMPYREAN_CONFIG=<tmp>/config.json
  target/debug/empyrean-gate.exe --headless` with `server.port` 9540,
  `public.port` 9541, `output.enabled` false, `update.auto_check` false, one
  key; then `PUBLIC_BASE=http://127.0.0.1:9541 OPERATOR_BASE=http://127.0.0.1:9540
  KEY=<secret> bun scripts/public-floor-test.ts`. Passed 2026-10-11.
- The forwarded-IP logic is only trusted when
  `public.trust_forwarded_headers` is on **and** the TCP peer is loopback or
  a private address — a direct internet connection to a `0.0.0.0` bind can
  not spoof its way under a per-IP cap.

## Progress log

- [x] 2026-10-11 Pulled latest (`0b90d40`, a hardware-model commit; no code).
- [x] 2026-10-11 Read the access model end to end; threat model above.
- [x] Plan committed (`215fa54`).
- [x] Backend landed as `c0c078f` (281 Rust tests green).
- [x] Main-listener hardening (`is_proxied`, redaction by role).
- [x] `PublicConfig` + fixtures.
- [x] `public.rs` registry/limiter/keys + tests.
- [x] `public_server.rs` listener + supervisor.
- [x] Status/roster/admin messages.
- [x] Public UI (`public.html`, `src/public/`).
- [x] Settings panel + Connect QR.
- [x] Tests (unit, Playwright, e2e script): 281 Rust, public-floor spec on
      Chromium + WebKit, two public-page layout cases per viewport, headless
      e2e script green.
- [x] Docs (README + `docs/public-deploy.md`).
- [x] All checks green on the final tree. Open questions below are follow-ups, not blockers.

## Open questions for the user

1. Public preview default is **off** (phones look up at the array). Fine, or
   do you want the 5 fps thumbnail on by default? Recommendation: off; turn it
   on from Settings for a show where people play from outside the venue.
2. Should LAN phones (venue Wi-Fi) be sent to the public UI too, or keep the
   full guest UI? Recommendation: point the venue QR at the public URL once it
   exists — one UI to explain — and keep the LAN guest UI for crew.
3. Easter-egg content: which perks matter first? The mechanism is generic;
   `big_brush` and `strobe` are the planned examples.

## Things not to do

- Never proxy port 9520. Never add a "trust this proxy IP as loopback" knob.
- Never store public sessions in `config.clients`; never `update_config` on a
  public join (disk write + N-way broadcast).
- Never send `State`/`Status` to a public connection.
- Never use a forwarded IP for anything but per-IP caps and the roster.
- Don't build ACME/TLS into the app (decision above).
- Don't touch Cloudflare/Caddy/DNS from this repo; recipes are docs only.
