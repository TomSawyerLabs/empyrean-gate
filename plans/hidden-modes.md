# Hidden modes — key-holder-only games and tools on the public floor

## Goal

"Hidden" modes: things the public floor offers only to a group holding a secret
key (plans/public-floor.md built the keys and perks). The first one is for the
**Gate, Perimeter & Exodus** (GPE) department:

1. **Perimeter**, a hidden game. Black Rock City is the rainbow party inside an
   orange pentagon (the trash fence) around the middle of the array; outside it
   is dark playa. Headlamps dash in from the rim trying to hop the fence; each
   player drives a perimeter truck (their color) and runs them down. A mini
   Gate Road carries ticketed traffic in through one corner of the fence, and
   an airport sits on the next edge with the occasional plane landing. Any
   number of players: the more drivers, the more sneakers; the rate backs off
   a little as more of them make it through. Only key holders see the option
   to start it; the operator sees it in a Hidden section of the Games tab.
2. **A traffic cone** shape pad for the same key holders while their game is
   not running — stamps an orange cone with white bands where they tap.

Cameron (2026-10-11): "only if these people are here, do they get an option to
activate this special game. If the special game is not active, maybe they also
get a special icon they can draw with? An orange traffic cone would be great."

## Environment / context

- Repo `~/git/Personal Projects/Empyrean`, branch `master`, started at
  `ba267a8` (public floor landed in `c0c078f` + `41d0065`). Origin
  `TomSawyerLabs/empyrean-gate`.
- Games: `src-tauri/src/game/` (enum dispatch in `mod.rs`, particle sims
  `flak.rs`/`spokewar.rs` are the templates), engine loop at
  `engine/mod.rs` ≈2650–2760 (inputs → cells, fixed cadence for particle sims),
  status at ≈3620. Catalog + copy: `src/gameCatalog.ts`; operator tab
  `src/Games.tsx`; public page `src/public/PublicApp.tsx`.
- Public floor rules: `src-tauri/src/public.rs` (`gate`, `capabilities`,
  `clamp_effect`), listener `public_server.rs` (`handle`, `snapshot`,
  `supervise` 1 Hz loop). Perks are strings on `UnlockKey.perks`.
- Shapes: `EffectKind` in `layers.rs` (append-only GPU ids), SDF stamps in
  `engine/shaders/gate.wgsl` ≈1011–1320 and a copy in `patch_lib.wgsl`
  ≈500–580 (guard test `patch_transient_abi_keeps_full_color_records`).
  UI: `src/effects.ts` (`SHAPES`), `ShapeIcon.tsx`, pads in `Live.tsx`,
  `Control.tsx`, `PublicApp.tsx`.
- Checks: `bun run typecheck`, `bun run test:unit`, `bun run test:layout`,
  `bun run test:behavior`, `cargo test --lib` in `src-tauri/`. Status fixture
  regenerates with `EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture` when
  `GameModeStatus` changes.
- Grid: 64 θ × 48 rings; ring 0 at the hole (rn 0.32), ring 47 at the rim.
  Angular cells are ~5× coarser than radial ones; radial motion reads well.

## Decisions already made (don't re-ask)

- **Perks, not a new config section.** A hidden game is unlocked by the perk
  string `game:<kind>` (`game:perimeter`); the cone by `cone`. Both are
  checkboxes in Settings → Public floor → Secret keys. One key can carry both.
  Reason: "adding an easter egg = adding a string" is the model the public
  floor was built on.
- **Key holders start and stop their game from the public page** via the
  existing `set_game_mode` message, admitted on the public listener only for
  `Some(kind)` when the session holds `game:<kind>`, and for `None` when the
  running game was floor-started and the session holds its perk. The operator
  can always stop it from the Games tab. `set_game_config` stays refused.
- **A `game:<kind>` perk implies the `games` capability** for its holder, so
  the group can play on a floor whose games toggle is off (same spirit as a
  capability perk on a closed floor).
- **A floor-started game stops itself after 3 minutes without any game input**
  (`PUBLIC_GAME_IDLE_SECS`), checked by the public listener's supervisor
  tick. Reason: a game started by a group that wandered off would otherwise
  replace the show's look until the operator noticed. Operator-started games
  never auto-stop. A show playlist running blocks a floor start the same way
  it blocks the operator's.
- **The operator's Games tab lists hidden games** in a "Hidden" section
  marked "key holders only" — the operator is trusted and needs to test and
  stop them. The playlist cue picker does not list them.
- **The cone is always orange with white bands**, whatever color is picked
  (that is the joke), tip pointing toward the rim so it reads the same from
  every side. Operators get it on Live/Control pads (key `c`); the public
  page shows it only with the `cone` perk; the server refuses it without the
  perk, like strobe.
- **Perimeter's knob is "Trucks" (2–8, start 5)** — the color slots are the
  trucks; every truck is AI-driven until a human aims it, and the AI resumes
  ~15 s after the human's last tap (Spokewar's drop-in rule).

## Plan / steps

