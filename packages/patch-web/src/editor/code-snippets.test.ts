import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPatchCore, type PatchCore } from "../runtime/core";
import { GATE_GEOMETRY } from "../runtime/index";
import { expandSnippet, snippetDocs } from "./code-snippets";

// The real patch core (run `bun run build:wasm` first). It checks a GPU body
// for what the gate refuses (loops without a bound, `return` with a value)
// and runs a CPU body's interpreter; the WGSL itself is compiled by Chrome in
// the browser shader check, which takes the same documents.
let core: PatchCore;
beforeAll(async () => {
  core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "..", "wasm", "patch_bg.wasm")));
});

describe("expandSnippet", () => {
  test("fields become their defaults, names their names, tabs an indent", () => {
    expect(expandSnippet("for (var ${1:i} = 0u; ${1:i} < ${2:8u}; ${1:i}++) {\n\t${}\n}")).toBe(
      "for (var i = 0u; i < 8u; i++) {\n  \n}",
    );
    expect(expandSnippet("if (${condition}) \{x\}")).toBe("if (condition) {x}");
  });
});

describe("every snippet", () => {
  test("is accepted by the core and runs, for each node it is offered on", () => {
    const into = core.registry.find((t) => t.id === "output")!.inputs[0]!.name;
    const docs = snippetDocs(core.limits.patchFormat, into);
    expect(docs.length).toBeGreaterThan(15);
    const g = GATE_GEOMETRY;
    const failures: string[] = [];
    for (const { label, doc } of docs) {
      const errors = core.validate(doc);
      if (errors.length) {
        failures.push(`${label}: ${errors.join("; ")}`);
        continue;
      }
      try {
        const sim = core.createSim(doc, g.spokes, g.pixels, g.innerOverOuter);
        sim.free();
      } catch (e) {
        failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
