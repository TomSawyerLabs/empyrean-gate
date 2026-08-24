// An HSV colour wheel: hue around the rim, saturation from the centre out, with
// value on its own slider. Drawn with CSS gradients rather than a canvas — it is
// resolution-independent, costs nothing to redraw, and the value overlay is a
// composited layer instead of a per-pixel pass.
//
// The native <input type="color"> it replaces opened the OS picker, which on the
// Gate machine is a desktop dialog nobody can drive from a touch screen mid-show.

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { harmonize, hsvToHex, type HueHarmony } from "./liveColors";

/// Hue turns increase CLOCKWISE FROM THE TOP, which is what the conic gradient
/// below paints. Both the marker placement and the hit test derive from this, so
/// there is one convention to get wrong instead of three.
const WHEEL_STOPS = Array.from({ length: 13 }, (_, i) => {
  const degrees = i * 30;
  return `hsl(${degrees}deg 100% 50%) ${degrees}deg`;
}).join(", ");

const HARMONY_LABELS: { harmony: HueHarmony; label: string }[] = [
  { harmony: "complement", label: "Complement" },
  { harmony: "triad_a", label: "Triad" },
  { harmony: "analogous_a", label: "Analogous" },
];

export default function ColorWheel({
  hue,
  saturation,
  value,
  onChange,
  showHarmonies = true,
}: {
  hue: number;
  saturation: number;
  value: number;
  onChange: (hue: number, saturation: number, value: number) => void;
  /// Preview chips for the harmonies a pattern can be keyed to.
  showHarmonies?: boolean;
}) {
  const discRef = useRef<HTMLDivElement>(null);

  const pick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const disc = discRef.current;
    if (!disc) return;
    const rect = disc.getBoundingClientRect();
    // Normalised to [-1, 1] from the centre, so the maths is radius-agnostic.
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    const radius = Math.hypot(nx, ny);
    // atan2(nx, -ny) puts 0 at the top and increases clockwise.
    const nextHue = ((Math.atan2(nx, -ny) / (Math.PI * 2)) + 1) % 1;
    // Clamped, not ignored: dragging past the rim should ride the rim rather
    // than drop the gesture, which is how a finger actually leaves a wheel.
    onChange(nextHue, Math.min(1, radius), value);
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pick(event);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
  };

  const angle = hue * Math.PI * 2;
  const markerLeft = 50 + Math.sin(angle) * saturation * 50;
  const markerTop = 50 - Math.cos(angle) * saturation * 50;

  return (
    <div className="color-wheel">
      <div
        ref={discRef}
        className="color-wheel-disc"
        style={{
          // The value overlay is the third layer: black at v=0, gone at v=1.
          backgroundImage:
            `radial-gradient(circle closest-side, rgba(0, 0, 0, ${1 - value}), rgba(0, 0, 0, ${1 - value})), ` +
            "radial-gradient(circle closest-side, #fff, rgba(255, 255, 255, 0)), " +
            `conic-gradient(${WHEEL_STOPS})`,
        }}
        onPointerDown={down}
        onPointerMove={move}
        role="application"
        aria-label="Colour wheel: hue around the rim, saturation from the centre"
      >
        <span
          className="color-wheel-marker"
          style={{ left: `${markerLeft}%`, top: `${markerTop}%` }}
        />
      </div>

      <label className="color-wheel-value">
        <span>Value</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(event) => onChange(hue, saturation, Number(event.target.value))}
        />
        <span className="slider-val">{value.toFixed(2)}</span>
      </label>

      {/* Keyboard and screen-reader route to the same state the wheel drives —
          a pointer-only control would be unreachable without a mouse. */}
      <div className="color-wheel-fields">
        <label>
          <span>Hue</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.002}
            value={hue}
            onChange={(event) => onChange(Number(event.target.value), saturation, value)}
          />
        </label>
        <label>
          <span>Saturation</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={saturation}
            onChange={(event) => onChange(hue, Number(event.target.value), value)}
          />
        </label>
      </div>

      {showHarmonies && (
        <div className="color-wheel-harmonies">
          {HARMONY_LABELS.map(({ harmony, label }) => {
            const hex = hsvToHex(harmonize(hue, harmony), saturation, value);
            return (
              <button
                key={harmony}
                type="button"
                onClick={() => onChange(harmonize(hue, harmony), saturation, value)}
                aria-label={`Jump to the ${label.toLowerCase()} of this colour, ${hex.toUpperCase()}`}
              >
                <span className="color-wheel-chip" style={{ background: hex }} />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
