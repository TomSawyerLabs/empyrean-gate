// The mini visualizers themselves: MiniRing is a thumbnail of one layer's (or
// one patch node's) solo contribution laid out like the real hardware;
// MiniMeter is the amplitude view for scalar outputs. Both lean on the shared
// hub/renderer in miniPreview.ts — mounting any of them starts the stream,
// unmounting the last one stops it.

import { useEffect, useRef, useState } from "react";
import { getMiniHub, miniRenderer } from "./miniPreview";
import { useGate } from "./state";

/** Ring thumbnail for `layer:<config index>` or `node:<patch node id>`. */
export function MiniRing({ mini, label }: { mini: string; label?: string }) {
  const { client } = useGate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const hub = getMiniHub(client);
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
  }, [client, mini]);
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
export function MiniMeter({ mini, label }: { mini: string; label: string }) {
  const { client } = useGate();
  const [, bump] = useState(0);
  const hubRef = useRef(getMiniHub(client));
  useEffect(() => {
    const hub = getMiniHub(client);
    hubRef.current = hub;
    hub.retain();
    const off = hub.onChange(() => bump((n) => n + 1));
    return () => {
      off();
      hub.release();
    };
  }, [client]);
  const entry = hubRef.current.scalars.get(mini);
  const values = entry?.values ?? [];
  const latest = entry?.latest ?? 0;
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
