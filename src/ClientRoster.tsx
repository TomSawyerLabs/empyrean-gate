// Who is on the floor right now. One list, used on Live (folded under the
// "clients" stat) and on Control (its own panel): connected devices in the
// order they arrived, what each one last did, a line where the live-view
// slots run out, and a one-tap Block/Unblock per device. Blocking is the
// existing revoke — the device is kicked at once and its id refused until
// unblocked — which any admin may do from here.

import { useState } from "react";
import { useGate } from "./state";
import type { ClientInfo } from "./types";

function age(secs: number | null): string {
  if (secs === null) return "";
  if (secs < 1) return "now";
  if (secs < 60) return `${Math.floor(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}

const INPUT_LABEL: Record<string, string> = {
  tap: "tap",
  draw: "drawing",
  master: "master",
  output: "output",
  layer: "layer",
  scene: "scene",
  video: "video",
  game: "game",
  play: "playing",
  test: "test",
  knob: "patch knob",
};

function Row({ c, me, admin, onToggle }: {
  c: ClientInfo;
  me: boolean;
  admin: boolean;
  onToggle: () => void;
}) {
  const recent = c.last_input_secs !== null && c.last_input_secs < 2;
  return (
    <div className={`roster-row ${c.connected ? "" : "offline"} ${recent ? "playing" : ""} ${c.revoked ? "blocked" : ""}`}>
      <span className={c.connected ? "conn-dot on" : "conn-dot"} />
      <span className="roster-name">
        {c.name}
        {me && <span className="roster-tag">you</span>}
        {c.admin && <span className="roster-tag">admin</span>}
        {c.revoked && <span className="roster-tag blocked">blocked</span>}
      </span>
      <span className="roster-input">
        {c.last_input ? `${INPUT_LABEL[c.last_input] ?? c.last_input} · ${age(c.last_input_secs)}` : "—"}
      </span>
      {admin && !me && (
        <button className={`ghost roster-toggle ${c.revoked ? "" : "danger"}`} onClick={onToggle}>
          {c.revoked ? "Unblock" : "Block"}
        </button>
      )}
    </div>
  );
}

export default function ClientRoster({ compact = false }: { compact?: boolean }) {
  const { client, config, status, admin } = useGate();
  const [showOffline, setShowOffline] = useState(false);
  const list = status?.client_list ?? [];
  const connected = list.filter((c) => c.connected).sort((a, b) => a.order - b.order);
  const viewing = connected.filter((c) => c.viewing);
  const waiting = connected.filter((c) => !c.viewing);
  const offline = list.filter((c) => !c.connected);
  const limit = config?.server.max_preview_clients ?? 0;
  const toggle = (c: ClientInfo) =>
    client.send(c.revoked ? { type: "unrevoke_client", id: c.id } : { type: "revoke_client", id: c.id });
  const row = (c: ClientInfo) => (
    <Row key={c.id} c={c} me={c.id === client.clientId} admin={admin} onToggle={() => toggle(c)} />
  );

  return (
    <div className={`client-roster ${compact ? "compact" : ""}`}>
      {connected.length === 0 && <p className="hint">Nobody connected.</p>}
      {viewing.map(row)}
      {(waiting.length > 0 || (limit > 0 && viewing.length >= limit)) && (
        <div className="roster-cutoff">
          <span>live view full · {limit} slots</span>
          {waiting.length > 0 && <span>{waiting.length} waiting, controls still work</span>}
        </div>
      )}
      {waiting.map(row)}
      {offline.length > 0 && (
        <button className="ghost roster-offline-toggle" onClick={() => setShowOffline((v) => !v)}>
          {showOffline ? "Hide" : "Show"} {offline.length} offline
        </button>
      )}
      {showOffline && offline.map(row)}
    </div>
  );
}
