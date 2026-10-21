// Lay out every built-in patch the way the editor's ⇆ Arrange does:
//
//   bun run arrange-presets      (in packages/patch-web, after `bun run build:wasm`)
//
// Arrange places the cards by their wires and their measured sizes
// (src/editor/arrange.ts), and only the editor knows a card's size: its
// knobs, the ports its mode shows, its live minis. So this opens each preset
// in the demo editor (demo/editor.tsx), in Chromium on SwiftShader's WebGPU
// so the minis are there as on a machine with a GPU, arranges it through the
// editor's handle, and writes the positions back into
// crates/empyrean-patch/src/presets/*.json, changing only each node's "pos".
// Run it again after adding or changing a preset;
// src/editor/presets-arranged.test.ts notices one that is not laid out.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import type { PatchDoc } from "../src/types";

const here = resolve(import.meta.dir, "..");
const presets = resolve(here, "..", "..", "crates", "empyrean-patch", "src", "presets");

if (!Bun.file(join(here, "wasm", "patch_bg.wasm")).size) {
  console.error("Build the patch core first: bun run build:wasm");
  process.exit(1);
}

/** The Arrange layout is the same on every screen; measure on a desk. */
const VIEWPORT = { width: 1600, height: 1000 };

const server = await createServer({
  configFile: join(here, "demo", "vite.config.ts"),
  // Any free port, beside a `bun run demo` that may already be on 28150.
  server: { port: 0, strictPort: false },
  logLevel: "warn",
});
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error("the demo server has no address");

// The same Chromium the browser shader check uses (playwright.config.ts).
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-webgpu-adapter=swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on("pageerror", (e) => console.error(`page: ${e.message}`));
  await page.goto(new URL("editor.html", url).href);
  await page.waitForFunction(() => (globalThis as { editorRef?: { current: unknown } }).editorRef?.current);
  if (!(await page.evaluate(() => (globalThis as { runtime?: unknown }).runtime))) {
    // Without the runtime there are no minis, and the cards measure smaller.
    throw new Error("no WebGPU in this Chromium: the cards would not measure as they do on a GPU");
  }

  let changed = 0;
  for (const file of readdirSync(presets).filter((f) => f.endsWith(".json")).sort()) {
    const path = join(presets, file);
    const text = readFileSync(path, "utf8");
    const doc = JSON.parse(text) as PatchDoc;
    const placed = await page.evaluate(arrangeInEditor, doc);
    const next = rewritePositions(text, placed, file);
    if (next !== text) {
      writeFileSync(path, next);
      changed++;
      console.log(`arranged ${file}`);
    } else {
      console.log(`unchanged ${file}`);
    }
  }
  console.log(`${changed} preset(s) rewritten`);
} finally {
  await browser.close();
  await server.close();
}

/** In the page: open `doc` (under an id of its own, so it is editable and
 * active, which is when its minis show), wait until every card has a size
 * that holds still, Arrange, and hand back the positions. */
async function arrangeInEditor(doc: PatchDoc): Promise<Record<string, [number, number]>> {
  interface Handle {
    open(d: PatchDoc): void;
    arrange(): void;
    doc(): PatchDoc | null;
  }
  const editor = (globalThis as unknown as { editorRef: { current: Handle } }).editorRef.current;
  editor.open({ ...doc, id: `arrange-${doc.id}` });

  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const ids = doc.nodes.map((n) => n.id).sort().join(" ");
  const cards = () =>
    [...document.querySelectorAll<HTMLElement>(".react-flow__node")]
      .map((el) => ({ id: el.dataset.id ?? "", w: el.offsetWidth, h: el.offsetHeight }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  const sizes = () => cards().map((c) => `${c.id}:${c.w}x${c.h}`).join(" ");
  // This document's cards (not the last one's), every one of them laid out.
  const ready = () => {
    const c = cards();
    return c.map((x) => x.id).join(" ") === ids && c.every((x) => x.w > 0 && x.h > 0);
  };
  // Measured and unchanged for half a second (fonts, minis, the code view).
  const deadline = performance.now() + 30_000;
  let last = "";
  let since = performance.now();
  for (;;) {
    await frame();
    const now = sizes();
    if (now !== last) {
      last = now;
      since = performance.now();
    } else if (ready() && performance.now() - since > 500) {
      break;
    }
    if (performance.now() > deadline) throw new Error(`${doc.id}: the cards never settled (${now})`);
  }

  editor.arrange();
  await frame();
  const out: Record<string, [number, number]> = {};
  for (const n of editor.doc()!.nodes) out[n.id] = n.pos;
  return out;
}

/** `text` with each node's `"pos": [x, y]` replaced and nothing else
 * touched. A node is one line, or (a Code node) an object over several lines
 * whose `"id"` comes before its `"pos"`; either way, within `"nodes"` each
 * `"pos"` belongs to the `"id"` last seen. */
function rewritePositions(text: string, placed: Record<string, [number, number]>, file: string): string {
  const start = text.indexOf('"nodes": [');
  const end = text.indexOf('"edges": [', start);
  if (start < 0 || end < 0) throw new Error(`${file}: no "nodes" then "edges"`);
  const seen = new Set<string>();
  let id: string | null = null;
  const nodes = text.slice(start, end).replace(/"id": "([^"]+)"|"pos": \[[^\]]*\]/g, (m, named?: string) => {
    if (named) {
      id = named;
      return m;
    }
    const p = id === null ? undefined : placed[id];
    if (id === null || !p) throw new Error(`${file}: a "pos" for ${id ?? "no node"}, which was not arranged`);
    seen.add(id);
    id = null;
    return `"pos": [${p[0]}, ${p[1]}]`;
  });
  const missing = Object.keys(placed).filter((n) => !seen.has(n));
  if (missing.length) throw new Error(`${file}: no "pos" found for ${missing.join(", ")}`);
  return text.slice(0, start) + nodes + text.slice(end);
}
