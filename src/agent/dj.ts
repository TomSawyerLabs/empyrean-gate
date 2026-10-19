// The simulated DJ set as an agent tool: read the decks and what the
// `dj_link` node gives the patch, and work them (unplug the LINK, take over
// from the Auto DJ, start the set somewhere else), so an agent can check a
// DJ-driven patch the way a person checks it with the playground's decks.

import { DJ_EVENTS, DJ_SCALARS, type DeckAction, type DjLinkSim, type DjLinkState } from "../runtime/djlink";
import type { AgentTool, ToolResult } from "./tools";

/** What the tool needs from a host that runs the set (`attachGroove`'s
 * return is one). */
export interface DjHost {
  dj: DjLinkSim;
  /** Where `restart` starts the set, in seconds. */
  settings: { startAt: number };
}

const ACTIONS = ["play", "cue", "cue_release", "loop", "exit_loop", "beat_jump", "hot_cue", "load", "fader", "master"] as const;

const round = (v: number, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

/** The set in brief, for an agent to read. */
export function describeDj(state: DjLinkState, startAt = 0): Record<string, unknown> {
  const recent: Record<string, string> = {};
  for (const e of DJ_EVENTS) {
    const f = state.lastFired[e];
    if (f && state.time - f.at < 30) recent[e] = `${round(state.time - f.at, 1)} s ago, deck ${f.player}`;
  }
  const outputs: Record<string, number> = {};
  for (const name of DJ_SCALARS) outputs[name] = round(state.outputs[name]);
  return {
    connected: state.connected,
    auto: state.auto,
    time: round(state.time, 2),
    start_at: startAt,
    bpm: state.bpm,
    crossfader: round(state.crossfader, 2),
    followed: state.followed,
    decks: state.decks.map((d) => ({
      deck: d.player,
      track: d.track === null ? null : `#${d.track} ${d.title} — ${d.artist}`,
      mode: d.mode,
      beat: d.track === null ? null : `${d.beat} of ${d.beats} (bar beat ${d.beatInBar})`,
      phrase: d.phrase
        ? `${d.phrase.kind} (phrase ${d.phrase.number}), ${Math.round(d.phrase.progress * 100)}%${d.phrase.fill ? ", fill-in" : ""}`
        : null,
      loop: d.loopBeats === null ? null : `${d.loopBeats} beats${d.looping ? "" : " (set, not playing)"}`,
      fader: round(d.fader, 2),
      on_air: d.onAir,
      master: d.master,
    })),
    dj_link_outputs: outputs,
    recent_events: recent,
  };
}

/** The `dj_deck` tool over a host's set. */
export function djTool(host: DjHost): AgentTool {
  const { dj } = host;
  const crate = dj.crate.map((t, i) => `#${i} ${t.title} (${t.mood})`).join(", ");
  return {
    name: "dj_deck",
    title: "Work the DJ decks",
    description:
      "The simulated PRO DJ LINK set that drives `dj_link` nodes here (on the gate it is the DJ's real CDJs): two " +
      "decks and a mixer at " +
      `${dj.bpm} BPM, an Auto DJ playing a crate (${crate}) with phrases, fill-ins, loops, hot-cue jumps and mixes, ` +
      "and the room's sound following it (the audio source 0 groove). With no input it reports the decks and the " +
      "node's outputs now. connected false unplugs the LINK (every output reads as on a gate without CDJs: test a " +
      "patch's `active` fallback). auto turns the Auto DJ on or off. start_at (seconds) starts the set there now " +
      "and on every snapshot restart, so captures repeat (a mix starts about 77 s in). deck (1 or 2) with action " +
      "works a deck like a CDJ, and turns Auto off: play (toggles), cue / cue_release (the CUE button held and let " +
      "go: back to the cue point while playing, cue-play while held there), loop { beats }, exit_loop, beat_jump " +
      "{ beats }, hot_cue { beat }, load { track }, fader { value 0..1 }, master. crossfader 0..1 (0 = deck 1). " +
      "Events fire as on the gate: e.g. cue-play fires play and cue, play from the cue point fires play and " +
      "cue_release. The decks change at once; dj_link_outputs and recent_events catch up on the next frame, so " +
      "snapshot (no restart) after an action to see the patch respond.",
    inputSchema: {
      type: "object",
      properties: {
        connected: { type: "boolean" },
        auto: { type: "boolean" },
        start_at: { type: "number", minimum: 0, maximum: 3600 },
        deck: { enum: [1, 2] },
        action: { enum: [...ACTIONS] },
        beats: { type: "number" },
        beat: { type: "integer", minimum: 1 },
        track: { type: "integer", minimum: 0, maximum: dj.crate.length - 1 },
        value: { type: "number", minimum: 0, maximum: 1 },
        crossfader: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    async execute(i): Promise<ToolResult> {
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      const startAt = num(i.start_at);
      if (startAt !== undefined) {
        host.settings.startAt = Math.min(3600, Math.max(0, startAt));
        dj.reset(host.settings.startAt);
      }
      if (typeof i.connected === "boolean") dj.connected = i.connected;
      if (typeof i.auto === "boolean") dj.auto = i.auto;
      if (i.action !== undefined) {
        const deck = i.deck === 1 || i.deck === 2 ? i.deck : null;
        if (!deck) throw new Error("action needs deck: 1 or 2.");
        const action = String(i.action) as (typeof ACTIONS)[number];
        if (!ACTIONS.includes(action)) throw new Error(`no action "${action}" (actions: ${ACTIONS.join(", ")})`);
        const need = (name: string, v: number | undefined) => {
          if (v === undefined) throw new Error(`${action} needs ${name}.`);
          return v;
        };
        let a: DeckAction;
        switch (action) {
          case "loop":
            a = { action, beats: need("beats", num(i.beats)) };
            break;
          case "beat_jump":
            a = { action, beats: need("beats", num(i.beats)) };
            break;
          case "hot_cue":
            a = { action, beat: need("beat", num(i.beat)) };
            break;
          case "load": {
            const track = need("track", num(i.track));
            if (track < 0 || track >= dj.crate.length) throw new Error(`no track #${track} (the crate is #0–#${dj.crate.length - 1}).`);
            a = { action, track };
            break;
          }
          case "fader":
            a = { action, value: need("value", num(i.value)) };
            break;
          default:
            a = { action };
        }
        dj.act(deck, a);
      }
      const x = num(i.crossfader);
      if (x !== undefined) dj.setCrossfader(x);
      // The decks change now; the gate reads them (outputs, events) on the
      // runtime's next frame, which is what fires the events into the patch.
      return {
        content: [{ type: "text", text: JSON.stringify(describeDj(dj.state(), host.settings.startAt), null, 2) }],
      };
    },
  };
}
