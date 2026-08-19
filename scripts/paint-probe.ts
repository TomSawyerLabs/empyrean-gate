// Diagnostic: does a Paint dab actually light pixels? Sends a huge white glow dab,
// then measures max preview-pixel brightness before/after.
// Usage: bun scripts/paint-probe.ts [ws url]

const url = process.argv[2] ?? "ws://127.0.0.1:9520/ws";
const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";

let phase = "before";
let maxBefore = 0;
let maxAfter = 0;

function frameMax(buf: ArrayBuffer): number {
  const bytes = new Uint8Array(buf, 12);
  let m = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > m) m = bytes[i];
  return m;
}

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "hello", name: "probe", client_id: "probe", token: "" }));
  ws.send(JSON.stringify({ type: "subscribe_preview", fps: 30, decimate: 1 }));
  setTimeout(() => {
    phase = "after";
    // Repeated large white dabs across half the array.
    const send = () =>
      ws.send(
        JSON.stringify({
          type: "paint",
          pen: "glow",
          points: [
            { angle: 0, radius: 0.5 },
            { angle: 1, radius: 0.5 },
            { angle: 2, radius: 0.5 },
          ],
          hue: -1,
          size: 0.5,
          intensity: 2,
        }),
      );
    send();
    const iv = setInterval(send, 100);
    setTimeout(() => {
      clearInterval(iv);
      console.log(`max brightness before=${maxBefore} after=${maxAfter}`);
      console.log(maxAfter > Math.min(250, maxBefore + 40) ? "PAINT RENDERS" : "PAINT DOES NOT RENDER");
      process.exit(0);
    }, 1500);
  }, 1000);
};

ws.onmessage = (ev) => {
  if (typeof ev.data === "string") {
    const m = JSON.parse(ev.data);
    if (m.type === "error" || m.type === "denied") console.log("server said:", m);
    return;
  }
  const v = frameMax(ev.data as ArrayBuffer);
  if (phase === "before") maxBefore = Math.max(maxBefore, v);
  else maxAfter = Math.max(maxAfter, v);
};

setTimeout(() => process.exit(1), 8000);
