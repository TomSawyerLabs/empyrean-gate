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

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${name}.json`), "utf8"));

const initialConfig = fixture("default-config");
let config = structuredClone(initialConfig);

const SPOKES = 64;
const PIXELS = 64; // decimated preview
const PREVIEW_MAGIC = 0x45475056;
const READY_PREVIEW_MAGIC = 0x45475256;

// Arms in the preview spiral. Anything that varies with the spoke index has to
// close on itself — a whole number of cycles per revolution — or spoke 63 and
// spoke 0 meet at a seam and the array shows a discontinuity at 0°. So the
// angular term is written as turns-per-revolution, like the real layers write
// theirs (the spiral, rainbow and wedge shaders all floor their arm/turn count
// for exactly this reason), rather than as a fixed per-spoke phase step that
// only lands on a whole turn by luck.
const ARMS = 3;

// A plausible, fully-populated status. The BASE is RuntimeStatus::default()
// straight from Rust (kept current by `default_status_fixture_is_current`), so a
// field the backend starts sending can never silently go missing here — the UI
// reads some status fields without optional chaining, and a missing one
// white-screens a whole tab. Only the "looks live" overrides are spelled out:
// the UI shows more chrome when things are running, and that chrome has to fit.
const status = {
  ...fixture("default-status"),
  gpu_name: "Mock Vulkan Device",
  engine_fps: 60,
  frame_time_ms: 1.7,
  sacn_enabled: true,
  sacn_universes: 192,
  sacn_pps: 11520,
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
  client_list: [{ id: "mock-client", name: "Layout test", connected: true, revoked: false }],
  master_brightness: 1,
  master_speed: 1,
  version: "0.0.0-mock",
  update_state: "up to date",
};

function previewFrame(t: number, magic = PREVIEW_MAGIC): Uint8Array {
  const packet = new Uint8Array(12 + SPOKES * PIXELS * 3);
  const header = new DataView(packet.buffer);
  header.setUint32(0, magic, true);
  header.setUint32(4, t, true);
  header.setUint16(8, SPOKES, true);
  header.setUint16(10, PIXELS, true);
  for (let s = 0; s < SPOKES; s++) {
    const sweep = (ARMS * s * 2 * Math.PI) / SPOKES;
    for (let i = 0; i < PIXELS; i++) {
      const o = 12 + (s * PIXELS + i) * 3;
      const v = Math.round(128 + 127 * Math.sin(
        i / 6 + sweep + t / 10 + (magic === READY_PREVIEW_MAGIC ? 2 : 0),
      ));
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
/// Per-client status patches from `POST /mock/status` (see the route below).
const overrides = new Map<string, Record<string, unknown>>();
/// Which client id each open socket said hello as.
const clients = new WeakMap<object, string>();
/// The credential determines which redacted state subsequent requests receive.
const clientTokens = new WeakMap<object, string>();

function configForToken(token: string) {
  if (!token.startsWith("participant-")) return config;
  return {
    ...config,
    public_access: {
      ...config.public_access,
      mode: token === "participant-effects-test" ? "effects" : "private",
    },
    server: { ...config.server, join_token: "" },
    clients: [],
  };
}

const server = Bun.serve({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/mock/reset-config" && req.method === "POST") {
      config = structuredClone(initialConfig);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/ws") {
      return srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    // No reports exist in a fresh test run; the UI must cope with that.
    if (url.pathname === "/reports") return Response.json([]);
    if (url.pathname === "/patch/registry") {
      return Response.json([
        {
          id: "noise_field",
          label: "Noise",
          category: "generator",
          inputs: [],
          outputs: [{ name: "out", shape: "field_scalar" }],
          params: [],
        },
        {
          id: "output",
          label: "Output",
          category: "sink",
          inputs: [{ name: "in", shape: "field_scalar" }],
          outputs: [],
          params: [],
        },
      ]);
    }
    if (url.pathname === "/patch/presets") return Response.json([]);
    // Test-only lever for states the backend reaches on its own but a mock never
    // will (the sACN contention banner needs something else to be on the wire).
    // POST a `RuntimeStatus` fragment with `?client=<empyrean-client-id>`; the
    // socket that says hello with that id gets the patched status.
    //
    // Keyed by client rather than applied globally on purpose: the gate runs
    // fully parallel against ONE mock, and a shared mutation would leak a
    // contention banner into whatever else happened to be loading.
    if (url.pathname === "/mock/status" && req.method === "POST") {
      const client = url.searchParams.get("client") ?? "";
      return req.json().then((patch) => {
        overrides.set(client, { ...(overrides.get(client) ?? {}), ...(patch as object) });
        return Response.json({ ok: true });
      });
    }
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
    open() {},
    message(ws, raw) {
      let msg: { type?: string; client_id?: string; token?: string; include_ready?: boolean; ready_id?: string; stack?: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      switch (msg.type) {
        case "hello": {
          // `hello` is the first thing a client sends and it carries the id a
          // test can address, so this is where an override lands.
          if (msg.client_id) clients.set(ws, msg.client_id);
          const token = msg.token ?? "";
          clientTokens.set(ws, token);
          const patch = overrides.get(clients.get(ws) ?? "") ?? {};
          const participant = token.startsWith("participant-");
          ws.send(JSON.stringify({ type: "role", role: participant ? "participant" : "operator" }));
          ws.send(JSON.stringify({
            type: "state",
            config: configForToken(token),
            status: participant ? fixture("default-status") : { ...status, ...patch },
          }));
          break;
        }
        case "get_state": {
          const patch = overrides.get(clients.get(ws) ?? "") ?? {};
          const token = clientTokens.get(ws) ?? "";
          const participant = token.startsWith("participant-");
          ws.send(JSON.stringify({
            type: "state",
            config: configForToken(token),
            status: participant ? fixture("default-status") : { ...status, ...patch },
          }));
          break;
        }
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
          timers.set(ws, setInterval(() => {
            ws.send(previewFrame(t));
            if (msg.include_ready) ws.send(previewFrame(t, READY_PREVIEW_MAGIC));
            t++;
          }, 50));
          break;
        }
        case "prepare_stack":
          config.ready_stack = msg.stack;
          ws.send(JSON.stringify({ type: "state", config, status }));
          break;
        case "take_ready": {
          if (!config.ready_stack || config.ready_stack.id !== msg.ready_id) break;
          const previous = {
            id: "mock-previous-program",
            name: "Previous program",
            layers: config.layers,
            master_speed: config.render.master_speed,
            walk_enabled: config.render.walk_enabled,
            walk_layers: config.render.walk_layers,
            walk_min_layers: config.render.walk_min_layers,
            walk_speed: config.render.walk_speed,
            walk_depth: config.render.walk_depth,
          };
          const next = config.ready_stack;
          config.layers = next.layers;
          config.render.master_speed = next.master_speed;
          config.ready_stack = previous;
          ws.send(JSON.stringify({ type: "state", config, status }));
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
