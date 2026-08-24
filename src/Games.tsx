// Games tab (plans/game-mode.md): the admin turns the array into a continuous
// game world; every connected client can inject into it. Design center: the
// world runs fine with zero players — the simulation IS the attract mode — so
// joining is stepping into weather that was already happening, and leaving
// costs nothing. Start/stop is Gate-machine-only (the backend refuses it from
// remote clients); playing is open to everyone on the LAN.

import { useEffect, useRef, useState } from "react";
import { useGate } from "./state";
import GateCanvas from "./GateCanvas";
import type { GameKind } from "./types";

const GAMES: {
  kind: GameKind;
  name: string;
  blurb: string;
  /** The one admin knob, with its per-game meaning and bounds. */
  knob: { label: string; min: number; max: number };
  playHint: string;
}[] = [
  {
    kind: "rps",
    name: "Ecosystem",
    blurb:
      "Species forever eating each other in rotating spiral fronts — it never " +
      "settles and never ends. Pick a species and tap the array to seed it.",
    knob: { label: "Species", min: 3, max: 5 },
    playHint:
      "Pick a species, then tap the array to seed it. Hold nothing back — " +
      "inputs from everyone merge.",
  },
  {
    kind: "life",
    name: "Primordial",
    blurb:
      "Game of Life in color: your taps splat living soup in your color, and " +
      "newborn cells inherit blended hues where colonies meet. Generations " +
      "advance on the beat; a drizzle of soup keeps a quiet world moving.",
    knob: { label: "Colors", min: 2, max: 8 },
    playHint:
      "Pick a color and tap to splat living soup — or take the ✕ and erase. " +
      "Newborns blend their parents' colors where colonies meet.",
  },
  {
    kind: "spokewar",
    name: "Spokewar",
    blurb:
      "Rim bases at war: tap anywhere and your base fires a squad of army " +
      "particles at it, painting territory that always slowly fades. Every " +
      "base fights for itself until a player picks up its color — leaving " +
      "just hands it back.",
    knob: { label: "Bases", min: 2, max: 8 },
    playHint:
      "Pick a base color, then tap where its squads should fly. Strong enemy " +
      "paint grinds squads down — soften a sector before pushing through it.",
  },
];

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
  const knob = activeGame?.knob ?? { label: "Species", min: 3, max: 5 };
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

  if (!status) return <p className="hint">Waiting for backend…</p>;

  return (
    <div className="games-page">
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
                  onClick={() => client.setGameMode(g.kind)}
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
        <h3>Play</h3>
        {active ? (
          <>
            <p className="hint">{activeGame?.playHint}</p>
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
          </>
        ) : (
          <p className="hint">
            No game is running — the array is showing the normal scene. The
            preview below stays live either way.
          </p>
        )}
        <div className="games-canvas-wrap">
          <GateCanvas
            onTap={(angle, radius) => {
              if (!active) return;
              pending.current.push({ angle, radius });
            }}
          />
        </div>
        {game?.summary ? <p className="hint">{game.summary}</p> : null}
      </section>
    </div>
  );
}
