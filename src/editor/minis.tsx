// Mini visualizers: MiniRing is a thumbnail of one layer's (or one patch
// node's) solo contribution laid out like the real hardware; MiniMeter is the
// amplitude view for scalar outputs. Both read a MiniSource — the gate app's
// streamed hub, or the playground's local WebGPU runtime — and thumbnails go
// through one shared WebGL context (browsers cap live GL contexts at ~16; a
// page with a dozen cards would exhaust that on its own), or through the 2D
// canvas API where there is no WebGL2.

import { useEffect, useRef, useState } from "react";
import type { PatchShape } from "../types";
import "./minis.css";

export { pushScalar, SCALAR_HISTORY, type MiniScalar, type MiniSource } from "./minis-source";
import type { MiniSource } from "./minis-source";

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
 * px; 192 leaves headroom for 1.5–2× DPR without a per-widget context. A
 * larger view (a Debug node's) grows the stage, up to `STAGE_MAX`, and draws
 * into a corner of it at its own size. */
const STAGE_SIZE = 192;
const STAGE_MAX = 512;

/** One LED's dot across, in pixels, on a square `size` px wide. */
function pointSize(size: number, pixels: number): number {
  return Math.max(2.0 * (size / STAGE_SIZE), (size / pixels) * 0.82);
}

/** A mini's samples along a spoke: cells this size or smaller draw as minis
 * always have. */
const MINI_SAMPLES = 16;
/** How much of a square's width a spoke spans (`positions`: 0.95 × (1 − 0.2)
 * of the radius). */
const SPOKE_SPAN = 0.38;
/** Finest dot spacing a larger cell is drawn at, in pixels: past this, LEDs
 * are averaged together, as the eye would see them from further away. */
const MIN_SPACING = 0.75;

/** Samples along a spoke a view `size` px wide (backing) can show; by
 * default the largest view there is. A Debug node at Full detail is drawn
 * at no more than this, so a host streaming its cells (the gate) need send
 * no more. */
export function ringSamples(size = STAGE_MAX): number {
  return Math.max(MINI_SAMPLES, Math.floor((SPOKE_SPAN * Math.min(size, STAGE_MAX)) / MIN_SPACING));
}

/** A finer cell (a Debug node at Full detail) brought down to what a view
 * `size` px wide can show: each spoke's LEDs averaged in even runs. Returns
 * the cell as it is when it already fits. */
function fitCell(rgb: Uint8Array, spokes: number, pixels: number, size: number): [Uint8Array, number] {
  const fit = ringSamples(size);
  if (pixels <= fit) return [rgb, pixels];
  const out = new Uint8Array(spokes * fit * 3);
  for (let s = 0; s < spokes; s++) {
    for (let j = 0; j < fit; j++) {
      const a = Math.floor((j * pixels) / fit);
      const b = Math.max(a + 1, Math.floor(((j + 1) * pixels) / fit));
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        for (let i = a; i < b; i++) sum += rgb[(s * pixels + i) * 3 + ch]!;
        out[(s * fit + j) * 3 + ch] = Math.round(sum / (b - a));
      }
    }
  }
  return [out, fit];
}

/** The dot for a cell of `samples` per spoke on a square `size` px wide:
 * a mini's, or for a finer cell the same overlap of neighbours a mini has
 * (about twice their spacing), so it reads alike, only finer. */
function dotSize(size: number, samples: number): number {
  if (samples <= MINI_SAMPLES) return pointSize(size, samples);
  return Math.max(2, (2.16 * SPOKE_SPAN * size) / Math.max(1, samples - 1));
}

