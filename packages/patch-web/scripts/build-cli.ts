// Bundle the command line (cli/main.ts) into one Node ES module,
// cli/empyrean-patch.mjs (gitignored; CI builds it for the web-dist branch).
// Node will not run TypeScript from node_modules, so the package ships this
// file as its `bin`. The wasm stays a file next to it (cli/../wasm), and
// `webgpu` (Dawn, optional, a native addon) stays an import resolved at run
// time.
//
//   bun scripts/build-cli.ts     (after `bun run build:wasm`)

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = resolve(import.meta.dir, "..");
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8")) as { version: string };

const result = await Bun.build({
  entrypoints: [join(here, "cli", "main.ts")],
  outdir: join(here, "cli"),
  naming: "empyrean-patch.mjs",
  target: "node",
  format: "esm",
  external: ["webgpu"],
  define: { PACKAGE_VERSION: JSON.stringify(version) },
  minify: { syntax: true, whitespace: false, identifiers: false },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const out of result.outputs) console.log(`${out.path} (${Math.round(out.size / 1024)} KB)`);
