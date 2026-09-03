// Mini-preview end-to-end test: spawns an ISOLATED headless backend (scratch
// config, its own port), subscribes to the mini stream, and verifies both
// flavors — per-layer solo thumbnails while the layer stack renders, and
// per-node cells + scalar meters once a patch goes on air — plus the
// mode-flip clear batch and the id/meta bookkeeping between them.
//
// Usage: bun scripts/mini-preview-test.ts [path-to-exe]
// (builds nothing itself — run `cargo build` in src-tauri first)

import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXE =
  process.argv[2] ??
  join(import.meta.dir, "..", "src-tauri", "target", "debug", "empyrean-gate.exe");
const PORT = 9539;
const BASE = `http://127.0.0.1:${PORT}`;
const MINI_MAGIC = 0x45474d56;

let child: ChildProcess | null = null;
let dir: string | null = null;

function cleanup() {
  child?.kill();
  // MINI_KEEP=1 preserves the scratch dir (config + backend log) for debugging.
  if (dir && !process.env.MINI_KEEP) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may still hold the exe briefly; the temp dir is disposable.
    }
  } else if (dir) {
    console.error(`scratch dir kept: ${dir}`);
  }
}

function fail(msg: string): never {
  console.error(`MINI FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- isolated backend -------------------------------------------------------

dir = mkdtempSync(join(tmpdir(), "empyrean-mini-"));
// A COPY of the exe: running the original while `tauri dev` watches it breaks
// the watcher's relink (see plans/empyrean-gate.md round 4 gotcha).
const exe = join(dir, "empyrean-gate-mini-test.exe");
copyFileSync(EXE, exe);
const configPath = join(dir, "config.json");
await Bun.write(
  configPath,
  JSON.stringify({
    ...JSON.parse(
      readFileSync(join(import.meta.dir, "..", "tests/fixtures/default-config.json"), "utf8"),
    ),
    server: {
      bind: "127.0.0.1",
      port: PORT,
      max_preview_clients: 10,
      auth_token: null,
      join_token: "",
      require_token: false,
    },
  }),
);
child = spawn(exe, ["--headless"], {
  env: { ...process.env, EMPYREAN_CONFIG: configPath },
  stdio: "ignore",
});

let up = false;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${BASE}/health`)).ok) {
      up = true;
      break;
    }
  } catch {}
  await sleep(200);
}
if (!up) fail("backend did not come up on the isolated port");
console.log("backend up");

// --- WS client --------------------------------------------------------------

type Msg = Record<string, any>;
interface Batch {
  batch: number;
  kind: number;
  spokes: number;
  pixels: number;
  cells: { id: number; rgb: Uint8Array }[];
  scalars: { id: number; value: number }[];
}
const inbox: Msg[] = [];
// Metas land here too: they can arrive BEFORE the 2 Hz status tick a phase is
// waiting on, and the sequential cursor would consume them unseen.
const metas: Msg[] = [];
const batches: Batch[] = [];
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
ws.binaryType = "arraybuffer";
await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve();
  ws.onerror = () => reject(fail("cannot connect WS"));
});
ws.onmessage = (ev) => {
  if (typeof ev.data === "string") {
    const m = JSON.parse(ev.data);
    if (m.type === "mini_preview_meta") metas.push(m);
    inbox.push(m);
    return;
  }
  const buf = ev.data as ArrayBuffer;
  const view = new DataView(buf);
  if (buf.byteLength < 20 || view.getUint32(0, true) !== MINI_MAGIC) return;
  const b: Batch = {
    batch: view.getUint32(4, true),
    kind: view.getUint8(12),
    spokes: view.getUint16(8, true),
    pixels: view.getUint16(10, true),
    cells: [],
    scalars: [],
  };
  const cellCount = view.getUint16(14, true);
  const scalarCount = view.getUint16(16, true);
  const cellLen = b.spokes * b.pixels * 3;
  let o = 20;
  for (let c = 0; c < cellCount; c++) {
    const id = view.getUint16(o, true);
    o += 4;
    b.cells.push({ id, rgb: new Uint8Array(buf, o, cellLen) });
    o += cellLen;
  }
  for (let s = 0; s < scalarCount; s++) {
    b.scalars.push({ id: view.getUint16(o, true), value: view.getFloat32(o + 4, true) });
    o += 8;
  }
  if (o !== buf.byteLength) fail(`batch framing off: consumed ${o} of ${buf.byteLength}`);
  batches.push(b);
};
const send = (m: Msg) => ws.send(JSON.stringify(m));
let cursor = 0;
async function waitFor(pred: (m: Msg) => boolean, what: string, ms = 8000): Promise<Msg> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    while (cursor < inbox.length) {
      const m = inbox[cursor++];
      if (pred(m)) return m;
    }
    await sleep(50);
  }
  fail(`timed out waiting for ${what}`);
}

send({ type: "hello", name: "mini-test", client_id: "mini-test", token: "" });
const state = await waitFor((m) => m.type === "state", "greeting state");
const enabledLayers: number[] = state.config.layers
  .map((l: Msg, i: number) => (l.enabled ? i : -1))
  .filter((i: number) => i >= 0);
if (enabledLayers.length === 0) fail("default config has no enabled layers to preview");

// --- 1. layer thumbnails ----------------------------------------------------

