// The palette: every node kind, in purpose groups (groups.ts), with a filter
// box on top. Lists show an icon and a label; Building blocks and Patterns are
// a grid of ring thumbnails, since their picture says more than their name.
// Recently added kinds come first, groups fold away (both remembered), and the
// foot of the palette describes whichever kind is hovered or focused, with its
// thumbnail. Kinds are added by a click (at the canvas centre) or dragged onto
// the canvas (`PALETTE_DRAG_TYPE`).
//
// Keyboard: `/` anywhere outside a text field focuses the filter; ↓ moves
// into the list, arrows walk it, Enter adds; Enter in the filter adds the
// best match; Escape clears the filter.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { grouped, groupOf, type GroupDef } from "../groups";
import type { PatchGroup, PatchNodeType } from "../types";
import { GroupIcon, NodeIcon } from "./icons";
import { searchKinds, type SearchHit } from "./search";
import { PanelHead, useSheet } from "./sheet";
import { hasThumb, RingThumb, TraceThumbView, useThumbs, type ThumbData } from "./thumbs";

/** A saved patch or a preset the palette offers as a Sub-patch. */
export type SubpatchChoice = { id: string; name: string; nodes: number; preset: boolean };

/** The drag data type of a kind dragged out of the palette: its id. */
export const PALETTE_DRAG_TYPE = "application/x-empyrean-node-kind";
/** And the params it starts with (an option the search named), as JSON. */
export const PALETTE_PARAMS_TYPE = "application/x-empyrean-node-params";

/** Params a node of a search hit starts with. */
const presetParams = (hit: SearchHit) => (hit.preset ? { [hit.preset.param]: hit.preset.value } : undefined);

const RECENT_KEY = "empyrean.palette.recent";
const FOLDED_KEY = "empyrean.palette.folded";
const RECENT_MAX = 6;

/** localStorage, or nothing where a host forbids it. */
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or forbidden: the palette just forgets.
  }
}

type FoldKey = PatchGroup | "subpatches";

