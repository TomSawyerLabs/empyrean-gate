//! The GPU engine and the frame-generation loop — the primary feature of this app.
//! Runs on a dedicated OS thread, fully independent of any UI.
//!
//! wgpu locked to the Vulkan backend, deliberately: no fallbacks, just a clear error
//! surfaced to every client when Vulkan is unavailable.
//!
//! Readback uses two staging buffers in ping-pong: while the GPU computes frame N,
//! the CPU maps and distributes frame N-1 (sACN + preview). One frame of latency,
//! zero pipeline stalls.

use crate::layers::{GpuDab, GpuEffect, GpuLayer, MAX_AUDIO_SOURCES, MAX_DABS, MAX_EFFECTS, MAX_LAYERS};
use crate::protocol::ServerMsg;
use crate::sacn::SacnSender;
use crate::state::{PreviewFrame, SharedState};
use anyhow::{Context, Result};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[repr(C)]
#[derive(Debug, Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Globals {
    pub spokes: u32,
    pub pixels: u32,
    pub layer_count: u32,
    pub effect_count: u32,
    pub time: f32,
    pub dt: f32,
    pub master: f32,
    pub inner_over_outer: f32,
    pub tilt_x: f32,
    pub tilt_y: f32,
    pub shake: f32,
    pub yaw: f32,
    pub dab_count: u32,
    pub _pad0: u32,
    pub _pad1: u32,
    pub _pad2: u32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct AudioUniform {
    pub level: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub onset: f32,
    pub beat_phase: f32,
    pub bpm: f32,
    pub _pad: f32,
}

pub struct FrameInputs {
    pub globals: Globals,
    pub audio: [AudioUniform; MAX_AUDIO_SOURCES],
    pub layers: Vec<GpuLayer>,
    pub effects: Vec<GpuEffect>,
    pub dabs: Vec<GpuDab>,
}

pub struct Engine {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    bind_group: wgpu::BindGroup,
    globals_buf: wgpu::Buffer,
    audio_buf: wgpu::Buffer,
    layers_buf: wgpu::Buffer,
    effects_buf: wgpu::Buffer,
    dabs_buf: wgpu::Buffer,
    out_buf: wgpu::Buffer,
    staging: [wgpu::Buffer; 2],
    /// Submission index of the copy targeting each staging buffer.
    staging_submission: [Option<wgpu::SubmissionIndex>; 2],
    npix: u32,
    frame: u64,
    pub gpu_name: String,
    readback: Vec<u8>,
}

fn shader_source() -> String {
    #[cfg(feature = "shader-hot-reload")]
    {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/engine/shaders/gate.wgsl");
        if let Ok(src) = std::fs::read_to_string(path) {
            return src;
        }
    }
    include_str!("shaders/gate.wgsl").to_string()
}

