# Classic games, circular — Rimfire, Echo, Spacewar, Trails, Rally

## Goal

Five more games on the Gate, each a classic arcade or toy reworked for a ring of
64 spokes with a hole in the middle, all in the house style (plans/game-mode.md).
That means a world that runs with zero players, phones drop in and out, and a
color chip is a role you pick, not a seat you hold.

| Game | Classic | Circular twist |
| --- | --- | --- |
| **Rimfire** | Tempest (1981) | The hole is the far end of the tube; enemies climb out along the lanes; claws ride the rim and shoot inward |
| **Echo** | Simon (1978) | Coloured wedges around the ring; the Gate plays a pattern on the beat, the whole floor answers it together |
| **Spacewar** | Spacewar! (1962) | The hole is the star: gravity, orbits, torpedoes; leaving at the rim brings you back in at the opposite side |
| **Trails** | Light cycles / Snake | Cycles on the polar grid; the hole and the rim are walls; trails fade from the tail |
| **Rally** | Pong | Each color owns an arc of the rim with a paddle; balls bounce off the hole |

The user picked these from a brainstorm (2026-10-14: "i like your best fit
suggestions. do them all").

## Environment / context

- Repo `~/git/Personal Projects/Empyrean` (shared working tree, branch
  `master`), started at `2b29aae` (v0.13.1 + plan). Origin
  `TomSawyerLabs/empyrean-gate`.
- Game plumbing (all learned from Flak/Perimeter/Ringfall):
  - Sims live in `src-tauri/src/game/<name>.rs`; `game/mod.rs` has the
    `GameKind` enum (snake_case on the wire), `label`, `floor_species`, and the
    `GameSim` enum dispatch (`new`, `theta`, `radial`, `set_species`,
    `cadence`, `tick`, `watchdog`, `inject`, `command`, `detail`,
    `pack_cells`). Adding an arm anywhere is a compile error until wired
    everywhere.
  - Grid: `theta` = spokes (64) × `GRID_RINGS` = 48; ring 0 at the hole
    (radius 0.32 of the disc), ring 47 at the rim. Index `ir * theta + it`.
    On the phone preview **spoke 0 is at the bottom and θ increases
    counterclockwise** (`GateCanvas` feeds `cos/sin(θ − π/2)` straight into
    WebGL clip space, y up; its "spoke 0 at top" comment is wrong). The
    game probe draws spoke 0 at 3 o'clock, also counterclockwise.
  - Packed RGB `r | g<<8 | b<<16`; the engine crossfades `prev`→`next` over
    one tick. `cadence() = None` ticks on the beat (Life, Ecosystem),
    `Some(0.05)` is the particle step.
  - Taps arrive as `inject(it, ir, species)`; commands (buttons) arrive as
    `command(GameCommand)` and before this work carried no color.
  - Movers in world coordinates rasterized at pack time: see `perimeter.rs`
    (`HOLE = 0.32`, `cell_center`, `cell_of`).
  - "AI until a human aims it": `human_until` tick stamps (Perimeter,
    Spokewar).
- Frontend: `src/gameCatalog.ts` (names, blurbs, howTo, knob), `src/Games.tsx`
  (operator tab + play surface), `src/public/PublicApp.tsx` (public floor, also
  plays open games when the floor's `games` capability is on),
  `src/Control.tsx` `GAME_CUES` (playlist cues), `src/types.ts` (`GameKind`,
  `GameCommand` unions), `src/ws.ts` / the public client's `gameCommand`.
- Checks: `cargo test --lib` (in `src-tauri/`), `bun run typecheck`,
  `bun run test:unit`, `bun run test:layout`, `bun run test:behavior`,
  `playwright test games`. Status fixture: regenerate with
  `EMPYREAN_UPDATE_FIXTURES=1 cargo test fixture` if `GameModeStatus` changes
  (not expected).

## Decisions already made (don't re-ask)

1. **All five are open games** (Games tab, playlist cues, public floor with
   the `games` capability), not hidden ones. Each has an AI or attract mode,
   so a cue with nobody playing still looks alive.
2. **Original names; the classic goes in the blurb.** Tempest, Simon and Pong
   are live trademarks (Ringfall set the precedent by not saying "Tetris").
   Spacewar! (MIT, 1962) has no owner to mind, so it keeps its name minus the
   bang. Kinds: `rimfire`, `echo`, `spacewar`, `trails`, `rally`.
3. **Buttons carry the player's color.** `ClientMsg::GameCommand` gains
   `species` (serde default 0, so old clients and Ringfall are unchanged) and
   the queue stores `(command, species)`. New commands: `turn_left`,
   `turn_right` (Trails), `fire`, `hyperspace` (Spacewar), `superzap`
   (Rimfire). The protocol rule "controls say exactly what they do" stands.
4. **Taps keep meaning "go there"** in every game: Rimfire claw → that lane,
   Spacewar ship → turn and burn toward the point, Trails cycle → turn toward
   it, Rally paddle → that angle (inside its own arc), Echo → that wedge.
   Buttons are extras on top, never required to play.
5. **Echo ticks on the beat** (`cadence() = None`): the pattern plays one step
   per beat of the DJ's music. A correct tap scores immediately; a step that
   gets only wrong taps fails at the next beat, so one right answer from
   anyone in the crowd rescues a step. The more people play, the easier it
   gets. That's on purpose: it's a party.
6. Echo has no color chips: you play by tapping wedges, and wedge colors are
   the knob's hues.
7. No shader changes: everything rides the polar grid lookup.

## Plan / steps

1. [x] Infrastructure: `species` on `GameCommand`, new command variants,
       `GameSim::command(command, species)`, ws/public clients, a shared
       per-game button row (`src/GameButtons.tsx`, data in the catalog).
       `aa70937`; probe options `8bab1ed`.
2. [x] Rimfire (sim + tests + wiring + catalog + cues + buttons). `bdd2315`.
3. [x] Echo (+ `GameSim::beat()` hook). `4f9b569`.
4. [x] Spacewar. `774a0a1`.
5. [x] Trails. `e593712`.
6. [ ] Rally. ← current
7. [ ] Playwright: buttons send `game_command` with the chosen color; the
       Games tab lists the new cards.
8. [ ] Real backend run: start each game, tap, press buttons, screenshot the
       preview; tune what looks wrong.
9. [ ] README game paragraph, this plan, commit per game.

## Game designs

### Rimfire (Tempest)

- 16 lanes × 4 spokes. Claws (one per color slot, knob 2–8, start 4) sit on
  the rim, one lane each, and auto-fire inward down their lane.
- Enemies come out of the hole: **flippers** climb a lane, then at the rim
  flip lane-to-lane toward the nearest claw and grab it (the claw is lost for
  2 s, respawning with a flash); **tankers** climb slowly and split into two
  flippers on adjacent lanes when shot; **spikers** climb, leave a green spike
  down the lane behind them, turn back at mid-tube; shots wear spikes down
  from the tip.
- Superzapper: the `superzap` button clears every enemy on the board, once
  per color per 30 s.
- Pressure follows the crowd (Flak's rule); AI claws drift to the most
  threatened lane, lazily.
- Look: Tempest's blue tube (lane dividers dim blue, rim ring brighter),
  claws in player colors, flippers red, tankers violet, spikers/spikes green.

### Echo (Simon)

- Wedges = knob (3–8, start 4) evenly spaced around the ring.
- Phases per beat: **show** (each step lights its wedge for a beat),
  **listen** (wedges dim; taps light their wedge at once), **win** (whole
  ring flashes the pattern's colors, the pattern grows by one), **miss** (the
  wrong wedge buzzes dark red, the right one blinks, back to length 1).
- Attract: with no tap for about 16 beats, the pattern still plays and the
  Gate answers itself, slowly and sometimes wrongly, so a cue with nobody
  playing is a light show that looks like a game.
- Status: "pattern 7 · best 12".

### Spacewar (Spacewar!)

- World coordinates (Perimeter style). The hole is the star: gravity ∝ 1/r²
  toward the center; touching the hole ends a ship (the star flares).
- One ship per color (knob 2–8, start 4). A tap means turn toward the point
  and burn for about 0.6 s. Buttons: **Fire** (a torpedo forward, with a
  cooldown; torpedoes feel gravity) and **Hyperspace** (vanish, reappear at
  random, with a small chance of not coming back).
- Leaving at the rim brings you back in at the antipodal point, the
  circle's version of the original's wrap-around screen.
- AI ships keep orbits, lead their shots, and occasionally fall in.
- A destroyed ship respawns after 3 s in a safe orbit. Kill counts per color
  go in the status line.

### Trails (light cycles / Snake)

- Grid-native cycles with headings out / in / cw / ccw. Speed is physical,
  so a sideways move at the rim (a wide cell) costs more time than one ring.
- Turns: `turn_left` / `turn_right` buttons, relative to the heading on the
  phone preview; a tap turns toward the point (never a U-turn).
- Hitting any trail, the hole or the rim ends the cycle in a burst of color.
  The cycle respawns at the rim after 2 s, and its trail fades out.
- Trails are a fixed length (Snake): the tail fades so the arena never
  clogs. The trail's owner gets the kill when someone crashes into it.
- AI cycles look ahead and dodge, and now and then cut someone off.

### Rally (Pong)

- Each color owns an equal arc of the rim with a paddle that slides inside
  it. The hole is a round bumper in the middle.
- Ball count scales with players (1 + humans / 2, capped at 4). Hitting off
  the paddle's edge angles the return, as in Pong. Speed creeps up during a
  rally and resets on a miss.
- A miss flashes the owner's arc, and the last hitter scores. AI paddles
  track the ball, a little late.

## Findings / gotchas

- **Preview orientation** (see Environment): I first assumed clockwise from
  the top and laid Echo's Simon colors out wrong; caught on the first probe
  image. Trails' left/right turns use the counterclockwise convention.
- **Same-color collisions in Rimfire**: evenly spaced slot hues put claw 0
  on the flippers' red and claw 3 on the tankers' violet. Rimfire's claws now
  have their own palette (`CLAW_COLORS`, the catalog's `palette`).
- **AI that never doubles up was too good**: once Rimfire's AI claws spread
  across lanes, nothing reached the rim in 2 minutes and the tube was empty.
  The fix was a lazier AI that reacts only past halfway, fires every 9
  ticks, and has a calm rate of 1.1/s: 2–6 grabs per 2 minutes, 3–12
  enemies on the board.
- **Echo's tempo**: a sim that measures beats from the first one sees a
  1-tick gap and calls it fast music; only consecutive beats (2..40 ticks
  apart) set the tempo now.
- Beat-ticked games (`cadence() = None`) fade each change in across the whole
  beat, so the light peaks just *before* the next beat. That's why Echo runs on
  the 50 ms step and hears beats via `GameSim::beat()`.

## Progress log

- [x] 2026-10-14 explored the game plumbing; plan written.
- [x] Rimfire, Echo, Spacewar, Trails built, unit-tested, tuned with the
      probe against the headless backend on :9540 (`$TEMP/EmpyreanClassics/
      start.sh`), and committed one per game. The `game-probe` helper's new
      `--species` / `--command` options match what the Games tab sends.
- Tuning notes: Spacewar's AI hit 30% of its shots until its aim error
  stopped being re-rolled every tick (now ~18 kills / 2 min with 4 AI
  ships); Trails' AI almost never crashed until walls grew to 3.0 units and
  it started hunting rivals (~10 crashes / 2 min).

## Open questions for the user

1. Names (Rimfire, Echo, Spacewar, Trails, Rally): easy to change later; the
   wire names are the kinds above. Recommendation: keep.

## Things not to do

- Don't add storage buffers or shader paths: the grid lookup is enough.
- Don't make buttons the only way to play; a tap must always do something
  useful.
- Don't use wall-clock time inside a sim; ticks only, so seeded runs
  reproduce (`tick_is_deterministic` tests).
