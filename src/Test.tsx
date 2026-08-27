// Test tab: hardware commissioning. Deterministic patterns generated on the
// backend that bypass the pattern engine entirely, plus a read-only scan for the
// pixel controllers we expect to find.
//
// Opening this tab does nothing. Test mode is armed explicitly, is refused while
// a scheduled show is running, and never touches the sACN output switch — see
// src-tauri/src/testmode.rs for why each of those is the way it is.
//
// The two open measurements recorded in plans/empyrean-gate.md — whether our
// spoke index runs the same rotational direction as the patch, and whether
// spoke 0 is the patch's first strip — are taken with the "One spoke" selector
// and the Spoke ID pattern here.

import { useEffect, useRef, useState } from "react";
import GateCanvas from "./GateCanvas";
import { contenders, peerLabel, peerVerdict, universeRange } from "./sacnPeers";
import { useGate, useThrottled } from "./state";
import type {
  DiscoveryResult,
  SpokeSelect,
  TestConfig,
  TestPattern,
} from "./types";

const DEFAULT_TEST: TestConfig = {
  pattern: "solid",
  brightness: 0.25,
  hue: -1,
  saturation: 1,
  index: 0,
  from_inner: false,
  width: 1,
  chase_hz: 0,
  blink_hz: 0,
  spoke_select: "all",
  spoke: 0,
  controller: 0,
  cycle_hz: 1,
  auto_exit_secs: 1800,
};

/** Every pattern, with the question it actually answers. */
const PATTERNS: { id: TestPattern; label: string; proves: string }[] = [
  {
    id: "solid",
    label: "Solid colour",
    proves: "Colour order and dead pixels. Send red — if the strip lights green, it is wired GRB.",
  },
  {
    id: "color_cycle",
    label: "Colour cycle",
    proves: "Red, green, blue, white in turn. The banner names what should be lit right now.",
  },
  {
    id: "pixel_index",
    label: "Nth pixel",
    proves: "Pixel count, feed direction, null-pixel offsets. Counts from either end.",
  },
  {
    id: "ruler",
    label: "Ruler",
    proves: "Every 10th pixel dim white, 50th blue, 100th red. Count the strip by eye.",
  },
  {
    id: "universe_marks",
    label: "Universe marks",
    proves: "First pixel of each universe. Checks pixels-per-universe against the patch.",
  },
  {
    id: "gradient",
    label: "Gradient",
    proves: "Bright at the outer feed, dark at the inner end. Direction on every spoke at once.",
  },
  {
    id: "spoke_id",
    label: "Spoke ID",
    proves: "Each strip's 1–64 number in binary near its outer end; LEDs 3 and 378 are green references.",
  },
  {
    id: "chase",
    label: "Chase",
    proves: "A band travelling down every spoke. Smooth motion means frames arrive steadily.",
  },
  {
    id: "blackout",
    label: "Blackout",
    proves: "Everything off. A rig still lit is holding a last look, not following us.",
  },
];

const SWATCHES: { label: string; hue: number; saturation: number }[] = [
  { label: "Red", hue: 0, saturation: 1 },
  { label: "Green", hue: 1 / 3, saturation: 1 },
  { label: "Blue", hue: 2 / 3, saturation: 1 },
  { label: "White", hue: -1, saturation: 0 },
  { label: "Amber", hue: 0.09, saturation: 1 },
  { label: "Cyan", hue: 0.5, saturation: 1 },
  { label: "Magenta", hue: 5 / 6, saturation: 1 },
];

function hexToHsb(hex: string) {
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

  return { hue, saturation: max === 0 ? 0 : delta / max, brightness: max };
}

