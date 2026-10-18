// The side panel of a Code node: live minis for every output, its ports
// (editable), its body in a real code editor (CodeEditor.tsx: WGSL mode,
// completion, hover docs, error marks), and a reference card. The core
// validates the result on every edit; what it refuses shows under the minis
// and as a mark on the body's line. See plans/code-node.md.

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor, diagnosticsFor, type CodeScope } from "./CodeEditor";
import { NodeContext } from "./context";
import { MiniMeter, MiniRing } from "./minis";
import {
  CODE_SHAPES,
  codeTier,
  isPortName,
  MAX_CODE_PORTS,
  shapeAccepts,
  type CodeDef,
  type CodePort,
  type CodeReference,
  type PatchDoc,
  type PatchNode,
  type PatchShape,
} from "../types";

const SHAPE_NAMES: Record<PatchShape, string> = {
  scalar: "scalar",
  event: "event",
  field_scalar: "grey field",
  field_color: "colour field",
  points: "points",
  effects: "effects",
  texture: "texture",
  pixels: "pixels",
};

/** A port name not yet used by `def`: `in`, `in2`, `in3`… */
function freshPortName(def: CodeDef, base: string): string {
  const taken = new Set([...def.inputs, ...def.outputs].map((p) => p.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

/** The part of the host's error that is about this node, if any. */
function ownError(error: string | null, node: PatchNode): string | null {
  if (!error) return null;
  const names = [node.id, node.name].filter(Boolean);
  const parts = error.split(/(?=Code node ")/);
  const mine = parts.filter((p) => names.some((n) => p.startsWith(`Code node "${n}"`)));
  if (mine.length) return mine.join("").trim();
  // A shader failure that names no node is still worth showing on a GPU node.
  return null;
}

export function CodePanel({
  node,
  doc,
  canEdit,
  onChange,
  error,
  reference,
}: {
  node: PatchNode;
  doc: PatchDoc;
  canEdit: boolean;
  onChange: (mutate: (d: PatchDoc) => void, key?: string) => void;
  /** The renderer's verdict on the patch (`status.error`). */
  error: string | null;
  reference: CodeReference | null;
}) {
  const def = node.code ?? { inputs: [], outputs: [], body: "" };
  const tier = codeTier(def);
  const id = node.id;
  const { activeId, minis } = useContext(NodeContext);
  const live = minis !== null && doc.id !== "" && activeId === doc.id;

  /** Edit this node's definition in the document. */
  const edit = (mutate: (code: CodeDef, n: PatchNode, d: PatchDoc) => void, key?: string) =>
    onChange((d) => {
      const n = d.nodes.find((x) => x.id === id);
      if (!n) return;
      n.code ??= { inputs: [], outputs: [], body: "" };
      mutate(n.code, n, d);
    }, key);

  const portList = (dir: "inputs" | "outputs") => def[dir];

  const rename = (dir: "inputs" | "outputs", index: number, name: string) =>
    edit(
      (code, n, d) => {
        const port = code[dir][index];
        if (!port || port.name === name) return;
        const old = port.name;
        port.name = name;
        // Wires, knob values and exposed entries follow the port.
        for (const e of d.edges) {
          if (dir === "inputs" && e.to.node === id && e.to.port === old) e.to.port = name;
          if (dir === "outputs" && e.from.node === id && e.from.port === old) e.from.port = name;
        }
        if (dir === "inputs") {
          if (old in n.params) {
            n.params[name] = n.params[old];
            delete n.params[old];
          }
          for (const x of d.exposed) if (x.node === id && x.param === old) x.param = name;
        }
      },
      `${id}.code.${dir}.${index}.name`,
    );

  const reshape = (dir: "inputs" | "outputs", index: number, shape: PatchShape) =>
    edit((code, n, d) => {
      const port = code[dir][index];
      if (!port || port.shape === shape) return;
      port.shape = shape;
      // Wires that no longer fit go; a knob that stops being one loses its
      // value and its exposure.
      d.edges = d.edges.filter((e) => {
        if (dir === "inputs" && e.to.node === id && e.to.port === port.name) {
          const from = d.nodes.find((x) => x.id === e.from.node);
          const fromShape = from?.code?.outputs.find((p) => p.name === e.from.port)?.shape;
          return fromShape !== undefined && shapeAccepts(shape, fromShape);
        }
        if (dir === "outputs" && e.from.node === id && e.from.port === port.name) return false;
        return true;
      });
      if (dir === "inputs" && shape !== "scalar") {
        delete n.params[port.name];
        d.exposed = d.exposed.filter((x) => !(x.node === id && x.param === port.name));
      }
    });

  const setRange = (index: number, field: "min" | "max" | "default", value: number) =>
    edit(
      (code) => {
        const port = code.inputs[index];
        if (port && Number.isFinite(value)) port[field] = value;
      },
      `${id}.code.inputs.${index}.${field}`,
    );

  const setIntegrate = (index: number, on: boolean) =>
    edit((code) => {
      const port = code.inputs[index];
      if (!port) return;
      if (on) port.integrate = true;
      else delete port.integrate;
    });

  const remove = (dir: "inputs" | "outputs", index: number) =>
    edit((code, n, d) => {
      const port = code[dir][index];
      if (!port) return;
      code[dir].splice(index, 1);
      d.edges = d.edges.filter(
        (e) =>
          !(dir === "inputs" && e.to.node === id && e.to.port === port.name) &&
          !(dir === "outputs" && e.from.node === id && e.from.port === port.name),
      );
      if (dir === "inputs") {
        delete n.params[port.name];
        d.exposed = d.exposed.filter((x) => !(x.node === id && x.param === port.name));
      }
    });

  const add = (dir: "inputs" | "outputs") =>
    edit((code) => {
      if (code[dir].length >= MAX_CODE_PORTS) return;
      const port: CodePort =
        dir === "inputs"
          ? { name: freshPortName(code, "in"), shape: "scalar", min: 0, max: 1, default: 0 }
          : {
              name: freshPortName(code, "out"),
              // Match the tier the node already has, so adding a port never
              // moves it between CPU and GPU.
              shape: codeTier(code) === "cpu" ? "scalar" : "field_color",
              min: 0,
              max: 1,
              default: 0,
            };
      code[dir].push(port);
    });

  const setBody = (body: string) => edit((code) => void (code.body = body), `${id}.code.body`);

  const tierText =
    tier === "gpu"
      ? "Runs on the GPU, once per pixel: it makes a field."
      : tier === "cpu"
        ? "Runs on the CPU, once per frame: scalars and events."
        : "These ports do not fit one tier: a node either makes fields (GPU; scalar and field inputs) or scalars and events (CPU).";

  const mine = ownError(error, node);
  const scope: CodeScope = useMemo(
    () => ({ tier, inputs: def.inputs, outputs: def.outputs, reference }),
    [tier, def.inputs, def.outputs, reference],
  );
  const diagnostics = useMemo(
    () => diagnosticsFor(error, [node.id, node.name].filter(Boolean), def.body),
    [error, node.id, node.name, def.body],
  );
  const principal = def.outputs.find((p) => p.name === "out") ?? def.outputs[0];

  // The body in a large modal: the one editor instance moves there while it
  // is open (two instances editing one body would fight over the caret).
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!expanded || !dialog || dialog.open) return;
    dialog.showModal();
  }, [expanded]);
  const editor = (
    <CodeEditor
      value={def.body}
      onChange={setBody}
      readOnly={!canEdit}
      scope={scope}
      diagnostics={diagnostics}
      ariaLabel="Body (WGSL)"
    />
  );
  const minisRow = live && def.outputs.length > 0 && (
    <div className="code-minis" aria-label="Live outputs">
      {def.outputs.map((p) =>
        p.shape === "field_color" || p.shape === "field_scalar" ? (
          <div key={p.name} className="code-mini">
            <div className="pnode-mini">
              <MiniRing
                source={minis!}
                mini={p.name === principal?.name ? `node:${id}` : `node:${id}:${p.name}`}
                label={p.name}
              />
            </div>
            <span>{p.name}</span>
          </div>
        ) : (
          <div key={p.name} className="code-mini">
            <div className="pnode-meters">
              <MiniMeter
                source={minis!}
                mini={`scalar:${id}:${p.name}`}
                label={p.name}
                kind={p.shape === "event" ? "event" : "scalar"}
              />
            </div>
          </div>
        ),
      )}
    </div>
  );

  const portRows = (dir: "inputs" | "outputs") =>
    portList(dir).map((p, i) => (
      <div key={i} className={`code-port ${isPortName(p.name) ? "" : "invalid"}`}>
        <input
          className="code-port-name"
          value={p.name}
          disabled={!canEdit}
          spellCheck={false}
          aria-label={`${dir === "inputs" ? "Input" : "Output"} ${i + 1} name`}
          aria-invalid={!isPortName(p.name)}
          onChange={(e) => rename(dir, i, e.target.value)}
        />
        <select
          value={p.shape}
          disabled={!canEdit}
          aria-label={`${dir === "inputs" ? "Input" : "Output"} ${i + 1} shape`}
          onChange={(e) => reshape(dir, i, e.target.value as PatchShape)}
        >
          {CODE_SHAPES.map((s) => (
            <option key={s} value={s}>
              {SHAPE_NAMES[s]}
            </option>
          ))}
        </select>
        {canEdit && (
          <button
            type="button"
            className="code-port-remove"
            title="Remove this port"
            aria-label={`Remove ${dir === "inputs" ? "input" : "output"} ${p.name}`}
            onClick={() => remove(dir, i)}
          >
            ✕
          </button>
        )}
        {dir === "inputs" && p.shape === "scalar" && (
          <div className="code-port-range">
            {(["min", "max", "default"] as const).map((f) => (
              <label key={f}>
                <span>{f}</span>
                <input
                  type="number"
                  step="any"
                  value={p[f]}
                  disabled={!canEdit}
                  aria-label={`Input ${p.name} ${f}`}
                  onChange={(e) => setRange(i, f, Number(e.target.value))}
                />
              </label>
            ))}
            {tier === "gpu" && (
              <label
                className="code-port-rate"
                title="A rate: the engine integrates this knob over time (× master speed) and the body sees the accumulated phase, like a built-in node's speed knob."
              >
                <input
                  type="checkbox"
                  checked={p.integrate ?? false}
                  disabled={!canEdit}
                  aria-label={`Input ${p.name} is a rate`}
                  onChange={(e) => setIntegrate(i, e.target.checked)}
                />
                <span>rate</span>
              </label>
            )}
          </div>
        )}
      </div>
    ));

  return (
    <div className="code-panel">
      <p className={`hint code-tier ${tier ? "" : "error"}`}>{tierText}</p>
      {!expanded && minisRow}
      <div className="code-ports">
        <div className="code-ports-head">
          <span>Inputs</span>
          {canEdit && def.inputs.length < MAX_CODE_PORTS && (
            <button type="button" onClick={() => add("inputs")}>
              ＋ input
            </button>
          )}
        </div>
        {portRows("inputs")}
      </div>
      <div className="code-ports">
        <div className="code-ports-head">
          <span>Outputs</span>
          {canEdit && def.outputs.length < MAX_CODE_PORTS && (
            <button type="button" onClick={() => add("outputs")}>
              ＋ output
            </button>
          )}
        </div>
        {portRows("outputs")}
      </div>
      <div className="patch-field code-body">
        <div className="code-body-head">
          <span>Body (WGSL)</span>
          <button
            type="button"
            className="code-expand"
            title="Open the body in a bigger editor"
            aria-label="Open the body in a bigger editor"
            onClick={() => setExpanded(true)}
          >
            ⤢ Expand
          </button>
        </div>
        {expanded ? <p className="hint code-body-away">Editing in the large view.</p> : editor}
      </div>
      {!expanded && mine && <p className="code-error">⚠ {mine}</p>}
      {expanded && (
        <dialog
          ref={dialogRef}
          className="code-modal"
          aria-label={`${node.name || "Code"} body`}
          onClose={() => setExpanded(false)}
          onCancel={(e) => {
            e.preventDefault();
            setExpanded(false);
          }}
        >
          <div className="code-modal-head">
            <strong>{node.name || "Code"}</strong>
            <span className="hint">{tierText}</span>
            <button type="button" onClick={() => setExpanded(false)} title="Back to the panel (Esc)">
              Done
            </button>
          </div>
          {minisRow}
          <div className="code-modal-body">{editor}</div>
          {mine && <p className="code-error">⚠ {mine}</p>}
        </dialog>
      )}
      <details className="code-ref">
        <summary>What the body can use</summary>
        <ul>
          <li>
            Every input by name; every output by name — assign it (<code>out = …;</code>). Unassigned
            outputs are 0; <code>return;</code> ends the body early. Ctrl+Space lists what is in scope;
            hover a name for its doc. Any built-in node's panel has "Convert to Code" to start from its
            body.
          </li>
          {tier === "gpu" ? (
            <>
              <li>
                <code>c</code>, this pixel: <code>c.theta</code> (angle), <code>c.r01</code> (0 = outer
                end, 1 = inner), <code>c.rn</code> (radius, 1 = outer edge), <code>c.pos</code> (x, y),{" "}
                <code>c.spoke</code>, <code>c.i</code>. <code>G.time</code>, <code>G.dt</code>,{" "}
                <code>G.spokes</code>, <code>G.pixels</code>.
              </li>
              <li>
                A field input is its value here; <code>name_at(ctx)</code> samples it elsewhere, e.g.{" "}
                <code>img_at(ctx_transform(c, angle, zoom, 0.0, 0.0))</code>.
              </li>
              <li>
                Helpers: <code>hsv2rgb(h, s, v)</code>, <code>rgb2hsv</code>, <code>snoise3(vec3f)</code>,{" "}
                <code>fbm3</code>, <code>hash01(u32)</code>, <code>cosine_palette(t, which)</code>,{" "}
                <code>ctx_transform</code>, <code>TAU</code>, <code>PI</code>, and all of WGSL. A grey field
                is an <code>f32</code>, a colour field a <code>vec4f</code> (rgb + alpha).
              </li>
            </>
          ) : (
            <>
              <li>
                A WGSL subset: <code>let</code>/<code>var</code>, <code>if</code>/<code>else</code>,{" "}
                <code>for</code>/<code>while</code>/<code>loop</code>, numbers and booleans, the usual
                operators and math builtins (<code>sin</code>, <code>fract</code>, <code>mix</code>,{" "}
                <code>smoothstep</code>, <code>select</code>…). No vectors.
              </li>
              <li>
                An event input is true on the frame it fires; an event output fires when left true.{" "}
                <code>dt</code> is seconds since the last frame, <code>master_speed</code> the crew's speed
                multiplier; <code>state.name</code> keeps a number across frames (
                <code>state.n += 1.0;</code>).
              </li>
            </>
          )}
        </ul>
      </details>
    </div>
  );
}
