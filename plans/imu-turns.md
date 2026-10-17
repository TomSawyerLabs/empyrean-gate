# Phone motion: one phone at a time, in turns

## Goal

The Phone IMU node reads one global control bus. Until now every phone's
motion message overwrote yaw/pitch/roll and added its shake, so two phones
flickered. Cameron (2026-10-17): "one phone gets control at a time. If other
phones are in queue, the controller gets a time limit. Limit goes down as the
queue is longer. Minimum like 20 s? Average wait should target 1~2 minutes?
Can we buzz the phone as they get control?"

## Decisions (defaults, all constants in `state.rs`)

- A phone is **in line** while it sends motion (Settings → "Send motion /
  orientation", 30 Hz). It joins on its first message and drops out after
  `IDLE` = 3 s without one, or on disconnect. The front of the line holds the
  controls; only the holder's messages reach `ControlInputs`.
- **Turn limit** only while someone waits: `clamp(TARGET_WAIT / waiting,
  MIN_TURN, MAX_TURN)` with `TARGET_WAIT` 90 s, `MIN_TURN` 20 s, `MAX_TURN`
  120 s. One waiter: 90 s turns; two: 45; three: 30; five or more: 20. A new
  joiner therefore waits about 90 s on average until the floor kicks in.
  Nobody waiting: no limit.
- When the limit passes, the holder goes to the **back of the line** (it is
  still sending) and the next phone takes over; `turn_started` resets.
- Arbitration is **lazy**: evaluated on every motion message and on
  disconnect. Phones send 30 Hz, so this is effectively continuous; an empty
  room with a stale holder resolves on the next message or disconnect.
- **Status carries it**: `RuntimeStatus.imu_turns = { holder, waiting,
  seconds_left }` (client ids), re-broadcast when the holder or the line
  changes. Each client compares `holder` with its own client id. No
  per-connection messages, so the roster and any UI can show it too.
- **Buzz**: Settings shows "You have the gate's motion (~N s)" and calls
  `navigator.vibrate([80, 40, 80])` on the rising edge of becoming holder;
  waiting phones see "In line: 2nd of 3 · about N s". iPhones ignore
  `vibrate` (Safari has no API for it); the banner still shows.

## Not in this round

- The Phone IMU node could expose `count` (phones in line) and a `turn`
  event; needs `EvalInputs` fields and Agent B's files. Later, if wanted.
- Public floor visitors cannot send motion (`public.rs` refuses `Imu`);
  this is crew phones running the app.

## Progress

- [x] `protocol.rs`: `ImuTurnInfo`, `RuntimeStatus.imu_turns` (fixture
      `tests/fixtures/default-status.json` regenerated)
- [x] `state.rs`: `ImuTurns` arbiter + 4 unit tests, `imu_input`, `imu_left`
- [x] `server.rs`: route `Imu` through the arbiter; release on disconnect
- [x] `src/types.ts`, `Settings.tsx` banner + vibrate, mock status default
- [x] `tests/imu-turns.spec.ts` (mock status override), `test:behavior`;
      backend tests 340/340, web build + specs green
- [ ] Try it with two real phones on the gate (needs the next app release)
