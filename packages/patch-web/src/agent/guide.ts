// The guide to making patterns, written for an AI agent (and readable by a
// person): what the gate is, the document format, the wire shapes, the
// workflow, the Code node, and a reference for every node type. Generated
// from the patch core itself (registry, shapes, Code reference, limits), so
// it describes exactly the build it ships with.

import { grouped, groupOf } from "../groups";
import type { PatchCore } from "../runtime/core";
import { MAX_CODE_BYTES, MAX_CODE_PORTS, type PatchNodeType, type PatchParamDef } from "../types";

export interface GuideOptions {
  /** How the reader reaches the tools, in one paragraph of markdown (the
   * playground: WebMCP and `window.empyrean`; the CLI: its MCP server). */
  access?: string;
  /** Where the playground is, for links. */
  playground?: string;
  /** Leave out the node reference (for a short overview). */
  brief?: boolean;
}

/** One line about a node type: what an agent needs to pick one. */
export function nodeSummary(t: PatchNodeType) {
  return {
    kind: t.id,
    label: t.label,
    category: t.category,
    group: groupOf(t).id,
    description: t.description ?? "",
    inputs: t.inputs.map((p) => `${p.name}:${p.shape}`),
    outputs: t.outputs.map((p) => `${p.name}:${p.shape}`),
    params: t.params.map((p) => p.name),
  };
}

/** JSON as a person would lay it out: a value on one line when it fits in
 * `width`, otherwise one member per line. */
