// End-to-end test for controller addressing by IP or MAC, against a running
// backend (empyrean-gate --headless) and a fake PixLite on real sockets.
//
// Proves the part the unit tests cannot: that the background resolver really
// probes the network on its own, hears a DiscProt reply, and turns a MAC entry
// into the address the box answered from — and that everything it cannot resolve
// is reported as such rather than silently dropped.
//
// Output stays OFF throughout, so nothing reaches a rig; where packets would go
// is covered by the sender's unit tests in src-tauri/src/sacn.rs.
//
// Run against an isolated config (the fake is started by this script):
//   EMPYREAN_CONFIG=$TEMP/addr-e2e/config.json EMPYREAN_PORT=9541 \
//     ./src-tauri/target/debug/empyrean-gate.exe --headless
//   E2E_BASE=http://127.0.0.1:9541 bun scripts/addressing-test.ts

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:9520";
const WS_URL = `${BASE.replace("http", "ws")}/ws`;

// What scripts/fake-pixlite.ts answers with for its first two devices.
const FAKE_MAC = "00:1D:2E:00:00:10";
const FAKE_MAC_2 = "00:1D:2E:00:00:11";
const NEVER_FOUND = "00:1D:2E:00:00:99";

function fail(msg: string): never {
  console.error(`ADDRESSING FAIL: ${msg}`);
  fake.kill();
  process.exit(1);
}

const fake = Bun.spawn(["bun", "scripts/fake-pixlite.ts", "2"], { stdout: "ignore", stderr: "inherit" });

let config: Record<string, any> | null = null;
let status: Record<string, any> | null = null;
let discovery: Record<string, any> | null = null;

const ws = new WebSocket(WS_URL);
ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") return;
  const msg = JSON.parse(ev.data);
  if (msg.type === "state") {
    config = msg.config;
    status = msg.status;
  } else if (msg.type === "status") {
    status = msg.status;
  } else if (msg.type === "discovery") {
    discovery = msg.result;
  }
};

const send = (m: unknown) => ws.send(JSON.stringify(m));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(
  what: string,
  get: () => T | null | undefined,
  ms = 8000,
  seen?: () => unknown,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== null && v !== undefined && v !== false) return v as T;
    if (Date.now() > deadline) {
      fail(`timed out waiting for ${what}${seen ? `; last seen: ${JSON.stringify(seen())}` : ""}`);
    }
    await sleep(50);
  }
}

await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve();
  ws.onerror = () => reject(new Error(`cannot connect to ${WS_URL}`));
});
send({ type: "hello", name: "addressing-e2e", client_id: "addressing-e2e", token: "" });
await waitFor("the initial state", () => config && status);
const original = structuredClone(config!);
if (original.output.enabled) fail("run this against an isolated config with sACN output off");

const addresses = () => (status?.controller_addresses ?? []) as any[];

// ------------------------------------------------------------ resolver
console.log("Background resolver:");
const entries = ["10.9.9.9", FAKE_MAC.toLowerCase(), NEVER_FOUND, "", "not-an-address"];
send({
  type: "set_config",
  config: { ...config, output: { ...config!.output, multicast: false, controllers: entries } },
});
await waitFor("the controller list", () => config?.output.controllers[1] === entries[1]);

// No scan is requested: the resolver must find the MAC by itself.
const resolved = await waitFor(
  "the resolver to find the fake's MAC",
  () => addresses()[1]?.source === "discovered" && addresses(),
  15000,
  addresses,
);
const [ip, mac, never, empty, invalid] = resolved;
if (ip.kind !== "ip" || ip.source !== "configured" || ip.ip !== "10.9.9.9") {
  fail(`an IP entry is used as written: ${JSON.stringify(ip)}`);
}
console.log("  OK  an IP entry is used as written");
if (mac.kind !== "mac" || !mac.ip) fail(`MAC entry did not resolve: ${JSON.stringify(mac)}`);
console.log(`  OK  ${FAKE_MAC} resolved to ${mac.ip} without a manual scan`);
if (never.source !== "fallback" || never.ip !== null) {
  fail(`a MAC nothing answers for falls back to multicast: ${JSON.stringify(never)}`);
}
console.log("  OK  a MAC nothing answers for is on the multicast fallback");
if (empty.kind !== "empty" || invalid.kind !== "invalid") {
  fail(`empty and invalid entries are reported: ${JSON.stringify([empty, invalid])}`);
}
console.log("  OK  empty and invalid entries are reported, not dropped");

// ------------------------------------------------------------ manual scan
console.log("\nScan reconciliation:");
send({ type: "discover_controllers" });
const scan = await waitFor("a discovery result", () => discovery, 20000);
const found = (scan.found as any[]).find((c) => c.mac === FAKE_MAC);
if (!found?.expected) fail(`the MAC entry's box should be expected: ${JSON.stringify(scan.found)}`);
console.log("  OK  a MAC entry matches its box by MAC");
const second = (scan.found as any[]).find((c) => c.mac === FAKE_MAC_2);
if (!second || second.expected) fail(`an unlisted box is unexpected: ${JSON.stringify(scan.found)}`);
console.log("  OK  a box not in the list is unexpected");
for (const want of ["10.9.9.9", NEVER_FOUND, "not-an-address"]) {
  if (!scan.missing.includes(want)) fail(`${want} should be missing: ${JSON.stringify(scan.missing)}`);
}
console.log("  OK  unanswered entries are missing, by the text that was configured");

// A scan feeds the book too: the second box resolves as soon as it is listed.
send({
  type: "set_config",
  config: { ...config, output: { ...config!.output, controllers: [FAKE_MAC_2] } },
});
await waitFor(
  "the second box to resolve",
  () => addresses()[0]?.entry === FAKE_MAC_2 && addresses()[0]?.source === "discovered",
  15000,
  addresses,
);
console.log(`  OK  ${FAKE_MAC_2} resolved to ${addresses()[0].ip}`);

// ------------------------------------------------------------ cache file
const cfgPath = process.env.EMPYREAN_CONFIG;
if (cfgPath) {
  const cachePath = cfgPath.replace(/[^\\/]+$/, "controller-addresses.json");
  const text = await Bun.file(cachePath).text().catch(() => "");
  if (!text.includes(FAKE_MAC) || !text.includes(FAKE_MAC_2)) {
    fail(`the cache should remember both boxes: ${cachePath}: ${text}`);
  }
  console.log(`  OK  both boxes remembered in ${cachePath}`);
} else {
  console.log("  --  EMPYREAN_CONFIG not set here; skipping the cache-file check");
}

// ------------------------------------------------------------------ restore
send({ type: "set_config", config: original });
await waitFor("the original controller list", () =>
  JSON.stringify(config?.output.controllers) === JSON.stringify(original.output.controllers),
);
ws.close();
fake.kill();
console.log("\nADDRESSING E2E PASSED");
process.exit(0);
