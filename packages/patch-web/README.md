# @empyrean-gate/patch-web

The Empyrean Gate's node-graph patch editor, and a WebGPU runtime that runs
patches with no gate attached. The empyreangate.org pattern playground is
built on it; the gate app's Patch tab uses the editor half.

Everything that knows a patch rule or a GPU layout is the gate's own Rust
(`crates/empyrean-patch`), compiled to wasm: validation, the WGSL codegen, the
control-rate evaluator, effect and audio analysis. This package only hosts it.

## Entry points

- `@empyrean-gate/patch-web/editor` — `PatchEditor` (React, React Flow) and
  its pieces. A host provides a `PatchStore` (list/get/save/delete/activate,
  answering with events), the node palette, presets, and optionally a
  `MiniSource` for live node thumbnails and meters. Also patch file helpers:
  `savePatchToDisk`, `openPatchFromDisk`, `parsePatchFile`, `exportPatch`.
- `@empyrean-gate/patch-web/editor.css` — the editor's styles (imported by the
  editor itself). Colors are `--pe-*` custom properties with the gate's palette
  as defaults.
- `@empyrean-gate/patch-web/runtime` — `PatchRuntime.create()` loads the wasm
  core and a WebGPU device; `setPatch(doc)` runs or live-edits a patch;
  `attach(canvas)` shows it; inputs: `trigger` (effects), `draw` (strokes),
  `startMic`, `startMotion`, `setMedia` (local video/image), `setDjLink` /
  `fireDjEvent`, `setMaster`. It is also a `MiniSource` for the editor.
  `loadPatchCore()` alone gives the registry, presets and `validate()` without
  a GPU.
- `@empyrean-gate/patch-web/types` — the patch document types.

Peer dependencies: `react`, `react-dom`, `@xyflow/react`. Consumers bundle with
Vite (the source ships as TypeScript, and the wasm is loaded with
`new URL(..., import.meta.url)`).

## Installing

Other projects depend on the `web-dist` branch, which CI rebuilds from
`master` and which contains only this package and its built wasm:

```json
"@empyrean-gate/patch-web": "github:TomSawyerLabs/empyrean-gate#web-dist"
```

## Developing

Inside this repo the package is a bun workspace; the app imports it from
source. The runtime needs the wasm build:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
bun run build:wasm      # crates/empyrean-patch-wasm -> ./wasm (gitignored)
bun run typecheck
bun run demo            # every preset on a bare WebGPU page, port 28150
```