1. [x] Read the game framework, public floor, shapes; this plan (`6608aac`).
2. [x] **Cone shape** (`e5bcbda`): `EffectKind::Cone` (GPU id 16, in
   `SHAPES`), SDF stamp in both shaders, `ShapeKind` + `SHAPES` + `ShapeIcon`
   in the UI, `clamp_effect` refuses it without the `cone` perk, public page
   shows it with the perk, Settings known perk, tests.
3. [x] **Perimeter sim** (`4e4bab5`): `game/perimeter.rs` (fence, city
   rainbow, Gate Road traffic, airport, sneakers, trucks + AI, pressure
   scaling, catch/through flashes, `detail()`), `GameKind::Perimeter`, catalog
   entry with `hidden` + `perk`, Games tab Hidden section. Unit tests.
4. [x] **Floor start/stop** (`b57c11e`): `Gate::HiddenGame`, perk-implied
   games capability, `SharedState::start_floor_game` / `stop_floor_game` /
   `expire_floor_game`, `GameModeStatus.from_floor`, fixture, public UI
   Start/Stop pads, mock backend, Playwright specs, headless e2e script
   extension — run green against a real headless backend.
5. [x] Docs (`3c0252e`): README (shapes, games, perks),
   `docs/public-deploy.md` perks, `plans/game-mode.md` roster/progress.
6. [x] Final sweep (2026-10-11): cargo 292, unit 1, layout 96, behaviour 109
   (plus games + shape-definition), headless e2e with a game key and with a
   plain key, cone rendered and inspected via `scripts/shape-probe.ts`.

## Second hidden mode — Gathering, for Entheos (the host camp)

Cameron (2026-10-11): "We need a game for the Entheos Community, the host
camp … Some game about bringing the community together? idk..."

Source material: entheosrising.org (Entheos = "the god within"; "Channel
Your Strength Through Compassion"; radical inclusion, makers/healers/artists
from 43+ countries; the Gate as "birth, and rebirth", fire and light), the
camp mark (`public/media/entheos-precise.svg`: six orbs — orange, yellow,
green, blue, violet, red — at 60° steps on an enclosing ring, around a
six-point star whose blades point outward at the orbs), and Allison's
`EntheosWeave` layer (`gate.wgsl` case 20: the same geometry on the array,
blades wide at the hole and narrow at the tip, orbs at u≈0.79).

**Design — `GameKind::Gathering`, perk `game:gathering`.** The six orbs of
the mark sit near the rim in their colours; the star is dark. Sparks (lost
lights, dim white) wander the playa. A tap is a *call*: a warm pulse in the
player's colour spreading from the finger; every uncoloured spark it reaches
takes that colour and sets off for the orb of that colour, and sparks already
of that colour get a burst of speed home. Sparks are never re-coloured — no
stealing, compassion — so players cover for each other's orbs rather than
compete. A spark reaching its orb joins it; the orb brightens as it fills,
and a full orb lights its blade of the star from the centre out toward it.
When all six blades are lit the sigil is whole: the ring flares white, a
wave runs inward to the fire at the centre, and then rebirth — the orbs
empty, the blades fade, and every gathered spark is born again out of the
hole as a new uncoloured wanderer. Cycles count; the status line says how
many orbs are lit, how many sparks are home, how many gatherings so far.

- Zero-player: every orb calls softly on its own every 6–10 s over a small
  radius, so an empty floor completes a gathering in a few minutes; humans
  go out onto the playa and make it minutes faster. Any number of players
  simply add calls; nothing to balance against.
- Chips are the six orb colours, fixed (`chips` on the catalog entry), so a
  chip is "I call for the green orb". The admin knob is **Sparks** (2–8,
  ×12 wanderers, start 5 → 60); an orb needs ~80 % of its sixth to fill.
- Rendering: orbs at rn 0.86 (radius grows with fill, white shell when
  full), blades as in the weave (inner wide, tip narrow, flowing fill),
  a faint ring at rn 0.96 that flares on a gathering, sparks as dots (dim
  white → their colour), call pulses as expanding rings, the gathering as
  a white inward wave.

Built 2026-10-11 as `game/gathering.rs` with ten unit tests. Two rules were
added when the zero-player test stalled: a **lonely orb calls louder** (its
own call radius grows from 0.18 to 0.5 over a minute without an arrival),
and a **full orb passes surplus sparks back out** (an arrival at a full orb
is reborn from the fire instead of counted), so the last orb can never be
starved once every spark is coloured. Wanderers roam out past the orbs
(rn 0.35–0.93) with a gentler turn so they actually cover ground. Fixed
chips are a new catalog field (`chips`), with `chipCount` / `chipColor` /
`chipLabel` used by both the Games tab and the public page.



### Seen on the array (2026-10-11, headless engine via `scripts/game-probe.ts`)

`scripts/game-probe.ts` is new for this: it starts a game on a loopback
backend, lets it run, fires random taps if asked, and saves the preview as a
PNG (`test-results/games/<kind>.png`). Both games were looked at this way.

