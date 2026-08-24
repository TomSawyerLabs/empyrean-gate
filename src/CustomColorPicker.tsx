import { useState } from "react";
import ColorWheel from "./ColorWheel";
import { hsvToHex, liveColor, type LiveColor } from "./liveColors";

export default function CustomColorPicker({
  colors,
  initialHex,
  onSave,
  onRemove,
  onClose,
}: {
  colors: LiveColor[];
  initialHex: string;
  onSave: (color: LiveColor) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [hex, setHex] = useState(initialHex);
  const preview = liveColor("preview", "Custom", hex);

  return (
    <div className="modal-backdrop custom-color-backdrop" onClick={onClose}>
      <div className="modal custom-color-picker" role="dialog" aria-modal="true" aria-labelledby="custom-color-title"
        onClick={(event) => event.stopPropagation()}>
        <div className="custom-color-title-row">
          <div>
            <h2 id="custom-color-title">Choose a live color</h2>
            <p className="hint">Drag the wheel, then save it into your quick swatches.</p>
          </div>
          <button aria-label="Close color picker" onClick={onClose}>×</button>
        </div>
        <ColorWheel
          hue={preview.hue}
          saturation={preview.saturation}
          value={preview.brightness}
          onChange={(hue, saturation, value) => setHex(hsvToHex(hue, saturation, value))}
        />
        <label className="custom-color-hex">
          <span>Hex</span>
          <input
            value={hex.toUpperCase()}
            onChange={(event) => {
              const next = event.target.value.trim();
              setHex(/^#?[0-9a-f]{6}$/i.test(next) ? (next.startsWith("#") ? next : `#${next}`) : hex);
            }}
            aria-label="Colour as a hex code"
            spellCheck={false}
          />
          <span className="custom-color-preview" style={{ background: hex }} />
        </label>
        {colors.length > 0 && (
          <div className="saved-custom-colors">
            <span>Saved custom colors</span>
            <div>
              {colors.map((color) => (
                <span key={color.id} className="saved-custom-color">
                  <button className="swatch" style={{ background: color.hex }} aria-label={`Use ${color.label}`}
                    onClick={() => setHex(color.hex)} />
                  <button aria-label={`Remove ${color.label}`} onClick={() => onRemove(color.id)}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="custom-color-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave({ ...preview, id: `color-${Math.random().toString(36).slice(2, 8)}`, label: hex.toUpperCase() })}>
            + Save to swatches
          </button>
        </div>
      </div>
    </div>
  );
}
