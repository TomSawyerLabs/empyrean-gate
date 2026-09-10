# Network follower instances & backup transmitter

## Goal

Enable a second instance of Empyrean Gate to run on the network and become a "follower" that:
1. Synchronizes layer/patch state from the primary (leader) instance
2. Optionally acts as a backup transmitter that sends sACN if the leader fails
3. Both ends opt-in; follower discovers/connects to leader via QR or direct address
4. No shared database or external coordinator — leader just broadcasts state

Re-requested by Cameron 2026-09-06: "start a second instance of the app on the
network and it becomes a 'follower'? maybe even an automatic backup transmitter
(opt-in both ends)?" — which settles the old open question #1: failover is
**automatic**, with loud visual state on both ends.

## Environment

- Tauri Rust backend + WebSocket protocol (both already in place for remote clients)
- Backend serves HTTP+WS on port 9520; every UI is a WS client
- Current architecture: all clients are stateless consumers; no peer-to-peer between instances
- Key files: `server.rs` (HTTP/WS), `state.rs` (shared state), `protocol.rs`
  (messages), `sacn.rs` (sender), `sacnwatch.rs` (rival listener), `lib.rs`
  (startup/takeover), `engine/mod.rs` (send gate), `config.rs`

## Decisions already made

- **Use existing WebSocket protocol:** extend it with peer messages; no second transport.
- **No external coordinator:** leader pushes state; follower subscribes.
- **Opt-in from both ends:** leader must enable "Allow a backup"; follower must
  explicitly follow a leader address AND separately enable "Act as backup".
