// Mini-preview plumbing: one refcounted subscription to the backend's
// MINI_PREVIEW_MAGIC stream per client, as a MiniSource for the shared mini
// visualizers (packages/patch-web), with per-key scalar histories for the
// amplitude meters.
//
// It is also the Patch tab's FrameTransport (plans/frame-step.md). The gate's
// engine is the show, so nothing here pauses it: pausing freezes the patch's
// thumbnails and meters on this client, and, with Keep past frames on, the
// last seconds of patch batches are kept to step back through.

import {
  pushScalar,
  SCALAR_HISTORY,
  type FrameTransport,
  type MiniScalar,
  type MiniSource,
  type TransportState,
} from "@empyrean-gate/patch-web/editor";
import type { MiniBatch } from "./types";
import type { GateClient } from "./ws";

/** One patch batch as it arrived: its cells and meter values by key. */
interface KeptBatch {
  n: number;
  time: number;
  cells: Map<string, Uint8Array>;
  meters: Map<string, number>;
}

/** Patch batches a second (the gate's publish rate for a desktop client). */
const BATCHES_PER_SECOND = 10;

export class MiniHub implements MiniSource, FrameTransport {
  private client: GateClient;
  private refs = 0;
  private offMsg: (() => void) | null = null;
  private offBatch: (() => void) | null = null;
  private offStatus: (() => void) | null = null;
  private listeners = new Set<() => void>();

  spokes = 0;
  pixels = 0;
  /** Latest ring cell per key ("layer:3" or "node:n17"). */
  cells = new Map<string, Uint8Array>();
  /** Scalar meter history per key ("scalar:n5:out"). */
  scalars = new Map<string, MiniScalar>();
  /** Node id per patch cell slot, from the latest meta. */
  private patchNodes: string[] = [];
  private patchScalars: { node: string; port: string }[] = [];

  // FrameTransport: freeze the patch's views, step through kept batches.
  readonly canStep = false;
  private paused = false;
  private batches = 0;
  private t0 = 0;
  private keepSeconds = 0;
  /** Kept patch batches, oldest first; the newest is the live one. */
  private kept: KeptBatch[] = [];
  private back = 0;
  private transportListeners = new Set<() => void>();

  constructor(client: GateClient) {
    this.client = client;
  }

  /** A widget is on screen: subscribe on the first, resubscribe on reconnect. */
  retain() {
    this.refs += 1;
    if (this.refs > 1) return;
    const phone = window.innerWidth < 700;
    const sub = () => this.client.subscribeMiniPreviews(phone ? 5 : 10);
    sub();
    this.offStatus = this.client.onStatus((up) => up && sub());
    this.offMsg = this.client.onMessage((m) => {
      if (m.type !== "mini_preview_meta") return;
      this.spokes = m.spokes;
      this.pixels = m.pixels;
      this.patchNodes = m.patch_nodes;
      this.patchScalars = m.patch_scalars;
    });
    this.offBatch = this.client.onMiniBatch((batch) => this.apply(batch));
  }