class MiniRenderer {
  private stage: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private pointSizeLoc: WebGLUniformLocation | null = null;
  /** One point grid per cell size (`spokes×pixels`): the minis' and a Debug
   * node's every-LED one draw side by side without rebuilding each other's. */
  private layouts = new Map<string, { vao: WebGLVertexArrayObject; color: WebGLBuffer; count: number }>();
  private grids = new Map<string, Float32Array>();
  /** No usable WebGL2: every thumbnail takes the 2D path. */
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
    if (!gl) {
      [rgb, pixels] = fitCell(rgb, spokes, pixels, out.canvas.width);
      this.draw2d(out, rgb, spokes, pixels);
      return;
    }
    const px = Math.min(STAGE_MAX, Math.max(STAGE_SIZE, backing));
    [rgb, pixels] = fitCell(rgb, spokes, pixels, px);
    const layout = this.layout(gl, spokes, pixels);
    const n = Math.min(layout.count, Math.floor(rgb.length / 3));
    gl.bindVertexArray(layout.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, layout.color);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rgb.subarray(0, n * 3));
    // Thumbnails draw at STAGE_SIZE as they always have; a larger view at
    // its own backing size, in the stage's bottom-left corner (GL's origin),
    // which is the bottom-left of the image the blit reads.
    const stage = this.stage!;
    if (stage.width < px) {
      stage.width = px;
      stage.height = px;
    }
    gl.viewport(0, 0, px, px);
    gl.uniform1f(this.pointSizeLoc, dotSize(px, pixels));
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, n);
    // Blit synchronously in the same task, before anything else can touch the
    // shared stage.
    out.drawImage(stage, 0, stage.height - px, px, px, 0, 0, target.width, target.height);
  }

  /** The same dots through the 2D canvas API, for a browser that has no
   * WebGL2 (a blocklisted GPU, or a privacy setting that turns it off) but
   * still runs the patch: a halo and a core per LED, added like the
   * shader's blend. A few thousand arcs per thumbnail is cheap at this size. */
  private draw2d(out: CanvasRenderingContext2D, rgb: Uint8Array, spokes: number, pixels: number) {
    const positions = this.positions(spokes, pixels);
    const half = out.canvas.width / 2;
    const dot = dotSize(out.canvas.width, pixels);
    const n = Math.min(spokes * pixels, Math.floor(rgb.length / 3));
    out.save();
    out.globalCompositeOperation = "lighter";
    for (const [radius, alpha] of [
      [dot * 0.47, 0.3],
      [dot * 0.32, 1],
    ] as const) {
      out.globalAlpha = alpha;
      for (let p = 0; p < n; p++) {
        const r = rgb[p * 3];
        const g = rgb[p * 3 + 1];
        const b = rgb[p * 3 + 2];
        // A dark LED still lays down alpha, as the shader's does: the
        // thumbnail's black face.
        out.fillStyle = `rgb(${r},${g},${b})`;
        out.beginPath();
        // Clip space is y up; the canvas is y down.
        const x = half + positions[p * 2] * half;
        const y = half - positions[p * 2 + 1] * half;
        out.arc(x, y, radius, 0, Math.PI * 2);
        out.fill();
      }
    }
    out.restore();
  }

  private ensure(): WebGL2RenderingContext | null {
    if (this.gl || this.failed) return this.gl;
    const stage = document.createElement("canvas");
    stage.width = STAGE_SIZE;
    stage.height = STAGE_SIZE;
    const gl = stage.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
    if (!gl) {
      console.info("mini previews: no WebGL2 in this browser, drawing them on a 2D canvas");
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
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.stage = stage;
    this.gl = gl;
    this.pointSizeLoc = gl.getUniformLocation(prog, "u_point_size");
    return gl;
  }

  /** The static polar point grid (clip space, y up) for a cell size. */
  private positions(spokes: number, pixels: number): Float32Array {
    const key = `${spokes}x${pixels}`;
    const known = this.grids.get(key);
    if (known) return known;
    const positions = new Float32Array(spokes * pixels * 2);
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
    this.grids.set(key, positions);
    return positions;
  }

  /** The point grid of a cell size in the shared context, uploaded the
   * first time it is drawn. */
  private layout(gl: WebGL2RenderingContext, spokes: number, pixels: number) {
    const key = `${spokes}x${pixels}`;
    const known = this.layouts.get(key);
    if (known) return known;
    const count = spokes * pixels;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions(spokes, pixels), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const color = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, color);
    gl.bufferData(gl.ARRAY_BUFFER, count * 3, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    const layout = { vao, color, count };
    this.layouts.set(key, layout);
    return layout;
  }
}

export const miniRenderer = new MiniRenderer();

/** Samples along each spoke in `rgb`: the source's mini size, or a larger
 * cell's own (a Debug node at every LED). */
export function cellPixels(rgb: Uint8Array | null, spokes: number, pixels: number): number {
  if (!rgb || spokes <= 0) return pixels;
  const own = rgb.length / 3 / spokes;
  return Number.isInteger(own) && own > 0 ? own : pixels;
}

