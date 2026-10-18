// Node-graph patch editor (React Flow canvas), shared by the gate app and the
// browser playground. Where patches live and what runs them is the host's
// business: it hands in a PatchStore (list/get/save/delete/activate), the node
// palette (generated from the Rust registry, so the editor can never offer a
// node codegen doesn't understand), presets, and optionally a MiniSource for
// the live node thumbnails and meters.

import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
  type OnConnectEnd,
  type OnConnectStart,
  Panel,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./editor.css";
import { arrangeDoc, DEFAULT_SIZE, type NodeSize } from "./arrange";
import { ClipPicker } from "./ClipPicker";
import { CodePanel } from "./CodePanel";
import { combinerFor, freeSpot, insertCombiner, type Combiner, type PortRef } from "./combine";
import { NodeContext, type WireDrag } from "./context";
import { SHAPE_LABEL, suggestConnections, type Suggestion } from "./connect";
import { imageFileToMedia } from "./files";
import { History } from "./history";
import { MiniMeter, MiniRing, type MiniSource } from "./minis";
import {
  CODE_KIND,
  codeInputs,
  codeOutputs,
  codeParams,
  codeTier,
  defaultCode,
  PATCH_FORMAT,
  type CodeReference,
  SUBPATCH_KIND,
  shapeAccepts,
  subpatchPorts,
  type PatchDoc,
  type PatchNode,
  type PatchNodeType,
  type PatchParamDef,
  type PatchShape,
  type PatchSummary,
} from "../types";

/** Where patches live. Requests are fire-and-forget; answers arrive as
 * events, which is how the gate's WebSocket protocol works and costs a local
 * store nothing. */
export interface PatchStore {
  /** Ask for the library; answered by a `patches` event. */
  list(): void;
  /** Ask for one patch; answered by a `patch` event. */
  get(id: string): void;
  /** Save; a patch with a blank id is created, and the store answers with a
   * `patch` event carrying the id it assigned. */
  save(doc: PatchDoc): void;
  remove(id: string): void;
  /** Make a patch the one rendering (null: none). */
  activate(id: string | null): void;
  subscribe(listener: (event: PatchStoreEvent) => void): () => void;
}

export type PatchStoreEvent =
  | { type: "patches"; patches: PatchSummary[] }
  | { type: "patch"; patch: PatchDoc }
  /** Someone played an exposed param elsewhere (a phone's Control tab). */
  | { type: "param"; node: string; param: string; value: number };

export interface PatchEditorProps {
  store: PatchStore;
  /** The node palette; null while loading. */
  registry: PatchNodeType[] | null;
  presets: PatchDoc[];
  /** What a Code node body may use (`core.codeReference` in the playground,
   * `GET /patch/code-reference` on the gate): completion and hover docs.
   * Without it the body editor still completes ports, keywords and WGSL. */
  codeReference?: CodeReference | null;
  /** "Convert to Code": the host turns node `id` of `doc` into a Code node
   * (the patch core does it: `core.convertToCode` in the playground,
   * `POST /patch/convert-to-code` on the gate). Offered on the panel of
   * every kind the palette marks `convertible` when this is given. */
  convertToCode?: (doc: PatchDoc, id: string) => Promise<PatchDoc>;
  /** The store is reachable (the gate: WebSocket connected). */
  ready: boolean;
  /** The patch rendering right now: its nodes get live thumbnails/meters. */
  activeId: string | null;
  /** The renderer's verdict on the active patch. */
  status?: { active: boolean; error: string | null } | null;
  canEdit: boolean;
  /** Shown when `canEdit` is false. */
  readOnlyHint?: string;
  /** Live per-node thumbnails and meters for the active patch. */
  minis?: MiniSource | null;
  /** Show Activate/Deactivate (hosts that always render the open patch don't). */
  showActivate?: boolean;
  /** Called with every edit as it happens (saves are debounced). */
  onDocChange?: (doc: PatchDoc | null) => void;
  /** Extra toolbar controls, given the open document. `open` loads a document
   * into the editor; `asNew` blanks its id so saving creates a copy. */
  toolbarExtra?: (ctx: {
    doc: PatchDoc | null;
    open: (doc: PatchDoc, asNew?: boolean) => void;
  }) => ReactNode;
  /** Host-specific settings shown in a node's side panel (e.g. where a
   * Video in's picture comes from on this host). */
  nodeExtras?: (node: PatchNode) => ReactNode;
  /** The gate's controls that act on the whole patch from outside it (master
   * brightness and speed). Shown as a card pinned in the canvas, so the graph
   * never hides what else shapes the picture. */
  globals?: GlobalControl[];
  /** One line under the globals, saying where they come from on this host. */
  globalsNote?: ReactNode;
  /** Drive the editor from outside (an agent's tools): see `PatchEditorHandle`. */
  editorRef?: Ref<PatchEditorHandle>;
}

/** The editor, driven from outside: what a host's agent tools act through,
 * so an agent's change lands where the person is looking and is one step of
 * their undo history like any of their own. */
export interface PatchEditorHandle {
  /** The document open in the editor, with edits not yet saved. */
  doc(): PatchDoc | null;
  /** Open a document as the person's Open would (clears undo history);
   * `asNew` blanks its id so saving creates a copy. */
  open(doc: PatchDoc, asNew?: boolean): void;
  /** Replace the open document's contents (keeping its id) as one undoable
   * edit, saved like any other. Opens it as new when nothing is open. */
  replace(doc: PatchDoc): void;
  /** Lay the graph out, as the Arrange button does. */
  arrange(): void;
}

/** One global the host exposes in the editor's canvas. */
export interface GlobalControl {
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** The value as shown ("80%", "1.5×"); defaults to two decimals. */
  format?: (value: number) => string;
  /** Omit on a host that can only read it: the row is then a readout. */
  onChange?: (value: number) => void;
}

function formatGlobal(c: GlobalControl): string {
  return c.format ? c.format(c.value) : c.value.toFixed(2);
}

/** The globals card: a head that toggles it, then one slider per global. It
 * sits inside React Flow as a Panel, so it keeps its corner while the graph
 * pans and zooms; `nodrag nopan nowheel` keep the sliders' own gestures. */
function GlobalsCard({
  controls,
  note,
  open,
  onToggle,
}: {
  controls: GlobalControl[];
  note?: ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const summary = controls.map((c) => `${c.label} ${formatGlobal(c)}`).join(" · ");
  return (
    <Panel position="bottom-right" className={`patch-globals nodrag nopan nowheel ${open ? "open" : ""}`}>
      <button
        type="button"
        className="patch-globals-head"
        aria-expanded={open}
        aria-label={open ? "Hide the gate's globals" : `Gate globals: ${summary}. Show them`}
        onClick={onToggle}
      >
        <span className="patch-globals-title">Gate globals</span>
        {!open && <span className="patch-globals-summary">{summary}</span>}
        <span className="patch-globals-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="patch-globals-body">
          {controls.map((c) => (
            <label key={c.name} className="patch-global">
              <span className="patch-global-label">{c.label}</span>
              <input
                type="range"
                min={c.min}
                max={c.max}
                step={c.step ?? 0.01}
                value={c.value}
                disabled={!c.onChange}
                onChange={(e) => c.onChange?.(Number(e.target.value))}
              />
              <output className="patch-param-value">{formatGlobal(c)}</output>
            </label>
          ))}
          {note && <p className="hint patch-globals-note">{note}</p>}
        </div>
      )}
    </Panel>
  );
}


const CATEGORY_LABELS: Record<PatchNodeType["category"], string> = {
  input: "Inputs",
  scalar: "Scalar ops",
  generator: "Generators",
  field: "Field ops",
  combine: "Combine",
  texture: "Texture",
  sink: "Output",
  code: "Code",
};

const CATEGORY_ORDER: PatchNodeType["category"][] = [
  "input",
  "scalar",
  "generator",
  "field",
  "combine",
  "texture",
  "code",
  "sink",
];

type Registry = Map<string, PatchNodeType>;

/** All connectable input ports of a node type: shaped inputs, then every
 * `number` param (knob doubles as a Scalar port). A Sub-patch's ports come
 * from the instance: one per exposed knob of its document. */
function inputPorts(def: PatchNodeType, node?: PatchNode): { name: string; shape: PatchShape }[] {
  if (def.id === SUBPATCH_KIND) {
    return subpatchPorts(node).map((p) => ({ name: p.name, shape: "scalar" as PatchShape }));
  }
  if (def.id === CODE_KIND) return codeInputs(node);
  return [
    ...def.inputs,
    ...def.params
      .filter((p) => p.kind === "number")
      .map((p) => ({ name: p.name, shape: "scalar" as PatchShape })),
  ];
}

