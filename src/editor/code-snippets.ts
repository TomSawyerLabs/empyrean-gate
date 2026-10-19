// Snippets in the Code body's completion list: the loop forms each tier
// accepts and the idioms the built-in generators are made of, written
// against the node's own ports so they compile as inserted. Tab moves
// between the fields; see CodeMirror's `snippet` for the template syntax.

import { snippetCompletion, type Completion } from "@codemirror/autocomplete";
import type { CodeDef, PatchDoc } from "../types";
import type { CodeScope } from "./CodeEditor";

export interface CodeSnippet {
  label: string;
  /** CodeMirror snippet syntax: `${name}` / `${1:default}` fields. */
  template: string;
  detail: string;
  info?: string;
}

function snip(label: string, template: string, detail: string, info?: string): CodeSnippet {
  return { label, template, detail, info };
}

/** The snippets as completions. */
export function snippetsFor(scope: CodeScope): Completion[] {
  return snippetTemplates(scope).map((x) =>
    snippetCompletion(x.template, { label: x.label, detail: x.detail, info: x.info, type: "text", boost: 1 }),
  );
}

/** A template with every field at its default (a bare `${name}` is its
 * name, an empty one nothing): the text an accepted snippet starts as. */
export function expandSnippet(template: string): string {
  return template
    .replace(/[$#]\{(?:\d+(?::([^{}]*))?|((?:\\[{}]|[^{}])*))\}/g, (_m, def?: string, name?: string) => def ?? name ?? "")
    .replace(/\\([{}])/g, "$1")
    .replace(/\t/g, "  ");
}

/** The snippets for the node `scope` describes. */
export function snippetTemplates(scope: CodeScope): CodeSnippet[] {
  const out = scope.outputs.find((p) => p.name === "out") ?? scope.outputs[0];
  const o = out?.name ?? "out";
  const fields = scope.inputs.filter((p) => p.shape === "field_scalar" || p.shape === "field_color");
  const buffers = scope.inputs.filter((p) => p.shape === "points" || p.shape === "effects");
  const list: CodeSnippet[] = [];

  if (scope.tier === "cpu") {
    list.push(
      snip("if", "if (${condition}) {\n\t${}\n}", "if block"),
      snip("ifelse", "if (${condition}) {\n\t${}\n} else {\n\t${}\n}", "if / else"),
      snip("for", "for (var ${1:i} = 0; ${1:i} < ${2:8}; ${1:i}++) {\n\t${}\n}", "counted loop"),
      snip(
        "counter",
        "state.${1:t} += dt * ${2:1.0};\n" + `${o} = fract(state.\${1:t});`,
        "a phase that keeps running",
        "state.<name> keeps its number across frames; dt is seconds since the last one.",
      ),
      snip(
        "smooth",
        "state.${1:s} = mix(state.${1:s}, ${2:value}, 1.0 - exp(-dt * ${3:8.0}));\n" + `${o} = state.\${1:s};`,
        "follow a value smoothly",
        "Moves toward the value at a rate that does not depend on the frame rate.",
      ),
      snip(
        "rising",
        "let ${1:high} = ${2:value} > ${3:0.5};\nif (${1:high} && state.${4:was} < 0.5) {\n\t${}\n}\nstate.${4:was} = select(0.0, 1.0, ${1:high});",
        "act once when a value crosses up",
      ),
    );
    const ev = scope.outputs.find((p) => p.shape === "event");
    if (ev) list.push(snip("fire", `if (\${condition}) {\n\t${ev.name} = true;\n}`, `fire ${ev.name} this frame`));
    return list;
  }

  const colour = out?.shape !== "field_scalar";
  const assign = (grey: string) => (colour ? `${o} = vec4f(vec3f(${grey}), 1.0);` : `${o} = ${grey};`);
  list.push(
    snip("if", "if (${condition}) {\n\t${}\n}", "if block"),
    snip("ifelse", "if (${condition}) {\n\t${}\n} else {\n\t${}\n}", "if / else"),
    snip(
      "for",
      "for (var ${1:i} = 0u; ${1:i} < ${2:8u}; ${1:i}++) {\n\t${}\n}",
      "loop with a fixed bound",
      "A field body's loop needs a literal bound (up to 4096) in its condition.",
    ),
    snip(
      "ripple",
      "let ${1:wave} = sin(c.rn * ${2:12.0} - G.time * ${3:2.0});\n" + assign("0.5 + 0.5 * ${1:wave}"),
      "rings moving outward",
    ),
    snip(
      "band",
      "let ${1:band} = smoothstep(${2:0.4}, ${3:0.5}, c.r01) * (1.0 - smoothstep(${4:0.5}, ${5:0.6}, c.r01));",
      "a soft ring between two radii",
    ),
    snip("spokes", "let ${1:even} = f32(c.spoke % ${2:2u} == 0u);", "every other spoke"),
  );
  if (colour) {
    list.push(
      snip(
        "rainbow",
        `${o} = vec4f(hsv2rgb(fract(c.theta / TAU + G.time * \${1:0.1}), \${2:1.0}, \${3:1.0}), 1.0);`,
        "hue around the ring",
      ),
    );
  }
  list.push(snip("noise", "let ${1:n} = snoise3(vec3f(c.pos * ${2:3.0}, G.time * ${3:0.3}));", "simplex noise, -1..1"));
  for (const f of fields) {
    list.push(
      snip(
        `${f.name}_spin`,
        `let \${1:moved} = ${f.name}_at(ctx_transform(c, \${2:G.time * 0.2}, \${3:1.0}, 0.0, 0.0));`,
        `${f.name}, turned and zoomed`,
        "ctx_transform(ctx, rot, zoom, kaleido, mirror): this pixel, seen turned, zoomed or folded.",
      ),
    );
  }
  for (const b of buffers) {
    const points = b.shape === "points";
    const one = points ? "${2:dab}" : "${2:fx}";
    const draw = points ? `dab_color(${one}, c, \${1:k})` : `effect_color(${one}, c)`;
    const on = points ? "" : `if (!${b.name}_on(\${1:k})) { continue; }\n\t`;
    list.push(
      snip(
        `${b.name}_each`,
        `for (var \${1:k} = 0u; \${1:k} < ${b.name}_count; \${1:k}++) {\n\t${on}let ${one} = ${b.name}_at(\${1:k});\n\tlet \${3:col} = ${draw};\n\t\${}\n}`,
        `every live ${points ? "Dab" : "Effect"} on ${b.name}`,
      ),
    );
  }
  return list;
}

// --- every snippet as a patch (the browser shader check, unit tests) ---------

/** Names a snippet leaves for the writer to fill in (`${condition}`), so an
 * expanded snippet compiles as it stands. */
const PRELUDE = "let condition = true;\nlet value = 0.5;\n";

/** The Code nodes the snippet sets are written for: a GPU node with a
 * colour (or grey) output and one input of each kind a snippet uses, and a
 * CPU node with a scalar and an event each way. */
export const SNIPPET_NODES: { tier: string; def: Omit<CodeDef, "body"> }[] = [
  {
    tier: "GPU colour",
    def: {
      inputs: [
        { name: "img", shape: "field_color", min: 0, max: 1, default: 0 },
        { name: "pts", shape: "points", min: 0, max: 1, default: 0 },
        { name: "fx", shape: "effects", min: 0, max: 1, default: 0 },
        { name: "twist", shape: "scalar", min: 0, max: 4, default: 1 },
      ],
      outputs: [{ name: "out", shape: "field_color", min: 0, max: 1, default: 0 }],
    },
  },
  {
    tier: "GPU grey",
    def: {
      inputs: [{ name: "grey", shape: "field_scalar", min: 0, max: 1, default: 0 }],
      outputs: [{ name: "out", shape: "field_scalar", min: 0, max: 1, default: 0 }],
    },
  },
  {
    tier: "CPU",
    def: {
      inputs: [
        { name: "x", shape: "scalar", min: 0, max: 1, default: 0 },
        { name: "go", shape: "event", min: 0, max: 1, default: 0 },
      ],
      outputs: [
        { name: "out", shape: "scalar", min: 0, max: 1, default: 0 },
        { name: "hit", shape: "event", min: 0, max: 1, default: 0 },
      ],
    },
  },
];

/** One patch per snippet per node above: the snippet expanded at its
 * defaults as the node's whole body (after PRELUDE). A GPU node feeds the
 * Output (input `into`); a CPU node stands beside one. */
export function snippetDocs(format: number, into: string): { label: string; doc: PatchDoc }[] {
  const docs: { label: string; doc: PatchDoc }[] = [];
  for (const { tier, def } of SNIPPET_NODES) {
    const cpu = tier === "CPU";
    const scope: CodeScope = { tier: cpu ? "cpu" : "gpu", inputs: def.inputs, outputs: def.outputs, reference: null };
    for (const x of snippetTemplates(scope)) {
      const code: CodeDef = { ...def, body: `${PRELUDE}${expandSnippet(x.template)}\n` };
      docs.push({
        label: `snippet "${x.label}" (${tier})`,
        doc: {
          format,
          id: `snippet-${x.label}`,
          name: x.label,
          description: "",
          nodes: [
            { id: "n", kind: "code", name: "n", params: {}, pos: [0, 0], code },
            { id: "o", kind: "output", name: "o", params: {}, pos: [0, 0] },
          ],
          edges: cpu ? [] : [{ from: { node: "n", port: "out" }, to: { node: "o", port: into } }],
          exposed: [],
        },
      });
    }
  }
  return docs;
}
