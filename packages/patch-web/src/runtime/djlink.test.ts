import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPatchCore, type PatchCore } from "./core";
import {
  CRATE,
  DJ_EVENTS,
  DJ_SCALARS,
  DjLinkSim,
  phraseAt,
  SET_BPM,
  trackLayout,
  trackSound,
  type DjEvent,
  type DjScalar,
  type SimTrack,
} from "./djlink";

// The real patch core (run `bun run build:wasm` first), for the registry.
let core: PatchCore;
beforeAll(async () => {
  core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "..", "wasm", "patch_bg.wasm")));
});

const FRAME = 1 / 60;
const BEAT = 60 / SET_BPM;

/** Step `sim` for `seconds`, collecting the events by name. */
function run(sim: DjLinkSim, seconds: number) {
  const events: { event: DjEvent; player: number; t: number }[] = [];
  for (let n = Math.round(seconds / FRAME); n > 0; n--) {
    for (const [i, player] of sim.step(FRAME)) events.push({ event: DJ_EVENTS[i]!, player, t: sim.time });
  }
  return events;
}

const out = (sim: DjLinkSim, name: DjScalar) => sim.scalars()[DJ_SCALARS.indexOf(name)]!;
const names = (events: { event: DjEvent }[]) => events.map((e) => e.event);

/** A sim with Auto off and nothing moving, deck 1 on air with track 0. */
function manual() {
  const sim = new DjLinkSim();
  sim.act(1, { action: "play" }); // pause the opening track
  run(sim, 0.1);
  return sim;
}

describe("the dj_link node", () => {
  test("scalars and events are in the registry's output order", () => {
    const node = core.registry.find((n) => n.id === "dj_link")!;
    expect(node).toBeDefined();
    const scalars = node.outputs.filter((o) => o.shape === "scalar").map((o) => o.name);
    const events = node.outputs.filter((o) => o.shape === "event").map((o) => o.name);
    expect(scalars).toEqual([...DJ_SCALARS]);
    expect(events).toEqual([...DJ_EVENTS]);
  });
});

describe("the crate", () => {
  test("every track has an outro to mix out of and moves inside the track", () => {
    for (const t of CRATE) {
      const l = trackLayout(t);
      expect(l.phrases.at(-1)!.kind).toBe("outro");
      expect(l.mixAt).toBe(l.phrases.at(-1)!.start);
      for (const m of t.moves ?? []) {
        expect(m.at).toBeGreaterThan(32);
        expect(m.at).toBeLessThan(l.mixAt);
        if (m.jumpTo !== undefined) expect(Math.abs(m.jumpTo - m.at)).toBeGreaterThan(8);
      }
    }
  });

  test("phrases follow rekordbox: beats from 1, progress, the fill-in at the end", () => {
    const t: SimTrack = { title: "t", artist: "a", mood: "high", phrases: [{ kind: "intro", beats: 16 }, { kind: "up", beats: 16, fill: 4 }] };
    const l = trackLayout(t);
    expect(l.phrases.map((p) => [p.start, p.end, p.fillFrom])).toEqual([
      [1, 16, null],
      [17, 32, 29],
    ]);
    expect(phraseAt(l, 0, 0)).toBeNull();
    expect(phraseAt(l, 1, 0)!.progress).toBe(0);
    expect(phraseAt(l, 24, 0.5)!.progress).toBeCloseTo(7.5 / 16);
    expect(phraseAt(l, 28, 0.9)!.fill).toBe(false);
    expect(phraseAt(l, 29, 0)!.fill).toBe(true);
  });

  test("a breakdown has no kick: the bass and the onsets drop", () => {
    const l = trackLayout(CRATE[0]!);
    const mean = (from: number, to: number, f: (s: ReturnType<typeof trackSound>) => number) => {
      let sum = 0;
      let n = 0;
      for (let pos = from - 1; pos < to; pos += 0.05, n++) sum += f(trackSound(l, pos, pos * BEAT));
      return sum / n;
    };
    const chorus = l.phrases.find((p) => p.kind === "chorus")!;
    const down = l.phrases.find((p) => p.kind === "down")!;
    expect(mean(chorus.start, chorus.end, (s) => s.bass)).toBeGreaterThan(2 * mean(down.start, down.end, (s) => s.bass));
    expect(mean(chorus.start, chorus.end, (s) => s.onset)).toBeGreaterThan(3 * mean(down.start, down.end, (s) => s.onset));
    expect(mean(chorus.start, chorus.end, (s) => s.level)).toBeGreaterThan(mean(down.start, down.end, (s) => s.level));
  });
});

