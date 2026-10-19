// Patch files: the exact JSON the gate keeps in its patches/ folder, so a file
// saved anywhere opens anywhere. Parsing here only checks the shape; whether a
// patch can run is the patch core's call (the gate re-validates on save, the
// playground runs the same validation in wasm).

import { PATCH_FORMAT, type PatchDoc } from "../types";

/** A file name for `doc`: its name as a slug, `.json`. */
export function patchFileName(doc: PatchDoc): string {
  const slug = doc.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "patch"}.json`;
}

/** Serialize as the gate's store writes it (pretty JSON). */
export function exportPatch(doc: PatchDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/** Parse a patch file. Throws a readable message when it is not one. Missing
 * optional fields take the same defaults the Rust loader gives them. */
export function parsePatchFile(text: string): PatchDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not JSON.");
  }
  return parsePatchValue(raw, 0);
}

/** Sub-patches inside sub-patches, at most this deep (crate
 * `flatten::MAX_SUBPATCH_DEPTH`). */
const MAX_SUBPATCH_DEPTH = 4;

function parsePatchValue(raw: unknown, depth: number): PatchDoc {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("That file is not a patch.");
  }
  const r = raw as Partial<PatchDoc>;
  if (!Array.isArray(r.nodes) || !Array.isArray(r.edges ?? [])) {
    throw new Error("That file is not a patch (it has no nodes).");
  }
  return {
    // Missing means current, as the Rust loader reads it.
    format: typeof r.format === "number" ? r.format : PATCH_FORMAT,
    id: typeof r.id === "string" ? r.id : "",
    name: typeof r.name === "string" ? r.name : "",
    description: typeof r.description === "string" ? r.description : "",
    ...(typeof r.credit === "string" && r.credit ? { credit: r.credit } : {}),
    nodes: r.nodes.map((n) => ({
      id: String(n.id ?? ""),
      kind: String(n.kind ?? ""),
      name: typeof n.name === "string" ? n.name : "",
      params: n.params && typeof n.params === "object" ? { ...n.params } : {},
      pos: Array.isArray(n.pos) && n.pos.length === 2 ? [Number(n.pos[0]), Number(n.pos[1])] : [0, 0],
      ...(typeof n.media === "string" ? { media: n.media } : {}),
      // A Code node's ports and body; the core checks them.
      ...(n.code && typeof n.code === "object" ? { code: structuredClone(n.code) } : {}),
      ...(typeof n.text === "string" ? { text: n.text } : {}),
      ...(n.collapsed === true ? { collapsed: true } : {}),
      ...(typeof n.layers === "number" && n.layers > 1 ? { layers: n.layers } : {}),
      ...(typeof n.source === "string" && n.source ? { source: n.source } : {}),
      ...(n.linked === true ? { linked: true } : {}),
      ...(typeof n.source_rev === "string" ? { source_rev: n.source_rev } : {}),
      ...(n.sub && typeof n.sub === "object"
        ? depth < MAX_SUBPATCH_DEPTH
          ? { sub: parsePatchValue(n.sub, depth + 1) }
          : (() => {
              throw new Error("That patch nests sub-patches too deep.");
            })()
        : {}),
    })),
    edges: (r.edges ?? []).map((e) => ({
      from: { node: String(e.from?.node ?? ""), port: String(e.from?.port ?? "") },
      to: { node: String(e.to?.node ?? ""), port: String(e.to?.port ?? "") },
    })),
    exposed: Array.isArray(r.exposed)
      ? r.exposed.map((x) => ({
          node: String(x.node ?? ""),
          param: String(x.param ?? ""),
          label: String(x.label ?? ""),
        }))
      : [],
  };
}

/** Side of the square picture a Still image node stores (abi::IMAGE_SIZE). */
export const IMAGE_SIZE = 256;
/** Longest picture data URL the gate accepts (crate::MAX_MEDIA_BYTES). */
export const MAX_MEDIA_BYTES = 600_000;

/** Turn an image file into what a Still image node stores: center-cropped to
 * a square, scaled to IMAGE_SIZE², as a WebP data URL (PNG or JPEG where the
 * browser can't encode WebP or the result is too big). */
export async function imageFileToMedia(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext("2d")!;
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    IMAGE_SIZE,
    IMAGE_SIZE,
  );
  bitmap.close();
  for (const [type, quality] of [
    ["image/webp", 0.85],
    ["image/png", undefined],
    ["image/jpeg", 0.85],
  ] as const) {
    const url = canvas.toDataURL(type, quality);
    if (url.startsWith(`data:${type};`) && url.length <= MAX_MEDIA_BYTES) return url;
  }
  throw new Error("That image is too large to store in a patch.");
}

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}>;

type OpenFilePicker = (options: {
  types?: { description: string; accept: Record<string, string[]> }[];
  multiple?: boolean;
}) => Promise<{ getFile(): Promise<File> }[]>;

const PATCH_TYPES = [{ description: "Empyrean Gate patch", accept: { "application/json": [".json"] } }];

/** Save to a file the user picks (File System Access API), or download it
 * where the browser has no save picker. Resolves false if they cancelled. */
export async function savePatchToDisk(doc: PatchDoc): Promise<boolean> {
  const name = patchFileName(doc);
  const text = exportPatch(doc);
  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: PATCH_TYPES });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return false;
      throw e;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Let the user pick a patch file and parse it. Resolves null if they
 * cancelled; throws if the file is not a patch. */
export async function openPatchFromDisk(): Promise<PatchDoc | null> {
  const picker = (globalThis as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  let file: File | null = null;
  if (picker) {
    try {
      const [handle] = await picker({ types: PATCH_TYPES, multiple: false });
      file = await handle.getFile();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }
  } else {
    file = await new Promise<File | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
  return file ? parsePatchFile(await file.text()) : null;
}
