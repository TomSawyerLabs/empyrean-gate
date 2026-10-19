// `empyrean-patch mcp`: the playground's agent tools over stdio MCP, for
// coding agents (Claude Code, Codex, …) on the person's own machine. One
// patch is open at a time, in memory or bound to a file; with WebGPU
// installed, `snapshot` renders it.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createPatchApi } from "../src/agent/api";
import { djTool } from "../src/agent/dj";
import { patchTools, type AgentTool } from "../src/agent/tools";
import { exportPatch, parsePatchFile } from "../src/editor/files";
import type { PatchCore } from "../src/runtime/core";
import type { PatchRuntime } from "../src/runtime/index";
import { fileHost, type Groove } from "./host";

declare const PACKAGE_VERSION: string;

export async function serveMcp(core: PatchCore, headless: { runtime: PatchRuntime; groove: Groove } | null, file?: string): Promise<void> {
  const runtime = headless?.runtime ?? null;
  const host = fileHost(core, runtime, file);
  const api = createPatchApi(host);

  const fileTools: AgentTool[] = [
    {
      name: "save_patch",
      title: "Save the patch to a file",
      description:
        "Write the open patch to a JSON file (the gate's own format; the playground's Open file and the gate's " +
        "Patch tab open it). Relative paths are from the server's working directory.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async (i) => {
        const doc = host.getPatch();
        if (!doc) throw new Error("No patch is open.");
        const path = resolve(String(i.path));
        writeFileSync(path, exportPatch(doc));
        return { content: [{ type: "text", text: `Saved to ${path}` }] };
      },
    },
    {
      name: "open_file",
      title: "Open a patch file",
      description: "Open a patch JSON file as the open patch (it is not validated first; validate_patch to check).",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async (i) => {
        const doc = parsePatchFile(readFileSync(resolve(String(i.path)), "utf8"));
        await host.open(doc);
        return {
          content: [{ type: "text", text: JSON.stringify({ opened: doc.name, errors: api.validate(doc) }, null, 2) }],
        };
      },
    },
  ];
  if (headless) fileTools.push(djTool(headless.groove));
  const tools = patchTools(api, fileTools);
  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "empyrean-patch", title: "Empyrean Gate patches", version: PACKAGE_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Tools for making light patterns (patches) for the Empyrean Gate, a 64-spoke ring of LEDs. " +
        "Start with get_guide. Apply with set_patch or edit_patch, look with snapshot, share with share_link.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema as { type: "object" },
      annotations: { readOnlyHint: t.annotations?.readOnlyHint ?? false, openWorldHint: false },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = byName.get(req.params.name);
    if (!tool) return { content: [{ type: "text", text: `Unknown tool "${req.params.name}".` }], isError: true };
    // Our results are MCP's shape already (tools.ts).
    return (await tool.execute((req.params.arguments ?? {}) as Record<string, unknown>)) as CallToolResult;
  });

  const resources = [
    { uri: "empyrean://guide", name: "guide", title: "Making patterns", mimeType: "text/markdown" },
    { uri: "empyrean://schema", name: "schema", title: "Patch document JSON Schema", mimeType: "application/schema+json" },
  ];
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    if (uri === "empyrean://guide") return { contents: [{ uri, mimeType: "text/markdown", text: api.guide() }] };
    if (uri === "empyrean://schema") {
      return { contents: [{ uri, mimeType: "application/schema+json", text: JSON.stringify(core.schema, null, 2) }] };
    }
    throw new Error(`Unknown resource ${uri}`);
  });

  await server.connect(new StdioServerTransport());
}
