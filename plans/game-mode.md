# Game mode — a Games tab with drop-in multiplayer toys

## Goal

An admin-only **game mode**: the admin picks a game from a Games tab, the current
scene crossfades out, and the array becomes a shared game world. Connected clients
(phones on the LAN, via the existing PWA) inject input. Design center: **continuous
worlds, not rounds** — every game is a simulation that runs forever with zero
players; humans are perturbations, not prerequisites. Joining should feel like
stepping into weather that was already happening. Cap ~10 simultaneous players.

Status: **phase 1 built** (2026-08-24). RPS ecosystem runs end to end: sim core
(`src-tauri/src/game/`), engine integration (tick beside the patch runtime,
storage binding 9, `game_color` mix in `gate.wgsl`), protocol
(`SetGameMode`/`SetGameConfig` loopback-only, `GameInput` open), Games tab +
GAME MODE banner. Commits `c7f3bb6`, `608a85d`, `f0b7a6b`.

## Progress log

- [x] Sim core: `RpsSim` (threshold CA, vigor, inject, watchdog) + 8 unit tests.
- [x] Engine: `GameRuntime` in the frame loop, beat-synced ticks (free-run
      backstop), prev/next packed-RGB snapshots, 2 s crossfade orthogonal to
      the playlist transition, effects/dabs suppression with overlay override.
- [x] Protocol/state/server: control surface in `SharedState` (never in
      config), loopback gate mirrors patch editing, timeline recording arms.
- [x] Frontend: Games tab (admin card + species chips + tap-to-inject via the
      preview canvas), banner, types/ws wrappers, layout-gate + nav-count
      test updates.
- [x] `bun run test:layout` (64 cases) / `test:behavior` (36, Chromium+WebKit)
      pass — run from a clean worktree at HEAD when the concurrent session's
      WIP was mid-edit.
- [x] **Primordial (Life)**: `game/life.rs` — B3/S23 with hue-as-lineage
      (circular-mean parent hues), soup injection (solid ink dies of
      overcrowding — taps splat sparse soup), ERASE species 0xff, watchdog
      revives starvation AND drizzles soup when population goes static.
      `GameSim` enum dispatch keeps the engine game-agnostic.
- [x] Playlist **game cue** backend: `GameCue { game, species }` on
      `ShowPlaylistEntry` (`skip_serializing_if` keeps old configs/fixture
      byte-identical), engine merges cue with the manual path (manual is
      refused during shows, so they can never fight), cue species wins,
      status summary says "scheduled". `state.game_input` no longer gates on
      the manual `active` flag so taps land during scheduled games too.
- [x] PWA manifest shortcut for `/#games`; Games tab has the Primordial card
      and Life's eraser chip.
- [x] Playlist editor UI: the "Add a scene…" picker in Control's show panel
      grew a Games optgroup; a game cue lands with an empty stack (black under
      the world, and what the next cue fades in from), 20 min default, and a
      green "game" chip on its row.
- [x] **Spokewar** (`game/spokewar.rs`): first particle-substrate game.
      Key design shortcut: player slots ARE the species chips — picking a chip
      aims that base, every base is AI-run until a human holds its chip, and
      the AI keeps firing under a player (the garrison fights alongside you),
      so 0→1 players is seamless by construction. Fixed 50 ms tick via a new
      `GameSim::cadence()` hook (None = beat-synced grid games, Some = fixed);
      the engine's pack interpolation smooths steps into continuous flight.
      Combat: painting is capture, defended cells (strength > 30) attrit —
      burn 90 strength, lose the particle; 3-ring fresh walls stop a 7-squad,
      1-ring walls partially breach (intended feel). Bases indestructible; the
      hole eats armies; territory decays ~22 s. The species knob is per-game
      now (label + bounds in the Games tab list: Species 3–5 / Colors 2–8 /
      Bases 2–8), and the backend control clamp widened to the union 2–8.
- [ ] Spokewar boss mode (co-op, thing in the hole with tendrils) — roster
      design exists; needs a mode toggle story first (second knob or a
      per-game variant field on GameCue).
- [ ] Next games: pick from tier 2 (Comets wants IMU steering; Flak reuses
      Burst; Pulse wants the beat grid).

## Handover notes for a fresh session

- Grid cells are packed RGB (colors baked CPU-side in
  `GameRuntime::pack_cells`) — the shader never knows species counts.
- `Globals` grew 8 fields (2×16 B groups); keep `gate.wgsl` in field-for-field
  step and sizes multiple of 16 (guard test:
  `game::tests::globals_struct_is_uniform_aligned`).
- Game state is deliberately NOT in `AppConfig` and NOT transplanted on
  handover — a self-update mid-game reseeds the world.
- A concurrent session was active in this worktree (effects/shapes, then
  layer-quick-edit); commit `648f8f9` repaired a staging race. Check
  `git status` before assuming the tree is yours alone.

