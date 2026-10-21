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
  `MiniSource` for live node thumbnails and meters (drawn through one shared
  WebGL2 context, or the 2D canvas API where WebGL2 is unavailable). Also
  patch file helpers: `savePatchToDisk`, `openPatchFromDisk`,
  `parsePatchFile`, `exportPatch`.
  The palette groups kinds by the registry's `group` (labels and order in
  `groups.ts`, `GROUPS` / `grouped` / `groupOf`), with an icon per kind
  (`NodeIcon`, `GroupIcon`) and a thumbnail per kind (`thumbs.gen.ts`, loaded
  lazily as its own chunk). Ports and params with a `when` belong to some
  modes of their kind only (`applies`).
- `@empyrean-gate/patch-web/editor.css` — the editor's styles (imported by the
  editor itself). Colors are `--pe-*` custom properties with the gate's palette
  as defaults.
- `@empyrean-gate/patch-web/runtime` — `PatchRuntime.create()` loads the wasm
  core and a WebGPU device; `setPatch(doc)` runs or live-edits a patch;
  `attach(canvas)` shows it; inputs: `trigger` (effects), `draw` (strokes),
  `startMic`, `startMotion`, `setMedia` (local video/image), `setVideoSource`
  (`MediaTexture.fromCamera()`, or null for the stand-in film), `setDjLink` /
  `fireDjEvent`, `setMaster`, `setHuePull`. It is also a `MiniSource` for the
  editor. Every input has a stand-in, so every node kind does something
  anywhere: Video in plays `TestFilm` (dusk over rolling hills) until a file
  or camera is chosen; `attachVisitors(runtime)` brings simulated people who
  tap effects on the beat, draw strokes and, when the patch owns touch, touch
  with a finger or two; `syntheticMotion()` is a dancer's phone; and while no
  microphone is on, Waveform and Spectrum get a scope made from the audio
  features (`synthScope`). All are seeded and clocked by patch time, so a
  capture repeats.
  `loadPatchCore()` alone gives the registry, presets and `validate()` without
  a GPU. For someone who cannot watch it: `step(dt)`, `restart()`,
  `readFrame()` and `capture({ frames, interval, warmup, restart })`, which
  steps the patch through patch time at a steady 60 Hz and reads each frame
  back; `renderRing`, `contactSheet`, `encodePng` and `frameStats` turn
  frames into PNGs and numbers without a GPU view. `PatchRuntime.create(geometry,
  { gpu, wasm, decodeImage })` runs without a browser (Node, with the `webgpu`
  package; the command line decodes PNG pictures with `cli/png.ts`).
  For music without music, `attachGroove(runtime)` plays a simulated PRO DJ
  LINK set (`DjLinkSim`, returned as `dj`) when there is no gate: two CDJs
  and a mixer at 122 BPM, an Auto DJ mixing a crate of invented tracks with
  rekordbox phrases, fill-ins, loops, hot-cue jumps and crossfades, and a
  synthetic groove on audio source 0 that follows what is on air (a
  breakdown drops the kick). The hardware is modelled as Pioneer reports it
  and read with the gate's own rules (ported from `src-tauri`'s `rhythm.rs`
  and engine), so every `dj_link` output and event behaves as on the night,
  quirks included: cue-play fires `play` and `cue`, an 8-beat loop wraps on
  each bar, `mix` takes 0, 0.5 or 1 from the on-air flags, eased. A host can
  work the decks (`dj.act(deck, { action })`, `setCrossfader`; a hand on them
  turns Auto off), unplug the LINK (`dj.connected = false`: every output as on
  a gate without CDJs), and choose where `restart()` starts the set
  (`settings.startAt`), so captures repeat. To hear it, `DjSound.listen(runtime,
  dj)` (from a click) plays the set through Web Audio: a house groove whose
  parts follow each deck's phrases (no kick in a breakdown, a riser on a
  build, a snare roll on a fill-in, a crash as a chorus lands), each deck
  through its fader and the crossfader, loops and jumps heard where they
  happen. It is output only; the patch's audio stays the set's synthetic
  features, so captures still repeat.
