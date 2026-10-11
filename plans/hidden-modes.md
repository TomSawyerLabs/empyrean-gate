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

1. [x] Read the game framework, public floor, shapes; this plan.
2. [ ] **Cone shape** (own commit): `EffectKind::Cone` (GPU id 16, in
   `SHAPES`), SDF stamp in both shaders, `ShapeKind` + `SHAPES` + `ShapeIcon`
   in the UI, `clamp_effect` refuses it without the `cone` perk, public page
   shows it with the perk, Settings known perk, tests.
3. [ ] **Perimeter sim** (own commit): `game/perimeter.rs` (fence, city
   rainbow, Gate Road traffic, airport, sneakers, trucks + AI, pressure
   scaling, catch/through flashes, `detail()`), `GameKind::Perimeter`, catalog
   entry with `hidden` + `perk`, Games tab Hidden section. Unit tests.
4. [ ] **Floor start/stop** (own commit): `Gate::HiddenGame`, perk-implied
   games capability, `SharedState::set_game_mode_from_floor` +
   `expire_floor_game`, `GameModeStatus.from_floor`, fixture, public UI
   Start/Stop pads, mock backend, Playwright specs, headless e2e script
   extension, run it.
5. [ ] Docs: README (games list, perks), `docs/public-deploy.md` perks,
   `plans/game-mode.md` roster/progress, this plan's log.
6. [ ] Final sweep: all checks green, commits per step.

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

## Progress log

- [x] 2026-10-11 Explored; plan written.

## Open questions for the user

None yet.

## Things not to do

- Don't let the public listener accept `set_game_config` — the knob is the
  operator's; the floor start sets the game's own default.
- Don't put the hidden games in the playlist cue picker.
- Never auto-stop an operator-started game.
