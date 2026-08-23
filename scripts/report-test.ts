// Feedback report end-to-end test. Requires a running backend (any instance).
//
//  1. drive some operator input (effects + a drawn stroke)
//  2. ask for a report over the WebSocket
//  3. verify the bundle exists over HTTP: summary listing, report.json shape,
//     frames.bin size matching its declared geometry, and a real PNG contact
//     sheet — the part an agent actually looks at
//
// Usage: bun scripts/report-test.ts [http base]

const base = process.argv[2] ?? "http://127.0.0.1:9520";

function fail(msg: string): never {
  console.error(`REPORT FAIL: ${msg}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
let saved: any = null;
let error: string | null = null;

ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") return;
  const m = JSON.parse(ev.data);
  if (m.type === "report_saved") saved = m.report;
  if (m.type === "error") error = m.message;
};

await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve();
  ws.onerror = () => reject(new Error(`cannot connect to ${base}`));
});
ws.send(JSON.stringify({ type: "hello", name: "report-test", client_id: "report-test", token: "" }));
// A preview subscription is not required for capture — the recorder samples the
// engine directly — but subscribing proves the two paths coexist.
ws.send(JSON.stringify({ type: "subscribe_preview", fps: 10, decimate: 8 }));

// Operator input to find in the timeline.
const EFFECTS = 4;
for (let i = 0; i < EFFECTS; i++) {
  ws.send(
    JSON.stringify({
      type: "trigger_effect",
      effect: { kind: "burst", angle: i, radius: 0.5, intensity: 1, size: 1, hue: 0.5, duration: 0 },
    }),
  );
  await sleep(300);
}
// A stroke: 20 messages that must fold into a handful of timeline entries.
for (let i = 0; i < 20; i++) {
  ws.send(
    JSON.stringify({
      type: "paint",
      pen: "glow",
      points: [{ angle: i / 3, radius: 0.6, dir: 0 }],
      hue: 0.2,
      size: 0.12,
      intensity: 1,
    }),
  );
  await sleep(30);
}
ws.send(JSON.stringify({ type: "set_master", speed: 1.5 }));
await sleep(1500);

const DESCRIPTION = "report-test: bursts then a glow stroke, checking the capture";
ws.send(JSON.stringify({ type: "report", description: DESCRIPTION, seconds: 10 }));

for (let i = 0; i < 100 && !saved && !error; i++) await sleep(100);
if (error) fail(`backend refused the report: ${error}`);
if (!saved) fail("no report_saved broadcast within 10 s");
console.log(`saved ${saved.id} (${saved.frames} frames) -> ${saved.path}`);

// --- listing ---
const list = await (await fetch(`${base}/reports`)).json();
if (!Array.isArray(list) || !list.some((r: any) => r.id === saved.id)) {
  fail("saved report missing from GET /reports");
}
if (list[0].id !== saved.id) fail("GET /reports is not newest-first");

// --- report.json ---
const report = await (await fetch(`${base}/reports/${saved.id}/report.json`)).json();
if (report.schema !== "empyrean-gate/report/1") fail(`unexpected schema ${report.schema}`);
if (report.description !== DESCRIPTION) fail("description did not round-trip");
if (!report.config?.geometry) fail("config snapshot missing");
if (!report.status) fail("runtime status missing");

const effects = report.timeline.filter((e: any) => e.kind === "effect");
if (effects.length !== EFFECTS) fail(`timeline has ${effects.length} effects, expected ${EFFECTS}`);
const paints = report.timeline.filter((e: any) => e.kind === "paint");
if (paints.length === 0) fail("stroke missing from the timeline");
if (paints.length >= 20) fail(`paint events were not folded (${paints.length} entries for 20 messages)`);
const points = paints.reduce((n: number, e: any) => n + e.detail.points, 0);
if (points !== 20) fail(`folded paint totals lost points: ${points} != 20`);
if (!report.timeline.some((e: any) => e.kind === "master")) fail("master speed change missing");

if (report.snapshots.length < 5) fail(`only ${report.snapshots.length} snapshots in 10 s`);
const last = report.snapshots.at(-1);
if (!Array.isArray(last.layers) || last.layers.length === 0) fail("snapshots carry no layer params");
if (!Array.isArray(last.audio)) fail("snapshots carry no audio block");
const span = last.t - report.snapshots[0].t;
if (span > 11) fail(`snapshot window is ${span.toFixed(1)} s, wider than requested`);

// --- frames.bin ---
const frames = new Uint8Array(await (await fetch(`${base}/reports/${saved.id}/frames.bin`)).arrayBuffer());
const meta = report.frames;
const expected = meta.count * meta.spokes * meta.pixels_per_spoke * 3;
if (frames.length !== expected) {
  fail(`frames.bin is ${frames.length} bytes, header describes ${expected}`);
}
if (meta.count !== report.frames_count && meta.count !== saved.frames) {
  fail(`frame count disagrees: bundle ${meta.count}, summary ${saved.frames}`);
}

// --- contact sheet ---
const png = new Uint8Array(await (await fetch(`${base}/reports/${saved.id}/contact-sheet.png`)).arrayBuffer());
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
if (png.length < 1000 || SIGNATURE.some((b, i) => png[i] !== b)) {
  fail(`contact-sheet.png is not a PNG (${png.length} bytes)`);
}

// --- path traversal defense ---
const traversal = await fetch(`${base}/reports/..%2F..%2Fconfig/report.json`);
if (traversal.ok) fail("report file endpoint served a traversal path");

console.log(
  `timeline ${report.timeline.length} entries (${effects.length} effects, ${paints.length} folded paints), ` +
    `${report.snapshots.length} snapshots, ${meta.count} frames, ${png.length}-byte contact sheet`,
);
console.log("REPORT PASS");
process.exit(0);
