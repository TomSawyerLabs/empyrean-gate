// "Report" — the button you hit when the array does something you don't like.
//
// The backend is already recording; this only asks for the description and how
// far back to freeze. Deliberately reachable from every tab (it lives in the top
// bar and in show mode), because the complaint is time-sensitive: the window is
// ~20 seconds wide and every second spent navigating eats into it.

import { useEffect, useState } from "react";
import { useGate } from "./state";
import type { ReportInfo } from "./types";

const WINDOWS = [5, 10, 20];

function ago(created_unix_ms: number): string {
  const secs = Math.max(0, (Date.now() - created_unix_ms) / 1000);
  if (secs < 90) return `${Math.round(secs)}s ago`;
  if (secs < 5400) return `${Math.round(secs / 60)}m ago`;
  if (secs < 172800) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export default function ReportModal({ onClose }: { onClose: () => void }) {
  const { client } = useGate();
  const [description, setDescription] = useState("");
  const [seconds, setSeconds] = useState(10);
  const [sent, setSent] = useState<ReportInfo | null>(null);
  const [recent, setRecent] = useState<ReportInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () => {
    client
      .listReports()
      .then(setRecent)
      .catch((e: unknown) => setError(String(e)));
  };

  useEffect(refresh, [client]);

  // The bundle is written asynchronously (it renders a contact sheet), so the
  // confirmation arrives as a broadcast rather than a reply.
  useEffect(() => {
    return client.onMessage((m) => {
      if (m.type === "report_saved") {
        setBusy(false);
        setSent(m.report);
        setRecent((list) => [m.report, ...list.filter((r) => r.id !== m.report.id)]);
      } else if (m.type === "error" && busy) {
        setBusy(false);
        setError(m.message);
      }
    });
  }, [client, busy]);

  const submit = () => {
    if (!description.trim()) return;
    setError("");
    setBusy(true);
    client.sendReport(description.trim(), seconds);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Report what you just saw</h2>
        {sent ? (
          <>
            <p className="hint">
              Saved {sent.frames} frames and the last {sent.window_seconds.toFixed(0)}{" "}
              seconds of controls.
            </p>
            <code className="join-url">{sent.path}</code>
            <div className="report-links">
              <a href={client.reportFileUrl(sent.id, "contact-sheet.png")} target="_blank" rel="noreferrer">
                Contact sheet
              </a>
              <a href={client.reportFileUrl(sent.id, "report.json")} target="_blank" rel="noreferrer">
                report.json
              </a>
              <a href={client.reportFileUrl(sent.id, "frames.bin")} target="_blank" rel="noreferrer">
                frames.bin
              </a>
            </div>
            <button
              onClick={() => {
                setSent(null);
                setDescription("");
              }}
            >
              Report something else
            </button>
            <button className="ghost" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="hint">
              Describe what looked wrong. Everything the array was doing — patterns,
              sliders, audio, the frames themselves — is captured with it.
            </p>
            <textarea
              className="report-text"
              autoFocus
              rows={4}
              placeholder="e.g. the fire layer strobes hard on every kick and washes out the rings"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="report-window">
              <span>Capture the last</span>
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  className={`effect-btn ${seconds === w ? "active" : ""}`}
                  onClick={() => setSeconds(w)}
                >
                  {w}s
                </button>
              ))}
            </div>
            {error && <p className="warn">{error}</p>}
            <button className="primary" disabled={busy || !description.trim()} onClick={submit}>
              {busy ? "Saving…" : "Save report"}
            </button>
            <button className="ghost" onClick={onClose}>
              Cancel
            </button>
          </>
        )}

        {recent.length > 0 && (
          <div className="report-list">
            <h3>Saved reports</h3>
            {recent.slice(0, 8).map((r) => (
              <div key={r.id} className="report-row">
                <span className="report-when">{ago(r.created_unix_ms)}</span>
                <span className="report-desc">{r.description}</span>
                <a href={client.reportFileUrl(r.id, "report.json")} target="_blank" rel="noreferrer">
                  open
                </a>
              </div>
            ))}
            <p className="hint">
              Bundles live in the Gate machine's config folder under{" "}
              <code>reports/</code>. Hand a whole folder to an agent — it is
              self-describing (see docs/report-bundle.md).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
