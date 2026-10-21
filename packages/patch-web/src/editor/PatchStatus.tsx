// The editor's live status: a dot that beats with the renderer's frames, the
// error when the patch can't run, "no WebGPU" where nothing can render, and
// the host's stats on hover or tap.

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/** The renderer's verdict on the active patch, as a host reports it. */
export interface PatchStatus {
  /** A patch is compiled and rendering. */
  active: boolean;
  /** Why the latest document is not running. */
  error: string | null;
  /** This host can't render at all (a browser without WebGPU): a short
   * label for the status line and the reason, for the details. */
  unavailable?: { label: string; reason: string } | null;
  /** Advances each time the host sees new frames rendered (about once a
   * second): each step is one beat of the dot. Without it the dot is steady
   * and the status can't tell a stalled renderer. */
  beat?: number;
  /** Label and value rows for the details ("Frame rate", "60 fps"). */
  details?: [string, string][];
  /** One line under the rows, about this host. */
  note?: string;
}

/** No beat for this long while the patch is active: the renderer stalled. */
export const STALL_MS = 3000;
/** Hover leaves the details up this long, so the pointer can reach them. */
const HOVER_CLOSE_MS = 250;

export type Liveness = "unavailable" | "live" | "stalled" | "idle";

/** What the status dot shows. */
export function liveness(status: PatchStatus, quietMs: number): Liveness {
  if (status.unavailable) return "unavailable";
  if (!status.active) return "idle";
  return status.beat !== undefined && quietMs >= STALL_MS ? "stalled" : "live";
}

/** How long it's been since the last beat while the page was visible (0
 * when the host gives no beat, or the patch isn't active). A hidden tab
 * gets no animation frames, so time spent hidden doesn't count. */
function useQuietMs(status: PatchStatus | null | undefined): number {
  const beat = status?.beat;
  const watching = !!status?.active && beat !== undefined;
  const last = useRef(0);
  const [quiet, setQuiet] = useState(0);
  useEffect(() => {
    last.current = performance.now();
    setQuiet(0);
  }, [beat, watching]);
  useEffect(() => {
    if (!watching) return;
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      const ms = performance.now() - last.current;
      // Whole seconds past the threshold only, so a healthy status doesn't
      // re-render on every tick.
      setQuiet(ms >= STALL_MS ? Math.floor(ms / 1000) * 1000 : 0);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") last.current = performance.now();
    };
    const id = setInterval(tick, 500);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [watching]);
  return watching ? quiet : 0;
}

/**
 * The status line's live part. `chip`: the compact canvas chip (an icon, the
 * details below the chips row); `inline`: the details open in the flow (a
 * menu sheet) rather than over it. `elsewhere`: the open patch isn't the one
 * the host is rendering.
 */
export function PatchStatusIndicator({
  status,
  variant = "toolbar",
  elsewhere = false,
}: {
  status: PatchStatus | null | undefined;
  variant?: "toolbar" | "chip" | "inline";
  elsewhere?: boolean;
}) {
  const quietMs = useQuietMs(status);
  const [open, setOpen] = useState<"hover" | "pinned" | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef(0);
  const popId = useId();

  // Escape and a press outside close pinned details.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(null);
      buttonRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  if (!status) return null;
  const state = liveness(status, quietMs);
  if (state === "idle" && !(variant === "chip" && status.error)) return null;

  const hover = (enter: boolean) => (e: ReactPointerEvent) => {
    // Touch has no hover: a tap is a click.
    if (e.pointerType === "touch") return;
    clearTimeout(closeTimer.current);
    if (enter) setOpen((o) => o ?? "hover");
    else closeTimer.current = window.setTimeout(() => setOpen((o) => (o === "hover" ? null : o)), HOVER_CLOSE_MS);
  };

  const label = state === "unavailable" ? status.unavailable!.label : state;
  const chipError = variant === "chip" && !!status.error;
  const spoken =
    (chipError ? `This patch can't run: ${status.error}. ` : "") +
    (state === "unavailable"
      ? `Preview: ${label}.`
      : state === "live"
        ? "Rendering: live."
        : state === "stalled"
          ? "Rendering: stalled."
          : "") +
    " Show the details";

  return (
    <span
      className={`patch-status-wrap ${variant}`}
      ref={wrapRef}
      onPointerEnter={hover(true)}
      onPointerLeave={hover(false)}
    >
      <button
        type="button"
        ref={buttonRef}
        className={`patch-live ${state} ${chipError ? "error" : ""} ${variant === "chip" ? "patch-status-chip" : ""}`}
        aria-expanded={open !== null}
        aria-controls={popId}
        aria-label={spoken.trim()}
        data-liveness={state}
        data-beat={status.beat}
        onClick={() => setOpen((o) => (o === "pinned" ? null : "pinned"))}
      >
        {chipError ? (
          <span aria-hidden="true">⚠</span>
        ) : (
          <>
            {/* Re-keyed per beat: the pulse animation plays once each time. */}
            {state !== "idle" && <span className="patch-beat" key={status.beat ?? 0} aria-hidden="true" />}
            {(variant !== "chip" || state !== "live") && state !== "idle" && (
              <span className="patch-live-label">{label}</span>
            )}
          </>
        )}
      </button>
      {open && (
        <div className="patch-status-pop" id={popId} role="dialog" aria-label="Patch status">
          <StatusDetails status={status} state={state} quietMs={quietMs} elsewhere={elsewhere} />
        </div>
      )}
    </span>
  );
}

function StatusDetails({
  status,
  state,
  quietMs,
  elsewhere,
}: {
  status: PatchStatus;
  state: Liveness;
  quietMs: number;
  elsewhere: boolean;
}) {
  let head: ReactNode;
  let line: ReactNode;
  if (state === "unavailable") {
    head = <p className="patch-status-head warn">{status.unavailable!.label}</p>;
    line = <p>{status.unavailable!.reason}</p>;
  } else if (status.error) {
    head = (
      <p className="patch-status-head error">
        ⚠ {status.active ? "This edit can't run" : "This patch can't run"}
      </p>
    );
    line = (
      <p>{status.active ? "The last version that ran keeps rendering." : "Nothing from it is rendering."}</p>
    );
  } else if (state === "stalled") {
    head = <p className="patch-status-head warn">Stalled</p>;
    line = (
      <p>
        No new frames for {Math.round(quietMs / 1000)} s. The renderer may be stuck, or busy with
        something long.
      </p>
    );
  } else {
    head = <p className="patch-status-head ok">✓ All OK</p>;
    line = (
      <p>
        The patch compiles and is rendering.
        {status.beat !== undefined && " The dot beats each time new frames come in."}
      </p>
    );
  }
  return (
    <>
      {head}
      {line}
      {status.error && <p className="patch-status-why">{status.error}</p>}
      {elsewhere && status.active && (
        <p className="hint">This isn't the patch rendering: another one is active.</p>
      )}
      {!!status.details?.length && (
        <dl className="patch-status-rows">
          {status.details.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {status.note && <p className="hint">{status.note}</p>}
    </>
  );
}