async function waitMeta(pred: (m: Msg) => boolean, what: string, ms = 8000): Promise<Msg> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const m = metas.find(pred);
    if (m) return m;
    await sleep(50);
  }
  fail(`timed out waiting for ${what}`);
}

send({ type: "subscribe_mini_previews", fps: 10 });
const meta = await waitMeta((m) => true, "mini meta");
if (meta.pixels > 16 || meta.pixels < 1) fail(`unreasonable mini pixels ${meta.pixels}`);
if (meta.spokes !== state.config.geometry.spokes) {
  fail(`mini spokes ${meta.spokes} != geometry ${state.config.geometry.spokes}`);
}

await sleep(1500);
const layerBatches = batches.filter((b) => b.kind === 0 && b.cells.length > 0);
if (layerBatches.length < 3) fail(`only ${layerBatches.length} layer batches in 1.5 s`);
const last = layerBatches[layerBatches.length - 1];
for (const cell of last.cells) {
  if (!enabledLayers.includes(cell.id)) fail(`cell for layer ${cell.id}, which is not enabled`);
  if (cell.rgb.length !== last.spokes * last.pixels * 3) fail("cell size mismatch");
}
if (last.cells.length !== enabledLayers.length) {
  fail(`${last.cells.length} cells for ${enabledLayers.length} enabled layers`);
}
const lit = last.cells.filter((c) => c.rgb.some((v) => v > 8));
if (lit.length === 0) fail("every layer thumbnail is black — solo renders not happening");
console.log(
  `layer minis OK: ${layerBatches.length} batches, ${last.cells.length} cells (${lit.length} lit), ${last.spokes}×${last.pixels}`,
);

// --- 2. patch mode ----------------------------------------------------------

const doc = {
  format: 1,
  id: "",
  name: "Mini Test",
  description: "",
  nodes: [
    { id: "gen", kind: "noise_field", name: "", params: { brightness: 1.5 }, pos: [0, 0] },
    { id: "lfo", kind: "lfo", name: "", params: { rate: 2 }, pos: [0, 120] },
    { id: "out", kind: "output", name: "", params: {}, pos: [300, 0] },
  ],
  edges: [
    { from: { node: "gen", port: "out" }, to: { node: "out", port: "in" } },
    { from: { node: "lfo", port: "out" }, to: { node: "gen", port: "threshold" } },
  ],
  exposed: [],
};
send({ type: "patch_save", patch: doc });
const echo = await waitFor((m) => m.type === "patch", "patch save echo");
const patchId = echo.patch.id as string;
send({ type: "patch_activate", id: patchId });
await waitFor(
  (m) => m.type === "status" && m.status.patch_active === true && !m.status.patch_error,
  "patch on air",
);
const patchMeta = await waitMeta((m) => m.patch_nodes.length > 0, "patch mini meta");
if (!patchMeta.patch_nodes.includes("gen")) fail(`patch_nodes = ${patchMeta.patch_nodes}`);
if (!patchMeta.patch_scalars.some((s: Msg) => s.node === "lfo" && s.port === "out")) {
  fail("lfo out missing from patch_scalars");
}

const beforePatch = batches.length;
await sleep(1500);
const patchBatches = batches.slice(beforePatch).filter((b) => b.kind === 1);
if (patchBatches.length < 3) fail(`only ${patchBatches.length} patch batches in 1.5 s`);
// The flip must have cleared the layer cells exactly once.
if (!batches.some((b) => b.kind === 0 && b.cells.length === 0 && b.scalars.length === 0)) {
  fail("no layers clear batch at the patch flip");
}
const withCells = patchBatches.filter((b) => b.cells.length > 0);
if (withCells.length === 0) fail("no patch batches carry cells");
const pLast = withCells[withCells.length - 1];
const genSlot = patchMeta.patch_nodes.indexOf("gen");
const genCell = pLast.cells.find((c) => c.id === genSlot);
if (!genCell) fail("no cell for the noise_field node");
if (!genCell.rgb.some((v) => v > 8)) fail("noise_field cell is black");
const lfoSlot = patchMeta.patch_scalars.findIndex((s: Msg) => s.node === "lfo" && s.port === "out");
const lfoValues = patchBatches
  .flatMap((b) => b.scalars)
  .filter((s) => s.id === lfoSlot)
  .map((s) => s.value);
if (lfoValues.length < 3) fail("too few lfo meter samples");
if (new Set(lfoValues.map((v) => v.toFixed(4))).size < 2) {
  fail(`lfo meter is frozen at ${lfoValues[0]}`);
}
console.log(
  `patch minis OK: ${patchBatches.length} batches, node cell lit, lfo meter moving (${lfoValues.length} samples)`,
);

// --- 3. back to layers + unsubscribe ---------------------------------------

send({ type: "patch_activate", id: null });
await waitFor((m) => m.type === "status" && m.status.patch_active === false, "layer stack back");
const beforeBack = batches.length;
await sleep(800);
if (!batches.slice(beforeBack).some((b) => b.kind === 0 && b.cells.length > 0)) {
  fail("layer batches did not resume after patch deactivation");
}
send({ type: "unsubscribe_mini_previews" });
await sleep(300);
const afterUnsub = batches.length;
await sleep(800);
if (batches.length !== afterUnsub) fail("batches kept flowing after unsubscribe");
console.log("mode flip + unsubscribe OK");

send({ type: "patch_delete", id: patchId });
await sleep(200);
ws.close();
cleanup();
console.log("MINI PASS");
process.exit(0);
