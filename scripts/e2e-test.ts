// End-to-end test against a running backend (empyrean-gate --headless).
// Verifies: HTTP serves the UI, WS speaks the protocol, preview frames stream,
// effects trigger, video frames arrive, and status updates. Run: bun scripts/e2e-test.ts

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
let gotVideo = false;
let gotVideoAudio = false;
let frames = 0;
let previewBytes = 0;
let originalConfig: Record<string, unknown> | null = null;
let videoAudioIndex = -1;
let audioTimer: ReturnType<typeof setInterval> | null = null;

const done = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timeout after 15s")), 15000);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "hello", name: "e2e", client_id: "e2e", token: "" }));
    ws.send(JSON.stringify({ type: "subscribe_preview", fps: 30, decimate: 2 }));
    ws.send(JSON.stringify({ type: "start_video", title: "e2e color bars", source_url: "e2e://generated" }));
    const video = new Uint8Array(12 + 2 * 2 * 4);
    const vh = new DataView(video.buffer);
    vh.setUint32(0, 0x45475646, true);
    vh.setUint32(4, 1, true);
    vh.setUint16(8, 2, true);
    vh.setUint16(10, 2, true);
    video.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255], 12);
    ws.send(video);
    ws.send(JSON.stringify({ type: "trigger_effect", effect: { kind: "burst", angle: 1.0, radius: 0.5, intensity: 1, hue: -1, duration: 0 } }));
    ws.send(JSON.stringify({ type: "paint", pen: "glow", points: [{ angle: 0.5, radius: 0.7 }, { angle: 0.6, radius: 0.7 }], hue: 0.5, size: 0.15, intensity: 1 }));
    ws.send(JSON.stringify({ type: "paint", pen: "comet", points: [{ angle: 1.5, radius: 0.6, dir: 2.2 }], hue: -1, size: 0.2, intensity: 1 }));
    ws.send(JSON.stringify({ type: "paint", pen: "ring", points: [{ angle: 0, radius: 0.5 }], hue: 0.8, size: 0.1, intensity: 1 }));
    // Round-trip the audio-shape layer kinds (waveform ring + spectrum analyzer).
    for (const kind of ["waveform", "spectrum"]) {
      ws.send(JSON.stringify({ type: "add_layer", layer: { kind, enabled: true, name: `e2e-${kind}`, blend: "add", opacity: 0.5, speed: 1, scale: 1, audio_source: 0, audio_amount: 0.5, hue: 0.5, hue_range: 0.2, saturation: 0.9, brightness: 1, tilt_amount: 0, walk_amount: 0, param_a: 0.5, param_b: 0.5, param_c: 0.5, param_d: 0.5 } }));
    }
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      const msg = JSON.parse(ev.data);
      if (msg.type === "state") {
        gotState = true;
        if (msg.config.geometry.spokes !== 64) reject(new Error("unexpected geometry"));
        if (msg.status.gpu_error) reject(new Error(`gpu_error: ${msg.status.gpu_error}`));
        if (!originalConfig) {
          originalConfig = structuredClone(msg.config);
          const testConfig = structuredClone(msg.config);
          videoAudioIndex = testConfig.audio.sources.findIndex((source: { kind: string }) => source.kind === "video");
          if (videoAudioIndex < 0) {
            videoAudioIndex = Math.min(testConfig.audio.sources.length, 3);
            const source = { id: "e2e-video", kind: "video", gain: 1 };
            if (testConfig.audio.sources.length < 4) testConfig.audio.sources.push(source);
            else testConfig.audio.sources[videoAudioIndex] = source;
          }
          ws.send(JSON.stringify({ type: "set_config", config: testConfig }));
          audioTimer = setInterval(() => {
            ws.send(JSON.stringify({
              type: "audio_frame",
              stream: "video",
              level: 0.6,
              bass: 0.7,
              mid: 0.4,
              treble: 0.2,
              flux: 0.8,
            }));
          }, 50);
        }
      }
      if (msg.type === "status") {
        gotStatus = true;
        if (!Array.isArray(msg.status.fps_history) || !Array.isArray(msg.status.pps_history)) {
          reject(new Error("status missing fps/pps history"));
        }
        if (msg.status.video?.active && msg.status.video.title === "e2e color bars") {
          gotVideo = true;
        }
        if (videoAudioIndex >= 0 && msg.status.audio[videoAudioIndex]?.level > 0.5) {
          gotVideoAudio = true;
        }
      }
    } else {
      frames++;
      previewBytes = (ev.data as ArrayBuffer).byteLength ?? (ev.data as Blob).size;
    }
    if (gotState && gotStatus && gotVideo && gotVideoAudio && frames >= 10) {
      clearTimeout(timeout);
      resolve();
    }
  };
  ws.onerror = (e) => reject(new Error(`ws error: ${e}`));
});

ws.binaryType = "arraybuffer";
await done.catch((e) => fail(String(e)));
console.log(`WS OK: state/status/video/audio received, ${frames} preview frames (last ${previewBytes} bytes)`);
if (audioTimer) clearInterval(audioTimer);
ws.send(JSON.stringify({ type: "stop_video" }));
if (originalConfig) ws.send(JSON.stringify({ type: "set_config", config: originalConfig }));
await new Promise((resolve) => setTimeout(resolve, 150));
ws.close();
console.log("E2E PASS");
process.exit(0);
