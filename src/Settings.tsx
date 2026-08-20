// Settings: layer stack editor, geometry, audio sources, sACN output, and
// this-device remote inputs (mic / IMU).

import { useEffect, useRef, useState } from "react";
import { useGate, useThrottled } from "./state";
import { startImu, startMic } from "./sensors";
import {
  BLEND_MODES,
  LAYER_KINDS,
  LAYER_LABELS,
  PARAM_LABELS,
  defaultLayer,
  type AppConfig,
  type AudioSourceConfig,
  type LayerCfg,
  type LayerKind,
} from "./types";

export default function Settings() {
  const { config } = useGate();
  if (!config) return <p className="hint">Waiting for backend…</p>;
  return (
    <div className="settings-page">
      <LayersPanel config={config} />
      <AudioPanel config={config} />
      <OutputPanel config={config} />
      <GeometryPanel config={config} />
      <ClientsPanel />
      <ThisDevicePanel />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ClientsPanel() {
  const { client, config, status } = useGate();
  const list = status?.client_list ?? [];
  return (
    <section className="panel">
      <h2>Clients</h2>
      <p className="hint">
        Devices that have connected. Revoking kicks a device immediately and blocks its id.
        With open join (below unchecked) a determined device could rejoin with a fresh
        identity — require the join token and rotate it for a real lockout.
      </p>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={config?.server.require_token ?? false}
          onChange={(e) => client.send({ type: "set_require_token", require: e.target.checked })}
        />
        Require join token (new devices must scan the Connect QR)
        <button onClick={() => client.send({ type: "rotate_join_token" })}>Rotate token</button>
      </label>
      {list.length === 0 && <p className="hint">No devices yet — use ⊕ Connect in the top bar.</p>}
      {list.map((c) => (
        <div className="layer-head client-row" key={c.id}>
          <span className={c.connected ? "conn-dot on" : "conn-dot"} />
          <input
            defaultValue={c.name}
            onBlur={(e) => {
              if (e.target.value !== c.name) {
                client.send({ type: "rename_client", id: c.id, name: e.target.value });
              }
            }}
            style={{ width: "12em" }}
          />
          <span className="hint">{c.id === client.clientId ? "this device" : c.id}</span>
          <span className="spacer" />
          {c.revoked ? (
            <button onClick={() => client.send({ type: "unrevoke_client", id: c.id })}>
              Restore
            </button>
          ) : (
            <button
              className="danger"
              onClick={() => client.send({ type: "revoke_client", id: c.id })}
            >
              Revoke
            </button>
          )}
          {!c.connected && (
            <button className="danger" onClick={() => client.send({ type: "forget_client", id: c.id })}>
              Forget
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Slider({
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
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-val">{value.toFixed(2)}</span>
    </label>
  );
}

function NumberField({
  label,
  value,
  onCommit,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="field-row">
      <span>{label}</span>
      <input
        type="number"
        value={text}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number(text);
          if (!Number.isNaN(v) && v !== value) onCommit(v);
        }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------

function LayerEditor({ layer, index }: { layer: LayerCfg; index: number }) {
  const { client, config } = useGate();
  const throttledUpdate = useThrottled(
    (l: LayerCfg) => client.updateLayer(index, l),
    100,
  );
  // Local mirror so sliders feel instant while updates stream out.
  const [local, setLocal] = useState(layer);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocal(layer);
  }, [layer]);

  const up = (patch: Partial<LayerCfg>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    throttledUpdate(next);
  };

  const params = PARAM_LABELS[local.kind] ?? [];
  const sourceCount = config?.audio.sources.length ?? 1;

  return (
    <div
      className={`layer-card ${local.enabled ? "" : "disabled"}`}
      onPointerDown={() => (dragging.current = true)}
      onPointerUp={() => (dragging.current = false)}
    >
      <div className="layer-head">
        <input
          type="checkbox"
          checked={local.enabled}
          onChange={(e) => up({ enabled: e.target.checked })}
        />
        <select
          value={local.kind}
          onChange={(e) => up({ kind: e.target.value as LayerKind })}
        >
          {LAYER_KINDS.map((k) => (
            <option key={k} value={k}>
              {LAYER_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          value={local.blend}
          onChange={(e) => up({ blend: e.target.value as LayerCfg["blend"] })}
        >
          {BLEND_MODES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select
          value={local.audio_source}
          onChange={(e) => up({ audio_source: Number(e.target.value) })}
        >
          {Array.from({ length: Math.max(sourceCount, 1) }, (_, i) => (
            <option key={i} value={i}>
              {config?.audio.sources[i]?.id ?? `src ${i}`}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button onClick={() => client.moveLayer(index, Math.max(0, index - 1))}>↑</button>
        <button onClick={() => client.moveLayer(index, index + 1)}>↓</button>
        <button className="danger" onClick={() => client.removeLayer(index)}>
          ✕
        </button>
      </div>
      <div className="layer-sliders">
        <Slider label="Opacity" value={local.opacity} onChange={(v) => up({ opacity: v })} />
        <Slider label="Speed" value={local.speed} min={-4} max={4} onChange={(v) => up({ speed: v })} />
        <Slider label="Scale" value={local.scale} min={0.05} max={5} onChange={(v) => up({ scale: v })} />
        <Slider label="Audio" value={local.audio_amount} onChange={(v) => up({ audio_amount: v })} />
        <Slider label="Hue" value={local.hue} onChange={(v) => up({ hue: v })} />
        <Slider label="Hue range" value={local.hue_range} onChange={(v) => up({ hue_range: v })} />
        <Slider label="Saturation" value={local.saturation} onChange={(v) => up({ saturation: v })} />
        <Slider label="Brightness" value={local.brightness} max={2} onChange={(v) => up({ brightness: v })} />
        <Slider label="Tilt (IMU)" value={local.tilt_amount} onChange={(v) => up({ tilt_amount: v })} />
        <Slider label="Walk" value={local.walk_amount} onChange={(v) => up({ walk_amount: v })} />
        <Slider label={params[0] ?? "Param A"} value={local.param_a} onChange={(v) => up({ param_a: v })} />
        <Slider label={params[1] ?? "Param B"} value={local.param_b} onChange={(v) => up({ param_b: v })} />
        <Slider label={params[2] ?? "Param C"} value={local.param_c} onChange={(v) => up({ param_c: v })} />
      </div>
    </div>
  );
}

function LayersPanel({ config }: { config: AppConfig }) {
  const { client } = useGate();
  const [kind, setKind] = useState<LayerKind>("noise_field");
  return (
    <section className="panel">
      <h2>Layers</h2>
      <p className="hint">Rendered bottom to top. Each layer picks an audio source to react to.</p>
      {config.layers.map((l, i) => (
        <LayerEditor key={i} layer={l} index={i} />
      ))}
      <div className="add-row">
        <select value={kind} onChange={(e) => setKind(e.target.value as LayerKind)}>
          {LAYER_KINDS.map((k) => (
            <option key={k} value={k}>
              {LAYER_LABELS[k]}
            </option>
          ))}
        </select>
        <button onClick={() => client.addLayer(defaultLayer(kind))}>Add layer</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function AudioPanel({ config }: { config: AppConfig }) {
  const { client, status } = useGate();
  const sources = config.audio.sources;

  const commit = (next: AudioSourceConfig[]) => {
    client.setConfig({ ...config, audio: { sources: next } });
  };

  const updateSource = (i: number, patch: Partial<AudioSourceConfig>) => {
    const next = sources.map((s, j) => (j === i ? ({ ...s, ...patch } as AudioSourceConfig) : s));
    commit(next);
  };

  return (
    <section className="panel">
      <h2>Audio sources</h2>
      <p className="hint">
        Up to 4 analyzed in parallel — e.g. main stage feed + a local mic. Channels lets one
        multichannel interface feed several sources (blank = mix all). Remote sources take
        features from a browser client's mic (see "This device" on the phone).
      </p>
      {sources.map((s, i) => {
        const st = status?.audio[i];
        return (
          <div className="source-card" key={i}>
            <div className="layer-head">
              <input
                value={s.id}
                onChange={(e) => updateSource(i, { id: e.target.value })}
                style={{ width: "8em" }}
              />
              <select
                value={s.kind === "device" ? (s.loopback ? "loopback" : "device") : "remote"}
                onChange={(e) => {
                  const kind = e.target.value;
                  const base = { id: s.id, gain: s.gain };
                  commit(
                    sources.map((x, j) =>
                      j === i
                        ? kind === "remote"
                          ? { ...base, kind: "remote", client_id: "" }
                          : {
                              ...base,
                              kind: "device",
                              device: null,
                              channels: [],
                              loopback: kind === "loopback",
                            }
                        : x,
                    ) as AudioSourceConfig[],
                  );
                }}
              >
                <option value="device">Input device</option>
                <option value="loopback">System output (loopback)</option>
                <option value="remote">Remote (browser mic)</option>
              </select>
              {s.kind === "device" && (
                <>
                  <select
                    value={s.device ?? ""}
                    onChange={(e) => updateSource(i, { device: e.target.value || null })}
                  >
                    <option value="">{s.loopback ? "Default output" : "System default"}</option>
                    {(s.loopback ? (status?.output_devices ?? []) : (status?.input_devices ?? [])).map(
                      (d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ),
                    )}
                  </select>
                  <input
                    placeholder="channels: blank = all"
                    defaultValue={s.channels.join(",")}
                    style={{ width: "10em" }}
                    onBlur={(e) => {
                      const channels = e.target.value
                        .split(",")
                        .map((x) => parseInt(x.trim(), 10))
                        .filter((x) => !Number.isNaN(x) && x >= 0);
                      updateSource(i, { channels });
                    }}
                  />
                  <span className="hint">0-based, e.g. 0,1 = first pair</span>
                </>
              )}
              {s.kind === "remote" && (
                <input
                  placeholder="client id"
                  value={s.client_id}
                  onChange={(e) => updateSource(i, { client_id: e.target.value })}
                  style={{ width: "10em" }}
                />
              )}
              <span className="spacer" />
              <button className="danger" onClick={() => commit(sources.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            {st && (
              <div className="meters">
                <Meter label="Level" v={st.level} />
                <Meter label="Bass" v={st.bass} />
                <Meter label="Mid" v={st.mid} />
                <Meter label="Treble" v={st.treble} />
                <span className="bpm">{st.bpm > 0 ? `${st.bpm.toFixed(0)} BPM` : "—"}</span>
                <span className={st.active ? "ok" : "warn"}>{st.active ? "active" : "inactive"}</span>
              </div>
            )}
          </div>
        );
      })}
      {sources.length < 4 && (
        <button
          onClick={() =>
            commit([
              ...sources,
              {
                id: `source-${sources.length}`,
                kind: "device",
                device: null,
                channels: [],
                loopback: false,
                gain: 1,
              },
            ])
          }
        >
          Add source
        </button>
      )}
    </section>
  );
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <span className="meter">
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${Math.min(100, v * 100)}%` }} />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------

function OutputPanel({ config }: { config: AppConfig }) {
  const { client, status } = useGate();
  const out = config.output;
  const commit = (patch: Partial<AppConfig["output"]>) =>
    client.setConfig({ ...config, output: { ...out, ...patch } });

  // LED-wire fps ceiling: 800 kbps WS281x, 24 bits/px + ~300 µs reset per frame.
  const pxPerString = config.geometry.pixels_per_spoke;
  const wireFpsCap = 1 / ((pxPerString * 30e-6) + 300e-6);

  return (
    <section className="panel">
      <h2>sACN output</h2>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={out.enabled}
          onChange={(e) => client.setSacnEnabled(e.target.checked)}
        />
        Enable sACN output
        {status &&
          (out.enabled ? (
            status.sacn_pps > 0 ? (
              <span className="live-pill">
                TRANSMITTING · {status.sacn_universes} universes · {status.sacn_pps} pkt/s
              </span>
            ) : (
              <span className="warn">⚠ enabled but nothing on the wire — check the interface below</span>
            )
          ) : (
            <span className="hint">off</span>
          ))}
      </label>
      <label className="field-row" style={{ maxWidth: 460 }}>
        <span>Network interface</span>
        <select
          value={out.interface}
          onChange={(e) => commit({ interface: e.target.value })}
          style={{ flex: 1 }}
        >
          <option value="">OS default route</option>
          {(status?.interfaces ?? []).map((i) => {
            const ip = i.split("—").pop()?.trim() ?? i;
            return (
              <option key={i} value={ip}>
                {i}
              </option>
            );
          })}
        </select>
      </label>
      <p className="hint">
        Pick the interface that is on the lighting network — multicast leaves through this NIC.
      </p>
      <label className="field-row" style={{ maxWidth: 460 }}>
        <span>Source name</span>
        <input
          type="text"
          key={out.source_name}
          defaultValue={out.source_name}
          maxLength={63}
          placeholder="Empyrean Gate"
          onBlur={(e) => commit({ source_name: e.target.value })}
          style={{ flex: 1 }}
        />
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={out.discovery}
          onChange={(e) => commit({ discovery: e.target.checked })}
        />
        Advertise our universe list on the discovery universe (64214) every 10 s
      </label>
      <p className="hint">
        Receivers and tools like sACNView identify this source by name, and by its CID{" "}
        <code>{out.cid}</code> — generated once and persistent, so a restart or a handover
        between instances looks like the <em>same</em> source instead of a second one
        fighting the first in the receiver's merge. Discovery is what makes the source and
        its universes appear in those tools; turn it off only on a network where the extra
        multicast is unwelcome.
      </p>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={out.sync_to_render}
          onChange={(e) => commit({ sync_to_render: e.target.checked })}
        />
        Sync sACN to render fps (capped by the fps field below)
      </label>
      <div className="field-grid">
        <NumberField
          label={out.sync_to_render ? "fps cap" : "Fixed fps"}
          value={out.fps}
          onCommit={(v) => commit({ fps: v })}
        />
        <NumberField
          label="Sync universe (0 = off)"
          value={out.sync_universe}
          onCommit={(v) => commit({ sync_universe: v })}
        />
        <NumberField
          label="Start universe"
          value={out.start_universe}
          onCommit={(v) => commit({ start_universe: v })}
        />
        <NumberField
          label="Pixels / universe"
          value={out.pixels_per_universe}
          onCommit={(v) => commit({ pixels_per_universe: v })}
        />
        <NumberField
          label="Strings / controller"
          value={out.strings_per_controller}
          onCommit={(v) => commit({ strings_per_controller: v })}
        />
        <NumberField
          label="LED gamma"
          value={out.led_gamma}
          step={0.1}
          onCommit={(v) => commit({ led_gamma: v })}
        />
        <NumberField label="Priority" value={out.priority} onCommit={(v) => commit({ priority: v })} />
      </div>
      <p className="hint">
        LED-wire ceiling at {pxPerString} px/string: ~{wireFpsCap.toFixed(0)} fps (800 kbps ×
        24 bits/px + reset). Ethernet is not the limit. Sync universe uses E1.31 universe
        synchronization — PixLite Mk4 latches all universes on the sync packet (tear-free);
        receivers without support ignore it.
      </p>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={out.multicast}
          onChange={(e) => commit({ multicast: e.target.checked })}
        />
        Multicast (239.255.x.x) — standard; needs IGMP-snooping switch to avoid flooding.
        Unicast IPs below are optional.
      </label>
      <label className="field-col">
        <span>Controller IPs (one per line, in spoke order; controller N drives spokes N×4…N×4+3)</span>
        <textarea
          rows={6}
          defaultValue={out.controllers.join("\n")}
          onBlur={(e) =>
            commit({
              controllers: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            })
          }
          placeholder={"10.0.0.101\n10.0.0.102\n…"}
        />
      </label>
    </section>
  );
}

// ---------------------------------------------------------------------------

function GeometryPanel({ config }: { config: AppConfig }) {
  const { client } = useGate();
  const g = config.geometry;
  const commit = (patch: Partial<AppConfig["geometry"]>) =>
    client.setConfig({ ...config, geometry: { ...g, ...patch } });

  const stripFt = (g.pixels_per_spoke / g.leds_per_meter) * 3.28084;
  const spanFt = g.outer_radius_ft - g.inner_radius_ft;

  return (
    <section className="panel">
      <h2>Geometry</h2>
      <div className="field-grid">
        <NumberField label="Spokes" value={g.spokes} onCommit={(v) => commit({ spokes: v })} />
        <NumberField
          label="Pixels / spoke"
          value={g.pixels_per_spoke}
          onCommit={(v) => commit({ pixels_per_spoke: v })}
        />
        <NumberField
          label="Outer radius (ft)"
          value={g.outer_radius_ft}
          step={0.5}
          onCommit={(v) => commit({ outer_radius_ft: v })}
        />
        <NumberField
          label="Inner radius (ft)"
          value={g.inner_radius_ft}
          step={0.5}
          onCommit={(v) => commit({ inner_radius_ft: v })}
        />
        <NumberField
          label="LEDs / meter"
          value={g.leds_per_meter}
          onCommit={(v) => commit({ leds_per_meter: v })}
        />
      </div>
      <p className="hint">
        Sanity check: {g.pixels_per_spoke} px at {g.leds_per_meter}/m = {stripFt.toFixed(1)} ft of
        strip; the outer→inner span is {spanFt.toFixed(1)} ft.{" "}
        {Math.abs(stripFt - spanFt) > 2 ? "⚠ these disagree — one of the numbers is off." : "✓ consistent."}
      </p>
      <p className="hint">Pixel 0 of every string is at the OUTER edge (fed from outside).</p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function ThisDevicePanel() {
  const { client } = useGate();
  const [micStop, setMicStop] = useState<(() => void) | null>(null);
  const [imuStop, setImuStop] = useState<(() => void) | null>(null);
  const [err, setErr] = useState("");

  return (
    <section className="panel">
      <h2>This device</h2>
      <p className="hint">
        Contribute this device's inputs to the show. Client id: <code>{client.clientId}</code> — add
        a Remote audio source with this id to use the mic as a beat source.
      </p>
      <label className="field-row" style={{ maxWidth: 380 }}>
        <span>Device name</span>
        <input
          defaultValue={client.deviceName}
          placeholder="e.g. DJ booth iPad"
          onBlur={(e) => client.setDeviceName(e.target.value)}
          style={{ flex: 1 }}
        />
      </label>
      <div className="add-row">
        <button
          onClick={async () => {
            try {
              if (micStop) {
                micStop();
                setMicStop(null);
              } else {
                const stop = await startMic(client);
                setMicStop(() => stop);
              }
            } catch (e) {
              setErr(String(e));
            }
          }}
        >
          {micStop ? "Stop microphone" : "Send microphone"}
        </button>
        <button
          onClick={async () => {
            try {
              if (imuStop) {
                imuStop();
                setImuStop(null);
              } else {
                const stop = await startImu(client);
                setImuStop(() => stop);
              }
            } catch (e) {
              setErr(String(e));
            }
          }}
        >
          {imuStop ? "Stop motion" : "Send motion / orientation"}
        </button>
      </div>
      {err && <p className="warn">{err}</p>}
    </section>
  );
}
