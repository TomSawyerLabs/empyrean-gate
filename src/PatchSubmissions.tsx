// The Patch tab's Submissions drawer: the playground's queue on
// empyreangate.org, read through the backend (`/patch/submissions*` on the
// operator port, loopback only, with the token from Settings → Submissions).
// A row opens as a new patch in this library, or is marked used / declined
// on the site, which takes it out of the queue.

import { useCallback, useEffect, useState } from "react";
import type { PatchDoc } from "@empyrean-gate/patch-web/editor";
import type { GateClient } from "./ws";

/** One row of the site's `GET /api/submissions` (worker/index.ts there). */
export interface SubmissionSummary {
  key: string;
  id: string;
  submittedAt: string;
  name: string;
  contact: string;
  message: string;
  country: string | null;
  patch: { name: string; description: string; nodes: number; edges: number };
}

/** The site's `{ error }` when there is one, else the body or the status. */
async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // Plain text from the backend's own refusals.
  }
  return text || `${res.status}`;
}

function when(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleString();
}

export function SubmissionsDrawer({
  client,
  onOpen,
  onClose,
}: {
  client: GateClient;
  /** Put a submission's patch in the editor as a new patch. */
  onOpen: (doc: PatchDoc) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SubmissionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${client.httpBase}/patch/submissions`);
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { submissions: SubmissionSummary[] };
      setRows(body.submissions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  const open = async (row: SubmissionSummary) => {
    setBusy(row.key);
    setError(null);
    try {
      const res = await fetch(
        `${client.httpBase}/patch/submissions/record?key=${encodeURIComponent(row.key)}`,
      );
      if (!res.ok) throw new Error(await readError(res));
      const { patch } = (await res.json()) as { patch: PatchDoc };
      onOpen(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const decide = async (row: SubmissionSummary, decision: "used" | "declined") => {
    setBusy(row.key);
    setError(null);
    try {
      const res = await fetch(`${client.httpBase}/patch/submissions/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: row.key, decision }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setRows((r) => (r ? r.filter((s) => s.key !== row.key) : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="submissions-drawer" aria-label="Playground submissions">
      <header>
        <h2>Submissions</h2>
        <button type="button" onClick={() => void load()} title="Reload the queue">
          ↻
        </button>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <p className="hint">
        Patterns people sent from the playground on empyreangate.org. Open one to look at it
        as a new patch here; Used and Decline take it out of the queue on the site.
      </p>
      {error && <p className="patch-status error">⚠ {error}</p>}
      {rows === null ? (
        <p className="hint">Loading…</p>
      ) : rows.length === 0 ? (
        !error && <p className="hint">The queue is empty.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.key}>
              <div className="submission-head">
                <strong>{row.patch.name || "Untitled"}</strong>
                <span>by {row.name}</span>
              </div>
              <div className="submission-meta">
                {when(row.submittedAt)} · {row.patch.nodes} nodes
                {row.country ? ` · ${row.country}` : ""}
                {row.contact ? ` · ${row.contact}` : ""}
              </div>
              {row.message && <p className="submission-note">“{row.message}”</p>}
              <div className="submission-actions">
                <button type="button" disabled={busy === row.key} onClick={() => void open(row)}>
                  Open as a new patch
                </button>
                <button
                  type="button"
                  disabled={busy === row.key}
                  onClick={() => void decide(row, "used")}
                >
                  Used
                </button>
                <button
                  type="button"
                  disabled={busy === row.key}
                  onClick={() => void decide(row, "declined")}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
