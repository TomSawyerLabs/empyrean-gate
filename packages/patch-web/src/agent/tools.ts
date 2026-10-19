// The agent API as tool definitions: names, descriptions and JSON-Schema
// inputs an agent reads, and handlers that answer in MCP's result shape
// (`{ content: [...] }`). The same list is registered with the browser
// (WebMCP, `registerWebMcp`) and served over stdio by the command line's
// MCP server, so a tool means the same thing wherever an agent meets it.

import { GROUPS } from "../groups";
import { toBase64 } from "../runtime/ring";
import type { PatchApi } from "./api";
import { OP_NAMES, type PatchOp } from "./edit";

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface AgentTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    /** Changes nothing. */
    readOnlyHint?: boolean;
    /** Has an effect outside the page (none of ours do; Submit stays human). */
    consequentialHint?: boolean;
  };
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

const text = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const PATCH = {
  type: "object",
  description:
    "A patch document: { format, id, name, description, nodes: [{ id, kind, name, params, pos }], edges: " +
    "[{ from: { node, port }, to: { node, port } }], exposed: [] }. See get_guide.",
};

const NODE_ID = { type: "string", description: "A node's id in the patch." };
const PORT = {
  description: 'A port: "node.port" or { node, port }.',
  anyOf: [
    { type: "string" },
    { type: "object", properties: { node: { type: "string" }, port: { type: "string" } }, required: ["node", "port"] },
  ],
};

const OPS = {
  type: "array",
  description:
    "Operations, applied in order: " +
    "add_node { kind, id?, name?, params?, code?, sub?, layers?, pos? }; " +
    "remove_node { node }; " +
    "set_layers { node, layers } (a Blend's layer count, 1..8; fewer drops the top layers and their wires); " +
    "set_params { node, params: { name: number | null } } (null = back to the default); " +
    "set_code { node, code: { inputs?, outputs?, body? } } (Code nodes); " +
    "rename_node { node, name }; " +
    "connect { from, to } (replaces what was wired into `to`); " +
    "disconnect { to, from? }; " +
    "set_info { name?, description? } (the patch's own); " +
    "expose { node, param, label? } / unexpose { node, param }.",
  items: {
    type: "object",
    required: ["op"],
    properties: {
      op: { enum: [...OP_NAMES] },
      node: NODE_ID,
      id: { type: "string" },
      kind: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      params: { type: "object", additionalProperties: { type: ["number", "null"] } },
      code: { type: "object" },
      sub: { type: "object" },
      layers: { type: "integer", minimum: 1, maximum: 8 },
      pos: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      from: PORT,
      to: PORT,
      param: { type: "string" },
      label: { type: "string" },
    },
  },
};

const APPLY_NOTE =
  "A patch that does not validate is not applied: the result lists the errors. ok:false with a runtimeError means " +
  "it was applied but could not render (e.g. a Code node's shader error). The change is one undo step in the " +
  "person's editor.";

