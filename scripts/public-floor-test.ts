// End-to-end check of the public floor against a running backend
// (`empyrean-gate --headless` with `public.enabled = true`; see docs/public-deploy.md
// for a config snippet). Verifies what the Rust unit tests cannot: the second
// listener is really bound, routes that must not exist there do not, the hello
// gate and the message allowlist hold over a real socket, the rate limiter
// drops a flood, a key unlocks perks, and the operator port refuses a proxied
// request.
//
//   bun scripts/public-floor-test.ts
//   PUBLIC_BASE=http://127.0.0.1:9521 OPERATOR_BASE=http://127.0.0.1:9520 KEY=FIREFLY-COMET-47 bun scripts/public-floor-test.ts

const PUBLIC = process.env.PUBLIC_BASE ?? "http://127.0.0.1:9521";
const OPERATOR = process.env.OPERATOR_BASE ?? "http://127.0.0.1:9520";
const KEY = process.env.KEY ?? "";

function fail(msg: string): never {
  console.error(`PUBLIC FLOOR FAIL: ${msg}`);
  process.exit(1);
}

type Msg = { type: string; [k: string]: unknown };

/** Open a socket, send hello, collect every text message for `ms`. */
async function session(
  hello: Record<string, unknown>,
  after: (ws: WebSocket, got: Msg[]) => void | Promise<void>,
  ms = 1500,
): Promise<{ got: Msg[]; closed: boolean }> {
  const got: Msg[] = [];
  const ws = new WebSocket(`${PUBLIC.replace("http", "ws")}/ws`);
  let closed = false;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("socket error"));
    };
  });
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") got.push(JSON.parse(ev.data));
  };
  ws.onclose = () => {
    closed = true;
  };
  ws.send(JSON.stringify({ type: "hello", name: "e2e", client_id: "pub-e2e-0000", token: "", surface: "public", keys: [], ...hello }));
  await new Promise((r) => setTimeout(r, 300));
  await after(ws, got);
  await new Promise((r) => setTimeout(r, ms));
  if (!closed) ws.close();
  return { got, closed };
}

// 1. The public page is served at the root and at /k/<secret>; the operator
//    page and its control routes are not here at all.
for (const path of ["/", "/k/anything", "/health"]) {
  const r = await fetch(PUBLIC + path);
  if (!r.ok) fail(`GET ${path} on the public port -> ${r.status}`);
}
const html = await (await fetch(PUBLIC + "/")).text();
if (!html.includes("/src/public/main.tsx") && !/public-[\w-]+\.js/.test(html)) fail("public root did not serve public.html");
for (const path of ["/index.html", "/handover/state", "/reports", "/patch/registry", "/qr.svg?data=x", "/manifest.webmanifest", "/poster.html"]) {
  const r = await fetch(PUBLIC + path);
  if (r.status !== 404) fail(`GET ${path} on the public port -> ${r.status} (expected 404)`);
}
const handover = await fetch(PUBLIC + "/handover", { method: "POST" });
if (handover.status !== 404 && handover.status !== 405) fail(`POST /handover on the public port -> ${handover.status}`);
console.log("public routes OK");

// 2. The operator port refuses a proxied request.
const proxied = await fetch(OPERATOR + "/health", { headers: { "x-forwarded-for": "203.0.113.9" } });
if (proxied.status !== 403) fail(`operator /health with X-Forwarded-For -> ${proxied.status} (expected 403)`);
const direct = await fetch(OPERATOR + "/health");
if (!direct.ok) fail(`operator /health direct -> ${direct.status}`);
console.log("operator port refuses proxied requests OK");

// 3. Hello gate: the wrong surface and a non-public id are refused.
{
  const { got, closed } = await session({ surface: "" }, () => {});
  if (!got.some((m) => m.type === "denied")) fail("a hello without surface=public was not denied");
  if (!closed) fail("socket stayed open after a denied hello");
}
{
  const { got } = await session({ client_id: "client-not-public" }, () => {});
  if (!got.some((m) => m.type === "denied")) fail("a hello with a LAN-style id was not denied");
}
console.log("hello gate OK");

