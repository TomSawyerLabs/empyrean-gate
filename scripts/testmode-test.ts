// End-to-end test for hardware test mode and controller discovery, against a
// running backend (empyrean-gate --headless).
//
// The point of this one is that the assertions are on ACTUAL RENDERED PIXELS
// pulled off the preview stream, not on the status the backend reports about
// itself. Test mode exists to be believed about the hardware, so the thing worth
// proving is that "pixel 3 from the outer feed" really does light global index 3
// of every spoke and nothing else.
//
// Run against an isolated config:
//   EMPYREAN_CONFIG=/tmp/e2e.json cargo run --release -- --headless
//   bun scripts/testmode-test.ts

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:9520";
const WS_URL = `${BASE.replace("http", "ws")}/ws`;

// Small and exactly checkable. The real rig is 64 x 378; the mapping logic does
// not care, and a 48-pixel frame makes a failure readable.
const SPOKES = 4;
const PIXELS = 12;

function fail(msg: string): never {
  console.error(`TESTMODE FAIL: ${msg}`);
  process.exit(1);
}

interface Frame {
  spokes: number;
  pixels: number;
  rgb: Uint8Array;
}

const ws = new WebSocket(WS_URL);
ws.binaryType = "arraybuffer";

let config: Record<string, any> | null = null;
let status: Record<string, any> | null = null;
const errors: string[] = [];
let discovery: Record<string, any> | null = null;
let latest: Frame | null = null;

ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") {
    const buf = new Uint8Array(ev.data as ArrayBuffer);
    const view = new DataView(buf.buffer);
    if (buf.length < 12 || view.getUint32(0, true) !== 0x45475056) return;
    latest = {
      spokes: view.getUint16(8, true),
      pixels: view.getUint16(10, true),
      rgb: buf.subarray(12),
    };
    return;
  }
  const msg = JSON.parse(ev.data);
  if (msg.type === "state") {
    config = msg.config;
    status = msg.status;
  } else if (msg.type === "status") {
    status = msg.status;
  } else if (msg.type === "error") {
    errors.push(msg.message);
  } else if (msg.type === "discovery") {
    discovery = msg.result;
  }
};

const send = (m: unknown) => ws.send(JSON.stringify(m));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, get: () => T | null | undefined, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== null && v !== undefined && v !== false) return v as T;
    if (Date.now() > deadline) fail(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** A fresh frame, so an assertion never reads one rendered before the change. */
async function nextFrame(): Promise<Frame> {
  latest = null;
  const f = await waitFor("a preview frame", () => latest);
  if (f.spokes !== SPOKES || f.pixels !== PIXELS) {
    fail(`preview geometry is ${f.spokes}x${f.pixels}, expected ${SPOKES}x${PIXELS}`);
  }
  return f;
}

/** Indices of every non-black pixel, in order. */
function lit(f: Frame): number[] {
  const out: number[] = [];
  for (let p = 0; p < f.spokes * f.pixels; p++) {
    if (f.rgb[p * 3] || f.rgb[p * 3 + 1] || f.rgb[p * 3 + 2]) out.push(p);
  }
  return out;
}

function expectLit(f: Frame, want: number[], what: string) {
  const got = lit(f);
  const same = got.length === want.length && got.every((v, i) => v === want[i]);
  if (!same) {
    fail(`${what}\n  expected lit: [${want.join(", ")}]\n  actually lit: [${got.join(", ")}]`);
  }
  console.log(`  OK  ${what}`);
}

/** Set the live test parameters and wait for a frame rendered after the change. */
async function setTest(patch: Record<string, unknown>): Promise<Frame> {
  send({ type: "set_test_config", test: { ...testCfg, ...patch } });
  Object.assign(testCfg, patch);
  // Two frames: the first in flight may predate the change.
  await nextFrame();
  return nextFrame();
}

const testCfg: Record<string, unknown> = {
  pattern: "solid",
  brightness: 1,
  hue: -1,
  saturation: 0,
  index: 0,
  from_inner: false,
  width: 1,
  chase_hz: 0,
  blink_hz: 0,
  spoke_select: "all",
  spoke: 0,
  controller: 0,
  cycle_hz: 1,
  auto_exit_secs: 0,
};

await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve();
  ws.onerror = () => reject(new Error(`cannot connect to ${WS_URL}`));
  setTimeout(() => reject(new Error("connect timed out")), 8000);
}).catch((e) => fail(String(e)));

