import { useEffect, useRef, useState } from "react";
import { EFFECTS } from "./effects";
import EffectPad from "./EffectPad";
import GateCanvas from "./GateCanvas";
import { BUILTIN_LIVE_COLORS, type LiveColor } from "./liveColors";
import { useGate } from "./state";
import ToolIcon, { type ToolKind } from "./ToolIcon";

const TOOLS: { kind: ToolKind; label: string }[] = [
  { kind: "tap", label: "Tap" }, { kind: "glow", label: "Glow" },
  { kind: "ripple", label: "Ripple" }, { kind: "sparkle", label: "Sparkle" },
  { kind: "comet", label: "Comet" }, { kind: "ring", label: "Ring" },
  { kind: "beam", label: "Beam" }, { kind: "ember", label: "Ember" },
];

export default function Participate() {
  const { client, config, role, connected, errors, dismissError } = useGate();
  const access = config?.public_access;
  const mode = access?.mode ?? "private";
  const interactive = mode !== "private";
  const drawingEnabled = interactive && Boolean(access?.drawing_enabled);
  const [tool, setTool] = useState<ToolKind>("tap");
  const [color, setColor] = useState<LiveColor>(BUILTIN_LIVE_COLORS[0]);
  const [size, setSize] = useState(0.1);
  const [url, setUrl] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [queuePos, setQueuePos] = useState(0);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => client.onMessage((message) => {
    if (message.type === "preview_queue") setQueuePos(message.position);
  }), [client]);

  const allowedEffects = EFFECTS.filter((effect) => access?.allowed_effects.includes(effect.kind));
  const submissions = config?.media_submissions ?? [];

  return <div className="participant-page">
    <header className="participant-header">
      <div><h1>Empyrean Gate</h1><p>{mode === "private"
        ? "The artist has private control right now. You can still watch."
        : mode === "effects" ? "Draw on the Gate or add an enabled live effect."
          : "Draw, add effects, choose a public scene, or suggest a video."}</p></div>
      <span className={`participation-mode ${mode}`}>{mode === "private" ? "Private control" : mode}</span>
    </header>
    {!connected && <div className="banner warn">Reconnecting to the Gate…</div>}
    {errors.map((error, index) => <button className="banner warn participant-error"
      key={`${error}-${index}`} onClick={() => dismissError(index)}>{error}</button>)}
    <div className="participant-stage">
      <GateCanvas
        drawPen={drawingEnabled && tool !== "tap" ? {
          pen: tool, hue: color.hue, saturation: color.saturation, brightness: color.brightness,
          size: Math.min(size, access?.max_paint_size ?? size),
          intensity: Math.min(0.7, access?.max_paint_intensity ?? 0.7),
        } : undefined}
        onTap={interactive && tool === "tap" && allowedEffects.some((effect) => effect.kind === "burst")
          ? (angle, radius) => client.triggerEffect({ kind: "burst", angle, radius, size: size / 0.1,
              hue: color.hue, saturation: color.saturation, brightness: color.brightness })
          : undefined}
      />
      {mode === "private" && <div className="participant-locked">Private control</div>}
      {queuePos > 0 && <div className="queue-banner">Preview queue #{queuePos}</div>}
      {interactive && <button className="participant-scroll-cue" type="button"
        onClick={() => controlsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
        Colors &amp; tools <span aria-hidden="true">↓</span></button>}
    </div>
    {interactive && <div className="participant-controls" ref={controlsRef}>
      {drawingEnabled && <section className="participant-card"><h2>Draw</h2>
        <div className="participant-tools">{TOOLS.map((item) => <button key={item.kind}
          className={tool === item.kind ? "active" : ""} onClick={() => setTool(item.kind)}>
          <ToolIcon kind={item.kind} />{item.label}</button>)}</div>
        <div className="participant-swatches">{BUILTIN_LIVE_COLORS.map((entry) => <button key={entry.id}
          className={color.id === entry.id ? "active" : ""} style={{ background: entry.hex }}
          aria-label={entry.label} onClick={() => setColor(entry)} />)}</div>
        <label className="slider-row"><span>Brush size</span><input type="range" min={0.03}
          max={access?.max_paint_size ?? 0.18} step={0.01} value={size}
          onChange={(event) => setSize(Number(event.target.value))} /></label>
      </section>}
      <section className="participant-card"><h2>Effects</h2><div className="participant-effects">
        {allowedEffects.map((effect) => <EffectPad key={effect.kind} effect={effect}
          trigger={(fx) => client.triggerEffect(fx)} className="" showKey={false}
          color={{ hue: color.hue, saturation: color.saturation, brightness: color.brightness }} />)}
      </div></section>
    </div>}
    {mode === "curated" && (config?.saved_stacks.length ?? 0) > 0 && <section className="participant-card participant-scenes">
      <h2>Public scenes</h2><div>{config?.saved_stacks.map((scene) => <button key={scene.id}
        onClick={() => client.activatePublicScene(scene.id)}>{scene.name}</button>)}</div></section>}
    {mode === "curated" && access?.media_submissions_enabled && <section className="participant-card participant-submit">
      <h2>Suggest a video</h2><p>Suggestions join the queue; they never interrupt the show.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (!url.trim()) return;
        client.submitMedia(url.trim()); setUrl(""); setSubmitted(true); }}>
        <input type="url" placeholder="YouTube, Instagram, or another public URL" value={url}
          onChange={(event) => { setUrl(event.target.value); setSubmitted(false); }} />
        <button type="submit">Submit</button></form>{submitted && <p className="ok">Submitted.</p>}
    </section>}
    {submissions.length > 0 && <section className="participant-card submission-list">
      <h2>{role === "moderator" ? "Submission queue" : "Your submissions"}</h2>
      {submissions.map((item) => <div className="submission-row" key={item.id}><div>
        <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
        <span className={`submission-status ${item.status}`}>{item.status}{item.auto_approved ? " · automatic" : ""}</span>
      </div>{role === "moderator" && <div className="submission-actions">
        <button onClick={() => client.moderateMedia(item.id, "approved")}>Approve</button>
        <button onClick={() => client.moderateMedia(item.id, "rejected")}>Reject</button>
        <button className="danger" onClick={() => client.removeMediaSubmission(item.id)}>Remove</button>
      </div>}</div>)}
    </section>}
  </div>;
}
