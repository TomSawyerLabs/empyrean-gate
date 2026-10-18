// Mini visualizers: MiniRing is a thumbnail of one layer's (or one patch
// node's) solo contribution laid out like the real hardware; MiniMeter is the
// amplitude view for scalar outputs. Both read a MiniSource — the gate app's
// streamed hub, or the playground's local WebGPU runtime — and thumbnails go
// through one shared WebGL context (browsers cap live GL contexts at ~16; a
// page with a dozen cards would exhaust that on its own).

import { useEffect, useRef, useState } from "react";
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
      miniRenderer.draw(canvas, hub.cells.get(mini) ?? null, hub.spokes, hub.pixels);
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
}: {
  source: MiniSource;
  mini: string;
  label: string;
  /** "event": the samples are a running fire count; the strip shows a tick
   * at every sample where it grew, and the total. */
  kind?: "scalar" | "event";
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
  if (kind === "event") {
    const w = 72;
    const h = 16;
    const ticks: number[] = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) ticks.push((i / (values.length - 1)) * w);
    }
    // Lit while the newest samples carry a fire.
    const recent = values.length > 2 && values[values.length - 1] > values[values.length - 3];
    return (
      <div className={`mini-meter mini-event ${recent ? "lit" : ""}`}>
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
  const w = 72;
  const h = 16;
  const points = values
    .map((v, i) => {
      const x = values.length > 1 ? (i / (values.length - 1)) * w : 0;
      const y = h - 1.5 - ((v - min) / (max - min)) * (h - 3);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const shown = Math.abs(latest) >= 100 ? latest.toFixed(0) : latest.toFixed(2);
  return (
    <div className="mini-meter">
      <span className="mini-meter-label">{label}</span>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
        {points && (
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.2" />
        )}
      </svg>
      <span className="mini-meter-value">{shown}</span>
    </div>
  );
}