/** The output ports of a node: the type's, or for a Code node the instance's
 * declared outputs. */
function outputPorts(def: PatchNodeType, node?: PatchNode): { name: string; shape: PatchShape }[] {
  if (def.id === CODE_KIND) return codeOutputs(node);
  return def.outputs;
}

/** The knobs a node's side panel shows: the type's params, or for a
 * Sub-patch one per exposed inner knob (its range from the inner node's
 * type, its default the inner node's current value); for a Code node its
 * Scalar inputs. */
function panelParams(def: PatchNodeType, node: PatchNode, registry: Registry): PatchParamDef[] {
  if (def.id === CODE_KIND) return codeParams(node);
  if (def.id !== SUBPATCH_KIND) return def.params;
  return subpatchPorts(node).map((port) => {
    const inner = node.sub?.nodes.find((n) => n.id === port.node);
    const innerDef = inner && registry.get(inner.kind)?.params.find((p) => p.name === port.param);
    return {
      name: port.name,
      label: port.label,
      min: innerDef?.min ?? 0,
      max: innerDef?.max ?? 1,
      default: inner?.params[port.param] ?? innerDef?.default ?? 0,
      integrate: innerDef?.integrate ?? false,
      kind: "number",
      description: innerDef?.description,
    };
  });
}

function portShape(
  def: PatchNodeType | undefined,
  port: string,
  dir: "in" | "out",
  node?: PatchNode,
): PatchShape | null {
  if (!def) return null;
  if (dir === "out") return outputPorts(def, node).find((p) => p.name === port)?.shape ?? null;
  return inputPorts(def, node).find((p) => p.name === port)?.shape ?? null;
}

/** The inputs of a node that are knobs (a Number param, a Code node's Scalar
 * input, a Sub-patch's exposed knob) rather than shaped inputs. A minimized
 * node shows a knob's port only while it is wired. */
function knobNames(def: PatchNodeType, node: PatchNode): Set<string> {
  if (def.id === SUBPATCH_KIND) return new Set(subpatchPorts(node).map((p) => p.name));
  if (def.id === CODE_KIND) return new Set(codeParams(node).map((p) => p.name));
  return new Set(def.params.filter((p) => p.kind === "number").map((p) => p.name));
}

/** A second wire, `from` → `to`, into an input that already has one: the
 * combiner that would go in between. Null when the input is free, the wire is
 * the one already there, or nothing combines that shape. */
function combinerAt(d: PatchDoc, registry: Registry, from: PortRef, to: PortRef): Combiner | null {
  const existing = d.edges.find((e) => e.to.node === to.node && e.to.port === to.port);
  if (!existing) return null;
  if (existing.from.node === from.node && existing.from.port === from.port) return null;
  const shapeOf = (ref: PortRef, dir: "in" | "out") => {
    const n = d.nodes.find((x) => x.id === ref.node);
    return portShape(registry.get(n?.kind ?? ""), ref.port, dir, n);
  };
  const into = shapeOf(to, "in");
  const old = shapeOf(existing.from, "out");
  const incoming = shapeOf(from, "out");
  return into && old && incoming ? combinerFor(registry, into, old, incoming) : null;
}

/** About what a minimized node measures (a mini ring, port dots, one line of
 * head), for placing a new combiner before React Flow has measured it. */
const COLLAPSED_SIZE: NodeSize = { width: 96, height: 112 };

/** A new, unused node id in `d`. */
function freshId(d: PatchDoc, taken?: Set<string>): string {
  let i = d.nodes.length + 1;
  while (d.nodes.some((n) => n.id === `n${i}`) || taken?.has(`n${i}`)) i++;
  return `n${i}`;
}

function emptyPatch(): PatchDoc {
  return {
    format: PATCH_FORMAT,
    id: "",
    name: "New patch",
    description: "",
    nodes: [
      { id: "n1", kind: "noise_field", name: "", params: {}, pos: [40, 60] },
      { id: "n2", kind: "output", name: "", params: {}, pos: [420, 120] },
    ],
    edges: [{ from: { node: "n1", port: "out" }, to: { node: "n2", port: "in" } }],
    exposed: [],
  };
}

// --- custom flow node ------------------------------------------------------

type PatchFlowNode = FlowNode<
  {
    node: PatchNode;
    def: PatchNodeType | undefined;
    /** Doc id these nodes belong to — minis only flow for the active patch. */
    docId: string;
    /** Output ports with at least one outgoing wire (meters show these). */
    wiredOut: string[];
    /** Input ports already taken (one wire per input). */
    wiredIn: string[];
  },
  "patch"
>;

/** Output shapes that thumbnail on the ring (the crate's `previewable`). */
const RING_SHAPES: readonly PatchShape[] = [
  "field_color",
  "field_scalar",
  "points",
  "effects",
  "texture",
];

