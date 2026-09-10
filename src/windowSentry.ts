// Idle-window sentry for the desktop app. It is easy to end up with a second
// window of the same tab sitting behind the show, or a popped-out window
// minimised and forgotten — each one a webview burning a preview stream.
// Every Tauri window heartbeats a small record into localStorage (shared by
// every window of the app), and the window that has focus looks at the
// others: one that is hidden or duplicates this window's tab, and has had no
// input for IDLE_MS, is offered for closing. Nothing here runs in a browser.

const PREFIX = "empyrean-window:";
const HEARTBEAT_MS = 5_000;
/** No pointer/key input for this long makes a window "idle". */
export const IDLE_MS = 5 * 60_000;
/** A record older than this is a crashed or closed window: ignored. */
const STALE_MS = 20_000;
/** "Keep them" snoozes those windows for this long. */
const SNOOZE_MS = 30 * 60_000;

export type WindowRecord = {
  label: string;
  tab: string;
  /** Last heartbeat (Date.now()). */
  at: number;
  /** Last pointer or key input (Date.now()). */
  active: number;
  hidden: boolean;
};

export type IdleWindow = { label: string; tab: string; idleMs: number; reason: "hidden" | "duplicate" };

const snoozed = new Map<string, number>();

function read(): WindowRecord[] {
  const out: WindowRecord[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      out.push(JSON.parse(localStorage.getItem(key) ?? "") as WindowRecord);
    } catch {
      localStorage.removeItem(key);
    }
  }
  return out;
}

/** Windows this one may offer to close, given its own label and tab. */
export function idleWindows(records: WindowRecord[], me: string, myTab: string, now = Date.now()): IdleWindow[] {
  return records
    .filter((r) => r.label !== me && now - r.at < STALE_MS && (snoozed.get(r.label) ?? 0) < now)
    .filter((r) => now - r.active >= IDLE_MS)
    .flatMap((r): IdleWindow[] => {
      if (r.hidden) return [{ label: r.label, tab: r.tab, idleMs: now - r.active, reason: "hidden" }];
      if (r.tab === myTab) return [{ label: r.label, tab: r.tab, idleMs: now - r.active, reason: "duplicate" }];
      return [];
    });
}

export function snooze(labels: string[]) {
  const until = Date.now() + SNOOZE_MS;
  for (const label of labels) snoozed.set(label, until);
}

/** Start heartbeating for this window; returns the teardown. */
export function startSentry(label: string, tab: () => string): () => void {
  let active = Date.now();
  const touch = () => {
    active = Date.now();
  };
  const beat = () => {
    const record: WindowRecord = {
      label,
      tab: tab(),
      at: Date.now(),
      active,
      hidden: document.hidden,
    };
    localStorage.setItem(PREFIX + label, JSON.stringify(record));
  };
  window.addEventListener("pointerdown", touch, true);
  window.addEventListener("keydown", touch, true);
  window.addEventListener("focus", touch);
  document.addEventListener("visibilitychange", beat);
  beat();
  const timer = window.setInterval(beat, HEARTBEAT_MS);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("pointerdown", touch, true);
    window.removeEventListener("keydown", touch, true);
    window.removeEventListener("focus", touch);
    document.removeEventListener("visibilitychange", beat);
    localStorage.removeItem(PREFIX + label);
  };
}

/** Current records, for the focused window's scan. */
export function scan(me: string, myTab: string): IdleWindow[] {
  return idleWindows(read(), me, myTab);
}
