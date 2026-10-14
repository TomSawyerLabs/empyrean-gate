// The secret page (plans/doom.md): /#doom, or type "doom" on any keyboard.
// Before DOOM runs it is the start screen (skill, one big button); while it
// runs it is the controller and the HUD — the array shows the game, the phone
// shows the numbers the array cannot. Keys are HELD, not tapped: every pad
// button sends down on press and up on release, and the page lifts everything
// it holds the moment it is hidden, blurred or left, so a pocketed phone never
// keeps the marine walking into a wall.

import { useCallback, useEffect, useRef, useState } from "react";
import { useGate } from "./state";
import GateCanvas from "./GateCanvas";
import type { GameKey } from "./types";

const SKILLS: { skill: number; name: string }[] = [
  { skill: 1, name: "I'm too young to die" },
  { skill: 2, name: "Hey, not too rough" },
  { skill: 3, name: "Hurt me plenty" },
  { skill: 4, name: "Ultra-Violence" },
  { skill: 5, name: "Nightmare!" },
];

/** Physical keys for the Gate machine's own keyboard (DOOM's defaults, plus
 *  WASD/QE because that is what hands expect now). */
const KEYBOARD: Record<string, GameKey> = {
  ArrowUp: "up",
  w: "up",
  ArrowDown: "down",
  s: "down",
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right",
  q: "strafe_left",
  e: "strafe_right",
  Control: "fire",
  f: "fire",
  " ": "use",
  Shift: "run",
  Alt: "strafe",
  "1": "weapon1",
  "2": "weapon2",
  "3": "weapon3",
  "4": "weapon4",
  "5": "weapon5",
  "6": "weapon6",
  "7": "weapon7",
  Escape: "escape",
  Enter: "enter",
  y: "yes",
  n: "no",
  Tab: "map",
};

type Press = (key: GameKey, down: boolean) => void;

/** One alignment nudge: a sixteenth of a turn (four spokes). */
const ALIGN_STEP = Math.PI / 8;

