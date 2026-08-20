// Self-update end-to-end test. Run against a backend started with
// EMPYREAN_FAKE_VERSION=0.0.1: it should discover the latest real GitHub release,
// download it beside itself, spawn it, and hand over. This script drives the check
// + install over WS and reports when the successor is serving.
// Usage: bun scripts/update-test.ts [http base]

const base = process.argv[2] ?? "http://127.0.0.1:9520";
const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);

let installed = false;

function fail(msg: string): never {
  console.error(`UPDATE FAIL: ${msg}`);
  process.exit(1);
}

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "hello", name: "update-test", client_id: "update-test", token: "" }));
  ws.send(JSON.stringify({ type: "check_update" }));
  console.log("checking for updates…");
};

ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") return;
  const msg = JSON.parse(ev.data);
  if (msg.type !== "status" && msg.type !== "state") return;
  const st = msg.status;
  if (st.update_state?.startsWith("check failed") || st.update_state?.startsWith("install failed")) {
    fail(st.update_state);
  }
  if (st.update_available && !installed) {
    installed = true;
    console.log(`found v${st.update_available} (running v${st.version}); installing…`);
    ws.send(JSON.stringify({ type: "install_update" }));
  }
};

// The old instance dying (handover) closes our socket — then we poll for the successor.
ws.onclose = async () => {
  if (!installed) fail("socket closed before an update was staged");
  console.log("old instance gone; waiting for the successor…");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        console.log("successor is serving.");
        console.log("UPDATE PASS");
        process.exit(0);
      }
    } catch {
      // still swapping
    }
  }
  fail("successor never came up");
};

setTimeout(() => fail("timeout"), 120000);
