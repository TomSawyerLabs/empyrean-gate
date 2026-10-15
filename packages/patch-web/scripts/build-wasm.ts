// Build the patch core for the browser: compile crates/empyrean-patch-wasm to
// wasm32 and generate its JS bindings into ./wasm (gitignored; CI builds it
// for the web-dist branch). Needs the wasm32-unknown-unknown target and a
// wasm-bindgen CLI matching the crate's pinned wasm-bindgen version:
//
//   rustup target add wasm32-unknown-unknown
//   cargo install wasm-bindgen-cli --version 0.2.129 --locked

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

const here = resolve(import.meta.dir, "..");
const crates = resolve(here, "..", "..", "crates");
const out = join(here, "wasm");

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`${cmd} ${args.join(" ")} failed`);
    process.exit(r.status ?? 1);
  }
}

run(
  "cargo",
  ["build", "-p", "empyrean-patch-wasm", "--target", "wasm32-unknown-unknown", "--release"],
  crates,
);
rmSync(out, { recursive: true, force: true });
run(
  "wasm-bindgen",
  [
    join(crates, "target", "wasm32-unknown-unknown", "release", "empyrean_patch_wasm.wasm"),
    "--target",
    "web",
    "--out-dir",
    out,
    "--out-name",
    "patch",
  ],
  here,
);
console.log(`wasm bindings written to ${out}`);
