# Patch editor: drop-to-blend and minimized nodes (2026-10-17)

Status: drop-to-combine and minimize on gate `master` (4e6af6d), on the
Preview. **Now: the Blend layer stack** (Cameron, 2026-10-18: "get going on
the blend layers"). Gate worktree
`C:\Users\camer\.t3\worktrees\Empyrean\auto-blend`, branch `auto-blend`.

## Goal

Cameron (2026-10-17): "if I drop a second input onto an input, it should
automatically make a blend. blends should also be minimizable (barely bigger
than a 'mini' with a couple inputs and outputs). while we're at it, is there a
better way to do multiple blends?"

1. Dropping a wire on an input that already has one inserts a combining node:
   the old wire becomes its lower input, the new one its upper, its output
   feeds the input. One undo step.
2. Nodes can be minimized: a box barely bigger than the 72 px mini ring, port
   dots on the edges, no labels or knobs. Saved in the patch.
3. Answer "a better way to do multiple blends" with a recommendation.

## Environment / context

- Editor: `packages/patch-web/src/editor/PatchEditor.tsx` (React Flow); the
  connect/drop handlers are `isValidConnection` / `onConnect`; node view is
  `PatchNodeView`; `NodeContext` (context.ts) carries editor state to views.
- Node instance format: TS `PatchNode` (types.ts) mirrors Rust `NodeInst`
  (crates/empyrean-patch/src/lib.rs, `#[serde(default)]`, schemars schema).
  A field the Rust side lacks is dropped when the gate app saves, so
  `collapsed` must exist on both.
- Tests: `bun test src` in packages/patch-web (unit), `cargo test` in
  `crates/`, `bun run test:behavior` (Playwright, mock backend) at the root
  (`tests/patch-connect.spec.ts` covers wire drags).
- Another thread works in the `playground` worktree (branch `patch-crate`,
  "round 3: Convert to Code", 4 commits ahead of master, unpushed). It also
  touches PatchEditor.tsx; expect a merge, not a rewrite.

## Decisions (Claude's; reopen if wrong)

- Combiner per input shape: colour field → Blend (base = old, over = new);
  grey field → Field math (add); event → Merge events; number/knob → Math
  (add). Points, effects, texture: no combiner, a second wire is refused as
  before.
- A third drop on the same input chains: the new node's base is the previous
  combiner. (The stack node in "Open questions" would replace this.)
- The new combiner is placed left of the target input in the first free spot,
  minimized and selected (so its mode/opacity are in the side panel).
- Minimize applies to every node, not only Blend; a minimized node shows its
  shaped inputs, any wired knob, and its wired/principal outputs.
- `collapsed` is presentational: no effect on codegen; omitted when false.

## Plan / steps

1. [x] Rust: `NodeInst.collapsed` (serde default, skip when false); migrate.rs literal; round-trip test.
2. [x] TS: `PatchNode.collapsed`; pure `combinerFor` / `insertCombiner` /
       `freeSpot` in `editor/combine.ts`, unit-tested (`combine.test.ts`).
3. [x] Editor: occupied inputs accept a combinable wire (glow, dashed ring:
       `port-combine`); onConnect inserts the combiner, selects it.
4. [x] Editor: minimized node view + − / + toggle in the head; CSS.
5. [x] Behavior test `tests/patch-combine.spec.ts` (mock registry gained
       Plasma, Blend, Field math; its Output now takes a colour field like the real one).
6. [x] README/docs; rebased on round 3/4 (conflicts: editor.css tail,
       ISSUES.md), pushed gate `master` 4e6af6d (CI builds web-dist; the
       site's bump bot lands it on site `dev`).
7. [x] On the Preview: site `dev` b0232e4 (web-dist 19b8830, bump dispatched by
       hand: the 15-min schedule had not fired since 05:06Z); the playground shows
       − on every node and Blend/Plasma in the palette (2026-10-18).
8. [ ] **Current:** Blend layer stack (design below, "Layer stack design").
   1. [x] Crate: `NodeInst.layers`; per-layer names resolved on the instance
          (`input_shape`, `knob`, `knobs`, `shaped_inputs`, new `param_def`);
          validate (`layers` only on Blend, 1..=8); codegen folds the layers;
          convert-to-Code and eval's `has_param`/`sanitize` instance-aware;
          palette carries `layered`; tests.
   2. [x] TS: `PatchNode.layers`, `PatchNodeType.layered`; instance ports in
          the editor (node view, side panel, Control tab); pure
          `editor/layers.ts` (add / remove / move a layer, renaming wires,
          knob values and exposures), unit-tested.
   3. [x] Drop rules in combine.ts (below); side panel layer list with
          add / remove / move up / move down.
   4. [ ] Mock registry, behavior tests, agent guide (`layers` on add_node,
          `set_layers`), README [done]; full suite, push, Preview [current].

## Layer stack design

- Blend keeps `base`, `over`, `mode`, `opacity` as layer 1, so every saved
  patch reads as before. `NodeInst.layers` (absent = 1, at most 8) adds
  layers 2..N, each with its own `over{k}` input, `mode{k}` select and
  `opacity{k}` knob (wireable like any knob).
- The repeated names are data: the registry lists them per kind
  (`registry::layered`), the palette sends them as `layered: {names, max}`,
  and the editor builds instance ports from that rather than knowing Blend.
- Codegen: layer 1 exactly as before; each further layer composites onto
  the result. An unwired layer 2+ is skipped (a Multiply layer with nothing
  in it would otherwise blacken the picture).
- Editor drop rules, first match wins:
  1. On a taken input of a Blend itself (`base`, `over`, `over3`, …): a new
     layer just above that one, wired from the dropped wire.
  2. On a taken input fed by a Blend's `out` that feeds nothing else: a new
     top layer on that Blend.
  3. Otherwise (or the Blend is full): a new minimized Blend, as before.
- Removing or moving a layer renames the higher layers' wires, knob values
  and exposed entries so the numbers stay 2..N with no gaps.

## Findings / gotchas

- The Playwright mock backend serves the built `dist/`: run `bun run build`
  before `test:behavior`, or the tests run the previous build (the first
  layer test "failed" against an old dist).
- Calling React Flow's `updateNodeInternals` from a node view's mount effect
  cancels a wire being dragged (no drop lands at all). The node view
  re-measures its handles only when its port set changes after mount.
- An unwired Multiply layer would read `vec4f(0)` and blacken the picture,
  so codegen leaves out unwired layers above the first (layer 1 is kept
  as it always was, so existing patches render the same).
- The side panel lists layers top first (as layer panels do), the node's dots
  stay in declaration order (base, over, over2, …).

- Port 9531 (the Playwright mock backend) may already be held by another
  checkout's `scripts/mock-backend.ts`; with `reuseExistingServer` Playwright
  would silently test *that* build. `PW_PORT=9547 bun run test:behavior`
  (commit 96c1817 added `PW_PORT`).
- The mock registry had no Blend and a grey-field Output; drop-to-blend
  can't be tested without real-shaped combiners there.
- The Gate globals card (bottom-right of the canvas) covers nodes dragged
  there in tests: keep test nodes left of x≈900 at 1400×900.
- Cameron's no-`title=` rule: the node view's port tooltips became
  `aria-label`s (test renamed); the other ~30 `title=`s are logged in ISSUES.md.

## Progress log

- [x] 2026-10-17: steps 1–5; crate tests 112 pass, patch-web unit 50 pass,
      typecheck clean (patch-web and app), patch-combine 3/3 + patch-connect pass.
- [x] 2026-10-17, after rebasing on gate master 5e86561: crate 119 pass,
      unit 50 pass, typechecks clean, behavior 143/144 (the one failure is
      the known WebKit `multitouch` flake in ISSUES.md; 6/6 alone).

## Open questions for the user

1. ~~Multiple blends~~: answered 2026-10-18, build the layer stack.
   Original recommendation: Blend keeps `base`/`over`/`mode`/`opacity` as layer 1
   (every saved patch unchanged) and grows `over2`, `mode2`, `opacity2`, …
   per layer (instance-sized ports, as Code nodes already have); a drop on a
   Blend-fed input appends a layer instead of adding a node; the side panel
   lists layers top-down with drag to reorder, and minimized it is one mini
   with a dot per layer. Codegen is a fold over layers. Needs crate
   (registry/codegen/validate/schema), editor, agent guide.

## Things not to do

- Don't work in the `playground` worktree (another thread's).
- Don't push release tags without asking (gate `master` pushes are fine).
