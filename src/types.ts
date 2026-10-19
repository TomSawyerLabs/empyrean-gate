// The patch document model and node palette, as JSON. Mirrors
// crates/empyrean-patch (PatchDoc in lib.rs, palette_json in registry.rs);
// the desktop app re-exports these from src/types.ts.

/** The patch document format this package writes (crate::PATCH_FORMAT).
 * Older documents are upgraded with the patch core's `migrate`. */
export const PATCH_FORMAT = 7;

export type PatchShape =
  | "scalar"
  | "event"
  | "field_scalar"
  | "field_color"
  | "led_scalar"
  | "led_color"
  | "points"
  | "effects"
  | "texture"
  | "pixels";

/** One wire shape as the patch core's `shapes()` describes it: what flows on
 * such a wire, and which shapes may drive an input of it (`accepts`, the
 * same rule as `shapeAccepts`). */
export interface PatchShapeDef {
  id: PatchShape;
  label: string;
  description: string;
  accepts: PatchShape[];
}

/** A port or param that only applies while a Select param of its node has
 * one of `values` (crate `registry::When`: Random's modes). */
export interface PatchWhen {
  param: string;
  values: number[];
}

export interface PatchPortDef {
  name: string;
  shape: PatchShape;
  /** What the port carries, with units and ranges where they matter.
   * Optional: registries from older gates have none. */
  description?: string;
  /** Only in some modes of its kind; absent: always. */
  when?: PatchWhen;
}

export interface PatchParamDef {
  name: string;
  label: string;
  min: number;
  max: number;
  default: number;
  integrate: boolean;
  kind: "number" | { select: string[] };
  /** What the param does: units, what the ends of the range mean, and for a
   * select what each option does. Optional: older gates send none. */
  description?: string;
  /** Only in some modes of its kind; absent: always. */
  when?: PatchWhen;
}

/** A palette group's id (crate `registry::Group::id`). */
export type PatchGroup =
  | "controls"
  | "live"
  | "media"
  | "shape"
  | "motion"
  | "events"
  | "blocks"
  | "patterns"
  | "color"
  | "draw"
  | "structure";

/** One palette entry from the node registry (`GET /patch/registry` on the
 * gate, `registry()` in the wasm build). */
export interface PatchNodeType {
  id: string;
  label: string;
  /** "Convert to Code" is offered for this kind (crate `convert::convertible`). */
  convertible?: boolean;
  /** The inputs and params a node of this kind repeats per layer (crate
   * `registry::layered`; only Blend has them): layer 1 uses the names as
   * they are, layer k (2..`max`) the name followed by k (`over2`, `mode2`,
   * `opacity2`). The instance's count is `PatchNode.layers`. */
  layered?: { names: string[]; max: number };
  /** The field inputs this kind reads somewhere other than the LED being
   * drawn (crate `registry::sampled_inputs`; Transform's `in`): LED data
   * can't go into them without Resample. Absent when there are none. */
  sampled?: string[];
  category: "input" | "scalar" | "generator" | "field" | "combine" | "texture" | "sink" | "code";
  /** The palette group it is listed under (crate `registry::Group`; labels
   * and order in `groups.ts`). Optional: older gates send none, and
   * `groupOf` falls back on the category. */
  group?: PatchGroup;
  /** What the node does, what its inputs mean, and when to use it (one to
   * three sentences). Optional: older gates send none. */
  description?: string;
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
  /** Where a Sub-patch's `sub` came from: a saved patch's id or a built-in's
   * (`builtin-…`). Absent on an older sub-patch, which is its own copy. */
  source?: string;
  /** The `sub` follows `source` (stores refresh it when that patch is
   * saved) and is read-only here; absent/false: a clone this patch owns. */
  linked?: boolean;
  /** On a clone: `sourceRev` of the source as it was copied, so the editor
   * can offer "Update from …" once the source has moved on. */
  source_rev?: string;
  /** A Code node's own ports and body (crate `code::CodeDef`): the declared
   * inputs are its input ports (Scalar ones are knobs too, values in
   * `params`), the declared outputs its output ports. */
  code?: CodeDef;
  /** A Note node's text: a remark on the canvas, nothing more. */
  text?: string;
  /** Shown minimized in the editor: a mini with port dots, no labels or
   * knobs (purely presentational; left out when false). */
  collapsed?: boolean;
  /** A Blend's number of layers (see `PatchNodeType.layered`); absent
   * means 1, and the crate refuses it on other kinds. */
  layers?: number;
}

/** One declared port of a Code node. `min`/`max`/`default` matter for a
 * Scalar input, which is a knob like a built-in node's Number param. */
