import { describe, expect, test } from "bun:test";
import { exportPatch, parsePatchFile } from "./files";
import { defaultCode, type PatchDoc } from "../types";

describe("parsePatchFile", () => {
  test("keeps a Code node's ports and body", () => {
    const doc: PatchDoc = {
      format: 5,
      id: "p",
      name: "Code",
      description: "",
      nodes: [{ id: "c", kind: "code", name: "", params: { twist: 2 }, pos: [0, 0], code: defaultCode() }],
      edges: [],
      exposed: [],
    };
    const back = parsePatchFile(exportPatch(doc));
    expect(back.nodes[0]!.code).toEqual(defaultCode());
    expect(back).toEqual(doc);
  });
});