// 4. A good hello gets a snapshot; refused messages get errors, not state.
{
  const { got, closed } = await session({}, (ws) => {
    ws.send(JSON.stringify({ type: "set_sacn_enabled", enabled: false }));
    ws.send(JSON.stringify({ type: "set_master", brightness: 0 }));
    ws.send(JSON.stringify({ type: "get_state" }));
    ws.send(JSON.stringify({ type: "report", description: "x", seconds: 1 }));
    ws.send(JSON.stringify({ type: "imu", yaw: 0, pitch: 0, roll: 0, shake: 0 }));
    ws.send(JSON.stringify({ type: "trigger_effect", effect: { kind: "burst", angle: 1, radius: 0.5, intensity: 1, hue: -1, duration: 0 } }));
    ws.send(JSON.stringify({ type: "paint", pen: "glow", points: [{ angle: 0.5, radius: 0.7 }], hue: 0.5, size: 0.9, intensity: 5 }));
  });
  const snaps = got.filter((m) => m.type === "public_state");
  if (snaps.length < 2) fail(`expected public_state on hello and get_state, got ${snaps.length}`);
  const snap = snaps[0].state as { caps: Record<string, boolean>; you: string; spokes: number };
  if (snap.spokes !== 64) fail("snapshot geometry missing");
  if (snap.you !== "e2e") fail(`snapshot name ${snap.you}`);
  if (got.some((m) => m.type === "state" || m.type === "status")) fail("a public connection received State/Status");
  const errors = got.filter((m) => m.type === "error").length;
  if (errors < 3) fail(`expected refusals for show-control messages, got ${errors} errors`);
  if (closed) fail("refusals must not close the connection");
}
console.log("allowlist OK");

// 5. The rate limiter drops a flood silently and the connection survives.
{
  const { got, closed } = await session({}, (ws) => {
    for (let i = 0; i < 600; i++) {
      ws.send(JSON.stringify({ type: "trigger_effect", effect: { kind: "burst", angle: i, radius: 0.5, intensity: 1, hue: -1, duration: 0 } }));
    }
    ws.send(JSON.stringify({ type: "get_state" }));
  });
  if (closed) fail("a flood closed the connection (it should be throttled, not kicked)");
  const errors = got.filter((m) => m.type === "error");
  if (errors.length > 0) fail(`flooding produced ${errors.length} error replies (dropped messages must be silent)`);
}
console.log("rate limiter OK");

// 6. Strikes: enough refused messages do close the connection.
{
  const { got, closed } = await session({}, (ws) => {
    for (let i = 0; i < 30; i++) ws.send(JSON.stringify({ type: "check_update" }));
  }, 2500);
  if (!closed && !got.some((m) => m.type === "denied")) fail("30 refused messages did not end the connection");
}
console.log("strike limit OK");

// 7. A key (when the operator configured one and told us) unlocks perks.
if (KEY) {
  const { got } = await session({}, (ws) => {
    ws.send(JSON.stringify({ type: "unlock", key: KEY }));
    ws.send(JSON.stringify({ type: "get_state" }));
  });
  const unlocked = got.find((m) => m.type === "unlocked");
  if (!unlocked) fail(`unlock with KEY=${KEY} produced no 'unlocked' reply: ${JSON.stringify(got.filter((m) => m.type === "error"))}`);
  const last = got.filter((m) => m.type === "public_state").pop()!.state as { unlocked: string[] };
  if (!last.unlocked.length) fail("snapshot after unlock lists no key");
  console.log(`key OK (${unlocked.name})`);
} else {
  const { got } = await session({}, (ws) => ws.send(JSON.stringify({ type: "unlock", key: "definitely-not-a-key" })));
  if (!got.some((m) => m.type === "error")) fail("an unknown code did not produce an error");
  console.log("unknown key OK (set KEY=<secret> to test a real one)");
}

console.log("PUBLIC FLOOR PASS");
process.exit(0);