const PatchNodeView = memo(function PatchNodeView({ data, selected }: NodeProps<PatchFlowNode>) {
  const { node, def } = data;
  const { activeId, minis, drag, combines, setCollapsed } = useContext(NodeContext);
  if (!def) {
    return <div className="pnode pnode-unknown">unknown: {node.kind}</div>;
  }
  const ins = inputPorts(def, node);
  // Mini visualizers, per output style: field outputs get a thumbnail laid out
  // like the hardware, and so do the stream and texture sources (Touch
  // strokes, Triggered effects, Event effect, Video in, Still image, Clip),
  // drawn as their default consumer would draw them; scalar outputs get
  // amplitude meters and event outputs a fire strip. Only for the patch that
  // is actually on air — that is the graph the backend is evaluating. A node
  // with a handful of outputs meters them all; a wide one (Audio, Touch, DJ
  // link) meters `out` and whatever is wired, or it would be taller than the
  // canvas.
  const live = minis !== null && data.docId !== "" && activeId === data.docId;
  // The principal output: `out`, or the single output of a source node.
  const outs = outputPorts(def, node);
  const primary = outs.find((p) => p.name === "out") ?? (outs.length === 1 ? outs[0] : undefined);
  const showRing = live && primary !== undefined && RING_SHAPES.includes(primary.shape);
  // A Code node thumbnails every field output: the principal one as the
  // node's own cell, the others by port (`node:<id>:<port>`).
  const rings: { mini: string; label: string }[] =
    live && node.kind === CODE_KIND
      ? outs
          .filter((p) => p.shape === "field_color" || p.shape === "field_scalar")
          .map((p) => ({
            mini: p.name === primary?.name ? `node:${node.id}` : `node:${node.id}:${p.name}`,
            label: p.name,
          }))
      : showRing
        ? [{ mini: `node:${node.id}`, label: node.name || def.label }]
        : [];
  const meterable = outs.filter((p) => p.shape === "scalar" || p.shape === "event");
  const meterPorts = live
    ? meterable.filter(
        (p) => meterable.length <= 4 || p.name === "out" || data.wiredOut.includes(p.name),
      )
    : [];
  // While a wire is being dragged, each port says whether it would take it:
  // a free input of a fitting shape, or a taken one that would put a
  // combiner (a Blend, say) between the two wires.
  const fitClass = (shape: PatchShape, dir: "in" | "out", name: string): string => {
    if (!drag) return "";
    if (drag.node === node.id) return " port-nofit";
    if (dir === "out") return drag.dir === "in" && shapeAccepts(drag.shape, shape) ? " port-fit" : " port-nofit";
    if (drag.dir !== "out" || !shapeAccepts(shape, drag.shape)) return " port-nofit";
    if (!data.wiredIn.includes(name)) return " port-fit";
    return combines(node.id, name) ? " port-fit port-combine" : " port-nofit";
  };
  const portLabel = (p: { name: string; shape: PatchShape }, dir: "in" | "out") =>
    `${p.name} · ${SHAPE_LABEL[p.shape]} ${dir}`;
  const collapseButton = setCollapsed && (
    <button
      type="button"
      className="pnode-collapse nodrag"
      aria-label={node.collapsed ? `Expand ${def.label}` : `Minimize ${def.label}`}
      onClick={(e) => {
        e.stopPropagation();
        setCollapsed(node.id, !node.collapsed);
      }}
    >
      {node.collapsed ? "+" : "−"}
    </button>
  );

  if (node.collapsed) {
    // Minimized: the mini (or, off air, the node's first choice, such as a
    // Blend's mode) between two columns of bare port dots. Shaped inputs
    // always show, knobs only while wired, outputs while wired or principal.
    // The dots are named while a wire is dragged, when it matters which is
    // which; the side panel has the rest.
    const knobs = knobNames(def, node);
    const shownIns = ins.filter((p) => !knobs.has(p.name) || data.wiredIn.includes(p.name));
    const wiredOuts = outs.filter((p) => p === primary || data.wiredOut.includes(p.name));
    const shownOuts = wiredOuts.length > 0 ? wiredOuts : outs.slice(0, 1);
    const choice = def.params.find((p) => p.kind !== "number");
    const choiceLabel =
      choice && choice.kind !== "number"
        ? choice.kind.select[Math.round(node.params[choice.name] ?? choice.default)]
        : undefined;
    // No thumbnail (a number or event output): its meter instead.
    const faceMeter = rings.length === 0 ? meterPorts.find((p) => shownOuts.includes(p)) : undefined;
    const named = drag !== null;
    return (
      <div className={`pnode pnode-collapsed cat-${def.category} ${selected ? "selected" : ""}`}>
        <div className="pnode-head">
          <span className="pnode-title">{node.name || def.label}</span>
          {collapseButton}
        </div>
        <div className="pnode-body">
          <div className="pnode-col">
            {shownIns.map((p) => (
              <div
                key={p.name}
                className={`pnode-port in${fitClass(p.shape, "in", p.name)}`}
                aria-label={portLabel(p, "in")}
              >
                <Handle type="target" position={Position.Left} id={p.name} className={`port-dot shape-${p.shape}`} />
                {named && <span>{p.name}</span>}
              </div>
            ))}
          </div>
          <div className="pnode-face">
            {rings.length > 0 ? (
              <div className="pnode-mini">
                <MiniRing source={minis!} mini={rings[0].mini} label={rings[0].label} />
              </div>
            ) : null}
            {faceMeter && (
              <MiniMeter
                source={minis!}
                mini={`scalar:${node.id}:${faceMeter.name}`}
                label={faceMeter.name}
                kind={faceMeter.shape === "event" ? "event" : "scalar"}
              />
            )}
            {choiceLabel && <span className="pnode-choice">{choiceLabel}</span>}
          </div>
          <div className="pnode-col out">
            {shownOuts.map((p) => (
              <div
                key={p.name}
                className={`pnode-port out${fitClass(p.shape, "out", p.name)}`}
                aria-label={portLabel(p, "out")}
              >
                {named && <span>{p.name}</span>}
                <Handle type="source" position={Position.Right} id={p.name} className={`port-dot shape-${p.shape}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`pnode cat-${def.category} ${selected ? "selected" : ""}`}>
      <div className="pnode-head">
        <span className="pnode-title">
          {def.label}
          {node.name && <span className="pnode-name"> · {node.name}</span>}
        </span>
        {collapseButton}
      </div>
      {rings.length === 1 && (
        <div className="pnode-mini">
          <MiniRing source={minis!} mini={rings[0].mini} label={rings[0].label} />
        </div>
      )}
      {rings.length > 1 && (
        <div className="pnode-minis">
          {rings.map((r) => (
            <div key={r.mini} className="pnode-mini">
              <MiniRing source={minis!} mini={r.mini} label={r.label} />
              <span className="pnode-mini-label">{r.label}</span>
            </div>
          ))}
        </div>
      )}
      {meterPorts.length > 0 && (
        <div className="pnode-meters">
          {meterPorts.map((p) => (
            <MiniMeter
              key={p.name}
              source={minis!}
              mini={`scalar:${node.id}:${p.name}`}
              label={p.name}
              kind={p.shape === "event" ? "event" : "scalar"}
            />
          ))}
        </div>
      )}
      {(node.kind === "image_in" || node.kind === "clip") && (
        <div className="pnode-image">
          {node.media ? (
            <img src={node.media} alt="" />
          ) : (
            <span className="hint">
              {node.kind === "clip" ? "no clip — pick one on the right" : "no image — pick one on the right"}
            </span>
          )}
        </div>
      )}
      {node.kind === SUBPATCH_KIND && (
        <div className="pnode-sub hint">
          {node.sub ? `${node.sub.name || "patch"} · ${node.sub.nodes.length} nodes` : "empty"}
        </div>
      )}
      {node.kind === CODE_KIND && (
        <div className="pnode-code hint">
          {node.code
            ? `${codeTier(node.code)?.toUpperCase() ?? "?"} · ${node.code.body.split("\n").filter((l) => l.trim()).length} lines`
            : "no code"}
        </div>
      )}
      <div className="pnode-body">
        <div className="pnode-col">
          {ins.map((p) => (
            <div
              key={p.name}
              className={`pnode-port in${fitClass(p.shape, "in", p.name)}`}
              aria-label={portLabel(p, "in")}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={p.name}
                className={`port-dot shape-${p.shape}`}
              />
              <span>{p.name}</span>
            </div>
          ))}
        </div>
        <div className="pnode-col out">
          {outs.map((p) => (
            <div
              key={p.name}
              className={`pnode-port out${fitClass(p.shape, "out", p.name)}`}
              aria-label={portLabel(p, "out")}
            >
              <span>{p.name}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={p.name}
                className={`port-dot shape-${p.shape}`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

const NODE_TYPES = { patch: PatchNodeView };

// --- doc <-> flow mapping --------------------------------------------------

function toFlowNodes(doc: PatchDoc, registry: Registry): PatchFlowNode[] {
  return doc.nodes.map((n) => ({
    id: n.id,
    type: "patch" as const,
    position: { x: n.pos[0], y: n.pos[1] },
    data: {
      node: n,
      def: registry.get(n.kind),
      docId: doc.id,
      wiredOut: doc.edges.filter((e) => e.from.node === n.id).map((e) => e.from.port),
      wiredIn: doc.edges.filter((e) => e.to.node === n.id).map((e) => e.to.port),
    },
  }));
}

function edgeId(e: PatchDoc["edges"][number]): string {
  return `${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`;
}

function toFlowEdges(doc: PatchDoc, registry: Registry): FlowEdge[] {
  return doc.edges.map((e) => {
    const from = doc.nodes.find((n) => n.id === e.from.node);
    const def = registry.get(from?.kind ?? "");
    const shape = portShape(def, e.from.port, "out", from) ?? "scalar";
    return {
      id: edgeId(e),
      source: e.from.node,
      sourceHandle: e.from.port,
      target: e.to.node,
      targetHandle: e.to.port,
      className: `pedge shape-${shape}`,
    };
  });
}

// --- side panel ------------------------------------------------------------

/** A Still image node's picture: preview, choose, remove. Stored in the
 * patch itself, so files and submissions carry it. */
function ImagePicker({
  node,
  canEdit,
  onChange,
}: {
  node: PatchNode;
  canEdit: boolean;
  onChange: (mutate: (d: PatchDoc) => void) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const setMedia = (media: string | undefined) =>
    onChange((d) => {
      const n = d.nodes.find((x) => x.id === node.id);
      if (!n) return;
      if (media) n.media = media;
      else delete n.media;
    });
  return (
    <div className="patch-image">
      <span className="patch-param-head">Image</span>
      {node.media ? (
        <img className="patch-image-preview" src={node.media} alt="This node's image" />
      ) : (
        <p className="hint">No image yet.</p>
      )}
      {canEdit && (
        <div className="patch-param-row">
          <label className="patch-image-choose">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setError(null);
                imageFileToMedia(file)
                  .then(setMedia)
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
              }}
            />
            {node.media ? "Replace…" : "Choose image…"}
          </label>
          {node.media && (
            <button type="button" onClick={() => setMedia(undefined)}>
              Remove
            </button>
          )}
        </div>
      )}
      {error && <p className="patch-status error">{error}</p>}
      <p className="hint">Stored in the patch (256×256), so saved files and submissions keep it.</p>
    </div>
  );
}

/** Below this width the editor is "compact": the palette and the node panel
 * become full-size sheets over the canvas instead of columns beside it. */
const COMPACT_MAX_WIDTH = 640;

/** Whether the editor's own box is narrower than COMPACT_MAX_WIDTH. Measured,
 * not a media query: the gate app and the playground give the editor very
 * different shares of the window. */
function useCompact(ref: React.RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setCompact(el.clientWidth < COMPACT_MAX_WIDTH);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return compact;
}

/** Heading of a side panel; as a sheet it also carries the Done button. */
function PanelHead({ title, onClose }: { title: ReactNode; onClose?: () => void }) {
  return (
    <div className="patch-panel-head">
      <h3>{title}</h3>
      {onClose && (
        <button type="button" className="patch-sheet-done" onClick={onClose}>
          Done
        </button>
      )}
    </div>
  );
}

/** A sheet closes on Escape and takes focus when it opens, so a keyboard
 * user lands inside it. */
function useSheet(onClose: (() => void) | undefined) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (onClose) ref.current?.focus({ preventScroll: true });
  }, [onClose]);
  const onKeyDown = onClose
    ? (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }
    : undefined;
  return { ref, onKeyDown, tabIndex: onClose ? -1 : undefined };
}

function ParamPanel({
  doc,
  nodeId,
  registry,
  canEdit,
  onChange,
  onDuplicate,
  extras,
  onClose,
  status,
  codeReference,
  onConvertToCode,
}: {
  doc: PatchDoc;
  nodeId: string;
  registry: Registry;
  canEdit: boolean;
  /** `key` names the control for undo coalescing (a slider drag is one step). */
  onChange: (mutate: (d: PatchDoc) => void, key?: string) => void;
  onDuplicate?: () => void;
  extras?: (node: PatchNode) => ReactNode;
  /** Set when the panel is a sheet (compact layout): shows Done. */
  onClose?: () => void;
  /** The renderer's verdict, for a Code node's error marks. */
  status?: { active: boolean; error: string | null } | null;
  codeReference?: CodeReference | null;
  /** Replace the node with its Code conversion (see `PatchEditorProps`). */
  onConvertToCode?: () => void;
}) {
  const sheet = useSheet(onClose);
  const node = doc.nodes.find((n) => n.id === nodeId);
  const def = node && registry.get(node.kind);
  if (!node || !def) return null;
  const params = panelParams(def, node, registry);

  const wiredInto = (param: string) =>
    doc.edges.find((e) => e.to.node === node.id && e.to.port === param);
  const isExposed = (param: string) =>
    doc.exposed.some((x) => x.node === node.id && x.param === param);

  return (
    <aside
      className={`patch-side ${onClose ? "patch-sheet" : ""}`}
      aria-label={`${def.label} settings`}
      ref={sheet.ref}
      tabIndex={sheet.tabIndex}
      onKeyDown={sheet.onKeyDown}
    >
      <PanelHead title={def.label} onClose={onClose} />
      {def.description && <p className="hint patch-node-about">{def.description}</p>}
      <label className="patch-field">
        <span>Name</span>
        <input
          value={node.name}
          disabled={!canEdit}
          placeholder={def.label}
          onChange={(e) =>
            onChange((d) => {
              const n = d.nodes.find((x) => x.id === nodeId);
              if (n) n.name = e.target.value;
            })
          }
        />
      </label>
      {node.kind === SUBPATCH_KIND && (
        <p className="hint">
          {node.sub
            ? `A copy of "${node.sub.name || "patch"}" (${node.sub.nodes.length} nodes). Its exposed knobs are this node's inputs; to change the inside, edit that patch and insert it again.`
            : "An empty sub-patch renders black. Insert a saved patch or a preset from the palette's Sub-patches group instead."}
        </p>
      )}
      {node.kind === CODE_KIND && (
        <CodePanel
          node={node}
          doc={doc}
          canEdit={canEdit}
          onChange={onChange}
          error={status?.error ?? null}
          reference={codeReference ?? null}
        />
      )}
      {params.map((p) => {
        const value = node.params[p.name] ?? p.default;
        const wire = wiredInto(p.name);
        const set = (v: number) =>
          onChange((d) => {
            const n = d.nodes.find((x) => x.id === nodeId);
            if (n) n.params[p.name] = v;
          }, `${nodeId}.${p.name}`);
        return (
          <div key={p.name} className="patch-param">
            <div className="patch-param-head">
              <span>
                {p.label}
                {p.integrate && <span className="hint"> (rate)</span>}
              </span>
              {p.kind === "number" && (
                <label className="expose-toggle">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={isExposed(p.name)}
                    onChange={(e) =>
                      onChange((d) => {
                        d.exposed = d.exposed.filter(
                          (x) => !(x.node === nodeId && x.param === p.name),
                        );
                        if (e.target.checked) {
                          d.exposed.push({ node: nodeId, param: p.name, label: p.label });
                        }
                      })
                    }
                  />
                  expose
                </label>
              )}
            </div>
            {p.description && <div className="hint patch-param-about">{p.description}</div>}
            {wire ? (
              <div className="hint wired-chip">
                wired from {wire.from.node}.{wire.from.port}
              </div>
            ) : p.kind === "number" ? (
              <div className="patch-param-row">
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={(p.max - p.min) / 200}
                  value={value}
                  disabled={!canEdit}
                  onChange={(e) => set(Number(e.target.value))}
                />
                <span className="patch-param-value">{value.toFixed(2)}</span>
              </div>
            ) : (
              <select
                value={Math.round(value)}
                disabled={!canEdit}
                onChange={(e) => set(Number(e.target.value))}
              >
                {p.kind.select.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      {node.kind === "image_in" && (
        <ImagePicker node={node} canEdit={canEdit} onChange={onChange} />
      )}
      {node.kind === "clip" && (
        <ClipPicker node={node} def={def} canEdit={canEdit} onChange={onChange} />
      )}
      {extras?.(node)}
      {canEdit && def.convertible && onConvertToCode && (
        <button
          type="button"
          onClick={onConvertToCode}
          title="Replace this node with a Code node that does the same thing, to edit from there. Its wires and knobs stay."
        >
          Convert to Code
        </button>
      )}
      {canEdit && node.kind !== "output" && onDuplicate && (
        <button type="button" onClick={onDuplicate}>
          Duplicate{!onClose && <span className="hint"> · Ctrl+D</span>}
        </button>
      )}
      {canEdit && node.kind !== "output" && (
        <button
          className="danger"
          onClick={() =>
            onChange((d) => {
              d.nodes = d.nodes.filter((n) => n.id !== nodeId);
              d.edges = d.edges.filter(
                (e) => e.from.node !== nodeId && e.to.node !== nodeId,
              );
              d.exposed = d.exposed.filter((x) => x.node !== nodeId);
            })
          }
        >
          Delete node
        </button>
      )}
    </aside>
  );
}

// --- palette ---------------------------------------------------------------

type PaletteGroup = { category: string; label: string; types: PatchNodeType[] };

/** A saved patch or a preset the palette offers as a Sub-patch. */
type SubpatchChoice = { id: string; name: string; nodes: number; preset: boolean };

function Palette({
  grouped,
  subpatches,
  onPick,
  onPickSubpatch,
  onClose,
}: {
  grouped: PaletteGroup[];
  subpatches: SubpatchChoice[];
  onPick: (kind: string) => void;
  onPickSubpatch: (choice: SubpatchChoice) => void;
  /** Set when the palette is a sheet (compact layout): shows Done. */
  onClose?: () => void;
}) {
  const sheet = useSheet(onClose);
  return (
    <aside
      className={`patch-palette ${onClose ? "patch-sheet" : ""}`}
      aria-label="Add a node"
      ref={sheet.ref}
      tabIndex={sheet.tabIndex}
      onKeyDown={sheet.onKeyDown}
    >
      {onClose && <PanelHead title="Add a node" onClose={onClose} />}
      {grouped.map((g) => (
        <div key={g.category} className="palette-group">
          <h4>{g.label}</h4>
          <div className="palette-items">
            {g.types.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`palette-item cat-${t.category}`}
                onClick={() => onPick(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {subpatches.length > 0 && (
        <div className="palette-group palette-subpatches">
          <h4>Sub-patches</h4>
          <div className="palette-items">
            {subpatches.map((s) => (
              <button
                key={(s.preset ? "preset:" : "patch:") + s.id}
                type="button"
                className="palette-sub cat-combine"
                title={`Insert a copy of ${s.name} as one node (${s.nodes} nodes inside)`}
                onClick={() => onPickSubpatch(s)}
              >
                {s.name}
                {s.preset && <span className="hint"> · preset</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

/** The compact layout's stand-in for the toolbar: everything about the open
 * patch and the library, behind the patch-name chip on the canvas. */
function MenuSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const sheet = useSheet(onClose);
  return (
    <aside
      className="patch-side patch-sheet patch-menu"
      aria-label="Patch menu"
      ref={sheet.ref}
      tabIndex={sheet.tabIndex}
      onKeyDown={sheet.onKeyDown}
    >
      <PanelHead title="Patch" onClose={onClose} />
      {children}
    </aside>
  );
}

// --- editor ---------------------------------------------------------------

/** "Connect to…": what could take the other end of a wire dropped on empty
 * canvas, best guess first, with a filter box. A popover at the drop point
 * on a wide canvas; a sheet on a phone. Picking adds the node and the wire. */
function ConnectChooser({
  from,
  at,
  suggestions,
  sheet,
  onPick,
  onClose,
}: {
  from: WireDrag & { port: string };
  at: { x: number; y: number };
  suggestions: Suggestion[];
  sheet: boolean;
  onPick: (s: Suggestion) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const panel = useSheet(onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // Outside click closes (the popover only; a sheet has Done).
  useEffect(() => {
    if (sheet) return;
    const away = (e: PointerEvent) => {
      if (!panel.ref.current?.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => window.addEventListener("pointerdown", away), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", away);
    };
  }, [onClose, panel.ref, sheet]);
  const q = filter.trim().toLowerCase();
  const shown = q
    ? suggestions.filter((s) => `${s.type.label} ${s.port}`.toLowerCase().includes(q))
    : suggestions;
  const title = `${from.dir === "out" ? "Send" : "Feed"} ${from.port} (${SHAPE_LABEL[from.shape]}) ${from.dir === "out" ? "to…" : "from…"}`;
  return (
    <aside
      className={`patch-connect ${sheet ? "patch-sheet" : "patch-popover"}`}
      style={sheet ? undefined : { left: at.x, top: at.y }}
      role="dialog"
      aria-label={title}
      ref={panel.ref}
      tabIndex={panel.tabIndex}
      onKeyDown={panel.onKeyDown}
    >
      {sheet ? <PanelHead title={title} onClose={onClose} /> : <h4>{title}</h4>}
      <input
        ref={inputRef}
        type="search"
        placeholder="Filter…"
        aria-label="Filter node types"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0]) onPick(shown[0]);
        }}
      />
      <div className="patch-connect-list">
        {shown.length === 0 && <p className="hint">Nothing takes {SHAPE_LABEL[from.shape]} here.</p>}
        {shown.map((s) => (
          <button
            key={`${s.type.id}.${s.port}`}
            type="button"
            className={`palette-item cat-${s.type.category}`}
            onClick={() => onPick(s)}
            title={
              s.exact
                ? `${s.type.label}: ${s.port} takes ${SHAPE_LABEL[from.shape]}`
                : `${s.type.label}: ${s.port} takes it through an adapter`
            }
          >
            {s.type.label}
            <span className="patch-connect-port">
              {from.dir === "out" ? "→ " : "← "}
              {s.port}
              {s.viaParam ? " (knob)" : ""}
              {s.exact ? "" : " ≈"}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Editor({
  store,
  registry: registryList,
  presets,
  codeReference = null,
  convertToCode,
  ready,
  activeId,
  status,
  canEdit,
  readOnlyHint,
  minis = null,
  showActivate = true,
  onDocChange,
  toolbarExtra,
  nodeExtras,
  globals,
  globalsNote,
  editorRef,
}: PatchEditorProps) {
  const flow = useReactFlow();
  const registry = useMemo<Registry | null>(
    () => (registryList ? new Map(registryList.map((t) => [t.id, t])) : null),
    [registryList],
  );
  const [patches, setPatches] = useState<PatchSummary[]>([]);
  const [doc, setDoc] = useState<PatchDoc | null>(null);
  const [nodes, setNodes] = useState<PatchFlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Compact layout (a phone, or a narrow host column): the palette and the
  // node panel are sheets, opened on purpose and closed with Done.
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const compact = useCompact(rootRef);
  // "menu" is the compact stand-in for the toolbar: open/new/rename/save/
  // delete and the host's extras, behind the patch-name chip on the canvas.
  const [sheet, setSheet] = useState<"palette" | "node" | "menu" | null>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  // The globals card is open on a wide canvas and a one-line chip on a phone,
  // until the user toggles it.
  const [globalsOpen, setGlobalsOpen] = useState<boolean | null>(null);
  // A wire being dragged (ports light up or dim), and the "connect to…"
  // chooser that opens when it is dropped on empty canvas.
  const [drag, setDrag] = useState<WireDrag | null>(null);
  const [chooser, setChooser] = useState<{
    from: WireDrag & { port: string };
    /** Where it was dropped, in canvas pixels (for the popover) and in flow
     * coordinates (for the new node). */
    at: { x: number; y: number };
    flow: { x: number; y: number };
  } | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const registryRef = useRef(registry);
  registryRef.current = registry;
  const requestedId = useRef<string | null>(null);
  /** A saved patch asked for to be inserted as a Sub-patch, not opened. */
  const insertRequestedId = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const history = useRef(new History<PatchDoc>());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  useEffect(() => {
    onDocChangeRef.current?.(doc);
  }, [doc]);

  // A sheet has nothing to show once the layout widens, the node it was for
  // is gone (deleted, or another patch opened), or nothing is selected.
  useEffect(() => {
    if (!compact) setSheet(null);
  }, [compact]);
  // A sheet opening or closing ends any tap sequence: the tap that selected
  // a node before its sheet opened must not pair with the next one.
  useEffect(() => {
    lastTap.current = null;
  }, [sheet]);
  useEffect(() => {
    if (sheet === "node" && !(selectedNode && doc?.nodes.some((n) => n.id === selectedNode))) {
      setSheet(null);
    }
  }, [sheet, selectedNode, doc]);

  /** Compact layout: a second tap on the selected node (or a double-click)
   * opens its settings; a single tap only selects, as on a desktop. */
  const onNodeTap = useCallback(
    (_: unknown, node: PatchFlowNode) => {
      if (!compact) return;
      const now = performance.now();
      const last = lastTap.current;
      lastTap.current = { id: node.id, at: now };
      if (last && last.id === node.id && now - last.at < 400) {
        lastTap.current = null;
        setSelectedNode(node.id);
        setSheet("node");
      }
    },
    [compact],
  );
  const onNodeOpen = useCallback(
    (_: unknown, node: PatchFlowNode) => {
      if (!compact) return;
      setSelectedNode(node.id);
      setSheet("node");
    },
    [compact],
  );

  // The patch list, once the store is reachable.
  useEffect(() => {
    if (ready) store.list();
  }, [ready, store]);

  // Stable (ref-based) so the long-lived message subscription never goes stale.
  const openDoc = useCallback((d: PatchDoc) => {
    history.current.clear();
    setDoc(d);
    setSelectedNode(null);
    setConfirmDelete(false);
    const reg = registryRef.current;
    if (reg) {
      setNodes(toFlowNodes(d, reg));
      setEdges(toFlowEdges(d, reg));
    }
  }, []);

  // Store events.
  useEffect(() => {
    return store.subscribe((msg) => {
      if (msg.type === "patches") {
        setPatches(msg.patches);
      } else if (msg.type === "patch") {
        if (insertRequestedId.current === msg.patch.id) {
          insertRequestedId.current = null;
          insertSubpatchRef.current?.(msg.patch);
        } else if (requestedId.current === msg.patch.id) {
          requestedId.current = null;
          openDoc(msg.patch);
        } else if (docRef.current && docRef.current.id === "") {
          // Save echo for a brand-new patch: adopt the assigned id, keep edits.
          // The nodes on the canvas learn it too: their live thumbnails and
          // meters key on it (a preset copy otherwise showed none until it
          // was reopened).
          const id = msg.patch.id;
          setDoc((d) => (d && d.id === "" ? { ...d, id } : d));
          setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, docId: id } })));
        }
      } else if (msg.type === "param") {
        // Someone played an exposed param (Control tab, possibly on a phone):
        // reflect it in the open doc so the side panel doesn't go stale.
        setDoc((d) => {
          if (!d) return d;
          const n = d.nodes.find((x) => x.id === msg.node);
          if (!n || n.params[msg.param] === msg.value) return d;
          const next = structuredClone(d);
          next.nodes.find((x) => x.id === msg.node)!.params[msg.param] = msg.value;
          return next;
        });
      }
    });
  }, [store, openDoc]);

  // Reopen the live patch when returning to this tab. Subscribe first so a
  // fast local response cannot arrive before the editor is listening.
  useEffect(() => {
    if (!ready || !activeId || docRef.current || requestedId.current) return;
    requestedId.current = activeId;
    store.get(activeId);
  }, [activeId, store, ready]);

  // Registry may arrive after the doc was opened.
  useEffect(() => {
    if (registry && docRef.current) {
      setNodes(toFlowNodes(docRef.current, registry));
      setEdges(toFlowEdges(docRef.current, registry));
    }
  }, [registry]);

  const scheduleSave = useCallback(
    (d: PatchDoc) => {
      if (!canEdit) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        store.save(d);
      }, 600);
    },
    [canEdit, store],
  );

  /** All document mutations funnel through here: clone, mutate, sync, save.
   * `key` names the control being changed so a run of edits on one knob is
   * a single undo step. */
  const mutateDoc = useCallback(
    (mutate: (d: PatchDoc) => void, resync = true, key?: string) => {
      setDoc((prev) => {
        if (!prev) return prev;
        history.current.push(prev, key);
        const next: PatchDoc = structuredClone(prev);
        mutate(next);
        scheduleSave(next);
        if (resync && registry) {
          setNodes(toFlowNodes(next, registry));
          setEdges(toFlowEdges(next, registry));
        }
        return next;
      });
    },
    [registry, scheduleSave],
  );

  /** Show another snapshot of the open document (undo/redo). */
  const restoreDoc = useCallback(
    (d: PatchDoc) => {
      setDoc(d);
      scheduleSave(d);
      if (registry) {
        setNodes(toFlowNodes(d, registry));
        setEdges(toFlowEdges(d, registry));
      }
      setSelectedNode((sel) => (sel && d.nodes.some((n) => n.id === sel) ? sel : null));
    },
    [registry, scheduleSave],
  );
  const undo = useCallback(() => {
    const cur = docRef.current;
    if (!cur || !canEdit) return;
    const prev = history.current.undo(cur);
    if (prev) restoreDoc(prev);
  }, [canEdit, restoreDoc]);
  const redo = useCallback(() => {
    const cur = docRef.current;
    if (!cur || !canEdit) return;
    const next = history.current.redo(cur);
    if (next) restoreDoc(next);
  }, [canEdit, restoreDoc]);

  /** Lay the graph out left to right by its wires: one undo step, then the
   * view fits the result. Deterministic for a given document (see arrange.ts). */
  const arrangeNodes = useCallback(() => {
    const cur = docRef.current;
    if (!cur || !canEdit) return;
    const sizes = new Map<string, NodeSize>();
    for (const n of flow.getNodes()) {
      if (n.measured?.width && n.measured?.height) {
        sizes.set(n.id, { width: n.measured.width, height: n.measured.height });
      }
    }
    const placed = arrangeDoc(cur, sizes);
    mutateDoc(
      (d) => {
        for (const n of d.nodes) {
          const p = placed.get(n.id);
          if (p) n.pos = p;
        }
      },
      true,
      "arrange",
    );
    // On a phone this comes from the menu sheet: close it to show the result.
    setSheet(null);
    requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 250 }));
  }, [canEdit, flow, mutateDoc]);

  /** Copy the selected nodes (or `ids`) with the wires between them, offset
   * a little, and select the copies. */
  const duplicateNodes = useCallback(
    (ids?: string[]) => {
      if (!canEdit) return;
      const chosen = ids ?? nodesRef.current.filter((n) => n.selected).map((n) => n.id);
      if (chosen.length === 0) return;
      const copies = new Map<string, string>();
      mutateDoc((d) => {
        const taken = new Set<string>();
        for (const id of chosen) {
          const n = d.nodes.find((x) => x.id === id);
          if (!n || n.kind === "output") continue;
          const copy = structuredClone(n);
          copy.id = freshId(d, taken);
          taken.add(copy.id);
          copy.pos = [n.pos[0] + 40, n.pos[1] + 40];
          copies.set(id, copy.id);
          d.nodes.push(copy);
        }
        for (const e of [...d.edges]) {
          const from = copies.get(e.from.node);
          const to = copies.get(e.to.node);
          if (from && to) {
            d.edges.push({ from: { node: from, port: e.from.port }, to: { node: to, port: e.to.port } });
          }
        }
      });
      const fresh = new Set(copies.values());
      if (fresh.size > 0) {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: fresh.has(n.id) })));
        setSelectedNode(fresh.size === 1 ? [...fresh][0] : null);
      }
    },
    [canEdit, mutateDoc],
  );

  // Keyboard: undo/redo/duplicate, anywhere in the page except text fields.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !docRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      } else if (k === "d") {
        e.preventDefault();
        duplicateNodes();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, undo, redo, duplicateNodes]);

  // --- flow event handlers ---

  const onNodesChange = useCallback(
    (changes: NodeChange<PatchFlowNode>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      // Moving the selection from one node to another arrives as one batch
      // (old deselected, new selected, in either order): the selection wins
      // over the deselection, or the panel closes on every switch.
      let next: string | null | undefined;
      for (const ch of changes) {
        if (ch.type !== "select") continue;
        if (ch.selected) next = ch.id;
        else if (next === undefined) next = null;
      }
      if (next !== undefined) setSelectedNode(next);
    },
    [],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: PatchFlowNode) => {
      mutateDoc((d) => {
        const n = d.nodes.find((x) => x.id === node.id);
        if (n) n.pos = [Math.round(node.position.x), Math.round(node.position.y)];
      }, false);
    },
    [mutateDoc],
  );

  const isValidConnection = useCallback(
    (conn: FlowEdge | Connection) => {
      const d = docRef.current;
      if (!d || !registry || !conn.source || !conn.target) return false;
      if (!conn.sourceHandle || !conn.targetHandle) return false;
      const source = d.nodes.find((n) => n.id === conn.source);
      const target = d.nodes.find((n) => n.id === conn.target);
      const from = portShape(registry.get(source?.kind ?? ""), conn.sourceHandle, "out", source);
      const into = portShape(registry.get(target?.kind ?? ""), conn.targetHandle, "in", target);
      if (!from || !into || !shapeAccepts(into, from)) return false;
      // One wire per input; a second one into a taken input is fine when a
      // combiner can go between them (onConnect puts it there).
      const taken = d.edges.some((e) => e.to.node === conn.target && e.to.port === conn.targetHandle);
      return (
        !taken ||
        combinerAt(
          d,
          registry,
          { node: conn.source, port: conn.sourceHandle },
          { node: conn.target, port: conn.targetHandle },
        ) !== null
      );
    },
    [registry],
  );

  /** Where a combiner for input `to` goes: just left of that input, level
   * with its port, in the first spot no node covers. */
  const combinerSpot = useCallback(
    (to: PortRef): [number, number] => {
      const target = flow.getInternalNode(to.node);
      if (!target) return [0, 0];
      const at = target.internals.positionAbsolute;
      const handle = target.internals.handleBounds?.target?.find((h) => h.id === to.port);
      const y = handle ? at.y + handle.y + handle.height / 2 - COLLAPSED_SIZE.height / 2 : at.y;
      const taken = flow.getNodes().map((n) => ({
        x: n.position.x,
        y: n.position.y,
        width: n.measured?.width ?? DEFAULT_SIZE.width,
        height: n.measured?.height ?? DEFAULT_SIZE.height,
      }));
      return freeSpot([at.x - COLLAPSED_SIZE.width - 48, y], COLLAPSED_SIZE, taken);
    },
    [flow],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const d = docRef.current;
      if (!canEdit || !d || !registry || !conn.sourceHandle || !conn.targetHandle) return;
      const from = { node: conn.source, port: conn.sourceHandle };
      const to = { node: conn.target, port: conn.targetHandle };
      const combiner = combinerAt(d, registry, from, to);
      if (!combiner) {
        mutateDoc((doc) => {
          doc.edges.push({ from, to });
        });
        return;
      }
      // A second wire into a taken input: a combiner between the two, as one
      // undo step, selected so its mode and amount are in the side panel.
      const id = freshId(d);
      const pos = combinerSpot(to);
      mutateDoc((doc) => {
        insertCombiner(doc, to, from, combiner, id, pos);
      });
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      setSelectedNode(id);
    },
    [canEdit, combinerSpot, mutateDoc, registry],
  );

  /** For node views: would the wire being dragged combine into this taken input? */
  const combines = useCallback(
    (node: string, port: string) => {
      const d = docRef.current;
      if (!d || !registry || !drag || drag.dir !== "out") return false;
      return combinerAt(d, registry, { node: drag.node, port: drag.port }, { node, port }) !== null;
    },
    [drag, registry],
  );

  const setCollapsed = useCallback(
    (id: string, collapsed: boolean) => {
      mutateDoc((d) => {
        const n = d.nodes.find((x) => x.id === id);
        if (!n) return;
        if (collapsed) n.collapsed = true;
        else delete n.collapsed;
      });
    },
    [mutateDoc],
  );

  // Dragging a wire: remember where it started so ports can show whether they
  // fit, and if it is dropped on empty canvas, offer what could go there.
  const onConnectStart = useCallback<OnConnectStart>(
    (_e, p) => {
      const d = docRef.current;
      if (!d || !registry || !p.nodeId || !p.handleId || !p.handleType) return;
      const node = d.nodes.find((n) => n.id === p.nodeId);
      const dir = p.handleType === "source" ? "out" : "in";
      const shape = portShape(registry.get(node?.kind ?? ""), p.handleId, dir, node);
      if (shape) setDrag({ node: p.nodeId, port: p.handleId, shape, dir });
      setChooser(null);
    },
    [registry],
  );
  const onConnectEnd = useCallback<OnConnectEnd>(
    (e, state) => {
      const from = drag;
      setDrag(null);
      if (!canEdit || !from || state.toHandle || !state.fromHandle?.id) return;
      const canvas = canvasRef.current?.getBoundingClientRect();
      const point = "changedTouches" in e ? e.changedTouches[0] : e;
      if (!canvas || !point) return;
      // The popover is 240 wide and up to 60% tall: keep it on the canvas.
      const at = {
        x: Math.max(0, Math.min(point.clientX - canvas.left, canvas.width - 256)),
        y: Math.max(0, Math.min(point.clientY - canvas.top, canvas.height * 0.4)),
      };
      setChooser({
        from: { ...from, port: state.fromHandle.id },
        at,
        flow: flow.screenToFlowPosition({ x: point.clientX, y: point.clientY }),
      });
    },
    [canEdit, drag, flow],
  );
  /** The chooser's pick: a new node of that type at the drop point, wired. */
  const connectNew = useCallback(
    (s: Suggestion) => {
      const c = chooser;
      setChooser(null);
      setSheet(null);
      if (!c || !canEdit) return;
      mutateDoc((d) => {
        const id = freshId(d);
        // Land the node so the wire meets it where the pointer let go: its
        // left edge for an input, roughly its right edge for an output.
        const x = Math.round(c.from.dir === "out" ? c.flow.x : c.flow.x - 180);
        d.nodes.push({ id, kind: s.type.id, name: "", params: {}, pos: [x, Math.round(c.flow.y - 20)] });
        d.edges.push(
          c.from.dir === "out"
            ? { from: { node: c.from.node, port: c.from.port }, to: { node: id, port: s.port } }
            : { from: { node: id, port: s.port }, to: { node: c.from.node, port: c.from.port } },
        );
      });
    },
    [canEdit, chooser, mutateDoc],
  );
  const suggestions = useMemo(
    () => (chooser && registry ? suggestConnections(registry.values(), chooser.from) : []),
    [chooser, registry],
  );

  const onNodesDelete = useCallback(
    (deleted: PatchFlowNode[]) => {
      if (!canEdit) return;
      const ids = new Set(deleted.map((n) => n.id));
      mutateDoc((d) => {
        d.nodes = d.nodes.filter((n) => !ids.has(n.id));
        d.edges = d.edges.filter((e) => !ids.has(e.from.node) && !ids.has(e.to.node));
        d.exposed = d.exposed.filter((x) => !ids.has(x.node));
      });
    },
    [canEdit, mutateDoc],
  );

  const onEdgesDelete = useCallback(
    (deleted: FlowEdge[]) => {
      if (!canEdit) return;
      const ids = new Set(deleted.map((e) => e.id));
      mutateDoc((d) => {
        d.edges = d.edges.filter((e) => !ids.has(edgeId(e)));
      });
    },
    [canEdit, mutateDoc],
  );

  /** Where a new node lands: the middle of the canvas as shown, not of the
   * window (a host may give the editor one corner of the page). */
  const canvasCenter = useCallback((): [number, number] => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = flow.screenToFlowPosition(
      rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    );
    return [Math.round(center.x), Math.round(center.y)];
  }, [flow]);

  const addNode = useCallback(
    (kind: string) => {
      const pos = canvasCenter();
      mutateDoc((d) => {
        const node: PatchNode = { id: freshId(d), kind, name: "", params: {}, pos };
        // A Code node is nothing without its ports and body.
        if (kind === CODE_KIND) node.code = defaultCode();
        d.nodes.push(node);
      });
    },
    [canvasCenter, mutateDoc],
  );

  /** Add a Sub-patch node holding a copy of `inner`. */
  const insertSubpatch = useCallback(
    (inner: PatchDoc) => {
      const pos = canvasCenter();
      const sub = structuredClone(inner);
      sub.id = "";
      mutateDoc((d) => {
        d.nodes.push({ id: freshId(d), kind: SUBPATCH_KIND, name: "", params: {}, pos, sub });
      });
    },
    [canvasCenter, mutateDoc],
  );
  const insertSubpatchRef = useRef(insertSubpatch);
  insertSubpatchRef.current = insertSubpatch;

  const subpatchChoices = useMemo<SubpatchChoice[]>(() => {
    if (!registry?.has(SUBPATCH_KIND)) return [];
    return [
      ...patches
        .filter((p) => p.id !== doc?.id)
        .map((p) => ({ id: p.id, name: p.name, nodes: p.nodes, preset: false })),
      ...presets.map((p) => ({ id: p.id, name: p.name, nodes: p.nodes.length, preset: true })),
    ];
  }, [registry, patches, presets, doc?.id]);

  // --- toolbar actions ---

  /** Load a document from outside (an import); `asNew` saves it as a copy. */
  const openAs = useCallback(
    (d: PatchDoc, asNew = false) => {
      const copy = structuredClone(d);
      if (asNew) copy.id = "";
      openDoc(copy);
      if (asNew) scheduleSave(copy);
    },
    [openDoc, scheduleSave],
  );

  useImperativeHandle(
    editorRef,
    () => ({
      doc: () => docRef.current,
      open: (d: PatchDoc, asNew = false) => {
        openAs(d, asNew);
        // Read back at once, before the next render catches up.
        docRef.current = { ...structuredClone(d), id: asNew ? "" : d.id };
      },
      replace: (d: PatchDoc) => {
        const cur = docRef.current;
        if (!cur) {
          openAs(d, true);
          docRef.current = { ...structuredClone(d), id: "" };
          return;
        }
        // Wholly: a field the new document leaves out goes, as on Open.
        const next: PatchDoc = { ...structuredClone(d), id: cur.id };
        mutateDoc((c) => {
          for (const key of Object.keys(c)) delete (c as unknown as Record<string, unknown>)[key];
          Object.assign(c, next);
        }, true);
        docRef.current = next;
        setSelectedNode((sel) => (sel && d.nodes.some((n) => n.id === sel) ? sel : null));
      },
      arrange: arrangeNodes,
    }),
    [openAs, mutateDoc, arrangeNodes],
  );

  const isActive = doc !== null && doc.id !== "" && activeId === doc.id;

  const grouped = useMemo(() => {
    if (!registry) return [];
    const byCat = new Map<string, PatchNodeType[]>();
    for (const t of registry.values()) {
      const list = byCat.get(t.category) ?? [];
      list.push(t);
      byCat.set(t.category, list);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      label: CATEGORY_LABELS[c],
      types: byCat.get(c)!,
    }));
  }, [registry]);

  const selectedDef =
    selectedNode && doc && registry
      ? registry.get(doc.nodes.find((n) => n.id === selectedNode)?.kind ?? "")
      : undefined;

  // Toolbar pieces, shared by the wide toolbar and the compact menu sheet.
  const openPreset = (preset: PatchDoc) => {
    // Instantiate a COPY: blank id makes the autosave mint a fresh patch, so
    // the built-in template is never overwritten.
    const copy = structuredClone(preset);
    copy.id = "";
    openDoc(copy);
    scheduleSave(copy);
  };
  const deletePatch = () => {
    if (!doc) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    store.remove(doc.id);
    setDoc(null);
    setNodes([]);
    setEdges([]);
  };
  const nameField = doc && (
    <input
      className="patch-name"
      aria-label="Patch name"
      value={doc.name}
      disabled={!canEdit}
      onChange={(e) => mutateDoc((d) => void (d.name = e.target.value), false)}
    />
  );
  // Who made it, when it came from somewhere else (a playground submission).
  const creditLabel = doc?.credit ? (
    <span className="patch-credit" title="Who sent this pattern">
      by {doc.credit}
    </span>
  ) : null;
  const undoRedo = canEdit && doc && (
    <>
      <button type="button" onClick={undo} disabled={!history.current.canUndo} title="Undo (Ctrl+Z)">
        ↶ Undo
      </button>
      <button type="button" onClick={redo} disabled={!history.current.canRedo} title="Redo (Ctrl+Shift+Z)">
        ↷ Redo
      </button>
    </>
  );
  const arrangeButton = canEdit && doc && (
    <button
      type="button"
      onClick={arrangeNodes}
      disabled={doc.nodes.length < 2}
      title="Lay the graph out left to right by its wires (undoable)"
    >
      ⇆ Arrange
    </button>
  );
  const activateButton = doc && canEdit && showActivate && (
    <button
      type="button"
      className={isActive ? "active" : ""}
      disabled={doc.id === ""}
      onClick={() => store.activate(isActive ? null : doc.id)}
    >
      {isActive ? "■ Deactivate" : "▶ Activate"}
    </button>
  );
  const deleteButton = doc && canEdit && doc.id !== "" && (
    <button type="button" className="danger" onClick={deletePatch}>
      {confirmDelete ? "Really delete?" : "Delete"}
    </button>
  );
  const statusLine = (
    <>
      {status?.error && <span className="patch-status error">⚠ {status.error}</span>}
      {status?.active && !status.error && <span className="patch-status ok">patch rendering</span>}
      {!canEdit && readOnlyHint && <span className="hint">{readOnlyHint}</span>}
    </>
  );

  return (
    <div className={`patch-tab ${compact ? "compact" : ""}`} ref={rootRef}>
      {!compact && (
        <div className="patch-toolbar">
          <select
            aria-label="Open patch"
            value={doc?.id ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              requestedId.current = id;
              store.get(id);
            }}
          >
            <option value="" disabled>
              {patches.length ? "Open patch…" : "No saved patches"}
            </option>
            {patches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.nodes}){p.id === activeId ? " ●" : ""}
              </option>
            ))}
          </select>
          {canEdit && <button onClick={() => openDoc(emptyPatch())}>＋ New</button>}
          {undoRedo}
          {arrangeButton}
          {canEdit && presets.length > 0 && (
            <select
              aria-label="New from preset"
              value=""
              onChange={(e) => {
                const preset = presets.find((p) => p.id === e.target.value);
                if (preset) openPreset(preset);
              }}
            >
              <option value="" disabled>
                New from preset…
              </option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {nameField}
          {creditLabel}
          {activateButton}
          {deleteButton}
          {toolbarExtra?.({ doc, open: openAs })}
          <span className="spacer" />
          {statusLine}
        </div>
      )}

      <NodeContext.Provider
        value={{ activeId, minis, drag, combines, setCollapsed: canEdit ? setCollapsed : null }}
      >
      <div className="patch-main">
        {canEdit && doc && registry && (!compact || sheet === "palette") && (
          <Palette
            grouped={grouped}
            subpatches={subpatchChoices}
            onPick={(kind) => {
              addNode(kind);
              if (compact) setSheet(null);
            }}
            onPickSubpatch={(choice) => {
              if (choice.preset) {
                const preset = presets.find((p) => p.id === choice.id);
                if (preset) insertSubpatch(preset);
              } else {
                insertRequestedId.current = choice.id;
                store.get(choice.id);
              }
              if (compact) setSheet(null);
            }}
            onClose={compact ? () => setSheet(null) : undefined}
          />
        )}

        <div className="patch-canvas" ref={canvasRef}>
          {doc && registry ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              onNodeClick={onNodeTap}
              onNodeDoubleClick={onNodeOpen}
              onConnect={onConnect}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              onNodesDelete={onNodesDelete}
              onEdgesDelete={onEdgesDelete}
              isValidConnection={isValidConnection}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              elementsSelectable
              deleteKeyCode={canEdit ? ["Backspace", "Delete"] : []}
              zoomOnScroll
              zoomOnPinch
              zoomOnDoubleClick={!compact}
              fitView
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
              {globals && globals.length > 0 && (
                <GlobalsCard
                  controls={globals}
                  note={globalsNote}
                  open={globalsOpen ?? !compact}
                  onToggle={() => setGlobalsOpen(!(globalsOpen ?? !compact))}
                />
              )}
            </ReactFlow>
          ) : (
            <div className="patch-empty">
              {registry === null
                ? "Loading node palette…"
                : patches.length
                  ? "Open a patch or create a new one."
                  : canEdit
                    ? "No patches yet — hit ＋ New to start."
                    : "No patches yet. Create one on the Gate machine."}
            </div>
          )}
          {compact && sheet === null && (
            <div className="patch-canvas-chips">
              <button
                type="button"
                className="patch-name-chip"
                onClick={() => setSheet("menu")}
                aria-label={doc ? `Patch: ${doc.name || "Untitled"}. Open the patch menu` : "Open the patch menu"}
              >
                {doc ? doc.name || "Untitled" : patches.length ? "Open patch…" : "Patches"}
                <span aria-hidden="true"> ▾</span>
              </button>
              {status?.error && (
                <button
                  type="button"
                  className="patch-status-chip error"
                  onClick={() => setSheet("menu")}
                  title={status.error}
                  aria-label={`This patch can't run: ${status.error}`}
                >
                  ⚠
                </button>
              )}
              {canEdit && doc && registry && (
                <button
                  type="button"
                  className="patch-add-fab"
                  onClick={() => setSheet("palette")}
                  aria-label="Add node"
                  title="Add node"
                >
                  ＋
                </button>
              )}
            </div>
          )}
          {compact && sheet === null && selectedDef && (
            <button
              type="button"
              className="patch-node-pill"
              onClick={() => setSheet("node")}
              title="Or double-tap the node"
            >
              {selectedDef.label} settings…
            </button>
          )}
          {chooser && (!compact || sheet === null) && (
            <ConnectChooser
              from={chooser.from}
              at={chooser.at}
              suggestions={suggestions}
              sheet={compact}
              onPick={connectNew}
              onClose={() => setChooser(null)}
            />
          )}
        </div>

        {doc && registry && selectedNode && (!compact || sheet === "node") && (
          <ParamPanel
            doc={doc}
            nodeId={selectedNode}
            registry={registry}
            canEdit={canEdit}
            onChange={(mutate, key) => mutateDoc(mutate, true, key)}
            onDuplicate={() => duplicateNodes([selectedNode])}
            extras={nodeExtras}
            onClose={compact ? () => setSheet(null) : undefined}
            status={status}
            codeReference={codeReference}
            onConvertToCode={
              convertToCode
                ? () => {
                    if (!doc) return;
                    void convertToCode(doc, selectedNode)
                      .then((next) =>
                        mutateDoc((d) => {
                          d.nodes = structuredClone(next.nodes);
                          d.edges = structuredClone(next.edges);
                          d.exposed = structuredClone(next.exposed);
                        }),
                      )
                      .catch((err: unknown) => console.error("convert to code:", err));
                  }
                : undefined
            }
          />
        )}

        {compact && sheet === "menu" && (
          <MenuSheet onClose={() => setSheet(null)}>
            {doc && (
              <label className="patch-field">
                <span>Name</span>
                {nameField}
              </label>
            )}
            <div className="patch-menu-status">{statusLine}</div>
            <div className="patch-menu-actions">
              {undoRedo}
              {arrangeButton}
              {activateButton}
              {toolbarExtra?.({
                doc,
                open: (d, asNew) => {
                  openAs(d, asNew);
                  setSheet(null);
                },
              })}
              {deleteButton}
            </div>
            <h4>Open</h4>
            <div className="patch-menu-list">
              {patches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={p.id === doc?.id ? "current" : ""}
                  onClick={() => {
                    requestedId.current = p.id;
                    store.get(p.id);
                    setSheet(null);
                  }}
                >
                  {p.name}
                  <span className="hint">
                    {" "}
                    ({p.nodes}){p.id === activeId ? " ●" : ""}
                  </span>
                </button>
              ))}
              {patches.length === 0 && <p className="hint">No saved patches yet.</p>}
            </div>
            {canEdit && (
              <>
                <h4>New</h4>
                <div className="patch-menu-list">
                  <button
                    type="button"
                    onClick={() => {
                      openDoc(emptyPatch());
                      setSheet(null);
                    }}
                  >
                    ＋ Blank patch
                  </button>
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        openPreset(p);
                        setSheet(null);
                      }}
                    >
                      From preset: {p.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </MenuSheet>
        )}
      </div>
      </NodeContext.Provider>
    </div>
  );
}

export function PatchEditor(props: PatchEditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