describe("the gate's reading of the decks (rhythm.rs)", () => {
  test("the set opens on air: active, deck 1 followed, the mix settled on it", () => {
    const sim = new DjLinkSim();
    run(sim, 1);
    expect(out(sim, "active")).toBe(1);
    expect(out(sim, "deck")).toBe(1);
    expect(out(sim, "deck_side")).toBe(-1);
    expect(out(sim, "playing")).toBe(1);
    expect(out(sim, "on_air")).toBe(1);
    expect(out(sim, "deck_1_on_air")).toBe(1);
    expect(out(sim, "deck_2_on_air")).toBe(0);
    expect(out(sim, "mix")).toBe(0);
    expect(out(sim, "phrase_active")).toBe(1);
    expect(out(sim, "phrase_kind")).toBe(1);
    expect(out(sim, "beat_in_bar")).toBeGreaterThanOrEqual(1);
    expect(out(sim, "energy")).toBeGreaterThan(0);
  });

  test("beat_in_bar counts 1..4 on the beat grid", () => {
    const sim = new DjLinkSim();
    const seen: number[] = [];
    for (let n = 0; n < 8; n++) {
      run(sim, BEAT);
      seen.push(out(sim, "beat_in_bar"));
    }
    expect(seen).toEqual([2, 3, 4, 1, 2, 3, 4, 1]);
  });

  test("Play from the cue point fires play and cue_release", () => {
    const sim = manual();
    sim.act(2, { action: "fader", value: 1 });
    run(sim, 0.1);
    sim.act(2, { action: "play" });
    expect(names(run(sim, 0.1))).toEqual(["play", "cue_release"]);
    expect(out(sim, "event_deck")).toBe(2);
    expect(out(sim, "event_side")).toBe(1);
  });

  test("holding CUE at the cue point is cue-play: play and cue; letting go fires nothing", () => {
    const sim = manual();
    sim.act(2, { action: "cue" });
    expect(names(run(sim, 0.5))).toEqual(["play", "cue"]);
    expect(sim.state().decks[1].mode).toBe("cuePlaying");
    sim.act(2, { action: "cue_release" });
    expect(names(run(sim, 0.1))).toEqual([]);
    expect(sim.state().decks[1].mode).toBe("cued");
    expect(sim.state().decks[1].beat).toBe(1);
  });

  test("CUE while playing goes back to the cue point: cue", () => {
    const sim = manual();
    sim.act(1, { action: "play" });
    run(sim, 2);
    sim.act(1, { action: "cue" });
    expect(names(run(sim, 0.1))).toEqual(["cue"]);
    expect(out(sim, "playing")).toBe(0);
  });

  test("a loop: loop_start, a wrap each lap, loop_end; a 4-beat loop wraps once a lap", () => {
    const sim = manual();
    sim.act(1, { action: "play" });
    run(sim, 0.3);
    sim.act(1, { action: "loop", beats: 4 });
    const during = run(sim, 4 * BEAT * 3 + 0.2);
    expect(names(during).filter((e) => e !== "phrase_change")).toEqual(["loop_start", "loop_wrap", "loop_wrap", "loop_wrap"]);
    expect(out(sim, "looping")).toBe(1);
    sim.act(1, { action: "exit_loop" });
    expect(names(run(sim, 0.1))).toEqual(["loop_end"]);
    expect(out(sim, "looping")).toBe(0);
  });

  test("an 8-beat loop also wraps on its mid-loop downbeat (the beat packets' rule)", () => {
    const sim = manual();
    sim.act(1, { action: "play" });
    run(sim, 0.3);
    sim.act(1, { action: "loop", beats: 8 });
    const wraps = run(sim, 8 * BEAT * 2 + 0.2).filter((e) => e.event === "loop_wrap");
    // Two laps: the first lap's bar-2 downbeat, the wrap, the second lap's
    // downbeat, the wrap.
    expect(wraps.length).toBe(4);
  });

  test("hot cues and beat jumps: jump, only when the beat counter breaks", () => {
    const sim = manual();
    sim.act(1, { action: "play" });
    run(sim, 20 * BEAT);
    sim.act(1, { action: "hot_cue", beat: 5 });
    expect(names(run(sim, 0.1))).toContain("jump");
    sim.act(1, { action: "beat_jump", beats: 16 });
    expect(names(run(sim, 0.1))).toContain("jump");
    // Eight beats forward is within the counter's tolerance.
    sim.act(1, { action: "beat_jump", beats: 8 });
    expect(names(run(sim, 0.1))).not.toContain("jump");
  });

  test("the mix follows the on-air flags only: 0, 0.5, 1, eased over about a second", () => {
    const sim = manual();
    sim.act(2, { action: "fader", value: 1 });
    expect(names(run(sim, 0.05))).toEqual(["on_air_event"]);
    expect(out(sim, "deck_2_on_air")).toBe(1);
    expect(out(sim, "mix")).toBeLessThan(0.1);
    expect(out(sim, "mix_activity")).toBeGreaterThan(0);
    // An exponential ease with the engine's 0.9 s constant.
    run(sim, 6);
    expect(out(sim, "mix")).toBeCloseTo(0.5, 2);
    // Activity decays once the mix stops moving.
    expect(out(sim, "mix_activity")).toBeLessThan(0.05);
    sim.act(1, { action: "fader", value: 0 });
    expect(names(run(sim, 6))).toEqual(["off_air_event"]);
    expect(out(sim, "mix")).toBeCloseTo(1, 2);
  });

  test("the crossfader cuts a side off air", () => {
    const sim = manual();
    sim.act(2, { action: "fader", value: 1 });
    run(sim, 0.1);
    sim.setCrossfader(0);
    run(sim, 0.1);
    expect(out(sim, "deck_1_on_air")).toBe(1);
    expect(out(sim, "deck_2_on_air")).toBe(0);
    sim.setCrossfader(1);
    run(sim, 0.1);
    expect(out(sim, "deck_1_on_air")).toBe(0);
    expect(out(sim, "deck_2_on_air")).toBe(1);
  });

  test("a new master is a phrase change: the gate follows the other deck's phrase", () => {
    const sim = manual();
    sim.act(2, { action: "master" });
    const events = run(sim, 0.1);
    expect(events).toEqual([expect.objectContaining({ event: "phrase_change", player: 2 })]);
    expect(out(sim, "deck")).toBe(2);
    expect(out(sim, "playing")).toBe(0);
    expect(out(sim, "on_air")).toBe(0);
  });

  test("energy is the followed deck's while it plays, and 0 when nothing does", () => {
    const sim = manual();
    expect(out(sim, "energy")).toBe(0);
    sim.act(1, { action: "play" });
    run(sim, 1);
    expect(out(sim, "energy")).toBeGreaterThan(0.3);
  });

  test("unplugged: active 0, no events, the mix held; the music plays on", () => {
    const sim = new DjLinkSim();
    run(sim, 2);
    sim.connected = false;
    expect(run(sim, 60)).toEqual([]);
    for (const name of DJ_SCALARS) {
      if (name === "mix") expect(out(sim, name)).toBe(0);
      else if (name === "event_deck" || name === "event_side") continue; // the last event's, held
      else expect(out(sim, name)).toBe(0);
    }
    expect(sim.audio()[0]).toBeGreaterThan(0);
    sim.connected = true;
    run(sim, 0.1);
    expect(out(sim, "active")).toBe(1);
  });
});

