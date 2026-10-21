// The Patch tab's frame by frame on the gate (plans/frame-step.md): freezing
// holds the patch's thumbnails and meters while batches keep arriving (the
// show runs on), and with Keep past frames the kept batches can be stepped
// through. A fake client stands in for the WebSocket.

import { describe, expect, test } from "bun:test";
import { MiniHub } from "./miniPreview";
import type { MiniBatch } from "./types";
import type { GateClient } from "./ws";

// The hub asks the window how wide it is (a phone subscribes at half rate).
(globalThis as { window?: unknown }).window ??= { innerWidth: 1400 };

function fakeClient() {
  let onBatch: ((b: MiniBatch) => void) | null = null;
  let onMsg: ((m: unknown) => void) | null = null;
  const client = {
    subscribeMiniPreviews() {},
    unsubscribeMiniPreviews() {},
    onStatus: () => () => {},
    onMessage(l: (m: unknown) => void) {
      onMsg = l;
      return () => (onMsg = null);
    },
    onMiniBatch(l: (b: MiniBatch) => void) {
      onBatch = l;
      return () => (onBatch = null);
    },
  } as unknown as GateClient;
  let n = 0;
  return {
    client,
    meta() {
      onMsg?.({ type: "mini_preview_meta", spokes: 2, pixels: 1, patch_nodes: ["bow"], patch_scalars: [{ node: "lfo", port: "out" }] });
    },
    /** A patch batch whose cell and meter both say `v`. */
    send(v: number) {
      onBatch?.({ batch: ++n, kind: 1, spokes: 2, pixels: 1, cells: [{ id: 0, rgb: new Uint8Array([v, v, v, v, v, v]) }], scalars: [{ id: 0, value: v }] });
    },
    layer(v: number) {
      onBatch?.({ batch: ++n, kind: 0, spokes: 2, pixels: 1, cells: [{ id: 0, rgb: new Uint8Array([v, v, v, v, v, v]) }], scalars: [] });
    },
  };
}

const cell = (hub: MiniHub, key = "node:bow") => hub.cells.get(key)?.[0];
const meter = (hub: MiniHub) => hub.scalars.get("scalar:lfo:out")?.latest;

describe("the gate's frame by frame", () => {
  test("freezing holds the patch's views, and play shows the newest", () => {
    const gate = fakeClient();
    const hub = new MiniHub(gate.client);
    hub.retain();
    gate.meta();
    gate.send(1);
    gate.send(2);
    hub.pause();
    gate.send(3);
    gate.send(4);
    expect(cell(hub)).toBe(2);
    expect(meter(hub)).toBe(2);
    expect(hub.state().paused).toBe(true);
    // Layer thumbnails (the Live tab's) are not the patch editor's to freeze.
    gate.layer(9);
    expect(cell(hub, "layer:0")).toBe(9);
    hub.play();
    gate.send(5);
    expect(cell(hub)).toBe(5);
    expect(hub.canStep).toBe(false);
  });

  test("without Keep past frames there is nothing to step back to", () => {
    const gate = fakeClient();
    const hub = new MiniHub(gate.client);
    hub.retain();
    gate.meta();
    for (let v = 1; v <= 5; v++) gate.send(v);
    hub.stepFrames(-2);
    expect(hub.state().kept).toBe(0);
    expect(cell(hub)).toBe(5);
  });

  test("kept batches step back and forward, the meters ending where they were", async () => {
    const gate = fakeClient();
    const hub = new MiniHub(gate.client);
    hub.retain();
    gate.meta();
    expect(await hub.setKeep(2)).toBeNull();
    for (let v = 1; v <= 30; v++) gate.send(v);
    expect(hub.state().kept).toBe(20);
    hub.stepFrames(-3);
    expect(hub.state().back).toBe(3);
    expect(cell(hub)).toBe(27);
    expect(meter(hub)).toBe(27);
    expect(hub.scalars.get("scalar:lfo:out")?.values.slice(-3)).toEqual([25, 26, 27]);
    // Frozen, the tape stops: new batches don't move what is shown.
    gate.send(31);
    expect(cell(hub)).toBe(27);
    hub.stepFrames(1);
    expect(cell(hub)).toBe(28);
    hub.stepFrames(100);
    expect(hub.state().back).toBe(0);
    expect(cell(hub)).toBe(30);
    expect(hub.keepCost(2)).toBeGreaterThan(0);
  });
});
