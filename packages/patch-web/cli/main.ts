#!/usr/bin/env node
// empyrean-patch: the gate's patch core on the command line, for people and
// for coding agents. Validates and describes patches anywhere Node runs;
// renders them to PNG with WebGPU where the optional `webgpu` package (Dawn)
// is installed; and serves the same tools as the playground's WebMCP over
// stdio MCP (`empyrean-patch mcp`).
//
// Bundled to cli/empyrean-patch.mjs in the web-dist package (Node refuses to
// run TypeScript from node_modules). Run with Node: Dawn's addon does not
// load in Bun.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPatchApi } from "../src/agent/api";
import { agentGuide } from "../src/agent/guide";
import { patchLink } from "../src/agent/link";
import { exportPatch } from "../src/editor/files";
import { fileHost, headlessRuntime, loadCore, PLAYGROUND, readPatch, WEBGPU_HINT } from "./host";
import { serveMcp } from "./mcp";

const HELP = `empyrean-patch — Empyrean Gate patches on the command line

Usage: empyrean-patch <command> [options]

  guide [--brief]              The guide to making patterns (markdown)
  nodes [kind...] [--json]     Node types: all in brief, or the named ones in full
  presets [name]               The built-in patches, or one as JSON
  schema                       JSON Schema of a patch document
  validate <file|->            Check a patch; exit 1 with the reasons if it cannot run
  link <file|-> [--base url]   A playground link that opens the patch
  render <file|-> [-o out.png] Pictures of the patch over time (needs: npm i webgpu)
        [--frames 4] [--interval 0.5] [--warmup 1] [--size 384] [--separate]
        [--at 0] [--no-link]   start the simulated DJ set at a time (s);
                               or with the PRO DJ LINK unplugged
  mcp [file]                   An MCP server on stdio with the playground's tools;
                               with a file, it opens it and saves every change to it

A patch is the JSON the gate and the playground save. Docs for agents:
${PLAYGROUND}/agents.md`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      brief: { type: "boolean" },
      json: { type: "boolean" },
      base: { type: "string" },
      out: { type: "string", short: "o" },
      frames: { type: "string" },
      interval: { type: "string" },
      warmup: { type: "string" },
      size: { type: "string" },
      separate: { type: "boolean" },
      at: { type: "string" },
      "no-link": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (!command || command === "help" || command === "--help" || command === "-h" || values.help) {
    console.log(HELP);
    return command ? 0 : 1;
  }

  const core = await loadCore();
  switch (command) {
    case "guide":
      process.stdout.write(agentGuide(core, { brief: values.brief, playground: PLAYGROUND }));
      return 0;
    case "nodes": {
      const api = createPatchApi(fileHost(core, null));
      const out = positionals.length ? api.describe(positionals) : api.nodeTypes();
      if (values.json || positionals.length) console.log(JSON.stringify(out, null, 2));
      else for (const t of api.nodeTypes()) console.log(`${t.kind.padEnd(18)} ${t.group.padEnd(10)} ${t.description || t.label}`);
      return 0;
    }
    case "presets": {
      const api = createPatchApi(fileHost(core, null));
      if (positionals[0]) process.stdout.write(exportPatch(api.preset(positionals.join(" "))));
      else for (const p of api.presets()) console.log(`${p.name.padEnd(28)} ${p.description}`);
      return 0;
    }
    case "schema":
      console.log(JSON.stringify(core.schema, null, 2));
      return 0;
    case "validate": {
      const errors = core.validate(core.migrate(readPatch(positionals[0])));
      if (errors.length === 0) {
        console.log("ok");
        return 0;
      }
      for (const e of errors) console.error(e);
      return 1;
    }
    case "link":
      console.log(await patchLink(readPatch(positionals[0]), values.base ?? PLAYGROUND));
      return 0;
    case "render": {
      const doc = readPatch(positionals[0]);
      const errors = core.validate(core.migrate(doc));
      if (errors.length) {
        for (const e of errors) console.error(e);
        return 1;
      }
      const headless = await headlessRuntime();
      if (!headless) {
        console.error(WEBGPU_HINT);
        return 2;
      }
      const { runtime, groove } = headless;
      groove.settings.startAt = Math.max(0, Number(values.at ?? 0) || 0);
      groove.dj.connected = !values["no-link"];
      const api = createPatchApi(fileHost(core, runtime));
      const set = await api.setPatch(doc);
      if (!set.ok) {
        console.error(set.runtimeError ?? set.errors.join("\n"));
        return 1;
      }
      const shot = await api.snapshot({
        frames: Number(values.frames ?? 4),
        interval: values.interval === undefined ? undefined : Number(values.interval),
        warmup: Number(values.warmup ?? 1),
        restart: true,
        size: values.size === undefined ? undefined : Number(values.size),
        sheet: !values.separate,
      });
      const out = values.out ?? "patch.png";
      const names =
        shot.images.length === 1 ? [out] : shot.images.map((_, i) => out.replace(/(\.png)?$/i, `-${i + 1}.png`));
      shot.images.forEach((png, i) => writeFileSync(names[i]!, png));
      console.log(JSON.stringify({ files: names, layout: shot.layout, frames: shot.frames }, null, 2));
      runtime.dispose();
      return 0;
    }
    case "mcp": {
      const file = positionals[0] ? resolve(positionals[0]) : undefined;
      await serveMcp(core, await headlessRuntime(), file);
      return -1; // keeps running
    }
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
