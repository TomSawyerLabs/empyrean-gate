// Mini-preview plumbing: one refcounted subscription to the backend's
// MINI_PREVIEW_MAGIC stream per client, as a MiniSource for the shared mini
// visualizers (packages/patch-web), with per-key scalar histories for the
// amplitude meters.

import { pushScalar, type MiniScalar, type MiniSource } from "@empyrean-gate/patch-web/editor";
import type { MiniBatch } from "./types";
import type { GateClient } from "./ws";

export class MiniHub implements MiniSource {
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
    this.notify();
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private apply(batch: MiniBatch) {
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
