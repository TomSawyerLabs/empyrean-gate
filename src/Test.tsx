import { useState, useCallback } from "react";
import { useGate, useThrottled } from "./state";

export default function Test() {
  const { config, status, client } = useGate();
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [selectedColor, setSelectedColor] = useState("#ff0000");
  const [brightness, setBrightness] = useState(1);
  const [pixelMode, setPixelMode] = useState<"front" | "back" | "all">("all");
  const [pixelIndex, setPixelIndex] = useState(0);

  if (!config) return <p className="hint">Waiting for backend…</p>;

  const totalPixels = config.geometry.spokes * config.geometry.pixels_per_spoke;

  const hexToHsb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let hue = 0;
    if (delta !== 0) {
      if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
      else if (max === g) hue = ((b - r) / delta + 2) / 6;
      else hue = ((r - g) / delta + 4) / 6;
    }

    const saturation = max === 0 ? 0 : delta / max;

    return { hue, saturation, brightness: max };
  };

  const { hue, saturation } = hexToHsb(selectedColor);

  const handleTestColorChange = useCallback(
    (hex: string) => {
      setSelectedColor(hex);
    },
    []
  );

  const handleBrightnessChange = useCallback(
    (value: number) => {
      setBrightness(value);
    },
    []
  );

  const throttledBrightness = useThrottled((value: number) => {
    client.setMaster({ brightness: value });
  });

  const handleBrightnessThrottled = (value: number) => {
    handleBrightnessChange(value);
    throttledBrightness(value);
  };

  const sendTestPattern = useCallback(() => {
    if (!testModeEnabled) return;

    client.triggerEffect({
      kind: "burst",
      angle: 0,
      hue,
      saturation,
      brightness,
    });
  }, [testModeEnabled, hue, saturation, brightness, client]);

  const pixelStart = pixelMode === "front" ? 0 : pixelMode === "back" ? Math.floor(totalPixels / 2) : 0;
  const pixelEnd =
    pixelMode === "front" ? Math.floor(totalPixels / 2) : pixelMode === "back" ? totalPixels : totalPixels;
  const maxPixelIndex = pixelEnd - pixelStart - 1;

  const displayPixelIndex = pixelStart + Math.min(pixelIndex, maxPixelIndex);

  return (
    <div className="test-page">
      <section className="panel test-mode-control">
        <h2>Test Mode</h2>
        <p className="hint">Enter test mode to access hardware testing controls. Test mode must be explicitly enabled.</p>
        <div className="test-mode-toggle">
          <label>
            <input
              type="checkbox"
              checked={testModeEnabled}
              onChange={(e) => setTestModeEnabled(e.target.checked)}
            />
            Enable Test Mode
          </label>
        </div>
      </section>

      {testModeEnabled && (
        <>
          <section className="panel test-controls">
            <h2>Color & Brightness</h2>

            <div className="control-group">
              <label htmlFor="test-color">Color</label>
              <div className="color-input-wrapper">
                <input
                  id="test-color"
                  type="color"
                  value={selectedColor}
                  onChange={(e) => handleTestColorChange(e.target.value)}
                />
                <span className="color-value">{selectedColor}</span>
              </div>
            </div>

            <div className="control-group">
              <label htmlFor="test-brightness">
                Brightness: {(brightness * 100).toFixed(0)}%
              </label>
              <input
                id="test-brightness"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={brightness}
                onChange={(e) => handleBrightnessThrottled(parseFloat(e.target.value))}
              />
            </div>

            <button className="primary" onClick={sendTestPattern}>
              Send Test Pattern
            </button>
          </section>

          <section className="panel test-pixel-control">
            <h2>Pixel Selection</h2>
            <p className="hint">Test individual pixels or groups. Total pixels: {totalPixels}</p>

            <div className="pixel-mode-select">
              {(["front", "back", "all"] as const).map((mode) => (
                <button
                  key={mode}
                  className={`mode-btn ${pixelMode === mode ? "active" : ""}`}
                  onClick={() => setPixelMode(mode)}
                >
                  {mode === "front"
                    ? `Front Half (0–${Math.floor(totalPixels / 2) - 1})`
                    : mode === "back"
                      ? `Back Half (${Math.floor(totalPixels / 2)}–${totalPixels - 1})`
                      : `All Pixels (0–${totalPixels - 1})`}
                </button>
              ))}
            </div>

            <div className="control-group">
              <label htmlFor="test-pixel-index">
                Pixel Index: {displayPixelIndex}
                {pixelMode !== "all" &&
                  ` (offset ${pixelIndex} within ${pixelMode} half, max ${maxPixelIndex})`}
              </label>
              <input
                id="test-pixel-index"
                type="range"
                min="0"
                max={maxPixelIndex}
                step="1"
                value={pixelIndex}
                onChange={(e) => setPixelIndex(parseInt(e.target.value, 10))}
              />
            </div>

            <div className="pixel-info">
              <p>Selected pixel: <strong>{displayPixelIndex}</strong></p>
              <p>Spoke: <strong>{Math.floor(displayPixelIndex / config.geometry.pixels_per_spoke)}</strong></p>
              <p>Position in spoke: <strong>{displayPixelIndex % config.geometry.pixels_per_spoke}</strong></p>
            </div>
          </section>

          <SacnListenerDetection config={config} status={status} />
        </>
      )}
    </div>
  );
}

function SacnListenerDetection({
  config,
  status,
}: {
  config: any;
  status: any;
}) {
  const [expanded, setExpanded] = useState(false);

  const expectedControllers = config?.output?.controllers ?? [];
  const sacnEnabled = config?.output?.enabled ?? false;
  const sacnUniverses = status?.sacn_universes ?? 0;

  return (
    <section className="panel sacn-detection">
      <div className="panel-header" onClick={() => setExpanded(!expanded)}>
        <h2>sACN Listener Detection</h2>
        <button className="ghost expand-btn">{expanded ? "▼" : "▶"}</button>
      </div>

      <p className="hint">
        {sacnEnabled
          ? `sACN is enabled and transmitting on ${sacnUniverses} universe${sacnUniverses !== 1 ? "s" : ""}.`
          : "sACN output is disabled."}
      </p>

      {expanded && (
        <div className="sacn-details">
          <div className="controller-list">
            <h3>Expected Pixlites ({expectedControllers.length})</h3>
            {expectedControllers.length === 0 ? (
              <p className="hint">No controllers configured.</p>
            ) : (
              <ul className="controller-grid">
                {expectedControllers.map((controller: string, index: number) => (
                  <li key={index} className="controller-item">
                    <span className="controller-name">{controller}</span>
                    <span className="universe-range">
                      Universe {config.output.start_universe + index}–
                      {config.output.start_universe +
                        index +
                        Math.ceil(config.output.pixels_per_universe / 3) -
                        1}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="transmission-stats">
            <h3>Transmission Stats</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="label">sACN Enabled</span>
                <span className={`value ${sacnEnabled ? "on" : "off"}`}>{sacnEnabled ? "Yes" : "No"}</span>
              </div>
              <div className="stat">
                <span className="label">Universes Active</span>
                <span className="value">{sacnUniverses}</span>
              </div>
              <div className="stat">
                <span className="label">Packets/sec</span>
                <span className="value">{status?.sacn_pps ?? 0}</span>
              </div>
            </div>

            {status?.sacn_error && (
              <div className="error-box">
                <strong>sACN Error:</strong> {status.sacn_error}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
