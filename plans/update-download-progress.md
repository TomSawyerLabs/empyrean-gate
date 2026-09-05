# Update download: progress bar + resume

## Goal

The self-update download (~40 MB) is currently invisible ("downloading…" is all
the operator sees) and restarts from zero whenever venue internet drops mid-way.
Add live progress to the status stream and the UI, and make interrupted
downloads resume from the partial file instead of starting over.

## Environment / context

- Updater lives in `src-tauri/src/updater.rs`; downloads to a versioned sibling
  (`empyrean-gate-v<version>.exe`) via a `.download` temp file, verifies SHA-256
  from the GitHub release asset digest, then renames.
- Status struct is `RuntimeStatus` in `src-tauri/src/protocol.rs`, mirrored in
  `src/types.ts`, broadcast at ~2 Hz by the engine loop — writing fields into
  `state.status` is enough; no explicit broadcast needed for a progress bar.
- `tests/fixtures/default-status.json` is a committed snapshot of
  `RuntimeStatus::default()`; regenerate with
  `EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture` (guarded by a cargo test).
- HTTP client is ureq 3.4 (`resp.status()` is an `http::StatusCode`).
- Local Rust toolchain works (`cargo check` / `cargo test` in `src-tauri`).
- Repo uses `.agent-commit-coordination` — append an entry before commit/push.

## Decisions made

- Total size comes from the GitHub release asset `size` field (already in the
  `/releases/latest` response we parse), not from Content-Length.
- Resume = HTTP `Range: bytes=<len>-` against the existing `.download` partial,
  appending on a 206. A 200 (server ignored the range, e.g. header dropped
  across the CDN redirect) falls back to truncate-and-restart, so correctness
  never depends on the server honoring ranges.
- Final SHA-256 is computed by re-hashing the finished file from disk (instead
  of hashing the stream), which is what makes append-resume simple.
- On digest mismatch the partial is deleted so it can't poison every later
  attempt; on transient errors it is kept (that's the resume source).
- `stage()` retries the transfer up to 3 times internally, so a mid-download
  drop auto-resumes without the operator having to click again.
- Progress fields are `update_download_bytes` / `update_download_total` (u64,
  0/0 when idle). UI derives percent; `update_state` note stays "downloading…".

## Steps

- [x] `protocol.rs`: add the two fields to `RuntimeStatus`.
- [x] `updater.rs`: `Release` struct (version/url/sha256/size), resume +
      progress in `stage`/`download`, retry loop, shutdown abort.
- [x] `types.ts` + regenerate `default-status.json` fixture
      (`EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture`).
- [x] UI: progress bar + MB counter in Settings UpdatesPanel; percent on the
      topbar VersionChip and the show-mode update button (with a thin bar).
- [x] `styles.css`: `.update-progress*` and `.show-update-bar` rules.
- [x] Playwright: extend `tests/show-mode-updates.spec.ts` with a downloading
      state (mock `POST /mock/status` merges arbitrary status fields).
- [x] Run: cargo test 237 passed; tsc clean; layout 80 passed; behavior 70
      passed (chromium + webkit). README self-update section updated.

## Findings / gotchas

- The pre-stage path (auto-check with auto-install off) also downloads — it now
  sets "downloading…" first so every surface can show the bar, not just the
  explicit-install path.
- `.download` partials are versioned (`empyrean-gate-v0.11.0.download`), so a
  partial can never be resumed into a different version's file.
- ureq errors on non-2xx by default; 206 is 2xx so resume responses pass. A 416
  can't happen in practice because resume is only attempted when
  `existing < asset size`.
- Behavior specs run against the PREBUILT bundle in `dist/` — a new UI test
  fails mysteriously until `bun run build` (this bit me; the failure yaml showed
  the old button text).
- The PowerShell tool's working directory persists across calls — a `cd
  src-tauri` left Playwright finding "no tests" on the next call.

## Status

Done — all checks green, committed on master.
