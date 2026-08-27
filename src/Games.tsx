// Games tab (plans/game-mode.md): the admin turns the array into a continuous
// game world; every connected client can inject into it. Design center: the
// world runs fine with zero players — the simulation IS the attract mode — so
// joining is stepping into weather that was already happening, and leaving
// costs nothing. Start/stop is Gate-machine-only (the backend refuses it from
// remote clients); playing is open to everyone on the LAN.

import { useEffect, useRef, useState } from "react";
import { useGate } from "./state";
import GateCanvas from "./GateCanvas";
import type { GameCommand, GameKind } from "./types";

const GAMES: {
  kind: GameKind;
  name: string;
  blurb: string;
  /** The one admin knob, with its per-game meaning, bounds, and the value a
   * fresh start uses (more colors than the backend's conservative default —
   * chips are colors, not seats, but more of them still reads as more room). */
  knob: { label: string; min: number; max: number; start: number };
  /** Player-facing: what the goal is and what a tap does. Shown on the play
   * surface, written for someone who just picked up a phone. */
  howTo: string;
}[] = [
  {
    kind: "rps",
    name: "Ecosystem",
    blurb:
      "Species forever eating each other in rotating spiral fronts — it never " +
      "settles and never ends. Pick a species and tap the array to seed it.",
    knob: { label: "Species", min: 3, max: 5, start: 5 },
    howTo:
      "The species eat each other in a circle — each color feeds on the next. " +
      "There is no winning, only tides: pick a species and tap (or hold) to " +
      "flood ground with it, and watch the spiral war swing your way… until " +
      "the color that eats yours finds you.",
  },
  {
    kind: "life",
    name: "Primordial",
    blurb:
      "Game of Life in color: your taps splat living soup in your color, and " +
      "newborn cells inherit blended hues where colonies meet. Generations " +
      "advance on the beat; a drizzle of soup keeps a quiet world moving.",
    knob: { label: "Colors", min: 2, max: 8, start: 6 },
    howTo:
      "A living petri dish. Tap to splat soup of your color — it grows, dies " +
      "and drifts by the Game of Life's rules, stepping on the beat, and " +
      "newborn cells blend the colors of their parents. Grow gardens, crash " +
      "them into your neighbors', or take the ✕ and erase.",
  },
  {
    kind: "flak",
    name: "Flak",
    blurb:
      "Meteors stream from the rim toward the center; every tap detonates a " +
      "flak bloom that vaporizes what it catches, in your color. Pure co-op — " +
      "the storm swells with how hard the crowd is firing, and calms when " +
      "everyone wanders off.",
    knob: { label: "Colors", min: 2, max: 8, start: 5 },
    howTo:
      "Meteors are falling toward the middle — everyone is on the same team, " +
      "keeping them out. Tap just ahead of one to catch it in your flak " +
      "bloom; every kill sparkles in your color. The harder the crowd fires, " +
      "the heavier the storm gets.",
  },
  {
    kind: "spokewar",
    name: "Spokewar",
    blurb:
      "Rim bases at war: tap anywhere and your base fires a squad of army " +
      "particles at it, painting territory that always slowly fades. Every " +
      "base fights for itself until a player picks up its color — leaving " +
      "just hands it back.",
    knob: { label: "Bases", min: 2, max: 8, start: 5 },
    howTo:
      "Your color owns a base on the rim, and a tap anywhere sends a squad " +
      "flying there, painting territory that always slowly fades. Thick enemy " +
      "paint grinds squads down, so soften a sector before pushing through. " +
      "Bases never die — the goal is the biggest empire right now.",
  },
  {
    kind: "radial_tetris",
    name: "Ringfall",
    blurb:
      "Blocks fall inward from the rim. The bag mixes dots, dominoes, triominoes, " +
      "and classic four-block pieces. Radial gravity packs every spoke inward; " +
      "fill a complete ring to collapse the whole stack toward the center.",
    knob: { label: "Colors", min: 2, max: 8, start: 6 },
    howTo:
      "Tap a spoke to move the falling piece directly there. The outlined ghost " +
      "shows where it will land; use the controls or keyboard to move, rotate, " +
      "and drop it. Blocks settle inward on every spoke, so aim for the highlighted " +
      "inner gaps and complete a ring to clear it.",
  },
];

const RINGFALL_COMMANDS: Array<{
  command: GameCommand;
  icon: string;
  label: string;
  detail: string;
  key: string;
  strong?: boolean;
}> = [
  { command: "move_counter_clockwise", icon: "↶", label: "Move left", detail: "counter-clockwise", key: "← / A" },
  { command: "rotate_clockwise", icon: "↻", label: "Rotate piece", detail: "clockwise", key: "↑ / W" },
  { command: "move_clockwise", icon: "↷", label: "Move right", detail: "clockwise", key: "→ / D" },
  { command: "soft_drop", icon: "↓", label: "Drop 1 ring", detail: "one step inward", key: "↓ / S" },
  { command: "hard_drop", icon: "⇊", label: "Hard drop", detail: "land immediately", key: "Space", strong: true },
];

