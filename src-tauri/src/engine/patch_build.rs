//! Building the active patch off the frame loop. A new patch, or an edit to
//! the one on air, is loaded, compiled and built into GPU pipelines on a
//! worker thread while the loop keeps rendering what is on air; the loop
//! installs the result between two frames (plans/seamless-patch-swap.md).
//!
//! One job builds for every bus that runs the patch, each on its own device
//! and all at once: the program bus, the thumbnail bus (the patch's preview
//! module) and the handoff bus (a standby, so the next crossfade away from
//! this patch has nothing to compile). An edit that leaves the shaders as
//! they are (a knob turn saved to the file) builds nothing.

use super::{BuiltPatch, PatchCompiler, PatchShader};
use crate::patch::codegen::Program;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender};

/// What a build is for: (patch id, patch epoch).
pub type PatchKey = (String, u32);

pub struct Request {
    pub key: PatchKey,
    pub program: PatchCompiler,
    /// The thumbnail bus, when there is one.
    pub minis: Option<PatchCompiler>,
    /// The handoff bus, when there is one.
    pub outgoing: Option<PatchCompiler>,
    /// The main and preview shaders installed now, when the program bus has
    /// them: an edit that keeps both needs no pipelines.
    pub running: Option<(Arc<PatchShader>, Arc<PatchShader>)>,
}

/// A patch ready to go on air.
pub struct Ready {
    /// With sub-patches inlined (`prog.doc`): what every node index refers to.
    pub prog: Program,
    pub shader: Arc<PatchShader>,
    pub preview: Arc<PatchShader>,
    /// `None` when the shaders are the ones running: keep those pipelines.
    pub pipelines: Option<Pipelines>,
    /// Decoded Still images: (media cell, RGBA).
    pub images: Vec<(u32, Vec<u8>)>,
}

pub struct Pipelines {
    pub program: BuiltPatch,
    /// `None` without a thumbnail bus, a preview module, or when it failed
    /// (logged; the thumbnails go dark for this patch).
    pub minis: Option<BuiltPatch>,
    /// `None` without a handoff bus or when it failed (logged; a handoff
    /// then builds synchronously, and fails the same way).
    pub outgoing: Option<BuiltPatch>,
}

pub struct Done {
    pub key: PatchKey,
    /// The message for the status and the log when the patch cannot run.
    pub result: Result<Ready, String>,
}

/// The worker thread. Only the latest request matters: requests that queue
/// up behind a build are skipped, and the loop drops any result whose key it
/// no longer wants.
pub struct PatchBuilder {
    requests: Sender<Request>,
    done: Receiver<Done>,
}

impl PatchBuilder {
    pub fn new() -> Self {
        let (requests, jobs) = mpsc::channel::<Request>();
        let (finished, done) = mpsc::channel();
        std::thread::Builder::new()
            .name("patch-build".into())
            .spawn(move || {
                while let Ok(mut request) = jobs.recv() {
                    while let Ok(newer) = jobs.try_recv() {
                        request = newer;
                    }
                    let key = request.key.clone();
                    let result = build(request);
                    if finished.send(Done { key, result }).is_err() {
                        break;
                    }
                }
            })
            .expect("spawn the patch builder thread");
        Self { requests, done }
    }

    pub fn request(&self, request: Request) {
        // The worker only stops when this sender is dropped.
        let _ = self.requests.send(request);
    }

    /// The newest finished build, if any finished since the last call.
    pub fn try_take(&self) -> Option<Done> {
        let mut newest = None;
        while let Ok(done) = self.done.try_recv() {
            newest = Some(done);
        }
        newest
    }
}

fn build(request: Request) -> Result<Ready, String> {
    let (id, _) = &request.key;
    let prog = crate::patch::store::load(&crate::patch::store::patches_dir(), id)
        .and_then(|doc| crate::patch::codegen::compile(&doc))
        .map_err(|e| format!("patch compile failed: {e}"))?;
    let shader = Arc::new(PatchShader::main(&prog));
    let preview = Arc::new(PatchShader::preview(&prog));
    let unchanged = request
        .running
        .as_ref()
        .is_some_and(|(main, prev)| **main == *shader && **prev == *preview);
    let pipelines = if unchanged {
        None
    } else {
        let (program, minis, outgoing) = std::thread::scope(|s| {
            let minis = request
                .minis
                .as_ref()
                .filter(|_| !preview.wgsl.is_empty())
                .map(|c| s.spawn(|| c.build(&preview)));
            let outgoing = request
                .outgoing
                .as_ref()
                .map(|c| s.spawn(|| c.build(&shader)));
            let program = request.program.build(&shader);
            (program, minis.map(joined), outgoing.map(joined))
        });
        // Shader errors inside a Code node's body point at the user's own
        // lines.
        let program = program.map_err(|e| {
            format!(
                "patch pipeline failed: {}",
                prog.relocate_error(&format!("{e:#}"))
            )
        })?;
        let minis = minis.and_then(|r| {
            r.inspect_err(|e| log::warn!("mini preview pipeline failed: {e:#}"))
                .ok()
        });
        let outgoing = outgoing.and_then(|r| {
            r.inspect_err(|e| log::warn!("handoff bus patch pipeline failed: {e:#}"))
                .ok()
        });
        Some(Pipelines {
            program,
            minis,
            outgoing,
        })
    };
    let images = decode_images(&prog);
    Ok(Ready {
        prog,
        shader,
        preview,
        pipelines,
        images,
    })
}

fn joined(
    handle: std::thread::ScopedJoinHandle<'_, anyhow::Result<BuiltPatch>>,
) -> anyhow::Result<BuiltPatch> {
    handle
        .join()
        .unwrap_or_else(|_| Err(anyhow::anyhow!("the pipeline build panicked")))
}

/// The program's Still images, decoded; one that cannot be is left out
/// (logged) and its cell reads as empty.
fn decode_images(prog: &Program) -> Vec<(u32, Vec<u8>)> {
    prog.images
        .iter()
        .filter_map(|&(n, slot)| {
            let media = prog.doc.nodes[n].media.as_deref()?;
            match crate::patch::media::decode(media) {
                Ok(rgba) => Some((slot, rgba)),
                Err(e) => {
                    log::warn!(
                        "patch image on node {} not loaded: {e}",
                        prog.doc.nodes[n].id
                    );
                    None
                }
            }
        })
        .collect()
}
