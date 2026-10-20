# Sub-patch inlets and outlets (Patch in / Patch out)

## Goal

Cameron (2026-10-18): "i guess sub-patches could not have outputs and just be
more complicated intermediate things". Today a Sub-patch is only a picture
source: its inputs are the inner patch's exposed knobs (numbers only) and its
one output, `out`, is whatever feeds the inner Output. Give sub-patches typed
inputs and outputs of any wire shape, so a saved patch can be a reusable
block that takes a field (or a number, an event, LED data) and hands on
several results.

## Status

Approved 2026-10-19 (Cameron: "i'm happy with your recommendation", i.e.
explicit Patch in / Patch out nodes). Building in the gate worktree
`C:\Users\camer\.t3\worktrees\Empyrean\field-domains`, branch
`subpatch-ports` → gate master. Coordination: `.agents.txt` in the
`playground` worktree (Agent I, round 3). Follows `plans/field-domains.md`,
whose shapes it uses.

## Decisions already made (don't re-ask)

- Explicit boundary nodes, not exposed inner ports: the interface is visible
  inside the sub-patch, and an unwired inlet has a clear default.
- The Output keeps its meaning: a sub-patch with an Output still offers
  `out`, so every existing sub-patch and preset is unchanged.

## Design

- Two node kinds, group Structure: **Patch in** (`patch_in`) and **Patch out**
  (`patch_out`). Each is a *pass-through*: input `in` → output `out`, of one
  shape chosen by a Select param `shape` (Number, Event, Grey field, Colour
  field, Grey LEDs, Colour LEDs; default Colour field). A Number param
  `default` is the value of an unwired Number or grey inlet.
- Patch in shows only its `out` inside the patch; its `in` is fed from
  outside. Patch out shows only its `in`; its `out` is read from outside.
- **As a Sub-patch**, the node's input ports are its exposed knobs (as now)
  plus one per Patch in, named by that node's **id** (stable across renames
  and across linked copies; its `name` is the label). Its output ports are
  `out` (when the inner patch has an Output, or `out` is wired) plus one per
  Patch out, by id.
- **Flatten** keeps the boundary nodes as ordinary inlined nodes
  (`{sub}/{id}`): an outer wire into port P goes to `{sub}/P.in`, a wire
  from port Q comes from `{sub}/Q.out`. Being real nodes, adapters work at
  each hop (Number → grey inlet → colour input is two legal wires), domains
  flow through (LED data in, LED data out), and validation judges the real
  wires.
- **Opened on its own**, a patch with inlets runs: an unwired Patch in hands
  on its default (the `default` value, black, or no events). Patch out has
  no effect there.
- Tier follows the shape, per instance: Number and Event are CPU nodes (the
  evaluator), the field shapes GPU (the shader). `NodeInst` resolves the
  ports' shapes and the tier from `shape`, as it does for Code nodes.
- No format bump: new kinds and a Select param, no schema change.
- Texture, Points and Effects inlets: not in this round (they need their own
  binding idiom, as on Code nodes).

## Plan / steps

1. Core: registry entries (`patch_in`, `patch_out`, group, descriptions);
   `NodeInst` shape and tier resolution; eval (Number, Event pass-through);
   codegen (field pass-through, default); not convertible. Done.
2. Flatten: ports by id, rewiring through `{sub}/{id}`, errors for a missing
   port or an outlet id that collides with `out`. Validate/flatten tests,
   naga, eval. Done (`f8cc944`).
3. Editor: hide the outer-facing port on each boundary node; Sub-patch
   ports from the inner inlets/outlets (shapes, labels); `out` only when it
   means something; the domain mirror knows outlets. Icons, ICON_ONLY
   thumbnails, mock registry, a behaviour spec. Done (`15658c9`): also a
   wire dropped on empty canvas offers a Patch out / Patch in already
   shaped to it.
4. Agent guide, gate README, site README and plan (site `770e358`). Done.
5. Checks, merge, web-dist bump, Preview check. Merged (`f8cc944` to
   `66bab1c`), checked on dev. The block thumbnail fix below. ← current

## Findings / gotchas

- Port lookups (`NodeType::output_shape`) ignore `registry::When`, so a
  port whose shape follows a Select can't be expressed with `When`; the
  instance resolves it instead, like a Code node's.
- Linked sub-patches (`source`, `linked`, `source_rev`) landed 2026-10-19:
  ports come from the copy in `sub`, so a source that drops an inlet leaves
  outer wires to a missing port, which flatten reports (as it does for a
  dropped exposed knob today).
- The editor's drag-time domain check doesn't look inside a Sub-patch: LED
  data into an inlet whose inside feeds a Transform is refused by
  `validate` (on the inlined patch), not while dragging. Fine for now.
- `patch-connect` filtered the chooser by "outp" and expected only Output;
  Patch out matches too, so it types "outpu" now.
- The Sub-patch keeps `out` unless its patch has Patch outs and no Output,
  so every sub-patch from before this looks the same.
- A Patch out fits every wire exactly, so the connect chooser listed it
  first everywhere; boundary suggestions are now last (`481b55c`). The
  chooser filter searches descriptions too, so "outp" finds Patch out
  ("an output of this patch") as well as Output.
- The browser shader corpus (`browser/corpus.ts`) wired every kind by its
  static ports; Patch in/out need the select's shape, as in the editor.
- Field domains checked on the real dev Preview in Cameron's Chrome
  (2026-10-19, WebGPU): an old-style patch got its Resample, LED wires
  dotted, the folded snow renders. It left a patch "LED check (agent)" in
  that browser's playground library.
- Blocks checked on dev (2026-10-19, same browser): the Sub-patch shows its
  inlet and outlets by name ("Picture", "Folded") and renders. Its own
  thumbnail was black: with no Output inside, nothing took the Sub-patch's
  id, so flatten made it a black Solid. Now the block's first field-shaped
  Patch out takes that id (it stays a pass-through), so the thumbnail shows
  what the block hands on. Left a patch "Block check (agent)" in that
  library.

## Progress log

- [x] Steps 1–3 (2026-10-19)
- [x] Step 4 (2026-10-19)
- [ ] Step 5: block thumbnail fix to merge, bump, recheck

## Open questions for Cameron

None yet.

## Things not to do

- Don't key ports by the boundary node's `name`: renaming it, or a linked
  source renaming it, would cut every outer wire.
- Don't rewrite wires straight from the outer source to the inner consumers
  (dropping the boundary node): the two adapters don't chain (Number →
  colour is not a wire), and an unwired inlet would have no default.
