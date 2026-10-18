// What the command line works on: the patch core loaded from the package's
// own wasm, an optional headless WebGPU runtime (Dawn, from the `webgpu`
// package), and a host holding one patch in memory (optionally a file).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PatchHost } from "../src/agent/api";
import { exportPatch, parsePatchFile } from "../src/editor/files";
import { loadPatchCore, type PatchCore } from "../src/runtime/core";
import { attachGroove } from "../src/runtime/groove";
import { GATE_GEOMETRY, PatchRuntime } from "../src/runtime/index";
import { PATCH_FORMAT, type PatchDoc } from "../src/types";

export const PLAYGROUND = "https://empyreangate.org/playground";

function wasmBytes(): Uint8Array {
  // cli/ sits next to wasm/ both in this repo and in the web-dist package.
  return readFileSync(new URL("../wasm/patch_bg.wasm", import.meta.url));
}

export function loadCore(): Promise<PatchCore> {
  return loadPatchCore(wasmBytes() as BufferSource);
}

function readInput(path: string | undefined): string {
  if (!path) throw new Error("Give a patch file (or - for stdin).");
  return path === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(path), "utf8");
}

export function readPatch(path: string | undefined): PatchDoc {
  return parsePatchFile(readInput(path));
}

/** Held for the life of the process: dawn.node tears its instance down when
 * the GPU object is collected, even with devices still in use, and the next
 * GPU call then crashes the process. */
let dawn: GPU | null = null;

/** Dawn's WebGPU, from the optional `webgpu` package: next to this file
 * (npx -p webgpu …) or in the current project. Null when not installed. */
async function loadWebGpu(): Promise<GPU | null> {
  const from = [import.meta.url, resolve(process.cwd(), "noop.js")];
  for (const base of from) {
    try {
      const path = createRequire(base).resolve("webgpu");
      const mod = (await import(pathToFileURL(path).href)) as {
        create(flags: string[]): GPU;
        globals: Record<string, unknown>;
      };
      Object.assign(globalThis, mod.globals);
      dawn = mod.create([]);
      return dawn;
    } catch {
      // Not there; try the next place.
    }
  }
  return null;
}

export const WEBGPU_HINT =
  "Rendering needs WebGPU from the optional `webgpu` package (Dawn), run under Node: " +
  "`npm i webgpu` in your project, or `npx -p webgpu -p github:TomSawyerLabs/empyrean-gate#web-dist empyrean-patch …`.";

/** A runtime with no display, driven by the synthetic groove; null without
 * WebGPU. */
export async function headlessRuntime(): Promise<PatchRuntime | null> {
  const gpu = await loadWebGpu();
  if (!gpu) return null;
  const runtime = await PatchRuntime.create(GATE_GEOMETRY, { gpu, wasm: wasmBytes() as BufferSource });
  attachGroove(runtime);
  return runtime;
}

/** A host over one document in memory, rendered by `runtime` if any, and
 * written to `file` on every change if given. */
export function fileHost(core: PatchCore, runtime: PatchRuntime | null, file?: string): PatchHost & { open(doc: PatchDoc): Promise<void> } {
  let doc: PatchDoc | null = file && existsSync(file) ? parsePatchFile(readFileSync(file, "utf8")) : null;
  const run = async (d: PatchDoc) => {
    if (!runtime) return null;
    await runtime.setPatch(d);
    return runtime.getStatus().error;
  };
  if (doc && runtime) void run(doc);
  return {
    core,
    geometry: GATE_GEOMETRY,
    getPatch: () => doc,
    async setPatch(next, asNew) {
      const id = !asNew && doc?.id ? doc.id : next.id || crypto.randomUUID();
      doc = { ...next, id, format: PATCH_FORMAT, name: next.name.trim() ? next.name : "Untitled" };
      if (file) writeFileSync(file, exportPatch(doc));
      return { doc, error: await run(doc) };
    },
    capture: runtime ? (o) => runtime.capture(o) : undefined,
    linkBase: PLAYGROUND,
    guide: {
      playground: PLAYGROUND,
      access:
        "You are talking to the `empyrean-patch` MCP server: the gate's own patch compiler and evaluator, on this " +
        "machine. It holds one open patch" +
        (file ? `, saved to \`${file}\` on every change` : "") +
        " (save_patch writes it anywhere; open_file reads one). " +
        (runtime
          ? "snapshot renders it with WebGPU, driven by a synthetic 122 BPM groove standing in for the music."
          : "Nothing renders here (no WebGPU): " + WEBGPU_HINT),
    },
    async open(d) {
      doc = d;
      if (file) writeFileSync(file, exportPatch(d));
      await run(d);
    },
  };
}
