// Assemble the package as other projects consume it: a git dependency on this
// repo's `web-dist` branch (`github:TomSawyerLabs/empyrean-gate#web-dist`).
// That branch holds only this directory's contents plus the built wasm, so
// installing it never pulls the app, the Rust sources or the hardware files.
//
//   bun scripts/assemble-dist.ts <out-dir>
//
// Run `bun run build:wasm` first. The source ships as TypeScript: consumers
// bundle with Vite, which compiles it, and their typechecker sees real types.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(here, "dist-package"));

if (!existsSync(join(here, "wasm", "patch_bg.wasm"))) {
  console.error("wasm/ is missing: run `bun run build:wasm` first");
  process.exit(1);
}

// Keep the destination's .git (CI assembles into a web-dist checkout).
mkdirSync(out, { recursive: true });
for (const entry of ["src", "wasm", "package.json", "README.md", "LICENSE"]) {
  rmSync(join(out, entry), { recursive: true, force: true });
}
cpSync(join(here, "src"), join(out, "src"), {
  recursive: true,
  // Unit tests stay here; they are not part of the package.
  filter: (src) => !src.endsWith(".test.ts"),
});
cpSync(join(here, "wasm"), join(out, "wasm"), {
  recursive: true,
  filter: (p) => !p.endsWith(".gitignore"),
});
cpSync(join(here, "README.md"), join(out, "README.md"));
cpSync(join(here, "..", "..", "LICENSE"), join(out, "LICENSE"));

const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
delete pkg.private;
delete pkg.scripts;
delete pkg.devDependencies; // none today; kept so a future one never ships
pkg.repository = { type: "git", url: "https://github.com/TomSawyerLabs/empyrean-gate" };
writeFileSync(join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`package assembled in ${out}`);
