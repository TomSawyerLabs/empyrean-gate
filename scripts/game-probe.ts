// Start a game on a running backend, let it run, optionally tap into it, and
// save what the array shows as a PNG — the way to look at a game world
// without a rig (plans/hidden-modes.md). Loopback is the operator, so the
// backend must be on this machine (`empyrean-gate --headless`).
//
//   bun scripts/game-probe.ts gathering
//   bun scripts/game-probe.ts --url ws://127.0.0.1:9540/ws --after 40 --taps 12 --stop perimeter
//
// `--after` seconds to let the world run before the capture (default 20),
// `--taps` random taps with random chips spread over that time (default 0),
// `--every` seconds between captures when more than one is wanted via
// `--frames`, `--stop` ends the game afterwards (default: leave it running).
// `--species n` sets the knob the way the Games tab's Start does, and
// `--command name` (repeatable) presses a game button with chip 0 halfway
// through the run (plans/classic-games.md).
// Output lands in test-results/games/<kind>[-<n>].png, the array drawn as a
// disc with pixel 0 at the rim like the shape probe.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const args = process.argv.slice(2);
let url = "ws://127.0.0.1:9520/ws";
let after = 20;
let taps = 0;
let frames = 1;
let every = 5;
let stop = false;
let species: number | null = null;
const commands: string[] = [];
const kinds: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--url") url = args[++i];
  else if (a === "--after") after = Number(args[++i]);
  else if (a === "--taps") taps = Number(args[++i]);
  else if (a === "--frames") frames = Number(args[++i]);
  else if (a === "--every") every = Number(args[++i]);
  else if (a === "--stop") stop = true;
  else if (a === "--species") species = Number(args[++i]);
  else if (a === "--command") commands.push(args[++i]);
  else kinds.push(a);
}
if (kinds.length !== 1) {
  console.error("usage: bun scripts/game-probe.ts [--url ws] [--after s] [--taps n] [--frames n] [--every s] [--species n] [--command name]… [--stop] <game>");
  process.exit(2);
}
const kind = kinds[0];
const OUT_DIR = "test-results/games";
const IMG = 480;
const INNER = 0.32;

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
  out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The array as a disc: each LED a small dot, spoke 0 at 3 o'clock, pixel 0
 *  at the rim. */
function render(frame: Frame): Uint8Array {
  const img = new Uint8Array(IMG * IMG * 3);
  for (let y = 0; y < IMG; y++) {
    for (let x = 0; x < IMG; x++) {
      const dx = (x / (IMG - 1)) * 2 - 1;
      const dy = 1 - (y / (IMG - 1)) * 2;
      const r = Math.hypot(dx, dy);
      if (r <= 1 && r >= INNER) {
        const o = (y * IMG + x) * 3;
        img[o] = 10;
        img[o + 1] = 10;
        img[o + 2] = 16;
      }
    }
  }
  const dot = Math.max(1, Math.round(IMG / frame.spokes / 3));
  for (let s = 0; s < frame.spokes; s++) {
    const theta = (s / frame.spokes) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    for (let i = 0; i < frame.pixels; i++) {
      const rn = 1 - (i / (frame.pixels - 1)) * (1 - INNER);
      const base = (s * frame.pixels + i) * 3;
      const cx = Math.round(((ct * rn + 1) / 2) * (IMG - 1));
      const cy = Math.round(((1 - st * rn) / 2) * (IMG - 1));
      for (let ddy = -dot; ddy <= dot; ddy++) {
        for (let ddx = -dot; ddx <= dot; ddx++) {
          const px = cx + ddx;
          const py = cy + ddy;
          if (px < 0 || py < 0 || px >= IMG || py >= IMG) continue;
          const o = (py * IMG + px) * 3;
          for (let c = 0; c < 3; c++) if (frame.rgb[base + c] > img[o + c]) img[o + c] = frame.rgb[base + c];
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
let summary = "";
const waitFrame = async (): Promise<Frame> => {
  const start = Date.now();
  latest = null;
  while (!latest) {
    if (Date.now() - start > 5000) throw new Error("no preview frames from the backend");
    await new Promise((r) => setTimeout(r, 10));
  }
  return latest;
};
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

ws.onmessage = (ev) => {
  if (typeof ev.data === "string") {
    const m = JSON.parse(ev.data);
    if (m.type === "error" || m.type === "denied") console.error("server said:", m);
    if (m.type === "status" && m.status?.game?.summary) summary = m.status.game.summary;
    if (m.type === "state" && m.status?.game?.summary) summary = m.status.game.summary;
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
  ws.send(JSON.stringify({ type: "hello", name: "game-probe", client_id: "game-probe", token: "" }));
  ws.send(JSON.stringify({ type: "subscribe_preview", fps: 20, decimate: 1 }));
  ws.send(JSON.stringify({ type: "set_game_mode", game: kind }));
  if (species !== null) ws.send(JSON.stringify({ type: "set_game_config", species }));
  mkdirSync(OUT_DIR, { recursive: true });
  let pressed = false;
  const tapEvery = taps > 0 ? after / taps : 0;
  let tapped = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < after * 1000) {
    if (taps > 0 && tapped < taps && Date.now() - t0 >= tapped * tapEvery * 1000) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.4 + Math.random() * 0.55;
      ws.send(JSON.stringify({ type: "game_input", species: tapped % 6, points: [{ angle, radius, dir: 0 }] }));
      tapped++;
    }
    if (!pressed && Date.now() - t0 >= (after * 1000) / 2) {
      for (const command of commands) ws.send(JSON.stringify({ type: "game_command", command, species: 0 }));
      pressed = true;
    }
    await sleep(0.1);
  }
  for (let n = 0; n < frames; n++) {
    if (n > 0) await sleep(every);
    const frame = await waitFrame();
    const file = `${OUT_DIR}/${kind}${frames > 1 ? `-${n + 1}` : ""}.png`;
    writeFileSync(file, png(IMG, IMG, render(frame)));
    let lit = 0;
    for (let i = 0; i < frame.rgb.length; i += 3) if (frame.rgb[i] + frame.rgb[i + 1] + frame.rgb[i + 2] > 24) lit++;
    console.log(`${file} (${lit} of ${frame.spokes * frame.pixels} LEDs lit${summary ? ` · ${summary}` : ""})`);
  }
  if (stop) ws.send(JSON.stringify({ type: "set_game_mode", game: null }));
  await sleep(0.3);
  process.exit(0);
};

setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, (after + frames * every + 30) * 1000);
