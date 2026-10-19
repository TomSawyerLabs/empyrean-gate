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
import { linksTo, summarize, syncLinks } from "../packages/patch-web/src/editor/links";
import type { PatchDoc } from "../packages/patch-web/src/types";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.argv[2] ?? 9531);

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${name}.json`), "utf8"));

const initialConfig = fixture("default-config");
// The fixture is AppConfig::default(), whose tokens are minted on first load;
// the mock is "the Gate machine", so it holds all three like a real one.
initialConfig.server.join_token = "mock-join-token";
initialConfig.server.admin_token = "mock-admin-token";
initialConfig.server.staff_token = "mock-staff-token";
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
  client_list: [
    { id: "mock-client", name: "Layout test", connected: true, revoked: false, admin: true, order: 1, viewing: true, queued: 0, last_input: "tap", last_input_secs: 1.2 },
    { id: "mock-phone-1", name: "Dusty Playa", connected: true, revoked: false, admin: false, order: 2, viewing: true, queued: 0, last_input: "draw", last_input_secs: 0.4 },
    { id: "mock-phone-2", name: "Neon Badger", connected: true, revoked: false, admin: false, order: 3, viewing: false, queued: 1, last_input: null, last_input_secs: null },
    { id: "mock-phone-3", name: "Old tablet", connected: false, revoked: true, admin: false, order: 0, viewing: false, queued: 0, last_input: "tap", last_input_secs: 900 },
  ],
  master_brightness: 1,
  master_speed: 1,
  public: {
    enabled: true,
    listening: true,
    error: "",
    address: "127.0.0.1:9521",
    url: "https://play.example.com",
    open: true,
    connections: 3,
    players: 2,
    peak: 5,
    total_joined: 12,
    refused_full: 0,
    kicked: 1,
    blocked: 1,
    blocked_ids: ["pub-blocked-0000"],
    roster: [
      { id: "pub-a", name: "Cosmic Narwhal", ip: "203.0.113.9", connected_secs: 320, last_input: "tap", last_input_secs: 0.8, keys: ["Camp Mock"], dropped: 0 },
      { id: "pub-b", name: "Velvet Pangolin", ip: "198.51.100.4", connected_secs: 45, last_input: null, last_input_secs: null, keys: [], dropped: 3 },
    ],
    roster_truncated: 0,
  },
  load_history: [42, 45, 44, 48, 51, 47, 46, 49, 52, 50],
  load_warning: false,
  display_events: [],
  display_flapping: false,
  gpu_resets: 0,
  gpu_reset_secs_ago: null,
  display_links: [],
  tdr_last_hour: 0,
  tdr_last_day: 0,
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
/// Per-client CONFIG patches from `POST /mock/config` — shallow-merged over
/// the fixture, one top-level section at a time (`{ public: {...} }` replaces
/// `config.public` wholesale, so send the whole section).
const configOverrides = new Map<string, Record<string, unknown>>();
/// Which client id each open socket said hello as.
const clients = new WeakMap<object, string>();

// The patch protocol, per socket (the gate runs fully parallel against one
// mock, so a shared library would leak between cases): list/get/save/
// activate, with one built-in preset made of the two mock registry nodes.
type MockPatch = { format: number; id: string; name: string; description: string; nodes: unknown[]; edges: unknown[]; exposed: unknown[] };
const MOCK_PRESET: MockPatch = {
  format: 2,
  id: "builtin-mock-noise",
  name: "Mock Noise",
  description: "",
  nodes: [
    { id: "n1", kind: "noise_field", name: "", params: {}, pos: [40, 60] },
    { id: "n2", kind: "output", name: "", params: {}, pos: [420, 120] },
  ],
  edges: [{ from: { node: "n1", port: "out" }, to: { node: "n2", port: "in" } }],
  // Exposed so the preset offers a port when inserted as a Sub-patch.
  exposed: [{ node: "n1", param: "scale", label: "Scale" }],
};
// Two playground submissions as the backend hands them on from the site
// (empyreangate.org, worker/index.ts there): the Patch tab's Submissions
// drawer lists them and opens their patches. Deciding one answers ok and
// leaves the queue as it is, so every browser project sees the same two rows;
// the drawer drops a decided row itself.
const mockSubmissions = [
  {
    key: "submissions/2026-10-17/abcd/1760700000000-sub-1.json",
    id: "sub-1",
    submittedAt: "2026-10-17T08:02:00.000Z",
    name: "Ada",
    contact: "",
    message: "Slow noise for the fire hour.",
    country: "US",
    patch: { ...MOCK_PRESET, id: "sent-1", name: "Ember Drift" },
  },
  {
    key: "submissions/2026-10-16/ef01/1760600000000-sub-2.json",
    id: "sub-2",
    submittedAt: "2026-10-16T22:40:00.000Z",
    name: "Grace",
    contact: "grace@example.com",
    message: "",
    country: "CA",
    patch: { ...MOCK_PRESET, id: "sent-2", name: "Night Tide" },
  },
];
const submissionSummary = (s: (typeof mockSubmissions)[number]) => ({
  ...s,
  patch: {
    name: s.patch.name,
    description: s.patch.description,
    nodes: s.patch.nodes.length,
    edges: s.patch.edges.length,
  },
});
const patchLibraries = new WeakMap<object, Map<string, MockPatch>>();
const activePatch = new WeakMap<object, string | null>();
let mintedPatches = 0;
const library = (ws: object) => {
  let lib = patchLibraries.get(ws);
  if (!lib) patchLibraries.set(ws, (lib = new Map()));
  return lib;
};
const patchSummaries = (ws: object) =>
  [...library(ws).values()].map((p) => summarize(p as unknown as PatchDoc));
/** As the gate's `patch::store::propagate_links`: patches linking `saved`
 * as a Sub-patch follow it, and so do the ones linking those. */
const propagateLinks = (ws: object, saved: MockPatch) => {
  const queue = [saved as unknown as PatchDoc];
  const seen = new Set([saved.id]);
  for (let source = queue.pop(); source; source = queue.pop()) {
    for (const p of library(ws).values()) {
      const doc = p as unknown as PatchDoc;
      if (doc.id === source.id || !linksTo(doc, source.id) || !syncLinks(doc, source)) continue;
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        queue.push(doc);
      }
    }
  }
};

// The public floor page (public.html) speaks the allowlisted half of the
// protocol and receives `public_state` instead of config/status. One snapshot
// serves every public test; `POST /mock/public` patches it (globally — the
// public specs are few and run against their own fields).
const publicState = {
  title: "Mock Gate",
  open: true,
  caps: { draw: true, effects: true, games: true, knobs: false, preview: false },
  perks: [] as string[],
  unlocked: [] as string[],
  players: 7,
  you: "Dusty Badger",
  game: { active: null as string | null, summary: "", species: 3, effects_overlay: false, from_floor: false, blocked_by_show: null },
  spokes: SPOKES,
  pixels: 378,
  inner_radius_ft: initialConfig.geometry.inner_radius_ft,
  outer_radius_ft: initialConfig.geometry.outer_radius_ft,
  preview_fps: 0,
  preview_decimate: 12,
  max_dab_size: 0.25,
  patch_touch: false,
  imu_turns: { holder: null, waiting: [], seconds_left: null },
};
const publicOverrides = new Map<string, Record<string, unknown>>();
const publicSockets = new WeakSet<object>();

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
          group: "patterns",
          description: "Mock noise: a drifting Field<f32>.",
          convertible: true,
          inputs: [],
          outputs: [{ name: "out", shape: "field_scalar", description: "The noise value at each pixel, 0..1." }],
          params: [],
        },
        {
          id: "image_in",
          label: "Still image in",
          category: "input",
          group: "media",
          description: "A still picture stored in the patch, as a Texture.",
          inputs: [],
          outputs: [{ name: "tex", shape: "texture" }],
          params: [],
        },
        // Two stream sources, for the thumbnail rule: a points and an effects
        // output preview on the ring like a field does.
        {
          id: "touch_dabs",
          label: "Touch strokes",
          category: "input",
          group: "live",
          description: "The live-draw strokes clients paint, as a Points stream.",
          inputs: [],
          outputs: [{ name: "points", shape: "points" }],
          params: [],
        },
        {
          id: "effects_in",
          label: "Triggered effects",
          category: "input",
          group: "live",
          description: "The show effects clients trigger, as an Effects stream.",
          inputs: [],
          outputs: [{ name: "effects", shape: "effects" }],
          params: [],
        },
        {
          id: "clip",
          label: "Clip",
          category: "input",
          group: "media",
          description: "A short looping animation stored in the patch, as a Texture.",
          inputs: [],
          outputs: [{ name: "tex", shape: "texture" }],
          params: [
            { name: "frames", label: "Frames used", min: 1, max: 64, default: 16, integrate: false, kind: "number" },
            {
              name: "grid",
              label: "Sheet",
              min: 0,
              max: 2,
              default: 0,
              integrate: false,
              kind: { select: ["4×4 (16 frames of 64 px)", "8×8 (64 frames of 32 px)", "2×2 (4 frames of 128 px)"] },
            },
          ],
        },
        // A colour source and the two field combiners, shaped like the real
        // ones, for drop-to-combine (a second wire into a taken input).
        {
          id: "plasma",
          label: "Plasma",
          category: "generator",
          group: "patterns",
          description: "Mock plasma: a colour field.",
          inputs: [],
          outputs: [{ name: "out", shape: "field_color" }],
          params: [{ name: "speed", label: "Speed", min: 0, max: 4, default: 1, integrate: true, kind: "number" }],
        },
        {
          id: "blend",
          label: "Blend",
          category: "combine",
          group: "color",
          description: "Combines two colour fields: Over is applied to Base.",
          layered: { names: ["over", "mode", "opacity"], max: 8 },
          inputs: [
            { name: "base", shape: "field_color" },
            { name: "over", shape: "field_color" },
          ],
          outputs: [{ name: "out", shape: "field_color" }],
          params: [
            {
              name: "mode",
              label: "Mode",
              min: 0,
              max: 4,
              default: 0,
              integrate: false,
              kind: { select: ["add", "multiply", "screen", "alpha_over", "max"] },
            },
            { name: "opacity", label: "Opacity", min: 0, max: 1, default: 1, integrate: false, kind: "number" },
          ],
        },
        {
          id: "field_math",
          label: "Field math",
          category: "field",
          group: "color",
          description: "Per-pixel arithmetic on two Field<f32> inputs.",
          inputs: [
            { name: "a", shape: "field_scalar" },
            { name: "b", shape: "field_scalar" },
          ],
          outputs: [{ name: "out", shape: "field_scalar" }],
          params: [
            { name: "op", label: "Op", min: 0, max: 1, default: 0, integrate: false, kind: { select: ["add", "subtract"] } },
          ],
        },
        {
          id: "subpatch",
          label: "Sub-patch",
          category: "combine",
          group: "structure",
          description: "Another patch embedded as one node.",
          inputs: [],
          outputs: [{ name: "out", shape: "field_color" }],
          params: [],
        },
        {
          id: "note",
          label: "Note",
          category: "code",
          group: "structure",
          inputs: [],
          outputs: [],
          params: [],
        },
        // Ports and body live on the instance (`code` on the node).
        {
          id: "code",
          label: "Code",
          category: "code",
          group: "structure",
          description: "A node whose ports and body you write.",
          inputs: [],
          outputs: [],
          params: [],
        },
        // LED data and the plane: an LED source, a node that samples its
        // input elsewhere, and the bridge between them.
        {
          id: "random_field",
          label: "Full random field",
          category: "generator",
          group: "blocks",
          description: "A random grey value per LED: LED data.",
          inputs: [],
          outputs: [{ name: "out", shape: "led_scalar" }],
          params: [],
        },
        {
          id: "transform",
          label: "Transform",
          category: "field",
          group: "color",
          description: "Moves where everything upstream is sampled.",
          inputs: [{ name: "in", shape: "field_color" }],
          outputs: [{ name: "out", shape: "field_color" }],
          params: [],
          sampled: ["in"],
        },
        {
          id: "resample",
          label: "Resample",
          category: "field",
          group: "color",
          description: "Turns LED data into a plane picture.",
          inputs: [{ name: "in", shape: "field_color" }],
          outputs: [{ name: "out", shape: "field_color" }],
          params: [],
        },
        {
          id: "output",
          label: "Output",
          category: "sink",
          group: "structure",
          description: "The patch's one sink: what is wired into `in` is what the gate shows.",
          inputs: [{ name: "in", shape: "field_color" }],
          outputs: [],
          params: [],
        },
      ]);
    }
    if (url.pathname === "/patch/presets") return Response.json([MOCK_PRESET]);
    // "Convert to Code" (the real one reproduces the node's body): here the
    // node becomes a Code node with a stand-in body, keeping its id.
    if (url.pathname === "/patch/convert-to-code" && req.method === "POST") {
      return req.json().then((body) => {
        const { patch, node } = body as { patch: MockPatch; node: string };
        const n = patch.nodes.find((x) => (x as { id: string }).id === node) as Record<string, unknown> | undefined;
        if (!n) return Response.json({ error: "no such node" }, { status: 400 });
        n.kind = "code";
        n.code = {
          inputs: [{ name: "scale", shape: "scalar", min: 0.1, max: 8, default: 1 }],
          outputs: [{ name: "out", shape: "field_scalar", min: 0, max: 1, default: 0 }],
          body: `// Converted from ${String(n.kind)} (mock).\nout = c.r01 * scale;\n`,
        };
        return Response.json(patch);
      });
    }
    // The Code node's reference (the real one is read off the shader lib);
    // enough for the editor's completion to have something to offer.
    if (url.pathname === "/patch/code-reference") {
      return Response.json({
        helpers: [{ name: "hsv2rgb", signature: "hsv2rgb(h: f32, s: f32, v: f32) -> vec3f", doc: "HSV to RGB, hue in turns." }],
        structs: [{ name: "Ctx", fields: [{ name: "theta", type: "f32", doc: "spoke angle, radians" }] }],
        globals: [{ name: "G", type: "Globals", doc: "" }, { name: "TAU", type: "f32", doc: "" }],
        cpu_builtins: [{ name: "mix", signature: "mix(a, b, t)", doc: "a + (b - a) * t." }],
      });
    }
    if (url.pathname === "/patch/submissions") {
      return Response.json({ submissions: mockSubmissions.map(submissionSummary) });
    }
    if (url.pathname === "/patch/submissions/record") {
      const row = mockSubmissions.find((s) => s.key === url.searchParams.get("key"));
      if (!row) return Response.json({ error: "No such submission." }, { status: 404 });
      const { patch, ...submission } = row;
      // As the backend does: a new patch here, credited to the sender.
      return Response.json({ submission, patch: { ...patch, id: "", credit: row.name } });
    }
    if (url.pathname === "/patch/submissions/decide" && req.method === "POST") {
      return req.json().then(() => Response.json({ ok: true }));
    }
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
    if (url.pathname === "/mock/config" && req.method === "POST") {
      const client = url.searchParams.get("client") ?? "";
      return req.json().then((patch) => {
        configOverrides.set(client, { ...(configOverrides.get(client) ?? {}), ...(patch as object) });
        return Response.json({ ok: true });
      });
    }
    if (url.pathname === "/mock/public" && req.method === "POST") {
      const client = url.searchParams.get("client") ?? "";
      return req.json().then((patch) => {
        publicOverrides.set(client, { ...(publicOverrides.get(client) ?? {}), ...(patch as object) });
        return Response.json({ ok: true });
      });
    }
    if (url.pathname === "/qr.svg") {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#fff"/></svg>',
        { headers: { "content-type": "image/svg+xml" } },
      );
    }
    // The public listener serves public.html at its root and at /k/<secret>;
    // the mock keeps the operator UI at / and offers the public page by name.
    const path =
      url.pathname === "/"
        ? "/index.html"
        : url.pathname.startsWith("/k/")
          ? "/public.html"
          : url.pathname;
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
      let msg: { type?: string; client_id?: string; include_ready?: boolean; ready_id?: string; stack?: unknown; config?: unknown; surface?: string; key?: string; keys?: string[]; game?: string | null };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "hello" && msg.surface === "public") publicSockets.add(ws);
      if (publicSockets.has(ws)) {
        // The public half: a snapshot on hello, an unlock that grants perks
        // when the code is the one the mock knows, nothing else answered.
        if (msg.client_id) clients.set(ws, msg.client_id);
        const snap = () => ({
          ...publicState,
          ...(publicOverrides.get(clients.get(ws) ?? "") ?? {}),
        });
        if (msg.type === "hello" || msg.type === "get_state") {
          ws.send(JSON.stringify({ type: "public_state", state: snap() }));
        } else if (msg.type === "unlock") {
          if (msg.key === "FIREFLY-COMET-47") {
            publicOverrides.set(clients.get(ws) ?? "", {
              ...(publicOverrides.get(clients.get(ws) ?? "") ?? {}),
              perks: ["big_brush", "strobe", "cone"],
              unlocked: ["Camp Mock"],
              max_dab_size: 0.5,
            });
            ws.send(JSON.stringify({ type: "unlocked", name: "Camp Mock", perks: ["big_brush", "strobe", "cone"] }));
            ws.send(JSON.stringify({ type: "public_state", state: snap() }));
          } else {
            ws.send(JSON.stringify({ type: "error", message: "That code does not unlock anything." }));
          }
        } else if (msg.type === "subscribe_preview") {
          ws.send(JSON.stringify({ type: "error", message: "No preview on the public floor right now." }));
        } else if (msg.type === "set_game_mode") {
          // A hidden game started or stopped from the floor: the snapshot
          // follows, marked as the floor's own.
          const id = clients.get(ws) ?? "";
          const game = msg.game ?? null;
          publicOverrides.set(id, {
            ...(publicOverrides.get(id) ?? {}),
            game: game
              ? { active: game, summary: `${game} · 0 caught · 0 got in`, species: 5, effects_overlay: false, from_floor: true, blocked_by_show: null }
              : { ...publicState.game },
          });
          ws.send(JSON.stringify({ type: "public_state", state: snap() }));
        }
        return;
      }
      switch (msg.type) {
        case "hello":
        case "get_state": {
          // `hello` is the first thing a client sends and it carries the id a
          // test can address, so this is where an override lands.
          if (msg.client_id) clients.set(ws, msg.client_id);
          const patch = overrides.get(clients.get(ws) ?? "") ?? {};
          const configPatch = configOverrides.get(clients.get(ws) ?? "") ?? {};
          ws.send(JSON.stringify({ type: "state", config: { ...config, ...configPatch }, status: { ...status, ...patch } }));
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
        case "set_config":
          // Echo only to the requesting browser. This matches the real backend's
          // save acknowledgement without leaking a test's Settings edits into
          // other fully-parallel pages sharing this mock process.
          ws.send(JSON.stringify({ type: "state", config: msg.config, status }));
          break;
        case "set_master":
          // The real backend clamps the same way (engine SetMaster).
          if (typeof msg.brightness === "number") {
            config.render.master_brightness = Math.min(1, Math.max(0, msg.brightness));
          }
          if (typeof msg.speed === "number") {
            config.render.master_speed = Math.min(8, Math.max(0, msg.speed));
          }
          ws.send(JSON.stringify({ type: "state", config, status }));
          break;
        case "take_ready": {
          if (!config.ready_stack || config.ready_stack.id !== msg.ready_id) break;
          const previous = {
            id: "mock-previous-program",
            name: "Previous program",
            layers: config.layers,
            master_brightness: config.render.master_brightness,
            master_speed: config.render.master_speed,
            walk_enabled: config.render.walk_enabled,
            walk_layers: config.render.walk_layers,
            walk_min_layers: config.render.walk_min_layers,
            walk_speed: config.render.walk_speed,
            walk_depth: config.render.walk_depth,
          };
          const next = config.ready_stack;
          config.layers = next.layers;
          config.render.master_brightness = next.master_brightness;
          config.render.master_speed = next.master_speed;
          config.render.walk_enabled = next.walk_enabled;
          config.render.walk_layers = next.walk_layers;
          config.render.walk_min_layers = next.walk_min_layers;
          config.render.walk_speed = next.walk_speed;
          config.render.walk_depth = next.walk_depth;
          if (next.dj_link_effects) config.rhythm.pro_dj_link_effects = next.dj_link_effects;
          config.ready_stack = previous;
          ws.send(JSON.stringify({ type: "state", config, status }));
          break;
        }
        case "unsubscribe_preview":
          clearInterval(timers.get(ws));
          timers.delete(ws);
          break;
        case "patch_list":
          ws.send(JSON.stringify({ type: "patches", patches: patchSummaries(ws) }));
          break;
        case "patch_get": {
          const doc = library(ws).get(msg.id);
          if (doc) ws.send(JSON.stringify({ type: "patch", patch: doc }));
          break;
        }
        case "patch_save": {
          const doc = { ...(msg.patch as MockPatch) };
          if (!doc.id) doc.id = `mock-patch-${++mintedPatches}`;
          library(ws).set(doc.id, doc);
          propagateLinks(ws, doc);
          ws.send(JSON.stringify({ type: "patch", patch: doc }));
          ws.send(JSON.stringify({ type: "patches", patches: patchSummaries(ws) }));
          break;
        }
        case "patch_activate": {
          activePatch.set(ws, msg.id ?? null);
          const configPatch = configOverrides.get(clients.get(ws) ?? "") ?? {};
          ws.send(
            JSON.stringify({
              type: "state",
              config: { ...config, ...configPatch, active_patch: msg.id ?? null },
              status: { ...status, patch_active: msg.id != null },
            }),
          );
          break;
        }
      }
    },
    close(ws) {
      clearInterval(timers.get(ws));
      timers.delete(ws);
    },
  },
});

console.log(`mock backend on http://127.0.0.1:${server.port}`);
