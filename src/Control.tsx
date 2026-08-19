// Control tab: performance surface — effect pads, master faders, and per-layer
// quick faders. Built for touch (big targets), works everywhere.

import { useEffect, useState } from "react";
import { EFFECTS } from "./effects";
import Sparkbars from "./Sparkbars";
import { useGate, useThrottled } from "./state";
import { LAYER_LABELS } from "./types";

export default function Control() {
  const { client, config, status } = useGate();
  const setBrightness = useThrottled((v: number) => client.setMaster({ brightness: v }));
  const setSpeed = useThrottled((v: number) => client.setMaster({ speed: v }));
  const setRender = useThrottled((patch: Partial<NonNullable<typeof config>["render"]>) => {
    if (config) {
      client.setConfig({ ...config, render: { ...config.render, ...patch } });
    }
  });

  // Local mirror of master sliders so they track remote changes when idle.
  const [brightness, setBrightnessLocal] = useState(1);
  const [speed, setSpeedLocal] = useState(1);
  useEffect(() => {
    if (config) {
      setBrightnessLocal(config.render.master_brightness);
      setSpeedLocal(config.render.master_speed);
    }
  }, [config]);

  return (
    <div className="control-page">
      <section className="panel">
        <h2>Effects</h2>
        <div className="effect-row big">
          {EFFECTS.map((e) => (
            <button
              key={e.kind}
              className="effect-btn"
              onClick={() =>
                client.triggerEffect({ kind: e.kind, angle: Math.random() * Math.PI * 2 })
              }
            >
              {e.label}
              <span className="key-hint">{e.key}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Master</h2>
        <label className="slider-row">
          <span>Brightness</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={brightness}
            onChange={(e) => {
              const v = Number(e.target.value);
              setBrightnessLocal(v);
              setBrightness(v);
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
            value={speed}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSpeedLocal(v);
              setSpeed(v);
            }}
          />
          <span className="slider-val">{speed.toFixed(2)}</span>
        </label>
        {status?.sacn_enabled && (
          <p className="warn">
            sACN output is LIVE{" "}
            <Sparkbars
              data={status.pps_history}
              color="#7c5cff"
              label="pkt/s"
              value={String(status.sacn_pps)}
              warn={status.sacn_pps === 0}
            />
          </p>
        )}
        {status && (
          <Sparkbars
            data={status.fps_history}
            color="#38d1c2"
            label="fps"
            value={String(status.fps_history.at(-1) ?? 0)}
          />
        )}
      </section>

      <section className="panel">
        <h2>Autopilot</h2>
        <p className="hint">
          Slow random walk across layer parameters so the show evolves for hours
          unattended. Each layer's "Walk" slider (Settings) limits how far its
          parameters may wander from where you set them.
        </p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config?.render.walk_enabled ?? true}
            onChange={(e) => setRender({ walk_enabled: e.target.checked })}
          />
          Enabled
        </label>
        <label className="slider-row">
          <span>Walk speed</span>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            defaultValue={config?.render.walk_speed ?? 1}
            onChange={(e) => setRender({ walk_speed: Number(e.target.value) })}
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config?.render.walk_layers ?? false}
            onChange={(e) => setRender({ walk_layers: e.target.checked })}
          />
          Walk which layers play (one fades in or out per step)
        </label>
        {config?.render.walk_layers && (
          <label className="field-row" style={{ maxWidth: 280 }}>
            <span>Minimum layers on</span>
            <input
              type="number"
              min={1}
              max={24}
              value={config.render.walk_min_layers}
              onChange={(e) =>
                setRender({ walk_min_layers: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
        )}
      </section>

      <section className="panel">
        <h2>Layers</h2>
        {config?.layers.map((l, i) => (
          <LayerFader key={i} index={i} name={l.name || LAYER_LABELS[l.kind]} />
        ))}
      </section>
    </div>
  );
}

function LayerFader({ index, name }: { index: number; name: string }) {
  const { client, config } = useGate();
  const layer = config?.layers[index];
  const [value, setValue] = useState(layer?.opacity ?? 1);
  const [enabled, setEnabled] = useState(layer?.enabled ?? true);
  useEffect(() => {
    if (layer) {
      setValue(layer.opacity);
      setEnabled(layer.enabled);
    }
    // Only resync when the backend's values change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.opacity, layer?.enabled]);
  const send = useThrottled((patch: { opacity?: number; enabled?: boolean }) => {
    if (layer) client.updateLayer(index, { ...layer, ...patch });
  });
  if (!layer) return null;
  return (
    <label className="slider-row">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => {
          setEnabled(e.target.checked);
          send({ enabled: e.target.checked, opacity: value });
        }}
      />
      <span>{name}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          setValue(v);
          send({ opacity: v, enabled });
        }}
      />
      <span className="slider-val">{value.toFixed(2)}</span>
    </label>
  );
}