- `@empyrean-gate/patch-web/agent` — patches for AI agents: `createPatchApi(host)`
  (guide, node types, presets, get/set/validate, `edit(ops)` with small
  operations, `snapshot`, `link`), `patchTools(api)` (the same as tool
  definitions with JSON-Schema inputs and MCP-shaped results),
  `registerWebMcp(tools, signal)` (offers them to the browser's agent through
  [WebMCP](https://webmachinelearning.github.io/webmcp/)), `agentGuide(core)`
  (the guide, generated from the registry), `djTool(groove)` (the `dj_deck`
  tool over a host's simulated set), and `patchLink` /
  `readPatchLink` (a patch in a URL fragment). The editor takes an
  `editorRef` (`PatchEditorHandle`: `doc`, `open`, `replace`, `arrange`), so a
  host's tools act through it and every agent change is one undo step.
- `@empyrean-gate/patch-web/types` — the patch document types.

Peer dependencies: `react`, `react-dom`, `@xyflow/react`. Consumers bundle with
Vite (the source ships as TypeScript, and the wasm is loaded with
`new URL(..., import.meta.url)`).

## The command line

The package's `bin`, `empyrean-patch` (bundled JS; Node 22+), is the patch core
on the command line:

```sh
npx -p webgpu -p github:TomSawyerLabs/empyrean-gate#web-dist empyrean-patch <command>
```

| Command                       | What it does                                                         |
| ----------------------------- | -------------------------------------------------------------------- |
| `guide [--brief]`             | The guide to making patterns (markdown)                              |
| `nodes [kind...] [--json]`    | Node types in brief, or the named ones in full                       |
| `presets [name]`              | The built-in patches, or one as JSON                                 |
| `schema`                      | JSON Schema of a patch document                                      |
| `validate <file\|->`          | Check a patch; exit 1 with the reasons                               |
| `link <file\|->`              | A playground link that opens it                                      |
| `render <file\|-> [-o x.png]` | Frames over time as PNG (`--frames --interval --warmup --size`; `--at <s>` starts the simulated DJ set there, `--no-link` unplugs it) |
| `mcp [file]`                  | An MCP server on stdio with the agent tools (with WebGPU, `dj_deck` too), optionally bound to a file |

`render` and `mcp`'s `snapshot` need WebGPU, from the optional `webgpu`
package (Dawn); everything else runs without it. Run it with Node: Dawn's
addon crashes Bun. For a coding agent:

```sh
claude mcp add empyrean -- npx -y -p webgpu -p github:TomSawyerLabs/empyrean-gate#web-dist empyrean-patch mcp pattern.json
```

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
bun run build:cli       # cli/ -> cli/empyrean-patch.mjs (gitignored)
bun run typecheck
bun run test:browser    # every shader the core generates, through Chrome's compiler
bun run demo            # port 28150: every preset on a bare WebGPU page (/),
                        # the editor over the real core (/editor.html), and
                        # every palette thumbnail (/thumbs.html)
bun run thumbnails      # regenerate src/editor/thumbs.gen.ts
bun run arrange-presets # lay out the built-in patches as ⇆ Arrange does
```

`thumbnails` renders each node kind in a small showcase patch
(`scripts/thumbnails-render.ts`) on the stand-ins, with Dawn under Node: a
kind that makes a picture keeps its output sampled to 64 spokes × 24 LEDs
(drawn by `renderRing` at any size), one that makes a number or an event eight
seconds of it with what drives it. It installs `webgpu` once into
`node_modules/.cache`; `thumbs.test.ts` fails when a kind has neither a
thumbnail nor a place in `ICON_ONLY`. The `crates/` workspace keeps its
intermediate build files in its own `target/` (`crates/.cargo/config.toml`), so
two worktrees can build the wasm at once even where a user config shares one
cargo build directory across projects.

`arrange-presets` opens each built-in patch
(`crates/empyrean-patch/src/presets/*.json`) in the demo editor, in Chromium
on SwiftShader's WebGPU so the cards carry their live minis, presses Arrange
through the editor's handle and writes the positions back, changing only
each node's `"pos"`. Arrange lays the graph out by the cards' measured sizes,
which only a browser knows, so it cannot be done offline. Run it after adding
or changing a preset; `presets-arranged.test.ts` fails when a built-in has a
wire running right to left or two nodes on top of each other.

`test:browser` (needs the wasm build, and `bunx playwright install chromium`)
compiles every shader the patch core can generate in Chromium: each node kind
alone and with its inputs wired, each Select option, each Convert to Code
result and every preset. It then builds each pipeline within a time budget.
The crate's tests check the same WGSL with naga, which is what the desktop app
uses, but browsers bring their own compilers and Chrome's (Tint) is stricter.
It runs on SwiftShader, Chrome's software WebGPU, so it needs no GPU and runs
in CI. Safari's compiler is not covered: Playwright's WebKit has no WebGPU.
