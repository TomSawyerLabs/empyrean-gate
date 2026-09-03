//! The mini-preview render bus: a tiny solo render of every playing layer (or,
//! when a node-graph patch is on air, of every field node in the patch), so the
//! UI can show what each one contributes to the composite. Runs on its own
//! low-resolution `Engine` (the ready-bus pattern) and publishes `MiniBatch`es
//! over `state.minis` only while at least one client is subscribed.
//!
//! Layer cells cycle one solo dispatch per program frame — a full sweep of an
//! 8-layer stack refreshes every cell at ~7 Hz for the cost of one extra
//! 1k-pixel dispatch per frame. Patch cells render in a single dispatch of the
//! patch's companion preview module (`Program::preview_wgsl`), all nodes at
//! once, at the publish cadence.

use super::{Engine, FrameInputs};
use crate::state::{MiniBatch, MiniKind, SharedState};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

/// Radial samples per spoke in a mini cell. The polar math is fully normalized
/// (`r01 = i / (pixels - 1)`), so a shorter spoke renders the same pattern —
/// 16 samples is plenty for a thumbnail under ~120 px.
pub const MINI_PIXELS: u32 = 16;

/// Publish cadence cap. Layer sweeps naturally refresh slower than this on
/// real stacks; single-layer stacks and patch renders are held to it.
const PUBLISH_INTERVAL: Duration = Duration::from_millis(100);

/// Everything the mini bus needs from the active patch's compiled program.
/// Built once at patch-compile time so the per-frame path never touches the
/// document again.
pub struct PatchPreviewInfo {
    /// Identity of the compiled program (patch id + epoch); the preview
    /// pipeline is reinstalled when it changes.
    pub key: String,
    /// Companion WGSL module (empty when the patch has no field nodes).
    pub wgsl: String,
    /// Node id per cell slot, in the module's slot order.
    pub node_ids: Vec<String>,
    /// (node id, port) per scalar-meter slot.
    pub scalar_refs: Vec<(String, String)>,
    /// (doc node index, port) matching `scalar_refs`, for value lookup.
    pub scalar_nodes: Vec<(usize, &'static str)>,
}

/// What the previous mini dispatch rendered — the ping-pong readback is one
/// dispatch behind, so every returned buffer is labeled by this, not by what
/// was just submitted.
enum Pending {
    Layer(u16),
    Patch { slots: usize },
}

pub struct MiniBus {
    engine: Option<Engine>,
    /// Position in the layer sweep.
    cursor: usize,
    pending: Option<Pending>,
    /// Latest completed solo frame per config layer index.
    layer_cells: HashMap<u16, Vec<u8>>,
    batch: u64,
    next_publish: Instant,
    /// Bumped whenever geometry or the patch node/scalar lists change.
    meta_epoch: u64,
    meta_key: (u32, u32, String),
    /// Key of the preview shader currently installed on the engine.
    installed_preview: String,
    patch_nodes: Arc<Vec<String>>,
    patch_scalars: Arc<Vec<(String, String)>>,
    /// Kind of the last published batch, to emit one empty batch on mode
    /// changes so stale cells clear client-side.
    last_published: Option<MiniKind>,
}

impl MiniBus {
    pub fn new(npix_hint: u32) -> Self {
        let engine = match Engine::new(npix_hint.max(1)) {
            Ok(engine) => Some(engine),
            Err(error) => {
                log::warn!("mini-preview render bus unavailable: {error:#}");
                None
            }
        };
        Self {
            engine,
            cursor: 0,
            pending: None,
            layer_cells: HashMap::new(),
            batch: 0,
            next_publish: Instant::now(),
            meta_epoch: 0,
            meta_key: (0, 0, String::new()),
            installed_preview: String::new(),
            patch_nodes: Arc::new(Vec::new()),
            patch_scalars: Arc::new(Vec::new()),
            last_published: None,
        }
    }

