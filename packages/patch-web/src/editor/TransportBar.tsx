// The transport bar (plans/frame-step.md): pause the patch, step it a frame
// at a time, and, with Keep past frames on, step back through the last
// seconds. On the canvas, under the graph, wherever the host gives a
// `FrameTransport`. Keys anywhere outside a text field: K plays and pauses,
// `,` and `.` step (with Shift, ten frames).

import { useEffect, useState, useSyncExternalStore } from "react";
import { deviceAllows, formatBytes, KEEP_CHOICES, KEEP_KEY, type FrameTransport, type TransportState } from "./transport";

/** How often the frame counter updates while the patch plays. */
const PLAYING_REFRESH_MS = 250;

/** The transport's state, kept current: on every change it reports, and a
 * few times a second while playing (frames don't report themselves). Null
 * without a transport. */
export function useTransport(transport: FrameTransport | null | undefined): TransportState | null {
  const [, tick] = useState(0);
  const state = useSyncExternalStore(
    (l) => transport?.onTransport(l) ?? (() => {}),
    () => (transport ? snapshotOf(transport) : null),
  );
  const playing = state !== null && !state.paused;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => tick((n) => n + 1), PLAYING_REFRESH_MS);
    return () => clearInterval(id);
  }, [playing]);
  return transport ? snapshotOf(transport) : null;
}

/** `transport.state()`, the same object while nothing in it changed (what
 * useSyncExternalStore needs). */
const snapshots = new WeakMap<FrameTransport, { key: string; state: TransportState }>();
function snapshotOf(transport: FrameTransport): TransportState {
  const state = transport.state();
  const key = JSON.stringify(state);
  const last = snapshots.get(transport);
  if (last?.key === key) return last.state;
  snapshots.set(transport, { key, state });
  return state;
}

function storedKeep(): number {
  try {
    const v = Number(localStorage.getItem(KEEP_KEY) ?? 0);
    return (KEEP_CHOICES as readonly number[]).includes(v) ? v : 0;
  } catch {
    return 0;
  }
}

function storeKeep(seconds: number) {
  try {
    localStorage.setItem(KEEP_KEY, String(seconds));
  } catch {
    // Private mode: the choice lasts this visit.
  }
}

/** The text field or editor the person is typing in, where keys are theirs. */
function typing(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

const Icon = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
);
const PLAY = "M4 2.5v11l9.5-5.5z";
const PAUSE = "M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z";
const BACK = "M3 2.5h2v11H3zM13 2.5v11L5.5 8z";
const FORWARD = "M11 2.5h2v11h-2zM3 2.5v11L10.5 8z";

export function TransportBar({ transport, compact = false }: { transport: FrameTransport; compact?: boolean }) {
  const state = useTransport(transport)!;
  const [problem, setProblem] = useState<string | null>(null);
  const canBack = state.back < state.kept;
  // Forward always steps the browser runtime; the gate only moves back up
  // through what it kept.
  const canForward = transport.canStep || state.back > 0;

  const keep = (seconds: number, remember = true) => {
    void transport.setKeep(seconds).then((why) => {
      setProblem(why);
      if (remember) storeKeep(why ? 0 : seconds);
    });
  };

  // The person's choice from an earlier visit, where this device allows it.
  useEffect(() => {
    const want = storedKeep();
    if (want !== transport.state().keepSeconds && deviceAllows(transport.keepCost(want))) keep(want, false);
    // Once per transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      const n = e.shiftKey ? 10 : 1;
      if (k === "k") {
        e.preventDefault();
        if (transport.state().paused) transport.play();
        else transport.pause();
      } else if (k === "." || k === ">") {
        e.preventDefault();
        transport.stepFrames(n);
      } else if (k === "," || k === "<") {
        e.preventDefault();
        transport.stepFrames(-n);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [transport]);

  const shown = state.shown;
  const frameLabel = transport.canStep ? `frame ${shown.frame}` : `view ${shown.frame}`;
  return (
    <div className={`patch-transport ${state.paused ? "paused" : ""} ${compact ? "compact" : ""}`} role="group" aria-label="Frame by frame">
      <button
        type="button"
        className="patch-transport-play"
        aria-label={state.paused ? "Play" : "Pause"}
        aria-keyshortcuts="K"
        onClick={() => (state.paused ? transport.play() : transport.pause())}
      >
        <Icon d={state.paused ? PLAY : PAUSE} />
      </button>
      <button
        type="button"
        aria-label="Step back a frame"
        aria-keyshortcuts=","
        disabled={!canBack}
        onClick={(e) => transport.stepFrames(e.shiftKey ? -10 : -1)}
      >
        <Icon d={BACK} />
      </button>
      <button
        type="button"
        aria-label="Step forward a frame"
        aria-keyshortcuts="."
        disabled={!canForward}
        onClick={(e) => transport.stepFrames(e.shiftKey ? 10 : 1)}
      >
        <Icon d={FORWARD} />
      </button>
      <span className="patch-transport-frame" aria-live="polite">
        {frameLabel}
        {!compact && <span className="patch-transport-time"> · {shown.time.toFixed(2)} s</span>}
        {state.back > 0 && <span className="patch-transport-back"> · {state.back} back</span>}
      </span>
      <label className="patch-transport-keep">
        <span>{compact ? "Keep" : "Keep past"}</span>
        <select
          aria-label="Keep past frames"
          value={state.keepSeconds}
          onChange={(e) => {
            keep(Number(e.target.value));
            // The keys step again at once, rather than moving the choice.
            e.target.blur();
          }}
        >
          {KEEP_CHOICES.map((s) => {
            const cost = transport.keepCost(s);
            const allowed = s === 0 || deviceAllows(cost);
            return (
              <option key={s} value={s} disabled={!allowed}>
                {s === 0 ? "off" : `${s} s · ${formatBytes(cost)}${allowed ? "" : " (too much here)"}`}
              </option>
            );
          })}
        </select>
      </label>
      {!compact && state.paused && (
        <span className="patch-transport-hint">
          {state.keepSeconds > 0 ? "K play · , . step (Shift: 10)" : "K play · . step (Shift: 10) · keep past frames to step back"}
        </span>
      )}
      {problem && (
        <span className="patch-transport-problem" role="alert">
          Can't keep them: {problem}
        </span>
      )}
    </div>
  );
}
