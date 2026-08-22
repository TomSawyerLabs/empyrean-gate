// Node-graph patch protocol test. Run against a backend from THIS machine
// (mutations are loopback-only): registry endpoint, save/list echo, activation
// gating (good patch activates and renders; unsupported node kinds refused),
// and deactivation. Usage: bun scripts/patch-test.ts [host:port]
//
// Safe against a live show instance only if pointed at an isolated backend —
// use EMPYREAN_CONFIG with a scratch config/port (see plans/node-graph.md).

const host = process.argv[2] ?? "127.0.0.1:9520";
const httpBase = `http://${host}`;
const wsUrl = `ws://${host}/ws`;

function fail(msg: string): never {
  console.error(`PATCH FAIL: ${msg}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- 1. registry ------------------------------------------------------------

const registry = (await (await fetch(`${httpBase}/patch/registry`)).json()) as {
  id: string;
  outputs: unknown[];
  params: unknown[];
}[];
if (!Array.isArray(registry) || registry.length < 15) {
  fail(`registry has ${registry?.length} types`);
}
if (!registry.some((t) => t.id === "output") || !registry.some((t) => t.id === "noise_field")) {
  fail("registry missing core node types");
}
console.log(`registry OK: ${registry.length} node types`);

// --- 2. WS client -----------------------------------------------------------

type Msg = Record<string, any>;
const inbox: Msg[] = [];
const ws = new WebSocket(wsUrl);
await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve();
  ws.onerror = () => reject(new Error(`cannot connect ${wsUrl}`));
});
ws.onmessage = (ev) => {
  if (typeof ev.data === "string") inbox.push(JSON.parse(ev.data));
};
const send = (m: Msg) => ws.send(JSON.stringify(m));
// Sequential consumption: the cursor persists across waits, so a message from
// before one phase can never satisfy a later phase's predicate.
let cursor = 0;
async function waitFor(pred: (m: Msg) => boolean, what: string, ms = 5000): Promise<Msg> {
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

send({ type: "hello", name: "patch-test", client_id: "patch-test", token: "" });
await waitFor((m) => m.type === "state", "greeting state");

// --- 3. save + list ---------------------------------------------------------

const doc = {
  format: 1,
  id: "",
  name: "Protocol Test",
  description: "",
  nodes: [
    { id: "n1", kind: "noise_field", name: "", params: { scale: 2 }, pos: [0, 0] },
    { id: "n2", kind: "output", name: "", params: {}, pos: [300, 0] },
  ],
  edges: [{ from: { node: "n1", port: "out" }, to: { node: "n2", port: "in" } }],
  exposed: [],
};
send({ type: "patch_save", patch: doc });
const echo = await waitFor((m) => m.type === "patch", "save echo");
const id = echo.patch.id as string;
if (!id) fail("save echo carries no id");
const listed = await waitFor((m) => m.type === "patches", "patches broadcast");
if (!listed.patches.some((p: Msg) => p.id === id)) fail("saved patch missing from list");
console.log(`save OK: id ${id.slice(0, 8)}…, listed`);

// --- 4. activate + render ---------------------------------------------------

send({ type: "patch_activate", id });
const st = await waitFor(
  (m) => m.type === "state" && m.config.active_patch === id,
  "state with active_patch",
);
if (st.config.active_patch !== id) fail("active_patch not set");
await waitFor(
  (m) => m.type === "status" && m.status.patch_active === true && !m.status.patch_error,
  "engine rendering the patch (patch_active)",
  8000,
);
console.log("activate OK: engine reports patch_active with no error");

// --- 5. unsupported kinds are refused ---------------------------------------

const badDoc = {
  ...doc,
  id: "",
  name: "Unrenderable",
  nodes: [
    { id: "v", kind: "video_in", name: "", params: {}, pos: [0, 0] },
    { id: "o", kind: "output", name: "", params: {}, pos: [300, 0] },
  ],
  edges: [],
};
send({ type: "patch_save", patch: badDoc });
const badEcho = await waitFor((m) => m.type === "patch" && m.patch.name === "Unrenderable", "bad save echo");
const badId = badEcho.patch.id as string;
send({ type: "patch_activate", id: badId });
const err = await waitFor((m) => m.type === "error", "activation refusal");
if (!/not renderable/.test(err.message)) fail(`unexpected refusal message: ${err.message}`);
await sleep(300);
// The refusal must leave the good patch active.
send({ type: "get_state" });
const after = await waitFor((m) => m.type === "state", "state after refusal");
if (after.config.active_patch !== id) fail("refused activation clobbered active_patch");
console.log("refusal OK: unrenderable patch rejected, active patch untouched");

// --- 6. deactivate + cleanup ------------------------------------------------

send({ type: "patch_activate", id: null });
await waitFor(
  (m) => m.type === "state" && m.config.active_patch === null,
  "state with active_patch cleared",
);
await waitFor(
  (m) => m.type === "status" && m.status.patch_active === false,
  "engine back on the layer stack",
  8000,
);
send({ type: "patch_delete", id });
send({ type: "patch_delete", id: badId });
await waitFor(
  (m) => m.type === "patches" && m.patches.length === 0,
  "empty patch list after deletes",
);
console.log("deactivate + cleanup OK");
console.log("PATCH PASS");
process.exit(0);
