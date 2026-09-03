// The colour rows shared by the three layer editors (Settings' LayerEditor,
// LayerQuickEdit, ReadyLayerEditor): hue on a rainbow track with a swatch of
// the actual colour, hue range as the sweep it really produces, saturation on
// a white→hue track. The swatch opens the ColorWheel, driving hue/saturation/
// brightness through the same patch path as the sliders.
//
// Truthfulness contract with the engine: gate.wgsl computes `L.hue + x *
// L.hue_range` with x in [0, 1], so the range readout sweeps UP from the base
// hue, not around it. hsvToHex wraps hue, so stops past 1.0 are fine.

import { useState } from "react";
import ColorWheel from "./ColorWheel";
import { hsvToHex } from "./liveColors";
import type { LayerCfg } from "./types";

const RANGE_STOPS = 8;

export default function LayerColorControls({
  hue,
  hueRange,
  saturation,
  brightness,
  onPatch,
}: {
  hue: number;
  hueRange: number;
  saturation: number;
  brightness: number;
  onPatch: (patch: Partial<LayerCfg>) => void;
}) {
  const [wheelOpen, setWheelOpen] = useState(false);
  // Full-value swatch: brightness has its own slider, and a dark swatch reads
  // as "broken" rather than "dim" at a glance.
  const swatch = hsvToHex(hue, saturation, 1);
  const sweep = Array.from({ length: RANGE_STOPS + 1 }, (_, i) =>
    hsvToHex(hue + (i / RANGE_STOPS) * hueRange, saturation, 1),
  ).join(", ");
  const wheelValue = Math.min(brightness, 1);

  return (
    <>
      <label className="slider-row">
        <span>Hue</span>
        <input
          type="range"
          className="hue-slider"
          min={0}
          max={1}
          step={0.002}
          value={hue}
          onChange={(e) => onPatch({ hue: Number(e.target.value) })}
        />
        <button
          type="button"
          className="hue-swatch hue-swatch-button"
          style={{ background: swatch }}
          aria-expanded={wheelOpen}
          aria-label={`Current colour ${swatch.toUpperCase()} — ${wheelOpen ? "close" : "open"} the colour wheel`}
          onClick={() => setWheelOpen((open) => !open)}
        />
      </label>
      {wheelOpen && (
        <div className="layer-color-wheel">
          <ColorWheel
            hue={hue}
            saturation={saturation}
            value={wheelValue}
            showHarmonies={false}
            onChange={(h, s, v) => {
              const patch: Partial<LayerCfg> = { hue: h, saturation: s };
              // Only write brightness when the wheel's value slider moved:
              // a layer at brightness 2 must not drop to 1 from a hue drag.
              if (v !== wheelValue) patch.brightness = v;
              onPatch(patch);
            }}
          />
        </div>
      )}
      <label className="slider-row">
        <span>Hue range</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={hueRange}
          onChange={(e) => onPatch({ hue_range: Number(e.target.value) })}
        />
        <span
          className="hue-range-swatch"
          style={{ background: `linear-gradient(to right, ${sweep})` }}
          title={`Hues swept: ${hueRange.toFixed(2)} of the wheel`}
        />
      </label>
      <label className="slider-row">
        <span>Saturation</span>
        <input
          type="range"
          className="gradient-slider"
          min={0}
          max={1}
          step={0.01}
          value={saturation}
          style={{
            background: `linear-gradient(to right, ${hsvToHex(hue, 0, 1)}, ${hsvToHex(hue, 1, 1)})`,
          }}
          onChange={(e) => onPatch({ saturation: Number(e.target.value) })}
        />
        <span className="slider-val">{saturation.toFixed(2)}</span>
      </label>
    </>
  );
}