- Gathering: blades light per orb in the mark's colours, the ring flares and
  the white wave runs in on a gathering, sparks read as dots. The orbs were
  single-spoke dashes at first; they are now stretched 2.2x across the
  spokes so they read as orbs.
- Perimeter: the fence pentagon, rainbow city, Gate Road with cars and the
  runway all read. First pass leaked badly (0 caught, 16 in, with random
  taps) and trucks/headlamps were single cells. Tuned: trucks are 3x3
  blobs, headlamps two cells, Gate Road brighter, the AI aims a little
  inward of its target and re-aims every 1-2.2 s at 0.9x truck speed,
  catch radius 0.075, a parked truck mops up anyone within 0.2, sneakers
  0.075-0.14. Live zero-player over 90 s: 17 caught, 8 in. The unit test
  now demands >= 2 caught per 1 through with nobody driving. Random taps
  (the probe's "player") still do worse than the AI - they yank trucks to
  random spots - which is expected; a person aims at the headlamps.

## Follow-ups (not started, Cameron's call)

- **More hidden modes.** The mechanism is generic: a catalog entry with
  `hidden: true` + `perk: "game:<kind>"`, `GameKind::floor_perk`, and the
  sim. Nothing else to touch.
- **A playlist cue for Perimeter** — deliberately left out of the cue picker.
- **Idle timeout as config** (`FLOOR_GAME_IDLE` is a 180 s constant).
- **Tuning on the real array**: both games were tuned by unit test and by
  eye on the headless engine's preview (`scripts/game-probe.ts`), not under
  the rig. Run them on the Gate machine (Games tab → Hidden → Start) before
  the show and adjust the constants at the top of `perimeter.rs` /
  `gathering.rs`.

## Findings / gotchas

- `SHAPES` in `src/effects.ts` drives Live's keyboard shortcuts and every pad
  list, so the public page needs its own filter (cone only with the perk)
  rather than a separate array that `isShape` would miss.
- `EffectKind::ALL` is `[EffectKind; 16]` with the count in the type; the
  shader `case` arms are literal ids, and `Rotate` (15) is a CPU-side effect
  with an empty arm — the cone lands at 16 in both shaders.
- The engine converts a tap to cells with the configured inner radius; the sim
  never sees it, so Perimeter uses a fixed `HOLE = 0.32` to map rings back to
  normalized radius for its world-space motion (a game, not a survey).
- `gate.wgsl` has *two* `case 15u`/`default` pairs (the layer switch and
  `effect_color`); a text anchor on that pair alone lands in the wrong one.
  The guard test `every_effect_kind_has_a_shader_case` caught it.
- A truck steered "toward" a target across the city only slid along the
  fence (the radial projection ate most of each step). `drive()` now goes
  around: when the next step would enter the city it moves tangentially,
  shorter way round, hugging the fence. Test
  `a_tap_across_the_city_drives_around_the_fence`.
- The public listener's 1 Hz tick pushes a snapshot whenever the world
  changes, so an e2e script must *find* the snapshot with the game running
  rather than count replies.
- `scripts/shape-probe.ts` diffs a before/after frame; with the default
  noise scene the diff is all scene motion. Blank `layers` in the headless
  config (`"layers": []`) for a clean capture. The cone at `--size 0.7
  --radius 0.66` reads as a cone: base plate inward, taper to the rim, two
  white bands.
- Headless recipe used: config from `tests/fixtures/default-config.json`
  with `server.port` 9540, `public` enabled on 9541, `output.enabled`
  false, `update.auto_check` false, `layers: []`, keys `GPE`
  (`game:perimeter`, `cone`) and `Plain` (`big_brush`); write it under
  `$TEMP` (Windows Python cannot open `/tmp`); then
  `EMPYREAN_CONFIG=<path> target/debug/empyrean-gate.exe --headless` and
  `PUBLIC_BASE=http://127.0.0.1:9541 OPERATOR_BASE=http://127.0.0.1:9540
  KEY=<secret> bun scripts/public-floor-test.ts`.

## Progress log

- [x] 2026-10-11 Explored; plan written.
- [x] 2026-10-11 Cone shape landed and rendered.
- [x] 2026-10-11 Perimeter sim landed (10 unit tests).
- [x] 2026-10-11 Floor start/stop/expiry landed; e2e green both with a game
      key and with a plain key; strangers refused.
- [x] 2026-10-11 Docs updated; every check green on the final tree.
- [x] 2026-10-11 Gathering (Entheos) designed, built, seen live (`2931c23`
      + tuning commit); fixed-colour chips; `scripts/game-probe.ts`.
- [x] 2026-10-11 Perimeter tuned after seeing it live; zero-player test is
      quantitative now.

## Open questions for the user

None yet.

## Things not to do

- Don't let the public listener accept `set_game_config` — the knob is the
  operator's; the floor start sets the game's own default.
- Don't put the hidden games in the playlist cue picker.
- Never auto-stop an operator-started game.
