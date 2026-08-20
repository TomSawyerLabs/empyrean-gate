// Live: the merged view + draw surface. The array view is always as large as the
// window allows; the controls flow into whatever space the aspect ratio leaves —
// side columns when wide, top/bottom bars when tall, and tucked into the corners
// (which the circle never reaches) when squarish. The empty ring center carries
// the title and live status. Tap anywhere = burst; drag = draw with the pen.

import { useEffect, useRef, useState } from "react";
import { EFFECTS } from "./effects";
import GateCanvas from "./GateCanvas";
import Sparkbars from "./Sparkbars";
import { useGate } from "./state";
import ToolIcon, { type ToolKind } from "./ToolIcon";

const TOOLS: { kind: ToolKind; label: string }[] = [
  { kind: "tap", label: "Tap" },
  { kind: "glow", label: "Glow" },
  { kind: "ripple", label: "Ripple" },
  { kind: "sparkle", label: "Sparkle" },
  { kind: "comet", label: "Comet" },
  { kind: "ring", label: "Ring" },
  { kind: "beam", label: "Beam" },
  { kind: "ember", label: "Ember" },
];

const SWATCHES: { hue: number; label: string }[] = [
  { hue: -1, label: "White" },
  { hue: 0.0, label: "Red" },
  { hue: 0.09, label: "Orange" },
  { hue: 0.16, label: "Gold" },
  { hue: 0.35, label: "Green" },
  { hue: 0.5, label: "Cyan" },
  { hue: 0.62, label: "Blue" },
  { hue: 0.78, label: "Purple" },
  { hue: 0.9, label: "Pink" },
];

function swatchColor(hue: number): string {
  return hue < 0 ? "#ffffff" : `hsl(${hue * 360}deg 90% 60%)`;
}

export default function Live() {
  const { client, status, beatAt } = useGate();
  const [tool, setTool] = useState<ToolKind>("tap");
  const [hue, setHue] = useState(0.5);
  const [size, setSize] = useState(0.12);
  const beatDotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const dot = beatDotRef.current;
      if (dot) {
        const age = performance.now() - Math.max(...beatAt.current);
        const a = Math.max(0, 1 - age / 300);
        dot.style.opacity = String(0.15 + a * 0.85);
        dot.style.transform = `scale(${1 + a * 0.6})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [beatAt]);

  const bpm = status?.audio.find((a) => a.active)?.bpm ?? 0;

  const pens = (
    <div className="cluster pens">
      {TOOLS.map((t) => (
        <button
          key={t.kind}
          className={`pen-btn ${tool === t.kind ? "active" : ""}`}
          onClick={() => setTool(t.kind)}
        >
          <ToolIcon kind={t.kind} />
          {t.label}
        </button>
      ))}
    </div>
  );

  const effects = (
    <div className="cluster effects">
      {EFFECTS.map((e) => (
        <button
          key={e.kind}
          className="effect-btn"
          onClick={() => client.triggerEffect({ kind: e.kind, angle: Math.random() * Math.PI * 2 })}
        >
          {e.label}
          <span className="key-hint">{e.key}</span>
        </button>
      ))}
    </div>
  );

  const colors = (
    <div className="cluster swatches">
      {SWATCHES.map((s) => (
        <button
          key={s.label}
          className={`swatch ${hue === s.hue ? "active" : ""}`}
          style={{ background: swatchColor(s.hue) }}
          onClick={() => setHue(s.hue)}
          aria-label={s.label}
        />
      ))}
    </div>
  );

  const sizeCtl = (
    <div className="cluster size-ctl">
      <label className="slider-row">
        <span>Size</span>
        <input
          type="range"
          min={0.03}
          max={0.4}
          step={0.01}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        />
      </label>
    </div>
  );

  const canvas = (
    <div className="live-canvas-wrap">
      <GateCanvas
        drawPen={tool === "tap" ? undefined : { pen: tool, hue, size, intensity: 1 }}
        onTap={
          tool === "tap"
            ? (angle, radius) => client.triggerEffect({ kind: "burst", angle, radius, hue })
            : undefined
        }
      />
      <div className="ring-center">
        <div className="ring-title">Empyrean Gate</div>
        <div className="ring-status">
          <div ref={beatDotRef} className="beat-dot" />
          <span>{bpm > 0 ? `${bpm.toFixed(0)} BPM` : "no beat"}</span>
        </div>
        {status && (
          <Sparkbars
            data={status.fps_history}
            color="#38d1c2"
            label="fps"
            value={String(status.fps_history.at(-1) ?? 0)}
          />
        )}
        {status?.sacn_enabled && (
          <Sparkbars
            data={status.pps_history}
            color="#7c5cff"
            label="pkt/s"
            value={String(status.sacn_pps)}
            warn={status.sacn_pps === 0}
          />
        )}
        {status?.sacn_enabled && <span className="live-pill">sACN LIVE</span>}
      </div>
      {/* Square-ish windows: controls float in the corners the circle never
          reaches. Visibility is pure CSS (aspect-ratio media queries), so the
          layout is right at first paint with no resize-observer fragility. */}
      <div className="corner tl">{pens}</div>
      <div className="corner tr">{effects}</div>
      <div className="corner bl">{colors}</div>
      <div className="corner br">{sizeCtl}</div>
    </div>
  );

  return (
    <div className="live-page">
      <div className="live-side a">
        {pens}
        {effects}
      </div>
      {canvas}
      <div className="live-side b">
        {colors}
        {sizeCtl}
      </div>
    </div>
  );
}
