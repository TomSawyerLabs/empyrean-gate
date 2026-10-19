// Pictures in patches, decoded without a DOM: the command line's renders
// (and the palette's thumbnails) show Still image and Clip nodes whose
// picture is a PNG. Other formats (the editor also stores WebP and JPEG)
// stay unloaded here, as black, and say so once.

import { inflateSync } from "node:zlib";

/** An 8-bit, non-interlaced PNG as RGBA. Throws on anything else. */
export function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (view.getUint32(0) !== 0x89504e47) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = data[8]!;
      colorType = data[9]!;
      if (depth !== 8 || data[12] !== 0 || ![0, 2, 4, 6].includes(colorType)) {
        throw new Error("only 8-bit, non-interlaced grey/RGB(A) PNGs");
      }
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]!;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels]! : 0;
      const b = up ? up[x]! : 0;
      const c = up && x >= channels ? up[x - channels]! : 0;
      let v = src[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = pixels.subarray(i * channels, i * channels + channels);
    const grey = channels <= 2;
    rgba[i * 4] = p[0]!;
    rgba[i * 4 + 1] = grey ? p[0]! : p[1]!;
    rgba[i * 4 + 2] = grey ? p[0]! : p[2]!;
    rgba[i * 4 + 3] = channels === 2 ? p[1]! : channels === 4 ? p[3]! : 255;
  }
  return { width, height, rgba };
}

let warned = false;

/** A data URL picture as `size`² RGBA (center-cropped square, like the gate),
 * for `PatchRuntime`'s `decodeImage` option. */
export async function decodeDataUrl(dataUrl: string, size: number): Promise<Uint8Array> {
  const match = /^data:image\/png;base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    if (!warned) console.warn("Only PNG pictures render on the command line; others stay black.");
    warned = true;
    throw new Error("not a PNG data URL");
  }
  const { width, height, rgba } = decodePng(Buffer.from(match[1]!, "base64"));
  const side = Math.min(width, height);
  const x0 = (width - side) / 2;
  const y0 = (height - side) / 2;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor(x0 + ((x + 0.5) * side) / size);
      const sy = Math.floor(y0 + ((y + 0.5) * side) / size);
      out.set(rgba.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * size + x) * 4);
    }
  }
  return out;
}
