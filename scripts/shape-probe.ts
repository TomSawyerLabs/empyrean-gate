// Diagnostic: render what a triggered effect actually looks like on the array.
//
// Connects to a running backend, subscribes to the preview, and for each effect
// named on the command line captures a frame before the trigger and one a beat
// after it, then writes the DIFFERENCE to a PNG. The difference is what isolates
// the effect from whatever layer stack happens to be live, so this works against
// a real show without touching its configuration.
//
//   bun scripts/shape-probe.ts star heart flower diamond triangle moon
//   bun scripts/shape-probe.ts --url ws://gate.local:9520/ws --at 0.35 bloom
//
// Output lands in test-results/shapes/<kind>.png.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
let url = "ws://127.0.0.1:9520/ws";
// When in the effect's life to capture. Shapes have settled by ~0.3.
let at = 0.35;
let size = 2.4;
let grow = 0;
let radius = 0;
const kinds: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--url") url = args[++i];
  else if (a === "--at") at = Number(args[++i]);
  else if (a === "--size") size = Number(args[++i]);
  else if (a === "--grow") grow = Number(args[++i]);
  else if (a === "--radius") radius = Number(args[++i]);
  else kinds.push(a);
}
if (kinds.length === 0) {
  console.error("usage: bun scripts/shape-probe.ts [--url ws] [--at 0..1] [--size n] kind...");
  process.exit(2);
}

const OUT_DIR = "test-results/shapes";
const IMG = 480;

interface Frame {
  spokes: number;
  pixels: number;
  rgb: Uint8Array;
}

function parse(buf: ArrayBuffer): Frame | null {
  const view = new DataView(buf);
  const spokes = view.getUint16(8, true);
  const pixels = view.getUint16(10, true);
  const rgb = new Uint8Array(buf, 12);
  if (spokes === 0 || pixels === 0 || rgb.length < spokes * pixels * 3) return null;
  return { spokes, pixels, rgb };
}

// --- Minimal PNG writer (RGB8, one IDAT) -----------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(width: number, height: number, rgb: Uint8Array): Uint8Array {
  // One filter byte (0 = none) per scanline, then the row.
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1);
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// --- Array -> image ---------------------------------------------------------

/** Inner radius over outer, matching the default geometry (8 ft of 25 ft). */
const INNER = 0.32;

function render(before: Frame, after: Frame): Uint8Array {
  const img = new Uint8Array(IMG * IMG * 3);
  // Faint guide ring so the array's own footprint is visible in the output.
  for (let y = 0; y < IMG; y++) {
    for (let x = 0; x < IMG; x++) {
      const nx = (x / (IMG - 1)) * 2 - 1;
      const ny = 1 - (y / (IMG - 1)) * 2;
      const r = Math.hypot(nx, ny);
      if (r <= 1 && r >= INNER) {
        const o = (y * IMG + x) * 3;
        img[o] = 10;
        img[o + 1] = 10;
        img[o + 2] = 16;
      }
    }
  }
  // Each pixel is a small disc so the coarse spoke pitch stays legible.
  const dot = Math.max(1, Math.round(IMG / after.spokes / 3));
  for (let s = 0; s < after.spokes; s++) {
    const theta = (s / after.spokes) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    for (let i = 0; i < after.pixels; i++) {
      // Pixel 0 is the OUTER end of the spoke.
      const rn = 1 - (i / (after.pixels - 1)) * (1 - INNER);
      const base = (s * after.pixels + i) * 3;
      const cx = Math.round(((ct * rn + 1) / 2) * (IMG - 1));
      const cy = Math.round(((1 - st * rn) / 2) * (IMG - 1));
      for (let dy = -dot; dy <= dot; dy++) {
        for (let dx = -dot; dx <= dot; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= IMG || y >= IMG) continue;
          const o = (y * IMG + x) * 3;
          for (let c = 0; c < 3; c++) {
            const d = Math.max(0, after.rgb[base + c] - before.rgb[base + c]);
            if (d > img[o + c]) img[o + c] = d;
          }
        }
      }
    }
  }
  return img;
}

// --- Drive ------------------------------------------------------------------

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";

let latest: Frame | null = null;
const waitFrame = async (): Promise<Frame> => {
  const start = Date.now();
  latest = null;
  while (!latest) {
    if (Date.now() - start > 5000) throw new Error("no preview frames from the backend");
    await new Promise((r) => setTimeout(r, 10));
  }
  return latest;
};

ws.onmessage = (ev) => {
  if (typeof ev.data === "string") {
    const m = JSON.parse(ev.data);
    if (m.type === "error" || m.type === "denied") console.error("server said:", m);
    return;
  }
  const f = parse(ev.data as ArrayBuffer);
  if (f) latest = { spokes: f.spokes, pixels: f.pixels, rgb: new Uint8Array(f.rgb) };
};

ws.onerror = () => {
  console.error(`could not reach ${url} — is the backend running?`);
  process.exit(1);
};

ws.onopen = async () => {
  ws.send(JSON.stringify({ type: "hello", name: "shape-probe", client_id: "shape-probe", token: "" }));
  ws.send(JSON.stringify({ type: "subscribe_preview", fps: 60, decimate: 1 }));
  mkdirSync(OUT_DIR, { recursive: true });

  for (const kind of kinds) {
    const before = await waitFrame();
    const duration = 2.0;
    ws.send(
      JSON.stringify({
        type: "trigger_effect",
        effect: {
          kind,
          angle: 0,
          radius,
          intensity: 1,
          size,
          hue: -1,
          saturation: 0.85,
          brightness: 1,
          duration,
          rotation: 0,
          grow,
        },
      }),
    );
    await new Promise((r) => setTimeout(r, at * duration * 1000));
    const after = await waitFrame();
    const file = `${OUT_DIR}/${kind}.png`;
    writeFileSync(file, png(IMG, IMG, render(before, after)));
    let lit = 0;
    for (let i = 0; i < after.rgb.length; i++) {
      if (after.rgb[i] > before.rgb[i] + 8) lit++;
    }
    console.log(`${kind}: ${file} (${lit} channels lit)`);
    // Let the previous effect expire before the next one is measured.
    await new Promise((r) => setTimeout(r, duration * 1000));
  }
  process.exit(0);
};

setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, 120_000);
