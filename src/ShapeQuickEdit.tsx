// Hold or right-click a shape pad to change how figures are drawn.
//
// Two controls, because two are what decide whether a star reads as a star:
// how thick its outline is and how lit its interior is. Everything else about a
// stamp already has a home — size is the Size slider, hold/grow/shrink is the
// strip under the pads.
//
// Edge is not an absolute width. The array samples 17x to 54x more finely along
// a spoke than across spokes, and the tangential spacing grows with radius, so
// the shader floors the outline at whatever that radius can actually resolve.
// Edge picks a position above that floor, which is why there is no "too thin"
// warning to give: the setting cannot ask for a line the array cannot draw.

import QuickPopover, { type PopoverAnchor } from "./QuickPopover";
import ShapeIcon from "./ShapeIcon";
import { SHAPE_STYLE_DEFAULTS, type ShapeStyle } from "./shapeStyle";
import type { ShapeKind } from "./types";

export interface ShapeEditAnchor extends PopoverAnchor {
  kind: ShapeKind;
}

export default function ShapeQuickEdit({
  anchor,
  style,
  onChange,
  onClose,
}: {
  anchor: ShapeEditAnchor;
  style: ShapeStyle;
  onChange: (next: ShapeStyle) => void;
  onClose: () => void;
}) {
  const isDefault =
    style.edge === SHAPE_STYLE_DEFAULTS.edge && style.fill === SHAPE_STYLE_DEFAULTS.fill;

  return (
    <QuickPopover
      anchor={anchor}
      onClose={onClose}
      label="Shape definition"
      className="shape-quick-edit"
    >
      <div className="quick-edit-head">
        <span className="shape-quick-glyph">
          <ShapeIcon kind={anchor.kind} />
        </span>
        <div className="quick-edit-title">
          <strong>Shape definition</strong>
          <span>Applies to every shape</span>
        </div>
        <button aria-label="Close shape definition" className="quick-edit-close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="quick-edit-group">
        <label className="slider-row">
          <span>Edge</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={style.edge}
            onChange={(e) => onChange({ ...style, edge: Number(e.target.value) })}
          />
          <span className="slider-val">{style.edge.toFixed(2)}</span>
        </label>
        <label className="slider-row">
          <span>Fill</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={style.fill}
            onChange={(e) => onChange({ ...style, fill: Number(e.target.value) })}
          />
          <span className="slider-val">{style.fill.toFixed(2)}</span>
        </label>
      </div>

      <div className="quick-edit-foot">
        <span className="cluster-hint">
          Edge 0 is as fine as the array can draw at each radius — it widens
          itself near the rim, where the spokes fan out. Thin and dim reads as a
          figure; fat reads as a blob.
        </span>
        <button
          className="ghost"
          disabled={isDefault}
          onClick={() => onChange({ ...SHAPE_STYLE_DEFAULTS })}
        >
          Reset
        </button>
      </div>
    </QuickPopover>
  );
}
