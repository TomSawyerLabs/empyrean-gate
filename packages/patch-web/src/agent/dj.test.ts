import { describe, expect, test } from "bun:test";
import { DjLinkSim } from "../runtime/djlink";
import { djTool } from "./dj";

function setup() {
  const host = { dj: new DjLinkSim(), settings: { startAt: 0 } };
  const tool = djTool(host);
  const call = async (input: Record<string, unknown> = {}) => {
    const r = await tool.execute(input);
    return JSON.parse((r.content[0] as { text: string }).text) as Record<string, any>;
  };
  return { host, tool, call };
}

describe("dj_deck", () => {
  test("with no input it reports the decks and the outputs", async () => {
    const { call } = setup();
    const s = await call();
    expect(s.connected).toBe(true);
    expect(s.auto).toBe(true);
    expect(s.decks).toHaveLength(2);
    expect(s.decks[0].track).toContain("Ember Theory");
    expect(s.decks[0].mode).toBe("playing");
    expect(s.decks[1].mode).toBe("cued");
    expect(s.dj_link_outputs.active).toBe(1);
    expect(Object.keys(s.dj_link_outputs)).toHaveLength(18);
  });

  test("start_at moves the set and is where a restart begins", async () => {
    const { host, call } = setup();
    const s = await call({ start_at: 80 });
    expect(host.settings.startAt).toBe(80);
    expect(s.time).toBeCloseTo(80, 1);
    // 80 s in, the second track is coming in on deck 2.
    expect(s.decks[1].mode).toBe("playing");
  });

  test("a deck action works the deck and turns Auto off", async () => {
    const { host, call } = setup();
    const s = await call({ deck: 2, action: "load", track: 3 });
    expect(s.auto).toBe(false);
    expect(s.decks[1].track).toContain("Night Market");
    await call({ deck: 2, action: "cue" });
    expect(host.dj.state().decks[1].mode).toBe("cuePlaying");
    await call({ deck: 1, action: "fader", value: 0, crossfader: 1 });
    expect(host.dj.state().decks[0].fader).toBe(0);
    expect(host.dj.state().crossfader).toBe(1);
  });

  test("unplugging the LINK shows on the next frame", async () => {
    const { host, call } = setup();
    await call({ connected: false });
    host.dj.step(1 / 60);
    const s = await call();
    expect(s.connected).toBe(false);
    expect(s.dj_link_outputs.active).toBe(0);
    expect(s.followed).toBe(0);
  });

  test("it says what is missing", async () => {
    const { call } = setup();
    await expect(call({ action: "play" })).rejects.toThrow("deck");
    await expect(call({ deck: 1, action: "loop" })).rejects.toThrow("beats");
    await expect(call({ deck: 1, action: "load", track: 99 })).rejects.toThrow("no track");
    await expect(call({ deck: 1, action: "scratch" })).rejects.toThrow("no action");
  });
});
