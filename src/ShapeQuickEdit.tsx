// Hold or right-click a shape pad to change how figures are drawn.
//
// Two controls, because two are what decide whether a star reads as a star:
// how thick its outline is and how lit its interior is. Everything else about a
// stamp already has a home — size is the Size slider, hold/grow/shrink is the
// strip under the pads.
//
// The preview is not decoration. Below about 0.3 the outline is finer than the
// gap between spokes and will render as a dotted line on the real array; the
// readout says so at the moment you cross it, rather than letting you find out
// at the rig.

import QuickPopover, { type PopoverAnchor } from "./QuickPopover";
import ShapeIcon from "./ShapeIcon";
import {
  edgeWidth,
  SHAPE_STYLE_DEFAULTS,
  SPOKE_PITCH,
  type ShapeStyle,
} from "./shapeStyle";
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
  const width = edgeWidth(style.edge);
  const dotted = width < SPOKE_PITCH;
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

      <p className={`cluster-hint ${dotted ? "warn" : ""}`}>
        {dotted
          ? `Outline is ${width.toFixed(3)} wide — finer than the ${SPOKE_PITCH} gap between
             spokes, so it will break into dashes where the edge runs sideways.`
          : `Outline ${width.toFixed(3)} of the array radius; spokes are ${SPOKE_PITCH} apart.`}
      </p>

      <div className="quick-edit-foot">
        <span className="cluster-hint">Thinner and dimmer reads as a figure; fat reads as a blob.</span>
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