describe("the Auto DJ", () => {
  test("one pass through the crate fires every event the node has", () => {
    const sim = new DjLinkSim();
    const fired = new Set(names(run(sim, 8 * 60)));
    expect([...DJ_EVENTS].filter((e) => !fired.has(e))).toEqual([]);
  });

  test("it mixes on the outro: the next track starts as the outro begins, phrase-aligned", () => {
    const sim = new DjLinkSim();
    const l = trackLayout(CRATE[0]!);
    const events = run(sim, 120);
    const start = events.find((e) => e.event === "play" && e.player === 2)!;
    expect(start).toBeDefined();
    // The move's loop added three laps of four beats.
    expect(start.t).toBeCloseTo((l.mixAt - 1 + 12) * BEAT, 1);
    // Then in on air, the master handed over, the old deck out.
    const after = events.filter((e) => e.t >= start.t).map((e) => `${e.event}:${e.player}`);
    const order = ["on_air_event:2", "phrase_change:2", "off_air_event:1"].map((e) => after.indexOf(e));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sim.state().followed).toBe(2);
  });

  test("it always has music: across the whole crate, something plays on air", () => {
    const sim = new DjLinkSim();
    for (let n = 0; n < 9 * 60 * 4; n++) {
      run(sim, 0.25);
      expect(sim.audio()[0]).toBeGreaterThan(0);
      expect(out(sim, "on_air") + out(sim, "deck_1_on_air") + out(sim, "deck_2_on_air")).toBeGreaterThan(0);
    }
  });

  test("it is deterministic, and reset(at) is the set at that time", () => {
    const a = new DjLinkSim();
    const b = new DjLinkSim();
    run(a, 95);
    run(b, 95);
    expect([...a.scalars()]).toEqual([...b.scalars()]);
    expect([...a.audio()]).toEqual([...b.audio()]);
    const c = new DjLinkSim();
    c.reset(95);
    expect(c.time).toBeCloseTo(95, 6);
    expect(c.state().decks.map((d) => [d.track, d.beat, d.mode])).toEqual(a.state().decks.map((d) => [d.track, d.beat, d.mode]));
    expect(Object.values(c.state().lastFired).every((v) => v === null)).toBe(true);
  });

  test("a hand on the decks turns it off, and it takes over again from there", () => {
    const sim = new DjLinkSim();
    run(sim, 10);
    sim.act(1, { action: "play" }); // stop the music
    expect(sim.auto).toBe(false);
    run(sim, 2);
    expect(out(sim, "playing")).toBe(0);
    sim.auto = true;
    run(sim, 0.5);
    expect(out(sim, "playing")).toBe(1);
    expect(sim.audio()[0]).toBeGreaterThan(0);
  });

  test("reset keeps the switches", () => {
    const sim = new DjLinkSim();
    sim.connected = false;
    sim.auto = false;
    sim.reset(30);
    expect(sim.connected).toBe(false);
    expect(sim.auto).toBe(false);
    expect(out(sim, "active")).toBe(0);
  });
});
