// Node-graph patch editor (React Flow canvas), shared by the gate app and the
// browser playground. Where patches live and what runs them is the host's
// business: it hands in a PatchStore (list/get/save/delete/activate), the node
// palette (generated from the Rust registry, so the editor can never offer a
// node codegen doesn't understand), presets, and optionally a MiniSource for
// the live node thumbnails and meters.

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./editor.css";
import { MiniMeter, MiniRing, type MiniSource } from "./minis";
import {
  PATCH_FORMAT,
  shapeAccepts,
  type PatchDoc,
  type PatchNode,
  type PatchNodeType,
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
}

/** What node views need from the editor without threading it through data. */
const NodeContext = createContext<{ activeId: string | null; minis: MiniSource | null }>({
  activeId: null,
  minis: null,
});

const CATEGORY_LABELS: Record<PatchNodeType["category"], string> = {
  input: "Inputs",
  scalar: "Scalar ops",
  generator: "Generators",
  field: "Field ops",
  combine: "Combine",
  texture: "Texture",
  sink: "Output",
};

const CATEGORY_ORDER: PatchNodeType["category"][] = [
  "input",
  "scalar",
  "generator",
  "field",
  "combine",
  "texture",
  "sink",
];

type Registry = Map<string, PatchNodeType>;

/** All connectable input ports of a node type: shaped inputs, then every
 * `number` param (knob doubles as a Scalar port). */
function inputPorts(def: PatchNodeType): { name: string; shape: PatchShape }[] {
  return [
    ...def.inputs,
    ...def.params
      .filter((p) => p.kind === "number")
      .map((p) => ({ name: p.name, shape: "scalar" as PatchShape })),
  ];
}

function portShape(def: PatchNodeType | undefined, port: string, dir: "in" | "out"): PatchShape | null {
  if (!def) return null;
  if (dir === "out") return def.outputs.find((p) => p.name === port)?.shape ?? null;
  return inputPorts(def).find((p) => p.name === port)?.shape ?? null;
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
  },
  "patch"
>;

