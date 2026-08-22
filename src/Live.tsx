// Live: the merged view + draw surface. The array view is always as large as the
// window allows; the controls flow into whatever space the aspect ratio leaves —
// side columns when wide, top/bottom bars when tall, and tucked into the corners
// (which the circle never reaches) when squarish. The empty ring center carries
// the title and live status. Tap anywhere = burst; drag = draw with the pen.

import { useEffect, useRef, useState } from "react";
import { EFFECTS } from "./effects";
import GateCanvas from "./GateCanvas";
import Sparkbars from "./Sparkbars";
import { useGate, useThrottled } from "./state";
import ToolIcon, { type ToolKind } from "./ToolIcon";
import type { RenderConfig } from "./types";

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

export default function Live() {
  const { client, config, status, beatAt } = useGate();
  const [tool, setTool] = useState<ToolKind>("tap");
  const [hue, setHue] = useState(0.5);
  const [size, setSize] = useState(0.12);
  const [queuePos, setQueuePos] = useState(0);
  const beatDotRef = useRef<HTMLDivElement>(null);
  const [masterSpeed, setMasterSpeedLocal] = useState(1);
  const sendMasterSpeed = useThrottled((v: number) => client.setMaster({ speed: v }));
  useEffect(() => {
    if (config) setMasterSpeedLocal(config.render.master_speed);
  }, [config]);

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
  const inferredBpm = (activeSource?.bpm ?? 0) / multiplier;
  const manualBpm = config?.render.manual_bpm ?? null;
  const bpm = manualBpm !== null ? manualBpm * multiplier : inferredBpm * multiplier;
  // A tempo estimate below this confidence is noise — showing it erodes trust.
  const bpmTrusted = manualBpm !== null || (activeSource?.bpm_confidence ?? 0) >= 0.35;

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
          onClick={() => client.triggerEffect({ kind: e.kind, angle: Math.random() * Math.PI * 2 })}
        >
          {e.label}
          <span className="key-hint">{e.key}</span>
        </button>
      ))}
    </div>
  );

  const colors = (
    <div className="cluster swatches">
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
      {/* Master pattern speed — scales all layer motion. Independent of the
          tempo controls, which only retime beat-driven behavior. */}
      <label className="slider-row">
        <span>Speed</span>
        <input
          type="range"
          min={0}
          max={4}
          step={0.05}
          value={masterSpeed}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMasterSpeedLocal(v);
            sendMasterSpeed(v);
          }}
        />
        <span className="slider-val">{masterSpeed.toFixed(2)}×</span>
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
            setTempo({ manual_bpm: Math.round(Math.min(240, Math.max(40, inferredBpm || 120))) })
          }
        >
          Manual
        </button>
      </div>
      {manualBpm !== null && (
        <label className="tempo-slider">
          <input
            type="range"
            min={40}
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

  const canvas = (
    <div className="live-canvas-wrap">
      <GateCanvas
        drawPen={tool === "tap" ? undefined : { pen: tool, hue, size, intensity: 1 }}
        onTap={
          tool === "tap"
            ? (angle, radius) =>
                client.triggerEffect({ kind: "burst", angle, radius, hue, size: size / 0.12 })
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
            ? `${bpm.toFixed(0)} BPM${manualBpm !== null ? " manual" : ""}`
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
        {status?.sacn_enabled && <span className="live-pill">sACN LIVE</span>}
      </div>
      {/* Square-ish windows: controls float in the corners the circle never
          reaches. Visibility is pure CSS (aspect-ratio media queries), so the
          layout is right at first paint with no resize-observer fragility. */}
      <div className="corner tl">{pens}</div>
      <div className="corner-stack tr">
        <div className="corner-card">{effects}</div>
        <div className="corner-card">{tempoCtl}</div>
      </div>
      <div className="corner bl">{colors}</div>
      <div className="corner br">{sizeCtl}</div>
    </div>
  );

  return (
    <div className="live-page">
      <div className="live-side a">
        {pens}
        {effects}
        {tempoCtl}
      </div>
      {canvas}
      <div className="live-side b">
        {colors}
        {sizeCtl}
      </div>
    </div>
  );
}
