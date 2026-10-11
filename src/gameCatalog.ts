// The game roster and its player-facing copy, shared by the operator's Games
// tab and the public floor page (plans/game-mode.md, plans/public-floor.md).
// Kept apart from the components so the public bundle carries no operator UI.

import type { GameCommand, GameKind } from "./types";

export const GAMES: {
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
  /** A hidden game (plans/hidden-modes.md): the public floor offers it only
   * to a session holding `perk`, which may then start and stop it; the
   * operator's Games tab lists it under Hidden. */
  hidden?: boolean;
  perk?: string;
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
  {
    kind: "perimeter",
    name: "Perimeter",
    hidden: true,
    perk: "game:perimeter",
    blurb:
      "Gate, Perimeter & Exodus's own: the city is a rainbow party inside the " +
      "orange trash fence, and headlamps keep dashing in from the dark to hop " +
      "it. Each player drives a perimeter truck; the AI drives the rest. Gate " +
      "Road carries ticketed traffic in through one corner and a plane lands " +
      "at the airport now and then. More drivers, more sneakers.",
    knob: { label: "Trucks", min: 2, max: 8, start: 5 },
    howTo:
      "You drive a perimeter truck in your color. Tap anywhere on the playa " +
      "and it heads there — run down the headlamps dashing in from the dark " +
      "before they hop the fence into the party. Every catch flashes your " +
      "color and sends them round to buy a ticket. Cars on Gate Road and the " +
      "plane are legit: leave them be. The more of you driving, the more " +
      "try their luck.",
  },
];

/** The games the operator's tab lists openly, and the ones it keeps under
 *  Hidden for key holders. */
export const OPEN_GAMES = GAMES.filter((g) => !g.hidden);
export const HIDDEN_GAMES = GAMES.filter((g) => g.hidden);

export const RINGFALL_COMMANDS: Array<{
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

export const GAP_FILLERS = [
  { label: "Dot", cells: [0] },
  { label: "Domino", cells: [0, 1] },
  { label: "Bar 3", cells: [0, 1, 2] },
  { label: "Corner 3", cells: [0, 1, 4] },
];

/** Life's erase input — matches `game::life::ERASE` on the backend. */
export const ERASE_SPECIES = 0xff;

/// Approximate chip colors for the species picker. The backend rotates the
/// palette slowly over minutes so no species permanently owns a hue; the chips
/// stay at the base hue — close enough to say "I'm the green-ish one".
export function speciesColor(s: number, count: number): string {
  return `hsl(${Math.round((s / count) * 360)} 85% 55%)`;
}
