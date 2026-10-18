# Code node: a node whose body is text (2026-10-18)

Status: **done** (2026-10-18). Gate `master` `4a2cd38` (crate `da58e18`,
editor `7b126a6`, plan); web-dist `bccbb56`; the site's `dev` `11fd321`
carries it and the Preview at dev.empyreangate.org/playground shows the Code
group, inserts a node and renders (checked in headless Chrome with WebGPU).
The real gate gets it with the next app release (Cameron tags releases).
Worktree `C:\Users\camer\.t3\worktrees\Empyrean\playground`, branch
`patch-crate` = `master`. Thread: "code node" (Claude Fable 5.1).

## Goal

Cameron (2026-10-18): "I want a 'node' type (for web and real gate) that
gives some code/text API. So a 'function' body or something, that takes
arbitrary inputs, and arbitrary outputs, that map to the types that already
exist."

One new node kind, `code`, whose ports and body live on the instance: the
user declares inputs and outputs (any existing wire shape that makes sense
for the tier it runs on), writes a function body, and the node behaves like
any built-in node: wires, knobs, exposed params, thumbnails, meters,
sub-patches, submissions.

## Environment / context

- Crate `crates/empyrean-patch` (pure Rust): `lib.rs` (document), `registry.rs`
  (static palette), `validate.rs`, `codegen.rs` (graph → WGSL; field nodes are
  WGSL functions `n{i}_f(c: Ctx)`), `eval.rs` (CPU Scalar/Event nodes, every
  frame), `flatten.rs` (sub-patches), `migrate.rs`, `sim.rs` (browser host).
- `crates/empyrean-patch-wasm`: the browser bindings; `packages/patch-web`:
  editor (`src/editor/PatchEditor.tsx`, `types.ts`) + WebGPU runtime.
- Desktop engine: `src-tauri/src/engine/mod.rs` compiles `Program.wgsl` with
  an error scope; a failure becomes `RuntimeStatus.patch_error`, old pipeline
  keeps rendering. Browser: `runtime/gpu.ts` throws `ShaderError` with
  `getCompilationInfo()` lines.
- Tests: `cargo test -p empyrean-patch` (codegen tests validate every shader
  with naga, a dev-dependency), `bun test src` in packages/patch-web,
  Playwright `tests/patch-*.spec.ts` against `scripts/mock-backend.ts`
  (which serves its own tiny registry; needs a `code` entry).
- Shared trees: `.agents.txt` in both checkouts; own hunks only;
  `git commit --only <paths>`; never push the site's master; gate master OK.

## Decisions (made in this thread; Cameron can overrule)

1. **One language, two tiers.** The body is WGSL. A Code node whose ports
   are all Scalar/Event runs on the CPU every frame, interpreted by a small
   WGSL-subset interpreter in the crate (`script.rs`), so the same syntax
   works everywhere and the gate never runs untrusted native code. A Code
   node with a field output runs on the GPU: its body is pasted verbatim
   into a generated WGSL function, with the lib's helpers (`hsv2rgb`,
   `snoise3`, `fbm3`, `hash01`, `Ctx`, `G`, `TAU`...) in scope.
   Rejected: Rhai / a bespoke expression language (two languages to learn,
   or a wasm bundle several times larger).
2. **Ports are per-instance data** (`NodeInst.code`), like a Sub-patch's
   ports come from `NodeInst.sub`. The registry entry `code` has no static
   ports. Scalar inputs are knobs too (min/max/default on the port), exactly
   like a built-in node's Number params.
3. **Outputs are assigned, not returned.** The body sets `out = ...;` (and
   any other output by name); unassigned outputs are 0. `return;` ends the
   body early on the CPU tier; on the GPU it would leave the generated
   function, so it is rejected there by the WGSL compiler (documented).
