import { useEffect, useMemo, useState } from "react";
import GateCanvas, { type GatePreviewSource } from "./GateCanvas";
import { SCENE_PRESETS, type ScenePreset } from "./scenes";
import { useGate } from "./state";
import type { PreviewMeta, SavedStack } from "./types";
import { defaultDjLinkEffects } from "./djLinkEffects";

function stackFromScene(scene: ScenePreset): SavedStack {
  return {
    id: `built-in-${scene.id}`,
    name: scene.name,
    layers: scene.layers.map((layer) => ({ ...layer })),
    master_speed: scene.masterSpeed,
    walk_enabled: true,
    walk_layers: false,
    walk_min_layers: 1,
    walk_speed: scene.walkSpeed,
    walk_depth: scene.walkDepth,
    dj_link_effects: defaultDjLinkEffects(),
  };
}

const signature = (layers: SavedStack["layers"]) => JSON.stringify(layers);

export default function Ready() {
  const { client, config, status } = useGate();
  const [decimate] = useState(() => window.innerWidth < 900 ? 2 : 1);

  useEffect(() => {
    const subscribe = () => {
      const local = client.httpBase.includes("127.0.0.1") || client.httpBase.includes("localhost");
      client.subscribePreview(local ? 60 : 24, decimate, true);
    };
    subscribe();
    const offStatus = client.onStatus((connected) => connected && subscribe());
    return () => {
      offStatus();
      client.send({ type: "unsubscribe_preview" });
    };
  }, [client, decimate]);

  const meta = useMemo<PreviewMeta | null>(() => config ? ({
    spokes: config.geometry.spokes,
    pixels: Math.ceil(config.geometry.pixels_per_spoke / decimate),
    decimate,
    outer_radius_ft: config.geometry.outer_radius_ft,
    inner_radius_ft: config.geometry.inner_radius_ft,
  }) : null, [config, decimate]);
  const programSource = useMemo<GatePreviewSource | null>(() => meta ? ({
    meta, subscribe: (listener) => client.onFrame(listener),
  }) : null, [client, meta]);
  const readySource = useMemo<GatePreviewSource | null>(() => meta ? ({
    meta, subscribe: (listener) => client.onReadyFrame(listener),
  }) : null, [client, meta]);

  if (!config || !meta || !programSource || !readySource) return null;

  const ready = config.ready_stack;
  const saved = config.saved_stacks ?? [];
  const programSignature = signature(config.layers);
  const programName = saved.find((stack) => signature(stack.layers) === programSignature)?.name
    ?? SCENE_PRESETS.find((scene) => signature(scene.layers) === programSignature)?.name
    ?? (config.active_patch ? "Active patch" : "Live composition");
  const prepare = (stack: SavedStack) => client.prepareStack(structuredClone(stack));
  const updateReady = (patch: Partial<SavedStack>) => ready && prepare({ ...ready, ...patch });

  return (
    <div className="ready-page">
      <header className="ready-header">
        <div><p className="eyebrow">Scene switcher</p><h2>Prepare off air. Take when it&apos;s right.</h2></div>
        <label className="ready-transition">
          <span>Crossfade</span>
          <input type="range" min={0} max={10} step={0.25} value={config.render.manual_transition_secs}
            onChange={(event) => client.setConfig({ ...config, render: { ...config.render, manual_transition_secs: Number(event.target.value) } })} />
          <output>{config.render.manual_transition_secs.toFixed(2)} s</output>
        </label>
      </header>

      <div className="bus-switcher">
        <section className="bus-card program">
          <div className="bus-head"><div><span className="bus-letter">A</span><div><small>PROGRAM · ON GATE</small><strong>{programName}</strong></div></div><i className="bus-live">LIVE</i></div>
          <div className="bus-preview"><GateCanvas previewSource={programSource} /></div>
        </section>

        <div className="take-column">
          <div className="take-flow" aria-hidden="true">B <span>→</span> A</div>
          <button className="take-button" disabled={!ready || status?.render_transition_active} onClick={() => ready && client.takeReady(ready.id)}>
            {status?.render_transition_active ? "TAKING…" : "TAKE"}
          </button>
          <small>{ready ? "Swaps Program and Ready" : "Load a scene first"}</small>
        </div>

        <section className="bus-card ready">
          <div className="bus-head"><div><span className="bus-letter">B</span><div><small>READY · OFF AIR</small><strong>{ready?.name ?? "No scene loaded"}</strong></div></div><i className="bus-safe">SAFE</i></div>
          <div className={`bus-preview ${ready ? "" : "empty"}`}>
            {ready ? <GateCanvas previewSource={readySource} /> : <p>Choose a scene below. Nothing here can affect the Gate until Take.</p>}
          </div>
        </section>
      </div>

      {ready && (
        <section className="ready-tuning panel">
          <div className="ready-tuning-head">
            <div><p className="eyebrow">Bus B adjustments</p><h3>{ready.name}</h3></div>
            <label><span>Motion</span><input type="range" min={0.05} max={2} step={0.05} value={ready.master_speed}
              onChange={(event) => updateReady({ master_speed: Number(event.target.value) })} /><output>{ready.master_speed.toFixed(2)}×</output></label>
          </div>
          <div className="ready-layer-strip">
            {ready.layers.map((layer, index) => (
              <label key={`${layer.name}-${index}`} className={layer.enabled ? "enabled" : ""}>
                <input type="checkbox" checked={layer.enabled} onChange={(event) => updateReady({
                  layers: ready.layers.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item),
                })} />
                <span>{layer.name || layer.kind.replaceAll("_", " ")}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="scene-tray">
        <div className="scene-tray-head"><div><p className="eyebrow">Load into Bus B</p><h3>Scene library</h3></div><span>Selection is off air</span></div>
        <div className="scene-tray-grid">
          {saved.map((stack) => <button key={stack.id} className={ready?.id === stack.id ? "active" : ""} onClick={() => prepare(stack)}>
            <small>YOUR SCENE</small><strong>{stack.name}</strong><span>{stack.layers.length} layers</span>
          </button>)}
          {SCENE_PRESETS.map((scene) => <button key={scene.id} className={ready?.id === `built-in-${scene.id}` ? "active" : ""} onClick={() => prepare(stackFromScene(scene))}>
            <span className="scene-tray-palette">{scene.palette.map((color) => <i key={color} style={{ background: color }} />)}</span>
            <small>STARTING POINT</small><strong>{scene.name}</strong><span>{scene.layers.length} layers</span>
          </button>)}
        </div>
      </section>
    </div>
  );
}