    /// One program-frame tick. `layer_cfg_index[i]` is the config index of
    /// `base.layers[i]` (`None` for a transition's outgoing copies).
    pub fn tick(
        &mut self,
        state: &Arc<SharedState>,
        base: &FrameInputs,
        layer_cfg_index: &[Option<usize>],
        patch_preview: Option<&PatchPreviewInfo>,
        patch_rt: Option<&crate::patch::eval::Runtime>,
    ) {
        if self.engine.is_none() {
            return;
        }
        if state.mini_watchers.load(Ordering::Relaxed) == 0 {
            // Nobody watching: idle completely. Drop stale state so the first
            // frame after a resubscribe never publishes an old look.
            self.cursor = 0;
            self.pending = None;
            self.layer_cells.clear();
            self.last_published = None;
            return;
        }

        let spokes = base.globals.spokes.max(1);
        let pixels = MINI_PIXELS.min(base.globals.pixels.max(1));
        let total = spokes * pixels;
        let now = Instant::now();

        let patch_active = base.patch_params.is_some();
        if patch_active {
            let (Some(info), Some(rt)) = (patch_preview, patch_rt) else {
                return;
            };
            // Meter values are current every frame; cells refresh at the
            // publish cadence — one preview dispatch per published batch.
            if now < self.next_publish {
                return;
            }
            self.next_publish = now + PUBLISH_INTERVAL;
            self.refresh_meta(spokes, pixels, info);
            let slots = info.node_ids.len();
            let mut cells = Vec::new();
            if slots > 0 && !info.wgsl.is_empty() {
                let engine = self.engine.as_mut().expect("checked above");
                if self.installed_preview != info.key {
                    match engine.set_patch_shader(Some(&info.wgsl)) {
                        Ok(()) => self.installed_preview = info.key.clone(),
                        Err(error) => {
                            // A program that validated for the main pipeline
                            // should validate here too; if not, disable cells
                            // for this patch rather than retrying every tick.
                            log::warn!("mini preview pipeline failed: {error:#}");
                            self.installed_preview = info.key.clone();
                            let _ = engine.set_patch_shader(None);
                        }
                    }
                }
                engine.ensure_capacity(total * slots as u32);
                let mut inputs = base.clone();
                inputs.globals.pixels = pixels;
                inputs.layers.clear();
                inputs.globals.layer_count = 0;
                match engine.render(&inputs) {
                    Ok(Some(rgb)) => {
                        if matches!(self.pending, Some(Pending::Patch { slots: s }) if s == slots)
                        {
                            let cell = (total * 3) as usize;
                            for slot in 0..slots {
                                cells.push((slot as u16, rgb[slot * cell..(slot + 1) * cell].to_vec()));
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        log::warn!("mini preview render failed: {error:#}");
                        self.engine = None;
                        return;
                    }
                }
                self.pending = Some(Pending::Patch { slots });
            } else {
                self.pending = None;
            }
            let scalars = info
                .scalar_nodes
                .iter()
                .enumerate()
                .map(|(slot, (node, port))| (slot as u16, rt.scalar_value(*node, port)))
                .collect();
            self.publish(state, MiniKind::Patch, spokes, pixels, cells, scalars);
            return;
        }

        // ---- Layer stack mode -------------------------------------------------
        self.refresh_layer_meta(spokes, pixels);
        let sweep: Vec<(usize, u16)> = layer_cfg_index
            .iter()
            .enumerate()
            .filter_map(|(slot, cfg)| cfg.map(|c| (slot, c as u16)))
            .collect();
        self.layer_cells
            .retain(|id, _| sweep.iter().any(|(_, c)| c == id));
        if sweep.is_empty() {
            self.pending = None;
            if now >= self.next_publish {
                self.next_publish = now + PUBLISH_INTERVAL;
                self.publish(state, MiniKind::Layers, spokes, pixels, Vec::new(), Vec::new());
            }
            return;
        }

        let engine = self.engine.as_mut().expect("checked above");
        engine.ensure_capacity(total);
        let (slot, id) = sweep[self.cursor % sweep.len()];
        self.cursor = (self.cursor + 1) % sweep.len();
        let mut inputs = base.clone();
        inputs.globals.pixels = pixels;
        inputs.layers = vec![base.layers[slot]];
        inputs.globals.layer_count = 1;
        // The cell shows the layer's own contribution: pre-master (so a dimmed
        // show still has readable thumbnails), without transitions, overlays,
        // effects, dabs or the game world.
        inputs.globals.master = 1.0;
        inputs.globals.transition_active = 0;
        inputs.globals.transition_split = 0;
        inputs.globals.transition_progress = 0.0;
        inputs.effects.clear();
        inputs.globals.effect_count = 0;
        inputs.dabs.clear();
        inputs.globals.dab_count = 0;
        inputs.globals.dj_link_visual_active = 0;
        inputs.globals.game_active = 0;
        inputs.globals.game_mix = 0.0;
        inputs.patch_params = None;
        inputs.game_cells = None;
        match engine.render(&inputs) {
            Ok(Some(rgb)) => {
                if let Some(Pending::Layer(prev)) = self.pending.take() {
                    // Only keep it if that layer is still in the sweep.
                    if sweep.iter().any(|(_, c)| *c == prev) {
                        self.layer_cells.insert(prev, rgb.to_vec());
                    }
                }
            }
            Ok(None) => {}
            Err(error) => {
                log::warn!("mini preview render failed: {error:#}");
                self.engine = None;
                return;
            }
        }
        self.pending = Some(Pending::Layer(id));

        if now >= self.next_publish && !self.layer_cells.is_empty() {
            self.next_publish = now + PUBLISH_INTERVAL;
            let mut cells: Vec<(u16, Vec<u8>)> = self
                .layer_cells
                .iter()
                .map(|(id, rgb)| (*id, rgb.clone()))
                .collect();
            cells.sort_by_key(|(id, _)| *id);
            self.publish(state, MiniKind::Layers, spokes, pixels, cells, Vec::new());
        }
    }

    fn refresh_layer_meta(&mut self, spokes: u32, pixels: u32) {
        let key = (spokes, pixels, String::new());
        if self.meta_key != key {
            self.meta_key = key;
            self.meta_epoch += 1;
            self.patch_nodes = Arc::new(Vec::new());
            self.patch_scalars = Arc::new(Vec::new());
        }
    }

    fn refresh_meta(&mut self, spokes: u32, pixels: u32, info: &PatchPreviewInfo) {
        let key = (spokes, pixels, info.key.clone());
        if self.meta_key != key {
            self.meta_key = key;
            self.meta_epoch += 1;
            self.patch_nodes = Arc::new(info.node_ids.clone());
            self.patch_scalars = Arc::new(info.scalar_refs.clone());
        }
    }

    fn publish(
        &mut self,
        state: &Arc<SharedState>,
        kind: MiniKind,
        spokes: u32,
        pixels: u32,
        cells: Vec<(u16, Vec<u8>)>,
        scalars: Vec<(u16, f32)>,
    ) {
        // On a mode flip, lead with one empty batch of the departing kind so
        // clients drop its stale cells.
        if let Some(prev) = self.last_published
            && prev != kind
        {
            self.batch += 1;
            let _ = state.minis.send(Arc::new(MiniBatch {
                batch: self.batch,
                kind: prev,
                spokes,
                pixels,
                cells: Vec::new(),
                scalars: Vec::new(),
                meta_epoch: self.meta_epoch,
                patch_nodes: self.patch_nodes.clone(),
                patch_scalars: self.patch_scalars.clone(),
            }));
        }
        self.last_published = Some(kind);
        self.batch += 1;
        let _ = state.minis.send(Arc::new(MiniBatch {
            batch: self.batch,
            kind,
            spokes,
            pixels,
            cells,
            scalars,
            meta_epoch: self.meta_epoch,
            patch_nodes: self.patch_nodes.clone(),
            patch_scalars: self.patch_scalars.clone(),
        }));
    }
}
