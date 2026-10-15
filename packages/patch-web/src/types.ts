// The patch document model and node palette, as JSON. Mirrors
// crates/empyrean-patch (PatchDoc in lib.rs, palette_json in registry.rs);
// the desktop app re-exports these from src/types.ts.

export type PatchShape =
  | "scalar"
  | "event"
  | "field_scalar"
  | "field_color"
  | "points"
  | "effects"
  | "texture"
  | "pixels";

export interface PatchPortDef {
  name: string;
  shape: PatchShape;
}

export interface PatchParamDef {
  name: string;
  label: string;
  min: number;
  max: number;
  default: number;
  integrate: boolean;
  kind: "number" | { select: string[] };
}

/** One palette entry from the node registry (`GET /patch/registry` on the
 * gate, `registry()` in the wasm build). */
export interface PatchNodeType {
  id: string;
  label: string;
  category: "input" | "scalar" | "generator" | "field" | "combine" | "texture" | "sink";
  inputs: PatchPortDef[];
  outputs: PatchPortDef[];
  params: PatchParamDef[];
}

export interface PatchNode {
  id: string;
  kind: string;
  name: string;
  params: Record<string, number>;
  pos: [number, number];
}

export interface PatchPortRef {
  node: string;
  port: string;
}

export interface PatchEdge {
  from: PatchPortRef;
  to: PatchPortRef;
}

export interface PatchExposedParam {
  node: string;
  param: string;
  label: string;
}

export interface PatchDoc {
  format: number;
  id: string;
  name: string;
  description: string;
  nodes: PatchNode[];
  edges: PatchEdge[];
  exposed: PatchExposedParam[];
}

export interface PatchSummary {
  id: string;
  name: string;
  description: string;
  nodes: number;
}

/** Wire-compat rule — mirrors Shape::accepts in Rust: exact match plus the
 * two blessed adapters (Scalar→Field<f32>, Field<f32>→Field<color>). */
export function shapeAccepts(into: PatchShape, from: PatchShape): boolean {
  return (
    into === from ||
    (from === "scalar" && into === "field_scalar") ||
    (from === "field_scalar" && into === "field_color")
  );
}