const PatchNodeView = memo(function PatchNodeView({ data, selected }: NodeProps<PatchFlowNode>) {
  const { node, def } = data;
  const { activeId, minis } = useContext(NodeContext);
  if (!def) {
    return <div className="pnode pnode-unknown">unknown: {node.kind}</div>;
  }
  const ins = inputPorts(def);
  // Mini visualizers, per output style: field outputs get a thumbnail laid out
  // like the hardware; scalar outputs get amplitude meters. Only for the patch
  // that is actually on air — that is the graph the backend is evaluating.
  const live = minis !== null && data.docId !== "" && activeId === data.docId;
  const outShape = def.outputs.find((p) => p.name === "out")?.shape;
  const showRing = live && (outShape === "field_color" || outShape === "field_scalar");
  const meterPorts = live
    ? def.outputs.filter(
        (p) => p.shape === "scalar" && (p.name === "out" || data.wiredOut.includes(p.name)),
      )
    : [];
  return (
    <div className={`pnode cat-${def.category} ${selected ? "selected" : ""}`}>
      <div className="pnode-head">
        {def.label}
        {node.name && <span className="pnode-name"> · {node.name}</span>}
      </div>
      {showRing && (
        <div className="pnode-mini">
          <MiniRing source={minis!} mini={`node:${node.id}`} label={node.name || def.label} />
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
            />
          ))}
        </div>
      )}
      <div className="pnode-body">
        <div className="pnode-col">
          {ins.map((p) => (
            <div key={p.name} className="pnode-port in">
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
          {def.outputs.map((p) => (
            <div key={p.name} className="pnode-port out">
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
    },
  }));
}

function edgeId(e: PatchDoc["edges"][number]): string {
  return `${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`;
}

function toFlowEdges(doc: PatchDoc, registry: Registry): FlowEdge[] {
  return doc.edges.map((e) => {
    const def = registry.get(doc.nodes.find((n) => n.id === e.from.node)?.kind ?? "");
    const shape = portShape(def, e.from.port, "out") ?? "scalar";
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

function ParamPanel({
  doc,
  nodeId,
  registry,
  canEdit,
  onChange,
}: {
  doc: PatchDoc;
  nodeId: string;
  registry: Registry;
  canEdit: boolean;
  onChange: (mutate: (d: PatchDoc) => void) => void;
}) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  const def = node && registry.get(node.kind);
  if (!node || !def) return null;

  const wiredInto = (param: string) =>
    doc.edges.find((e) => e.to.node === node.id && e.to.port === param);
  const isExposed = (param: string) =>
    doc.exposed.some((x) => x.node === node.id && x.param === param);

  return (
    <aside className="patch-side">
      <h3>{def.label}</h3>
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
      {def.params.map((p) => {
        const value = node.params[p.name] ?? p.default;
        const wire = wiredInto(p.name);
        const set = (v: number) =>
          onChange((d) => {
            const n = d.nodes.find((x) => x.id === nodeId);
            if (n) n.params[p.name] = v;
          });
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

// --- editor ---------------------------------------------------------------

function Editor({
  store,
  registry: registryList,
  presets,
  ready,
  activeId,
  status,
  canEdit,
  readOnlyHint,
  minis = null,
  showActivate = true,
  onDocChange,
  toolbarExtra,
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
  const docRef = useRef(doc);
  docRef.current = doc;
  const registryRef = useRef(registry);
  registryRef.current = registry;
  const requestedId = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  useEffect(() => {
    onDocChangeRef.current?.(doc);
  }, [doc]);

  // The patch list, once the store is reachable.
  useEffect(() => {
    if (ready) store.list();
  }, [ready, store]);

  // Stable (ref-based) so the long-lived message subscription never goes stale.
  const openDoc = useCallback((d: PatchDoc) => {
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
        if (requestedId.current === msg.patch.id) {
          requestedId.current = null;
          openDoc(msg.patch);
        } else if (docRef.current && docRef.current.id === "") {
          // Save echo for a brand-new patch: adopt the assigned id, keep edits.
          setDoc((d) => (d && d.id === "" ? { ...d, id: msg.patch.id } : d));
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

  /** All document mutations funnel through here: clone, mutate, sync, save. */
  const mutateDoc = useCallback(
    (mutate: (d: PatchDoc) => void, resync = true) => {
      setDoc((prev) => {
        if (!prev) return prev;
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

  // --- flow event handlers ---

  const onNodesChange = useCallback(
    (changes: NodeChange<PatchFlowNode>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      for (const ch of changes) {
        if (ch.type === "select") {
          setSelectedNode(ch.selected ? ch.id : null);
        }
      }
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
      const from = portShape(
        registry.get(d.nodes.find((n) => n.id === conn.source)?.kind ?? ""),
        conn.sourceHandle,
        "out",
      );
      const into = portShape(
        registry.get(d.nodes.find((n) => n.id === conn.target)?.kind ?? ""),
        conn.targetHandle,
        "in",
      );
      if (!from || !into || !shapeAccepts(into, from)) return false;
      // One wire per input.
      return !d.edges.some(
        (e) => e.to.node === conn.target && e.to.port === conn.targetHandle,
      );
    },
    [registry],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!canEdit || !conn.sourceHandle || !conn.targetHandle) return;
      mutateDoc((d) => {
        d.edges.push({
          from: { node: conn.source, port: conn.sourceHandle! },
          to: { node: conn.target, port: conn.targetHandle! },
        });
      });
    },
    [canEdit, mutateDoc],
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

  const addNode = useCallback(
    (kind: string) => {
      const center = flow.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      mutateDoc((d) => {
        let i = d.nodes.length + 1;
        while (d.nodes.some((n) => n.id === `n${i}`)) i++;
        d.nodes.push({
          id: `n${i}`,
          kind,
          name: "",
          params: {},
          pos: [Math.round(center.x), Math.round(center.y)],
        });
      });
    },
    [flow, mutateDoc],
  );

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

  return (
    <div className="patch-tab">
      <div className="patch-toolbar">
        <select
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
        {canEdit && presets.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const preset = presets.find((p) => p.id === e.target.value);
              if (!preset) return;
              // Instantiate a COPY: blank id makes the autosave mint a fresh
              // patch, so the built-in template is never overwritten.
              const copy = structuredClone(preset);
              copy.id = "";
              openDoc(copy);
              scheduleSave(copy);
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
        {doc && (
          <>
            <input
              className="patch-name"
              value={doc.name}
              disabled={!canEdit}
              onChange={(e) => mutateDoc((d) => void (d.name = e.target.value), false)}
            />
            {canEdit && showActivate && (
              <button
                className={isActive ? "active" : ""}
                disabled={doc.id === ""}
                onClick={() => store.activate(isActive ? null : doc.id)}
              >
                {isActive ? "■ Deactivate" : "▶ Activate"}
              </button>
            )}
            {canEdit && doc.id !== "" && (
              <button
                className="danger"
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    setTimeout(() => setConfirmDelete(false), 3000);
                    return;
                  }
                  store.remove(doc.id);
                  setDoc(null);
                  setNodes([]);
                  setEdges([]);
                }}
              >
                {confirmDelete ? "Really delete?" : "Delete"}
              </button>
            )}
          </>
        )}
        {toolbarExtra?.({ doc, open: openAs })}
        <span className="spacer" />
        {status?.error && <span className="patch-status error">⚠ {status.error}</span>}
        {status?.active && !status.error && (
          <span className="patch-status ok">patch rendering</span>
        )}
        {!canEdit && readOnlyHint && <span className="hint">{readOnlyHint}</span>}
      </div>

      <NodeContext.Provider value={{ activeId, minis }}>
      <div className="patch-main">
        {canEdit && doc && registry && (
          <aside className="patch-palette">
            {grouped.map((g) => (
              <div key={g.category} className="palette-group">
                <h4>{g.label}</h4>
                {g.types.map((t) => (
                  <button key={t.id} className={`palette-item cat-${t.category}`} onClick={() => addNode(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            ))}
          </aside>
        )}

        <div className="patch-canvas">
          {doc && registry ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              onNodesDelete={onNodesDelete}
              onEdgesDelete={onEdgesDelete}
              isValidConnection={isValidConnection}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              elementsSelectable
              deleteKeyCode={canEdit ? ["Backspace", "Delete"] : []}
              zoomOnScroll
              zoomOnPinch
              fitView
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
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
        </div>

        {doc && registry && selectedNode && (
          <ParamPanel
            doc={doc}
            nodeId={selectedNode}
            registry={registry}
            canEdit={canEdit}
            onChange={mutateDoc}
          />
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
