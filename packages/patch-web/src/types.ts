// The patch document model and node palette, as JSON. Mirrors
// crates/empyrean-patch (PatchDoc in lib.rs, palette_json in registry.rs);
// the desktop app re-exports these from src/types.ts.

/** The patch document format this package writes (crate::PATCH_FORMAT).
 * Older documents are upgraded with the patch core's `migrate`. */
export const PATCH_FORMAT = 5;

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
  category: "input" | "scalar" | "generator" | "field" | "combine" | "texture" | "sink" | "code";
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
  /** A Still image node's own picture, or a Clip node's sprite sheet: a
   * 256×256 `data:image/...` URL. */
  media?: string;
  /** A Sub-patch node's own document: its exposed knobs are this node's
   * inputs (named `"{node}.{param}"`, knob values in `params` under the same
   * keys), its Output this node's `out`. */
  sub?: PatchDoc;
  /** A Code node's own ports and body (crate `code::CodeDef`): the declared
   * inputs are its input ports (Scalar ones are knobs too, values in
   * `params`), the declared outputs its output ports. */
  code?: CodeDef;
}

/** One declared port of a Code node. `min`/`max`/`default` matter for a
 * Scalar input, which is a knob like a built-in node's Number param. */
export interface CodePort {
  name: string;
  shape: PatchShape;
  min: number;
  max: number;
  default: number;
}

/** A Code node's interface and body (WGSL; see plans/code-node.md). */
export interface CodeDef {
  inputs: CodePort[];
  outputs: CodePort[];
  body: string;
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
  /** Who made it, when that is not the crew (a playground submission carries
   * the sender's name). Absent for the crew's own patches. */
  credit?: string;
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

/** The node kind that embeds another document (crate `flatten::KIND`). */
export const SUBPATCH_KIND = "subpatch";

/** A Sub-patch node's input ports: one per exposed knob of its document. */
export function subpatchPorts(
  node: PatchNode | undefined,
): { name: string; label: string; node: string; param: string }[] {
  return (node?.sub?.exposed ?? []).map((x) => ({
    name: `${x.node}.${x.param}`,
    label: x.label || `${x.node}.${x.param}`,
    node: x.node,
    param: x.param,
  }));
}

/** A function a Code node body may call (crate `reference::FnRef`). */
export interface CodeFnRef {
  name: string;
  /** `name(params) -> ret`, as written in the shader lib. */
  signature: string;
  doc: string;
}

export interface CodeFieldRef {
  name: string;
  type: string;
  doc: string;
}

/** What a Code node body may use, read off the shader lib and the CPU
 * interpreter by the patch core (`codeReference()` in the wasm build,
 * `GET /patch/code-reference` on the gate). Feeds completion and hover docs. */
export interface CodeReference {
  helpers: CodeFnRef[];
  structs: { name: string; fields: CodeFieldRef[] }[];
  globals: { name: string; type: string; doc: string }[];
  cpu_builtins: CodeFnRef[];
}

/** The node kind whose ports and body live on the instance (crate `code::KIND`). */
export const CODE_KIND = "code";

/** Shapes a Code node's ports may have (the rest need their own binding
 * idiom in the body; a follow-up). */
export const CODE_SHAPES: readonly PatchShape[] = ["scalar", "event", "field_scalar", "field_color"];

/** Longest body the core accepts (crate `code::MAX_CODE_BYTES`). */
export const MAX_CODE_BYTES = 8192;
/** Ports per direction (crate `code::MAX_CODE_PORTS`). */
export const MAX_CODE_PORTS = 16;

/** Where a Code node runs, by its ports — mirrors `CodeDef::tier` in Rust:
 * `"cpu"` when every port is Scalar/Event, `"gpu"` when every output is a
 * field and no input is an Event, otherwise `null` (the core refuses it). */
export function codeTier(def: CodeDef): "cpu" | "gpu" | null {
  const field = (s: PatchShape) => s === "field_scalar" || s === "field_color";
  const control = (s: PatchShape) => s === "scalar" || s === "event";
  if (def.outputs.length === 0) return null;
  for (const p of [...def.inputs, ...def.outputs]) if (!field(p.shape) && !control(p.shape)) return null;
  if (def.outputs.some((p) => field(p.shape))) {
    if (def.outputs.some((p) => !field(p.shape))) return null;
    if (def.inputs.some((p) => p.shape === "event")) return null;
    return "gpu";
  }
  if (def.inputs.some((p) => field(p.shape))) return null;
  return "cpu";
}

/** A Code node's input ports (every declared input). */
export function codeInputs(node: PatchNode | undefined): { name: string; shape: PatchShape }[] {
  return (node?.code?.inputs ?? []).map((p) => ({ name: p.name, shape: p.shape }));
}

/** A Code node's output ports. */
export function codeOutputs(node: PatchNode | undefined): { name: string; shape: PatchShape }[] {
  return (node?.code?.outputs ?? []).map((p) => ({ name: p.name, shape: p.shape }));
}

/** A Code node's knobs: its Scalar inputs, as the side panel and the
 * Control tab show them. */
export function codeParams(node: PatchNode | undefined): PatchParamDef[] {
  return (node?.code?.inputs ?? [])
    .filter((p) => p.shape === "scalar")
    .map((p) => ({
      name: p.name,
      label: p.name,
      min: p.min,
      max: p.max,
      default: p.default,
      integrate: false,
      kind: "number" as const,
    }));
}

/** A port name the core will take: letters, digits and underscores,
 * starting with a letter. (Keywords, builtins and the shader's own names are
 * refused by the core, which says which.) */
export function isPortName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && !name.includes("__") && !name.endsWith("_at");
}

/** What a fresh Code node starts with: a colour field with one knob, and a
 * body that shows the per-pixel context. */
export function defaultCode(): CodeDef {
  return {
    inputs: [{ name: "twist", shape: "scalar", min: 0, max: 4, default: 1 }],
    outputs: [{ name: "out", shape: "field_color", min: 0, max: 1, default: 0 }],
    body: [
      "// This pixel: c.theta (angle, radians), c.r01 (0 = outer end, 1 = inner),",
      "// c.pos (x, y; the outer edge is at 1). G.time is seconds. Set every output.",
      "let hue = fract(c.theta / TAU + c.r01 * twist + G.time * 0.05);",
      "out = vec4f(hsv2rgb(hue, 0.9, 1.0), 1.0);",
      "",
    ].join("\n"),
  };
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
