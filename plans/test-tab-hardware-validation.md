# Test tab — hardware validation

## Goal

Answer the questions you have while *wiring* the array, none of which a show can
answer:

- Is the colour order right, or is red coming out green?
- Which physical spoke is logical spoke 17? Which controller drives it?
- Is `pixels_per_spoke` actually 378? Where does universe 7 start?
- Are the strings really fed from the outside?
- Which of the 16 PixLite Mk4-S are actually on the network, and are they the
  ones we expect?

## Status

Round 1 (commit `f822d97`) built the tab as a **UI shell**: a local checkbox for
"test mode", a colour picker, a pixel-index slider, and a panel that re-displayed
the configured controller list. It drove the rig through `trigger_effect` bursts
and moved the *master brightness* fader, and its "listener detection" detected
nothing — it printed the config back. Its own "Future Enhancements" list named
what was missing.

Round 2 (this document's current state) replaced that with a real
implementation: patterns are generated on the backend and substituted into the
frame path, and discovery actually speaks the Advatek protocols. The UI keeps the
design system and the class names from round 1.

## How it works

### Patterns — `src-tauri/src/testmode.rs`

A pure CPU frame generator. `render_into(cfg, geometry, output, t, buf)` fills a
full RGB frame; `engine::run_frames` substitutes it for the rendered frame on the
way to **both** sACN and the preview, so the screen shows what the rig should be
showing. The engine keeps rendering underneath (≈2 ms; it keeps the loop, show
clock and readback pipeline undisturbed) and its output is discarded while armed.

Deliberately literal: master brightness, master speed, the show scheduler,
effects and audio are all ignored. LED gamma is *not* bypassed — the frame goes
through the same `SacnSender` gamma LUT the show uses, so a test exercises the
real output path. The UI shows both the requested byte and the post-gamma byte.

| Pattern | What it proves |
|---|---|
| Solid colour | Colour order, dead pixels, current draw |
| Colour cycle | R→G→B→W; the banner names what *should* be lit right now |
| Nth pixel | Pixel count, feed direction, null-pixel offsets; counts from either end |
| Ruler | Every 10th dim white, 50th blue, 100th red — count the strip by eye |
| Universe marks | First pixel of each universe, alternating cyan/magenta |
| Gradient | Bright at the outer feed → dark inner; direction on every spoke at once |
| Spoke ID | Human-facing strip number (1–64) in binary near the outer edge; first and last LEDs green |
| Chase | Travelling band; smooth motion means frames arrive steadily |
| Blackout | Everything off — a rig still lit is holding a last look |

Modifiers on every pattern: brightness, blink rate, and spoke selection
(all / one spoke / one controller's spokes / auto-cycle).

**The Spoke ID and one-spoke patterns are the instrument for the two open
measurements** recorded in `plans/empyrean-gate.md`: whether our spoke index runs
the same rotational direction as the installed patch, and whether spoke 0 is the
patch's first strip. Neither is visible in the universe numbers.

### Discovery — `src-tauri/src/discovery.rs`

sACN is fire-and-forget; nothing acknowledges a frame. Three read-only probes,
~3 s, on the interface configured for sACN output:

1. **Advatek legacy** (Mk1/Mk2, PixCon16) — broadcast `"Advatech" 00 00 01 06`
   to `255.255.255.255:49150`; replies have `data[10] == 0x02` and a struct
   version in `data[11]` (4/5/6/8).
2. **Advatek DiscProt** (Mk3/Mk4 — *this rig*) — a 34-byte request multicast to
   `239.255.251.1:49151`; replies arrive on the separate group
   `239.255.251.2:49151` as `"DiscProt" 21 02 <u16 ver> <JSON>` with `ipAddr`,
   `prodName`, `fwVer`, `nickname`, `macAddr`.
3. **Passive E1.31 source watch** — join `239.255.250.214:5568` and note every
   sACN source that is not us. Two sources on the same universes merge inside the
   controller and the rig does what neither says; this is otherwise invisible.

Results are reconciled against `output.controllers` into found / missing /
unexpected. **A controller's address comes from the reply's source address**, not
from the parsed body, so a wrong struct offset degrades the model/firmware text
rather than losing the controller. When the body disagrees with the source
address, that disagreement is reported — it means a static IP that did not take
or a stale DHCP lease.

Both wire formats were reverse-engineered from the xLights implementation
(`src-core/controllers/Pixlite16.cpp` in `xLightsSequencer/xLights`), which is
the only public description of them.

## Safety

- **Arming is explicit.** Opening the tab does nothing; changing parameters does
  nothing. Test mode is a separate deliberate action.
- **It never touches `output.enabled`,** in either direction. Whether the rig is
  being transmitted to is the operator's standing decision. If output is off the
  tab says so, with a one-click enable.
- **Refused while a scheduled show is running,** naming the playlist and offering
  to stop it. Test mode is open to every device on the LAN — the real workflow is
  a phone in your hand at the array — and a phone must not be able to replace a
  running show with one test pixel.
- **Auto-exit** (default 30 min, selectable, can be Never), enforced in the engine
  loop so it holds with no client connected.
- **Unmissable while armed:** a red `TEST MODE` banner on every tab, on every
  connected device, surviving show mode (which only hides the topbar), with the
  disarm button in it.
- **State lives in `SharedState`, not `AppConfig`** — it cannot survive a restart
  into a show.
- Scanning is read-only and needs no arming; it is safe during a show.

## Windows firewall

Discovery replies arrive from addresses we never sent to directly (broadcast and
multicast), so Windows does not treat them as solicited and drops them. Without a
rule, a scan silently finds nothing on a network full of healthy PixLites. The
elevated Authorize script therefore also adds
`protocol=UDP localport=49150,49151,5568` under the same rule name (`firewall.rs`).

## Files

| File | Role |
|---|---|
| `src-tauri/src/testmode.rs` | Pattern generator, `TestConfig`, `TestState` |
| `src-tauri/src/discovery.rs` | Advatek + E1.31 probes, parsers, reconciliation |
| `src-tauri/src/engine/mod.rs` | Frame substitution, auto-exit, status publishing |
| `src-tauri/src/state.rs` | `set_test_mode` (show gate), `set_test_config` |
| `src-tauri/src/protocol.rs` | `SetTestMode`/`SetTestConfig`/`DiscoverControllers`, `Discovery`, `TestModeStatus` |
| `src-tauri/src/firewall.rs` | Inbound UDP rule for discovery replies |
| `src/Test.tsx` | The tab |
| `src/App.tsx` | Tab entry + the global armed banner |
| `scripts/testmode-test.ts` | E2E against a live backend |
| `scripts/fake-pixlite.ts` | Fake Mk4 responder, for testing discovery without hardware |

## Verification

- `cargo test --lib` — 119 pass. Pattern indexing (both ends, width, chase wrap),
  universe marks, spoke/controller filters, brightness, blink, ruler precedence,
  spoke-ID bit layout, auto-exit; discovery packet builders and parsers, including
  truncated and unknown-version replies. The E1.31 discovery parser is checked
  against a packet built by our own `sacn.rs` builder, so both sides are held to
  one definition of the wire format.
- `bun run test:layout` — 47 pass, Test tab included at all eight viewports.
- `bun scripts/testmode-test.ts` against a live headless backend — asserts on
  **actual rendered pixels** pulled off the preview stream, not on the status the
  backend reports about itself. Covers: disarmed at startup, parameters do not
  arm, Nth pixel from both ends, width direction, one-spoke and per-controller
  selection, universe marks, brightness, the show-scheduler refusal (and arming
  once stopped), auto-exit, and discovery reconciliation.
- sACN wire check on loopback: with 4 spokes × 12 px, 4 px/universe, stride 6,
  "pixel 3 from the outer feed" lands on universes 1/7/13/19, channels 10–12 =
  255,255,255, every other slot dark. Engine → sender → UDP confirmed.
- `bun scripts/fake-pixlite.ts` gives a DiscProt responder; a scan finds it,
  parses model/firmware/nickname/MAC, and reconciles it as expected once its
  address is in the controller list.

## Not yet done

- **Real PixLite Mk4-S validation.** Everything above is verified against the
  protocol, a fake responder, and loopback sACN — not against the actual boxes.
  The legacy (Mk1/Mk2) discovery path in particular is covered only by parser
  unit tests; the fake speaks DiscProt only, because a legacy fake would have to
  share UDP 49150 with the scanner and delivery is ambiguous on Windows.
- Struct offsets for legacy v5/v6/v8 stop after the firmware string; nickname and
  per-output configuration are not parsed. Mk3+ carries all of that in JSON.