impl Engine {
    pub fn new(npix: u32) -> Result<Self> {
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = wgpu::Backends::VULKAN;
        // Validation/debug layers only on request: the SDK validation layer has been
        // seen to crash inside vkCreateDevice on some drivers (Intel UHD + SDK 1.4.304).
        // Set EMPYREAN_GPU_DEBUG=1 to opt in when debugging GPU issues.
        desc.flags = if std::env::var("EMPYREAN_GPU_DEBUG").is_ok_and(|v| v == "1") {
            wgpu::InstanceFlags::debugging()
        } else {
            wgpu::InstanceFlags::empty()
        };
        let instance = wgpu::Instance::new(desc);

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        }))
        .context(
            "No Vulkan adapter found. This app requires a working Vulkan driver (no fallback \
             renderer, by design). Install or update your GPU driver and verify with `vulkaninfo`.",
        )?;

        let info = adapter.get_info();
        let gpu_name = format!("{} ({:?})", info.name, info.backend);
        log::info!("using adapter: {gpu_name}");

        log::debug!("requesting device");
        let (device, queue) =
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                label: Some("empyrean"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                ..Default::default()
            }))
            .context("Vulkan device creation failed")?;
        log::debug!("device created; allocating buffers");

        let globals_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("globals"),
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let audio_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("audio"),
            size: (std::mem::size_of::<AudioUniform>() * MAX_AUDIO_SOURCES) as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let layers_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("layers"),
            size: (std::mem::size_of::<GpuLayer>() * MAX_LAYERS) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let effects_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("effects"),
            size: (std::mem::size_of::<GpuEffect>() * MAX_EFFECTS) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let dabs_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("dabs"),
            size: (std::mem::size_of::<GpuDab>() * MAX_DABS) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let (out_buf, staging) = Self::make_pixel_buffers(&device, npix);

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("gate"),
            entries: &[
                uniform_entry(0),
                uniform_entry(1),
                storage_entry(2, true),
                storage_entry(3, true),
                storage_entry(4, false),
                storage_entry(5, true),
            ],
        });

        let mut engine = Self {
            bind_group: Self::make_bind_group(
                &device,
                &bind_group_layout,
                &globals_buf,
                &audio_buf,
                &layers_buf,
                &effects_buf,
                &out_buf,
                &dabs_buf,
            ),
            pipeline: Self::make_pipeline(&device, &bind_group_layout)?,
            device,
            queue,
            bind_group_layout,
            globals_buf,
            audio_buf,
            layers_buf,
            effects_buf,
            dabs_buf,
            out_buf,
            staging,
            staging_submission: [None, None],
            npix,
            frame: 0,
            gpu_name,
            readback: Vec::new(),
        };
        engine.readback = vec![0u8; (npix * 3) as usize];
        Ok(engine)
    }

    fn make_pipeline(
        device: &wgpu::Device,
        bgl: &wgpu::BindGroupLayout,
    ) -> Result<wgpu::ComputePipeline> {
        // Error scope instead of wgpu's default panic-on-validation-error: a broken
        // shader (live editing with hot-reload!) must surface as a UI error, not
        // kill the engine thread.
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gate.wgsl"),
            source: wgpu::ShaderSource::Wgsl(shader_source().into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("gate"),
            bind_group_layouts: &[Some(bgl)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("gate"),
            layout: Some(&layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        if let Some(err) = pollster::block_on(scope.pop()) {
            anyhow::bail!("shader/pipeline validation failed: {err}");
        }
        Ok(pipeline)
    }

    /// Rebuild the pipeline from the (possibly edited) shader source. Dev feature.
    pub fn reload_shader(&mut self) -> Result<()> {
        self.pipeline = Self::make_pipeline(&self.device, &self.bind_group_layout)?;
        log::info!("shader reloaded");
        Ok(())
    }

    fn make_pixel_buffers(device: &wgpu::Device, npix: u32) -> (wgpu::Buffer, [wgpu::Buffer; 2]) {
        let size = (npix as u64) * 4;
        let out = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("out"),
            size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let staging = std::array::from_fn(|i| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(if i == 0 { "staging-0" } else { "staging-1" }),
                size,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });
        (out, staging)
    }

    #[allow(clippy::too_many_arguments)]
    fn make_bind_group(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        globals: &wgpu::Buffer,
        audio: &wgpu::Buffer,
        layers: &wgpu::Buffer,
        effects: &wgpu::Buffer,
        out: &wgpu::Buffer,
        dabs: &wgpu::Buffer,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("gate"),
            layout,
            entries: &[
                bind(0, globals),
                bind(1, audio),
                bind(2, layers),
                bind(3, effects),
                bind(4, out),
                bind(5, dabs),
            ],
        })
    }

    /// Resize pixel buffers when the configured geometry changes.
    pub fn ensure_capacity(&mut self, npix: u32) {
        if npix == self.npix {
            return;
        }
        let (out, staging) = Self::make_pixel_buffers(&self.device, npix);
        self.out_buf = out;
        self.staging = staging;
        self.staging_submission = [None, None];
        self.npix = npix;
        self.frame = 0;
        self.readback = vec![0u8; (npix * 3) as usize];
        self.bind_group = Self::make_bind_group(
            &self.device,
            &self.bind_group_layout,
            &self.globals_buf,
            &self.audio_buf,
            &self.layers_buf,
            &self.effects_buf,
            &self.out_buf,
            &self.dabs_buf,
        );
    }

    /// Submit compute for this frame, then read back the PREVIOUS frame (ping-pong).
    /// Returns the previous frame's RGB bytes, or None on the very first frame.
    pub fn render(&mut self, inputs: &FrameInputs) -> Result<Option<&[u8]>> {
        let write_slot = (self.frame % 2) as usize;
        let read_slot = ((self.frame + 1) % 2) as usize;

        self.queue
            .write_buffer(&self.globals_buf, 0, bytemuck::bytes_of(&inputs.globals));
        self.queue
            .write_buffer(&self.audio_buf, 0, bytemuck::cast_slice(&inputs.audio));
        if !inputs.layers.is_empty() {
            self.queue
                .write_buffer(&self.layers_buf, 0, bytemuck::cast_slice(&inputs.layers));
        }
        if !inputs.effects.is_empty() {
            self.queue
                .write_buffer(&self.effects_buf, 0, bytemuck::cast_slice(&inputs.effects));
        }
        if !inputs.dabs.is_empty() {
            self.queue
                .write_buffer(&self.dabs_buf, 0, bytemuck::cast_slice(&inputs.dabs));
        }

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("frame") });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("gate"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.dispatch_workgroups(self.npix.div_ceil(256), 1, 1);
        }
        encoder.copy_buffer_to_buffer(
            &self.out_buf,
            0,
            &self.staging[write_slot],
            0,
            (self.npix as u64) * 4,
        );
        let submission = self.queue.submit([encoder.finish()]);
        self.staging_submission[write_slot] = Some(submission);
        self.frame += 1;

        // Read back the previous frame — its copy was submitted a full frame ago, so
        // the wait below is effectively free.
        let Some(prev_submission) = self.staging_submission[read_slot].take() else {
            return Ok(None);
        };
        let buf = &self.staging[read_slot];
        let slice = buf.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: Some(prev_submission),
                timeout: None,
            })
            .context("device poll failed")?;
        rx.recv()
            .context("map_async callback dropped")?
            .context("staging buffer map failed")?;
        {
            let data = slice.get_mapped_range();
            let words: &[u32] = bytemuck::cast_slice(&data);
            for (px, w) in words.iter().enumerate() {
                let o = px * 3;
                self.readback[o] = (*w & 0xff) as u8;
                self.readback[o + 1] = ((*w >> 8) & 0xff) as u8;
                self.readback[o + 2] = ((*w >> 16) & 0xff) as u8;
            }
        }
        buf.unmap();
        Ok(Some(&self.readback))
    }
}

