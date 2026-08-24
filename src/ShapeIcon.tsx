// Glyphs for the shape buttons. Unlike ToolIcon these are static: the button is
// picking a figure, and the figure is the whole message — an animated one would
// only be harder to recognise at a glance in the dark.

import type { ShapeKind } from "./types";

export default function ShapeIcon({ kind }: { kind: ShapeKind }) {
  const c = "currentColor";
  switch (kind) {
    case "star":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <path
            d="M14 3.2 17.4 10l7.5 1.1-5.4 5.3 1.3 7.4L14 20.3l-6.8 3.5 1.3-7.4-5.4-5.3L10.6 10Z"
            fill={c}
          />
        </svg>
      );
    case "heart":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <path
            d="M14 24.5C6.8 19.6 3 15.6 3 11.4A6 6 0 0 1 14 8.1 6 6 0 0 1 25 11.4c0 4.2-3.8 8.2-11 13.1Z"
            fill={c}
          />
        </svg>
      );
    case "flower":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <ellipse
              key={deg}
              cx="14"
              cy="7.6"
              rx="3.1"
              ry="6.2"
              fill={c}
              opacity="0.85"
              transform={`rotate(${deg} 14 14)`}
            />
          ))}
          <circle cx="14" cy="14" r="2.6" fill={c} />
        </svg>
      );
    case "diamond":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <path d="M14 2.5 25.5 14 14 25.5 2.5 14Z" fill={c} />
        </svg>
      );
    case "triangle":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          <path d="M14 3 25.7 23.4H2.3Z" fill={c} />
        </svg>
      );
    case "moon":
      return (
        <svg className="tool-icon" viewBox="0 0 28 28" aria-hidden="true">
          {/* One path, not a disc with a second disc drawn over it: these sit on
              translucent panels, so a "cut out" in the panel colour would show.
              Outer arc r=11 about (14,14), cut arc r=9 about (18.5,14); the two
              meet at (20.69, 14±8.73). */}
          <path d="M20.69 5.27A11 11 0 1 0 20.69 22.73A9 9 0 1 1 20.69 5.27Z" fill={c} />
        </svg>
      );
  }
}