const GAP_FILLERS = [
  { label: "Dot", cells: [0] },
  { label: "Domino", cells: [0, 1] },
  { label: "Bar 3", cells: [0, 1, 2] },
  { label: "Corner 3", cells: [0, 1, 4] },
];

function PieceKey({ label, cells }: { label: string; cells: number[] }) {
  return (
    <span className="ringfall-piece">
      <span className="ringfall-piece-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, cell) => (
          <i key={cell} className={cells.includes(cell) ? "filled" : ""} />
        ))}
      </span>
      <small>{label}</small>
    </span>
  );
}

/** Life's erase input — matches `game::life::ERASE` on the backend. */
const ERASE_SPECIES = 0xff;

/// Approximate chip colors for the species picker. The backend rotates the
/// palette slowly over minutes so no species permanently owns a hue; the chips
/// stay at the base hue — close enough to say "I'm the green-ish one".
function speciesColor(s: number, count: number): string {
  return `hsl(${Math.round((s / count) * 360)} 85% 55%)`;
}

export default function Games() {
  const { client, status } = useGate();
  const game = status?.game;
  const active = game?.active ?? null;
  const activeGame = GAMES.find((g) => g.kind === active);
  const knob = activeGame?.knob ?? { label: "Species", min: 3, max: 5, start: 3 };
  // The knob value is shared across games; show it clamped to the running
  // game's own bounds (the sim clamps the same way).
  const species = Math.min(Math.max(game?.species ?? 3, knob.min), knob.max);
  const blockedBy = game?.blocked_by_show ?? null;

  // Same admin inference the Patch tab uses: the Gate machine's own window or
  // browser talks to loopback. The backend enforces it regardless.
  const isAdmin =
    client.httpBase.startsWith("http://127.0.0.1") ||
    client.httpBase.startsWith("http://localhost");

  const [mySpecies, setMySpecies] = useState(0);
  useEffect(() => {
    if (mySpecies === ERASE_SPECIES) {
      // The eraser only exists in Life.
      if (active !== "life") setMySpecies(0);
    } else if (mySpecies >= species) {
      setMySpecies(0);
    }
  }, [species, mySpecies, active]);

  // Taps batch on the same ~33 ms cadence the drawing path uses, so a burst of
  // excited tapping is one message per frame, not one per finger.
  const pending = useRef<{ angle: number; radius: number }[]>([]);
  const speciesRef = useRef(mySpecies);
  speciesRef.current = mySpecies;
  useEffect(() => {
    const flush = setInterval(() => {
      if (!pending.current.length) return;
      client.gameInput(speciesRef.current, pending.current);
      pending.current = [];
    }, 33);
    return () => clearInterval(flush);
  }, [client]);

  useEffect(() => {
    if (active !== "radial_tetris") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button")) return;
      const command: GameCommand | undefined = {
        ArrowLeft: "move_counter_clockwise",
        a: "move_counter_clockwise",
        A: "move_counter_clockwise",
        ArrowRight: "move_clockwise",
        d: "move_clockwise",
        D: "move_clockwise",
        ArrowUp: "rotate_clockwise",
        w: "rotate_clockwise",
        W: "rotate_clockwise",
        ArrowDown: "soft_drop",
        s: "soft_drop",
        S: "soft_drop",
        " ": "hard_drop",
      }[event.key] as GameCommand | undefined;
      if (!command) return;
      event.preventDefault();
      client.gameCommand(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, client]);

  if (!status) return <p className="hint">Waiting for backend…</p>;

  const gameCanvas = (
    <div className={`games-canvas-wrap ${active === "radial_tetris" ? "ringfall-canvas-wrap" : ""}`}>
      <GateCanvas
        onTap={(angle, radius) => {
          if (!active) return;
          // Ringfall's next action is often an immediate hard drop. Its lane
          // selection must reach the engine before that command; the 33 ms
          // crowd-input batch used by the paint-like games can reverse them.
          if (active === "radial_tetris") {
            client.gameInput(speciesRef.current, [{ angle, radius }]);
            return;
          }
          pending.current.push({ angle, radius });
        }}
      />
    </div>
  );

  return (
    <div className={`games-page ${active === "radial_tetris" ? "ringfall-running" : ""}`}>
      <section className={`panel games-control ${active ? "running" : ""}`}>
        <h3>Games</h3>
        <p className="hint">
          A game replaces the whole look of the array with a world that runs by
          itself — players only steer it. Anyone connected can play; there are
          no rounds, so joining and leaving any time is the normal way in.
        </p>
        {GAMES.map((g) => (
          <div key={g.kind} className={`games-card ${active === g.kind ? "active" : ""}`}>
            <div className="games-card-text">
              <strong>{g.name}</strong>
              <p className="hint">{g.blurb}</p>
            </div>
            {isAdmin ? (
              active === g.kind ? (
                <button className="ghost" onClick={() => client.setGameMode(null)}>
                  Stop
                </button>
              ) : (
                <button
                  disabled={!!blockedBy}
                  onClick={() => {
                    client.setGameMode(g.kind);
                    // Open with the game's own color count — roomier than the
                    // backend's conservative default.
                    client.setGameConfig({ species: g.knob.start });
                  }}
                >
                  Start
                </button>
              )
            ) : (
              <span className="hint">
                {active === g.kind ? "running" : "started from the Gate machine"}
              </span>
            )}
          </div>
        ))}
        {isAdmin && blockedBy && !active && (
          <p className="hint">
            “{blockedBy}” is running on the show scheduler — stop the show
            before starting a game.
          </p>
        )}
        {isAdmin && active && (
          <label className="row">
            <span>{knob.label}</span>
            <input
              type="range"
              min={knob.min}
              max={knob.max}
              step={1}
              value={species}
              onChange={(e) => client.setGameConfig({ species: Number(e.target.value) })}
            />
            <span>{species}</span>
          </label>
        )}
        {isAdmin && active && (
          <label className="row">
            <input
              type="checkbox"
              checked={game?.effects_overlay ?? false}
              onChange={(e) => client.setGameConfig({ effects_overlay: e.target.checked })}
            />
            <span>Overlay effects and drawing on the game</span>
          </label>
        )}
      </section>

      <section className="panel games-play">
        <h3>{active ? `Play ${activeGame?.name ?? ""}` : "Play"}</h3>
        {active ? (
          <div className={active === "radial_tetris" ? "ringfall-game-layout" : "games-active-content"}>
            {active === "radial_tetris" && (
              <div className="ringfall-stage">
                <div className="ringfall-status"><span>LIVE BOARD</span><strong>{game?.summary ?? "Ringfall"}</strong></div>
                {gameCanvas}
                <p>Tap any spoke to aim there. Bright blocks are falling; the outlined piece is your landing ghost.</p>
              </div>
            )}
            <div className={active === "radial_tetris" ? "ringfall-side" : "games-active-controls"}>
              <p className="games-howto">{activeGame?.howTo}</p>
              <p className="games-join">
                {active === "radial_tetris" ? (
                  <><strong>Aim.</strong> Rotate. Drop. Complete any full ring to pull the whole stack inward.</>
                ) : (
                  <><strong>1.</strong> Pick a color &nbsp;<strong>2.</strong> Tap the array below. That&apos;s joining — there are no seats and no turns, and any number of people can play, sharing colors freely.</>
                )}
              </p>
              {active === "radial_tetris" && (
                <span className="hint games-picker-label">Your piece color</span>
              )}
              <div className="games-species">
                {Array.from({ length: species }, (_, s) => (
                  <button
                    key={s}
                    className={`games-chip ${mySpecies === s ? "active" : ""}`}
                    style={{ ["--chip" as string]: speciesColor(s, species) }}
                    onClick={() => setMySpecies(s)}
                  >
                    {s + 1}
                  </button>
                ))}
                {active === "life" && (
                  <button
                    className={`games-chip erase ${mySpecies === ERASE_SPECIES ? "active" : ""}`}
                    onClick={() => setMySpecies(ERASE_SPECIES)}
                  >
                    ✕
                  </button>
                )}
              </div>
              {active === "radial_tetris" && (
                <div className="ringfall-play">
                  <div className="ringfall-piece-key">
                    <span className="hint">Frequent gap fillers</span>
                    <div>
                      {GAP_FILLERS.map((piece) => <PieceKey key={piece.label} {...piece} />)}
                    </div>
                  </div>
                  <div className="ringfall-controls" role="group" aria-label="Ringfall controls">
                    {RINGFALL_COMMANDS.map((control) => (
                      <button
                        key={control.command}
                        className={control.strong ? "primary" : "ghost"}
                        onClick={() => client.gameCommand(control.command)}
                        aria-label={`${control.label} — ${control.detail}`}
                      >
                        <span className="ringfall-control-icon">{control.icon}</span>
                        <span>
                          <strong>{control.label}</strong>
                          <small>{control.detail} · {control.key}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="hint">
            No game is running — the array is showing the normal scene. The
            preview below stays live either way.
          </p>
        )}
        {active !== "radial_tetris" && gameCanvas}
        {active !== "radial_tetris" && game?.summary ? <p className="hint">{game.summary}</p> : null}
      </section>
    </div>
  );
}
