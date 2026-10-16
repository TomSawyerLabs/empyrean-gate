// Clip nodes store a short loop inside the patch as one 256×256 sprite sheet
// (crate `clip` node, `clip_at` in patch_lib.wgsl): grid×grid frames read
// left to right, top to bottom. This turns a video or an animated image into
// that sheet in the browser.

import { IMAGE_SIZE, MAX_MEDIA_BYTES } from "./files";

/** Frames per side of the sheet, by the registry's `grid` select index
 * (4×4 of 64 px, 8×8 of 32 px, 2×2 of 128 px). */
export const CLIP_GRIDS = [4, 8, 2] as const;

export interface ClipSheet {
  /** The sheet as a data URL. */
  media: string;
  /** How many cells hold a frame (the registry's `frames` param). */
  frames: number;
}

/** Minimal typing for the WebCodecs ImageDecoder (animated GIF/WebP/APNG),
 * which not every browser or TypeScript lib knows. */
interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(options: { frameIndex: number }): Promise<{ image: ImageBitmapSource & { close(): void } }>;
  close(): void;
}
type ImageDecoderCtor = new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike;

function imageDecoder(): ImageDecoderCtor | null {
  const w = globalThis as { ImageDecoder?: ImageDecoderCtor };
  return typeof w.ImageDecoder === "function" ? w.ImageDecoder : null;
}

/** Evenly spaced picks of `want` out of `have` (all of them when fewer). */
export function spread(have: number, want: number): number[] {
  if (have <= want) return Array.from({ length: have }, (_, i) => i);
  return Array.from({ length: want }, (_, k) => Math.floor(((k + 0.5) * have) / want));
}

async function videoFrames(file: Blob, want: number): Promise<ImageBitmap[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("That video could not be decoded."));
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) throw new Error("That video has no length to sample.");
    const frames: ImageBitmap[] = [];
    for (let k = 0; k < want; k++) {
      const at = (duration * (k + 0.5)) / want;
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("That video could not be decoded."));
        video.currentTime = at;
      });
      frames.push(await createImageBitmap(video));
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function imageFrames(file: Blob, want: number): Promise<ImageBitmap[]> {
  const Decoder = imageDecoder();
  if (Decoder && file.type) {
    const dec = new Decoder({ data: await file.arrayBuffer(), type: file.type });
    try {
      await dec.tracks.ready;
      const count = dec.tracks.selectedTrack?.frameCount ?? 1;
      const frames: ImageBitmap[] = [];
      for (const frameIndex of spread(count, want)) {
        const { image } = await dec.decode({ frameIndex });
        frames.push(await createImageBitmap(image));
        image.close();
      }
      return frames;
    } catch {
      // Fall through: a still of the first frame is better than nothing.
    } finally {
      dec.close();
    }
  }
  return [await createImageBitmap(file)];
}

/** Turn a video or an (animated) image into a Clip sheet of the given grid.
 * Every frame is center-cropped to a square and scaled to its cell. */
export async function fileToClip(file: Blob, gridIndex: number): Promise<ClipSheet> {
  const grid = CLIP_GRIDS[gridIndex] ?? CLIP_GRIDS[0];
  const want = grid * grid;
  const cell = IMAGE_SIZE / grid;
  const frames = file.type.startsWith("video/")
    ? await videoFrames(file, want)
    : await imageFrames(file, want);
  if (frames.length === 0) throw new Error("No frames could be read from that file.");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext("2d")!;
  frames.forEach((bitmap, k) => {
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      (k % grid) * cell,
      Math.floor(k / grid) * cell,
      cell,
      cell,
    );
    bitmap.close();
  });
  for (const [type, quality] of [
    ["image/webp", 0.8],
    ["image/jpeg", 0.8],
    ["image/png", undefined],
  ] as const) {
    const url = canvas.toDataURL(type, quality);
    if (url.startsWith(`data:${type};`) && url.length <= MAX_MEDIA_BYTES) {
      return { media: url, frames: frames.length };
    }
  }
  throw new Error("That clip is too detailed to store in a patch; try a smaller grid.");
}
