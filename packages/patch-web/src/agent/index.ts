// For AI agents: the patch API over a host, as tool definitions (WebMCP in a
// browser, MCP from the command line), the guide they read, small edit
// operations, and patches in links.

export { createPatchApi, type PatchApi, type PatchHost, type SetResult, type Snapshot, type SnapshotOptions } from "./api";
export { applyOps, arranged, OP_NAMES, type PatchOp, type PortRef } from "./edit";
export { agentGuide, nodeSummary, type GuideOptions } from "./guide";
export { hasPatchLink, MAX_LINK_CHARS, patchLink, readPatchLink } from "./link";
export {
  patchTools,
  registerWebMcp,
  webMcp,
  type AgentTool,
  type ToolContent,
  type ToolResult,
} from "./tools";