/** Every tool the API supports on this host, plus a host's own `extra`. */
export function patchTools(api: PatchApi, extra: AgentTool[] = []): AgentTool[] {
  const tools: AgentTool[] = [
    {
      name: "get_guide",
      title: "Read the guide",
      description:
        "How to make patterns for the Empyrean Gate (a 64-spoke ring of 24,192 LEDs): the patch format, wire " +
        "shapes, workflow, the Code node, and a reference for every node type. Read this first. `brief` leaves " +
        "out the node reference.",
      inputSchema: { type: "object", properties: { brief: { type: "boolean" } } },
      annotations: { readOnlyHint: true },
      execute: async (i) => text(i.brief ? api.guide({ brief: true }) : api.guide()),
    },
    {
      name: "list_node_types",
      title: "List node types",
      description:
        "Every node type in brief: kind, label, palette group, category, what it does, its ports (name:shape) and " +
        `param names. Optionally only one palette group (${GROUPS.map((g) => g.id).join(", ")}) or one ` +
        "category (input, scalar, generator, field, combine, texture, code, sink).",
      inputSchema: { type: "object", properties: { group: { type: "string" }, category: { type: "string" } } },
      annotations: { readOnlyHint: true },
      execute: async (i) =>
        text(
          api.nodeTypes(
            typeof i.group === "string" ? i.group : typeof i.category === "string" ? i.category : undefined,
          ),
        ),
    },
    {
      name: "describe_node_types",
      title: "Describe node types",
      description: "Full definitions of the given node kinds: ports, params with ranges and defaults, descriptions.",
      inputSchema: {
        type: "object",
        properties: { kinds: { type: "array", items: { type: "string" } } },
        required: ["kinds"],
      },
      annotations: { readOnlyHint: true },
      execute: async (i) => text(api.describe(asStrings(i.kinds))),
    },
    {
      name: "list_presets",
      title: "List presets",
      description: "The built-in patches (good starting points): name, description, node count.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => text(api.presets()),
    },
    {
      name: "get_preset",
      title: "Read a preset",
      description: "A built-in patch's document, to learn from or start from.",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      annotations: { readOnlyHint: true },
      execute: async (i) => text(api.preset(String(i.name))),
    },
    {
      name: "open_preset",
      title: "Open a preset",
      description: "Open a copy of a built-in patch as a new patch, and run it.",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      execute: async (i) => text(await api.openPreset(String(i.name))),
    },
    {
      name: "get_patch",
      title: "Read the open patch",
      description:
        "The patch open right now. Pictures (Still image / Clip media) are left out as `kept:<n> bytes` unless " +
        "include_media; send them back unchanged and they are kept.",
      inputSchema: { type: "object", properties: { include_media: { type: "boolean" } } },
      annotations: { readOnlyHint: true },
      execute: async (i) => text(api.getPatch(i.include_media === true) ?? "No patch is open."),
    },
    {
      name: "validate_patch",
      title: "Validate a patch",
      description: "Check a patch document without applying it: [] when it can run, else the reasons.",
      inputSchema: { type: "object", properties: { patch: PATCH }, required: ["patch"] },
      annotations: { readOnlyHint: true },
      execute: async (i) => text(api.validate(asPatch(i.patch))),
    },
    {
      name: "set_patch",
      title: "Set the patch",
      description:
        "Apply a patch document and run it. It replaces the open patch when it has the open patch's id (read it " +
        "with get_patch, change it, send it back); otherwise it opens as a new patch in the library, so the " +
        "person's work is never overwritten. as_new forces a new patch. " +
        "arrange lays the graph out (also done when every pos is [0, 0] or missing). " +
        APPLY_NOTE,
      inputSchema: {
        type: "object",
        properties: { patch: PATCH, as_new: { type: "boolean" }, arrange: { type: "boolean" } },
        required: ["patch"],
      },
      execute: async (i) =>
        text(await api.setPatch(asPatch(i.patch), { asNew: i.as_new === true, arrange: i.arrange === true })),
    },
    {
      name: "edit_patch",
      title: "Edit the open patch",
      description: "Change the open patch with small operations instead of resending it. " + APPLY_NOTE,
      inputSchema: {
        type: "object",
        properties: { ops: OPS, arrange: { type: "boolean" } },
        required: ["ops"],
      },
      execute: async (i) => text(await api.edit(i.ops as PatchOp[], { arrange: i.arrange === true })),
    },
  ];

  if (api.canSnapshot) {
    tools.push({
      name: "snapshot",
      title: "Look at the patch",
      description:
        "Pictures of the running patch over patch time, with numbers per frame (share lit, brightness, main " +
        "colors, brightness by ring band and by sector). frames 1–16 (default 4), interval seconds between them " +
        "(default 0.5), warmup seconds before the first, restart to start the patch afresh (repeatable " +
        "results), size px per frame (default 384), sheet false for one picture per frame.",
      inputSchema: {
        type: "object",
        properties: {
          frames: { type: "integer", minimum: 1, maximum: 16 },
          interval: { type: "number", minimum: 0 },
          warmup: { type: "number", minimum: 0 },
          restart: { type: "boolean" },
          size: { type: "integer", minimum: 64, maximum: 1024 },
          sheet: { type: "boolean" },
        },
      },
      annotations: { readOnlyHint: true },
      execute: async (i) => {
        const shot = await api.snapshot({
          frames: num(i.frames) ?? 4,
          interval: num(i.interval),
          warmup: num(i.warmup),
          restart: i.restart === true,
          size: num(i.size),
          sheet: i.sheet !== false,
        });
        return {
          content: [
            { type: "text", text: JSON.stringify({ layout: shot.layout, frames: shot.frames }, null, 2) },
            ...shot.images.map((png) => ({ type: "image" as const, data: toBase64(png), mimeType: "image/png" })),
          ],
        };
      },
    });
  }

  if (api.canLink) {
    tools.push({
      name: "share_link",
      title: "Make a link",
      description:
        "A link that opens the open patch (or the given one) in anyone's playground, as a new patch in their " +
        "own library. Give it to the person; nothing is sent anywhere.",
      inputSchema: { type: "object", properties: { patch: PATCH } },
      annotations: { readOnlyHint: true },
      execute: async (i) => text(await api.link(i.patch ? asPatch(i.patch) : undefined)),
    });
  }

  return [...tools, ...extra].map((t) => ({ ...t, execute: guarded(t.execute) }));
}

/** Errors become a tool result the agent can read, not an exception. */
function guarded(run: AgentTool["execute"]): AgentTool["execute"] {
  return async (input) => {
    try {
      return await run(input && typeof input === "object" ? input : {});
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  };
}

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) throw new Error("expected a list of strings");
  return v.map(String);
}

function asPatch(v: unknown) {
  if (typeof v === "string") v = JSON.parse(v);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("patch must be a patch document (an object)");
  return v as Parameters<PatchApi["validate"]>[0];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// --- WebMCP --------------------------------------------------------------------

interface ModelContext {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: object;
      annotations?: object;
      execute(input: Record<string, unknown>, options?: unknown): Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ): Promise<void> | { unregister?(): void } | void;
}

/** The browser's WebMCP entry point, where it has one: `document.modelContext`
 * (current draft), else the older `navigator.modelContext`. */
export function webMcp(): ModelContext | null {
  const g = globalThis as { document?: { modelContext?: ModelContext }; navigator?: { modelContext?: ModelContext } };
  const mc = g.document?.modelContext ?? g.navigator?.modelContext;
  return mc && typeof mc.registerTool === "function" ? mc : null;
}

/**
 * Offer `tools` to the browser's agent through WebMCP, until `signal`
 * aborts. Resolves with how many were registered (0 where the browser has no
 * WebMCP); a tool the browser refuses is skipped, not fatal.
 */
export async function registerWebMcp(tools: AgentTool[], signal: AbortSignal): Promise<number> {
  const mc = webMcp();
  if (!mc) return 0;
  let n = 0;
  for (const t of tools) {
    if (signal.aborted) break;
    try {
      const r = await mc.registerTool(
        {
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations ?? {},
          execute: (input) => t.execute(input ?? {}),
        },
        { signal },
      );
      // The older API handed back a handle instead of taking a signal.
      if (r && typeof r === "object" && typeof r.unregister === "function") {
        signal.addEventListener("abort", () => r.unregister?.(), { once: true });
      }
      n++;
    } catch {
      // Refused (a name taken by another script, say): carry on.
    }
  }
  return n;
}
