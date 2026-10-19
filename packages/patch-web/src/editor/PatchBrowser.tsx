// The patch browser: what there is to open, the built-ins (immutable) and the
// library, in one of three views. Tree: two folders, each patch unfolding to
// its Sub-patches. Topics: by what drives a patch (sound, DJ, touch…), taken
// from the node kinds it uses, so it needs no tagging and covers your own
// patches too. List: everything, A to Z.

import { useState } from "react";
import type { PatchSummary, SubpatchSummary } from "../types";
import type { EditorLocation } from "./navigation";

export type BrowserView = "tree" | "topics" | "list";
const VIEWS: { id: BrowserView; label: string }[] = [
  { id: "tree", label: "Tree" },
  { id: "topics", label: "Topics" },
  { id: "list", label: "List" },
];
const VIEW_KEY = "empyrean-patch-browser:view";

/** Topics, in order, by the node kinds that put a patch in them. */
const TOPICS: { label: string; kinds: string[] }[] = [
  { label: "Sound", kinds: ["audio", "waveform", "spectrum", "beat_rings"] },
  { label: "DJ", kinds: ["dj_link"] },
  { label: "Touch", kinds: ["tap", "touch", "touch_dabs", "touch_mask", "touch_glow", "event_effect", "effects_in"] },
  { label: "Phone motion", kinds: ["imu"] },
  { label: "Video and images", kinds: ["video_in", "image_in", "clip", "texture_sample"] },
  {
    label: "Noise and chance",
    kinds: ["random", "full_random", "random_walk", "smooth_noise", "noise_field", "noise_color", "perlin_noise", "random_field"],
  },
  { label: "Code", kinds: ["code"] },
  { label: "Sub-patches", kinds: ["subpatch"] },
];
const OTHER = "Everything else";

export function topicsOf(p: PatchSummary): string[] {
  const kinds = new Set(p.kinds ?? []);
  const hits = TOPICS.filter((t) => t.kinds.some((k) => kinds.has(k))).map((t) => t.label);
  return hits.length ? hits : [OTHER];
}

function useView(): [BrowserView, (v: BrowserView) => void] {
  const [view, setView] = useState<BrowserView>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === "topics" || v === "list" ? v : "tree";
    } catch {
      return "tree";
    }
  });
  return [
    view,
    (v) => {
      setView(v);
      try {
        localStorage.setItem(VIEW_KEY, v);
      } catch {
        // Storage blocked: the choice lasts the visit.
      }
    },
  ];
}

export function PatchBrowser({
  patches,
  builtins,
  current,
  activeId,
  onOpen,
}: {
  /** The library. */
  patches: PatchSummary[];
  /** The built-ins (presets), summarized. */
  builtins: PatchSummary[];
  current: EditorLocation | null;
  /** The patch on air (marked ●). */
  activeId: string | null;
  onOpen: (loc: EditorLocation) => void;
}) {
  const [view, setView] = useView();
  const builtinIds = new Set(builtins.map((b) => b.id));

  const row = (p: PatchSummary, withSubs: boolean) => (
    <PatchRow
      key={p.id}
      patch={p}
      builtin={builtinIds.has(p.id)}
      withSubs={withSubs}
      current={current}
      activeId={activeId}
      onOpen={onOpen}
    />
  );

  let body;
  if (view === "tree") {
    body = (
      <>
        <Folder label="Built-in" count={builtins.length} hint="read-only: edit a copy">
          {builtins.map((p) => row(p, true))}
        </Folder>
        <Folder label="Your patches" count={patches.length}>
          {patches.length ? patches.map((p) => row(p, true)) : <p className="hint">None saved yet.</p>}
        </Folder>
      </>
    );
  } else if (view === "topics") {
    const all = [...builtins, ...patches];
    const labels = [...TOPICS.map((t) => t.label), OTHER];
    body = labels.map((label) => {
      const members = all.filter((p) => topicsOf(p).includes(label));
      return members.length ? (
        <Folder key={label} label={label} count={members.length} closed>
          {members.map((p) => row(p, false))}
        </Folder>
      ) : null;
    });
  } else {
    const all = [...builtins, ...patches].sort((a, b) => a.name.localeCompare(b.name));
    body = <ul className="browser-list">{all.map((p) => row(p, false))}</ul>;
  }

  return (
    <div className="patch-browser">
      <div className="browser-views" role="radiogroup" aria-label="View">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            className={view === v.id ? "active" : ""}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}

function Folder({
  label,
  count,
  hint,
  closed = false,
  children,
}: {
  label: string;
  count: number;
  hint?: string;
  closed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="browser-folder" open={!closed}>
      <summary>
        {label} <span className="hint">({count})</span>
        {hint && <span className="hint browser-folder-hint"> · {hint}</span>}
      </summary>
      <ul className="browser-list">{children}</ul>
    </details>
  );
}

function PatchRow({
  patch,
  builtin,
  withSubs,
  current,
  activeId,
  onOpen,
}: {
  patch: PatchSummary;
  builtin: boolean;
  withSubs: boolean;
  current: EditorLocation | null;
  activeId: string | null;
  onOpen: (loc: EditorLocation) => void;
}) {
  const here = current?.patch === patch.id;
  const subs = withSubs ? (patch.subpatches ?? []) : [];
  // Unfolded while you are inside it; otherwise as you leave it.
  const [unfolded, setOpen] = useState<boolean | null>(null);
  const open = unfolded ?? (here && current!.path.length > 0);
  const label = (
    <button
      type="button"
      className="browser-item"
      aria-current={here && current!.path.length === 0 ? "page" : undefined}
      title={patch.description || undefined}
      onClick={() => onOpen({ patch: patch.id, path: [] })}
    >
      {builtin && (
        <span className="browser-lock" aria-label="built-in" title="Built in: read-only">
          🔒
        </span>
      )}
      {patch.name || "Untitled"}
      <span className="hint">
        {" "}
        ({patch.nodes}){patch.id === activeId ? " ●" : ""}
      </span>
    </button>
  );
  return (
    <li>
      <div className="browser-row">
        {subs.length > 0 ? (
          <button
            type="button"
            className="browser-twist"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} the sub-patches of ${patch.name}`}
            onClick={() => setOpen(!open)}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          withSubs && <span className="browser-twist" aria-hidden="true" />
        )}
        {label}
      </div>
      {open && subs.length > 0 && (
        <SubList patch={patch.id} subs={subs} path={[]} current={current} onOpen={onOpen} />
      )}
    </li>
  );
}

function SubList({
  patch,
  subs,
  path,
  current,
  onOpen,
}: {
  patch: string;
  subs: SubpatchSummary[];
  path: string[];
  current: EditorLocation | null;
  onOpen: (loc: EditorLocation) => void;
}) {
  return (
    <ul className="browser-list browser-subs">
      {subs.map((s) => {
        const at = [...path, s.node];
        const here =
          current?.patch === patch && current.path.length === at.length && at.every((id, i) => current.path[i] === id);
        return (
          <li key={s.node}>
            <button
              type="button"
              className="browser-item browser-sub"
              aria-current={here ? "page" : undefined}
              onClick={() => onOpen({ patch, path: at })}
            >
              {s.name}
              <span className="hint">{s.linked ? " · linked" : s.source ? " · copy" : ""}</span>
            </button>
            {s.subpatches && s.subpatches.length > 0 && (
              <SubList patch={patch} subs={s.subpatches} path={at} current={current} onOpen={onOpen} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
