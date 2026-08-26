import { useEffect, useRef, useState } from "react";
import { useThrottled } from "./state";
import {
  BLEND_MODES,
  LAYER_KINDS,
  LAYER_LABELS,
  PARAM_LABELS,
  type LayerCfg,
  type LayerKind,
} from "./types";

function ReadySlider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return <label className="slider-row">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(event) => onChange(Number(event.target.value))} />
    <span className="slider-val">{value.toFixed(2)}</span>
  </label>;
}

export default function ReadyLayerEditor({
  layer,
  index,
  audioSources,
  onChange,
  onMove,
  onRemove,
}: {
  layer: LayerCfg;
  index: number;
  audioSources: string[];
  onChange: (layer: LayerCfg) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [local, setLocal] = useState(layer);
  const dragging = useRef(false);
  const throttledChange = useThrottled(onChange, 100);
  useEffect(() => {
    if (!dragging.current) setLocal(layer);
  }, [layer]);

  const update = (patch: Partial<LayerCfg>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    throttledChange(next);
  };
  const params = PARAM_LABELS[local.kind] ?? [];

  return <details className={`ready-layer-editor layer-card ${local.enabled ? "" : "disabled"}`}>
    <summary>
      <span className={`ready-layer-power ${local.enabled ? "on" : ""}`} aria-hidden="true" />
      <strong>{local.name || LAYER_LABELS[local.kind]}</strong>
      <span>{LAYER_LABELS[local.kind]} · layer {index + 1}</span>
      <i>Configure</i>
    </summary>
    <div className="ready-layer-body"
      onPointerDown={() => (dragging.current = true)}
      onPointerUp={() => (dragging.current = false)}>
      <div className="ready-layer-structure">
        <label className="toggle-row"><input type="checkbox" checked={local.enabled}
          onChange={(event) => update({ enabled: event.target.checked })} />Enabled</label>
        <label className="field-row"><span>Name</span><input value={local.name}
          onChange={(event) => update({ name: event.target.value })} /></label>
        <label className="field-row"><span>Kind</span><select value={local.kind}
          onChange={(event) => update({ kind: event.target.value as LayerKind })}>
          {LAYER_KINDS.map((kind) => <option key={kind} value={kind}>{LAYER_LABELS[kind]}</option>)}
        </select></label>
        <label className="field-row"><span>Blend</span><select value={local.blend}
          onChange={(event) => update({ blend: event.target.value as LayerCfg["blend"] })}>
          {BLEND_MODES.map((blend) => <option key={blend} value={blend}>{blend}</option>)}
        </select></label>
        <label className="field-row"><span>Audio source</span><select value={local.audio_source}
          onChange={(event) => update({ audio_source: Number(event.target.value) })}>
          {Array.from({ length: Math.max(audioSources.length, 1) }, (_, source) =>
            <option key={source} value={source}>{audioSources[source] ?? `src ${source}`}</option>)}
        </select></label>
        <div className="ready-layer-actions">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)}>Move up</button>
          <button type="button" onClick={() => onMove(1)}>Move down</button>
          <button type="button" className="danger" onClick={onRemove}>Remove</button>
        </div>
      </div>
      <div className="ready-layer-sliders">
        <section><h4>Mix</h4>
          <ReadySlider label="Opacity" value={local.opacity} onChange={(value) => update({ opacity: value })} />
          <ReadySlider label="Brightness" value={local.brightness} max={2} onChange={(value) => update({ brightness: value })} />
        </section>
        <section><h4>Motion</h4>
          <ReadySlider label="Speed" value={local.speed} min={-4} max={4} onChange={(value) => update({ speed: value })} />
          <ReadySlider label="Scale" value={local.scale} min={0.05} max={5} onChange={(value) => update({ scale: value })} />
          <ReadySlider label="Walk" value={local.walk_amount} onChange={(value) => update({ walk_amount: value })} />
        </section>
        <section><h4>Colour</h4>
          <ReadySlider label="Hue" value={local.hue} onChange={(value) => update({ hue: value })} />
          <ReadySlider label="Hue range" value={local.hue_range} onChange={(value) => update({ hue_range: value })} />
          <ReadySlider label="Saturation" value={local.saturation} onChange={(value) => update({ saturation: value })} />
        </section>
        <section><h4>Input</h4>
          <ReadySlider label="Audio" value={local.audio_amount} onChange={(value) => update({ audio_amount: value })} />
          <ReadySlider label="Tilt (IMU)" value={local.tilt_amount} onChange={(value) => update({ tilt_amount: value })} />
        </section>
        {params.length > 0 && <section><h4>{LAYER_LABELS[local.kind]} parameters</h4>
          {(["param_a", "param_b", "param_c", "param_d"] as const).map((key, parameter) =>
            params[parameter] ? <ReadySlider key={key} label={params[parameter]} value={local[key]}
              onChange={(value) => update({ [key]: value })} /> : null)}
        </section>}
      </div>
    </div>
  </details>;
}
