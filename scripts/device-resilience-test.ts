// Verifies audio-device resilience against a backend started with a source
// pointing at a device that does not exist:
//  1. the backend runs anyway (frames stream, no crash),
//  2. the source reports "waiting for device" and never substitutes another,
//  3. switching the source to "system default" over WS recovers live.
// Usage: bun scripts/device-resilience-test.ts [ws url]

const url = process.argv[2] ?? "ws://127.0.0.1:9520/ws";
const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";

let config: any = null;
let frames = 0;
let sawWaiting = false;
let recovered = false;
let switched = false;

function fail(msg: string): never {
  console.error(`RESILIENCE FAIL: ${msg}`);
  process.exit(1);
}

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "hello", name: "resilience", client_id: "resilience", token: "" }));
  ws.send(JSON.stringify({ type: "subscribe_preview", fps: 30, decimate: 4 }));
};

ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") {
    frames++;
    return;
  }
  const msg = JSON.parse(ev.data);
  if (msg.type === "state") config = msg.config;
  if (msg.type !== "status" && msg.type !== "state") return;
  const a = msg.status.audio?.[0];
  if (!a) return;

  if (!switched) {
    if (!a.active && a.detail === "waiting for device") {
      sawWaiting = true;
      if (config && frames >= 10) {
        // Engine is alive despite the missing device. Now switch to default.
        switched = true;
        const next = structuredClone(config);
        next.audio.sources[0] = { id: "main", kind: "device", device: null, channels: [], loopback: false, gain: 1 };
        ws.send(JSON.stringify({ type: "set_config", config: next }));
        console.log("phase 1 OK: running + waiting for missing device; switching to default");
      }
    } else if (a.active) {
      fail("source became active on a nonexistent device (substituted another?)");
    }
  } else if (a.active) {
    recovered = true;
    console.log("phase 2 OK: recovered on system default device");
    console.log("RESILIENCE PASS");
    process.exit(0);
  }
};

setTimeout(() => {
  fail(
    `timeout — sawWaiting=${sawWaiting} switched=${switched} recovered=${recovered} frames=${frames}`,
  );
}, 20000);
