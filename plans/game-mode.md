# Game mode — a Games tab with drop-in multiplayer toys

## Goal

An admin-only **game mode**: the admin picks a game from a Games tab, the current
scene crossfades out, and the array becomes a shared game world. Connected clients
(phones on the LAN, via the existing PWA) inject input. Design center: **continuous
worlds, not rounds** — every game is a simulation that runs forever with zero
players; humans are perturbations, not prerequisites. Joining should feel like
stepping into weather that was already happening. Cap ~10 simultaneous players.

Status: **ideation / design**. Nothing built yet.

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