send({ type: "hello", name: "testmode-e2e", client_id: "testmode-e2e", token: "" });
const original = structuredClone(await waitFor("initial state", () => config));

// ---------------------------------------------------------------- geometry
console.log(`Setting a ${SPOKES}x${PIXELS} geometry for exact assertions…`);
send({
  type: "set_config",
  config: {
    ...original,
    geometry: { ...original.geometry, spokes: SPOKES, pixels_per_spoke: PIXELS },
    output: { ...original.output, pixels_per_universe: 4 },
    show_scheduler: { enabled: false, active_playlist_id: "", current_index: 0 },
  },
});
await waitFor("the new geometry", () => config?.geometry.pixels_per_spoke === PIXELS);
send({ type: "subscribe_preview", fps: 30, decimate: 1 });
await waitFor("preview frames", () => latest);

// ------------------------------------------------------- opening does nothing
console.log("\nTest mode starts disarmed:");
if (status?.test?.active) fail("test mode was already armed at startup");
console.log("  OK  disarmed on connect");

// Changing parameters while disarmed must not touch the rig.
await setTest({ pattern: "blackout" });
if (status?.test?.active) fail("setting test parameters armed test mode");
console.log("  OK  setting parameters does not arm it");

// ---------------------------------------------------------------- arming
console.log("\nArming:");
send({ type: "set_test_mode", active: true });
await waitFor("test mode to arm", () => status?.test?.active);
console.log("  OK  armed");

expectLit(await nextFrame(), [], "blackout lights nothing");

// ------------------------------------------------------------- Nth pixel
console.log("\nNth pixel:");
expectLit(
  await setTest({ pattern: "pixel_index", index: 3, from_inner: false }),
  [3, 15, 27, 39],
  "index 3 from the outer feed is pixel 3 of every spoke",
);
expectLit(
  await setTest({ index: 0, from_inner: true }),
  [11, 23, 35, 47],
  "index 0 from the inner end is the LAST pixel of every spoke",
);
expectLit(
  await setTest({ index: 2, from_inner: true, width: 3 }),
  [7, 8, 9, 19, 20, 21, 31, 32, 33, 43, 44, 45],
  "width extends away from the counted end",
);

// --------------------------------------------------------- spoke selection
console.log("\nSpoke selection:");
expectLit(
  await setTest({ pattern: "solid", spoke_select: "one", spoke: 2, width: 1, from_inner: false }),
  Array.from({ length: PIXELS }, (_, i) => 2 * PIXELS + i),
  "one spoke lights only that spoke",
);
expectLit(
  await setTest({ spoke_select: "controller", controller: 0 }),
  // 4 strings per controller, 4 spokes total: controller 0 owns all of them.
  Array.from({ length: SPOKES * PIXELS }, (_, i) => i),
  "controller 0 owns every spoke at 4 strings/controller",
);

// --------------------------------------------------------- universe marks
console.log("\nUniverse marks:");
expectLit(
  await setTest({ pattern: "universe_marks", spoke_select: "all" }),
  // 4 pixels per universe over 12 pixels: marks at 0, 4, 8 of each spoke.
  [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44],
  "marks land on every universe boundary (4 px/universe)",
);

// ------------------------------------------------------------- brightness
console.log("\nBrightness:");
const dim = await setTest({ pattern: "solid", brightness: 0.5, hue: -1, saturation: 0 });
if (dim.rgb[0] < 120 || dim.rgb[0] > 136) {
  fail(`50% white should be ~128/255 before LED gamma, got ${dim.rgb[0]}`);
}
console.log(`  OK  50% white renders as ${dim.rgb[0]}/255`);

// ----------------------------------------------- the show scheduler blocks it
console.log("\nA running show blocks arming:");
send({ type: "set_test_mode", active: false });
await waitFor("disarm", () => status?.test?.active === false);

const stack = {
  id: "e2e-stack",
  name: "E2E scene",
  layers: original.layers,
  master_speed: 1,
  walk_enabled: false,
  walk_layers: false,
  walk_min_layers: 1,
  walk_speed: 1,
  walk_depth: 1,
};
send({
  type: "set_config",
  config: {
    ...config,
    saved_playlists: [
      {
        id: "e2e-playlist",
        name: "E2E show",
        repeat: true,
        entries: [
          { id: "e2e-cue", name: "Cue", stack, duration_secs: 600, transition_secs: 1 },
        ],
      },
    ],
    show_scheduler: { enabled: true, active_playlist_id: "e2e-playlist", current_index: 0 },
  },
});
await waitFor("the show to be running", () => status?.test?.blocked_by_show === "E2E show");