export function pretty(value: unknown, indent = "", width = 100): string {
  const flat = inline(value);
  if (flat.length + indent.length <= width || value === null || typeof value !== "object") return flat;
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => inner + pretty(v, inner, width)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${pretty(v, inner, width)}`);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(value);
}

/** Shader lib functions a body must not call (`finish` writes the frame
 * buffer) or has no use for (the noise's own internals). */
const INTERNAL_HELPERS = new Set(["finish", "mod289v3", "mod289v4", "permute4", "taylor_inv_sqrt4"]);

/** The first sentence of a doc comment (they run to paragraphs). */
function firstSentence(doc: string): string {
  const m = /^(.+?[.!?])(\s|$)/s.exec(doc.trim());
  return (m ? m[1]! : doc.trim()).replace(/\s+/g, " ");
}

function range(p: PatchParamDef): string {
  if (typeof p.kind === "object") return p.kind.select.map((label, i) => `${i} = ${label}`).join(", ");
  return `${p.min} … ${p.max}`;
}

function nodeReference(t: PatchNodeType): string {
  const lines = [`### \`${t.id}\` — ${t.label}`, ""];
  if (t.description) lines.push(t.description, "");
  if (t.inputs.length) {
    lines.push("Inputs:");
    for (const p of t.inputs) lines.push(`- \`${p.name}\` (${p.shape})${p.description ? ` — ${p.description}` : ""}`);
    lines.push("");
  }
  if (t.outputs.length) {
    lines.push("Outputs:");
    for (const p of t.outputs) lines.push(`- \`${p.name}\` (${p.shape})${p.description ? ` — ${p.description}` : ""}`);
    lines.push("");
  }
  if (t.params.length) {
    lines.push("| Param | Range | Default | |", "| --- | --- | --- | --- |");
    for (const p of t.params) {
      const notes = [p.description ?? "", typeof p.kind === "object" ? "(select; not wirable)" : "", p.integrate ? "(a rate: integrated over time)" : ""]
        .filter(Boolean)
        .join(" ");
      lines.push(`| \`${p.name}\` | ${range(p)} | ${p.default} | ${notes.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const EXAMPLE = {
  format: 5,
  id: "",
  name: "Slow rainbow",
  description: "A rainbow that turns slowly, brighter on the beat.",
  nodes: [
    { id: "aud", kind: "audio", name: "", params: {}, pos: [0, 0] },
    { id: "bow", kind: "rainbow", name: "", params: { speed: 0.2, turns: 1 }, pos: [0, 0] },
    { id: "out", kind: "output", name: "", params: {}, pos: [0, 0] },
  ],
  edges: [
    { from: { node: "aud", port: "level" }, to: { node: "bow", port: "brightness" } },
    { from: { node: "bow", port: "out" }, to: { node: "out", port: "in" } },
  ],
  exposed: [{ node: "bow", param: "turns", label: "Turns" }],
};

export function agentGuide(core: PatchCore, options: GuideOptions = {}): string {
  const { limits } = core;
  const out: string[] = [];
  const add = (...s: string[]) => out.push(...s);
  const code = core.codeReference;

  add(
    "# Making patterns for the Empyrean Gate",
    "",
    "The Empyrean Gate is a ring of light hung over a dance floor: 64 spokes of 378 LEDs each " +
      "(24,192 lights), arranged radially between an inner and an outer ring. A *pattern* is a " +
      "**patch**: a graph of nodes whose wires carry numbers, events and whole fields of color, ending " +
      "in one Output node whose input is the picture on the gate. The gate compiles a patch into a " +
      "single GPU shader that runs once per LED every frame; the playground runs the very same " +
      "compiler and shader in the browser, so a patch looks there as it will on the gate.",
    "",
  );
  if (options.access) add("## How you reach the tools", "", options.access, "");

  add(
    "## Workflow",
    "",
    "1. Read this guide; skim the node types (`list_node_types`) and the presets (`list_presets`).",
    "2. Start from a preset close to the idea (`open_preset`, or `get_preset` to read one), or write a patch from scratch.",
    "3. Apply it (`set_patch`, or small changes to the open patch with `edit_patch`). A patch without the open patch's " +
      "`id` opens as a new one; one with it (from `get_patch`) replaces it. A patch that does not validate is *not* " +
      "applied; the errors say why.",
    "4. Look at it (`snapshot`: several frames over time, as pictures and numbers). Patterns move: look at more than one frame.",
    "5. Refine, look again. Name it and describe it (`edit_patch` with `set_info`).",
    "6. Hand it over: a link (`share_link`) opens it in anyone's playground. Sending it to the crew is the person's",
    "   decision: they press **Submit** in the playground themselves. Never try to submit on their behalf.",
    "",
    "The person may be editing the same patch in the editor while you work; `get_patch` before an edit if time has passed.",
    "Every change you make is one undo step in their editor.",
    "",
  );

  add(
    "## The patch document",
    "",
    "A patch is JSON (the same file the gate saves and opens). Minimal example:",
    "",
    "```json",
    pretty(EXAMPLE),
    "```",
    "",
    `- \`format\`: ${limits.patchFormat} (current). Older documents are upgraded on the way in.`,
    "- `id`: leave empty for a new patch; the store assigns one.",
    "- `nodes[]`: `id` (unique in the patch, short: `bow`, `n3`), `kind` (a node type), `name` (a label, may be empty), " +
      "`params` (knob values by param name; missing ones take the default), `pos` (canvas position; " +
      "all `[0, 0]` or `arrange: true` lays the graph out for you), `collapsed: true` to show it minimized " +
      "in the editor (looks only), and on a Blend `layers` (1..8, default 1): layer k > 1 adds the input " +
      "`over{k}`, the select `mode{k}` and the knob `opacity{k}`, each applied in turn on top of the layers " +
      "below. Stack several pictures in one Blend rather than chaining Blends.",
    "- `edges[]`: `{ from: { node, port }, to: { node, port } }`, from an output port to an input port. " +
      "An input takes one wire.",
    "- `exposed[]`: knobs promoted to the gate's Control surface (phones on the dance floor can play them).",
    "- A Still image or Clip node carries its picture in `media` (a data URL); a Sub-patch node its document in `sub`; " +
      "a Code node its ports and body in `code`.",
    `- Limits: at most ${limits.maxNodes} nodes and ${limits.maxEdges} edges.`,
    "",
    "**Every Number param is also an input port of the same name** (shape `scalar`): wire a scalar into it and the " +
      "wire drives it; unwired, the knob value is used. Select params (a list of options, by index) are not wirable. " +
      "Params marked *a rate* are speeds: the gate integrates them over time, so changing one never makes the picture jump.",
    "",
    "A patch has one `output` node (at most one; without it nothing shows), and the picture is what reaches its `in`.",
    "",
  );

  add("## Wire shapes", "");
  for (const s of core.shapes) add(`- **\`${s.id}\`** (${s.label}): ${s.description}`);
  add(
    "",
    "A wire connects ports of the same shape, plus two automatic adapters: `scalar` → `field_scalar` (a constant " +
      "field) and `field_scalar` → `field_color` (grayscale).",
    "",
  );

  add(
    "## Inputs the gate provides",
    "",
    "Music drives most patterns. On the gate, `audio` follows the sound system and `dj_link` the DJ's decks " +
      "(Pioneer PRO DJ LINK). In the playground a synthetic groove (or the visitor's microphone) stands in for the " +
      "music, and a stand-in deck for DJ link, so audio-driven nodes move there too. Taps and strokes on the gate's " +
      "touch screens arrive through `effects_in` / `touch_dabs` (render them with `render_effects` / `render_points` " +
      "and blend them over the picture, as most presets do, so people can play with the pattern).",
    "",
  );

  if (code) {
    add(
      "## The Code node",
      "",
      "When no node does what you want, write it: a `code` node declares its own ports and a body in **WGSL**.",
      "",
      "```json",
      pretty(
        {
          id: "swirl",
          kind: "code",
          name: "Swirl",
          params: { twist: 1 },
          pos: [0, 0],
          code: {
            inputs: [{ name: "twist", shape: "scalar", min: 0, max: 4, default: 1 }],
            outputs: [{ name: "out", shape: "field_color", min: 0, max: 1, default: 0 }],
            body: "let hue = fract(c.theta / TAU + c.r01 * twist + G.time * 0.05);\nout = vec4f(hsv2rgb(hue, 0.9, 1.0), 1.0);",
          },
        },
      ),
      "```",
      "",
      "- **Two tiers, chosen by the ports.** With a field output it runs on the GPU once per LED: every output must be " +
        "a field, and no input may be an event. With only scalar and event ports it runs on the CPU once per frame. " +
        "Anything else is refused.",
      "- **Assign outputs, don't return them:** `out = …;`. Outputs start at zero; unassigned ones stay so.",
      "- A scalar input is a knob as well (its `min`/`max`/`default`; its value in the node's `params`).",
      `- Port names: letters, digits and \`_\`, starting with a letter, no \`__\`, not ending in \`_at\`. At most ${MAX_CODE_PORTS} ports each way; the body at most ${MAX_CODE_BYTES} bytes.`,
      "- Errors (parse, shader compile) are reported against your body's own lines: `validate_patch`, or `set_patch`'s `runtimeError`.",
      "",
      "**GPU tier** (a field output): the body is pasted into a WGSL function for one LED. `c` is this LED (`Ctx`, " +
        "below). A field input `x` is the upstream field at this LED (`f32` for `field_scalar`, `vec4f` for " +
        "`field_color`); `x_at(ctx)` samples it anywhere else (warps, offsets, blurs). A `field_color` output is a " +
        "`vec4f`: RGB plus coverage in `.a` (how much it covers what is under it when blended). `G` (globals) and " +
        "`AUDIO[0]` (the music: `level`, `bass`, `mid`, `treble`, `onset`, `beat_phase`, `bpm`) are readable; " +
        "`return` is not allowed.",
      "",
      "**CPU tier** (scalar/event ports only): a WGSL subset, interpreted: `let`/`var`, assignment, `if`/`else`, " +
        "`for`/`while`/`loop`, `break`/`continue`/`return`; values are `f32` or `bool` only (no vectors, no " +
        "`const`, `fn`, `struct` or `switch`). An event input reads true on the frame it fires; set an event output " +
        "true to fire it. `dt` is seconds since the last frame, `state.<name>` keeps a number across frames. Every " +
        "loop is bounded (10,000 steps a frame), so a body can never hang the gate.",
      "",
    );
    const fields = (name: string | undefined) =>
      (code.structs.find((x) => x.name === name)?.fields ?? []).filter((f) => !f.name.startsWith("_"));
    const ctx = fields("Ctx");
    if (ctx.length) {
      add("`c: Ctx`, this LED:", "");
      for (const f of ctx) add(`- \`c.${f.name}\`: ${f.type}${f.doc ? ` — ${f.doc}` : ""}`);
      add("");
    }
    const globals = fields(code.globals.find((x) => x.name === "G")?.type);
    if (globals.length) {
      add("`G`, the frame's globals (read-only; many are the engine's own bookkeeping):", "");
      for (const f of globals) add(`- \`G.${f.name}\`: ${f.type}${f.doc ? ` — ${f.doc}` : ""}`);
      add("");
    }
    const audio = fields("AudioU");
    if (audio.length) {
      add("`AUDIO[0]`, the first audio source (in the playground, the groove or the microphone):", "");
      for (const f of audio) add(`- \`AUDIO[0].${f.name}\`: ${f.type}${f.doc ? ` — ${f.doc}` : ""}`);
      add("");
    }
    const consts = code.globals.filter((x) => /^(PI|TAU)$/.test(x.name));
    if (consts.length) add(`Constants: ${consts.map((x) => `\`${x.name}\``).join(", ")}.`, "");
    const helpers = code.helpers.filter((f) => !INTERNAL_HELPERS.has(f.name));
    if (helpers.length) {
      add("Helper functions (GPU tier):", "");
      for (const f of helpers) add(`- \`${f.signature}\`${f.doc ? ` — ${firstSentence(f.doc)}` : ""}`);
      add("");
    }
    if (code.cpu_builtins.length) {
      add("Builtins on the CPU tier:", "");
      for (const f of code.cpu_builtins) add(`- \`${f.signature}\`${f.doc ? ` — ${firstSentence(f.doc)}` : ""}`);
      add("");
    }
  }

  add(
    "## Making it look good on the gate",
    "",
    "- The ring is seen from below, in the dark, at a distance: bold shapes, motion and contrast read; fine detail " +
      "smaller than a few LEDs does not. The spokes are far apart at the outer edge and close at the inner.",
    "- Leave some dark. A ring that is fully lit all the time flattens the room.",
    "- Let the music move it (audio level, bass, onsets, the beat phase) rather than only time.",
    "- Keep effects and strokes blended on top, so dancers can still play the gate.",
    "",
  );

  if (options.playground) {
    add(
      "## Links",
      "",
      `A link opens a patch in anyone's playground: \`${options.playground}#patch=<data>\`, where \`<data>\` is the ` +
        "patch JSON percent-encoded (`encodeURIComponent`), or `z` followed by the JSON deflate-raw compressed and " +
        "base64url-encoded (shorter; what `share_link` makes). The patch opens as a new entry in the visitor's own " +
        "library; nothing is sent anywhere.",
      "",
    );
  }

  if (!options.brief) {
    add("## Node reference", "");
    for (const { group, types } of grouped(core.registry)) {
      add(`## ${group.label}`, "", `${group.blurb}.`, "");
      for (const t of types) add(nodeReference(t));
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
