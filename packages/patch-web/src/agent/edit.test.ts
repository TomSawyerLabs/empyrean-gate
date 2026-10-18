import { describe, expect, test } from "bun:test";
import type { PatchDoc } from "../types";
import { applyOps } from "./edit";
import { hasPatchLink, patchLink, readPatchLink } from "./link";

function doc(): PatchDoc {
  return {
    format: 5,
    id: "p1",
    name: "Test",
    description: "",
    nodes: [
      { id: "bow", kind: "rainbow", name: "", params: { speed: 0.5 }, pos: [0, 0] },
      { id: "out", kind: "output", name: "", params: {}, pos: [300, 0] },
    ],
    edges: [{ from: { node: "bow", port: "out" }, to: { node: "out", port: "in" } }],
    exposed: [{ node: "bow", param: "speed", label: "Speed" }],
  };
}

describe("applyOps", () => {
  test("leaves the input alone", () => {
    const d = doc();
    applyOps(d, [{ op: "set_params", node: "bow", params: { speed: 2 } }]);
    expect(d).toEqual(doc());
  });

  test("a Blend's layers: added with it, and fewer drops the top ones", () => {
    let next = applyOps(doc(), [
      { op: "add_node", kind: "blend", id: "mix", layers: 3, params: { opacity3: 0.5, opacity: 0.2 } },
      { op: "connect", from: "bow.out", to: "mix.over3" },
      { op: "expose", node: "mix", param: "opacity3" },
    ]);
    expect(next.nodes.find((n) => n.id === "mix")?.layers).toBe(3);
    next = applyOps(next, [{ op: "set_layers", node: "mix", layers: 2 }]);
    const mix = next.nodes.find((n) => n.id === "mix")!;
    expect(mix.layers).toBe(2);
    expect(mix.params).toEqual({ opacity: 0.2 });
    expect(next.edges.some((e) => e.to.node === "mix")).toBe(false);
    expect(next.exposed.some((x) => x.node === "mix")).toBe(false);
    next = applyOps(next, [{ op: "set_layers", node: "mix", layers: 1 }]);
    expect("layers" in next.nodes.find((n) => n.id === "mix")!).toBe(false);
    expect(() => applyOps(next, [{ op: "set_layers", node: "mix", layers: 9 }])).toThrow("1 to 8");
  });

  test("adds a node and wires it in, replacing what fed that input", () => {
    const next = applyOps(doc(), [
      { op: "add_node", kind: "sparkle", id: "spark" },
      { op: "add_node", kind: "blend" },
      { op: "connect", from: "bow.out", to: { node: "n4", port: "base" } },
      { op: "connect", from: "spark.out", to: "n4.over" },
      { op: "connect", from: "n4.out", to: "out.in" },
    ]);
    expect(next.nodes.map((n) => n.id)).toEqual(["bow", "out", "spark", "n4"]);
    expect(next.edges.filter((e) => e.to.node === "out")).toEqual([
      { from: { node: "n4", port: "out" }, to: { node: "out", port: "in" } },
    ]);
    // New nodes are placed right of the graph, one below the other.
    const [spark, blend] = [next.nodes[2]!, next.nodes[3]!];
    expect(spark.pos[0]).toBeGreaterThan(300);
    expect(blend.pos[1]).toBeGreaterThan(spark.pos[1]);
  });

  test("set_params with null returns a knob to its default", () => {
    const next = applyOps(doc(), [{ op: "set_params", node: "bow", params: { speed: null, turns: 3 } }]);
    expect(next.nodes[0]!.params).toEqual({ turns: 3 });
  });

  test("remove_node takes its wires and exposed knobs with it", () => {
    const next = applyOps(doc(), [{ op: "remove_node", node: "bow" }]);
    expect(next.edges).toEqual([]);
    expect(next.exposed).toEqual([]);
  });

  test("errors name the operation and what was wrong", () => {
    expect(() => applyOps(doc(), [{ op: "set_params", node: "nope", params: {} }])).toThrow(
      'op 0 (set_params): no node "nope" (nodes: bow, out)',
    );
    expect(() => applyOps(doc(), [{ op: "connect", from: "bow", to: "out.in" }])).toThrow(
      'op 0 (connect): from "bow" is not "node.port"',
    );
    expect(() => applyOps(doc(), [{ op: "fly" } as never])).toThrow("op 0 (fly): unknown op");
    expect(() => applyOps(doc(), [{ op: "set_code", node: "bow", code: { body: "" } }])).toThrow("not a Code node");
  });

  test("disconnect, set_info, expose and unexpose", () => {
    const next = applyOps(doc(), [
      { op: "disconnect", to: "out.in" },
      { op: "set_info", name: "Renamed", description: "About" },
      { op: "unexpose", node: "bow", param: "speed" },
      { op: "expose", node: "bow", param: "turns" },
    ]);
    expect(next.edges).toEqual([]);
    expect([next.name, next.description]).toEqual(["Renamed", "About"]);
    expect(next.exposed).toEqual([{ node: "bow", param: "turns", label: "turns" }]);
    expect(() => applyOps(next, [{ op: "disconnect", to: "out.in" }])).toThrow("nothing is wired into out.in");
  });

  test("arrange lays the graph out left to right", () => {
    const next = applyOps(doc(), [], true);
    expect(next.nodes[0]!.pos[0]).toBeLessThan(next.nodes[1]!.pos[0]);
  });
});

describe("patch links", () => {
  test("a compressed link round-trips and opens as a new patch", async () => {
    const url = await patchLink(doc(), "https://example.org/playground#old");
    expect(url.startsWith("https://example.org/playground#patch=z")).toBe(true);
    expect(hasPatchLink(url)).toBe(true);
    expect(await readPatchLink(url)).toEqual({ ...doc(), id: "" });
  });

  test("plain JSON works, percent-encoded or not, after other fragment params", async () => {
    const json = JSON.stringify({ ...doc(), description: "a & b" });
    expect((await readPatchLink(`#patch=${encodeURIComponent(json)}`))?.description).toBe("a & b");
    expect((await readPatchLink(`#x=1&patch=${json}`))?.name).toBe("Test");
  });

  test("no patch is null; a damaged one says so", async () => {
    expect(await readPatchLink("https://example.org/playground")).toBeNull();
    expect(hasPatchLink("#other=1")).toBe(false);
    await expect(readPatchLink("#patch=zAAAA")).rejects.toThrow("damaged");
    await expect(readPatchLink("#patch=%7Bnope")).rejects.toThrow("not JSON");
  });
});