function hsbToHex(hue: number, saturation: number): string {
  if (hue < 0) return "#ffffff";
  const h = ((hue % 1) + 1) % 1;
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    const v = 1 - saturation * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

/** A labelled −/+ stepper. Big targets: this gets used on a phone, outdoors. */
function Stepper({
  value,
  min,
  max,
  steps = [1, 10],
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  steps?: number[];
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="test-stepper">
      {[...steps].reverse().map((s) => (
        <button key={`-${s}`} onClick={() => onChange(clamp(value - s))}>
          −{s}
        </button>
      ))}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
      />
      {steps.map((s) => (
        <button key={`+${s}`} onClick={() => onChange(clamp(value + s))}>
          +{s}
        </button>
      ))}
    </div>
  );
}

/** Segmented control built from the shared `.mode-btn` styling. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="pixel-mode-select">
      {options.map(([id, label]) => (
        <button
          key={String(id)}
          className={`mode-btn ${value === id ? "active" : ""}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Test() {
  const { client, config, status } = useGate();
  const testStatus = status?.test;
  const armed = testStatus?.active ?? false;
  const blockedBy = testStatus?.blocked_by_show ?? null;

  const [local, setLocal] = useState<TestConfig>(DEFAULT_TEST);
  // When we last changed something ourselves. The backend mirrors the live test
  // config in the 2 Hz status stream so several devices stay in sync, but
  // adopting that unconditionally would fight a slider mid-drag.
  const changedAt = useRef(0);

  useEffect(() => {
    const remote = status?.test?.config;
    if (!remote) return;
    if (Date.now() - changedAt.current < 1200) return;
    setLocal(remote);
  }, [status?.test?.config]);

  const sendThrottled = useThrottled((next: TestConfig) => client.setTestConfig(next));
  const apply = (patch: Partial<TestConfig>, immediate = false) => {
    const next = { ...local, ...patch };
    setLocal(next);
    changedAt.current = Date.now();
    if (immediate) client.setTestConfig(next);
    else sendThrottled(next);
  };

  if (!config) return <p className="hint">Waiting for backend…</p>;

  const { geometry: geo, output: out } = config;
  const spokes = geo.spokes;
  const pixels = geo.pixels_per_spoke;
  const ppu = Math.max(1, out.pixels_per_universe);
  const stride = Math.max(out.universe_stride, Math.ceil(pixels / ppu));
  const perController = Math.max(1, out.strings_per_controller);
  const controllers = Math.ceil(spokes / perController);

  // What the requested level becomes on the wire, after the LED gamma the sACN
  // sender applies. A test that reads "25%" and puts out 8/255 is baffling
  // unless the number is on screen.
  const raw = Math.round(local.brightness * 255);
  const wire = Math.round(255 * Math.pow(raw / 255, out.led_gamma));

  // Spokes and pixels are 0-based; universes and channels are 1-based, because
  // that is the wire format (see plans/empyrean-gate.md).
  const stripIndex = local.from_inner ? pixels - 1 - local.index : local.index;
  const refSpoke = local.spoke_select === "one" ? local.spoke : 0;
  const universe = out.start_universe + refSpoke * stride + Math.floor(stripIndex / ppu);
  const channel = (stripIndex % ppu) * 3 + 1;
  const spokeController = Math.floor(refSpoke / perController);

  const showsPixelControls = local.pattern === "pixel_index" || local.pattern === "chase";
  const usesColour = !["ruler", "universe_marks", "color_cycle", "blackout"].includes(
    local.pattern,
  );

  return (
    <div className="test-page">
      <section className={`panel test-mode-control ${armed ? "armed" : ""}`}>
        <div className="test-arm-head">
          <div>
            <h2>Hardware test mode</h2>
            <p className="hint">
              Replaces every pixel on the rig with a fixed pattern. The engine, audio,
              effects, scheduled show and master faders are all ignored while armed.
            </p>
          </div>
          {armed ? (
            <button className="danger test-arm-btn" onClick={() => client.setTestMode(false)}>
              Disarm
            </button>
          ) : (
            <button
              className="primary test-arm-btn"
              disabled={!!blockedBy}
              onClick={() => client.setTestMode(true)}
            >
              Arm test mode
            </button>
          )}
        </div>

        {blockedBy && (
          <div className="error-box">
            <strong>“{blockedBy}”</strong> is running on the show scheduler. Test mode
            would replace it on the rig, so it has to be stopped first.{" "}
            <button
              className="ghost"
              onClick={() =>
                client.setConfig({
                  ...config,
                  show_scheduler: { ...config.show_scheduler, enabled: false },
                })
              }
            >
              Stop the show
            </button>
          </div>
        )}

        {!out.enabled && (
          <div className="error-box">
            sACN output is off, so nothing reaches the rig — you will only see the
            preview below. Test mode deliberately does not switch it on for you.{" "}
            <button className="ghost" onClick={() => client.setSacnEnabled(true)}>
              Enable sACN output
            </button>
          </div>
        )}

        {armed && (
          <div className="test-live">
            <span className="test-live-dot" />
            <span className="test-live-summary">{testStatus?.summary}</span>
            {(testStatus?.expires_secs ?? 0) > 0 && (
              <span className="hint">
                auto-exit in {Math.ceil((testStatus?.expires_secs ?? 0) / 60)} min
              </span>
            )}
          </div>
        )}
      </section>

      <section className="panel test-controls">
        <h2>Pattern</h2>
        <div className="pixel-mode-select">
          {PATTERNS.map((p) => (
            <button
              key={p.id}
              className={`mode-btn tall ${local.pattern === p.id ? "active" : ""}`}
              onClick={() => apply({ pattern: p.id }, true)}
            >
              <span className="mode-title">{p.label}</span>
              <span className="mode-note">{p.proves}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel test-controls">
        <h2>Colour and level</h2>
        {usesColour ? (
          <>
            <div className="pixel-mode-select">
              {SWATCHES.map((s) => (
                <button
                  key={s.label}
                  className={`mode-btn ${
                    local.hue === s.hue && local.saturation === s.saturation ? "active" : ""
                  }`}
                  onClick={() => apply({ hue: s.hue, saturation: s.saturation }, true)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="control-group">
              <label htmlFor="test-color">Custom colour</label>
              <div className="color-input-wrapper">
                <input
                  id="test-color"
                  type="color"
                  value={hsbToHex(local.hue, local.saturation)}
                  onChange={(e) => {
                    const { hue, saturation } = hexToHsb(e.target.value);
                    apply({ hue: saturation === 0 ? -1 : hue, saturation }, true);
                  }}
                />
                <span className="color-value">
                  {local.hue < 0
                    ? "white"
                    : `hue ${Math.round(local.hue * 360)}° · sat ${Math.round(
                        local.saturation * 100,
                      )}%`}
                </span>
              </div>
            </div>
          </>
        ) : (
          <p className="hint">
            This pattern uses its own fixed colours, so they can be read without
            reference to any setting here.
          </p>
        )}

        <div className="control-group">
          <label htmlFor="test-brightness">
            Brightness {Math.round(local.brightness * 100)}% — {raw}/255 asked for,{" "}
            {wire}/255 on the wire after LED gamma {out.led_gamma.toFixed(1)}
          </label>
          <input
            id="test-brightness"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={local.brightness}
            onChange={(e) => apply({ brightness: Number(e.target.value) })}
          />
        </div>
        <p className="hint">
          Low levels are how you hunt voltage droop without pulling hundreds of amps: a
          long run that reddens toward its far end is losing volts, not pixels.
        </p>
      </section>

      {showsPixelControls && (
        <section className="panel test-pixel-control">
          <h2>Pixel</h2>
          <p className="hint">
            Strings are fed from the outside: pixel 0 is at the outer radius and the last
            pixel is innermost.
          </p>
          <Segmented
            value={local.from_inner ? "inner" : "outer"}
            options={[
              ["outer", "Count from the outer feed"],
              ["inner", "Count from the inner end"],
            ]}
            onChange={(v) => apply({ from_inner: v === "inner" }, true)}
          />

          <div className="control-group">
            <label>Pixel index (0 – {pixels - 1})</label>
            <Stepper
              value={local.index}
              min={0}
              max={pixels - 1}
              steps={[1, 10, 100]}
              onChange={(v) => apply({ index: v }, true)}
            />
          </div>

          <div className="control-group">
            <label>Width — consecutive pixels lit</label>
            <Stepper
              value={local.width}
              min={1}
              max={pixels}
              steps={[1, 10]}
              onChange={(v) => apply({ width: v }, true)}
            />
          </div>

          <div className="control-group">
            <label htmlFor="test-chase">
              Chase {local.chase_hz > 0 ? `${local.chase_hz.toFixed(1)} px/s` : "off"}
            </label>
            <input
              id="test-chase"
              type="range"
              min="0"
              max="30"
              step="0.5"
              value={local.chase_hz}
              onChange={(e) => apply({ chase_hz: Number(e.target.value) })}
            />
          </div>

          <div className="pixel-info">
            <p>
              Strip position <strong>{stripIndex}</strong>
            </p>
            <p>
              Spoke <strong>{refSpoke}</strong>
              {local.spoke_select === "one" ? "" : " (reference)"}
            </p>
            <p>
              Universe <strong>{universe}</strong>
            </p>
            <p>
              Channel{" "}
              <strong>
                {channel}–{channel + 2}
              </strong>
            </p>
          </div>
          <p className="hint">
            Spokes and pixels are 0-based; universes and channels are 1-based, matching
            the wire format and the controller's patch.
          </p>
        </section>
      )}

      <section className="panel test-controls">
        <h2>Which spokes</h2>
        <Segmented
          value={local.spoke_select}
          options={
            [
              ["all", "All"],
              ["one", "One spoke"],
              ["controller", "One controller"],
              ["cycle", "Cycle"],
            ] as [SpokeSelect, string][]
          }
          onChange={(v) => apply({ spoke_select: v }, true)}
        />

        {local.spoke_select === "one" && (
          <div className="control-group">
            <label>
              Spoke (0 – {spokes - 1}) — controller {spokeController + 1}
              {out.controllers[spokeController] ? ` at ${out.controllers[spokeController]}` : ""}
            </label>
            <Stepper
              value={local.spoke}
              min={0}
              max={spokes - 1}
              steps={[1, 8]}
              onChange={(v) => apply({ spoke: v }, true)}
            />
          </div>
        )}

        {local.spoke_select === "controller" && (
          <div className="control-group">
            <label>
              Controller {local.controller + 1} of {controllers} — spokes{" "}
              {local.controller * perController}–
              {Math.min(spokes, (local.controller + 1) * perController) - 1}
              {out.controllers[local.controller]
                ? ` at ${out.controllers[local.controller]}`
                : " (no address configured)"}
            </label>
            <Stepper
              value={local.controller}
              min={0}
              max={Math.max(0, controllers - 1)}
              steps={[1]}
              onChange={(v) => apply({ controller: v }, true)}
            />
          </div>
        )}

        {local.spoke_select === "cycle" && (
          <div className="control-group">
            <label htmlFor="test-cycle">Step {local.cycle_hz.toFixed(1)} spokes/s</label>
            <input
              id="test-cycle"
              type="range"
              min="0.2"
              max="10"
              step="0.1"
              value={local.cycle_hz}
              onChange={(e) => apply({ cycle_hz: Number(e.target.value) })}
            />
          </div>
        )}
      </section>

      <section className="panel test-controls">
        <h2>Timing</h2>
        <div className="control-group">
          <label htmlFor="test-blink">
            Blink {local.blink_hz > 0 ? `${local.blink_hz.toFixed(1)} Hz` : "off"}
          </label>
          <input
            id="test-blink"
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={local.blink_hz}
            onChange={(e) => apply({ blink_hz: Number(e.target.value) })}
          />
        </div>
        <p className="hint">
          A blinking rig proves frames are still arriving. A steady one might just be a
          controller holding its last look.
        </p>
        <div className="control-group">
          <label>Auto-exit</label>
          <Segmented
            value={local.auto_exit_secs}
            options={[
              [300, "5 min"],
              [1800, "30 min"],
              [7200, "2 hours"],
              [0, "Never"],
            ]}
            onChange={(v) => apply({ auto_exit_secs: v }, true)}
          />
        </div>
      </section>

      <section className="panel test-controls">
        <h2>Preview</h2>
        {armed ? (
          <>
            <p className="hint">
              The test frame itself, so the screen and the rig can be compared directly.
            </p>
            <div className="test-canvas-wrap">
              <GateCanvas />
            </div>
          </>
        ) : (
          // Deliberately not rendered while disarmed: the preview stream carries
          // the engine's frame, so it would show the running show rather than the
          // pattern selected above — exactly the wrong thing to compare the rig
          // against.
          <p className="hint">
            Appears once test mode is armed. Until then the preview stream carries the
            show, not the pattern selected above.
          </p>
        )}
      </section>

      <OtherSources />
      <Discovery />
    </div>
  );
}

/// Live view of the always-on contention watcher. The scan panel below is a
/// one-shot; this is what is on the wire right now, with the priority comparison
/// that decides who the rig actually obeys.
function OtherSources() {
  const { status } = useGate();
  const peers = status?.sacn_peers ?? [];
  const rivals = contenders(peers);
  const watched = status?.sacn_watched_universes ?? 0;
  const total = status?.sacn_universes ?? 0;

  return (
    <section className="panel sacn-detection">
      <h2>Other sACN sources</h2>
      <p className="hint">
        Always listening, no scan needed. E1.31 lets any number of sources drive the
        same universe: the highest priority wins outright, and <em>equal</em> priorities
        are merged highest-takes-precedence — so two sources at the same priority make
        the rig follow neither of them. Ours is priority{" "}
        <strong>{status?.sacn_priority ?? "—"}</strong>.
      </p>
      <p className="hint">
        This hears multicast only. A source that unicasts straight at the controllers
        is invisible from here, so an empty list means "nothing heard", not "nothing
        there".
        {total > 0 && watched < total
          ? ` Watching ${watched} of ${total} universes — multicast memberships are a limited OS resource, so a large patch is sampled.`
          : ""}
      </p>
      {status?.sacn_watch_error && <div className="error-box">{status.sacn_watch_error}</div>}

      {peers.length === 0 ? (
        <p className="ok">✓ Nothing else is transmitting on this network.</p>
      ) : (
        <ul className="controller-grid">
          {peers.map((peer) => (
            <li
              key={peer.cid}
              className={`controller-item sacn-peer ${peer.wins ? "wins" : peer.ties ? "ties" : ""}`}
            >
              <span className="controller-name">
                {peer.wins ? "⛔" : peer.ties ? "⚠" : peer.preview_only ? "👁" : "•"}{" "}
                {peerLabel(peer)}
                {peer.source_name && peer.from_ip ? ` — ${peer.from_ip}` : ""}
              </span>
              <span className="universe-range">{peerVerdict(peer)}</span>
              <span className="universe-range hint">
                {[
                  peer.packets_per_sec > 0 && `${peer.packets_per_sec} pkt/s`,
                  peer.universes.length > 0 &&
                    `heard on ${universeRange(peer.universes)}`,
                  peer.announced.length > 0 &&
                    `announces ${universeRange(peer.announced)}`,
                  `CID ${peer.cid}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Both can be true at once — one source outranking us and another tied
          with us are different problems with different fixes, so neither hides
          the other. */}
      {rivals.some((p) => p.wins) && (
        <div className="error-box">
          <strong>The rig is not following this app.</strong> Stop the other source, or
          raise our priority above it in Settings → sACN output.
        </div>
      )}
      {rivals.some((p) => p.ties) && (
        <div className="error-box">
          <strong>Two sources at the same priority are being merged.</strong> Whatever
          the rig is doing is neither source's intent. Stop the other source, or move
          the two apart in priority so one of them wins cleanly.
        </div>
      )}
    </section>
  );
}

