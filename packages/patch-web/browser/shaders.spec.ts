// Every shader the patch core can generate (corpus.ts), compiled by Chrome's
// own WGSL compiler, Tint, on SwiftShader (Chrome's software WebGPU), so it
// runs on a CI machine with no GPU.
//
// The crate's tests validate the same WGSL with naga, which is what the
// desktop app compiles with, but browsers bring their own compilers and
// Tint is stricter: `a * b ^ c` passed naga and Chrome refused it. Building
// the pipelines too catches a shader that is valid but pathological to
// compile: Perlin noise's twelve-case `switch` kept SwiftShader busy for
// minutes.

import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { GATE_GEOMETRY } from "../src/runtime";
import { loadPatchCore } from "../src/runtime/core";
import { shaderCorpus } from "./corpus";

/** Longest a pipeline may take to build. The slowest measured on SwiftShader
 * is ~1.5 s on a workstation; the Perlin `switch` never finished in 90 s. */
const BUILD_BUDGET_MS = 20_000;

interface Shader {
  code: string;
  /** Which corpus entries generate it, `label (main)` / `label (thumbnails)`. */
  labels: string[];
  /** Its entry points: the grid passes (rendered textures), then `main`. */
  entries: string[];
}

let page: Page;
const shaders = new Map<string, Shader>();
/** Documents the core itself refused: a codegen bug, not a browser one. */
const refused: string[] = [];

test.beforeAll(async ({ browser }) => {
  const core = await loadPatchCore(readFileSync(new URL("../wasm/patch_bg.wasm", import.meta.url)));
  const g = GATE_GEOMETRY;
  for (const { label, doc } of shaderCorpus(core)) {
    let sim;
    try {
      sim = core.createSim(doc, g.spokes, g.pixels, g.innerOverOuter);
    } catch (e) {
      refused.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // Both modules carry the grid passes (the gate's thumbnail bus runs
    // them with its own buffers).
    const grids = (JSON.parse(sim.gridPasses()) as { passes: { entry: string }[] }).passes;
    const entries = [...grids.map((p) => p.entry), "main"];
    for (const [code, which] of [
      [sim.wgsl(), "main"],
      [sim.previewWgsl(), "thumbnails"],
    ] as const) {
      if (!code) continue;
      const shader = shaders.get(code) ?? { code, labels: [], entries };
      shader.labels.push(`${label} (${which})`);
      shaders.set(code, shader);
    }
    sim.free();
  }

  page = await browser.newPage();
  // WebGPU needs a secure context; localhost is one, and nothing is served.
  await page.route("http://localhost/", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html><title>shaders</title>" }),
  );
  await page.goto("http://localhost/");
  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    if (!a) return null;
    Object.assign(globalThis, { device: await a.requestDevice() });
    return `${a.info.vendor} ${a.info.architecture}`;
  });
  expect(adapter, "no WebGPU adapter: see the launch flags in playwright.config.ts").not.toBeNull();
});

test.afterAll(async () => {
  await page?.close();
});

/** `labels`, shortened past a few. */
function which(labels: string[]): string {
  return labels.length > 3 ? `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more` : labels.join(", ");
}

test("the core compiles every document in the corpus", () => {
  expect(shaders.size).toBeGreaterThan(100);
  expect(refused).toEqual([]);
});

test("Chrome's compiler accepts every shader", async () => {
  const failures: string[] = [];
  for (const shader of shaders.values()) {
    const errors = await page.evaluate(async (code) => {
      const device = (globalThis as unknown as { device: GPUDevice }).device;
      const info = await device.createShaderModule({ code }).getCompilationInfo();
      return info.messages
        .filter((m) => m.type === "error")
        .map((m) => ({ line: m.lineNum, column: m.linePos, message: m.message }));
    }, shader.code);
    if (!errors.length) continue;
    const lines = shader.code.split("\n");
    failures.push(
      `${which(shader.labels)}:\n` +
        errors.map((e) => `  wgsl:${e.line}:${e.column} ${e.message}\n    ${lines[e.line - 1]?.trim()}`).join("\n"),
    );
  }
  expect(failures.join("\n\n")).toBe("");
});

test("every shader builds a pipeline in time", async () => {
  const failures: string[] = [];
  for (const shader of shaders.values()) {
    const result = await page.evaluate(
      async ([code, budget, entries]) => {
        const device = (globalThis as unknown as { device: GPUDevice }).device;
        const module = device.createShaderModule({ code });
        // One Tint refuses is the test above's to report.
        const info = await module.getCompilationInfo();
        if (info.messages.some((m) => m.type === "error")) return { error: null };
        const built = Promise.all(
          entries.map((entryPoint) =>
            device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint } }),
          ),
        ).then(
          () => null,
          (e: unknown) => String(e),
        );
        const late = new Promise<"late">((r) => setTimeout(() => r("late"), budget));
        const outcome = await Promise.race([built, late]);
        return outcome === "late" ? { late: true, error: null } : { late: false, error: outcome };
      },
      [shader.code, BUILD_BUDGET_MS, shader.entries] as const,
    );
    if (result.late) {
      // SwiftShader is still compiling it, and every build after it would
      // queue behind: nothing further can be timed, so stop here.
      failures.push(`${which(shader.labels)}: not built after ${BUILD_BUDGET_MS / 1000} s; stopped there`);
      break;
    }
    if (result.error) failures.push(`${which(shader.labels)}: ${result.error}`);
  }
  expect(failures.join("\n")).toBe("");
});
