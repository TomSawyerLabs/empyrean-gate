// Draw tab: live-paint on the array with different pens. Touch-first (iPad PWA,
// phones), works with a mouse too. Strokes from every client merge on the array.

import { useState } from "react";
import GateCanvas from "./GateCanvas";
import type { PenKind } from "./types";

const PENS: { kind: PenKind; label: string }[] = [
  { kind: "glow", label: "Glow" },
  { kind: "ripple", label: "Ripple" },
  { kind: "sparkle", label: "Sparkle" },
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

export default function Draw() {
  const [pen, setPen] = useState<PenKind>("glow");
  const [hue, setHue] = useState(0.5);
  const [size, setSize] = useState(0.12);

  return (
    <div className="draw-page">
      <div className="view-page">
        <GateCanvas drawPen={{ pen, hue, size, intensity: 1 }} />
      </div>
      <div className="draw-toolbar">
        <div className="pen-row">
          {PENS.map((p) => (
            <button
              key={p.kind}
              className={`pen-btn ${pen === p.kind ? "active" : ""}`}
              onClick={() => setPen(p.kind)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="swatch-row">
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
    </div>
  );
}
