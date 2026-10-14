// The button row for games with more to them than "go there"
// (plans/classic-games.md): fire, turn, hyperspace, superzap. Shared by the
// operator's Games tab and the public floor. Each press goes out with the
// player's color, so it is their ship that fires and their cycle that turns.

import { useEffect, useRef } from "react";
import type { GameButton } from "./gameCatalog";
import type { GameCommand } from "./types";

export default function GameButtons({
  buttons,
  color,
  onCommand,
  keyboard = false,
}: {
  buttons: GameButton[];
  /** The player's chip color, so the row says whose controls these are. */
  color: string;
  onCommand: (command: GameCommand) => void;
  /** Also bind each button's keys on the window (a laptop playing along). */
  keyboard?: boolean;
}) {
  const send = useRef(onCommand);
  send.current = onCommand;

  useEffect(() => {
    if (!keyboard) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      // Space/Enter on a focused button already clicks it.
      if (target?.matches("button") && (event.key === " " || event.key === "Enter")) return;
      const button = buttons.find((b) => b.keys.includes(event.key));
      if (!button) return;
      event.preventDefault();
      send.current(button.command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [buttons, keyboard]);

  return (
    <div className="game-buttons" role="group" aria-label="Game controls" style={{ ["--chip" as string]: color }}>
      {buttons.map((b) => (
        <button
          key={b.command}
          className="ghost"
          aria-label={b.label}
          // Fire on touch-down, not release: in a fast game the release is
          // too late. A keyboard "click" (detail 0) still works.
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            onCommand(b.command);
          }}
          onClick={(e) => {
            if (e.detail === 0) onCommand(b.command);
          }}
        >
          <span className="game-button-icon" aria-hidden="true">{b.icon}</span>
          <span>
            <strong>{b.label}</strong>
            <small>{b.keyHint}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