- **Backup transmitter is a separate concern** from follower sync, gated separately.
- **Follower is read-only** (old question #2): it mirrors, it does not push
  state back to the leader. Its own local UI stays usable for looking, not driving.
- **Same-CID failover, strict mutual exclusion** (supersedes old question #3's
  merge/separate-universe idea): the backup adopts the leader's persistent CID
  and, on takeover, continues the sequence numbering via the existing
  `resume_after` machinery — receivers see the *same source* carry on, no
  2.5 s source-loss hold, no second entry in receiver merge tables, no
  source-cap risk on the controllers. The whole existing local-takeover design
  (persistent CID + `HANDOVER_SEQUENCE_MARGIN = 32`) is built for exactly this.
- **Peer settings are persisted config** (deviation from the old "runtime-only
  role" note, deliberately): an automatic backup that forgets it is a backup
  after a venue power cycle is not a backup. `PeerConfig` is a normal persisted
  section.

## Design

### Roles & config

New `AppConfig.peer: PeerConfig` (serde defaults, like every section):

- `follow: String` — leader address (`host[:port]`), empty = not a follower.
- `allow_backup: bool` — leader side: accept a backup peer and stream handover
  state to it. Default false.
- `act_as_backup: bool` — follower side: arm as backup transmitter. Default
  false. Transmission requires `allow_backup && act_as_backup`.
- `watchdog_ms: u32` — heartbeat-loss window before takeover (default 2000,
  clamp ≥ 1000 in validate()).

### Connection (follower → leader)

`src-tauri/src/peer.rs`, tokio task spawned from `start_backend` when
`peer.follow` is non-empty. Dials `ws://<follow>/ws`, sends the normal `hello`
(stable id derived from own CID: `peer-<cid>`, name "Backup (<hostname>)",
token = leader join token pasted/QR'd into settings), then a new
`ClientMsg::PeerFollow { version, backup: bool }` role upgrade. Reconnects
forever with backoff. Per the old plan's "things not to do": the peer role is
an explicit upgrade message + config gate on the leader — a browser can never
become one accidentally; peer connections are tracked separately in
`SharedState`, don't hold preview slots, and use one stable ClientRecord.

### Sync while following

- **Config**: the existing `ServerMsg::State` broadcast already carries full
  config on every change — the follower adopts it **selectively**: show state
  (geometry, layers, stacks, patches, playlists, output universe layout +
  CID + priority + gamma + source name…) is adopted; local machine facts are
  kept: `output.interface`, `server.*` (own port/tokens; leader's admin_token
  is redacted for remote clients anyway), `peer.*`, `windows`, `autostart`,
  `update`, and local `audio` device selections (leader's device names don't
  exist here; non-reactive rendering while following is acceptable, feed the
  backup audio if it matters).
- **Pulse**: new `ServerMsg::PeerPulse { seq, sacn_sequence, layer_phases,
  transmitting }` sent only to peer connections at ~4 Hz — liveness + the
  handover-critical runtime state. Engine-side cost: none (values already
  published to SharedState atomics / mutex each frame).
- Follower renders continuously (GPU warm — same reason the local takeover
  warms before committing), `sacn_hold = true` the whole time it follows.
- Follower → leader `ClientMsg::PeerStatus { armed, transmitting, version }`
  so the leader UI can show backup health.

### Failover state machine

Follower: Connecting → Following → Armed (both opt-ins + state adopted) →
Takeover-pending (pulses stale > watchdog AND WS dead) → **wire-liveness
check** → Transmitting → (leader returns) Reclaim → Following.

- **Wire-liveness check** (split-brain guard): before transmitting, and
  continuously afterwards, consult sacnwatch: if data packets with **our own
  (shared) CID from a non-local IP** are on the wire, the leader is alive —
  a partitioned-but-alive leader must NOT be preempted, and a transmitting
  backup that starts hearing the leader again stops silently and immediately.
  sacnwatch currently drops own-CID packets before recording
  (`sacnwatch.rs:326,:350`); extend it to timestamp own-CID sightings from
  non-local IPs into SharedState instead of discarding them. Honest limit
  (same as the existing watcher's): multicast only — a unicast-only rig gets
  no wire signal, so the watchdog is the only trigger there; document in UI.
- **Takeover**: `sacn_resume_sequence = last pulse's sacn_sequence`,
  `sacn_resume_pending = true`, `sacn_hold = false`. The engine already does
  the rest (`engine/mod.rs:3276-3296`), including `output_env = 1.0` (no
  fade-up dip) and deferring `resume_after` past any `configure`. Staleness
  math: pulses at 4 Hz → baseline ≤ ~15 frames behind at 60 fps when the
  leader dies; margin 32 covers it (dangerous direction is a stale-LOW
  baseline; forward jumps are always legal).
- A crashed leader terminates nothing (it's dead) — benign: receivers hold
  last look briefly and the backup slides in under the same CID.

### Reclaim (leader returns)

The backup keeps dialing the leader's address while transmitting. When the
leader comes back up, the backup reconnects and reports `transmitting: true`;
the leader then runs the network mirror of the two-phase local takeover over
that WS connection: request state → adopt config/phases, warm, `wait_frames` →
commit → backup quiesces (skip terminate via a new `sacn_silent_stop` flag —
`state.leaving` is unsuitable: it is never cleared and implies process exit),
hands back the authoritative sequence, returns to Following/Armed; leader
resumes with `resume_after`. Deliberate, logged, bannered on both ends.

Leader startup guard: when `peer.allow_backup` is set, the leader holds sACN
briefly at startup — until wire-check says our CID is not being transmitted by
someone else (multicast), or a short grace window for a backup to connect and
be reclaimed (unicast), whichever resolves first. Engine warmup takes ~1-2 s
anyway, so the practical cost is small. If backup is unreachable AND the wire
is silent, proceed — after a venue-wide power cut, someone must.

### Status & UI

- `RuntimeStatus.peer: PeerStatus` — role, connected, armed,
  transmitting_as_backup, leader/backup last-seen ms, split_brain, backup
  name/version, watchdog remaining.
- Settings: new "Redundancy" panel (leader toggle; follower address + token +
  backup toggle; live role/status line).
- App-wide banners (App.tsx, beside TEST MODE): follower "Following <addr>"
  (info), "BACKUP TRANSMITTING — leader lost" (error-grade, on every tab +
  show mode), split-brain warning (error), leader-side "backup lost" (warn).
- Leader ClientsPanel shows the peer as a peer, not an iPad.

## Plan / steps

- [x] 1. Explore takeover, sACN, config/protocol/UI (3 agents, 2026-09-06 — findings below)
- [x] 2. Protocol + config: `PeerConfig` + `adopt_show_config` (config.rs),
      `ClientMsg::{PeerFollow, PeerStatus, PeerGrant}`,
      `ServerMsg::{PeerWelcome, PeerPulse, PeerReclaim}`,
      `HandoverGrant.backup_transmitting`, `PeerStatusInfo` in RuntimeStatus,
      TS mirrors in `src/types.ts`
- [x] 3. State + engine: `peer_hold` (separate from `sacn_hold` — the port-bind
      recovery clears that one), `sacn_silent_stop` + `SacnSender::
      mark_stream_yielded` (a yielded stream must not be terminated by our own
      later shutdown), `own_cid_heard_*` + `note_own_cid_heard` /
      `own_cid_heard_within`, `peer_transmitting`, `peer_backup_conn` slot;
      sacnwatch records own-CID sightings from non-local IPs (local addr set
      via local_ip_address)
- [x] 4. Leader side (server.rs): `handle_peer_msg` (PeerFollow gated on
      allow_backup + single slot; PeerStatus triggers reclaim when we hold and
      the backup transmits; PeerGrant two-phase adoption with async
      wait-frames), 4 Hz pulse arm in client_task's select, disconnect frees
      the slot + warns; lib.rs control-port-gate grew phase 2 (wire-silence /
      grace window before a leader that allows a backup transmits)
- [x] 5. Follower side (new src-tauri/src/peer.rs, own thread +
      current_thread runtime, tokio-tungstenite — already in the graph via
      axum): dial/redial, hello + peer_follow upgrade, selective config
      adoption (JSON-compare to skip no-op writes), active-patch mirroring via
      patch_get, phase adoption from pulses, watchdog takeover
      (`should_take_over` kept pure for tests), split-brain retreat, reclaim
      responder (quiesce = silent_stop + peer_hold + 2 rendered frames, then
      the grant), denied backoff, live settings changes reconnect
- [x] 6. UI: RedundancyPanel in Settings; App.tsx banners (BACKUP
      TRANSMITTING error, split-brain error, FOLLOWING info, backup-lost
      warn); peer-banner CSS
- [x] 7. Fixtures regenerated (EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture);
      mock-backend reads them directly, no changes needed
- [x] 8. Tests: 246 pass — peer config parse/validate, adopt_show_config
      keeps-local-facts contract, wire-shape parse of follower JSON, old-grant
      defaults, should_take_over conditions, hello-safe peer ids; cargo fmt;
      bun typecheck clean
- [x] 9. Layout gate (80 passed) + behavior gates (70 passed, chromium +
      webkit) on the combined tree; committed as 964bb5d (feature) and
      5e506ca (Live controls UI, same session's parallel work). Remaining
      validation is the two-instance shakedown below.

## Findings / gotchas (exploration 2026-09-06)

### Same-machine takeover (prior art)

- Endpoints `GET /handover/state` (`server.rs:621`), `POST /handover`
  (`server.rs:653`); auth `handover_authorized()` (`server.rs:641`) =
  **loopback-only** + `X-Empyrean-Handover: <join_token>`. Loopback gate means
  the existing HTTP handover is unusable cross-machine as-is; the network
  reclaim runs over the authenticated peer WS instead.
- `HandoverGrant` (`protocol.rs:448`): `config`, `layer_phases: Vec<f64>`,
  `sacn_sequence: Option<u8>` (None = "not reported", old binary).
- Successor dance (`lib.rs:96-233`): probe port → `/version` guard →
  `sacn_hold=true` → spawn engine → `wait_for_engine` (8 s) → phase 1 GET +
  adopt in memory + `wait_frames(3)` → phase 2 POST commit (only the commit's
  sequence is authoritative — read after quiesce ack) → `sacn_hold=false`.
  Fallback: `control-port-gate` thread clears hold once `server_bound`.
- Quiesce: commit sets `state.leaving`, engine acks `sacn_quiesced` ≤150 ms,
  sequence read after ack. Engine skips `send_terminate()` when `leaving`.
- Engine send gate (`engine/mod.rs:3234`): `sending = cfg.output.enabled &&
  !sacn_hold && !leaving`. `sacn_hold` is the follower-suppression lever.
- Predecessor exits via plain OS thread (tokio task would be cancelled by its
  own shutdown): 400 ms → shutdown → 300 ms → exit.
- Engine tolerates layer_phases length mismatches (truncate/zero-fill).
- Phases adopted via `state.layer_phases` + `phases_transplanted` swap
  (`engine/mod.rs:1848`).

### sACN sender

- Per-universe `UniversePlan.sequence`; `sequence()` = max; `resume_after(n)`
  sets all to `n + 32` (`HANDOVER_SEQUENCE_MARGIN`, receivers discard delta in
  [-20,0]; exhaustively tested `sacn.rs:801`).
- `configure()` with a changed CID terminates the old stream **only when
  `streaming`** — a holding follower never streams, so adopting the leader's
  CID while following is free and pre-positions the plan for takeover.
- `send_terminate()` fires on output-off edge + shutdown, suppressed only by
  `leaving` → hence the new `sacn_silent_stop` for the reclaim hand-back.
- Multicast TTL = 1 (`sacn.rs:116`): cross-subnet backup needs unicast mode.
- Discovery advertisements only emit while frames flow — a holding backup is
  silent on the wire (good).
- Priority is irrelevant between the pair (same CID = same source).

### sacnwatch

- Filters own CID (`sacnwatch.rs:326,:350`) — leader/backup mutually invisible
  today; that filter is where the own-CID-sighting timestamp hooks in.
- `PEER_TIMEOUT = 5 s`, publishes `SacnPeer` list into RuntimeStatus at 2 Hz.
- Unicast rivals invisible to any passive listener (stated module limit).

### Config / protocol / UI conventions

- Config: section structs, `#[serde(default)]`, hand-written `Default`,
  `AppConfig::validate()` (`config.rs:887`), crash-safe save. First-run
  identity minting at `config.rs:1091-1103` (join/admin tokens, CID).
  `EMPYREAN_CONFIG` / `EMPYREAN_PORT` env overrides make two-instance testing
  on one machine easy (`ws.ts` dev probe already scans 9520-9529).
- `set_config` handler (`server.rs:1630`) deliberately preserves
  dedicated-message fields (`clients`, tokens, `active_patch`,
  `windows.launch_at_startup`) — **add `peer` to that preserve list** so a
  stale full-config write from a UI can't clobber the peer role; drive
  PeerConfig via a dedicated message.
- Envelopes: `ClientMsg`/`ServerMsg`, serde `tag = "type"`, snake_case.
  Hello-first enforced (`server.rs:807`); `ServerMsg::State` then `Role` on
  join; broadcast via `SharedState.events`, redacted for non-loopback
  (admin_token blanked — a follower must not adopt `server.*` wholesale).
- RuntimeStatus published every 500 ms from the engine loop
  (`engine/mod.rs:3382`); nested status structs derive Default; TS mirrors in
  `src/types.ts` (~:516).
- Hello gate (`server.rs:1455-1527`): id `[A-Za-z0-9._-]{1,128}`,
  `require_token` for non-local unknowns, `MAX_CLIENT_RECORDS = 256` — stable
  peer id avoids record pollution.
- Settings sections: one component per panel in `src/Settings.tsx`, listed at
  :38-49; banners in `src/App.tsx:819-920` (TEST MODE at :830 is the
  template); client state via `useGate()` (`src/state.tsx`).
- Fixtures to update with any config/status shape change:
  `tests/fixtures/default-config.json`, `tests/fixtures/default-status.json`,
  `scripts/mock-backend.ts`.

## Progress log

- [x] Exploration + design locked (2026-09-06)
- [x] Protocol extension
- [x] State/engine/sacnwatch hooks
- [x] Leader side
- [x] Follower side (peer.rs)
- [x] UI (Settings panel + banners)
- [x] Fixtures + tests (246 Rust tests green, tsc clean)
- [x] README
- [x] Layout/behavior gates + commit — landed as 7731d9b (rebased onto
      master 2026-09-09).

## Follow-ups (not in this change)

- Failover latency is watchdog + up to one dial cycle (the takeover decision
  is evaluated between redials, and a dead host costs the full 4 s connect
  timeout): ~3–7 s with the 2 s default watchdog. Receivers hold the last
  look meanwhile, so the rig freezes briefly rather than blacking out. If
  that matters, evaluate the watchdog inside the dial wait too.
- A hung-but-alive leader (engine thread dead, server thread still pulsing
  `transmitting: true`) is not detected — same blind spot as the local
  takeover. Pulse could carry `frames_rendered` to close it.

- Two-instance end-to-end exercise on real hardware/dev machines
  (`EMPYREAN_PORT`/`EMPYREAN_CONFIG` make a same-machine pair easy; see
  Manual test recipe below).
- QR-based join for the follower (paste-the-token works today).
- mDNS auto-discovery of the leader (manual address is fine for one venue).
- `scripts/e2e-test.ts` coverage of the peer handshake (needs a second
  backend in the harness).

## Manual test recipe (same machine)

```powershell
# Leader on 9520 with its own config; enable "Allow a backup" in Settings.
.\empyrean-gate.exe --headless

# Follower on 9521 with a scratch config:
$env:EMPYREAN_CONFIG = "$env:TEMP\gate-follower.json"; $env:EMPYREAN_PORT = "9521"
.\empyrean-gate.exe --headless
# In the follower UI (localhost:9521): Settings → Redundancy → follow
# 127.0.0.1:9520 + the leader's join token; tick "act as backup".
# Kill the leader process → follower banners BACKUP TRANSMITTING and output
# continues; restart the leader → it reclaims and the follower stands by.
```

## Open questions for the user

1. ~~Auto vs manual failover~~ — resolved: automatic (Cameron's 2026-09-06 ask).
2. Follower editing — staying read-only for now, per earlier recommendation.
3. ~~sACN addressing~~ — resolved: same CID, strict mutual exclusion (see
   Decisions).
4. Discovery is manual address entry first (one venue, known machine); mDNS
   can come later if wanted.

## Things not to do

- Don't add follower role to the main client connection handler implicitly —
  the role is an explicit `PeerFollow` upgrade gated by leader config.
- Don't block the frame loop waiting for follower acks — fire-and-forget
  broadcast; pulses read already-published atomics.
- Don't let leader and backup transmit simultaneously with the shared CID
  outside a deliberate, bounded handover window; wire-liveness check before
  and during backup transmission.
- Don't auto-failback — the returning leader reclaims via the deliberate
  two-phase exchange; a flapping leader must not ping-pong output.
- Don't adopt the leader's `server.*`, `peer.*`, `output.interface`, or local
  device selections on the follower.
- Don't reuse `state.leaving` for the reclaim hand-back (it is one-way and
  implies exit); use the dedicated `sacn_silent_stop`.
