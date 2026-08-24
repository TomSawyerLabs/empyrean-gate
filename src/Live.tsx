// Live: the merged view + draw surface. The array view is always as large as the
// window allows; the controls flow into whatever space the aspect ratio leaves —
// side columns when wide, top/bottom bars when tall, and tucked into the corners
// (which the circle never reaches) when squarish. The empty ring center carries
// the title and live status. Tap anywhere = burst, or the selected shape stamped
// where it landed; drag = draw with the pen.
//
// v0.5.0 through v0.5.7 replaced this with a drag-and-resize "control deck" grid.
// It was more layout to maintain than it was worth, and the circle stopped being
// the largest thing the window could hold. The mode switch here is pure CSS
// (aspect-ratio media queries), so it is right at first paint with no resize
// observer to get wrong.

import { useEffect, useRef, useState } from "react";
import { EFFECTS, GROW_MODES, growValue, isShape, SHAPES, type GrowMode } from "./effects";
import GateCanvas from "./GateCanvas";
import CustomColorPicker from "./CustomColorPicker";
import { QuickSettingsEditor, QuickSettingsPanel } from "./LiveQuickSettings";
import {
  BUILTIN_LIVE_COLORS,
  loadCustomLiveColors,
  loadSelectedLiveColor,
  saveCustomLiveColors,
  saveSelectedLiveColor,
  type LiveColor,
} from "./liveColors";
import { loadQuickSettings, saveQuickSettings } from "./quickSettings";
import { contenders } from "./sacnPeers";
import ShapeIcon from "./ShapeIcon";
import Sparkbars from "./Sparkbars";
import { useGate, useThrottled } from "./state";
import ToolIcon, { type ToolKind } from "./ToolIcon";
import type { RenderConfig, ShapeKind } from "./types";

/** What a press on the array does: fire a burst, draw with a pen, or stamp a
 *  shape. One tool at a time — the canvas has no gesture guessing. */
type LiveTool = ToolKind | ShapeKind;

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

