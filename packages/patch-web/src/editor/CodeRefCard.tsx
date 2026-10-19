// What a Code body can use: the notes (the panel's "What the body can use"
// card) and, in the large view, a column listing every name in scope, by
// group and filterable, each one inserted at the caret by a click.

import { useMemo, useState } from "react";
import { CTX_FALLBACK, portFns, WGSL_BUILTINS, type CodeScope } from "./CodeEditor";
import { snippetTemplates } from "./code-snippets";

export interface RefItem {
  /** What is shown, and what the filter matches. */
  label: string;
  detail: string;
  doc?: string;
  /** Plain text to insert, with the caret `caret` into it… */
  text?: string;
  caret?: number;
  /** …or a snippet template. */
  snippet?: string;
}

export interface RefGroup {
  title: string;
  items: RefItem[];
}

const call = (name: string, detail: string, doc?: string): RefItem => ({
  label: name,
  detail,
  doc,
  text: `${name}()`,
  caret: name.length + 1,
});

const word = (name: string, detail: string, doc?: string): RefItem => ({ label: name, detail, doc, text: name });

/** The column's contents for the node `s` describes. */
export function refGroups(s: CodeScope): RefGroup[] {
  const ref = s.reference;
  const node: RefItem[] = [];
  for (const p of s.inputs) {
    if (p.shape === "points" || p.shape === "effects") node.push(word(`${p.name}_count`, "u32 · how many are live"));
    else node.push(word(p.name, `input · ${p.shape.replace("_", " ")}`));
    for (const f of portFns(p)) node.push(call(f.name, f.signature.slice(f.name.length), f.doc));
  }
  for (const p of s.outputs) node.push(word(p.name, `output · ${p.shape.replace("_", " ")} — assign it`));

  const snippets = snippetTemplates(s).map((x) => ({ label: x.label, detail: x.detail, doc: x.info, snippet: x.template }));
  const fnItems = (fns: { name: string; signature: string; doc: string }[]) =>
    fns.filter((f) => !f.name.startsWith("_") && f.name !== "main").map((f) => call(f.name, f.signature.slice(f.name.length), f.doc));

  if (s.tier === "cpu") {
    return [
      { title: "This node", items: node },
      {
        title: "This frame",
        items: [
          word("dt", "f32 · seconds since the last frame"),
          word("master_speed", "f32 · the crew's speed multiplier"),
          { label: "state.", detail: "a number kept across frames", text: "state." },
          word("PI", "f32"),
          word("TAU", "f32 · 2π"),
        ],
      },
      { title: "Snippets", items: snippets },
      { title: "Builtins", items: fnItems(ref?.cpu_builtins.length ? ref.cpu_builtins : WGSL_BUILTINS.filter((b) => !/^(vec|length|distance|normalize|dot|cross|reflect|any|all)/.test(b.name))) },
    ];
  }
  const ctx = ref?.structs.find((x) => x.name === "Ctx")?.fields ?? CTX_FALLBACK;
  const globals = ref?.structs.find((x) => x.name === "Globals")?.fields ?? [];
  return [
    { title: "This node", items: node },
    { title: "This pixel", items: ctx.map((f) => word(`c.${f.name}`, f.type, f.doc)) },
    {
      title: "Time and the gate",
      items: [
        ...globals.map((f) => word(`G.${f.name}`, f.type, f.doc)),
        ...(ref?.globals ?? []).filter((g) => g.name !== "G").map((g) => word(g.name, g.type, g.doc)),
      ],
    },
    { title: "Snippets", items: snippets },
    { title: "Helpers", items: fnItems(ref?.helpers ?? []) },
    { title: "WGSL", items: fnItems(WGSL_BUILTINS) },
  ];
}

/** The large view's reference column. */
export function CodeRefColumn({
  scope,
  onInsert,
  onSnippet,
}: {
  scope: CodeScope;
  onInsert: (text: string, caret?: number) => void;
  onSnippet: (template: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => refGroups(scope), [scope]);
  const q = filter.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, items: q ? g.items.filter((i) => i.label.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)) : g.items }))
    .filter((g) => g.items.length);
  return (
    <aside className="code-refcol" aria-label="What the body can use">
      <input
        type="search"
        className="code-refcol-filter"
        placeholder="Filter…"
        aria-label="Filter what the body can use"
        value={filter}
        spellCheck={false}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="code-refcol-list">
        {shown.map((g) => (
          <section key={g.title}>
            <h4>{g.title}</h4>
            {g.items.map((i) => (
              <button
                key={`${g.title}.${i.label}`}
                type="button"
                className="code-refcol-item"
                title={i.doc || undefined}
                // Keep the editor's selection: the insert goes where the caret is.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (i.snippet ? onSnippet(i.snippet) : onInsert(i.text ?? i.label, i.caret))}
              >
                <code>{i.label}</code>
                <span>{i.detail}</span>
                {i.doc && <small>{i.doc}</small>}
              </button>
            ))}
          </section>
        ))}
        {shown.length === 0 && <p className="hint">Nothing matches.</p>}
      </div>
    </aside>
  );
}

/** The notes on what a body can use, per tier (the panel's card). */
export function CodeRefNotes({ tier }: { tier: "cpu" | "gpu" | null }) {
  return (
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
            <code>img_at(ctx_transform(c, angle, zoom, 0.0, 0.0))</code>. A points or effects input
            gives <code>name_count</code> and <code>name_at(k)</code> (a <code>Dab</code> /{" "}
            <code>Effect</code>; <code>name_on(k)</code> says if effect k is on this wire); draw them with{" "}
            <code>dab_color(D, c, k)</code> / <code>effect_color(E, c)</code>. A texture input is its colour
            here, <code>name_at(uv)</code> elsewhere.
          </li>
          <li>
            Loops: <code>for</code> with a fixed bound only (a literal up to 4096, a <code>_count</code>, or a{" "}
            <code>let</code> clamped to a literal); <code>while</code> and <code>loop</code> are refused, since
            an unbounded loop would hang the gate's GPU.
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
  );
}
