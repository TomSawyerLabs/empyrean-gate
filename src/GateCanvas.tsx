// The shared live view of the array: WebGL2 point cloud fed by the WS preview
// stream. Optionally interactive: "tap" fires a callback with the polar position
// (View tab → burst), "draw" streams stroke dabs to the backend (Draw tab).

import { useEffect, useRef, useState } from "react";
import { useGate } from "./state";
import type { PenKind, PreviewMeta } from "./types";

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
  float a = smoothstep(0.5, 0.15, length(d));
  frag = vec4(v_color * a, 1.0);
}`;

interface Gl {
  gl: WebGL2RenderingContext;
  colorBuf: WebGLBuffer;
  count: number;
  pointSizeLoc: WebGLUniformLocation;
}

function buildGl(canvas: HTMLCanvasElement, meta: PreviewMeta): Gl | null {
  const gl = canvas.getContext("webgl2");
  if (!gl) return null;

  const prog = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VS],
    [gl.FRAGMENT_SHADER, FS],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const { spokes, pixels } = meta;
  const inner = meta.inner_radius_ft / meta.outer_radius_ft;
  const count = spokes * pixels;
  const positions = new Float32Array(count * 2);
  for (let s = 0; s < spokes; s++) {
    const theta = (s / spokes) * Math.PI * 2 - Math.PI / 2; // spoke 0 at top
    for (let i = 0; i < pixels; i++) {
      const t = pixels > 1 ? i / (pixels - 1) : 0;
      const r = (1 - t) * 0.95 + t * inner * 0.95; // pixel 0 = outer
      const o = (s * pixels + i) * 2;
      positions[o] = r * Math.cos(theta);
      positions[o + 1] = r * Math.sin(theta);
    }
  }
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const colorBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
  gl.bufferData(gl.ARRAY_BUFFER, count * 3, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 0, 0);

  gl.clearColor(0.02, 0.02, 0.04, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  return { gl, colorBuf, count, pointSizeLoc: gl.getUniformLocation(prog, "u_point_size")! };
}

export interface DrawPen {
  pen: PenKind;
  hue: number; // turns; -1 = white
  size: number;
  intensity: number;
}

export default function GateCanvas({
  onTap,
  drawPen,
}: {
  /** Called with (angle, radius01) on a click/tap (when not drawing). */
  onTap?: (angle: number, radius: number) => void;
  /** When set, pointer drags stream Paint messages with this pen. */
  drawPen?: DrawPen;
}) {
  const { client } = useGate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<Gl | null>(null);
  const [meta, setMeta] = useState<PreviewMeta | null>(null);
  const pending = useRef<{ angle: number; radius: number }[]>([]);
  // Per-pointer stroke state (multitouch: each finger tracked separately).
  const pointers = useRef(
    new Map<number, { x: number; y: number; moved: boolean }>(),
  );
  const penRef = useRef(drawPen);
  penRef.current = drawPen;

  // Subscribe to the preview stream while mounted (resubscribe on reconnect).
  useEffect(() => {
    const decimate = window.innerWidth < 700 ? 4 : 1;
    const sub = () => client.subscribePreview(30, decimate);
    sub();
    const offStatus = client.onStatus((up) => up && sub());
    const offMsg = client.onMessage((m) => {
      if (m.type === "preview_meta") setMeta(m);
    });
    return () => {
      offStatus();
      offMsg();
      client.send({ type: "unsubscribe_preview" });
    };
  }, [client]);

  useEffect(() => {
    if (!meta || !canvasRef.current) return;
    glRef.current = buildGl(canvasRef.current, meta);
    return () => {
      // Browsers cap live WebGL contexts (~16); release explicitly or tab-hopping
      // eventually kills rendering everywhere.
      glRef.current?.gl.getExtension("WEBGL_lose_context")?.loseContext();
      glRef.current = null;
    };
  }, [meta]);

  useEffect(() => {
    return client.onFrame((frame) => {
      const g = glRef.current;
      const canvas = canvasRef.current;
      if (!g || !canvas) return;
      const { gl } = g;
      const size = Math.min(canvas.clientWidth, canvas.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      const n = Math.min(g.count, frame.spokes * frame.pixels);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, frame.rgb.subarray(0, n * 3));
      gl.uniform1f(g.pointSizeLoc, Math.max(1.5, (canvas.width / frame.pixels) * 0.28));
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, n);
    });
  }, [client]);

  // Flush accumulated stroke points ~30x/s.
  useEffect(() => {
    const interval = setInterval(() => {
      const pen = penRef.current;
      if (!pen || pending.current.length === 0) return;
      client.send({
        type: "paint",
        pen: pen.pen,
        points: pending.current,
        hue: pen.hue,
        size: pen.size,
        intensity: pen.intensity,
      });
      pending.current = [];
    }, 33);
    return () => clearInterval(interval);
  }, [client]);

  const toPolar = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    return {
      angle: Math.atan2(y, x) + Math.PI / 2, // undo spoke-0-at-top rotation
      radius: Math.min(1.2, Math.hypot(x, y) / 0.95),
    };
  };

  // Tap vs. draw, unified: a press that never travels more than a few pixels is a
  // tap (burst via onTap, even with a pen active — tapping on the beat must keep
  // working); a drag is a stroke. Tracked per pointer so several fingers can draw
  // while another taps.
  const TAP_SLOP_PX = 8;

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawPen && !onTap) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < TAP_SLOP_PX) return;
    if (!drawPen) return;
    if (!p.moved) {
      p.moved = true;
      pending.current.push(toPolar({ clientX: p.x, clientY: p.y })); // stroke start
    }
    const native = e.nativeEvent as PointerEvent;
    const events = native.getCoalescedEvents?.() ?? [native];
    for (const ev of events) pending.current.push(toPolar(ev));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!p || p.moved || !onTap) return;
    const polar = toPolar(e);
    onTap(polar.angle, Math.min(1, polar.radius));
  };

  return (
    <canvas
      ref={canvasRef}
      className="gate-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      style={{ touchAction: "none", cursor: drawPen ? "crosshair" : onTap ? "pointer" : "default" }}
    />
  );
}
