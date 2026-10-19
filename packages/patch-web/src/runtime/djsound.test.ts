import { describe, expect, test } from "bun:test";
import { CRATE, trackLayout, type SimTrack } from "./djlink";
import { notesAt, upcomingSteps } from "./djsound";

const TRACK: SimTrack = {
  title: "t",
  artist: "a",
  mood: "high",
  root: 45,
  phrases: [
    { kind: "intro", beats: 8 },
    { kind: "up", beats: 8, fill: 2 },
    { kind: "chorus", beats: 8 },
    { kind: "down", beats: 8 },
  ],
};
// Steps are sixteenths from the start: beat b starts at step (b - 1) * 4.
const at = (beat: number, sixteenth = 0) => notesAt(TRACK, (beat - 1) * 4 + sixteenth);
const voices = (beat: number, sixteenth = 0) => at(beat, sixteenth).map((n) => n.voice);

describe("what a track plays", () => {
  test("a chorus: four on the floor, claps on 2 and 4, a crash as it lands", () => {
    expect(voices(17)).toEqual(expect.arrayContaining(["kick", "crash"]));
    expect(voices(18)).toContain("clap");
    expect(voices(19)).not.toContain("clap");
    expect(voices(17, 2)).toEqual(expect.arrayContaining(["hat", "bass"]));
  });

  test("a breakdown drops the kick and the bass for pads", () => {
    for (let b = 25; b <= 32; b++) {
      for (let s = 0; s < 4; s++) {
        expect(voices(b, s)).not.toContain("kick");
        expect(voices(b, s)).not.toContain("bass");
      }
    }
    expect(voices(25)).toContain("pad");
  });

  test("a build rises, and its fill-in is a snare roll that climbs", () => {
    const swell = (b: number) => at(b).find((n) => n.voice === "swell")!;
    expect(swell(12).v).toBeGreaterThan(swell(9).v);
    // Beats 15 and 16 are the fill: no kick, a snare on every sixteenth.
    const roll = [15, 16].flatMap((b) => [0, 1, 2, 3].map((s) => at(b, s).find((n) => n.voice === "snare")!));
    expect(roll.every(Boolean)).toBe(true);
    expect(roll.at(-1)!.v).toBeGreaterThan(roll[0]!.v);
    expect(voices(15)).not.toContain("kick");
  });

  test("past the end there is nothing", () => {
    expect(notesAt(TRACK, 32 * 4)).toEqual([]);
  });

  test("every crate track has a key and sounds on its first beat", () => {
    for (const t of CRATE) {
      expect(t.root).toBeGreaterThan(30);
      expect(notesAt(t, 0).length).toBeGreaterThan(0);
    }
  });
});

describe("the steps ahead of a deck", () => {
  const deck = { position: 10.1, loopRange: null, looping: false, beats: trackLayout(TRACK).beats };

  test("one sixteenth after another from the playhead", () => {
    const s = upcomingSteps(deck, 1);
    expect(s.map(([step]) => step)).toEqual([41, 42, 43, 44]);
    expect(s[0]![1]).toBeCloseTo(0.15);
    expect(s[3]![1]).toBeCloseTo(0.9);
  });

  test("a loop wraps the way the deck will", () => {
    const s = upcomingSteps({ ...deck, position: 11.9, loopRange: [8, 12], looping: true }, 0.5);
    expect(s.map(([step]) => step)).toEqual([32, 33]);
    expect(s[0]![1]).toBeCloseTo(0.1);
    expect(s[1]![1]).toBeCloseTo(0.35);
  });

  test("a loop that is set but not playing does not wrap", () => {
    const s = upcomingSteps({ ...deck, position: 11.9, loopRange: [8, 12], looping: false }, 0.5);
    expect(s.map(([step]) => step)).toEqual([48, 49]);
  });

  test("nothing past the end of the track", () => {
    expect(upcomingSteps({ ...deck, position: 31.8 }, 2)).toEqual([]);
  });
});