  release() {
    this.refs -= 1;
    if (this.refs > 0) return;
    this.offMsg?.();
    this.offBatch?.();
    this.offStatus?.();
    this.offMsg = this.offBatch = this.offStatus = null;
    this.client.unsubscribeMiniPreviews();
    this.cells.clear();
    this.scalars.clear();
    this.kept = [];
    this.back = 0;
    this.notify();
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private apply(batch: MiniBatch) {
    // Frozen, a patch batch is only kept (a layer batch still shows: the
    // freeze is the patch editor's).
    if (batch.kind === 1) {
      this.keep(batch);
      if (this.paused) return;
    }
    this.spokes = batch.spokes;
    this.pixels = batch.pixels;
    // Each batch is complete for its kind: a key absent from it is a layer no
    // longer playing (or a node no longer in the patch) and goes dark.
    const prefix = batch.kind === 0 ? "layer:" : "node:";
    for (const key of [...this.cells.keys()]) {
      if (key.startsWith(prefix)) this.cells.delete(key);
    }
    for (const cell of batch.cells) {
      const key =
        batch.kind === 0 ? `layer:${cell.id}` : `node:${this.patchNodes[cell.id] ?? cell.id}`;
      this.cells.set(key, cell.rgb);
    }
    if (batch.kind === 1) {
      for (const s of batch.scalars) {
        const ref = this.patchScalars[s.id];
        if (!ref) continue;
        pushScalar(this.scalars, `scalar:${ref.node}:${ref.port}`, s.value);
      }
    }
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  /** Count a patch batch, and keep it while Keep past frames is on (and
   * always the newest, to go back to when the views resume). Frozen, the
   * tape stops: what was kept up to the freeze stays to step through. */
  private keep(batch: MiniBatch) {
    const now = performance.now();
    if (this.batches === 0) this.t0 = now;
    this.batches += 1;
    if (this.paused) return;
    const cells = new Map<string, Uint8Array>();
    for (const cell of batch.cells) cells.set(`node:${this.patchNodes[cell.id] ?? cell.id}`, cell.rgb);
    const meters = new Map<string, number>();
    for (const s of batch.scalars) {
      const ref = this.patchScalars[s.id];
      if (ref) meters.set(`scalar:${ref.node}:${ref.port}`, s.value);
    }
    this.kept.push({ n: this.batches, time: (now - this.t0) / 1000, cells, meters });
    const room = this.keepSeconds > 0 ? Math.ceil(this.keepSeconds * BATCHES_PER_SECOND) + 1 : 1;
    if (this.kept.length > room) this.kept.splice(0, this.kept.length - room);
  }

  /** Show the kept batch `back` behind the newest: its cells, and meters
   * ending at it. */
  private show(back: number) {
    const at = this.kept.length - 1 - back;
    const batch = this.kept[at];
    if (!batch) return;
    this.back = back;
    for (const key of [...this.cells.keys()]) if (key.startsWith("node:")) this.cells.delete(key);
    for (const [key, rgb] of batch.cells) this.cells.set(key, rgb);
    for (const key of [...this.scalars.keys()]) if (key.startsWith("scalar:")) this.scalars.delete(key);
    for (const b of this.kept.slice(Math.max(0, at - SCALAR_HISTORY + 1), at + 1)) {
      for (const [key, value] of b.meters) pushScalar(this.scalars, key, value);
    }
    this.notify();
  }

  state(): TransportState {
    const shown = this.kept[this.kept.length - 1 - this.back];
    return {
      paused: this.paused,
      frame: this.batches,
      time: this.kept.at(-1)?.time ?? 0,
      back: this.back,
      shown: shown ? { frame: shown.n, time: shown.time } : { frame: this.batches, time: 0 },
      kept: this.keepSeconds > 0 ? Math.max(0, this.kept.length - 1) : 0,
      keepSeconds: this.keepSeconds,
    };
  }

  onTransport(listener: () => void): () => void {
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  private notifyTransport() {
    this.transportListeners.forEach((l) => l());
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.notifyTransport();
  }

  play() {
    if (!this.paused) return;
    this.paused = false;
    // The newest batch at once, not at the next one.
    this.show(0);
    this.notifyTransport();
  }

  stepFrames(frames: number) {
    this.paused = true;
    const back = Math.max(0, Math.min(this.back - Math.trunc(frames), this.state().kept));
    if (back !== this.back) this.show(back);
    this.notifyTransport();
  }

  async setKeep(seconds: number): Promise<string | null> {
    this.keepSeconds = Math.max(0, seconds);
    if (this.back > 0) this.show(0);
    this.kept = this.kept.slice(-1);
    this.notifyTransport();
    return null;
  }

  keepCost(seconds: number): number {
    // A batch is about its cells' RGB (the gate's at most 32 cells).
    const cells = Math.max(1, this.patchNodes.length || 32);
    const perBatch = cells * Math.max(1, this.spokes || 64) * Math.max(1, this.pixels || 16) * 3;
    return (Math.ceil(Math.max(0, seconds) * BATCHES_PER_SECOND) + 1) * perBatch;
  }
}

const hubs = new WeakMap<GateClient, MiniHub>();

export function getMiniHub(client: GateClient): MiniHub {
  let hub = hubs.get(client);
  if (!hub) {
    hub = new MiniHub(client);
    hubs.set(client, hub);
  }
  return hub;
}
