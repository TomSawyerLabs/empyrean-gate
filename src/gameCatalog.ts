// The game roster and its player-facing copy, shared by the operator's Games
// tab and the public floor page (plans/game-mode.md, plans/public-floor.md).
// Kept apart from the components so the public bundle carries no operator UI.

import type { GameCommand, GameKind } from "./types";

/** A button for a game with more to it than "go there" (plans/classic-games.md).
 *  Every press is sent with the player's chosen color, so it moves *their*
 *  ship or cycle. Taps on the array always work too; buttons are extras. */
export type GameButton = {
  command: GameCommand;
  icon: string;
  label: string;
  /** `KeyboardEvent.key` values that press it, and how to say them. */
  keys: string[];
  keyHint: string;
};

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
  /** Fixed chips, when a game's colours are its own (Gathering's six orbs)
   * rather than evenly spaced hues counted by the knob. */
  chips?: { label: string; color: string }[];
  /** Chip colors in order when the game picks its own (Rimfire keeps its
   *  claws off the enemies' red, violet and green); the knob still says how
   *  many. Must match the backend's table for that game. */
  palette?: string[];
  /** Per-color buttons shown under the chips (see `GameButton`). */
  buttons?: GameButton[];
  /** No color chips at all: the taps are the whole game (Echo). */
  noChips?: boolean;
  /** Replaces the generic "pick a color, tap the array" join line. */
  join?: string;
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
    kind: "rimfire",
    name: "Rimfire",
    blurb:
      "Tempest, wrapped around the hole: the array is the tube seen end-on. " +
      "Flippers, tankers and spikers climb out of the hole along sixteen " +
      "lanes, and every color is a claw on the rim firing inward down its " +
      "lane. The AI holds the rim until someone picks up a color.",
    knob: { label: "Claws", min: 2, max: 6, start: 4 },
    // game::rimfire::CLAW_COLORS
    palette: ["#ffe326", "#26e5ff", "#ff8119", "#ff66c2", "#ffffff", "#599cff"],
    howTo:
      "You are a claw on the rim, and you fire down your lane by yourself. " +
      "Tap anywhere and your claw slides round to that lane. Red flippers " +
      "that reach the rim hop toward you to grab you — shoot them as they " +
      "land or get out of the way. A violet tanker splits in two when shot; " +
      "green spikes hide whatever climbs beneath them, so wear them down. " +
      "Superzap clears the whole board, once every 30 seconds.",
    buttons: [
      { command: "superzap", icon: "✷", label: "Superzap", keys: ["z", "Z"], keyHint: "clears the board · Z" },
    ],
  },
  {
    kind: "echo",
    name: "Echo",
    blurb:
      "Simon for the whole floor: the ring is cut into coloured wedges and " +
      "the Gate plays a pattern on the beat of the music, one wedge a beat. " +
      "Then everyone answers it together. Get it all and it grows by one; " +
      "miss and it starts over. With nobody playing it answers itself.",
    knob: { label: "Wedges", min: 3, max: 8, start: 4 },
    howTo:
      "Watch the wedges light up on the beat — that's the pattern. When the " +
      "middle glows white it's the floor's turn: tap the wedges back in the " +
      "same order, right on the array. Everyone answers together, and a right " +
      "tap from anyone counts, so if you remember, tap. Every round adds one " +
      "more wedge.",
    noChips: true,
    join: "No colors to pick: when the middle glows white, tap the wedges back in order. Anyone who remembers saves the round.",
  },
  {
    kind: "spacewar",
    name: "Spacewar",
    blurb:
      "The first video game (1962), around a real star: the hole's gravity " +
      "bends every ship and torpedo, so orbits are the way to travel and the " +
      "best shots curve round the star. Fly off the rim and you come back in " +
      "on the far side. Every color is a ship, AI-flown until someone takes it.",
    knob: { label: "Ships", min: 2, max: 8, start: 4 },
    howTo:
      "Your color is a ship in orbit round the star in the middle. Tap where " +
      "you want to go and it swings its nose that way and burns — gravity " +
      "does the rest, so small taps steer an orbit. Fire looses a torpedo " +
      "along your nose (they curve too). Hyperspace jumps you somewhere " +
      "random when it's tight — but now and then it doesn't come back. " +
      "Touch the star and you're done.",
    buttons: [
      { command: "fire", icon: "✦", label: "Fire", keys: [" ", "f", "F"], keyHint: "a torpedo · Space" },
      { command: "hyperspace", icon: "⟡", label: "Hyperspace", keys: ["h", "H"], keyHint: "jump, risky · H" },
    ],
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
  {
    kind: "gathering",
    name: "Gathering",
    hidden: true,
    perk: "game:gathering",
    blurb:
      "Entheos's own: the six orbs of the camp mark wait near the rim, the " +
      "star between them dark, and lost sparks wander the playa. A tap is a " +
      "call in your orb's colour — every spark it reaches takes the colour " +
      "and heads home. Fill an orb and its blade lights; light all six and " +
      "the sigil is whole, then everyone is born again out of the fire.",
    knob: { label: "Sparks", min: 2, max: 8, start: 5 },
    howTo:
      "Pick an orb. Tap out on the playa and your call spreads from your " +
      "finger: lost sparks it reaches take your colour and set off for your " +
      "orb; tap near them again to hurry them home. Nobody is ever taken " +
      "from another orb — so call for the empty ones too. Fill all six and " +
      "the star lights, and the whole gathering is reborn.",
    chips: [
      { label: "Orange orb", color: "#ff9a2e" },
      { label: "Yellow orb", color: "#ffe03a" },
      { label: "Green orb", color: "#3fd47a" },
      { label: "Blue orb", color: "#5f89ee" },
      { label: "Violet orb", color: "#9a5fd6" },
      { label: "Red orb", color: "#ff4a4f" },
    ],
  },
];

/** How many colour chips a running game shows, and what each one looks like:
 *  a game's own fixed colours when it has them, else the knob's evenly spaced
 *  hues. */
export function chipCount(game: (typeof GAMES)[number] | undefined, species: number): number {
  return game?.chips ? game.chips.length : species;
}

export function chipColor(game: (typeof GAMES)[number] | undefined, s: number, species: number): string {
  return game?.chips?.[s]?.color ?? game?.palette?.[s] ?? speciesColor(s, species);
}

export function chipLabel(game: (typeof GAMES)[number] | undefined, s: number): string {
  return game?.chips?.[s]?.label ?? `Color ${s + 1}`;
}

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