fn uniform_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn storage_entry(binding: u32, read_only: bool) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn bind(binding: u32, buffer: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
    wgpu::BindGroupEntry {
        binding,
        resource: buffer.as_entire_binding(),
    }
}

// ---------------------------------------------------------------------------
// Autopilot: slow mean-reverting random walk over layer parameters
// ---------------------------------------------------------------------------

const WALK_PARAMS: usize = 8; // speed, scale, hue, hue_range, brightness, pa, pb, pc

#[derive(Clone, Default)]
struct LayerWalk {
    offsets: [f32; WALK_PARAMS],
}

struct WalkRng(u64);

impl WalkRng {
    fn new() -> Self {
        Self(0x853c_49e6_748f_ea9b ^ std::process::id() as u64)
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    /// Roughly N(0,1) (sum of uniforms), plenty for drift noise.
    fn gaussian(&mut self) -> f32 {
        let mut acc = 0.0f32;
        for _ in 0..3 {
            acc += (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32;
        }
        (acc - 1.5) * 1.6
    }
}

/// Ornstein-Uhlenbeck step: offsets drift smoothly, mean-revert to 0 (i.e. to the
/// slider positions), with stationary std ≈ 1. `tau` is the evolution time scale.
fn walk_step(walk: &mut LayerWalk, rng: &mut WalkRng, dt: f32, tau: f32) {
    let k = (dt / tau).min(0.5);
    for o in walk.offsets.iter_mut() {
        *o += -*o * k + rng.gaussian() * (2.0 * k).sqrt();
        *o = o.clamp(-2.5, 2.5);
    }
}

/// Apply a layer's walk offsets around its configured values. The user's slider
/// value is the center; `walk_amount` scales the wander radius per parameter.
fn walked_layer(l: &crate::layers::LayerCfg, w: &LayerWalk) -> crate::layers::LayerCfg {
    let a = l.walk_amount;
    let mut out = l.clone();
    out.speed = l.speed + w.offsets[0] * 0.6 * a;
    out.scale = (l.scale * (1.0 + w.offsets[1] * 0.4 * a)).clamp(0.05, 6.0);
    out.hue = l.hue + w.offsets[2] * 0.12 * a; // hue wraps in the shader
    out.hue_range = (l.hue_range + w.offsets[3] * 0.08 * a).clamp(0.0, 1.0);
    out.brightness = (l.brightness * (1.0 + w.offsets[4] * 0.25 * a)).clamp(0.0, 2.0);
    out.param_a = (l.param_a + w.offsets[5] * 0.2 * a).clamp(0.0, 1.0);
    out.param_b = (l.param_b + w.offsets[6] * 0.2 * a).clamp(0.0, 1.0);
    out.param_c = (l.param_c + w.offsets[7] * 0.2 * a).clamp(0.0, 1.0);
    out
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

pub fn spawn(state: Arc<SharedState>) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new()
        .name("engine".into())
        .spawn(move || engine_thread(state))
        .expect("spawn engine thread")
}

fn engine_thread(state: Arc<SharedState>) {
    while !state.shutdown.load(Ordering::Relaxed) {
        let npix = state.config.read().geometry.pixel_count() as u32;
        match Engine::new(npix) {
            Ok(mut engine) => {
                state.status.lock().gpu_error = None;
                state.status.lock().gpu_name = engine.gpu_name.clone();
                run_frames(&state, &mut engine);
            }
            Err(e) => {
                let msg = format!("{e:#}");
                log::error!("engine init failed: {msg}");
                state.status.lock().gpu_error = Some(msg.clone());
                let _ = state.events.send(ServerMsg::Error { message: msg });
                // Clear error + retry periodically; a driver install may fix it live.
                std::thread::sleep(Duration::from_secs(5));
            }
        }
    }
}

#[cfg(feature = "shader-hot-reload")]
fn spawn_shader_watcher(flag: Arc<std::sync::atomic::AtomicBool>) -> Option<impl Sized> {
    use notify::Watcher;
    let dir = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/src/engine/shaders"));
    if !dir.exists() {
        return None;
    }
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            flag.store(true, Ordering::Relaxed);
        }
    })
    .ok()?;
    watcher.watch(dir, notify::RecursiveMode::NonRecursive).ok()?;
    log::info!("shader hot-reload watching {}", dir.display());
    Some(watcher)
}