export function Palette({
  types,
  subpatches,
  hasOutput,
  onPick,
  onPickSubpatch,
  onClose,
}: {
  /** Every node kind, in registry order. */
  types: PatchNodeType[];
  subpatches: SubpatchChoice[];
  /** The open patch already has its one Output: the palette's is disabled. */
  hasOutput: boolean;
  /** Add a node of `kind`, starting with `params` when given. */
  onPick: (kind: string, params?: Record<string, number>) => void;
  onPickSubpatch: (choice: SubpatchChoice) => void;
  /** Set when the palette is a sheet (compact layout): shows Done. */
  onClose?: () => void;
}) {
  const sheet = useSheet(onClose);
  const compact = !!onClose;
  const thumbs = useThumbs();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => readStored(RECENT_KEY, []));
  const [folded, setFolded] = useState<Set<FoldKey>>(() => new Set(readStored<FoldKey[]>(FOLDED_KEY, [])));
  const [focus, setFocus] = useState<PatchNodeType | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const groups = useMemo(() => grouped(types), [types]);
  const q = query.trim();
  const results = useMemo(() => (q ? searchKinds(types, q) : []), [types, q]);
  const subResults = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return q ? subpatches.filter((s) => words.every((w) => s.name.toLowerCase().includes(w))) : [];
  }, [subpatches, q]);
  const recentTypes = recent.map((k) => byId.get(k)).filter((t): t is PatchNodeType => !!t);

  const disabled = (t: PatchNodeType) => t.id === "output" && hasOutput;

  const pick = useCallback(
    (t: PatchNodeType, params?: Record<string, number>) => {
      if (t.id === "output" && hasOutput) return;
      setRecent((r) => {
        const next = [t.id, ...r.filter((k) => k !== t.id)].slice(0, RECENT_MAX);
        writeStored(RECENT_KEY, next);
        return next;
      });
      onPick(t.id, params);
    },
    [hasOutput, onPick],
  );

  const toggleFold = (key: FoldKey) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(key)) next.add(key);
      writeStored(FOLDED_KEY, [...next]);
      return next;
    });

  // `/` focuses the filter from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Arrow keys walk the entries in reading order. */
  const onListKey = (e: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-palette-entry]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = at + step;
    if (next < 0) searchRef.current?.focus();
    else items[Math.min(next, items.length - 1)]?.focus();
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      listRef.current?.querySelector<HTMLElement>("[data-palette-entry]")?.focus();
    } else if (e.key === "Enter") {
      const best = results.find((h) => !disabled(h.type));
      if (best) pick(best.type, presetParams(best));
      else if (subResults[0]) onPickSubpatch(subResults[0]);
    } else if (e.key === "Escape" && query) {
      e.stopPropagation();
      setQuery("");
    }
  };

  const entry = (t: PatchNodeType, layout: "list" | "grid", tag?: ReactNode, preset?: SearchHit["preset"]) => (
    <Entry
      key={preset ? `${t.id}:${preset.param}=${preset.value}` : t.id}
      type={t}
      layout={layout}
      thumbs={thumbs}
      compact={compact}
      disabled={disabled(t)}
      tag={tag}
      preset={preset}
      onPick={() => pick(t, presetParams({ type: t, preset }))}
      onFocus={() => setFocus(t)}
    />
  );

  const section = (
    key: FoldKey,
    icon: ReactNode,
    label: string,
    count: number,
    layout: "list" | "grid",
    children: ReactNode,
  ) => {
    const open = !folded.has(key);
    return (
      <section key={key} className={`palette-group palette-group-${key}${key === "subpatches" ? " palette-subpatches" : ""}`}>
        <h4>
          <button type="button" className="palette-group-head" aria-expanded={open} onClick={() => toggleFold(key)}>
            {icon}
            <span className="palette-group-label">{label}</span>
            <span className="palette-group-count">{count}</span>
            <span className="palette-group-chevron" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
          </button>
        </h4>
        {open && <div className={`palette-items palette-${layout === "list" ? "rows" : "grid"}`}>{children}</div>}
      </section>
    );
  };

  const groupSection = ({ group, types: list }: { group: GroupDef; types: PatchNodeType[] }) =>
    section(
      group.id,
      <GroupIcon group={group.id} />,
      group.label,
      list.length,
      group.layout,
      list.map((t) => entry(t, group.layout)),
    );

  return (
    <aside
      className={`patch-palette ${compact ? "patch-sheet" : ""}`}
      aria-label="Add a node"
      ref={sheet.ref}
      tabIndex={sheet.tabIndex}
      onKeyDown={sheet.onKeyDown}
    >
      {compact && <PanelHead title="Add a node" onClose={onClose} />}
      <div className="palette-search">
        <input
          ref={searchRef}
          type="search"
          placeholder="Find a node…"
          aria-label="Find a node"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
        {!compact && !query && (
          <kbd className="palette-search-key" aria-hidden="true">
            /
          </kbd>
        )}
      </div>
      <div className="palette-scroll" ref={listRef} onKeyDown={onListKey} onMouseLeave={() => setFocus(null)}>
        {q ? (
          <>
            {results.length === 0 && subResults.length === 0 && <p className="hint palette-none">No node matches “{q}”.</p>}
            {results.length > 0 && (
              <div className="palette-items palette-rows palette-results">
                {results.map((h) => entry(h.type, "list", <span className="palette-tag">{groupOf(h.type).label}</span>, h.preset))}
              </div>
            )}
            {subResults.length > 0 && (
              <div className="palette-items palette-rows">
                {subResults.map((s) => (
                  <SubpatchEntry key={(s.preset ? "preset:" : "patch:") + s.id} choice={s} onPick={() => onPickSubpatch(s)} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {recentTypes.length > 0 && (
              <section className="palette-group palette-recent">
                <h4 className="palette-plain-head">Recent</h4>
                <div className="palette-items palette-chips">
                  {recentTypes.map((t) => (
                    <Entry
                      key={t.id}
                      type={t}
                      layout="chip"
                      thumbs={thumbs}
                      compact={compact}
                      disabled={disabled(t)}
                      onPick={() => pick(t)}
                      onFocus={() => setFocus(t)}
                    />
                  ))}
                </div>
              </section>
            )}
            {groups.map(groupSection)}
            {subpatches.length > 0 &&
              section(
                "subpatches",
                <NodeIcon kind="subpatch" className="group-icon" />,
                "Sub-patches",
                subpatches.length,
                "list",
                subpatches.map((s) => (
                  <SubpatchEntry key={(s.preset ? "preset:" : "patch:") + s.id} choice={s} onPick={() => onPickSubpatch(s)} />
                )),
              )}
          </>
        )}
      </div>
      {!compact && <Details type={focus} thumbs={thumbs} />}
    </aside>
  );
}

/** One kind: a list row, a grid tile, or a Recent chip. */
function Entry({
  type: t,
  layout,
  thumbs,
  compact,
  disabled,
  tag,
  preset,
  onPick,
  onFocus,
}: {
  type: PatchNodeType;
  layout: "list" | "grid" | "chip";
  thumbs: ThumbData | null;
  compact: boolean;
  disabled: boolean;
  tag?: ReactNode;
  /** The kind set to a Select option (a search hit on the option). */
  preset?: SearchHit["preset"];
  onPick: () => void;
  onFocus: () => void;
}) {
  const ring = layout === "grid" && thumbs?.rings[t.id];
  const descId = useId();
  const described = compact && layout === "list" && !!t.description;
  return (
    <button
      aria-describedby={described ? descId : undefined}
      type="button"
      // Recent chips repeat entries listed below them: only the entries
      // themselves are `.palette-item`.
      className={layout === "chip" ? `palette-chip cat-${t.category}` : `palette-item palette-${layout}-item cat-${t.category}`}
      data-palette-entry=""
      data-kind={t.id}
      disabled={disabled}
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_DRAG_TYPE, t.id);
        if (preset) e.dataTransfer.setData(PALETTE_PARAMS_TYPE, JSON.stringify({ [preset.param]: preset.value }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onPick}
      onMouseEnter={onFocus}
      onFocus={onFocus}
    >
      {layout === "grid" ? (
        <span className="palette-tile-pic">
          {ring ? <RingThumb data={thumbs!} kind={t.id} size={compact ? 88 : 56} /> : <NodeIcon kind={t.id} category={t.category} size={24} />}
        </span>
      ) : (
        <NodeIcon kind={t.id} category={t.category} />
      )}
      <span className="palette-item-text">
        <span className="palette-item-label">
          {t.label}
          {preset && <span className="palette-item-preset"> · {preset.label}</span>}
          {disabled && <span className="hint"> · one per patch</span>}
        </span>
        {described && (
          <span className="palette-item-desc" id={descId} aria-hidden="true">
            {t.description}
          </span>
        )}
      </span>
      {tag}
      {layout === "list" && !compact && thumbs?.traces[t.id] && (
        <TraceThumbView trace={thumbs.traces[t.id]!} width={34} height={14} />
      )}
    </button>
  );
}

function SubpatchEntry({ choice: s, onPick }: { choice: SubpatchChoice; onPick: () => void }) {
  return (
    <button
      type="button"
      className="palette-sub palette-list-item cat-combine"
      data-palette-entry=""
      title={`Insert ${s.name} as one node, linked: it follows that patch until you clone it for this project`}
      onClick={onPick}
    >
      <NodeIcon kind="subpatch" />
      <span className="palette-item-text">
        <span className="palette-item-label">{s.name}</span>
        <span className="hint">
          {s.preset ? "built-in · " : ""}
          {s.nodes} node{s.nodes === 1 ? "" : "s"} inside
        </span>
      </span>
    </button>
  );
}

/** The foot of the palette: the hovered or focused kind, described. */
function Details({ type: t, thumbs }: { type: PatchNodeType | null; thumbs: ThumbData | null }) {
  if (!t) {
    return (
      <div className="palette-details palette-details-empty">
        <p className="hint">Click a node to add it, or drag it onto the canvas. Press / to search.</p>
      </div>
    );
  }
  const trace = thumbs?.traces[t.id];
  return (
    <div className="palette-details" aria-live="polite">
      <div className="palette-details-head">
        {thumbs && hasThumb(thumbs, t.id) && thumbs.rings[t.id] ? (
          <RingThumb data={thumbs} kind={t.id} size={56} />
        ) : (
          <NodeIcon kind={t.id} category={t.category} size={28} />
        )}
        <div>
          <strong>{t.label}</strong>
          <span className="hint">{groupOf(t).label}</span>
        </div>
      </div>
      {trace && <TraceThumbView trace={trace} width={180} height={36} />}
      {t.description && <p className="palette-details-desc">{t.description}</p>}
    </div>
  );
}
