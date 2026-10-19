import { describe, expect, test } from "bun:test";
import { formatLive, liveEntries } from "./code-live";

describe("liveEntries", () => {
  test("keys each declaration as the crate's interpreter does", () => {
    // The same body as the crate's `probes_report_lets_vars_and_state`.
    const body =
      "let a = x * 2.0;\n// a comment\n  var b = 0.0;\nif (a > 100.0) {\n  let big = 1.0;\n  b = big;\n}\nstate.n += 1.0;\nout = a + b;";
    expect(liveEntries(body).map((e) => e.key)).toEqual(["@1:5:a", "@3:7:b", "@5:7:big", "@state:n"]);
    expect(liveEntries(body).map((e) => e.line)).toEqual([0, 2, 4, 7]);
  });

  test("columns count bytes, comments are skipped, a state name keys once", () => {
    expect(liveEntries("/* é */ let a = 1.0;")[0]!.key).toBe("@1:14:a");
    expect(liveEntries("// let x = 1.0;\nstate.n += 1.0; state.n += 1.0;\nstate.m = 0.0;").map((e) => e.key)).toEqual([
      "@state:n",
      "@state:m",
    ]);
    expect(liveEntries("for (var i = 0; i < 3; i++) { }")[0]!.key).toBe("@1:10:i");
  });
});

describe("formatLive", () => {
  test("short, as a body would write it", () => {
    expect([formatLive(3), formatLive(0.123456), formatLive(-12.5), formatLive(123456.7), formatLive(0.0001)]).toEqual([
      "3",
      "0.1235",
      "-12.5",
      "1.23e+5",
      "1.00e-4",
    ]);
  });
});

describe("the patch core", () => {
  test("meters every value the editor shows, under the editor's keys", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { loadPatchCore } = await import("../runtime/core");
    const core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "..", "wasm", "patch_bg.wasm")));
    const body = "/* é */ let a = 1.5;\nvar b = 0.0;\nif (a > 9.0) {\n  let never = 1.0;\n}\nstate.t += 2.0;\nb = a * 2.0;\nout = b;";
    const port = { min: 0, max: 1, default: 0 };
    const doc = {
      format: core.limits.patchFormat,
      id: "live",
      name: "live",
      description: "",
      nodes: [
        { id: "c", kind: "code", name: "c", params: {}, pos: [0, 0] as [number, number], code: { inputs: [], outputs: [{ name: "out", shape: "scalar" as const, ...port }], body } },
        { id: "o", kind: "output", name: "o", params: {}, pos: [0, 0] as [number, number] },
      ],
      edges: [],
      exposed: [],
    };
    const sim = core.createSim(doc, 64, 32, 0.2);
    const refs = JSON.parse(sim.previewScalars()) as [string, string][];
    sim.step(1 / 60);
    sim.step(1 / 60);
    const values = sim.scalarValues();
    const at = (key: string) => {
      const i = refs.findIndex(([n, p]) => n === "c" && p === key);
      return i < 0 ? undefined : values[i];
    };
    const keys = liveEntries(body).map((e) => e.key);
    expect(keys).toEqual(["@1:14:a", "@2:5:b", "@4:7:never", "@state:t"]);
    // `never` sits in a branch no frame took: NaN, which the editor skips.
    expect(keys.map(at)).toEqual([1.5, 3, NaN, 4]);
    sim.free();
  });
});
