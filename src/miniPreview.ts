// Mini-preview plumbing: one refcounted subscription to the backend's
// MINI_PREVIEW_MAGIC stream per client, one shared WebGL context that renders
// every thumbnail (browsers cap live GL contexts at ~16 — a Settings page with
// a dozen layer cards would exhaust that on its own), and per-key scalar
// histories for the amplitude meters.

import type { MiniBatch } from "./types";
import type { GateClient } from "./ws";

/** How many scalar samples a meter keeps (~4 s at the 10 Hz batch rate). */
const SCALAR_HISTORY = 40;

export interface MiniScalar {
  values: number[];
  latest: number;
}

export class MiniHub {
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
        const key = `scalar:${ref.node}:${ref.port}`;
        let entry = this.scalars.get(key);
        if (!entry) {
          entry = { values: [], latest: 0 };
          this.scalars.set(key, entry);
        }
        entry.latest = s.value;
        entry.values.push(s.value);
        if (entry.values.length > SCALAR_HISTORY) entry.values.shift();
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

// --- shared thumbnail renderer ---------------------------------------------

const VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec3 a_color;
uniform float u_point_size;
out vec3 v_color;
void main() {
  v_color = a_color;
  gl_Position = vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_point_size;
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float radius = length(d);
  float core = 1.0 - smoothstep(0.20, 0.45, radius);
  float halo = (1.0 - smoothstep(0.40, 0.5, radius)) * 0.30;
  float a = max(core, halo);
  frag = vec4(v_color * a, a);
}`;

/** Backing resolution of the shared render target. Thumbnails are ≤ ~120 CSS
 * px; 192 leaves headroom for 1.5–2× DPR without a per-widget context. */
const STAGE_SIZE = 192;

class MiniRenderer {
  private stage: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private posBuf: WebGLBuffer | null = null;
  private colorBuf: WebGLBuffer | null = null;
  private pointSizeLoc: WebGLUniformLocation | null = null;
  private geomKey = "";
  private count = 0;
  private failed = false;

  /** Draw one cell onto `target` (a plain 2D canvas) via the shared context. */
  draw(target: HTMLCanvasElement, rgb: Uint8Array | null, spokes: number, pixels: number) {
    const size = Math.max(1, Math.min(target.clientWidth, target.clientHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const backing = Math.max(1, Math.round(size * dpr));
    if (target.width !== backing || target.height !== backing) {
      target.width = backing;
      target.height = backing;
    }
    const out = target.getContext("2d");
    if (!out) return;
    out.clearRect(0, 0, target.width, target.height);
    if (!rgb || spokes === 0 || pixels === 0) return;
    const gl = this.ensure();
    if (!gl) return;
    this.layout(gl, spokes, pixels);
    const n = Math.min(this.count, spokes * pixels);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rgb.subarray(0, n * 3));
    gl.uniform1f(this.pointSizeLoc, Math.max(2.0, (STAGE_SIZE / pixels) * 0.82));
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, n);
    // Blit synchronously in the same task, before anything else can touch the
    // shared stage.
    out.drawImage(this.stage!, 0, 0, target.width, target.height);
  }

  private ensure(): WebGL2RenderingContext | null {
    if (this.gl || this.failed) return this.gl;
    const stage = document.createElement("canvas");
    stage.width = STAGE_SIZE;
    stage.height = STAGE_SIZE;
    const gl = stage.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
    if (!gl) {
      this.failed = true;
      return null;
    }
    const prog = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, FS],
    ] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("mini preview shader failed", gl.getShaderInfoLog(sh));
        this.failed = true;
        return null;
      }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("mini preview program failed", gl.getProgramInfoLog(prog));
      this.failed = true;
      return null;
    }
    gl.useProgram(prog);
    gl.viewport(0, 0, STAGE_SIZE, STAGE_SIZE);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.stage = stage;
    this.gl = gl;
    this.pointSizeLoc = gl.getUniformLocation(prog, "u_point_size");
    return gl;
  }

  /** (Re)build the static polar point grid when the mini geometry changes. */
  private layout(gl: WebGL2RenderingContext, spokes: number, pixels: number) {
    const key = `${spokes}x${pixels}`;
    if (key === this.geomKey) return;
    this.geomKey = key;
    this.count = spokes * pixels;
    const positions = new Float32Array(this.count * 2);
    // Thumbnails skip the physical inner-hole ratio: at this size the pattern
    // reads better using the full disc, and the hub has no geometry config.
    const inner = 0.2;
    for (let s = 0; s < spokes; s++) {
      const theta = (s / spokes) * Math.PI * 2 - Math.PI / 2; // spoke 0 at top
      for (let i = 0; i < pixels; i++) {
        const t = pixels > 1 ? i / (pixels - 1) : 0;
        const r = (inner + (1 - t) * (1 - inner)) * 0.95;
        const o = (s * pixels + i) * 2;
        positions[o] = r * Math.cos(theta);
        positions[o + 1] = r * Math.sin(theta);
      }
    }
    if (this.posBuf) gl.deleteBuffer(this.posBuf);
    if (this.colorBuf) gl.deleteBuffer(this.colorBuf);
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.colorBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.count * 3, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 0, 0);
  }
}

export const miniRenderer = new MiniRenderer();
