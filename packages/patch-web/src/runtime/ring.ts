// Pictures of the array without a GPU view: the LED colors a frame read back
// (`PatchRuntime.readFrame`) drawn as the gate's preview draws them, a grid of
// several such pictures, a PNG encoder, and a few numbers about a frame. Pure
// TypeScript, so the same code makes an agent's snapshot in a browser, in Bun
// and in Node.

import type { Geometry } from "./gpu";

/** Fraction of the picture's short side the array's outer edge reaches (the
 * view's `VIEW_FILL`). */
const FILL = 0.96;

/** An RGBA8 picture. */
export interface Picture {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface RingOptions {
  /** Width and height in pixels (default 512). */
  size?: number;
  /** Behind the light, RGB 0..255 (default black; the PNG is opaque). */
  background?: [number, number, number];
}

/**
 * Draw one frame: `rgb` is `spokes × pixels` LEDs, 3 bytes each, spoke-major,
 * LED 0 at the outer end (the order the patch shader writes). Laid out and
 * shaded like the WebGPU view (`gpu.ts` `VIEW_WGSL`): spoke 0 at the bottom,
 * counter-clockwise, each drawn dot a bright core with a soft halo, light
 * adding up where dots overlap.
 */
export function renderRing(rgb: Uint8Array, geometry: Geometry, options: RingOptions = {}): Picture {
  const size = Math.max(16, Math.round(options.size ?? 512));
  const [br, bg, bb] = options.background ?? [0, 0, 0];
  const { spokes, pixels, innerOverOuter } = geometry;
  const acc = new Float32Array(size * size * 3);

  // The view's decimation: about one dot per 1.3 pixels of spoke, each dot
  // three spacings wide.
  const radiusPx = (size / 2) * FILL;
  const span = radiusPx * (1 - innerOverOuter);
  const drawn = Math.max(Math.min(32, pixels), Math.min(pixels, Math.round(span / 1.3)));
  const spacing = span / Math.max(drawn - 1, 1);
  const dotPx = Math.max(2, spacing * 3);
  const reach = Math.ceil(dotPx / 2);
  const center = size / 2;

  for (let s = 0; s < spokes; s++) {
    const theta = (s / spokes) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let k = 0; k < drawn; k++) {
      const i = drawn > 1 ? Math.round((k * (pixels - 1)) / (drawn - 1)) : 0;
      const o = (s * pixels + i) * 3;
      const r = rgb[o]! / 255;
      const g = rgb[o + 1]! / 255;
      const b = rgb[o + 2]! / 255;
      if (r + g + b === 0) continue;
      const rn = 1 + (innerOverOuter - 1) * (i / Math.max(pixels - 1, 1));
      // y up in the view, down in the picture.
      const cx = center + rn * cos * radiusPx;
      const cy = center - rn * sin * radiusPx;
      const x0 = Math.max(0, Math.floor(cx - reach));
      const x1 = Math.min(size - 1, Math.ceil(cx + reach));
      const y0 = Math.max(0, Math.floor(cy - reach));
      const y1 = Math.min(size - 1, Math.ceil(cy + reach));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / dotPx;
          const a = Math.max(1 - smoothstep(0.16, 0.36, d), (1 - smoothstep(0.26, 0.5, d)) * 0.45);
          if (a <= 0) continue;
          const p = (y * size + x) * 3;
          acc[p] += r * a;
          acc[p + 1] += g * a;
          acc[p + 2] += b * a;
        }
      }
    }
  }

  const rgba = new Uint8Array(size * size * 4);
  for (let p = 0, q = 0; p < acc.length; p += 3, q += 4) {
    rgba[q] = Math.min(255, Math.round(br + acc[p]! * 255));
    rgba[q + 1] = Math.min(255, Math.round(bg + acc[p + 1]! * 255));
    rgba[q + 2] = Math.min(255, Math.round(bb + acc[p + 2]! * 255));
    rgba[q + 3] = 255;
  }
  return { width: size, height: size, rgba };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Several pictures in a grid, left to right then top to bottom, `gap`
 * pixels of `background` between them. All must be the same size. */
