import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPatchCore, type PatchCore } from "../runtime/core";
import { GATE_GEOMETRY } from "../runtime/index";
import type { PatchDoc } from "../types";
import { createPatchApi, type PatchHost } from "./api";
import { agentGuide } from "./guide";
import { patchTools } from "./tools";

// The real patch core (run `bun run build:wasm` first).
let core: PatchCore;
beforeAll(async () => {
  core = await loadPatchCore(readFileSync(join(import.meta.dir, "..", "..", "wasm", "patch_bg.wasm")));
});

/** A host holding one document, as the command line's does. */
function memoryHost(open: PatchDoc | null = null) {
  let doc = open;
  let ids = 0;
  const sets: { doc: PatchDoc; asNew: boolean }[] = [];
  const host: PatchHost = {
    core,
    geometry: GATE_GEOMETRY,
    getPatch: () => doc,
    async setPatch(next, asNew) {
      doc = { ...next, id: asNew || !doc ? `p${++ids}` : doc.id };
      sets.push({ doc, asNew });
      return { doc, error: null };
    },
    linkBase: "https://example.org/playground",
  };
  return { host, sets, current: () => doc };
}

const SIMPLE: PatchDoc = {
  format: 5,
  id: "",
  name: "Simple",
  description: "",
  nodes: [
    { id: "bow", kind: "rainbow", name: "", params: {}, pos: [0, 0] },
    { id: "out", kind: "output", name: "", params: {}, pos: [0, 0] },
  ],
  edges: [{ from: { node: "bow", port: "out" }, to: { node: "out", port: "in" } }],
  exposed: [],
};

describe("agentGuide", () => {
  test("documents every node type, every shape, and the Code node", () => {
    const guide = agentGuide(core, { playground: "https://example.org/playground" });
    for (const t of core.registry) expect(guide).toContain(`### \`${t.id}\``);
    for (const s of core.shapes) expect(guide).toContain(`**\`${s.id}\`**`);
    expect(guide).toContain("## The Code node");
    expect(guide).toContain("`c.theta`");
    expect(guide).toContain("hsv2rgb");
    // Internals a body must not call are left out.
    expect(guide).not.toContain("`finish(");
    expect(guide).toContain("#patch=");
  });

  test("its examples are patches the core accepts", () => {
    const guide = agentGuide(core);
    const blocks = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const [doc, codeNode] = blocks as [PatchDoc, PatchDoc["nodes"][number]];
    expect(core.validate(core.migrate(doc))).toEqual([]);
    // The Code node example, wired into an Output.
    const withCode: PatchDoc = {
      ...SIMPLE,
      nodes: [codeNode, SIMPLE.nodes[1]!],
      edges: [{ from: { node: codeNode.id, port: "out" }, to: { node: "out", port: "in" } }],
    };
    expect(core.validate(core.migrate(withCode))).toEqual([]);
  });

  test("brief leaves the node reference out", () => {
    expect(agentGuide(core, { brief: true })).not.toContain("## Node reference");
  });
});

describe("createPatchApi", () => {
  test("a new patch opens as new; the open one, read and changed, replaces itself", async () => {
    const { host, sets } = memoryHost();
    const api = createPatchApi(host);
    const first = await api.setPatch(SIMPLE);
    expect(first).toEqual({ ok: true, errors: [], runtimeError: null, id: "p1" });
    expect(sets[0]!.asNew).toBe(true);
    // Positions all [0, 0]: laid out for the person.
    expect(sets[0]!.doc.nodes[0]!.pos[0]).toBeLessThan(sets[0]!.doc.nodes[1]!.pos[0]);

    const open = api.getPatch()!;
    await api.setPatch({ ...open, name: "Renamed" });
    expect(sets[1]!.asNew).toBe(false);
    // Someone else's document (another id) never overwrites it.
    await api.setPatch({ ...open, id: "elsewhere" });
    expect(sets[2]!.asNew).toBe(true);
  });

  test("an invalid patch is refused with the core's reasons and changes nothing", async () => {
    const { host, sets } = memoryHost();
    const api = createPatchApi(host);
    const r = await api.setPatch({ ...SIMPLE, nodes: [...SIMPLE.nodes, { id: "x", kind: "nope", name: "", params: {}, pos: [0, 0] }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("nope");
    expect(sets).toHaveLength(0);
  });

  test("edit applies operations to the open patch", async () => {
    const { host, current } = memoryHost({ ...SIMPLE, id: "p0" });
    const api = createPatchApi(host);
    const r = await api.edit([{ op: "set_params", node: "bow", params: { turns: 3 } }]);
    expect(r.ok).toBe(true);
    expect(current()!.nodes[0]!.params.turns).toBe(3);
    expect(current()!.id).toBe("p0");
  });

  test("pictures are left out of get_patch and kept when sent back", async () => {
    const media = "data:image/png;base64," + "A".repeat(1000);
    const withImage: PatchDoc = {
      ...SIMPLE,
      id: "p0",
      nodes: [...SIMPLE.nodes, { id: "img", kind: "image_in", name: "", params: {}, pos: [0, 0], media }],
    };
    const { host, current } = memoryHost(withImage);
    const api = createPatchApi(host);
    const read = api.getPatch()!;
    expect(read.nodes[2]!.media).toMatch(/^kept:\d+ bytes$/);
    await api.setPatch({ ...read, name: "Still has its picture" });
    expect(current()!.nodes[2]!.media).toBe(media);
  });

  test("presets, node types and descriptions", () => {
    const api = createPatchApi(memoryHost().host);
    expect(api.presets().map((p) => p.name)).toContain("Rainbow Sparkle");
    expect(api.preset("rainbow sparkle").name).toBe("Rainbow Sparkle");
    expect(() => api.preset("nope")).toThrow("no preset");
    const types = api.nodeTypes("generator");
    expect(types.length).toBeGreaterThan(5);
    expect(types.every((t) => t.description.length > 0)).toBe(true);
    expect(api.describe(["rainbow"])[0]!.params.length).toBeGreaterThan(0);
  });
});

describe("patchTools", () => {
  test("every tool answers in MCP's shape, errors included", async () => {
    const api = createPatchApi(memoryHost().host);
    const tools = patchTools(api);
    const names = tools.map((t) => t.name);
    expect(names).toContain("share_link");
    // Nothing renders in this host.
    expect(names).not.toContain("snapshot");
    const byName = new Map(tools.map((t) => [t.name, t]));
    const guide = await byName.get("get_guide")!.execute({ brief: true });
    expect(guide.content[0]!.type).toBe("text");
    const bad = await byName.get("describe_node_types")!.execute({ kinds: ["nope"] });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain('no node type \\"nope\\"');
    const valid = await byName.get("validate_patch")!.execute({ patch: JSON.stringify(SIMPLE) });
    expect(JSON.parse((valid.content[0] as { text: string }).text)).toEqual([]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe("object");
    }
  });
});
