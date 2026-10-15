//! The node-graph ("patch") pattern paradigm. The host-independent core —
//! document model, registry, validation, WGSL codegen, evaluator, presets —
//! lives in `crates/empyrean-patch` so the browser playground runs the very
//! same code; it is re-exported here so `crate::patch::*` paths are unchanged.
//! This module adds what only the app has: the on-disk patch store.
//! Design doc: `plans/node-graph.md`.

pub use empyrean_patch::*;

pub mod store;