/** A pad button that holds a key for as long as the finger is on it. */
function HoldKey({
  k,
  label,
  detail,
  className = "",
  press,
  disabled,
}: {
  k: GameKey;
  label: string;
  detail: string;
  className?: string;
  press: Press;
  disabled: boolean;
}) {
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer (tests) has no capture; the up still arrives.
    }
    press(k, true);
  };
  const up = () => press(k, false);
  return (
    <button
      type="button"
      className={`doom-key ${className}`}
      aria-label={detail}
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

export default function Doom() {
  const { client, status } = useGate();
  const game = status?.game;
  const active = game?.active === "doom";
  const doom = game?.doom ?? null;
  const [skill, setSkill] = useState(3);
  const [run, setRun] = useState(true);
  const controllerId = doom?.controller_id ?? null;
  const mine = controllerId === client.clientId;
  const free = controllerId === null;
  const canPlay = active && (free || mine);

  // Everything this page currently holds down, so it can let go of all of it.
  const held = useRef(new Set<GameKey>());
  const runRef = useRef(run);
  runRef.current = run;
  const press = useCallback<Press>(
    (key, down) => {
      if (down) {
        if (held.current.has(key)) return;
        // Run is a sticky held Shift, asserted lazily with the first real
        // key rather than on page open: opening the page must not claim the
        // controls, or every open DOOM page races for them when a game starts.
        if (runRef.current && key !== "run" && !held.current.has("run")) {
          held.current.add("run");
          client.gameKey("run", true);
        }
        held.current.add(key);
      } else {
        if (!held.current.has(key)) return;
        held.current.delete(key);
      }
      client.gameKey(key, down);
    },
    [client],
  );
  const releaseAll = useCallback(() => {
    for (const key of Array.from(held.current)) press(key, false);
  }, [press]);

  // Alignment nudges ride the same "face me" input as a tap on the preview:
  // an absolute facing, so a run of quick taps builds on the last one SENT
  // rather than on a status that has not caught up yet.
  const turnSent = useRef<number | null>(null);
  const turnNow = doom?.turn ?? 0;
  useEffect(() => {
    if (turnSent.current !== null && Math.abs(turnSent.current - turnNow) < 0.02) {
      turnSent.current = null;
    }
  }, [turnNow]);
  const rotate = useCallback(
    (delta: number) => {
      const base = turnSent.current ?? turnNow;
      const next = (((base + delta) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      turnSent.current = next;
      client.gameInput(0, [{ angle: next, radius: 1 }]);
    },
    [client, turnNow],
  );
  const flip = useCallback(() => {
    client.setGameConfig({ mirror: !(doom?.mirror ?? false) });
  }, [client, doom?.mirror]);

  // Leaving the page (another tab, back to Live) also gives the controls up,
  // so the next phone is not locked out until this one's socket drops.
  const mineRef = useRef(mine);
  mineRef.current = mine;
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) releaseAll();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", releaseAll);
    window.addEventListener("blur", releaseAll);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", releaseAll);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
      if (mineRef.current) client.gameRelease();
    };
  }, [releaseAll, client]);

  // Toggling Run while holding the controls applies at once; turning it on
  // is an explicit press, so it may claim free controls like any key.
  useEffect(() => {
    if (!canPlay) return;
    if (run) {
      if (!free) press("run", true);
    } else {
      press("run", false);
    }
  }, [canPlay, free, run, press]);

  // The Gate machine's keyboard. Held keys there work the same way.
  useEffect(() => {
    if (!canPlay) return;
    const target = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement;
    const onDown = (e: KeyboardEvent) => {
      if (target(e) || e.metaKey) return;
      if (e.key === "[" || e.key === "]" || e.key === "\\") {
        e.preventDefault();
        if (e.key === "\\") flip();
        else rotate(e.key === "[" ? -ALIGN_STEP : ALIGN_STEP);
        return;
      }
      const key = KEYBOARD[e.key] ?? KEYBOARD[e.key.toLowerCase()];
      if (!key) return;
      e.preventDefault();
      if (e.repeat) return;
      press(key, true);
    };
    const onUp = (e: KeyboardEvent) => {
      const key = KEYBOARD[e.key] ?? KEYBOARD[e.key.toLowerCase()];
      if (!key) return;
      e.preventDefault();
      press(key, false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [canPlay, press, rotate, flip]);

  if (!status) return <p className="hint">Waiting for backend…</p>;

  if (!active) {
    const other = game?.active ? game.summary.split(" · ")[0] : null;
    return (
      <div className="doom-page">
        <section className="panel doom-start">
          <h2 className="doom-title">DOOM</h2>
          <p className="doom-tagline">Yes. It runs DOOM.</p>
          <p className="hint">
            Shareware Episode 1 on the array, controlled from this phone. The ring
            is the screen, the hole eats the status bar, and this page is your
            HUD. It ends by itself when nobody is playing.
          </p>
          {game?.ended && <p className="doom-ended">DOOM ended: {game.ended}.</p>}
          <div className="doom-skills" role="radiogroup" aria-label="Skill">
            {SKILLS.map((s) => (
              <button
                key={s.skill}
                type="button"
                role="radio"
                aria-checked={skill === s.skill}
                className={`doom-skill ${skill === s.skill ? "active" : ""}`}
                onClick={() => setSkill(s.skill)}
              >
                <span>{s.skill}</span>
                {s.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="primary doom-start-btn"
            onClick={() => client.setGameMode("doom", skill, true)}
          >
            Rip and tear
          </button>
          {other && (
            <p className="hint">
              {other} is running; DOOM takes over the array and hands it back when it ends.
            </p>
          )}
        </section>
      </div>
    );
  }

  const ammo = doom?.ammo == null ? "—" : `${doom.ammo}${doom.max_ammo != null ? ` / ${doom.max_ammo}` : ""}`;
  const who = free
    ? "The controls are free — press anything to take them."
    : mine
      ? "You have the controls."
      : `${doom?.controller ?? "Someone"} has the controls.`;

  return (
    <div className="doom-page doom-running">
      <section className="panel doom-hud" aria-label="DOOM status">
        <div className="doom-hud-row">
          <span className="doom-stat">
            <small>Health</small>
            <strong className={doom && doom.health <= 25 ? "low" : ""}>{doom?.health ?? "—"}</strong>
          </span>
          <span className="doom-stat">
            <small>Armor</small>
            <strong>{doom?.armor ?? "—"}</strong>
          </span>
          <span className="doom-stat">
            <small>Ammo</small>
            <strong>{ammo}</strong>
          </span>
          <span className="doom-stat">
            <small>Kills</small>
            <strong>
              {doom?.kills ?? 0}
              <em> / {doom?.total_kills ?? 0}</em>
            </strong>
          </span>
          <span className="doom-stat">
            <small>Map</small>
            <strong>{doom?.map ?? "—"}</strong>
          </span>
        </div>
        <div className="doom-hud-line">
          <span>{doom?.weapon ?? ""}</span>
          <span className={`doom-who ${mine ? "mine" : ""}`}>{who}</span>
        </div>
      </section>

      <section className="panel doom-controller">
        <div className="doom-pad" role="group" aria-label="DOOM controls">
          <div className="doom-dpad">
            <HoldKey k="up" label="▲" detail="Forward" className="up" press={press} disabled={!canPlay} />
            <HoldKey k="left" label="◀" detail="Turn left" className="left" press={press} disabled={!canPlay} />
            <HoldKey k="right" label="▶" detail="Turn right" className="right" press={press} disabled={!canPlay} />
            <HoldKey k="down" label="▼" detail="Back" className="down" press={press} disabled={!canPlay} />
          </div>
          <div className="doom-actions">
            <HoldKey k="fire" label="FIRE" detail="Fire" className="fire" press={press} disabled={!canPlay} />
            <HoldKey k="use" label="USE" detail="Use (doors, switches)" className="use" press={press} disabled={!canPlay} />
            <HoldKey k="strafe_left" label="⇠" detail="Strafe left" press={press} disabled={!canPlay} />
            <HoldKey k="strafe_right" label="⇢" detail="Strafe right" press={press} disabled={!canPlay} />
          </div>
        </div>

        <div className="doom-row doom-weapons" role="group" aria-label="Weapons">
          {([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
            <HoldKey
              key={n}
              k={`weapon${n}` as GameKey}
              label={String(n)}
              detail={`Weapon ${n}`}
              className="small"
              press={press}
              disabled={!canPlay}
            />
          ))}
          <button
            type="button"
            className={`doom-key small doom-toggle ${run ? "on" : ""}`}
            aria-pressed={run}
            disabled={!canPlay}
            onClick={() => setRun((r) => !r)}
          >
            Run
          </button>
        </div>

        <div className="doom-row doom-menu" role="group" aria-label="Menu keys">
          <HoldKey k="escape" label="Esc" detail="Menu (Escape)" className="small" press={press} disabled={!canPlay} />
          <HoldKey k="enter" label="Enter" detail="Enter" className="small" press={press} disabled={!canPlay} />
          <HoldKey k="yes" label="Y" detail="Yes" className="small" press={press} disabled={!canPlay} />
          <HoldKey k="no" label="N" detail="No" className="small" press={press} disabled={!canPlay} />
          <HoldKey k="map" label="Map" detail="Automap (Tab)" className="small" press={press} disabled={!canPlay} />
          <button type="button" className="ghost doom-quit" onClick={() => client.setGameMode(null)}>
            Quit DOOM
          </button>
        </div>
      </section>

      <section className="panel doom-view">
        <div className="doom-stage">
          <GateCanvas
            onTap={(angle) => {
              // "Face me": the bottom of the screen swings to this spoke.
              client.gameInput(0, [{ angle, radius: 1 }]);
            }}
          />
        </div>
        <div className="doom-row doom-align" role="group" aria-label="Align the screen">
          <button type="button" className="doom-key small" aria-label="Rotate counter-clockwise" onClick={() => rotate(-ALIGN_STEP)}>
            ↺
          </button>
          <button type="button" className="doom-key small" aria-label="Rotate clockwise" onClick={() => rotate(ALIGN_STEP)}>
            ↻
          </button>
          <button type="button" className="doom-key small" aria-label="Turn upside down" onClick={() => rotate(Math.PI)}>
            180°
          </button>
          <button
            type="button"
            className={`doom-key small doom-toggle ${doom?.mirror ? "on" : ""}`}
            aria-pressed={doom?.mirror ?? false}
            aria-label="Flip (mirror)"
            onClick={flip}
          >
            ⇋ Flip
          </button>
        </div>
        <p className="hint doom-face">
          Tap the ring where you are standing, or nudge it with the arrows ([ and ] on a
          keyboard), until the picture is upright for you. Flip (\) if it reads mirrored.
        </p>
      </section>
    </div>
  );
}
