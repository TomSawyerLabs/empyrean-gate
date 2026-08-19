// End-to-end test against a running backend (empyrean-gate --headless).
// Verifies: HTTP serves the UI, WS speaks the protocol, preview frames stream,
// effects trigger, and status updates arrive. Run: bun scripts/e2e-test.ts

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:9520";

function fail(msg: string): never {
  console.error(`E2E FAIL: ${msg}`);
  process.exit(1);
}

// 1. HTTP root serves the UI
const res = await fetch(BASE);
if (!res.ok) fail(`GET / -> ${res.status}`);
const html = await res.text();
if (!html.includes("<!doctype html>") && !html.includes("<!DOCTYPE html>")) {
  fail("GET / did not return HTML");
}
console.log("HTTP OK");

// 1b. PWA assets are served
for (const asset of ["/manifest.webmanifest", "/sw.js", "/pwa-192.png"]) {
  const r = await fetch(BASE + asset);
  if (!r.ok) fail(`GET ${asset} -> ${r.status}`);
}
console.log("PWA assets OK");

// 2. WebSocket protocol
const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws`);
let gotState = false;
let gotStatus = false;
let frames = 0;
let previewBytes = 0;

const done = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timeout after 15s")), 15000);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "hello", name: "e2e", client_id: "e2e", token: "" }));
    ws.send(JSON.stringify({ type: "subscribe_preview", fps: 30, decimate: 2 }));
    ws.send(JSON.stringify({ type: "trigger_effect", effect: { kind: "burst", angle: 1.0, radius: 0.5, intensity: 1, hue: -1, duration: 0 } }));
    ws.send(JSON.stringify({ type: "paint", pen: "glow", points: [{ angle: 0.5, radius: 0.7 }, { angle: 0.6, radius: 0.7 }], hue: 0.5, size: 0.15, intensity: 1 }));
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      const msg = JSON.parse(ev.data);
      if (msg.type === "state") {
        gotState = true;
        if (msg.config.geometry.spokes !== 64) reject(new Error("unexpected geometry"));
        if (msg.status.gpu_error) reject(new Error(`gpu_error: ${msg.status.gpu_error}`));
      }
      if (msg.type === "status") {
        gotStatus = true;
        if (!Array.isArray(msg.status.fps_history) || !Array.isArray(msg.status.pps_history)) {
          reject(new Error("status missing fps/pps history"));
        }
      }
    } else {
      frames++;
      previewBytes = (ev.data as ArrayBuffer).byteLength ?? (ev.data as Blob).size;
    }
    if (gotState && gotStatus && frames >= 10) {
      clearTimeout(timeout);
      resolve();
    }
  };
  ws.onerror = (e) => reject(new Error(`ws error: ${e}`));
});

ws.binaryType = "arraybuffer";
await done.catch((e) => fail(String(e)));
console.log(`WS OK: state received, status received, ${frames} preview frames (last ${previewBytes} bytes)`);
ws.close();
console.log("E2E PASS");
process.exit(0);
