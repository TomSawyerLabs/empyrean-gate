# Agent-readable patch core: registry descriptions, shapes, schema, Code reference

## Goal

Make the browser playground usable by AI agents without clicking around: the
patch core (crates/empyrean-patch, exported through crates/empyrean-patch-wasm)
says what every node, port, param and wire shape means, offers a JSON Schema
for patch documents, and describes what a Code node body can use. Part of the
coordinator's `plans/agent-friendly-playground.md` (another checkout).

## Environment

- Worktree `C:/Users/camer/.t3/worktrees/Empyrean/agent-registry-docs`, branch
  `agent-registry-docs` off `origin/master` (eeb68ee). Do not push or merge.
- Checks: `cargo test` in `crates/`, `bun run build:wasm` + `bun run typecheck`
  in `packages/patch-web`. CI runs no clippy or fmt (`checks.yml`), and the
  tree is not rustfmt-clean (116 diffs on master), so do not run `cargo fmt`
  across the crate.

## Decisions (don't re-ask)

- Descriptions are positional `&'static str` fields on NodeType / PortDef /
  ParamDef (compile error if one is missing), serialized as `description`.
- Shapes: wasm `shapes()` returns `[{id, label, description}]`; the gate's
  `GET /patch/registry` shape stays an array (no breaking change).
- Schema: schemars 1.x derive on the serde types, always on (no feature gate);
  jsonschema (no default features) as a dev-dependency to validate presets.
- Code reference: DROPPED from this branch (coordinator, 2026-10-17): another
  thread shipped `reference.rs` / wasm `codeReference()` on master (c83b8c0).
  Gaps in it go to the coordinator, not into code here.
- Do not touch PatchEditor.tsx, src/editor or src/runtime (another agent).

## Steps

1. [x] Registry descriptions + TS types + mock backend (dcc03d7)
2. [x] Shape docs + `shapes()` (9cb8137)
3. [x] JSON Schema `patch_schema()` + wasm `schema()` + preset tests (d2f6dd0)
4. [-] `code_reference()` — dropped, see Decisions
5. [x] Rebased on origin/master f498703; cargo test 111 pass, build:wasm,
   typecheck, `bun run test` (13), src-tauri `cargo check` all green; Bun
   sanity script loads the wasm and reads registry/shapes/schema.

## Findings

- IMU: yaw radians 0..2π (compass), pitch/roll -1..1 (±90°), shake 0..3
  decaying (src/sensors.ts, state.rs).
- Knob values are clamped to the param range; wired values are not.
- Event effect figures are stamped at angle/radius (EffectKind's "stamped
  center-array" doc comment is stale; WGSL `stamp_frame` uses the origin).
- The palette was diffed before/after with descriptions stripped: identical,
  so no id, range or default moved while the table was rewritten.
- The registry descriptions add ~60 KB of text to the wasm (registry JSON is
  92 KB); the playground downloads it.
- Gaps seen in master's `codeReference()` (reported, not changed): most lib
  helpers have no `///` doc (hsv2rgb, snoise3, fbm3, hash01 …); internals
  (finish, mod289*, *_texel, effect/stamp helpers, OUT, PREVIEW) are listed
  beside user helpers; no notes on body scope (GPU `c`, `<input>_at(ctx)`,
  output vars; CPU `dt`, `state.<name>`, no vectors, unsupported keywords);
  TOUCH is only fed when the patch has a Touch/Touch mask/Touch glow node.

## Things not to do

- Don't run `cargo fmt` over the crate (unformatted on master; noise).
- Don't edit PatchEditor.tsx, src/editor, src/runtime, or reference.rs.