errors.length = 0;
send({ type: "set_test_mode", active: true });
await waitFor("a refusal", () => errors.length > 0);
if (status?.test?.active) fail("test mode armed while a show was running");
if (!errors[0].includes("E2E show")) fail(`refusal did not name the show: ${errors[0]}`);
console.log(`  OK  refused, naming the show: "${errors[0]}"`);

send({
  type: "set_config",
  config: { ...config, show_scheduler: { enabled: false, active_playlist_id: "", current_index: 0 } },
});
await waitFor("the show to stop", () => status?.test?.blocked_by_show === null);
send({ type: "set_test_mode", active: true });
await waitFor("arming once the show is stopped", () => status?.test?.active);
console.log("  OK  arms once the show is stopped");

// ---------------------------------------------------------------- auto-exit
console.log("\nAuto-exit:");
send({ type: "set_test_config", test: { ...testCfg, auto_exit_secs: 1 } });
await waitFor("auto-exit to disarm test mode", () => status?.test?.active === false, 12000);
console.log("  OK  disarmed itself at the deadline");

// --------------------------------------------------------------- discovery
// Run `bun scripts/fake-pixlite.ts` alongside this to exercise the reconciliation
// against a responder; without it the scan is still expected to complete cleanly
// and simply find nothing.
console.log("\nController discovery:");
send({ type: "discover_controllers" });
const result = await waitFor("a discovery result", () => discovery, 20000);
console.log(
  `  OK  scan completed in ${result.duration_ms} ms via ${result.scanned_interface}: ` +
    `${result.found.length} found, ${result.missing.length} missing, ` +
    `${result.other_sources.length} other sACN source(s)`,
);
for (const e of result.errors) console.log(`      note: ${e}`);
if (!Array.isArray(result.found)) fail("discovery result has no `found` list");

// A configured address that nothing answers from must be reported as missing.
send({
  type: "set_config",
  config: { ...config, output: { ...config!.output, controllers: ["203.0.113.9"] } },
});
await waitFor("the controller list", () => config?.output.controllers[0] === "203.0.113.9");
discovery = null;
send({ type: "discover_controllers" });
const withMissing = await waitFor("a second scan", () => discovery, 20000);
if (!withMissing.missing.includes("203.0.113.9")) {
  fail(`an address nothing answered from should be missing: ${JSON.stringify(withMissing.missing)}`);
}
console.log("  OK  a configured address that does not answer is reported missing");

if (result.found.length > 0) {
  // Adopt whatever answered as the expected list; the reconciliation should then
  // report it as expected, with nothing missing.
  const ips = result.found.map((c: any) => c.ip);
  send({
    type: "set_config",
    config: { ...config, output: { ...config!.output, controllers: ips } },
  });
  await waitFor("the adopted controller list", () => config?.output.controllers[0] === ips[0]);
  discovery = null;
  send({ type: "discover_controllers" });
  const matched = await waitFor("a third scan", () => discovery, 20000);
  if (matched.missing.length > 0) fail(`nothing should be missing: ${matched.missing}`);
  if (matched.unexpected.length > 0) fail(`nothing should be unexpected: ${matched.unexpected}`);
  if (!matched.found.every((c: any) => c.expected)) fail("every controller should be expected");
  const sample = matched.found[0];
  console.log(
    `  OK  ${matched.found.length} controller(s) reconciled as expected ` +
      `(${sample.ip}, ${sample.model || "model unknown"}, via ${sample.protocol})`,
  );
} else {
  console.log("  --  no responder present; run scripts/fake-pixlite.ts to cover the match path");
}

// ------------------------------------------------------------------ restore
send({ type: "set_test_mode", active: false });
await waitFor("final disarm", () => status?.test?.active === false);
send({ type: "set_config", config: original });
await waitFor("the original geometry", () =>
  config?.geometry.pixels_per_spoke === original.geometry.pixels_per_spoke,
);
ws.close();
console.log("\nTESTMODE E2E PASSED");
process.exit(0);
