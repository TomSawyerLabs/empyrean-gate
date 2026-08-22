// A backend stand-in for UI tests: serves the built bundle and speaks just
// enough of the WebSocket protocol that the app renders its real layout.
//
// Why not the real backend? The layout gate has to run in CI on machines with no
// GPU, no audio device and no network, and it has to be deterministic — the same
// config every run, or a "the sidebar overflows" failure could come and go with
// whatever was last saved on someone's machine. So the config it replays is a
// committed snapshot of `AppConfig::default()`, kept honest by a Rust test
// (`default_config_fixture_is_current`) that fails when the two drift apart.
//
//   bun scripts/mock-backend.ts [port]

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.argv[2] ?? 9531);

const config = JSON.parse(
  readFileSync(join(ROOT, "tests/fixtures/default-config.json"), "utf8"),
);

const SPOKES = 64;
const PIXELS = 64; // decimated preview
const PREVIEW_MAGIC = 0x45475056;

// A plausible, fully-populated status: the UI shows more chrome when things are
// running (sACN pill, history bars, device lists), and that chrome is exactly
// what has to fit.
const status = {
  gpu_error: null,
  gpu_name: "Mock Vulkan Device",
  engine_fps: 60,
  frame_time_ms: 1.7,
  sacn_enabled: true,
  sacn_universes: 192,
  sacn_pps: 11520,
  sacn_error: null,
  fps_history: Array.from({ length: 30 }, (_, i) => 58 + (i % 3)),
  pps_history: Array.from({ length: 30 }, () => 11520),
  clients: 1,
  audio: [
    {
      id: "main",
      active: true,
      detail: "",
      level: 0.4,
      bass: 0.6,
      mid: 0.3,
      treble: 0.2,
      bpm: 128,
      bpm_confidence: 0.82,
      beat_phase: 0.25,
    },
  ],
  input_devices: [{ name: "Line In (Mock Interface)", channels: 2 }],
  output_devices: [{ name: "Speakers (Mock Interface)", channels: 2 }],
  default_input_channels: 2,
  default_output_channels: 2,
  interfaces: ["Ethernet — 10.255.0.77", "Wi-Fi — 192.168.1.50"],
  firewall_pending: false,
  video_cache: [],
  client_list: [{ id: "mock-client", name: "Layout test", connected: true, revoked: false }],
  master_brightness: 1,
  master_speed: 1,
  version: "0.0.0-mock",
  update_available: null,
  update_state: "up to date",
  video: {
    active: false,
    owner_id: "",
    owner_name: "",
    title: "",
    source_url: "",
    width: 0,
    height: 0,
    fps: 0,
    frames: 0,
  },
};

function previewFrame(t: number): Uint8Array {
  const packet = new Uint8Array(12 + SPOKES * PIXELS * 3);
  const header = new DataView(packet.buffer);
  header.setUint32(0, PREVIEW_MAGIC, true);
  header.setUint32(4, t, true);
  header.setUint16(8, SPOKES, true);
  header.setUint16(10, PIXELS, true);
  for (let s = 0; s < SPOKES; s++) {
    for (let i = 0; i < PIXELS; i++) {
      const o = 12 + (s * PIXELS + i) * 3;
      const v = Math.round(128 + 127 * Math.sin(i / 6 + s / 3 + t / 10));
      packet[o] = v;
      packet[o + 1] = Math.round(v * 0.4);
      packet[o + 2] = 255 - v;
    }
  }
  return packet;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  webmanifest: "application/manifest+json",
};

const timers = new WeakMap<object, ReturnType<typeof setInterval>>();

const server = Bun.serve({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      return srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    // No reports exist in a fresh test run; the UI must cope with that.
    if (url.pathname === "/reports") return Response.json([]);
    if (url.pathname === "/qr.svg") {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#fff"/></svg>',
        { headers: { "content-type": "image/svg+xml" } },
      );
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(join(DIST, path));
    const ext = path.split(".").pop() ?? "";
    return file.exists().then((exists) =>
      exists
        ? new Response(file, { headers: { "content-type": MIME[ext] ?? "application/octet-stream" } })
        : new Response(Bun.file(join(DIST, "index.html")), {
            headers: { "content-type": MIME.html },
          }),
    );
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ type: "state", config, status }));
    },
    message(ws, raw) {
      let msg: { type?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      switch (msg.type) {
        case "hello":
        case "get_state":
          ws.send(JSON.stringify({ type: "state", config, status }));
          break;
        case "subscribe_preview": {
          ws.send(
            JSON.stringify({
              type: "preview_meta",
              spokes: SPOKES,
              pixels: PIXELS,
              decimate: 1,
              outer_radius_ft: config.geometry.outer_radius_ft,
              inner_radius_ft: config.geometry.inner_radius_ft,
            }),
          );
          clearInterval(timers.get(ws));
          let t = 0;
          timers.set(
            ws,
            setInterval(() => ws.send(previewFrame(t++)), 50),
          );
          break;
        }
        case "unsubscribe_preview":
          clearInterval(timers.get(ws));
          timers.delete(ws);
          break;
      }
    },
    close(ws) {
      clearInterval(timers.get(ws));
      timers.delete(ws);
    },
  },
});

console.log(`mock backend on http://127.0.0.1:${server.port}`);