export interface CodePort {
  name: string;
  shape: PatchShape;
  min: number;
  max: number;
  default: number;
  /** A Scalar input that is a rate: the engine integrates it into a phase
   * (× master speed), like a built-in node's `speed` knob. GPU tier only. */
  integrate?: boolean;
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
  /** Every node kind it uses, sub-patches' insides included (the patch
   * browser's topics). Older gates send none. */
  kinds?: string[];
  /** Its Sub-patch nodes (the patch browser's tree). */
  subpatches?: SubpatchSummary[];
}

/** A Sub-patch node, as the patch browser lists it. */
export interface SubpatchSummary {
  node: string;
  name: string;
  source?: string;
  linked?: boolean;
  subpatches?: SubpatchSummary[];
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

/** A Sub-patch's inlet and outlet (crate `registry::PATCH_IN_KIND` …):
 * pass-throughs whose shape their `shape` select picks. */
export const PATCH_IN_KIND = "patch_in";
export const PATCH_OUT_KIND = "patch_out";

/** What a Patch in / Patch out's `shape` select picks, by index (crate
 * `registry::BOUNDARY_SHAPES`). */
export const BOUNDARY_SHAPES: readonly PatchShape[] = [
  "field_color",
  "field_scalar",
  "scalar",
  "event",
  "led_color",
  "led_scalar",
];

/** A Patch in or Patch out's shape (both its ports carry it); null for any
 * other node. Mirrors crate `NodeInst::boundary_shape`. */
export function boundaryShape(node: PatchNode | undefined): PatchShape | null {
  if (node?.kind !== PATCH_IN_KIND && node?.kind !== PATCH_OUT_KIND) return null;
  const i = Math.max(0, Math.round(node.params.shape ?? 0));
  return BOUNDARY_SHAPES[Math.min(i, BOUNDARY_SHAPES.length - 1)];
}

/** One port a Sub-patch gains from a Patch in or Patch out inside it: named
 * by that node's id, labelled by its name. */
export interface BoundaryPort {
  name: string;
  label: string;
  shape: PatchShape;
}

function boundaryPorts(node: PatchNode | undefined, kind: string): BoundaryPort[] {
  return (node?.sub?.nodes ?? [])
    .filter((n) => n.kind === kind)
    .map((n) => ({ name: n.id, label: n.name || n.id, shape: boundaryShape(n)! }));
}

/** A Sub-patch node's typed inputs: one per Patch in of its document. */
export function subpatchInlets(node: PatchNode | undefined): BoundaryPort[] {
  return boundaryPorts(node, PATCH_IN_KIND);
}

/** A Sub-patch node's typed outputs: one per Patch out of its document. */
export function subpatchOutlets(node: PatchNode | undefined): BoundaryPort[] {
  return boundaryPorts(node, PATCH_OUT_KIND);
}

/** Whether a Sub-patch offers its picture, `out`: unless its document is a
 * block with Patch outs and no Output (every sub-patch from before Patch
 * outs keeps it). */
export function subpatchHasOut(node: PatchNode | undefined): boolean {
  const nodes = node?.sub?.nodes ?? [];
  return nodes.some((n) => n.kind === "output") || !nodes.some((n) => n.kind === PATCH_OUT_KIND);
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

/** The node kind that turns LED data into the plane (crate
 * `registry::RESAMPLE_KIND`). */
export const RESAMPLE_KIND = "resample";

/** The node kind that is a remark on the canvas (crate `registry::NOTE_KIND`). */
export const NOTE_KIND = "note";

/** Shapes a Code node's inputs may have. Points, Effects and Texture reach
 * a GPU body as `name_count` / `name_at(k)` / `name_on(k)` / `name_at(uv)`. */
export const CODE_INPUT_SHAPES: readonly PatchShape[] = [
  "scalar",
  "event",
  "field_scalar",
  "field_color",
  "led_scalar",
  "led_color",
  "points",
  "effects",
  "texture",
];
/** Shapes a Code node's outputs may have: what a body can make. */
export const CODE_OUTPUT_SHAPES: readonly PatchShape[] = [
  "scalar",
  "event",
  "field_scalar",
  "field_color",
  "led_scalar",
  "led_color",
];
/** @deprecated use CODE_INPUT_SHAPES / CODE_OUTPUT_SHAPES */
export const CODE_SHAPES = CODE_OUTPUT_SHAPES;

/** Longest body the core accepts (crate `code::MAX_CODE_BYTES`). */
export const MAX_CODE_BYTES = 8192;
/** Ports per direction (crate `code::MAX_CODE_PORTS`). */
export const MAX_CODE_PORTS = 16;

/** Where a Code node runs, by its ports — mirrors `CodeDef::tier` in Rust:
 * `"cpu"` when every port is Scalar/Event, `"gpu"` when every output is a
 * field and no input is an Event, otherwise `null` (the core refuses it). */
export function codeTier(def: CodeDef): "cpu" | "gpu" | null {
  const field = isFieldShape;
  const control = (s: PatchShape) => s === "scalar" || s === "event";
  const buffer = (s: PatchShape) => s === "points" || s === "effects" || s === "texture";
  if (def.outputs.length === 0) return null;
  for (const p of def.outputs) if (!field(p.shape) && !control(p.shape)) return null;
  for (const p of def.inputs) if (!field(p.shape) && !control(p.shape) && !buffer(p.shape)) return null;
  if (def.outputs.some((p) => field(p.shape))) {
    if (def.outputs.some((p) => !field(p.shape))) return null;
    if (def.inputs.some((p) => p.shape === "event")) return null;
    return "gpu";
  }
  if (def.inputs.some((p) => field(p.shape) || buffer(p.shape))) return null;
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
      integrate: p.integrate ?? false,
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
 * two blessed adapters (Scalar→grey, grey→colour). Value types only: whether
 * LED data may go in is the domain rule's business (`fitsInput` in
 * editor/domains.ts). */
export function shapeAccepts(into: PatchShape, from: PatchShape): boolean {
  return (
    into === from ||
    (isGreyField(into) && (from === "scalar" || isGreyField(from))) ||
    (isColorField(into) && isFieldShape(from))
  );
}

/** A per-position GPU value: grey or colour, on the plane or the LEDs. */
export function isFieldShape(s: PatchShape): boolean {
  return isGreyField(s) || isColorField(s);
}

export function isGreyField(s: PatchShape): boolean {
  return s === "field_scalar" || s === "led_scalar";
}

export function isColorField(s: PatchShape): boolean {
  return s === "field_color" || s === "led_color";
}

/** LED data: defined only at the gate's physical LEDs. */
export function isLedShape(s: PatchShape): boolean {
  return s === "led_scalar" || s === "led_color";
}

/** The same value type on the LEDs (a field shape; others unchanged). */
export function onLeds(s: PatchShape): PatchShape {
  if (s === "field_scalar") return "led_scalar";
  if (s === "field_color") return "led_color";
  return s;
}

/** The name layer `k` (1-based) gives one of a layered type's repeated
 * inputs or params (crate `registry::layer_name`). */
export function layerName(name: string, k: number): string {
  return k <= 1 ? name : `${name}${k}`;
}

/** How many layers a node has: its `layers` on a layered type (held to
 * 1..max), 1 on anything else (crate `NodeInst::layer_count`). */
export function layerCount(def: PatchNodeType | undefined, node: PatchNode | undefined): number {
  if (!def?.layered) return 1;
  return Math.min(Math.max(Math.round(node?.layers ?? 1), 1), def.layered.max);
}

/** `{ name, k }` when `port` is layer k's copy of one of the type's repeated
 * names (`over3` → `over`, 3; `over` → `over`, 1); null for anything else.
 * Layers past `count` don't exist. */
export function splitLayer(
  def: PatchNodeType | undefined,
  port: string,
  count: number,
): { name: string; k: number } | null {
  for (const name of def?.layered?.names ?? []) {
    if (port === name) return { name, k: 1 };
    const digits = port.startsWith(name) ? port.slice(name.length) : "";
    const k = Number(digits);
    if (/^[1-9][0-9]*$/.test(digits) && k >= 2 && k <= count) return { name, k };
  }
  return null;
}

/** A built-in node's shaped inputs, layer by layer after the type's own
 * (crate `NodeInst::shaped_inputs`). */
export function nodeInputs(def: PatchNodeType, node: PatchNode | undefined): PatchPortDef[] {
  const out = [...def.inputs];
  for (let k = 2; k <= layerCount(def, node); k++) {
    for (const name of def.layered?.names ?? []) {
      const p = def.inputs.find((q) => q.name === name);
      if (p) out.push({ ...p, name: layerName(name, k) });
    }
  }
  return out;
}

/** Whether a port or param of `def` applies to `node` in its current mode
 * (its `when`; crate `registry::applies`). Without a node: at the defaults,
 * as a node just added would be. */
export function applies(p: { when?: PatchWhen }, def: PatchNodeType, node?: PatchNode): boolean {
  if (!p.when) return true;
  const select = def.params.find((q) => q.name === p.when!.param);
  const value = Math.round(node?.params[p.when.param] ?? select?.default ?? 0);
  return p.when.values.includes(value);
}

/** A built-in node's params, layer by layer after the type's own, each
 * labelled for its layer: "Opacity 2" (crate `NodeInst::params_of`). */
export function nodeParams(def: PatchNodeType, node: PatchNode | undefined): PatchParamDef[] {
  const out = [...def.params];
  for (let k = 2; k <= layerCount(def, node); k++) {
    for (const name of def.layered?.names ?? []) {
      const p = def.params.find((q) => q.name === name);
      if (p) out.push({ ...p, name: layerName(name, k), label: `${p.label} ${k}` });
    }
  }
  return out;
}
