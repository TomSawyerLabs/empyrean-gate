// Video playlist + cache test. Requires a running backend and internet.
//  1. watched-folder scan: a video file in a configured dir appears in the playlist
//  2. URL entries download into the media cache (state -> cached)
//  3. /media/file/{id} serves the cached bytes with Range support
// Usage: bun scripts/playlist-test.ts <http base> <test video url>

const base = process.argv[2] ?? "http://127.0.0.1:9520";
const testUrl = process.argv[3] ?? "https://www.w3schools.com/html/mov_bbb.mp4";

function fail(msg: string): never {
  console.error(`PLAYLIST FAIL: ${msg}`);
  process.exit(1);
}

const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
let config: any = null;
let status: any = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") return;
  const m = JSON.parse(ev.data);
  if (m.type === "state") {
    config = m.config;
    status = m.status;
  }
  if (m.type === "status") status = m.status;
};

await new Promise<void>((resolve, reject) => {
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "hello", name: "playlist-test", client_id: "playlist-test", token: "" }));
    resolve();
  };
  ws.onerror = () => reject(new Error("connect failed"));
});
while (!config) await sleep(100);

// 1. Folder scan (the harness pre-created the dir with a file in config).
for (let i = 0; i < 20 && !config.video.playlist.some((e: any) => e.kind === "local_file"); i++) {
  await sleep(1000);
}
const localEntry = config.video.playlist.find((e: any) => e.kind === "local_file");
if (!localEntry) fail("watched-folder file never appeared in the playlist");
console.log(`scan OK: found "${localEntry.title}" from ${localEntry.from_dir}`);

// 2. Add a URL entry and wait for the cache.
const id = crypto.randomUUID().replace(/-/g, "");
ws.send(
  JSON.stringify({
    type: "set_config",
    config: {
      ...config,
      video: {
        ...config.video,
        playlist: [
          ...config.video.playlist,
          { id, title: "test video", source: testUrl, kind: "url", from_dir: "" },
        ],
      },
    },
  }),
);
let cached = false;
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  const c = status?.video_cache?.find((c: any) => c.id === id);
  if (c?.state === "cached") {
    console.log(`cache OK: ${(c.bytes / 1e6).toFixed(2)} MB downloaded`);
    cached = true;
    break;
  }
  if (c?.state === "error") fail(`cache errored: ${c.error}`);
}
if (!cached) fail("URL entry never finished caching");

// 3. Serve the cached bytes, with a range request.
const full = await fetch(`${base}/media/file/${id}`);
if (!full.ok) fail(`cached file fetch -> ${full.status}`);
const buf = await full.arrayBuffer();
if (buf.byteLength < 100_000) fail(`cached file suspiciously small (${buf.byteLength})`);
const part = await fetch(`${base}/media/file/${id}`, { headers: { Range: "bytes=0-99" } });
if (part.status !== 206) fail(`range request -> ${part.status}, expected 206`);
if ((await part.arrayBuffer()).byteLength !== 100) fail("range length mismatch");
console.log(`serve OK: ${buf.byteLength} bytes, range requests honored`);
console.log("PLAYLIST PASS");
process.exit(0);
