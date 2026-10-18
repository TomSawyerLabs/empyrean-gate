// The side panel of a Code node: its ports (editable), its body (WGSL), and
// a reference card. The core validates the result on every edit; what it
// refuses shows in the editor's status line, with body line numbers when a
// shader error lands inside the body. See plans/code-node.md.

import { useRef, useState, type KeyboardEvent } from "react";
import {
  CODE_SHAPES,
  codeTier,
  isPortName,
  MAX_CODE_PORTS,
  shapeAccepts,
  type CodeDef,
  type CodePort,
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

/** A port name not yet used by `def`: `in2`, `in3`… */
function freshPortName(def: CodeDef, base: string): string {
  const taken = new Set([...def.inputs, ...def.outputs].map((p) => p.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export function CodePanel({
  node,
  canEdit,
  onChange,
}: {
  node: PatchNode;
  canEdit: boolean;
  onChange: (mutate: (d: PatchDoc) => void, key?: string) => void;
}) {
  const def = node.code ?? { inputs: [], outputs: [], body: "" };
  const tier = codeTier(def);
  const id = node.id;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [showRef, setShowRef] = useState(false);

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
              name: freshPortName(code, code.outputs.length === 0 ? "out" : "out"),
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

  const onBodyKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = `${el.value.slice(0, start)}  ${el.value.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      const t = bodyRef.current;
      if (t) t.setSelectionRange(start + 2, start + 2);
    });
  };

  const tierText =
    tier === "gpu"
      ? "Runs on the GPU, once per pixel: it makes a field."
      : tier === "cpu"
        ? "Runs on the CPU, once per frame: scalars and events."
        : "These ports do not fit one tier: a node either makes fields (GPU; scalar and field inputs) or scalars and events (CPU).";

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
          </div>
        )}
      </div>
    ));

  return (
    <div className="code-panel">
      <p className={`hint code-tier ${tier ? "" : "error"}`}>{tierText}</p>
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
      <label className="patch-field code-body">
        <span>Body (WGSL)</span>
        <textarea
          ref={bodyRef}
          value={def.body}
          disabled={!canEdit}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={Math.min(24, Math.max(6, def.body.split("\n").length + 1))}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onBodyKey}
        />
      </label>
      <details className="code-ref" open={showRef} onToggle={(e) => setShowRef(e.currentTarget.open)}>
        <summary>What the body can use</summary>
        <ul>
          <li>
            Every input by name; every output by name — assign it (<code>out = …;</code>). Unassigned
            outputs are 0.
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
                <code>dt</code> is seconds since the last frame; <code>state.name</code> keeps a number
                across frames (<code>state.n += 1.0;</code>).
              </li>
            </>
          )}
        </ul>
      </details>
    </div>
  );
}