## Environment / context

- Array: 64 spokes × 378 px, radius normalized `rn` 0.32..1.0 (**middle 32% is a
  physical hole**). Angular pitch 5.6° (0.078 world units of arc at r=0.8);
  radial resolution ~19× finer. Radial motion renders smoothly; angular features
  under ~2 spokes wide read as dotted lines (same finding as the shapes work —
  see `plans/more-effects-and-shapes.md`).
- Viewed from below, from all sides: **no canonical "up", no readable text.**
- Every UI is a WS client (JSON + binary, port 9520). Phones already stream
  polar dabs (drawing), IMU orientation, and mic features. The dab path is the
  natural template for game input.
- Backend owns the frame loop; the beat tracker runs continuously. Game logic
  belongs on the backend (Rust, fixed timestep), state uploaded to the GPU
  per frame; rendering is a WGSL path like layers/effects.
- Clients have persistent device ids + friendly names (Settings → Clients) —
  player identity is nearly free.

## Design principles (the user's, made explicit)

1. **Zero-player is the same game.** Attract mode = the simulation with no human
   slots (optionally gentle AI drift). No abrupt change when player 1 joins.
2. **Continuous over rounds.** Dropping off mid-game costs the world nothing;
   leaver's presence (territory, ink, base) decays gracefully. Games with real
   start/end are allowed but must announce themselves as such.
3. **The phone is the personal screen.** Score, color identity, join/leave,
   private controls live on the player's phone. The array shows only the shared
   world — no HUD, no text, no per-player UI on the rig.
4. **Beat-native where possible.** Simulation ticks, spawns, and blooms sync to
   the beat tracker. The DJ is an input.
5. **Radial-first mechanics.** Prefer motion in/out over motion around; keep
   angular features ≥2 spokes wide. The hole is a mechanic (drain / portal /
   boss arena), not a defect.

## Game roster

### Tier 1 — build first

- **RPS ecosystem** — cyclic predator–prey cellular automaton (3–5 species,
  each consumes the next). Self-organizes into rotating spirals; never
  converges, never dies — the best zero-player behavior on this list. Players
  inject bursts of a chosen species. Cheapest full proof of the whole mode.
- **Primordial** (colorful Game of Life) — multi-color Life on the polar grid:
  wrap in θ, dead boundary at hole and rim; offspring blend parent colors so
  colonies smear into gradients where they meet. Players paint live cells in
  their color, or erase. **Generations advance on the beat**; cells glow/fade
  smoothly between ticks. Zero-player: sparse random soup keeps it alive.
  Grid note: square-ish cells give roughly 64×10; anisotropic (radially thin)
  cells allow 64×24–48 and still look alive — chunky reads fine from 50 ft.
- **Spokewar** (tower defense) — each player owns a rim base spanning a few
  spokes; tap/flick emits army particles along a vector. Territory model, not
  kill-rounds: particles capture rings/nodes, territory decays slowly, a
  leaver's base erodes away. **Boss mode (co-op)**: a thing in the center hole
  extends tendrils outward along spokes; players' particles push it back. Boss
  never dies — recedes and regrows scaled to player count, so 1→10 works
  automatically.

### Tier 2

- **Comets** — each player is a comet orbiting the array; IMU tilt or a slider
  moves you radially; sweep up drifting motes to grow your tail. Crossing
  another tail shatters yours into sparkles (setback, not death). Radial
  dodging = the rig's best motion. Zero-player: AI comets wander.
- **Round Breakout** — concentric brick rings around the hole; players are
  paddle-arcs on the rim; co-op ball-keeping. Balls respawn on loss, rings
  regrow from the center, hole = warp portal (ball re-emerges at random angle).
  Zero-player: one lazy AI paddle keeps a ball alive.
- **Flak** (inverted Missile Command) — streaks fall inward from rim toward
  center; players tap to detonate flak blooms (Burst effect, weaponized).
  Pure co-op; wave pressure scales with connected players. Zero-player: sparse
  meteor shower, occasional auto-bloom.
- **Ink** — territory painting: flick blobs of your color; coverage decays over
  minutes so the map never settles and departed ink fades out. Phone shows
  live coverage %. Zero-player: drifting "ink weather".
- **Pulse** — rhythm game: sectors flash ahead of upcoming beats; players tap
  in time to claim/color them. The one game that directly plays the DJ's
  music; likely crowd favorite. Zero-player: the array just visualizes the
  beat grid (which it can already nearly do).

### Tier 3 / later

- **Shepherd** — boid flock; each player is an attractor/repulsor. Pure
  collaborative art, zero competition. Trivially zero-player.
- **Garden** — plant seeds at the rim; luminous vines grow inward and bloom on
  the beat; old growth composts. Gentle space competition. Chill-out game.
