// A patch in a link: `<playground>#patch=<data>`. The document rides in the
// URL fragment, which browsers never send to the server, so a link works on a
// static site and nothing about the patch is logged anywhere.
//
// Two encodings, so that anyone can make one:
//   z<base64url>   the JSON, deflate-raw compressed (what `patchLink` writes)
//   {…} / %7B…     the JSON itself, percent-encoded or not (what an agent
//                  with no compressor can write by hand)
// `patch=` takes the rest of the fragment, so raw JSON may contain `&`.

import { parsePatchFile } from "../editor/files";
import type { PatchDoc } from "../types";

/** Longest fragment `readPatchLink` will decode (browsers allow ~2 MB). */
export const MAX_LINK_CHARS = 2_000_000;

const KEY = "patch=";

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A link that opens `doc` in the playground at `base` (e.g.
 * `https://empyreangate.org/playground`). The id is dropped: a link always
 * opens as a new patch. */
export async function patchLink(doc: PatchDoc, base: string): Promise<string> {
  const json = JSON.stringify({ ...doc, id: "" });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  return `${base.replace(/#.*$/, "")}#${KEY}z${toBase64Url(packed)}`;
}

/** The fragment's patch text, or null when it carries none. Accepts a whole
 * URL, a fragment with or without its `#`, or just the value. */
function linkValue(hashOrUrl: string): string | null {
  const hash = hashOrUrl.includes("#") ? hashOrUrl.slice(hashOrUrl.indexOf("#") + 1) : hashOrUrl;
  const at = hash.startsWith(KEY) ? 0 : hash.indexOf("&" + KEY);
  if (at < 0) return null;
  return hash.slice(at + (at === 0 ? 0 : 1) + KEY.length);
}

/** Whether a URL or fragment carries a patch (cheap; does not decode). */
export function hasPatchLink(hashOrUrl: string): boolean {
  return linkValue(hashOrUrl) !== null;
}

/** The patch a link carries, checked for shape (not for whether it runs:
 * that is the patch core's `validate`). Null when there is none; throws a
 * readable message when there is one but it cannot be read. */
export async function readPatchLink(hashOrUrl: string): Promise<PatchDoc | null> {
  const value = linkValue(hashOrUrl);
  if (value === null) return null;
  if (value.length > MAX_LINK_CHARS) throw new Error("That link's patch is too long to open.");
  let text: string;
  if (value.startsWith("z")) {
    try {
      text = new TextDecoder().decode(await pipe(fromBase64Url(value.slice(1)), new DecompressionStream("deflate-raw")));
    } catch {
      throw new Error("That link's patch is damaged (it may have been cut short).");
    }
  } else {
    try {
      text = decodeURIComponent(value);
    } catch {
      text = value;
    }
  }
  return { ...parsePatchFile(text), id: "" };
}