4. **Safety by construction.** Port names are validated identifiers (not a
   WGSL keyword, reserved word, builtin, lib global, or generated name;
   validation runs on both hosts). Bodies are size-capped (8 KB), ports
   capped (16 each way). The CPU interpreter is total: loose numeric/bool
   coercion, no runtime errors, a per-frame step budget (10 000), finite
   outputs. A GPU body can still hang the GPU (`loop {}`); the crew reviews
   submissions before they reach the gate, and both hosts already survive a
   failed shader (TDR recovery is the OS's, noted as a known risk).
5. **Format 5.** The field is new and optional (migration 4→5 is a no-op),
   but an older app would otherwise fail with "unknown kind" instead of
   "update the app"; Sub-patches set the precedent.
6. **Field inputs come in two forms**: `name` (the upstream field sampled at
   this pixel) and `name_at(ctx)` (resample anywhere: warps, offsets). The
   `_at` form is rewritten to a mangled per-node function by a token pass
   over the body, so two Code nodes with the same port names cannot
   collide.
7. **Shader errors point at the body.** `Program.code_lines` records where
   each node's body starts in the module; both hosts rewrite `wgsl:L:C`
   into "Code node <name> line N".

## Design

### Document

```jsonc
{ "id": "n5", "kind": "code", "params": { "shift": 0.25 },
  "code": {
    "inputs":  [{ "name": "shift", "shape": "scalar", "min": 0, "max": 1, "default": 0 },
                { "name": "img",   "shape": "field_color" }],
    "outputs": [{ "name": "out", "shape": "field_color" }],
    "body": "let s = img_at(ctx_transform(c, shift * TAU, 1.0, 0.0, 0.0));\nout = s;" } }
```

Tier: CPU when every port is Scalar or Event; GPU when every output is a
field and every input is Scalar or a field. Anything else is a validation
error (Points/Effects/Texture ports are a follow-up).

### GPU codegen (per Code node `i`)

```wgsl
struct N5Out { out: vec4f, mask: f32 }
fn n5_in_img(c: Ctx) -> vec4f { return n3_f(c); }      // one per field input
fn n5_all(c: Ctx) -> N5Out {
    var out: vec4f = vec4f(0.0); var mask: f32 = 0.0;    // outputs, zeroed
    let shift = P[7u];                                   // scalar inputs (slab)
    let img = n5_in_img(c);                              // field inputs, here
    { /* body, `img_at` → `n5_in_img` */ }
    return N5Out(out, mask);
}
fn n5_f(c: Ctx) -> vec4f { return n5_all(c).out; }      // principal output
fn n5_o_mask(c: Ctx) -> f32 { return n5_all(c).mask; }  // every output
```

Consumers of a Code node's port use `n{i}_o_{port}`; `n{i}_f` is the
principal (`out`, else the first output) so previews and the Output work.

### CPU interpreter (`script.rs`)

WGSL subset: `let`/`var`, assignment and `+= -= *= /= %=`, `++`/`--`,
`if`/`else if`/`else`, `for`, `while`, `loop`, `break`, `continue`,
`return`, blocks, `// /* */` comments; literals `1`, `1.5`, `1e-3`, `2u`,
`true`; operators with WGSL precedence; builtins by their WGSL names (abs,
floor, ceil, round, fract, trunc, sign, sqrt, inverseSqrt, exp, exp2, log,
log2, pow, sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh, min,
max, clamp, mix, step, smoothstep, saturate, fma, degrees, radians,
select, f32, i32, u32, bool). Values are f32 or bool, coerced loosely.
Scope: each input (Scalar → f32, Event → bool "fired this frame"), each
output (f32 / bool, zero each frame), `dt` (seconds), `PI`, `TAU`, and
`state.<name>`: f32 slots that persist across frames (and across edits,
through `adopt_state`). Step budget per eval; a loop that runs out just
stops.

### Editor

Side panel for a Code node: tier hint, inputs table (name, shape, and for
scalars min/max/default), outputs table (name, shape), the body in a
monospace textarea (Tab indents; edits coalesce in undo), a short
reference under `<details>`, then the scalar inputs as sliders (expose
works). Renaming a port follows its wires; changing a shape drops wires
that no longer fit. The node shows its ports from the instance and a
one-line summary.

## Plan / steps

1. [x] Read the crate, editor, hosts; write this plan.
2. [x] Crate: `code.rs` (CodeDef, tier, identifier rules, lib-global scan,
   body token pass), `script.rs` (lexer, parser, interpreter), lib.rs
   (`NodeInst.code`, format 5, instance-aware port/knob helpers), registry
   entry + Category::Code, validate, codegen (slab from instance knobs,
   `slot_of` keyed by String, Code node functions, `code_lines`,
   `relocate_error`), eval (scripts, state, String events), migrate, sim.
   104 crate tests pass, new shaders naga-validated. Presets bumped to
   format 5 (format number only; the updater's pretty-print was reverted).
3. [x] wasm: `codeLines()` and `relocateError()` on PatchSim.
4. [x] patch-web: types (CodeDef, PATCH_FORMAT 5, `codeInputs/Outputs/
   Params`, `codeTier`, `defaultCode`), editor (ports from the instance,
   `CodePanel.tsx`, node summary line, "Code" palette group), runtime
   relocates shader errors, css.
5. [x] Desktop: `cargo check` clean (minis' scalar list owns its names, the
   engine relocates pipeline errors, the server clamps Code knobs through
   `eval::sanitize`); Control tab plays Code knobs; mock-backend registry
   entry; `tests/patch-code.spec.ts` (3 cases) + the other patch specs
   pass locally on Chromium and in CI on both engines. End-to-end render
   check done (see findings).
6. [ ] Preset using a Code node: optional, not started; a follow-up if
   Cameron wants one in the palette.
7. [x] Committed (crate+engine / editor+tests / plan), gate master pushed,
   CI green, web-dist `bccbb56`, bump bot run by hand → site `dev`
   `11fd321`; Preview verified. README notes in both repos committed.

## Round 2: developer experience (2026-10-18)

Cameron: "i trust you. do it. i want a first class developer experience.
can we make automatic minis too?" Reading of "automatic minis": every
output of a Code node gets its own live mini (ring for a field, meter for a
scalar/event), on the node and beside the editor, with no wiring needed.

Decisions:
- **CodeMirror 6** in the shared editor package (`CodeEditor.tsx`): a
  hand-written WGSL stream mode, completion, hover docs, lint marks from
  the host's relocated error, bracket matching, line numbers, Tab indents,
  its own history inside the editor (the patch history still records body
  edits, coalesced). Monaco rejected: megabytes, poor on phones.
- **The reference comes from the patch core**, not a hand-kept list: a new
  crate module `reference.rs` parses `patch_lib.wgsl` (every top-level `fn`
  with its `///` doc, the `Ctx`/`Globals`/`AudioU`… struct fields with their
  comments, the bindings, the consts) and lists the interpreter's builtins
  with signatures. wasm `codeReference()`, gate `GET /patch/code-reference`,
  editor prop `codeReference` (the site passes `core.codeReference` once the
  bump lands; without it completion still has ports, keywords and WGSL
  builtins).
- **Preview cells are per output**: `Program.preview_cells` (node + optional
  port), `preview_keys()` gives `"id"` for the principal / stream / texture
  cell and `"id:port"` for a Code node's other field outputs; both hosts
  already build mini keys as `node:<key>`, so nothing else changes.

Steps:
1. [x] Crate: `reference.rs`, builtin signatures in `script.rs`, preview
   cells in codegen (+ tests; 105 pass), wasm exports, engine/server
   plumbing (`cargo check` clean).
2. [x] Editor: `CodeEditor.tsx` (CodeMirror), `CodePanel` uses it + a minis
   row, node view rings per field output, `NodeContext` moved to
   `context.ts`, `codeReference`/`status` props down to the panel.
3. [x] Gate app fetches the reference; mock route; spec updated for
   CodeMirror (4 cases pass). Real-WebGPU check through the demo: a Code
   node with `out`, `edge`, `glow` field outputs gives cells `node:gpu`,
   `node:gpu:edge`, `node:gpu:glow`, all lit; the CPU node's `out` and
   `tick` are metered.
4. [x] Gate master `f498703` (crate `3a5…`/editor commits), web-dist
   `bc71eb0`, site `dev` `e5514df` (bump) + `203c8fb` (Playground passes
   `core.codeReference`). Preview checked in headless Chrome with WebGPU:
   typing `cosine_pal` completes to `cosine_palette(t: f32, which: u32) ->
   vec3f` from the engine's reference; a second field output adds a ring
   on the node and in the panel; a bad body is marked on its own line.

Gotcha: CodeMirror ignores Enter for 75 ms after a completion list opens
(`interactionDelay`); a spec must wait before accepting.

## Round 3: "Convert to Code" (2026-10-18)

Cameron: "sounds great. boil the ocean." A button on a built-in node's
panel that turns it into a Code node with the same wires, as a starting
point.

Design:
- **GPU kinds**: the generator gets a `symbolic` mode in which knob refs
  are the knob's name and field inputs are the port's name (or
  `name_at(ctx)` when sampled elsewhere). `code::convert(doc, node_id)`
  rewrites the node in place: kind `code`, inputs = Number params (range,
  `integrate` for rates) + field inputs, output `out`, body = the node's
  generated body with the final `return X;` as `out = X;`, a header
  comment naming the kind and every baked Select choice, and `let c0 = c;`
  for the kinds that transform the context. Param names that are not valid
  port names (`min`, `max`) are renamed (`min_`, `max_`), wires, knob
  values and exposures following. Excluded: nodes that read buffers
  (Render points/effects, Texture sample) and the stream/texture sources,
  Output, Sub-patch, Code.
- **CPU kinds**: hand-written script templates per kind (per Select choice
  where it matters), checked against the real implementations by running
  both for a few hundred frames in a test. Host inputs (Audio, IMU, Tap,
  Touch, DJ link, Gate globals, Event effect) are not convertible.
  Random is converted with a hash in place of xorshift (noted in the
  body); Delay as a single delay (echoes noted).
- **`integrate` on Code inputs** (`CodePort.integrate`): the slab
  integrates the knob into a phase like a built-in rate, so a converted
  `speed` keeps animating; a "rate" checkbox in the ports table.
- **`master_speed`** joins the CPU tier's scope (templates for Time and
  LFO need it).
- **`return;`** ends a GPU body too: the token pass rewrites a bare
  `return` into `return N<i>Out(…)`.
- Registry palette gains `convertible: bool`; the editor shows "Convert to
  Code" when set and calls a host-provided `convertToCode(doc, nodeId)`
  (wasm `convertToCode`, gate `POST /patch/convert-to-code`, mock stub);
  the result replaces the document as one undo step.

Steps:
1. [x] Crate: integrate flag, master_speed, `return;`, symbolic codegen,
   `convert.rs` (GPU via the generator, 16 CPU templates), palette flag,
   tests (every convertible GPU kind compiles + naga-validates; every CPU
   template matches the built-in frame by frame for 120 frames, events
   by fire count). 112 tests pass.
2. [x] Hosts: wasm `convertToCode`, gate `POST /patch/convert-to-code`,
   Patch.tsx, mock stub; `cargo check` clean. Site Playground passes
   `core.convertToCode` (site `dev`, after the bump to web-dist `486a817`).
   Rebased onto the agent-tools commits that landed meanwhile (registry
   docs, schema, CLI); conflicts in `palette_json`, `core.ts` and the mock
   registry were both-sides adds. The ISSUES.md entry about the reference
   listing internals is closed: a `///` doc now makes a helper part of the
   Code API, and the helpers a body wants got docs.
3. [x] Editor: "Convert to Code" on convertible kinds, "rate" checkbox on
   GPU scalar inputs, reference card mentions `return;`, `master_speed`
   and the button; spec case. Found and fixed on the way: switching the
   selection between two nodes closed the side panel (React Flow sends
   the deselect and the select in one batch; the handler let whichever
   came last win).

Gotchas: `c` is the pixel context, so Merge events' `c` port converts as
`c_`; `min`/`max`/`length`/`floor`/`step`/`set` are renamed (`low`,
`high`, `len`, `base`, `advance`, `turn_on`). Comparing a converted Time
against the built-in needs per-frame steps exact in f32 (master speed
1.25, rate 0.8), or a cycle boundary lands a frame apart.

## Round 4: the body in a large modal (2026-10-18)

Cameron: "need to be able to open the wgsl editor in a bigger modal." An
⤢ Expand control on the body opens a native `<dialog>` (showModal: focus
trap, Esc, backdrop) at min(96vw, 1200px) × min(90vh, 900px) holding the
one editor instance (the panel shows "Editing in the large view" meanwhile,
so two CodeMirrors never fight over one body), the live minis row and the
node's error line; Done or Esc returns it to the panel. Spec case added.

## Findings / gotchas

- `codegen::leak()` interned port names as `&'static str` for `slot_of`;
  user port names cannot be leaked (unbounded), so `slot_of`,
  `preview_scalars`, `events` and `event_counts` move to `String`.
- `is_cpu_kind`/`is_gpu_kind` take a kind string; a Code node's tier is
  per instance, so they become `is_cpu(node)`/`is_gpu(node)`.
- naga's reserved list (`keywords/wgsl.rs`) includes surprises: `smooth`,
  `active`, `patch`, `common`, `filter`, `target`, `set`, `get`, `type`.
  Builtins (`mix`, `step`, `length`...) are shadowable in WGSL but a port
  named `mix` would break the body's own `mix()` calls, so both lists are
  refused as port names.
- The preview module is a text fork after the node functions, so body line
  numbers are the same in `wgsl` and `preview_wgsl`.
- `EMPYREAN_UPDATE_PRESETS=1 cargo test presets` rewrites the preset files
  pretty-printed (a 6000-line diff for a format bump). For a bump that
  changes nothing else, `sed 's/"format": 4,/"format": 5,/'` instead.
- The mock backend's registry (`scripts/mock-backend.ts`) is tiny and its
  Output takes a *grey* field; a UI spec that wires a colour-field Code node
  into it must first make the output grey (and drop the Noise wire).
- End-to-end (headless Chrome with WebGPU, `bun run demo` in patch-web,
  `rt.setPatch`): a patch with a CPU Code node feeding a GPU Code node
  renders; a bad GPU body reports `Code node "warp" line 2:13 unresolved
  value 'nope'`; a bad CPU body reports `Code node "cpu": line 1:14:
  expected a value, found ';'`.

## Open questions for the user

1. Points / Effects / Texture ports on Code nodes (GPU tier): worth a
   follow-up? Recommendation: yes, once the field form has been used for a
   while; each needs its own binding idiom in the body.
2. Should the CPU tier get `master_speed`? Not exposed now (a Time node
   already integrates with it).

## Things not to do

- Do not let user strings reach WGSL unvalidated: port names go through
  `code::check_ident`, bodies only through `code::rewrite_body`.
- Do not key anything on `&'static str` for per-instance ports.
- Do not bump `bun.lock` in the site by hand (bot does it).