/// Controller discovery. Read-only — vendor probes and passive listening only —
/// so it needs no arming and is safe to run during a show.
function Discovery() {
  const { client, config, status } = useGate();
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const running = status?.discovery_running ?? false;
  const expected = (config?.output.controllers ?? []).filter((ip) => ip);

  useEffect(
    () =>
      client.onMessage((m) => {
        if (m.type === "discovery") setResult(m.result);
      }),
    [client],
  );

  return (
    <section className="panel sacn-detection">
      <h2>Controllers on the network</h2>
      <p className="hint">
        sACN is fire-and-forget: nothing acknowledges a frame, so "output enabled" never
        tells you a controller is listening. This asks the Advatek boxes directly — a
        broadcast probe for Mk1/Mk2 and a multicast one for Mk3/Mk4 — and compares the
        answers against the {expected.length} address{expected.length === 1 ? "" : "es"}{" "}
        configured in Settings. It also listens for any other sACN source on the wire.
      </p>
      <button className="primary" disabled={running} onClick={() => client.discoverControllers()}>
        {running ? "Scanning…" : "Scan for controllers"}
      </button>

      {result && (
        <div className="sacn-details">
          <div className="transmission-stats">
            <h3>Scan</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="label">Found</span>
                <span className={`value ${result.found.length > 0 ? "on" : "off"}`}>
                  {result.found.length}
                </span>
              </div>
              <div className="stat">
                <span className="label">Missing</span>
                <span className={`value ${result.missing.length > 0 ? "off" : "on"}`}>
                  {result.missing.length}
                </span>
              </div>
              <div className="stat">
                <span className="label">Other sACN sources</span>
                <span className={`value ${result.other_sources.length > 0 ? "off" : "on"}`}>
                  {result.other_sources.length}
                </span>
              </div>
              <div className="stat">
                <span className="label">Interface</span>
                <span className="value">{result.scanned_interface}</span>
              </div>
            </div>
          </div>

          {result.errors.map((e, i) => (
            <div key={i} className="error-box">
              {e}
            </div>
          ))}

          {result.found.length > 0 && (
            <div className="controller-list">
              <h3>Answered</h3>
              <ul className="controller-grid">
                {result.found.map((c) => (
                  <li key={c.ip} className="controller-item">
                    <span className="controller-name">
                      {c.expected ? "✓" : "⚠"} {c.ip}
                      {c.nickname ? ` — ${c.nickname}` : ""}
                    </span>
                    <span className="universe-range">
                      {[
                        c.model,
                        c.firmware && `firmware ${c.firmware}`,
                        c.mac,
                        c.temperature_c !== null && `${c.temperature_c.toFixed(1)}°C`,
                        c.protocol,
                        !c.expected && "not in the controller list",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {c.reported_ip && (
                      <span className="universe-range warn-text">
                        Answered from {c.ip} but reports its address as {c.reported_ip} — a
                        static IP that did not take, or a stale DHCP lease.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.missing.length > 0 && (
            <div className="error-box">
              <strong>
                No reply from {result.missing.length} configured controller
                {result.missing.length === 1 ? "" : "s"}:
              </strong>{" "}
              {result.missing.join(", ")}. Powered, and on this network? On Windows the
              inbound UDP allow rule that lets replies through comes from the Authorize
              button — without it a scan finds nothing even when every box is healthy.
            </div>
          )}

          {result.other_sources.length > 0 && (
            <div className="error-box">
              <strong>Another sACN source is transmitting here.</strong> Two sources on
              the same universes merge inside the controller, and the rig will do what
              neither of them says.
              <ul>
                {result.other_sources.map((s) => (
                  <li key={s.cid}>
                    “{s.source_name || "unnamed"}” at {s.from_ip} — {s.universes.length}{" "}
                    universe{s.universes.length === 1 ? "" : "s"}
                    {s.universes.length > 0
                      ? ` (${Math.min(...s.universes)}–${Math.max(...s.universes)})`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.found.length === 0 && result.errors.length === 0 && (
            <p className="hint">
              Nothing answered in {(result.duration_ms / 1000).toFixed(1)} s. Check that
              the sACN interface in Settings points at the lighting network — the probes
              leave by that NIC.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
