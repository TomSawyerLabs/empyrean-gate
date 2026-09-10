# Live tab on a phone, and noticing a competing sACN source

## Goal

Five related asks from Cameron (2026-08-24), all about the Live tab as it behaves on
a hand-held device plus one new backend capability:

1. **No selection anywhere on Live.** A finger on the show surface must never start a
   text selection or a long-press callout.
2. **On mobile, the tabs collapse into a corner menu.** The tab row costs two rows of
   chrome on a phone, and the topbar actions that get culled at that width
   (Show mode, Connect, New window, connection state, version) have *no way to be
   reached at all*.
3. **Tapping/dragging in the ring must not scroll — the rest of the page must.**
   Today it is exactly backwards: `.live-page { touch-action: none }` means a phone
   cannot scroll the Live tab *at all*, which is why the controls below the array are
   unreachable.
4. **The big red "sACN LIVE" pill is out of place.** Red is this app's error colour;
   "the output is working" is not an error.
5. **Detect and show another sACN source transmitting at the same time**, including
   whether its priority is higher than (or equal to) ours.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\Empyrean`, branch `master`, v0.7.1.
- Frontend: React 19 + Vite. `src/App.tsx` (chrome/topbar), `src/Live.tsx`,
  `src/styles.css` (~4.4k lines, one file).
- Backend: Rust/Tauri under `src-tauri/src`. `sacn.rs` is the sender,
  `discovery.rs` holds the one-shot controller scan, `protocol.rs::RuntimeStatus`
  is the status blob pushed to every client, `state.rs` owns it behind a mutex.
- Checks: `bun run typecheck`, `bun run test:layout` (Playwright layout gate,
  viewport matrix incl. 390x844), `bun run test:behavior`, `cargo test` in
  `src-tauri`, `cargo clippy`.
- `tests/fixtures/default-status.json` is a committed snapshot of
  `RuntimeStatus::default()`, kept honest by the Rust test
  `default_status_fixture_is_current`. Any new status field must be added there.

## Decisions already made (don't re-ask)

1. The corner menu carries **both** the tabs and the topbar actions that ≤700px
   currently hides outright (Show mode, Connect, New window, connection state,
   version/update chip). "Cut off with no way to access them" covers both, and a
   menu that only holds tabs would leave the second half broken.
2. Report stays out of the menu, as its own icon button. It is the one control whose
   value collapses if it takes an extra tap — the capture window is seconds wide.
   (Same reasoning as the existing `.report-btn` exemption.)
3. The contention watcher is **always on**, not scan-triggered. A competing source
   that appears mid-show is precisely the case that matters, and the existing
   `Test → Scan` is a deliberate one-shot.
4. The watcher only sees **multicast** traffic on the universes we transmit. A rival
   that unicasts straight at the controllers is invisible to any passive listener on
   a switched network; the UI says so rather than implying a clean bill of health.

## Design

### Selection (1)

`.app` already sets `user-select: none`, but the opt-back-in rule right under it is
`input, textarea, code, .join-url { user-select: text }` — and `input` matches every
`<input type="range">` on Live. Narrow that to text-entry inputs. Add an explicit
belt-and-braces block on `.live-page`.

### Corner menu (2)

`App.tsx` grows a `navOpen` state, a `☰` toggle button that also shows the current
tab's name, and a `.topbar-menu` panel holding the nav plus the culled actions. The
toggle and the panel are `display: none` above 700px, so nothing changes on a desk.
Closes on: choosing anything, Escape, a click on the backdrop.

The panel must be *removed from the DOM* when closed rather than parked off-screen —
`tests/layout.spec.ts` treats out-of-viewport geometry as a failure.

### Touch (3)

Move `touch-action: none` off `.live-page` and onto `.live-canvas-wrap` (which owns
the array and the corner cards). `.live-page` gets `pan-y`. In the wide and squarish
modes nothing scrolls anyway, so the only behaviour that changes is the one that was
broken: a phone can now scroll to its controls, and a drag that starts on the ring
still draws instead of panning.

### The live pill (4)

Becomes an outlined chip in the teal accent with a small dot, not a filled red slab —
and it doubles as the contention indicator, going amber/red with a count when another
source is heard. Red is then meaningful again.

### sACN contention (5)

New `src-tauri/src/sacnwatch.rs`, one thread:

- Binds UDP 5568 with `SO_REUSEADDR` (must not fight sACNView or our own sender),
  joins the multicast group of every universe in the current output plan, plus the
  E1.31 discovery group.
- Parses E1.31 **data** packets (root vector `0x0004`, framing vector `0x0002`):
  CID @22, source name @44, priority @108, sequence @111, options @112, universe
  @113. Our own CID is skipped — multicast loopback means we hear ourselves.
- Also parses **universe-discovery** packets, so a source that advertises but does
  not overlap us is still named.
- Keeps a per-CID record: name, source IP, universes overlapping ours, highest
  priority seen, packets in the last second. Entries expire after 5 s of silence
  (E1.31's own source-loss timeout is 2.5 s; double it so a slow source does not
  flicker in and out of the UI).
- Re-joins when the output config epoch changes.

`RuntimeStatus` gains `sacn_peers: Vec<SacnPeer>` and `sacn_priority: u8` (ours, so
the UI can compare without reading config). Each peer carries `wins: bool` —
priority strictly greater than ours — and `ties: bool`, because an equal priority is
the genuinely dangerous case: E1.31 receivers merge equal-priority sources HTP and
the rig does what neither source asked for.

Surfaced in three places: an app-level banner (like the test-mode one, visible on
every tab and in show mode), the ring chip, and the Test tab's Discovery panel.

## Plan / steps

1. [x] CSS: selection, touch-action, live pill.
2. [x] `App.tsx` + CSS: corner menu.
3. [x] Rust: `sacnwatch.rs`, status fields, wiring in `lib.rs`.
4. [x] Frontend: types, banner, ring chip, Test panel.
5. [x] Fixtures, typecheck, cargo test, layout gate, behaviour tests.
6. [x] README + screenshots.
7. [x] Commit.

## Findings / gotchas

- `.live-page { touch-action: none }` was added deliberately ("a stray contact landing
  on the padding beside a pen button used to start a scroll and cancel the stroke that
  a second finger was drawing"). It is right for the wide/squarish modes and fatal on
  a phone. The narrower `.live-canvas-wrap` placement keeps the original benefit:
  the padding it was protecting is inside the wrap.
- `.live-side` already carried `touch-action: pan-y` to work around the same bug in
  the columns — with `.live-page` set to `none`, an ancestor veto meant that never
  actually worked on a scrolling page. It does now.
- The E1.31 *universe discovery* packet carries no priority; only data packets do.
  So the existing `discovery.rs` scan could never have answered "at what priority" —
  it needs the data-packet path this adds.
- **Selection was already off — except on the sliders.** `.app { user-select: none }`
  has been there since `4a80a9a`, but the opt-back-in right under it was a bare
  `input, textarea, code`, and `input` matches `type="range"`. Every slider on the
  play surface was selectable text as far as the engine was concerned.
- **`toHaveCSS("user-select", …)` fails on WebKit**: it computes to `""` there,
  because WebKit still only exposes the prefixed property. `tests/mobile-nav.spec.ts`
  reads both and asserts on whichever the engine answers with.
- `.topbar > .ghost { display: none }` at the narrow breakpoint is *two* classes, so
  a plain `.topbar-menu-toggle { display: inline-flex }` loses to it on specificity
  no matter where it sits in the file. The rule is written `.topbar > .ghost.topbar-menu-toggle`.
- The layout gate runs `fullyParallel` against **one** mock backend, so a global
  status mutation leaks into whatever else is mid-load. `POST /mock/status` is keyed
  by the client id from the `hello` message, and the test sets that id with
  `addInitScript` before navigating.
- The corner-menu backdrop covers the topbar (z-index 70 vs 20), so the button that
  opened the menu cannot close it. The panel carries its own `×`.

## Things not to do

- Don't let the menu panel live off-screen when closed; the layout gate fails on it.
- Don't make the watcher's socket exclusive — sACNView on the same machine is a
  normal thing for an operator to be running.
- Don't report our own CID as a competing source (multicast loopback).
