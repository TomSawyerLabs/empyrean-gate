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
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type EdgeProps,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
  type OnConnectEnd,
  type OnConnectStart,
  Panel,
  useReactFlow,
  useStore,
  useUpdateNodeInternals,
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
import { fitsInput, isSampledInput, ledNodes } from "./domains";
import { matchScore } from "./search";
import { imageFileToMedia } from "./files";
import { History } from "./history";
import { addLayer, layerFor, layerInput, moveLayer, removeLayer } from "./layers";
import { NodeIcon } from "./icons";
import { MiniMeter, MiniRing, type MiniSource } from "./minis";
import { Palette, PALETTE_DRAG_TYPE, PALETTE_PARAMS_TYPE, type SubpatchChoice } from "./Palette";
import { PanelHead, useSheet } from "./sheet";
import { isBuiltin, linkedSources, snapshot, sourceRev, summarize, summaryLinks, syncLinks } from "./links";
import { cloneAlong, crumbs, docAt, flatId, lockAt, outputMini, sameLocation, unlink, validPath, type EditorLocation } from "./navigation";
import { PatchBrowser } from "./PatchBrowser";
import {
  applies,
  boundaryShape,
  CODE_KIND,
  PATCH_IN_KIND,
  PATCH_OUT_KIND,
  NOTE_KIND,
  codeInputs,
  codeOutputs,
  codeParams,
  codeTier,
  defaultCode,
  isFieldShape,
  layerCount,
  layerName,
  nodeInputs,
  nodeParams,
  onLeds,
  PATCH_FORMAT,
  splitLayer,
  type CodeReference,
  SUBPATCH_KIND,
  subpatchHasOut,
  subpatchInlets,
  subpatchOutlets,
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
  /** Where to open first, instead of the active patch (a host's URL). */
  initialLocation?: EditorLocation | null;
  /** The person moved somewhere: opened a patch, a built-in or a Sub-patch,
   * or came back out of one. Hosts with URLs push it; `replace` means the
   * same place under a new name (a new patch's first save, a built-in's
   * copy), so it should not become a separate step back. */
  onNavigate?: (location: EditorLocation, how: { replace: boolean }) => void;
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
  /** Go somewhere without it counting as the person's move (a host's Back
   * and Forward): `onNavigate` is not called. */
  navigate(location: EditorLocation): void;
  /** Where the editor is ("" for a patch not saved yet). */
  location(): EditorLocation | null;
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


type Registry = Map<string, PatchNodeType>;

/** All connectable input ports of a node: shaped inputs, then every
 * `number` param (knob doubles as a Scalar port), a Blend's layers
 * included. A Sub-patch's ports come from the instance: one per exposed
 * knob of its document. */
type Port = { name: string; shape: PatchShape; label?: string };

function inputPorts(def: PatchNodeType, node?: PatchNode): Port[] {
  if (def.id === SUBPATCH_KIND) {
    // Its Patch ins (typed, by id), then its exposed knobs.
    return [
      ...subpatchInlets(node),
      ...subpatchPorts(node).map((p) => ({ name: p.name, shape: "scalar" as PatchShape })),
    ];
  }
  if (def.id === CODE_KIND) return codeInputs(node);
  // A Patch in's `in` is fed from outside the patch, and a Patch out's
  // `default` and `shape` are its panel's: each shows only what is wired
  // inside.
  if (def.id === PATCH_IN_KIND) return [];
  if (def.id === PATCH_OUT_KIND) return [{ name: "in", shape: boundaryShape(node) ?? "field_color" }];
  return [
    ...nodeInputs(def, node),
    ...nodeParams(def, node)
      .filter((p) => p.kind === "number")
      .map((p) => ({ name: p.name, shape: "scalar" as PatchShape })),
  ];
}

/** Whether port (or knob) `name` of `node` applies in its current mode (see
 * `applies`); ports of Code and Sub-patch nodes always do. */
function portApplies(def: PatchNodeType, node: PatchNode, name: string): boolean {
  const p =
    def.inputs.find((q) => q.name === name) ??
    def.outputs.find((q) => q.name === name) ??
    def.params.find((q) => q.name === name);
  return !p || applies(p, def, node);
}

/** The output ports of a node: the type's, or for a Code node the instance's
 * declared outputs. */
function outputPorts(def: PatchNodeType, node?: PatchNode): Port[] {
  if (def.id === CODE_KIND) return codeOutputs(node);
  if (def.id === SUBPATCH_KIND) return [...(subpatchHasOut(node) ? def.outputs : []), ...subpatchOutlets(node)];
  // A Patch out's `out` is read from outside the patch.
  if (def.id === PATCH_IN_KIND) return [{ name: "out", shape: boundaryShape(node) ?? "field_color" }];
  if (def.id === PATCH_OUT_KIND) return [];
  return def.outputs;
}

/** The knobs a node's side panel shows: the type's params (a Blend's
 * layers included), or for a Sub-patch one per exposed inner knob (its range
 * from the inner node's type, its default the inner node's current value);
 * for a Code node its Scalar inputs. */
function panelParams(def: PatchNodeType, node: PatchNode, registry: Registry): PatchParamDef[] {
  if (def.id === CODE_KIND) return codeParams(node);
  if (def.id !== SUBPATCH_KIND) return nodeParams(def, node);
  return subpatchPorts(node).map((port) => {
    const inner = node.sub?.nodes.find((n) => n.id === port.node);
    const innerType = inner && registry.get(inner.kind);
    const innerDef = innerType && nodeParams(innerType, inner).find((p) => p.name === port.param);
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
  return new Set(nodeParams(def, node).filter((p) => p.kind === "number").map((p) => p.name));
}

/** What a second wire, `from` → `to`, into an input that already has one
 * does: become a new layer of the Blend there (see `layerFor`), or put a
 * combiner in between. Null when the input is free, the wire is the one
 * already there, or nothing combines that shape. */
type Combine = { layer: { node: string; at: number } } | { combiner: Combiner };
function combineAt(d: PatchDoc, registry: Registry, from: PortRef, to: PortRef): Combine | null {
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
  if (!into || !old || !incoming) return null;
  const layer = layerFor(d, registry, to, incoming);
  if (layer) return { layer };
  const combiner = combinerFor(registry, into, old, incoming);
  return combiner && { combiner };
}

/** How far the canvas zooms out, by hand or to fit a patch when it opens.
 * React Flow's default (0.5) leaves an arranged built-in cropped in a
 * narrow canvas: the website's is about 500 px wide at 1280 × 720, and
 * Rainbow Sparkle needs a third. */
const MIN_ZOOM = 0.2;

/** About what a minimized node measures (a mini ring, port dots, one line of
 * head), for placing a new combiner before React Flow has measured it. */
const COLLAPSED_SIZE: NodeSize = { width: 96, height: 112 };

/** A new, unused node id in `d`. */
function freshId(d: PatchDoc, taken?: Set<string>): string {
  let i = d.nodes.length + 1;
  while (d.nodes.some((n) => n.id === `n${i}`) || taken?.has(`n${i}`)) i++;
  return `n${i}`;
}

/** How a move is reported to the host (see `PatchEditorProps.onNavigate`);
 * null: not at all (the host moved the editor itself). */
type NavHow = "push" | "replace" | null;

/** A double-click on this node opens it rather than its settings. */
function opensInside(node: PatchFlowNode): boolean {
  return node.data.node.kind === SUBPATCH_KIND && node.data.node.sub !== undefined;
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
    /** The node's id in the patch as it renders (inside a Sub-patch,
     * `"{sub}/{node}"`): what its thumbnail and meters key on. */
    mini: string;
    /** Output ports with at least one outgoing wire (meters show these). */
    wiredOut: string[];
    /** Input ports already taken (one wire per input). */
    wiredIn: string[];
    /** Its field outputs carry LED data, not the plane (see domains.ts). */
    led: boolean;
  },
  "patch"
>;

/** Output shapes that thumbnail on the ring (the crate's `previewable`). */
const RING_SHAPES: readonly PatchShape[] = [
  "field_color",
  "field_scalar",
  "led_color",
  "led_scalar",
  "points",
  "effects",
  "texture",
];

const PatchNodeView = memo(function PatchNodeView({ data, selected }: NodeProps<PatchFlowNode>) {
  const { node, def } = data;
  const { activeId, minis, drag, combines, setCollapsed } = useContext(NodeContext);
  // Ports come and go with the instance (a Blend's layers, a Code node's
  // declared ports): React Flow re-reads the handles when the set changes,
  // as a new layer's dot may not change the node's size. Not on mount: that
  // would drop a wire being dragged.
  const updateInternals = useUpdateNodeInternals();
  const portKey = def
    ? [...inputPorts(def, node), ...outputPorts(def, node)].map((p) => p.name).join(" ")
    : "";
  const measuredPorts = useRef(portKey);
  useEffect(() => {
    if (measuredPorts.current === portKey) return;
    measuredPorts.current = portKey;
    updateInternals(node.id);
  }, [updateInternals, node.id, portKey]);
  if (!def) {
    return <div className="pnode pnode-unknown">unknown: {node.kind}</div>;
  }
  // A kind with modes (Random) shows the ports of its mode, and any other
  // that is still wired.
  const ins = inputPorts(def, node).filter((p) => portApplies(def, node, p.name) || data.wiredIn.includes(p.name));
  // Mini visualizers, per output style: field outputs get a thumbnail laid out
  // like the hardware, and so do the stream and texture sources (Touch
  // strokes, Triggered effects, Event effect, Video in, Still image, Clip),
  // drawn as their default consumer would draw them; scalar outputs get
  // amplitude meters and event outputs a fire strip. The Output hands nothing
  // on, so its ring is the frame the gate shows. Only for the patch that
  // is actually on air — that is the graph the backend is evaluating. A node
  // with a handful of outputs meters them all; a wide one (Audio, Touch, DJ
  // link) meters `out` and whatever is wired, or it would be taller than the
  // canvas.
  const live = minis !== null && data.docId !== "" && activeId === data.docId;
  // The principal output: `out`, or the single output of a source node.
  // An LED node's field outputs carry LED data: dots, labels and drag
  // checks all see the shape the wire really has. A kind with modes (Random)
  // shows its mode's outputs, and any other that is still wired.
  const outs = outputPorts(def, node)
    .filter((p) => portApplies(def, node, p.name) || data.wiredOut.includes(p.name))
    .map((p) => (data.led ? { ...p, shape: onLeds(p.shape) } : p));
  const primary = outs.find((p) => p.name === "out") ?? (outs.length === 1 ? outs[0] : undefined);
  const showRing =
    live && (node.kind === "output" || (primary !== undefined && RING_SHAPES.includes(primary.shape)));
  // A Code node thumbnails every field output, or the texture it renders:
  // the principal one as the node's own cell, the others by port
  // (`node:<id>:<port>`).
  const rings: { mini: string; label: string }[] =
    live && node.kind === CODE_KIND
      ? outs
          .filter((p) => isFieldShape(p.shape) || p.shape === "texture")
          .map((p) => ({
            mini: p.name === primary?.name ? `node:${data.mini}` : `node:${data.mini}:${p.name}`,
            label: p.name,
          }))
      : showRing
        ? [{ mini: `node:${data.mini}`, label: node.name || def.label }]
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
    if (dir === "out") return drag.dir === "in" && fitsInput(drag.shape, drag.sampled ?? false, shape) ? " port-fit" : " port-nofit";
    if (drag.dir !== "out" || !fitsInput(shape, isSampledInput(def, node, name), drag.shape)) return " port-nofit";
    if (!data.wiredIn.includes(name)) return " port-fit";
    return combines(node.id, name) ? " port-fit port-combine" : " port-nofit";
  };
  const portLabel = (p: Port, dir: "in" | "out") => `${p.label ?? p.name} · ${SHAPE_LABEL[p.shape]} ${dir}`;
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
    const layers = layerCount(def, node);
    const choiceLabel =
      layers > 1
        ? `${layers} layers`
        : choice && choice.kind !== "number"
          ? choice.kind.select[Math.round(node.params[choice.name] ?? choice.default)]
          : undefined;
    // No thumbnail (a number or event output): its meter instead.
    const faceMeter = rings.length === 0 ? meterPorts.find((p) => shownOuts.includes(p)) : undefined;
    const named = drag !== null;
    return (
      <div className={`pnode pnode-collapsed cat-${def.category} ${selected ? "selected" : ""}`}>
        <div className="pnode-head">
          <span className="pnode-title">
            <NodeIcon kind={node.kind} category={def.category} size={13} />
            {node.name || def.label}
          </span>
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
                {named && <span>{p.label ?? p.name}</span>}
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
                mini={`scalar:${data.mini}:${faceMeter.name}`}
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
                {named && <span>{p.label ?? p.name}</span>}
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
          <NodeIcon kind={node.kind} category={def.category} size={13} />
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
              mini={`scalar:${data.mini}:${p.name}`}
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
      {node.kind === NOTE_KIND && (
        <div className="pnode-note">{node.text?.trim() ? node.text : <span className="hint">Empty note — write it on the right.</span>}</div>
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
              <span>{p.label ?? p.name}</span>
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
              <span>{p.label ?? p.name}</span>
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

/** A wire. Selected (a tap or a click), it carries a ✕ at its middle: a
 * phone has no Delete key, and on a desk it says what the key would do. The
 * button keeps its size at any zoom. */
const WireEdge = memo(function WireEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  selected,
  markerEnd,
  style,
  interactionWidth,
}: EdgeProps) {
  const { deleteWire } = useContext(NodeContext);
  const zoom = useStore((s) => s.transform[2]);
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      {selected && deleteWire && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="patch-wire-delete nodrag nopan"
            style={{
              transform: `translate(${labelX}px, ${labelY}px) translate(-50%, -50%) scale(${1 / zoom})`,
            }}
            onClick={() => deleteWire(id)}
            aria-label="Delete wire"
            title="Delete wire (or press Delete)"
          >
            ✕
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const EDGE_TYPES = { wire: WireEdge };

// --- doc <-> flow mapping --------------------------------------------------

/** The flow nodes for what is shown: the document at `path` inside `root`. */
function toFlowNodes(root: PatchDoc, path: string[], registry: Registry): PatchFlowNode[] {
  const doc = docAt(root, path);
  const leds = ledNodes(doc, registry);
  return doc.nodes.map((n) => ({
    id: n.id,
    type: "patch" as const,
    position: { x: n.pos[0], y: n.pos[1] },
    data: {
      node: n,
      def: registry.get(n.kind),
      docId: root.id,
      mini: n.kind === "output" ? outputMini(root, path, n.id) : flatId(root, path, n.id),
      wiredOut: doc.edges.filter((e) => e.from.node === n.id).map((e) => e.from.port),
      wiredIn: doc.edges.filter((e) => e.to.node === n.id).map((e) => e.to.port),
      led: leds.has(n.id),
    },
  }));
}

function edgeId(e: PatchDoc["edges"][number]): string {
  return `${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`;
}

function toFlowEdges(doc: PatchDoc, registry: Registry): FlowEdge[] {
  const leds = ledNodes(doc, registry);
  return doc.edges.map((e) => {
    const from = doc.nodes.find((n) => n.id === e.from.node);
    const def = registry.get(from?.kind ?? "");
    const declared = portShape(def, e.from.port, "out", from) ?? "scalar";
    const shape = leds.has(e.from.node) ? onLeds(declared) : declared;
    return {
      id: edgeId(e),
      type: "wire",
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
  subpatch,
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
  /** Replace the node with its Code conversion (see `PatchEditorProps`).
   * Rejects with the reason when the node cannot be converted. */
  onConvertToCode?: () => Promise<void>;
  /** For a Sub-patch node: its source and what can be done with it. */
  subpatch?: SubpatchActions;
}) {
  const sheet = useSheet(onClose);
  // Why Convert to Code was refused, for the node (and layer count) it was
  // refused for: selecting another node, or removing a layer, clears it.
  const [convertError, setConvertError] = useState<{ node: string; layers?: number; message: string } | null>(
    null,
  );
  const node = doc.nodes.find((n) => n.id === nodeId);
  const def = node && registry.get(node.kind);
  if (!node || !def) return null;
  const wiredInto = (param: string) =>
    doc.edges.find((e) => e.to.node === node.id && e.to.port === param);
  // A kind with modes (Random) shows the knobs of its mode, and any other
  // that is still wired.
  const params = panelParams(def, node, registry).filter(
    (p) => portApplies(def, node, p.name) || wiredInto(p.name) !== undefined,
  );
  const isExposed = (param: string) =>
    doc.exposed.some((x) => x.node === node.id && x.param === param);
  // A layered node (Blend) lists its params by layer, top layer first.
  const layers = def.layered && layerInput(def) ? layerCount(def, node) : 0;
  const layerOf = (name: string) => (layers ? splitLayer(def, name, layers) : null);
  /** Who a wire into this node comes from, as the canvas names it. */
  const source = (port: string) => {
    const wire = wiredInto(port);
    const from = wire && doc.nodes.find((n) => n.id === wire.from.node);
    if (!wire || !from) return null;
    return from.name || registry.get(from.kind)?.label || from.kind;
  };
  /** One param's row; `label` overrides its own (a layer's rows say
   * "Opacity", the layer heads say which layer). */
  const renderParam = (p: PatchParamDef, label = p.label) => {
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
            {label}
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
  };

  return (
    <aside
      className={`patch-side ${onClose ? "patch-sheet" : ""}`}
      aria-label={`${def.label} settings`}
      ref={sheet.ref}
      tabIndex={sheet.tabIndex}
      onKeyDown={sheet.onKeyDown}
    >
      <PanelHead
        title={
          <>
            <NodeIcon kind={def.id} category={def.category} size={18} />
            {def.label}
          </>
        }
        onClose={onClose}
      />
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
      {node.kind === SUBPATCH_KIND && <SubpatchInfo node={node} canEdit={canEdit} actions={subpatch} />}
      {node.kind === NOTE_KIND && (
        <label className="patch-field">
          <span>Text</span>
          <textarea
            className="note-text"
            value={node.text ?? ""}
            disabled={!canEdit}
            rows={8}
            placeholder="A remark for whoever opens this patch next."
            aria-label="Note text"
            onChange={(e) =>
              onChange((d) => {
                const n = d.nodes.find((x) => x.id === nodeId);
                if (n) n.text = e.target.value;
              }, `${nodeId}.text`)
            }
          />
        </label>
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
      {params.filter((p) => !layerOf(p.name)).map((p) => renderParam(p))}
      {layers > 0 && (
        <div className="patch-layers" role="group" aria-label="Layers">
          {Array.from({ length: layers }, (_, i) => layers - i).map((k) => (
            <section key={k} className="patch-layer" aria-label={`Layer ${k}`}>
              <div className="patch-layer-head">
                <span>Layer {k}</span>
                <span className="hint patch-layer-from">
                  {source(layerName(layerInput(def)!, k)) ?? "empty"}
                </span>
                {canEdit && (
                  <span className="patch-layer-tools">
                    <button
                      type="button"
                      aria-label={`Raise layer ${k}`}
                      disabled={k === layers}
                      onClick={() => onChange((d) => void moveLayer(d, def, nodeId, k, k + 1))}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`Lower layer ${k}`}
                      disabled={k === 1}
                      onClick={() => onChange((d) => void moveLayer(d, def, nodeId, k, k - 1))}
                    >
                      ▼
                    </button>
                    {layers > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove layer ${k}`}
                        onClick={() => onChange((d) => void removeLayer(d, def, nodeId, k))}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                )}
              </div>
              {params
                .filter((p) => layerOf(p.name)?.k === k)
                .map((p) => renderParam(p, def.params.find((q) => q.name === layerOf(p.name)?.name)?.label))}
            </section>
          ))}
          {def.inputs
            .filter((p) => !def.layered!.names.includes(p.name))
            .map((p) => (
              <div key={p.name} className="patch-layer patch-layer-base">
                <div className="patch-layer-head">
                  <span>{p.name === "base" ? "Base" : p.name}</span>
                  <span className="hint patch-layer-from">{source(p.name) ?? "empty"}</span>
                </div>
              </div>
            ))}
          {canEdit && layers < def.layered!.max && (
            <button
              type="button"
              onClick={() => onChange((d) => void addLayer(d, def, nodeId, layers + 1))}
            >
              ＋ Add layer
            </button>
          )}
        </div>
      )}
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
          onClick={() => {
            setConvertError(null);
            onConvertToCode().catch((err: unknown) =>
              setConvertError({
                node: node.id,
                layers: node.layers,
                message: err instanceof Error ? err.message : String(err),
              }),
            );
          }}
          title="Replace this node with a Code node that does the same thing, to edit from there. Its wires and knobs stay."
        >
          Convert to Code
        </button>
      )}
      {convertError && convertError.node === node.id && convertError.layers === node.layers && (
        <p className="patch-status error">{convertError.message}</p>
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

/** What a Sub-patch node's panel needs from the editor. */
type SubpatchActions = {
  /** A source document: undefined while it is being fetched, null when it
   * is gone (deleted, or a built-in this version doesn't have). */
  source: (id: string) => PatchDoc | null | undefined;
  /** The document on the canvas can't be edited here (a built-in, or the
   * inside of a linked Sub-patch): cloning waits for its own unlock. */
  locked: boolean;
  open: (node: string) => void;
  openSource: (id: string) => void;
  clone: (node: string) => void;
  update: (node: string) => void;
};

/** A Sub-patch's origin and the moves it offers: open it, clone a linked
 * one for this project, update a clone whose source has moved on. */
function SubpatchInfo({
  node,
  canEdit,
  actions,
}: {
  node: PatchNode;
  canEdit: boolean;
  actions?: SubpatchActions;
}) {
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  useEffect(() => setConfirmUpdate(false), [node.id]);
  if (!node.sub) {
    return (
      <p className="hint">
        An empty sub-patch renders black. Insert a saved patch or a built-in from the palette's Sub-patches group
        instead.
      </p>
    );
  }
  const sourceId = node.source;
  const source = sourceId && actions ? actions.source(sourceId) : undefined;
  const sourceName = source?.name || node.sub.name || "its source";
  const kind = sourceId && isBuiltin(sourceId) ? "a built-in" : "a patch in your library";
  const inner = `${node.sub.nodes.length} nodes inside`;
  // A clone can be updated once its source has moved on; if the clone was
  // changed here too, updating replaces those changes (so it asks twice).
  const stale = !node.linked && source && node.source_rev !== undefined && sourceRev(source) !== node.source_rev;
  const edited = node.source_rev !== undefined && sourceRev(node.sub) !== node.source_rev;
  return (
    <div className="patch-subpatch-info">
      {node.linked ? (
        <p className="hint">
          Linked to <strong>{sourceName}</strong>, {kind} ({inner}). It follows that patch: change it there and every
          patch using it changes too. Its exposed knobs are this node's inputs.
          {source === null && " That patch is gone, so this keeps the last copy it had."}
        </p>
      ) : sourceId ? (
        <p className="hint">
          This project's own copy of <strong>{sourceName}</strong> ({inner}), yours to change here.
          {stale && ` ${sourceName} has changed since it was copied.`}
        </p>
      ) : (
        <p className="hint">This patch's own copy of "{node.sub.name || "a patch"}" ({inner}), yours to change here.</p>
      )}
      {actions && (
        <div className="patch-subpatch-actions">
          <button type="button" onClick={() => actions.open(node.id)} title="Or double-click the node">
            Open inside ↘
          </button>
          {canEdit && node.linked && (
            <button
              type="button"
              disabled={actions.locked}
              title={
                actions.locked
                  ? "This patch can't be changed here; copy it first"
                  : "Make this a copy this patch owns, to change without touching the original"
              }
              onClick={() => actions.clone(node.id)}
            >
              Clone for this project
            </button>
          )}
          {canEdit && stale && (
            <button
              type="button"
              disabled={actions.locked}
              className={edited && confirmUpdate ? "danger" : undefined}
              title={
                edited
                  ? `Replace this copy with ${sourceName} as it is now; the changes made to the copy here are lost`
                  : `Replace this copy with ${sourceName} as it is now`
              }
              onClick={() => {
                if (edited && !confirmUpdate) {
                  setConfirmUpdate(true);
                  return;
                }
                setConfirmUpdate(false);
                actions.update(node.id);
              }}
            >
              {edited && confirmUpdate ? "Really replace your changes?" : `Update from ${sourceName}`}
            </button>
          )}
          {sourceId && source && (
            <button type="button" onClick={() => actions.openSource(sourceId)}>
              Open {sourceName}
            </button>
          )}
        </div>
      )}
    </div>
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
    ? suggestions.filter((s) => matchScore(s.type, q) !== null || s.port.toLowerCase().includes(q))
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
          >
            <NodeIcon kind={s.type.id} category={s.type.category} />
            <span className="patch-connect-label">{s.type.label}</span>
            <span className="patch-connect-port">
              {from.dir === "out" ? "→ " : "← "}
              {s.port}
              {s.viaParam ? " (knob)" : ""}
              {s.exact ? "" : " ≈ adapted"}
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
  initialLocation = null,
  onNavigate,
}: PatchEditorProps) {
  const flow = useReactFlow();
  const registry = useMemo<Registry | null>(
    () => (registryList ? new Map(registryList.map((t) => [t.id, t])) : null),
    [registryList],
  );
  const [patches, setPatches] = useState<PatchSummary[]>([]);
  // The library has answered at least once (so a source missing from it is
  // gone, not just not listed yet).
  const [listed, setListed] = useState(false);
  // The patch open (what is saved and renders) and where in it the canvas
  // is: `path` goes down through Sub-patch nodes, and `doc` is the document
  // there, the one on the canvas. Edits land in `doc` inside `root`.
  const [root, setRoot] = useState<PatchDoc | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const doc = useMemo(() => (root ? docAt(root, path) : null), [root, path]);
  // Why the canvas can't be edited (a built-in, a linked Sub-patch), and
  // whether an edit was tried since it opened: then a bar says so.
  const lock = useMemo(() => (root ? lockAt(root, path) : null), [root, path]);
  const [lockTried, setLockTried] = useState(false);
  // The patch browser, beside the canvas (a wide layout).
  const [browsing, setBrowsing] = useState(false);
  // Sub-patches' source documents, fetched as their panels or links need
  // them (null: gone). Cleared whenever another patch opens.
  const [sources, setSources] = useState<Map<string, PatchDoc | null>>(() => new Map());
  const sourceWanted = useRef(new Set<string>());
  const [nodes, setNodes] = useState<PatchFlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Compact layout (a phone, or a narrow host column): the palette and the
  // node panel are sheets, opened on purpose and closed with Done.
  const tabRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const compact = useCompact(tabRef);
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
  const rootRef = useRef(root);
  rootRef.current = root;
  const pathRef = useRef(path);
  pathRef.current = path;
  const presetsRef = useRef(presets);
  presetsRef.current = presets;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const registryRef = useRef(registry);
  registryRef.current = registry;
  const requestedId = useRef<string | null>(null);
  /** Where in the requested patch to land, and how to report it. */
  const requestedAt = useRef<{ path: string[]; how: NavHow }>({ path: [], how: null });
  /** How to report a new patch once its first save gives it an id. */
  const unsavedHow = useRef<NavHow>(null);
  /** A saved patch asked for to be inserted as a Sub-patch, not opened. */
  const insertRequestedId = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The edit the save timer holds: opening another patch, or leaving,
   * writes it at once instead of letting the next edit's timer drop it. */
  const pendingSave = useRef<PatchDoc | null>(null);
  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const d = pendingSave.current;
    pendingSave.current = null;
    if (d) store.save(d);
  }, [store]);
  useEffect(() => flushSave, [flushSave]);
  const history = useRef(new History<PatchDoc>());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  useEffect(() => {
    onDocChangeRef.current?.(root);
  }, [root]);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  /** Tell the host the person moved (unless `how` is null: the host moved
   * us, or nothing changed). */
  const lastAnnounced = useRef<EditorLocation | null>(null);
  const announce = useCallback((loc: EditorLocation, how: NavHow) => {
    if (how && !sameLocation(loc, lastAnnounced.current)) {
      onNavigateRef.current?.(loc, { replace: how === "replace" });
    }
    lastAnnounced.current = loc;
  }, []);

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
        if (opensInside(node)) {
          openInsideRef.current(node.id);
          return;
        }
        setSelectedNode(node.id);
        setSheet("node");
      }
    },
    [compact],
  );
  /** Double-click (or double-tap): a Sub-patch opens; on a phone any other
   * node's settings open. */
  const onNodeOpen = useCallback(
    (_: unknown, node: PatchFlowNode) => {
      if (opensInside(node)) {
        openInsideRef.current(node.id);
        return;
      }
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

  /** Put `root` at `at` on the canvas (React Flow's copy of the document). */
  const showAt = useCallback((r: PatchDoc, at: string[]) => {
    const reg = registryRef.current;
    if (!reg) return;
    setNodes(toFlowNodes(r, at, reg));
    setEdges(toFlowEdges(docAt(r, at), reg));
  }, []);
  // A patch opens fitted to the canvas, but its cards keep growing after the
  // first fit (measured, then their minis once the preview runs), which left
  // an arranged patch hanging off the edge. So the view follows the patch
  // just opened, refitting whenever a card changes size, until the person
  // moves the view or edits. True at first for the canvas's own `fitView`.
  const fitFollowRef = useRef(true);
  const refitFrameRef = useRef(0);
  const fitSoon = useCallback(() => {
    fitFollowRef.current = true;
    requestAnimationFrame(() => void flow.fitView({ padding: 0.15 }));
  }, [flow]);
  const refitIfFollowing = useCallback(() => {
    if (!fitFollowRef.current || refitFrameRef.current) return;
    refitFrameRef.current = requestAnimationFrame(() => {
      refitFrameRef.current = 0;
      if (fitFollowRef.current) void flow.fitView({ padding: 0.15 });
    });
  }, [flow]);
  /** The person moved the view (a programmatic move has no event). */
  const onMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) fitFollowRef.current = false;
  }, []);

  // Stable (ref-based) so the long-lived message subscription never goes stale.
  const openDoc = useCallback(
    (d: PatchDoc, at: string[] = [], how: NavHow = "push") => {
      flushSave();
      history.current.clear();
      const p = validPath(d, at);
      rootRef.current = d;
      pathRef.current = p;
      setRoot(d);
      setPath(p);
      setSelectedNode(null);
      setConfirmDelete(false);
      setLockTried(false);
      setChooser(null);
      setSources(new Map());
      sourceWanted.current.clear();
      showAt(d, p);
      fitSoon();
      if (d.id) announce({ patch: d.id, path: p }, how);
      else unsavedHow.current = how;
    },
    [announce, fitSoon, flushSave, showAt],
  );

  /** Go to a location: inside the open patch, a built-in, or a saved patch
   * (asked of the store, opened when it answers). */
  const goTo = useCallback(
    (loc: EditorLocation, how: NavHow) => {
      const r = rootRef.current;
      if (r && loc.patch === r.id) {
        const p = validPath(r, loc.path);
        if (sameLocation({ patch: r.id, path: p }, { patch: r.id, path: pathRef.current })) return;
        pathRef.current = p;
        setPath(p);
        setSelectedNode(null);
        setLockTried(false);
        setChooser(null);
        showAt(r, p);
        fitSoon();
        if (r.id) announce({ patch: r.id, path: p }, how);
        return;
      }
      if (isBuiltin(loc.patch)) {
        const preset = presetsRef.current.find((p) => p.id === loc.patch);
        if (preset) openDoc(structuredClone(preset), loc.path, how);
        return;
      }
      if (!loc.patch) return;
      requestedId.current = loc.patch;
      requestedAt.current = { path: loc.path, how };
      store.get(loc.patch);
    },
    [announce, fitSoon, openDoc, showAt, store],
  );
  const openInsideRef = useRef<(node: string) => void>(() => {});
  openInsideRef.current = (node: string) => {
    const r = rootRef.current;
    if (r) goTo({ patch: r.id, path: [...pathRef.current, node] }, "push");
  };

  // Store events.
  useEffect(() => {
    return store.subscribe((msg) => {
      if (msg.type === "patches") {
        setPatches(msg.patches);
        setListed(true);
      } else if (msg.type === "patch") {
        const id = msg.patch.id;
        // A Sub-patch's source we asked for (or one we hold, saved again).
        const wasSource = sourceWanted.current.delete(id);
        if (wasSource || sourcesRef.current.has(id)) {
          setSources((m) => new Map(m).set(id, msg.patch));
        }
        if (insertRequestedId.current === id) {
          insertRequestedId.current = null;
          insertSubpatchRef.current?.(msg.patch);
        } else if (requestedId.current === id) {
          requestedId.current = null;
          openDoc(msg.patch, requestedAt.current.path, requestedAt.current.how);
        } else if (!wasSource && rootRef.current && rootRef.current.id === "") {
          // Save echo for a brand-new patch: adopt the assigned id, keep edits.
          // The nodes on the canvas learn it too: their live thumbnails and
          // meters key on it (a preset copy otherwise showed none until it
          // was reopened).
          const next = { ...rootRef.current, id };
          rootRef.current = next;
          setRoot(next);
          setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, docId: id } })));
          announce({ patch: id, path: pathRef.current }, unsavedHow.current ?? "replace");
          unsavedHow.current = null;
        }
      } else if (msg.type === "param") {
        // Someone played an exposed param (Control tab, possibly on a phone):
        // reflect it in the open doc so the side panel doesn't go stale.
        const d = rootRef.current;
        if (!d) return;
        const n = d.nodes.find((x) => x.id === msg.node);
        if (!n || n.params[msg.param] === msg.value) return;
        const next = structuredClone(d);
        next.nodes.find((x) => x.id === msg.node)!.params[msg.param] = msg.value;
        rootRef.current = next;
        setRoot(next);
      }
    });
  }, [store, openDoc, announce]);

  // Open where the host says (its URL), or reopen the live patch when
  // returning to this tab. Subscribe first so a fast local response cannot
  // arrive before the editor is listening. A built-in waits for the presets.
  // The host's location counts once: after a delete the editor falls back to
  // the live patch (or nothing), not to wherever the page first opened.
  const initialUsed = useRef(false);
  useEffect(() => {
    if (!ready || rootRef.current || requestedId.current) return;
    const initial = initialUsed.current ? null : initialLocation;
    const want = initial ?? (activeId ? { patch: activeId, path: [] } : null);
    if (!want || (isBuiltin(want.patch) && presets.length === 0)) return;
    if (initial) initialUsed.current = true;
    goTo(want, "replace");
  }, [activeId, initialLocation, presets, ready, goTo]);

  // Registry may arrive after the doc was opened.
  useEffect(() => {
    if (registry && rootRef.current) showAt(rootRef.current, pathRef.current);
  }, [registry, showAt]);

  // --- Sub-patch sources -------------------------------------------------

  /** A source document: a built-in from the presets, a saved patch from
   * the store (undefined while asked for; null when it is gone). */
  const sourceFor = useCallback(
    (id: string): PatchDoc | null | undefined => {
      if (isBuiltin(id)) return presets.find((p) => p.id === id) ?? (presets.length ? null : undefined);
      if (sources.has(id)) return sources.get(id);
      if (listed && !patches.some((p) => p.id === id)) return null;
      return undefined;
    },
    [presets, sources, listed, patches],
  );
  // Ask the store for the sources in play: what the open patch links (to
  // keep those copies current) and what the canvas's Sub-patches came from
  // (for their panels).
  const wantedSources = useMemo(() => {
    const ids = new Set(root ? linkedSources(root) : []);
    for (const n of doc?.nodes ?? []) if (n.kind === SUBPATCH_KIND && n.source) ids.add(n.source);
    return [...ids].filter((id) => !isBuiltin(id) && id !== root?.id);
  }, [root, doc]);
  useEffect(() => {
    for (const id of wantedSources) {
      if (sources.has(id) || sourceWanted.current.has(id)) continue;
      if (listed && !patches.some((p) => p.id === id)) continue;
      sourceWanted.current.add(id);
      store.get(id);
    }
  }, [wantedSources, sources, listed, patches, store]);

  const scheduleSave = useCallback(
    (d: PatchDoc) => {
      if (!canEdit) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingSave.current = d;
      saveTimer.current = setTimeout(flushSave, 600);
    },
    [canEdit, flushSave],
  );

  /** All document mutations funnel through here: clone, mutate, sync, save.
   * `mutate` gets the document on the canvas (or the one at `at`) inside a
   * copy of the patch. `key` names the control being changed so a run of
   * edits on one knob is a single undo step. Where the canvas can't be
   * edited (a built-in, a linked Sub-patch) nothing changes: the bar says
   * why and offers a copy, and the canvas drops whatever it moved already.
   * `force` is for the moves that lift that lock (clone). */
  const mutateDoc = useCallback(
    (mutate: (d: PatchDoc) => void, resync = true, key?: string, opts: { at?: string[]; force?: boolean } = {}) => {
      const prev = rootRef.current;
      if (!prev) return;
      const at = opts.at ?? pathRef.current;
      if (!opts.force && lockAt(prev, at)) {
        setLockTried(true);
        showAt(prev, pathRef.current);
        return;
      }
      history.current.push(prev, key);
      fitFollowRef.current = false;
      const next: PatchDoc = structuredClone(prev);
      mutate(docAt(next, at));
      rootRef.current = next;
      setRoot(next);
      scheduleSave(next);
      if (resync) showAt(next, pathRef.current);
    },
    [scheduleSave, showAt],
  );

  /** Show another snapshot of the open patch (undo/redo). The canvas stays
   * where it is unless that Sub-patch is gone in the snapshot. */
  const restoreDoc = useCallback(
    (d: PatchDoc) => {
      const p = validPath(d, pathRef.current);
      rootRef.current = d;
      pathRef.current = p;
      setRoot(d);
      setPath(p);
      scheduleSave(d);
      showAt(d, p);
      const shown = docAt(d, p);
      setSelectedNode((sel) => (sel && shown.nodes.some((n) => n.id === sel) ? sel : null));
    },
    [scheduleSave, showAt],
  );
  const undo = useCallback(() => {
    const cur = rootRef.current;
    if (!cur || !canEdit) return;
    const prev = history.current.undo(cur);
    if (prev) restoreDoc(prev);
  }, [canEdit, restoreDoc]);
  const redo = useCallback(() => {
    const cur = rootRef.current;
    if (!cur || !canEdit) return;
    const next = history.current.redo(cur);
    if (next) restoreDoc(next);
  }, [canEdit, restoreDoc]);

  // --- built-ins and linked Sub-patches ----------------------------------

  /** A built-in can't change: open an editable copy of it instead, at the
   * same place, with any linked Sub-patch on the way there cloned too. It
   * takes the built-in's place in the host's history. */
  const forkBuiltin = useCallback(() => {
    const r = rootRef.current;
    if (!r) return;
    const copy = structuredClone(r);
    copy.id = "";
    cloneAlong(copy, pathRef.current);
    openDoc(copy, pathRef.current, "replace");
    scheduleSave(copy);
  }, [openDoc, scheduleSave]);
  /** The canvas is inside linked Sub-patches: make them this patch's own. */
  const cloneHere = useCallback(() => {
    mutateDoc((d) => cloneAlong(d, pathRef.current), true, undefined, { at: [], force: true });
    setLockTried(false);
  }, [mutateDoc]);
  const subpatchActions = useMemo(
    () => ({
      source: sourceFor,
      locked: lock !== null,
      open: (node: string) => openInsideRef.current(node),
      openSource: (id: string) => goTo({ patch: id, path: [] }, "push"),
      clone: (node: string) =>
        mutateDoc((d) => {
          const n = d.nodes.find((x) => x.id === node);
          if (n) unlink(n);
        }),
      update: (node: string) => {
        const n = docRef.current?.nodes.find((x) => x.id === node);
        const src = n?.source ? sourceFor(n.source) : null;
        if (!src) return;
        mutateDoc((d) => {
          const m = d.nodes.find((x) => x.id === node);
          if (!m) return;
          m.sub = snapshot(src);
          m.source_rev = sourceRev(src);
        });
      },
    }),
    [sourceFor, lock, goTo, mutateDoc],
  );

  // Linked copies follow their sources: when the open patch has a stale
  // one (a built-in changed with the app, or a saved patch changed while
  // this one wasn't looking), refresh it, as the store does on save.
  useEffect(() => {
    const r = rootRef.current;
    if (!r || !r.id || isBuiltin(r.id) || !canEdit) return;
    const next = structuredClone(r);
    let changed = false;
    for (const id of linkedSources(r)) {
      const src = sourceFor(id);
      if (src) changed = syncLinks(next, src) || changed;
    }
    if (!changed) return;
    rootRef.current = next;
    setRoot(next);
    showAt(next, pathRef.current);
    scheduleSave(next);
  }, [root?.id, sourceFor, canEdit, showAt, scheduleSave]);

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
      if (changes.some((ch) => ch.type === "dimensions")) refitIfFollowing();
    },
    [refitIfFollowing],
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
      const declared = portShape(registry.get(source?.kind ?? ""), conn.sourceHandle, "out", source);
      const from = declared && ledNodes(d, registry).has(conn.source) ? onLeds(declared) : declared;
      const into = portShape(registry.get(target?.kind ?? ""), conn.targetHandle, "in", target);
      const sampled = isSampledInput(registry.get(target?.kind ?? ""), target, conn.targetHandle);
      if (!from || !into || !fitsInput(into, sampled, from)) return false;
      // One wire per input; a second one into a taken input is fine when a
      // combiner can go between them (onConnect puts it there).
      const taken = d.edges.some((e) => e.to.node === conn.target && e.to.port === conn.targetHandle);
      return (
        !taken ||
        combineAt(
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
      const combine = combineAt(d, registry, from, to);
      if (!combine) {
        mutateDoc((doc) => {
          doc.edges.push({ from, to });
        });
        return;
      }
      // A second wire into a taken input: a new layer of the Blend there, or
      // a combiner between the two, as one undo step, selected so its modes
      // and amounts are in the side panel.
      let id: string;
      if ("layer" in combine) {
        const { node, at } = combine.layer;
        const def = registry.get(d.nodes.find((n) => n.id === node)?.kind ?? "");
        if (!def) return;
        id = node;
        mutateDoc((doc) => {
          const port = addLayer(doc, def, node, at);
          if (port) doc.edges.push({ from, to: { node, port } });
        });
      } else {
        id = freshId(d);
        const pos = combinerSpot(to);
        mutateDoc((doc) => {
          insertCombiner(doc, to, from, combine.combiner, id, pos);
        });
      }
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
      return combineAt(d, registry, { node: drag.node, port: drag.port }, { node, port }) !== null;
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
      const def = registry.get(node?.kind ?? "");
      const declared = portShape(def, p.handleId, dir, node);
      const led = dir === "out" && ledNodes(d, registry).has(p.nodeId);
      const shape = declared && led ? onLeds(declared) : declared;
      const sampled = dir === "in" && isSampledInput(def, node, p.handleId);
      if (shape) setDrag({ node: p.nodeId, port: p.handleId, shape, dir, sampled });
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
        d.nodes.push({ id, kind: s.type.id, name: "", params: { ...s.params }, pos: [x, Math.round(c.flow.y - 20)] });
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
  const deleteWire = useCallback(
    (id: string) => {
      mutateDoc((d) => {
        d.edges = d.edges.filter((e) => edgeId(e) !== id);
      });
    },
    [mutateDoc],
  );

  /** Where a new node lands: centred in the canvas as shown, not the window
   * (a host may give the editor one corner of the page), and clear of the
   * globals card pinned in its corner: the middle of what the card leaves,
   * to its left or above it. */
  const canvasCenter = useCallback((): [number, number] => {
    const el = canvasRef.current;
    const rect = el?.getBoundingClientRect();
    let [left, top, right, bottom] = rect
      ? [rect.left, rect.top, rect.right, rect.bottom]
      : [0, 0, window.innerWidth, window.innerHeight];
    const card = el?.querySelector(".patch-globals")?.getBoundingClientRect();
    if (card && card.width > 0) {
      if (card.left - left >= DEFAULT_SIZE.width + 40) right = Math.min(right, card.left);
      else if (card.top - top >= DEFAULT_SIZE.height + 40) bottom = Math.min(bottom, card.top);
    }
    const center = flow.screenToFlowPosition({ x: (left + right) / 2, y: (top + bottom) / 2 });
    // A node's position is its corner: centre the node itself there.
    return [Math.round(center.x - DEFAULT_SIZE.width / 2), Math.round(center.y - DEFAULT_SIZE.height / 2)];
  }, [flow]);

  /** Add a node of `kind` at `at` (flow coordinates), or the canvas centre,
   * starting with `params` when given. */
  const addNode = useCallback(
    (kind: string, at?: [number, number], params: Record<string, number> = {}) => {
      // A patch has one sink; the palette disables Output while it has it.
      if (kind === "output" && docRef.current?.nodes.some((n) => n.kind === "output")) return;
      const pos = at ?? canvasCenter();
      mutateDoc((d) => {
        const node: PatchNode = { id: freshId(d), kind, name: "", params: { ...params }, pos };
        // A Code node is nothing without its ports and body; a Note is text.
        if (kind === CODE_KIND) node.code = defaultCode();
        if (kind === NOTE_KIND) node.text = "";
        d.nodes.push(node);
      });
    },
    [canvasCenter, mutateDoc],
  );

  /** Add a Sub-patch node linked to `inner` (a saved patch or a built-in):
   * it holds a copy that follows it until cloned. */
  const insertSubpatch = useCallback(
    (inner: PatchDoc) => {
      const pos = canvasCenter();
      const sub = snapshot(inner);
      mutateDoc((d) => {
        d.nodes.push({
          id: freshId(d),
          kind: SUBPATCH_KIND,
          name: "",
          params: {},
          pos,
          sub,
          ...(inner.id ? { source: inner.id, linked: true } : {}),
        });
      });
    },
    [canvasCenter, mutateDoc],
  );
  const insertSubpatchRef = useRef(insertSubpatch);
  insertSubpatchRef.current = insertSubpatch;

  const subpatchChoices = useMemo<SubpatchChoice[]>(() => {
    if (!registry?.has(SUBPATCH_KIND)) return [];
    // Not the patch itself, nor one that links it: they would nest in each
    // other without end.
    const here = root?.id ?? "";
    return [
      ...patches
        .filter((p) => !here || (p.id !== here && !summaryLinks(p.subpatches, here)))
        .map((p) => ({ id: p.id, name: p.name, nodes: p.nodes, preset: false })),
      ...presets.map((p) => ({ id: p.id, name: p.name, nodes: p.nodes.length, preset: true })),
    ];
  }, [registry, patches, presets, root?.id]);

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
      // The whole patch (what saves and renders), wherever the canvas is.
      doc: () => rootRef.current,
      open: (d: PatchDoc, asNew = false) => openAs(d, asNew),
      replace: (d: PatchDoc) => {
        const cur = rootRef.current;
        // A built-in can't change: the new document becomes a patch of its own.
        if (!cur || isBuiltin(cur.id)) {
          openAs(d, true);
          return;
        }
        // Wholly: a field the new document leaves out goes, as on Open.
        const next: PatchDoc = { ...structuredClone(d), id: cur.id };
        mutateDoc(
          (c) => {
            for (const key of Object.keys(c)) delete (c as unknown as Record<string, unknown>)[key];
            Object.assign(c, next);
          },
          false,
          undefined,
          { at: [], force: true },
        );
        const replaced = rootRef.current!;
        const p = validPath(replaced, pathRef.current);
        pathRef.current = p;
        setPath(p);
        showAt(replaced, p);
        const shown = docAt(replaced, p);
        setSelectedNode((sel) => (sel && shown.nodes.some((n) => n.id === sel) ? sel : null));
      },
      arrange: arrangeNodes,
      navigate: (loc: EditorLocation) => goTo(loc, null),
      location: () => (rootRef.current ? { patch: rootRef.current.id, path: pathRef.current } : null),
    }),
    [openAs, mutateDoc, arrangeNodes, goTo, showAt],
  );

  const isActive = root !== null && root.id !== "" && activeId === root.id;
  const builtinSummaries = useMemo(() => presets.map(summarize), [presets]);
  const here: EditorLocation | null = root ? { patch: root.id, path } : null;

  const selectedDef =
    selectedNode && doc && registry
      ? registry.get(doc.nodes.find((n) => n.id === selectedNode)?.kind ?? "")
      : undefined;

  // Toolbar pieces, shared by the wide toolbar and the compact menu sheet.
  const deletePatch = () => {
    if (!root) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    store.remove(root.id);
    rootRef.current = null;
    pathRef.current = [];
    setRoot(null);
    setPath([]);
    setNodes([]);
    setEdges([]);
  };
  // The patch's own name, wherever the canvas is.
  const nameField = root && (
    <input
      className="patch-name"
      aria-label="Patch name"
      value={root.name}
      disabled={!canEdit}
      onChange={(e) => mutateDoc((d) => void (d.name = e.target.value), false, undefined, { at: [] })}
    />
  );
  // Who made it, when it came from somewhere else (a playground submission).
  const creditLabel = root?.credit ? (
    <span className="patch-credit" title="Who sent this pattern">
      by {root.credit}
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
  const activateButton = root && canEdit && showActivate && !isBuiltin(root.id) && (
    <button
      type="button"
      className={isActive ? "active" : ""}
      disabled={root.id === ""}
      onClick={() => store.activate(isActive ? null : root.id)}
    >
      {isActive ? "■ Deactivate" : "▶ Activate"}
    </button>
  );
  const deleteButton = root && canEdit && root.id !== "" && !isBuiltin(root.id) && (
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
    <div className={`patch-tab ${compact ? "compact" : ""}`} ref={tabRef}>
      {!compact && (
        <div className="patch-toolbar">
          <button
            type="button"
            className={browsing ? "active" : ""}
            aria-expanded={browsing}
            title="Built-in patterns and your patches"
            onClick={() => setBrowsing(!browsing)}
          >
            📁 Patches
          </button>
          {canEdit && <button onClick={() => openDoc(emptyPatch())}>＋ New</button>}
          {undoRedo}
          {arrangeButton}
          {nameField}
          {creditLabel}
          {activateButton}
          {deleteButton}
          {toolbarExtra?.({ doc: root, open: openAs })}
          <span className="spacer" />
          {statusLine}
        </div>
      )}

      <NodeContext.Provider
        value={{
          activeId,
          minis,
          drag,
          combines,
          setCollapsed: canEdit ? setCollapsed : null,
          deleteWire: canEdit ? deleteWire : null,
        }}
      >
      <div className="patch-main">
        {!compact && (browsing || !root) && (
          <aside className="patch-browser-panel" aria-label="Patches">
            <div className="patch-panel-head">
              <h3>Patches</h3>
              {root && (
                <button type="button" className="patch-sheet-done" onClick={() => setBrowsing(false)}>
                  Close
                </button>
              )}
            </div>
            <PatchBrowser
              patches={patches}
              builtins={builtinSummaries}
              current={here}
              activeId={activeId}
              onOpen={(loc) => {
                // A pick closes it, so the palette is back for editing.
                goTo(loc, "push");
                setBrowsing(false);
              }}
            />
          </aside>
        )}
        {canEdit && doc && registry && (compact ? sheet === "palette" : !browsing) && (
          <Palette
            types={registryList ?? []}
            subpatches={subpatchChoices}
            hasOutput={doc.nodes.some((n) => n.kind === "output")}
            onPick={(kind, params) => {
              addNode(kind, undefined, params);
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

        <div
          className="patch-canvas"
          ref={canvasRef}
          // A kind dragged out of the palette lands where it is dropped.
          onDragOver={(e) => {
            if (!canEdit || !e.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            const kind = e.dataTransfer.getData(PALETTE_DRAG_TYPE);
            if (!canEdit || !kind) return;
            e.preventDefault();
            const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
            const params = e.dataTransfer.getData(PALETTE_PARAMS_TYPE);
            addNode(kind, [Math.round(at.x), Math.round(at.y)], params ? JSON.parse(params) : undefined);
          }}
        >
          {doc && registry ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
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
              minZoom={MIN_ZOOM}
              onMoveStart={onMoveStart}
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
                : patches.length || presets.length
                  ? "Open a patch from the list, or start a new one."
                  : canEdit
                    ? "No patches yet — hit ＋ New to start."
                    : "No patches yet. Create one on the Gate machine."}
            </div>
          )}
          {root && (path.length > 0 || lock) && (!compact || sheet === null) && (
            <nav className="patch-crumbs" aria-label="Where you are in the patch">
              {crumbs(root, path).map((c, i, all) =>
                i < all.length - 1 ? (
                  <span key={c.path.join("/")} className="patch-crumb">
                    <button type="button" onClick={() => goTo({ patch: root.id, path: c.path }, "push")}>
                      {c.label}
                    </button>
                    <span aria-hidden="true"> › </span>
                  </span>
                ) : (
                  <span key={c.path.join("/")} className="patch-crumb" aria-current="location">
                    {c.label}
                  </span>
                ),
              )}
              {lock && (
                <button
                  type="button"
                  className="patch-lock-chip"
                  onClick={() => setLockTried(true)}
                  title={
                    lock.kind === "builtin"
                      ? "Built in: read-only. Edit a copy."
                      : `Linked: it follows ${lock.name}. Clone it to change it here.`
                  }
                >
                  {lock.kind === "builtin" ? "🔒 Built-in" : `🔗 Linked to ${lock.name}`}
                </button>
              )}
            </nav>
          )}
          {lock && lockTried && (!compact || sheet === null) && (
            <div className="patch-lock-bar" role="alert">
              <p>
                {lock.kind === "builtin" ? (
                  <>
                    <strong>{lock.name}</strong> is built in, so it can't change. Edit a copy of it instead.
                  </>
                ) : (
                  <>
                    This is linked to <strong>{lock.name}</strong>: it follows that patch, so it can't change here.
                  </>
                )}
              </p>
              <div className="patch-lock-actions">
                {lock.kind === "builtin" ? (
                  canEdit && (
                    <button type="button" className="primary" onClick={forkBuiltin}>
                      Make a copy to edit
                    </button>
                  )
                ) : (
                  <>
                    {canEdit && !isBuiltin(root!.id) && (
                      <button type="button" className="primary" onClick={cloneHere}>
                        Clone for this project
                      </button>
                    )}
                    {!isBuiltin(lock.source) && sourceFor(lock.source) && (
                      <button type="button" onClick={() => goTo({ patch: lock.source, path: [] }, "push")}>
                        Edit {lock.name} everywhere
                      </button>
                    )}
                  </>
                )}
                <button type="button" aria-label="Dismiss" onClick={() => setLockTried(false)}>
                  ✕
                </button>
              </div>
            </div>
          )}
          {compact && sheet === null && (
            <div className="patch-canvas-chips">
              <button
                type="button"
                className="patch-name-chip"
                onClick={() => setSheet("menu")}
                aria-label={root ? `Patch: ${root.name || "Untitled"}. Open the patch menu` : "Open the patch menu"}
              >
                <span aria-hidden="true">☰ </span>
                {root ? root.name || "Untitled" : "Patches"}
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
              {/* Undo and Arrange are on the canvas too: in the menu alone a
                  phone never found them. */}
              {canEdit && doc && (
                <>
                  <button
                    type="button"
                    className="patch-tool-chip"
                    onClick={undo}
                    disabled={!history.current.canUndo}
                    aria-label="Undo"
                    title="Undo"
                  >
                    ↶
                  </button>
                  <button
                    type="button"
                    className="patch-tool-chip"
                    onClick={arrangeNodes}
                    disabled={doc.nodes.length < 2}
                    aria-label="Arrange"
                    title="Lay the graph out left to right by its wires (undoable)"
                  >
                    ⇆
                  </button>
                </>
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
            subpatch={subpatchActions}
            onConvertToCode={
              convertToCode
                ? async () => {
                    if (!doc) return;
                    const next = await convertToCode(doc, selectedNode);
                    mutateDoc((d) => {
                      d.nodes = structuredClone(next.nodes);
                      d.edges = structuredClone(next.edges);
                      d.exposed = structuredClone(next.exposed);
                    });
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
                doc: root,
                open: (d, asNew) => {
                  openAs(d, asNew);
                  setSheet(null);
                },
              })}
              {deleteButton}
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
                </div>
              </>
            )}
            <h4>Open</h4>
            <PatchBrowser
              patches={patches}
              builtins={builtinSummaries}
              current={here}
              activeId={activeId}
              onOpen={(loc) => {
                goTo(loc, "push");
                setSheet(null);
              }}
            />
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