/** Ring thumbnail for `layer:<config index>` or `node:<patch node id>`. */
export function MiniRing({
  source,
  mini,
  label,
}: {
  source: MiniSource;
  mini: string;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const hub = source;
    hub.retain();
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rgb = hub.cells.get(mini) ?? null;
      miniRenderer.draw(canvas, rgb, hub.spokes, cellPixels(rgb, hub.spokes, hub.pixels));
    };
    draw();
    const off = hub.onChange(draw);
    return () => {
      off();
      hub.release();
    };
  }, [source, mini]);
  return (
    <canvas
      ref={canvasRef}
      className="mini-ring"
      role="img"
      aria-label={label ? `${label} preview` : "contribution preview"}
    />
  );
}

/** Amplitude meter for one patch scalar output (`scalar:<node>:<port>`). */
export function MiniMeter({
  source,
  mini,
  label,
  kind = "scalar",
  large = false,
}: {
  source: MiniSource;
  mini: string;
  label: string;
  /** "event": the samples are a running fire count; the strip shows a tick
   * at every sample where it grew, and the total. */
  kind?: "scalar" | "event";
  /** A Debug node's: a wide, tall strip under its label and value, with the
   * window's range for a number. */
  large?: boolean;
}) {
  const [, bump] = useState(0);
  useEffect(() => {
    source.retain();
    const off = source.onChange(() => bump((n) => n + 1));
    return () => {
      off();
      source.release();
    };
  }, [source]);
  const entry = source.scalars.get(mini);
  const values = entry?.values ?? [];
  const latest = entry?.latest ?? 0;
  const w = large ? 176 : 72;
  const h = large ? 56 : 16;
  const big = large ? " mini-meter-large" : "";
  if (kind === "event") {
    const ticks: number[] = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) ticks.push((i / (values.length - 1)) * w);
    }
    // Lit while the newest samples carry a fire.
    const recent = values.length > 2 && values[values.length - 1] > values[values.length - 3];
    return (
      <div className={`mini-meter mini-event${big} ${recent ? "lit" : ""}`}>
        <span className="mini-meter-label">{label}</span>
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
          <line x1="0" y1={h - 1.5} x2={w} y2={h - 1.5} stroke="currentColor" strokeWidth="0.6" opacity="0.4" />
          {ticks.map((x, i) => (
            <line key={i} x1={x} y1="1.5" x2={x} y2={h - 1.5} stroke="currentColor" strokeWidth="1.4" />
          ))}
        </svg>
        <span className="mini-meter-value">×{Math.round(latest)}</span>
      </div>
    );
  }
  // Auto-scale to the window's own span so slow drifts stay visible; a flat
  // signal draws as a flat line rather than jittering on float noise.
  const min = values.length ? Math.min(...values, 0) : 0;
  const max = values.length ? Math.max(...values, min + 1e-6) : 1;
  const points = values
    .map((v, i) => {
      const x = values.length > 1 ? (i / (values.length - 1)) * w : 0;
      const y = h - 1.5 - ((v - min) / (max - min)) * (h - 3);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  return (
    <div className={`mini-meter${big}`}>
      <span className="mini-meter-label">{label}</span>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
        {points && (
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.2" />
        )}
      </svg>
      <span className="mini-meter-value">{fmt(latest)}</span>
      {large && values.length > 0 && (
        <span className="mini-meter-range">
          {fmt(min)} … {fmt(max)}
        </span>
      )}
    </div>
  );
}

/** Wire shapes a Debug node shows as a ring (the crate's `codegen::tap_style`);
 * Scalars and Events it meters. */
export function tapsAsRing(shape: PatchShape): boolean {
  return ["field_color", "field_scalar", "led_color", "led_scalar", "points", "effects", "texture"].includes(shape);
}

/** A Debug node's view of what it is fed (`shape`): the ring of its cell
 * (`node:<id>`), or a large meter on its `in` (`scalar:<id>:in`). `id` is
 * the node's id in the patch as it renders (inside a Sub-patch,
 * `"{sub}/{node}"`). `compact`: the size of an ordinary node's mini. */
export function MiniTap({
  source,
  id,
  shape,
  label,
  compact = false,
}: {
  source: MiniSource;
  id: string;
  shape: PatchShape;
  label: string;
  compact?: boolean;
}) {
  const size = compact ? "" : " mini-tap-large";
  if (tapsAsRing(shape)) {
    return (
      <div className={`mini-tap${size}`}>
        <MiniRing source={source} mini={`node:${id}`} label={label} />
      </div>
    );
  }
  if (shape !== "scalar" && shape !== "event") return null;
  return (
    <div className={`mini-tap${size}`}>
      <MiniMeter source={source} mini={`scalar:${id}:in`} label={label} kind={shape} large={!compact} />
    </div>
  );
}
