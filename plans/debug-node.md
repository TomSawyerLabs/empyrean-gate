# Debug node: a tap that shows any wire

Status: **in progress** (branch `debug-node`, worktree
`~/.t3/worktrees/Empyrean/debug-node`).

## Goal

Cameron (2026-10-21): "a new 'debug' node type. something that is just a
'tap' that can visualize any step in the chain. like a dedicated 'mini'.
Only renders in the editor (show can opt in to rendering them)."

A Debug node has one input that takes a wire of any shape and no outputs.
Its only job is a large live view of whatever is wired into it: a ring for a
field, a stream or a texture, a meter for a Scalar, a fire strip for an
Event. It never changes what reaches the Output.

## Decisions already made (don't re-ask)

- **Show opt-in is per node** (Cameron, 2026-10-21, chose "Per-node flag →
  Live strip"): each Debug node has a "Show on Live" setting saved in the
  patch. While that patch is on air, the gate's Live tab shows a strip of
  the flagged taps' minis. With none flagged (the default) Live shows
  nothing and subscribes to nothing for them.
- **Id `debug`, label "Debug".** `tap` is taken (Effect taps, an input
  node).
- **The input's shape is whatever is wired in**, not a Select like Patch
  in/out: drop any wire on it. A new port-only shape, `Shape::Any`, accepts
  every wire shape; it is never carried on a wire.
- **No cost in the show's render.** The Debug node is neither a CPU nor a GPU
  node: nothing in the main shader, nothing in `eval`. Its view is a preview
  cell (rings) or a meter ref (scalars, events), which only run while
  something subscribes to minis (`mini_watchers` on the gate, `miniRefs` in
  the browser).
- **Debug cells and meters come first** in the preview lists (cells right
  after the Output's own, which another thread put first on 2026-10-21), so
  the 32-cell and 64-meter caps never drop a tap someone placed on purpose.
- **Keys are the Debug node's own**: ring `node:<debug id>`, meter
  `scalar:<debug id>:in`. `Runtime::scalar_value` follows the wire into a
  Debug node's `in`, so neither host needs to know the source.

## Design

Crate (`crates/empyrean-patch`):

- `Shape::Any` (label "Any"): `accepts` everything but `Pixels`/`Any`.
- `registry`: `Category::Debug` (`debug`), node `debug` in Group Structure,
  input `in: Any`, Select `live` ("Editor only" / "Editor and Live").
  `DEBUG_KIND`.
- `codegen`: skip it like a Note; preview cells for wired Debug nodes first,
  their expression is the source's value (colour, grey, or the source's
  stream/texture preview, `n{src}_pv`, emitted once per source).
  `preview_scalars` gets `(debug, "in")` first for Scalar/Event taps.
  `debug_taps(doc)` lists the flagged ones for the gate's status.
- `eval`: `scalar_value(debug, "in")` reads the wire's source.

Editor (`packages/patch-web`): a Debug node view with a large ring/meter
(no head clutter), port colour from the wire, palette entry, icon, thumb;
`ParamPanel` shows the view large too.

Gate app: status `patch_taps` (flagged taps of the active patch, with the
tapped shape); Live renders a strip of minis for them.

## Plan / steps

1. **Done** (`7b36ca2`). Crate: shape, registry, codegen, eval, tests.
2. **Done** (`bea531d`). patch-web: types, editor view, panel, `MiniTap`,
   icons/thumbs, connect suggestions, corpus, guide.
3. **Current.** Gate app: status `patch_taps`, Live strip, spec
   `tests/live-taps.spec.ts`.
4. README (gate, patch-web), web-dist publish (gate master push), site bump
   on `dev` (the "Web dist bump" workflow does it, or by hand).

## Findings / gotchas

- The patch shader the show runs is byte-identical with or without Debug
  nodes (test `debug_nodes_leave_the_shown_shader_alone`, Debug nodes last
  in the document so other node indices hold).
- A stream source drawn by its own cell and a Debug cell would emit
  `n{i}_pv` twice (a WGSL redefinition); `preview_main_fn` emits each once.
- The shared mini stage (192 px) blurred a 160 px ring at 2× DPR; it now
  grows to the largest view asked for (≤ 512) and draws into a corner.
- Seen in the demo (Chrome, WebGPU): rings for a colour and a grey field,
  a meter with its window range for an LFO, a fire strip for Time's wrap,
  the Live badge, the unwired hint, the panel's 220 px view.
- Minimized nodes' face meters (any node, not just Debug) spill past the
  node's right edge: logged in ISSUES.md, not fixed here.

## Progress log

- [x] Step 1: crate 167 tests pass.
- [x] Step 2: patch-web typecheck, 215 unit tests, browser shader corpus
      (Chrome compiles every shader incl. "debug fed <shape>").
- [ ] Step 3
- [ ] Step 4

## Open questions for the user

1. Resolution: minis render 16 samples per spoke (`MINI_PIXELS`). A Debug
   view is larger, so a full-resolution cell would look closer to the real
   gate, at the cost of a per-cell pixel count in both hosts' preview
   pipelines and the gate's mini protocol. Left at 16 for now.

## Things not to do

- Don't make `debug` a Sink: `exactly_one_sink_type` holds the Output alone.
- Don't push `master` in the site repo; gate `master` is fine.
