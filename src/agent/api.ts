// What an agent can do with patches, as plain async functions over a host:
// read the palette and the guide, read and replace the open patch (or edit
// it in place), validate, look at it, and make a link. The browser
// playground, the gate app and the command-line server each provide a host;
// `tools.ts` turns this into tool definitions (WebMCP, MCP).

import type { PatchCore } from "../runtime/core";
import type { Geometry } from "../runtime/gpu";
import type { CaptureOptions, CapturedFrame } from "../runtime/index";
import { contactSheet, encodePng, frameStats, renderRing, type FrameStats } from "../runtime/ring";
import type { PatchDoc, PatchNodeType } from "../types";
import { parsePatchFile } from "../editor/files";
import { applyOps, arranged, type PatchOp } from "./edit";
import { agentGuide, nodeSummary, type GuideOptions } from "./guide";
import { patchLink } from "./link";

export interface PatchHost {
  core: PatchCore;
  geometry: Geometry;
  /** The patch open right now (null: none). */
  getPatch(): PatchDoc | null;
  /**
   * Show `doc` and run it. `asNew` opens it as a new patch (a new library
   * entry); otherwise it replaces the open patch's contents, keeping its id
   * (in an editor, as one undoable step). Resolves with the document as
   * stored and the renderer's verdict (null where there is no renderer or
   * it runs).
   */
  setPatch(doc: PatchDoc, asNew: boolean): Promise<{ doc: PatchDoc; error: string | null }>;
  /** Frames of the running patch; absent where nothing renders. */
  capture?(options: CaptureOptions): Promise<CapturedFrame[]>;
  /** Where links open (e.g. `https://empyreangate.org/playground`). */
  linkBase?: string;
  /** For the guide. */
  guide?: GuideOptions;
}

export interface SnapshotOptions extends CaptureOptions {
  /** Side of each frame's picture in pixels (default 384, at most 1024). */
  size?: number;
  /** Several frames as one picture, left to right then down (default
   * true); false gives one picture per frame. */
  sheet?: boolean;
}

export interface Snapshot {
  /** Patch time of each frame, and what it looks like in numbers. */
  frames: { t: number; stats: FrameStats }[];
  /** PNGs: one sheet, or one per frame. */
  images: Uint8Array[];
  /** How the pictures are laid out, in words. */
  layout: string;
}

export interface SetResult {
  /** Applied and running (or, without a renderer, valid). */
  ok: boolean;
  /** Why it was not applied: the core's validation messages. */
  errors: string[];
  /** Applied, but the renderer could not run it (a shader error). */
  runtimeError: string | null;
  /** The stored patch's id, when applied. */
  id: string | null;
}

/** A media data URL left out of `getPatch` (they run to hundreds of KB):
 * send it back as is and the picture is kept. */
const KEPT = "kept:";

export type PatchApi = ReturnType<typeof createPatchApi>;

