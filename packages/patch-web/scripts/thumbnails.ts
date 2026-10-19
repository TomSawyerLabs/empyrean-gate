// Regenerate the palette's thumbnails (src/editor/thumbs.gen.ts):
//
//   bun run thumbnails      (in packages/patch-web, after `bun run build:wasm`)
//
// The rendering needs WebGPU, which outside a browser is Dawn, from the
// `webgpu` package, and Dawn's addon only loads in Node. So this bundles
// thumbnails-render.ts for Node, installs `webgpu` once into a cache folder
// (not this package's dependencies: CI and the site never need it), and runs
// the bundle there. Run it again whenever a node kind is added or changes how
// it looks; `src/editor/thumbs.test.ts` notices a kind without one.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const here = resolve(import.meta.dir, "..");
const cache = join(here, "node_modules", ".cache", "empyrean-dawn");
const bundle = join(here, "cli", ".thumbnails.mjs");
const target = join(here, "src", "editor", "thumbs.gen.ts");

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`${cmd} ${args.join(" ")} failed`);
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(join(here, "wasm", "patch_bg.wasm"))) {
  console.error("Build the patch core first: bun run build:wasm");
  process.exit(1);
}

// Dawn, at the version this package's peer dependency names.
const { peerDependencies } = JSON.parse(readFileSync(join(here, "package.json"), "utf8")) as {
  peerDependencies: Record<string, string>;
};
if (!existsSync(join(cache, "node_modules", "webgpu"))) {
  mkdirSync(cache, { recursive: true });
  run("npm", ["install", "--no-save", "--no-audit", "--no-fund", "--prefix", cache, `webgpu@${peerDependencies.webgpu}`], here);
}

// In cli/, beside the CLI's own bundle, so `../wasm` resolves the same way.
const built = await Bun.build({
  entrypoints: [join(here, "scripts", "thumbnails-render.ts")],
  outdir: join(here, "cli"),
  naming: ".thumbnails.mjs",
  target: "node",
  format: "esm",
  external: ["webgpu"],
});
if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}
try {
  // cwd = the cache, where cli/host.ts looks for `webgpu` second.
  run("node", [bundle, target], cache);
} finally {
  rmSync(bundle, { force: true });
}