- **Polar falling sand** — pour colored sand/water/fire from the rim; gravity
  pulls inward; the hole drains. Lovely, but anisotropic-grid physics is
  fiddly — prototype before promising.
- **Orbit race** — lap racing with lane (radius) changes and boost pads.
  Continuous flow-race, rubber-banded. Needs the tightest input latency of
  anything here; LAN WS is probably fine but measure first.

## Architecture sketch

- **Mode switch**: admin-only. Entering game mode crossfades the layer stack
  out and the game layer in — same crossfade machinery the playlist scheduler
  uses. Exiting restores the prior scene. Effects/drawing suppressed or
  repurposed while in game mode (decide per game).
- **Game loop**: backend Rust, fixed timestep (beat-synced tick where the game
  wants it), independent of render fps. State → GPU as a small storage
  texture / instance buffer; one WGSL render path per game family.
- **Two substrates, many skins**:
  - *Grid substrate* (a polar cell grid + per-cell color/state): RPS, Life,
    Ink, Garden, falling sand.
  - *Particle substrate* (positions/velocities/colors + a few field nodes):
    Spokewar, Flak, Comets, Breakout, Shepherd, Orbit race.
- **Input**: reuse the dab/WS path shape — a `game_input` message (polar point
  + gesture kind + client id). Phones get a per-game controller surface in the
  Games tab (join button, color chip, game-specific pad/slider, personal
  score).
- **Slots**: claim-on-join, color from a distinguishable ~10-color palette
  (phones can show names; the array shows only color). On disconnect: slot
  frees, presence decays or hands to AI. Cap ~10; beyond cap, spectate +
  queue.
- **Admin vs player**: game *selection* and mode enter/exit are admin-gated
  (same trust model as test mode arming); *playing* is open to any connected
  client.

## Decisions already made (don't re-ask)

Answered by the user 2026-08-24:

1. **Any connected client may play.** The LAN plus the optional join token is
   the gate; no per-player approval, no named-device requirement.
2. **Effects/drawing suppressed during a game by default, with an admin
   override toggle** to overlay them (strobe on a boss hit, etc.).
3. **Playlist scheduling is designed in from the start.** A game segment is a
   first-class cue type (the zero-player attract mode is what makes an
   unattended 2am game segment viable) — architecture must support it from
   day one even if the playlist UI for it lands later.
4. **Build order: RPS ecosystem → Life → Spokewar.** Smallest build with the
   best zero-player behavior first; proves mode switching, input, and slots;
   Life reuses the grid substrate; Spokewar is the first real-controller game.

## Phase 1 game spec — RPS ecosystem

Rules chosen for spiral formation and un-killable zero-player behavior:

- **Grid**: 64 (θ, wrapped) × 48 (r) cells over rn 0.32..1.0. Cells are radially
  thin / angularly wide — fine for a CA; spirals still form on anisotropic
  grids. Each cell: `species: u8` + `vigor: u8`.
- **Species**: 3 by default, admin-adjustable 3–5 live. Colors: evenly spaced
  saturated hues, rotated slowly over minutes so no species permanently "owns"
  red. Cyclic dominance: species `i` is consumed by species `(i+1) % S`.
- **Tick rule** (threshold variant — gives clean fronts): a cell converts to
  its predator's species when ≥ T of its 8 neighbors (θ-wrapped; clamped at
  hole/rim) are that predator. T≈3. Conversion resets `vigor` to max; vigor
  decays each tick and freshly-converted frontier cells render brighter, so
  the spiral edges shimmer and the interior settles to a calmer fill.
- **Tick timing**: on the beat when the beat tracker is confident (subdivide
  ×2 above ~; multiply below ~90 BPM so the sim stays lively), else a fixed
  ~8 Hz. Cell colors interpolate between ticks — no strobing.
- **Input**: player picks a species on their phone (with ≤S players each can
  "champion" one species; more players share) and taps/drags on the array
  view to inject a blob (~3 spokes × 6 cells) of that species. Hold = stream.
  Injection uses the dab input path shape.
- **Zero-player**: the CA self-sustains once seeded. Watchdog: if any species'
  cell count falls below ~2%, inject a few random blobs of it (this is also
  what keeps a 3-species sim from collapsing on a small grid).
- **Render**: species color × vigor envelope, beat-pulsed brightness, soft
  glow at conversion frontiers. No text, no HUD.

## Things not to do

- Don't put text, numbers, or any oriented HUD on the array — phones carry the
  personal UI; the array is the shared world only.
- Don't design mechanics that need fine angular detail (<2 spokes) or fast
  angular precision — the 5.6° pitch will eat them.
- Don't make attract mode a separate "demo" code path — it must be the same
  simulation with zero human slots, or the no-abrupt-join property is lost.
- Don't tie game ticks to render fps — beat-synced or fixed-timestep on the
  backend, interpolated on the GPU.