export function contactSheet(
  pictures: Picture[],
  columns = Math.ceil(Math.sqrt(pictures.length)),
  gap = 4,
  background: [number, number, number] = [24, 24, 24],
): Picture {
  if (pictures.length === 0) throw new Error("contactSheet needs at least one picture");
  if (pictures.length === 1) return pictures[0]!;
  const { width: w, height: h } = pictures[0]!;
  const cols = Math.max(1, Math.min(columns, pictures.length));
  const rows = Math.ceil(pictures.length / cols);
  const width = cols * w + (cols - 1) * gap;
  const height = rows * h + (rows - 1) * gap;
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < rgba.length; p += 4) {
    rgba[p] = background[0];
    rgba[p + 1] = background[1];
    rgba[p + 2] = background[2];
    rgba[p + 3] = 255;
  }
  pictures.forEach((pic, n) => {
    if (pic.width !== w || pic.height !== h) throw new Error("contactSheet pictures differ in size");
    const ox = (n % cols) * (w + gap);
    const oy = Math.floor(n / cols) * (h + gap);
    for (let y = 0; y < h; y++) {
      rgba.set(pic.rgba.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * width + ox) * 4);
    }
  });
  return { width, height, rgba };
}

// --- PNG ----------------------------------------------------------------------

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** zlib-wrapped deflate (RFC 1950), as PNG's IDAT wants it. */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode an opaque RGBA picture as PNG (8-bit RGB, no filtering). */
export async function encodePng(picture: Picture): Promise<Uint8Array> {
  const { width, height, rgba } = picture;
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    let o = y * (width * 3 + 1);
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      raw[o++] = rgba[p]!;
      raw[o++] = rgba[p + 1]!;
      raw[o++] = rgba[p + 2]!;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())];
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const out = new Uint8Array(signature.length + chunks.reduce((n, c) => n + c.length, 0));
  out.set(signature);
  let o = signature.length;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Bytes as base64 (no data: prefix), without a Buffer. */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// --- numbers about a frame -------------------------------------------------------

/** What a frame looks like, in numbers: enough for an agent that cannot see
 * the picture to tell black from lit, one color from many, still from moving
 * (compare two frames). */
export interface FrameStats {
  /** Share of LEDs visibly lit (brightest channel over 4%). */
  lit: number;
  /** Mean brightness over all LEDs, 0..1 (brightest channel). */
  mean: number;
  /** Brightest LED, 0..1. */
  peak: number;
  /** Hues of the lit LEDs, biggest share first (at most four), from a
   * twelve-bin histogram; `hue` 0..1 (0 red, 1/3 green, 2/3 blue). Unsaturated
   * light counts as `white`. */
  colors: { name: string; hue: number | null; share: number }[];
  /** Mean brightness per ring band, outer edge first (eight bands). */
  radial: number[];
  /** Mean brightness per eighth of the circle, from spoke 0 (bottom)
   * counter-clockwise. */
  angular: number[];
}

const HUE_NAMES = [
  "red",
  "orange",
  "yellow",
  "chartreuse",
  "green",
  "spring green",
  "cyan",
  "azure",
  "blue",
  "violet",
  "magenta",
  "rose",
];

export function frameStats(rgb: Uint8Array, geometry: Geometry): FrameStats {
  const { spokes, pixels } = geometry;
  const total = spokes * pixels;
  const bins = new Float64Array(13); // 12 hues + white
  const radial = new Float64Array(8);
  const angular = new Float64Array(8);
  let lit = 0;
  let sum = 0;
  let peak = 0;
  for (let s = 0; s < spokes; s++) {
    const sector = Math.min(7, Math.floor((s / spokes) * 8));
    for (let i = 0; i < pixels; i++) {
      const o = (s * pixels + i) * 3;
      const r = rgb[o]! / 255;
      const g = rgb[o + 1]! / 255;
      const b = rgb[o + 2]! / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      sum += max;
      peak = Math.max(peak, max);
      radial[Math.min(7, Math.floor((i / pixels) * 8))] += max;
      angular[sector] += max;
      if (max <= 0.04) continue;
      lit++;
      const sat = (max - min) / max;
      if (sat < 0.2) {
        bins[12] += max;
        continue;
      }
      bins[Math.round(hueOf(r, g, b, max, min) * 12) % 12] += max;
    }
  }
  const weight = bins.reduce((a, b) => a + b, 0);
  const colors = [...bins]
    .map((w, n) => ({
      name: n === 12 ? "white" : HUE_NAMES[n]!,
      hue: n === 12 ? null : n / 12,
      share: weight > 0 ? w / weight : 0,
    }))
    .filter((c) => c.share >= 0.05)
    .sort((a, b) => b.share - a.share)
    .slice(0, 4)
    .map((c) => ({ ...c, share: round(c.share) }));
  return {
    lit: round(lit / total),
    mean: round(sum / total),
    peak: round(peak),
    colors,
    radial: [...radial].map((v) => round(v / (spokes * (pixels / 8)))),
    angular: [...angular].map((v) => round(v / ((spokes / 8) * pixels))),
  };
}

function hueOf(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h / 6;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
