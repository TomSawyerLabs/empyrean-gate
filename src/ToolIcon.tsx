// Animated glyphs for the Live tool buttons: each loops a tiny demonstration of
// what the tool does on the array, so the shape is clear before trying it.
// Pure SVG + CSS keyframes (see styles.css ".ti-*").

import type { PenKind } from "./types";

export type ToolKind = "tap" | PenKind;

export default function ToolIcon({ kind }: { kind: ToolKind }) {
  const c = "currentColor";
  switch (kind) {
    case "tap":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r="2.5" fill={c} />
          <circle className="ti-burst" cx="14" cy="14" r="4" fill="none" stroke={c} strokeWidth="1.5" />
        </svg>
      );
    case "glow":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <circle className="ti-glow" cx="14" cy="14" r="6" fill={c} />
        </svg>
      );
    case "ripple":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <circle className="ti-ripple" cx="14" cy="14" r="3" fill="none" stroke={c} strokeWidth="1.5" />
          <circle className="ti-ripple ti-late" cx="14" cy="14" r="3" fill="none" stroke={c} strokeWidth="1.5" />
        </svg>
      );
    case "sparkle":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <circle className="ti-twinkle" cx="9" cy="10" r="1.8" fill={c} />
          <circle className="ti-twinkle ti-late" cx="18" cy="8" r="1.4" fill={c} />
          <circle className="ti-twinkle ti-later" cx="20" cy="17" r="1.8" fill={c} />
          <circle className="ti-twinkle ti-latest" cx="11" cy="19" r="1.4" fill={c} />
        </svg>
      );
    case "comet":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <g className="ti-comet">
            <line x1="2" y1="22" x2="12" y2="12" stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.4" />
            <circle cx="13" cy="11" r="2.6" fill={c} />
          </g>
        </svg>
      );
    case "ring":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <circle className="ti-ring" cx="14" cy="14" r="8" fill="none" stroke={c} strokeWidth="2" />
          <circle cx="14" cy="14" r="1.5" fill={c} opacity="0.5" />
        </svg>
      );
    case "beam":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r="1.5" fill={c} opacity="0.5" />
          <line className="ti-beam" x1="14" y1="14" x2="24" y2="4" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "ember": {
      const ember = (cx: number, cy: number, r: number, cls: string) => (
        <circle
          className={`ti-ember ${cls}`}
          cx={cx}
          cy={cy}
          r={r}
          fill={c}
          style={{ "--tx": `${cx}px`, "--ty": `${cy}px` } as React.CSSProperties}
        />
      );
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          {ember(22, 6, 1.8, "")}
          {ember(7, 9, 1.5, "ti-late")}
          {ember(18, 22, 1.6, "ti-later")}
        </svg>
      );
    }
  }
}