export default function Live() {
  const { client, config, status, beatAt } = useGate();
  const [tool, setTool] = useState<LiveTool>("tap");
  const [growMode, setGrowMode] = useState<GrowMode>("static");
  const [color, setColor] = useState<LiveColor>(loadSelectedLiveColor);
  const [customColors, setCustomColors] = useState<LiveColor[]>(loadCustomLiveColors);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [size, setSize] = useState(0.12);
  const [queuePos, setQueuePos] = useState(0);
  const [brightness, setBrightnessLocal] = useState(1);
  const [masterSpeed, setMasterSpeedLocal] = useState(1);
  const [shortcuts, setShortcuts] = useState(loadQuickSettings);
  const [shortcutEditorId, setShortcutEditorId] = useState<string | null>(null);
  const [editingShortcuts, setEditingShortcuts] = useState(false);
  // Squarish windows have no leftover width for a column, so the controls that
  // do not fit a canvas corner live behind this toggle. It is display:none in
  // every other mode — there the side columns already show everything.
  const [showMore, setShowMore] = useState(false);
  const beatDotRef = useRef<HTMLDivElement>(null);

  const setBrightness = useThrottled((value: number) =>
    client.setMaster({ brightness: value }),
  );
  const setMasterSpeed = useThrottled((value: number) => client.setMaster({ speed: value }));

  useEffect(() => {
    saveCustomLiveColors(customColors);
  }, [customColors]);

  useEffect(() => {
    saveSelectedLiveColor(color);
  }, [color]);

  useEffect(() => {
    saveQuickSettings(shortcuts);
  }, [shortcuts]);

  useEffect(() => {
    if (!config) return;
    setBrightnessLocal(config.render.master_brightness);
    setMasterSpeedLocal(config.render.master_speed);
  }, [config?.render.master_brightness, config?.render.master_speed]);

  // Viewer-slot queue: >0 means the preview is rationed and we're waiting.
  useEffect(() => {
    return client.onMessage((m) => {
      if (m.type === "preview_queue") setQueuePos(m.position);
    });
  }, [client]);

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

  const multiplier =
    config?.render.beat_time === "half" ? 0.5 : config?.render.beat_time === "double" ? 2 : 1;
  const activeSource = status?.audio.find((a) => a.active);
  const effectiveAutoBpm = status?.rhythm?.bpm ?? activeSource?.bpm ?? 0;
  const inferredBpm = effectiveAutoBpm / multiplier;
  const manualBpm = config?.render.manual_bpm ?? null;
  const bpm = manualBpm !== null ? manualBpm * multiplier : effectiveAutoBpm;
  const externalClockTrusted = Boolean(
    status?.rhythm?.active &&
    !status.rhythm?.using_fallback &&
    (status.rhythm?.source === "midi_clock" || status.rhythm?.source === "pro_dj_link"),
  );
  // External clocks are authoritative. Audio-derived estimates still need enough
  // confidence to avoid presenting noise as a real tempo.
  const bpmTrusted = manualBpm !== null || externalClockTrusted || (activeSource?.bpm_confidence ?? 0) >= 0.35;

  const setTempo = (patch: Partial<Pick<RenderConfig, "beat_time" | "manual_bpm">>) => {
    if (!config) return;
    client.setConfig({ ...config, render: { ...config.render, ...patch } });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }
      // A shape key arms the array the same way its pad does, rather than firing
      // one somewhere arbitrary — where a figure lands is the whole point of it.
      const shape = SHAPES.find((s) => s.key === e.key.toLowerCase());
      if (shape) {
        e.preventDefault();
        setTool((current) => (current === shape.kind ? "tap" : shape.kind));
        return;
      }
      const beatTime =
        e.key === "-" || e.code === "NumpadSubtract"
          ? "half"
          : e.key === "+" || e.code === "NumpadAdd"
            ? "double"
            : e.key === "="
              ? "normal"
              : null;
      if (!beatTime) return;
      e.preventDefault();
      setTempo({ beat_time: beatTime });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [config, client]);

  const shapeTool: ShapeKind | null = isShape(tool) ? tool : null;
  const penTool = tool === "tap" || isShape(tool) ? null : tool;

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
          onClick={() => client.triggerEffect({
            kind: e.kind,
            angle: Math.random() * Math.PI * 2,
            hue: color.hue,
            saturation: color.saturation,
            brightness: color.brightness,
          })}
        >
          {e.label}
          <span className="key-hint">{e.key}</span>
        </button>
      ))}
    </div>
  );

  // Shapes are placed, not fired: picking one arms the array so every press
  // stamps that figure where it lands, at the Size slider's size.
  const shapes = (
    <div className="cluster shapes" aria-label="Shapes">
      <div className="shape-grid">
        {SHAPES.map((s) => (
          <button
            key={s.kind}
            className={`shape-btn ${tool === s.kind ? "active" : ""}`}
            onClick={() => setTool(s.kind)}
            aria-pressed={tool === s.kind}
          >
            <ShapeIcon kind={s.kind} />
            {s.label}
            <span className="key-hint">{s.key}</span>
          </button>
        ))}
      </div>
      <div className="shape-grow-row" role="group" aria-label="Stamp size over time">
        {GROW_MODES.map((m) => (
          <button
            key={m.mode}
            className={growMode === m.mode ? "active" : ""}
            onClick={() => setGrowMode(m.mode)}
            aria-pressed={growMode === m.mode}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="cluster-hint">
        {shapeTool ? "Tap the array to stamp" : "Pick a shape, then tap the array"}
      </p>
    </div>
  );

  const colors = (
    <div className="cluster swatches">
      {[...BUILTIN_LIVE_COLORS, ...customColors].map((entry) => (
        <button
          key={entry.id}
          className={`swatch ${color.id === entry.id ? "active" : ""}`}
          style={{ background: entry.hex }}
          onClick={() => setColor(entry)}
          aria-label={entry.label}
        />
      ))}
      <button
        className="swatch custom-color-button"
        onClick={() => setShowColorPicker(true)}
        aria-label="Choose and save a custom color"
      >
        +
      </button>
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

  const tempoCtl = config ? (
    <div className="cluster tempo-menu" aria-label="Lighting tempo">
      <div className="tempo-time-grid">
        {([
          { time: "half", label: "Half", key: "−" },
          { time: "normal", label: "1×", key: "=" },
          { time: "double", label: "Double", key: "+" },
        ] as const).map(({ time, label, key }) => (
          <button
            key={time}
            className={`effect-btn ${config.render.beat_time === time ? "active" : ""}`}
            onClick={() => setTempo({ beat_time: time })}
            aria-label={`${label} time`}
          >
            {label}
            <span className="key-hint">{key}</span>
          </button>
        ))}
      </div>
      <div className="tempo-mode-row">
        <button
          className={manualBpm === null ? "active" : ""}
          onClick={() => setTempo({ manual_bpm: null })}
        >
          Auto
        </button>
        <button
          className={manualBpm !== null ? "active" : ""}
          onClick={() =>
            setTempo({ manual_bpm: Math.round(Math.min(240, Math.max(10, inferredBpm || 120))) })
          }
        >
          Manual
        </button>
      </div>
      {manualBpm !== null && (
        <label className="tempo-slider">
          <input
            type="range"
            min={10}
            max={240}
            step={1}
            value={manualBpm}
            onChange={(e) => setTempo({ manual_bpm: Number(e.target.value) })}
          />
          <span>{manualBpm.toFixed(0)}</span>
        </label>
      )}
    </div>
  ) : null;

  const master = config ? (
    <div className="cluster master-ctl">
      <label className="slider-row">
        <span>Brightness</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={brightness}
          onChange={(event) => {
            const value = Number(event.target.value);
            setBrightnessLocal(value);
            setBrightness(value);
          }}
        />
        <span className="slider-val">{brightness.toFixed(2)}</span>
      </label>
      <label className="slider-row">
        <span>Speed</span>
        <input
          type="range"
          min={0}
          max={4}
          step={0.05}
          value={masterSpeed}
          onChange={(event) => {
            const value = Number(event.target.value);
            setMasterSpeedLocal(value);
            setMasterSpeed(value);
          }}
        />
        <span className="slider-val">{masterSpeed.toFixed(2)}×</span>
      </label>
    </div>
  ) : null;

  // The deck put the shortcut editor behind a widget handle that only existed in
  // deck-edit mode. With the deck gone the cluster carries its own toggle: a mode
  // switch rather than a long-press, because a "hold" shortcut already owns the
  // long press.
  const quick = (
    <div className={`cluster quick-ctl ${editingShortcuts ? "editing" : ""}`}>
      <QuickSettingsPanel
        shortcuts={shortcuts}
        editing={editingShortcuts}
        onEdit={(id) => setShortcutEditorId(id)}
      />
      {shortcuts.length > 0 && (
        <div className="quick-settings-actions">
          <button
            className={editingShortcuts ? "active" : ""}
            aria-pressed={editingShortcuts}
            onClick={() => setEditingShortcuts((current) => !current)}
          >
            {editingShortcuts ? "✓ Done" : "✎ Edit"}
          </button>
          <button onClick={() => setShortcutEditorId("")}>+ Add</button>
        </div>
      )}
    </div>
  );

  const layers = config ? (
    <div className="cluster live-layer-list">
      {config.layers.map((layer, index) => (
        <button
          key={`${layer.name}-${index}`}
          className={layer.enabled ? "active" : ""}
          onClick={() => client.updateLayer(index, { ...layer, enabled: !layer.enabled })}
        >
          <span className="live-layer-dot" />
          <span>{layer.name || `Layer ${index + 1}`}</span>
        </button>
      ))}
    </div>
  ) : null;

  const showStatus = (
    <div className="cluster live-status-grid">
      <div><strong>{bpm > 0 ? bpm.toFixed(0) : "—"}</strong><span>BPM</span></div>
      <div><strong>{status?.engine_fps.toFixed(0) ?? "—"}</strong><span>FPS</span></div>
      <div><strong>{status?.sacn_enabled ? status.sacn_pps : "off"}</strong><span>sACN pkt/s</span></div>
      <div><strong>{status?.clients ?? "—"}</strong><span>clients</span></div>
    </div>
  );

  // Ring chip state: contention outranks "enabled but nothing on the wire",
  // which outranks the ordinary healthy case.
  const contested = contenders(status?.sacn_peers ?? []);
  const outputLevel =
    contested.length > 0 ? "contended" : status?.sacn_pps === 0 ? "stalled" : "live";

  const canvas = (
    <div className="live-canvas-wrap">
      <GateCanvas
        drawPen={penTool === null ? undefined : {
          pen: penTool,
          hue: color.hue,
          saturation: color.saturation,
          brightness: color.brightness,
          size,
          intensity: 1,
        }}
        onTap={
          tool === "tap" || shapeTool
            ? (angle, radius) =>
                client.triggerEffect({
                  kind: shapeTool ?? "burst",
                  angle,
                  radius,
                  hue: color.hue,
                  saturation: color.saturation,
                  brightness: color.brightness,
                  // The slider is a pen radius; 0.12 is its default, so a
                  // centred slider means "1×" for everything triggered by a tap.
                  size: size / 0.12,
                  grow: shapeTool ? growValue(growMode) : 0,
                })
            : undefined
        }
      />
      {queuePos > 0 && (
        <div className="queue-banner">
          Live view is full — you're #{queuePos} in line. Taps, drawing, and effects
          still reach the lights!
        </div>
      )}
      <div className="ring-center">
        <div className="ring-title">Empyrean Gate</div>
        <div className="ring-status">
          <div ref={beatDotRef} className="beat-dot" />
          <span>
            {bpm > 0 && bpmTrusted
              ? `${bpm.toFixed(0)} BPM${manualBpm !== null ? " manual" : status?.rhythm?.using_fallback ? " fallback" : status?.rhythm?.source === "midi_clock" ? " MIDI" : status?.rhythm?.source === "pro_dj_link" ? " LINK" : ""}`
              : bpm > 0
                ? "finding beat…"
                : "no beat"}
          </span>
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
        {status?.sacn_enabled && (
          // Quiet when everything is fine, loud only when something else is
          // driving the rig. The detail lives in the app-wide banner; there is
          // room for a verdict here, not an explanation.
          <span className={`ring-output ${outputLevel}`}>
            <span className="ring-output-dot" />
            {outputLevel === "contended"
              ? contested.length === 1
                ? "1 rival source"
                : `${contested.length} rival sources`
              : outputLevel === "stalled"
                ? "sACN idle"
                : "sACN"}
          </span>
        )}
      </div>
      {/* Square-ish windows: controls float in the corners the circle never
          reaches. Visibility is pure CSS (aspect-ratio media queries), so the
          layout is right at first paint with no resize-observer fragility. */}
      <div className="corner-stack tl">
        <div className="corner-card">{pens}</div>
        <div className="corner-card">{shapes}</div>
      </div>
      <div className="corner-stack tr">
        <div className="corner-card">{effects}</div>
        <div className="corner-card">{tempoCtl}</div>
      </div>
      <div className="corner bl">{colors}</div>
      <div className="corner br">{sizeCtl}</div>
      {/* Squarish only: four corners cannot hold ten clusters, so this reveals
          the side columns as an overlay sheet instead of duplicating them. */}
      <button
        className="live-more-toggle"
        aria-expanded={showMore}
        onClick={() => setShowMore((current) => !current)}
      >
        {showMore ? "× Close controls" : "⋯ All controls"}
      </button>
    </div>
  );

  return (
    <div className={`live-page ${showMore ? "more-open" : ""}`}>
      {/* Brush size sits with the brushes, not with the palette — and it evens
          the two columns out, which is what keeps column B from overflowing on
          an iPad in landscape. */}
      <div className="live-side a">
        {pens}
        {shapes}
        {sizeCtl}
        {effects}
        {tempoCtl}
      </div>
      {canvas}
      <div className="live-side b">
        {colors}
        {/* `display: contents` wherever there is room, so these sit in the column
            grid like any other cluster. Where there isn't — a portrait tablet,
            a squarish window — they collapse into the "All controls" sheet
            instead of eating the height the array wants. */}
        <div className="live-extras">
          {master}
          {quick}
          {layers}
          {showStatus}
        </div>
      </div>
      {shortcutEditorId !== null && (
        <QuickSettingsEditor
          shortcuts={shortcuts}
          initialId={shortcutEditorId}
          onClose={() => setShortcutEditorId(null)}
          onChange={setShortcuts}
        />
      )}
      {showColorPicker && (
        <CustomColorPicker
          colors={customColors}
          initialHex={color.hex}
          onClose={() => setShowColorPicker(false)}
          onRemove={(id) => {
            setCustomColors((current) => current.filter((entry) => entry.id !== id));
            if (color.id === id) setColor(BUILTIN_LIVE_COLORS[5]);
          }}
          onSave={(next) => {
            const existing = customColors.find((entry) => entry.hex === next.hex);
            const saved = existing ?? next;
            if (!existing) setCustomColors((current) => [...current, next].slice(-24));
            setColor(saved);
            setShowColorPicker(false);
          }}
        />
      )}
    </div>
  );
}