export function createPatchApi(host: PatchHost) {
  const { core } = host;
  const types = new Map(core.registry.map((t) => [t.id, t]));

  const current = (): PatchDoc => {
    const doc = host.getPatch();
    if (!doc) throw new Error("No patch is open. Open a preset (open_preset) or set one (set_patch).");
    return doc;
  };

  const preset = (name: string): PatchDoc => {
    const p = core.presets.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!p) throw new Error(`no preset "${name}" (presets: ${core.presets.map((x) => x.name).join(", ")})`);
    return structuredClone(p);
  };

  const apply = async (doc: PatchDoc, asNew: boolean, arrange: boolean): Promise<SetResult> => {
    // Through the file parser: fills what a hand-written document leaves out
    // (positions, names, exposed) the way the gate's loader does.
    let next = restoreMedia(parsePatchFile(JSON.stringify(doc)), host.getPatch());
    if (arrange || next.nodes.every((n) => n.pos[0] === 0 && n.pos[1] === 0)) next = arranged(next);
    next = core.migrate(next);
    const errors = core.validate(next);
    if (errors.length) return { ok: false, errors, runtimeError: null, id: null };
    const { doc: stored, error } = await host.setPatch(next, asNew);
    return { ok: error === null, errors: [], runtimeError: error, id: stored.id };
  };

  return {
    /** Whether `snapshot` can work here (something renders). */
    canSnapshot: host.capture !== undefined,
    /** Whether `link` can work here (there is a playground to open). */
    canLink: host.linkBase !== undefined,

    /** The guide to making patterns, as markdown. */
    guide(options: GuideOptions = {}): string {
      return agentGuide(core, { ...host.guide, ...options });
    },

    /** Every node type, briefly; or those of one category. */
    nodeTypes(category?: string) {
      return core.registry.filter((t) => !category || t.category === category).map(nodeSummary);
    },

    /** The full definitions (ports, params, ranges, descriptions). */
    describe(kinds: string[]): PatchNodeType[] {
      return kinds.map((k) => {
        const t = types.get(k);
        if (!t) throw new Error(`no node type "${k}"`);
        return t;
      });
    },

    presets() {
      return core.presets.map((p) => ({ name: p.name, description: p.description, nodes: p.nodes.length }));
    },

    preset,

    /** The open patch. Pictures are left out unless `media` (see `KEPT`). */
    getPatch(media = false): PatchDoc | null {
      const doc = host.getPatch();
      return doc && !media ? withoutMedia(doc) : doc;
    },

    validate(doc: PatchDoc): string[] {
      return core.validate(core.migrate(doc));
    },

    /** Apply `doc`: it replaces the open patch when it *is* the open patch
     * (same id: read with `getPatch`, then changed), and otherwise opens as a
     * new patch, so the person's work is never overwritten by something
     * else. `asNew` forces a new patch. Nothing changes when it does not
     * validate. */
    setPatch(doc: PatchDoc, options: { asNew?: boolean; arrange?: boolean } = {}): Promise<SetResult> {
      const open = host.getPatch();
      const same = !!doc?.id && !!open?.id && doc.id === open.id;
      return apply(doc, options.asNew ?? !same, options.arrange ?? false);
    },

    /** Edit the open patch in place (see `PatchOp`). */
    edit(ops: PatchOp[], options: { arrange?: boolean } = {}): Promise<SetResult> {
      return apply(applyOps(current(), ops), false, options.arrange ?? false);
    },

    /** Open a copy of a built-in preset as a new patch. */
    openPreset(name: string): Promise<SetResult> {
      return apply({ ...preset(name), id: "" }, true, false);
    },

    /** Look at the running patch (see `PatchRuntime.capture`). */
    async snapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
      if (!host.capture) throw new Error("Nothing renders here, so there is nothing to look at.");
      const frames = await host.capture(options);
      const size = Math.max(64, Math.min(1024, Math.round(options.size ?? 384)));
      const pictures = frames.map((f) => renderRing(f.rgb, host.geometry, { size }));
      const sheet = (options.sheet ?? true) && pictures.length > 1;
      const cols = Math.ceil(Math.sqrt(pictures.length));
      const images = sheet
        ? [await encodePng(contactSheet(pictures, cols))]
        : await Promise.all(pictures.map((p) => encodePng(p)));
      const times = frames.map((f) => `t=${f.t}s`).join(", ");
      const layout = sheet
        ? `One picture of ${frames.length} frames (${times}), ${cols} per row, left to right then down.`
        : frames.length > 1
          ? `${frames.length} pictures, one per frame (${times}).`
          : `One frame (${times}).`;
      return {
        frames: frames.map((f) => ({ t: f.t, stats: frameStats(f.rgb, host.geometry) })),
        images,
        layout: `${layout} Laid out as the gate's own operator preview draws it (spoke 0 at the bottom, counter-clockwise); each picture ${size} px square.`,
      };
    },

    /** A link that opens `doc` (default: the open patch) in the playground. */
    link(doc?: PatchDoc): Promise<string> {
      const base = host.linkBase;
      if (!base) throw new Error("This host has no playground to link to.");
      return patchLink(doc ?? current(), base);
    },
  };
}

function withoutMedia(doc: PatchDoc): PatchDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => ({
      ...n,
      ...(n.media ? { media: `${KEPT}${n.media.length} bytes` } : {}),
      ...(n.sub ? { sub: withoutMedia(n.sub) } : {}),
    })),
  };
}

/** Put back pictures `withoutMedia` left out, from the open patch's nodes of
 * the same id. A `kept:` with nothing to restore is dropped. */
function restoreMedia(doc: PatchDoc, open: PatchDoc | null): PatchDoc {
  const had = new Map<string, PatchDoc["nodes"][number]>();
  for (const n of open?.nodes ?? []) had.set(n.id, n);
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const before = had.get(n.id);
      let next = n;
      if (n.media?.startsWith(KEPT)) {
        const { media: _drop, ...rest } = n;
        next = before?.media ? { ...rest, media: before.media } : rest;
      }
      if (n.sub) next = { ...next, sub: restoreMedia(n.sub, before?.sub ?? null) };
      return next;
    }),
  };
}