fn run_frames(state: &Arc<SharedState>, engine: &mut Engine) {
    let mut sacn = match SacnSender::new() {
        Ok(s) => Some(s),
        Err(e) => {
            log::error!("sACN socket unavailable: {e}");
            None
        }
    };

    let mut epoch = u32::MAX;
    let mut output_cfg_key = String::new();
    let mut layer_phases: Vec<f64> = Vec::new();
    let mut layer_walks: Vec<LayerWalk> = Vec::new();
    let mut walk_rng = WalkRng::new();
    let mut last_frame = Instant::now();
    let mut last_sacn = Instant::now();
    let mut last_status = Instant::now();
    let mut fps_ema = 0.0f32;
    let mut frame_ms_ema = 0.0f32;
    let mut frame_number: u64 = 0;
    let mut sacn_packets: usize = 0;

    #[cfg(feature = "shader-hot-reload")]
    let shader_dirty = Arc::new(std::sync::atomic::AtomicBool::new(false));
    #[cfg(feature = "shader-hot-reload")]
    let _watcher = spawn_shader_watcher(shader_dirty.clone());

    while !state.shutdown.load(Ordering::Relaxed) {
        #[cfg(feature = "shader-hot-reload")]
        if shader_dirty.swap(false, Ordering::Relaxed) {
            if let Err(e) = engine.reload_shader() {
                let msg = format!("shader reload failed: {e:#}");
                log::error!("{msg}");
                let _ = state.events.send(ServerMsg::Error { message: msg });
            }
        }

        // Reconfigure buffers + the sACN plan only when geometry/output change —
        // NOT on every config epoch bump (sliders would reset sequence numbers).
        let cfg = state.config.read().clone();
        let current_epoch = state.epoch();
        if current_epoch != epoch {
            epoch = current_epoch;
            let key = serde_json::to_string(&(&cfg.geometry, &cfg.output)).unwrap_or_default();
            if key != output_cfg_key {
                output_cfg_key = key;
                engine.ensure_capacity(cfg.geometry.pixel_count() as u32);
                if let Some(s) = sacn.as_mut() {
                    s.configure(&cfg.geometry, &cfg.output);
                    state.status.lock().sacn_universes = s.universe_count();
                }
            }
        }
        layer_phases.resize(cfg.layers.len(), 0.0);
        layer_walks.resize(cfg.layers.len(), LayerWalk::default());

        // Pace the loop.
        let target_dt = Duration::from_secs_f32(1.0 / cfg.render.fps.clamp(1.0, 240.0));
        let elapsed = last_frame.elapsed();
        if elapsed < target_dt {
            let remaining = target_dt - elapsed;
            if remaining > Duration::from_millis(2) {
                std::thread::sleep(remaining - Duration::from_millis(2));
            }
            while last_frame.elapsed() < target_dt {
                std::hint::spin_loop();
            }
        }
        let now = Instant::now();
        let dt = (now - last_frame).as_secs_f32();
        last_frame = now;

        // Gather inputs.
        let mut audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        for (i, slot) in state.audio.iter().enumerate() {
            let a = slot.lock();
            audio[i] = AudioUniform {
                level: a.level,
                bass: a.bass,
                mid: a.mid,
                treble: a.treble,
                onset: a.onset,
                beat_phase: a.beat_phase,
                bpm: a.bpm,
                _pad: 0.0,
            };
        }
        let control = *state.control.lock();

        // Autopilot: evolve walk offsets (~minutes time scale) and render the
        // walked parameter values; the config itself is never modified.
        let walk_tau = 45.0 / cfg.render.walk_speed.clamp(0.05, 20.0);
        let mut layers = Vec::with_capacity(cfg.layers.len().min(MAX_LAYERS));
        for (i, l) in cfg.layers.iter().take(MAX_LAYERS).enumerate() {
            if !l.enabled {
                continue;
            }
            let l = if cfg.render.walk_enabled && l.walk_amount > 0.0 {
                walk_step(&mut layer_walks[i], &mut walk_rng, dt, walk_tau);
                walked_layer(l, &layer_walks[i])
            } else {
                l.clone()
            };
            layer_phases[i] += (l.speed * cfg.render.master_speed * dt) as f64;
            layers.push(l.to_gpu(layer_phases[i] as f32));
        }

        let effects: Vec<GpuEffect> = {
            let mut fx = state.effects.lock();
            fx.retain(|e| {
                let dur = if e.cfg.duration > 0.0 {
                    e.cfg.duration
                } else {
                    e.cfg.kind.default_duration()
                };
                e.born.elapsed().as_secs_f32() < dur
            });
            fx.iter()
                .map(|e| GpuEffect {
                    kind: e.cfg.kind.gpu_id(),
                    _pad: 0,
                    age: e.born.elapsed().as_secs_f32(),
                    duration: if e.cfg.duration > 0.0 {
                        e.cfg.duration
                    } else {
                        e.cfg.kind.default_duration()
                    },
                    angle: e.cfg.angle,
                    radius: e.cfg.radius,
                    intensity: e.cfg.intensity,
                    hue: e.cfg.hue,
                })
                .collect()
        };

        let dabs: Vec<GpuDab> = {
            let mut dabs = state.dabs.lock();
            dabs.retain(|d| d.born.elapsed().as_secs_f32() < d.kind.lifetime());
            dabs.iter()
                .take(MAX_DABS)
                .map(|d| GpuDab {
                    kind: d.kind.gpu_id(),
                    age: d.born.elapsed().as_secs_f32() / d.kind.lifetime(),
                    angle: d.angle,
                    radius: d.radius,
                    hue: d.hue,
                    size: d.size,
                    intensity: d.intensity,
                    _pad: 0.0,
                })
                .collect()
        };

        let inputs = FrameInputs {
            globals: Globals {
                spokes: cfg.geometry.spokes,
                pixels: cfg.geometry.pixels_per_spoke,
                layer_count: layers.len() as u32,
                effect_count: effects.len() as u32,
                time: state.started.elapsed().as_secs_f32(),
                dt,
                master: cfg.render.master_brightness,
                inner_over_outer: (cfg.geometry.inner_radius_ft
                    / cfg.geometry.outer_radius_ft.max(0.001))
                .clamp(0.0, 1.0),
                tilt_x: control.roll,
                tilt_y: control.pitch,
                shake: control.shake,
                yaw: control.yaw,
                dab_count: dabs.len() as u32,
                _pad0: 0,
                _pad1: 0,
                _pad2: 0,
            },
            audio,
            layers,
            effects,
            dabs,
        };

        let t0 = Instant::now();
        let rgb = match engine.render(&inputs) {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("render failed: {e:#}");
                log::error!("{msg}");
                let _ = state.events.send(ServerMsg::Error { message: msg });
                return; // drop back to engine_thread for re-init
            }
        };
        let frame_ms = t0.elapsed().as_secs_f32() * 1000.0;

        if let Some(rgb) = rgb {
            frame_number += 1;

            // sACN first: the wire is the primary output.
            if cfg.output.enabled {
                if let Some(s) = sacn.as_mut() {
                    let cap = cfg.output.fps.clamp(1.0, 120.0);
                    // sync_to_render: every rendered frame up to the cap. The 0.9
                    // tolerance stops beat-frequency frame drops when render fps
                    // sits right at the cap.
                    let interval = if cfg.output.sync_to_render {
                        Duration::from_secs_f32(0.9 / cap)
                    } else {
                        Duration::from_secs_f32(1.0 / cap)
                    };
                    if last_sacn.elapsed() >= interval {
                        last_sacn = now;
                        sacn_packets += s.send_frame(rgb);
                    }
                }
            }

            // Preview fan-out (subscribers decimate/throttle for themselves).
            if state.preview.receiver_count() > 0 {
                let _ = state.preview.send(Arc::new(PreviewFrame {
                    frame_number,
                    spokes: cfg.geometry.spokes,
                    pixels_per_spoke: cfg.geometry.pixels_per_spoke,
                    rgb: rgb.to_vec(),
                }));
            }
        }

        // Status at ~2 Hz.
        fps_ema = fps_ema * 0.9 + (1.0 / dt.max(1e-6)) * 0.1;
        frame_ms_ema = frame_ms_ema * 0.9 + frame_ms * 0.1;
        if last_status.elapsed() > Duration::from_millis(500) {
            let window = last_status.elapsed().as_secs_f32();
            last_status = Instant::now();
            let status = {
                let mut st = state.status.lock();
                st.engine_fps = fps_ema;
                st.frame_time_ms = frame_ms_ema;
                st.sacn_enabled = cfg.output.enabled;
                st.sacn_pps = (sacn_packets as f32 / window.max(0.001)) as u32;
                st.master_brightness = cfg.render.master_brightness;
                st.master_speed = cfg.render.master_speed;
                st.audio = state
                    .audio
                    .iter()
                    .zip(cfg.audio.sources.iter())
                    .map(|(slot, src)| {
                        let a = slot.lock();
                        crate::protocol::AudioSourceStatus {
                            id: src.id.clone(),
                            active: a.active,
                            level: a.level,
                            bass: a.bass,
                            mid: a.mid,
                            treble: a.treble,
                            bpm: a.bpm,
                            beat_phase: a.beat_phase,
                        }
                    })
                    .collect();
                st.clone()
            };
            sacn_packets = 0;
            let _ = state.events.send(ServerMsg::Status { status });
        }

        // Decay the shake control input.
        state.control.lock().shake *= (-dt / 0.3).exp();
    }
}
