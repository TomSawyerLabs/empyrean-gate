# Known issues

Short entries that seed a separate fix. Claim one by marking it
`in progress — <thread/branch>` and committing that first.

## `GetState` re-broadcasts the full config to every client

`ClientMsg::GetState` (`src-tauri/src/server.rs`, the `GetState` arm) calls
`state.broadcast_state()`, which serializes and sends the whole `State` to
**every** connected operator-port client, not just the one that asked. A phone
reloading on the LAN costs N full-config sends. Seen while auditing the access
model for `plans/public-floor.md` (2026-10-11); the public listener does not
use it. A per-connection reply (the hello path already builds one) would do.
