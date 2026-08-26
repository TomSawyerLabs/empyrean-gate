import { EFFECTS } from "./effects";
import { useGate } from "./state";
import type { PublicAccessConfig } from "./types";

export default function ParticipationControl() {
  const { client, config, status } = useGate();
  if (!config) return null;
  const access = config.public_access;
  const update = (patch: Partial<PublicAccessConfig>) => client.setConfig({
    ...config, public_access: { ...access, ...patch },
  });
  const host = status?.interfaces?.[0]?.split("—").pop()?.trim() ?? "gate.local";
  const base = `http://${host}:${config.server.port}`;
  const participantUrl = `${base}/?join=${access.participant_token}`;
  const moderatorUrl = `${base}/?join=${access.moderator_token}`;

  return <details className="public-control" open={access.mode !== "private"}>
    <summary><strong>Public participation</strong> · {access.mode}</summary>
    <div className="public-mode-buttons">
      <button className={access.mode === "private" ? "active" : ""} onClick={() => update({ mode: "private" })}>Private</button>
      <button className={access.mode === "effects" ? "active" : ""} onClick={() => update({ mode: "effects" })}>Public effects</button>
      <button className={access.mode === "curated" ? "active" : ""} onClick={() => update({ mode: "curated" })}>Effects + curated</button>
    </div>
    <label><input type="checkbox" checked={access.drawing_enabled}
      onChange={(event) => update({ drawing_enabled: event.target.checked })} /> Allow drawing</label>
    <div className="public-allowlist"><strong>Allowed effects</strong>{EFFECTS.map((effect) => <label key={effect.kind}>
      <input type="checkbox" checked={access.allowed_effects.includes(effect.kind)} onChange={(event) => update({
        allowed_effects: event.target.checked
          ? [...access.allowed_effects, effect.kind]
          : access.allowed_effects.filter((kind) => kind !== effect.kind),
      })} /> {effect.label}</label>)}</div>
    <div className="public-allowlist"><strong>Public scenes</strong>{config.saved_stacks.length === 0
      ? <span className="hint">Save a scene first.</span>
      : config.saved_stacks.map((scene) => <label key={scene.id}><input type="checkbox"
          checked={access.public_scene_ids.includes(scene.id)} onChange={(event) => update({
            public_scene_ids: event.target.checked
              ? [...access.public_scene_ids, scene.id]
              : access.public_scene_ids.filter((id) => id !== scene.id),
          })} /> {scene.name}</label>)}</div>
    <label><input type="checkbox" checked={access.media_submissions_enabled}
      onChange={(event) => update({ media_submissions_enabled: event.target.checked })} /> Allow video links</label>
    {access.media_submissions_enabled && <><label>Approval
      <select value={access.media_approval} onChange={(event) => update({
        media_approval: event.target.value as PublicAccessConfig["media_approval"],
      })}><option value="manual">Manual</option><option value="trusted_domains">Trusted domains</option>
        <option value="open">Automatic (all public URLs)</option></select></label>
      <label>Trusted domains<textarea value={access.trusted_media_domains.join("\n")}
        onChange={(event) => update({ trusted_media_domains: event.target.value.split(/\s+/).filter(Boolean) })} /></label></>}
    <div className="public-links"><div><strong>Participant QR/link</strong><code>{participantUrl}</code></div>
      <div><strong>Moderator link</strong><code>{moderatorUrl}</code></div>
      <button onClick={() => update({ participant_token: crypto.randomUUID().replaceAll("-", "") })}>Rotate participant link</button>
      <button onClick={() => update({ moderator_token: crypto.randomUUID().replaceAll("-", "") })}>Rotate moderator link</button></div>
    {config.media_submissions.length > 0 && <div className="submission-list"><strong>Submission queue</strong>
      {config.media_submissions.map((item) => <div className="submission-row" key={item.id}>
        <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a><span>{item.status}</span>
        <button onClick={() => client.moderateMedia(item.id, "approved")}>Approve</button>
        <button onClick={() => client.moderateMedia(item.id, "rejected")}>Reject</button>
        <button onClick={() => client.removeMediaSubmission(item.id)}>Remove</button></div>)}</div>}
  </details>;
}
