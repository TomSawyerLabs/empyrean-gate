// Preview-slot queue test. Run against a backend with max_preview_clients=2:
// three subscribers connect; the third must queue (position 1) and receive no
// frames, then get promoted (position 0 + frames) when the first disconnects.
// Usage: bun scripts/queue-test.ts [ws url]

const url = process.argv[2] ?? "ws://127.0.0.1:9520/ws";

function fail(msg: string): never {
  console.error(`QUEUE FAIL: ${msg}`);
  process.exit(1);
}

interface Viewer {
  ws: WebSocket;
  frames: number;
  queuePos: number | null;
}

function connect(name: string): Promise<Viewer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const v: Viewer = { ws, frames: 0, queuePos: null };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", name, client_id: name, token: "" }));
      ws.send(JSON.stringify({ type: "subscribe_preview", fps: 30, decimate: 8 }));
      resolve(v);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const m = JSON.parse(ev.data);
        if (m.type === "preview_queue") v.queuePos = m.position;
      } else {
        v.frames++;
      }
    };
    ws.onerror = () => reject(new Error(`${name} failed to connect`));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const a = await connect("viewer-a");
const b = await connect("viewer-b");
await sleep(700);
const c = await connect("viewer-c");
await sleep(1500);

if (a.frames < 5 || b.frames < 5) fail(`active viewers starved (a=${a.frames} b=${b.frames})`);
if (c.frames > 0) fail(`queued viewer received ${c.frames} frames`);
if (c.queuePos !== 1) fail(`queued viewer position=${c.queuePos}, expected 1`);
console.log(`phase 1 OK: a=${a.frames} b=${b.frames} frames; c queued at #${c.queuePos}`);

a.ws.close();
await sleep(2000);
if (c.frames < 3) fail(`promoted viewer got no frames after slot freed (frames=${c.frames})`);
if (c.queuePos !== 0) fail(`promoted viewer never notified (position=${c.queuePos})`);
console.log(`phase 2 OK: c promoted, ${c.frames} frames, position cleared`);
console.log("QUEUE PASS");
process.exit(0);
