/// <reference types="@webgpu/types" />
// WebGPU host for a compiled patch: the same compute shader the gate's engine
// dispatches (one invocation per LED, packed RGB out), plus a point renderer
// that draws the LED buffer straight from the GPU — no readback on the main
// path. Bindings mirror engine/mod.rs; every byte uploaded here was packed by
// the wasm patch core, so nothing in this file knows a struct layout beyond
// buffer sizes.

import type { Limits } from "./core";

export interface Geometry {
  spokes: number;
  pixels: number;
  /** Inner radius over outer radius. */
  innerOverOuter: number;
}

/** One frame of inputs, as bytes from `PatchSim`. */
export interface FrameData {
  globals: Uint8Array;
  previewGlobals: Uint8Array;
  audio: Uint8Array;
  effects: Uint8Array;
  dabs: Uint8Array;
  touches: Uint8Array;
  slab: Float32Array;
}

export class WebGpuUnavailable extends Error {}

/** Fraction of the canvas's short side the array's outer edge reaches. */
const VIEW_FILL = 0.96;

/** A point on a canvas showing the array back to the polar position effects
 * and strokes take (`angle` radians, `radius` 0 center .. 1 outer edge), the
 * inverse of the view's layout. Matches the gate preview's `toPolar`. */
export function screenToPolar(
  canvas: HTMLElement,
  clientX: number,
  clientY: number,
): { angle: number; radius: number } {
  const rect = canvas.getBoundingClientRect();
  const m = Math.min(rect.width, rect.height) * VIEW_FILL;
  const x = ((clientX - rect.left - rect.width / 2) / m) * 2;
  const y = -((clientY - rect.top - rect.height / 2) / m) * 2;
  return { angle: Math.atan2(y, x) + Math.PI / 2, radius: Math.hypot(x, y) };
}

/** A shader that failed to compile or link, with the compiler's messages. */
export class ShaderError extends Error {
  constructor(
    message: string,
    readonly details: string[],
  ) {
    super(message);
  }
}

export async function requestGateDevice(): Promise<GPUDevice> {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    throw new WebGpuUnavailable("This browser does not support WebGPU.");
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new WebGpuUnavailable("No WebGPU adapter is available.");
  return adapter.requestDevice();
}

const TAU = Math.PI * 2;

const VIEW_WGSL = /* wgsl */ `
struct View {
  spokes: u32,
  pixels: u32,
  drawn: u32,
  _pad0: u32,
  inner: f32,
  _pad1: f32,
  scale: vec2f,
  dot: vec2f,
  _pad2: vec2f,
}
@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> LED: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

const TAU: f32 = ${TAU};
const PI: f32 = ${Math.PI};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let spoke = ii / V.drawn;
  let k = ii % V.drawn;
  // Decimated: the k-th drawn dot on this spoke stands in for LED i.
  var i = 0u;
  if V.drawn > 1u {
    i = u32(round(f32(k) * f32(V.pixels - 1u) / f32(V.drawn - 1u)));
  }
  let rgb = unpack4x8unorm(LED[spoke * V.pixels + i]).rgb;
  // Laid out as the gate's own preview draws it (src/GateCanvas.tsx), so a
  // pattern looks the same here as on the operator's screen; i = 0 is the
  // outer end of the spoke. See screenToPolar for the inverse.
  let theta = f32(spoke) / f32(V.spokes) * TAU - PI / 2.0;
  let rn = mix(1.0, V.inner, f32(i) / f32(max(V.pixels - 1u, 1u)));
  let c = corners[vi];
  var out: VOut;
  out.pos = vec4f(rn * vec2f(cos(theta), sin(theta)) * V.scale + c * V.dot, 0.0, 1.0);
  out.uv = c;
  out.color = rgb;
  return out;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let radius = length(v.uv) * 0.5;
  let core = 1.0 - smoothstep(0.16, 0.36, radius);
  let halo = (1.0 - smoothstep(0.26, 0.5, radius)) * 0.45;
  let a = max(core, halo);
  // Premultiplied, additive: light accumulates, as it does in the air.
  return vec4f(v.color * a, a);
}
`;

const VIEW_BYTES = 48;

interface View {
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  uniform: GPUBuffer;
  bind: GPUBindGroup;
  drawn: number;
}

export class GateGpu {
  readonly device: GPUDevice;
  readonly geometry: Geometry;
  private limits: Limits;
  private format: GPUTextureFormat;

  private globals: GPUBuffer;
  private previewGlobals: GPUBuffer;
  private audio: GPUBuffer;
  private fx: GPUBuffer;
  /** Binding 4: the packed RGB frame, one u32 per LED. */
  readonly out: GPUBuffer;
  private dabs: GPUBuffer;
  private scope: GPUBuffer;
  private video: GPUBuffer;
  private slab: GPUBuffer;
  private touches: GPUBuffer;
  private previewOut: GPUBuffer | null = null;
  private previewRead: GPUBuffer | null = null;
  private previewBusy = false;

  private layout: GPUBindGroupLayout;
  private main: GPUComputePipeline | null = null;
  private mainBind: GPUBindGroup | null = null;
  private preview: GPUComputePipeline | null = null;
  private previewBind: GPUBindGroup | null = null;
  private previewCells = 0;

  private viewLayout: GPUBindGroupLayout;
  private viewPipeline: GPURenderPipeline;
  private views = new Map<HTMLCanvasElement, View>();

  constructor(device: GPUDevice, limits: Limits, geometry: Geometry) {
    this.device = device;
    this.limits = limits;
    this.geometry = geometry;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    const leds = geometry.spokes * geometry.pixels;
    const U = GPUBufferUsage;
    const buf = (size: number, usage: number) =>
      device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage });

    this.globals = buf(limits.globalsBytes, U.UNIFORM | U.COPY_DST);
    this.previewGlobals = buf(limits.globalsBytes, U.UNIFORM | U.COPY_DST);
    this.audio = buf(limits.audioBytes, U.UNIFORM | U.COPY_DST);
    this.fx = buf(limits.effectBytes * limits.maxEffects, U.STORAGE | U.COPY_DST);
    // COPY_SRC so tests (and a future capture/export) can read the frame back.
    // Two frames: the patch's `finish` keeps frame N-1 in the second half
    // for its Feedback node (patch_lib.wgsl); the view draws the first.
    this.out = buf(leds * 8, U.STORAGE | U.COPY_SRC);
    this.dabs = buf(limits.dabBytes * limits.maxDabs, U.STORAGE | U.COPY_DST);
    this.scope = buf(limits.scopeFloats * limits.audioSources * 4, U.STORAGE | U.COPY_DST);
    // Cell 0: the live video frame; cells 1..: the patch's Still images.
    this.video = buf(limits.mediaBufferBytes, U.STORAGE | U.COPY_DST);
    this.slab = buf(limits.maxSlabFloats * 4, U.STORAGE | U.COPY_DST);
    // A fixed-length uniform array in the shader (storage buffers are at the
    // default per-stage limit on the gate's shared layout).
    this.touches = buf(limits.touchBytes * limits.maxTouches, U.UNIFORM | U.COPY_DST);

    const C = GPUShaderStage.COMPUTE;
    const ro = { type: "read-only-storage" } as const;
    this.layout = device.createBindGroupLayout({
      label: "patch",
      entries: [
        { binding: 0, visibility: C, buffer: { type: "uniform" } },
        { binding: 1, visibility: C, buffer: { type: "uniform" } },
        { binding: 3, visibility: C, buffer: ro },
        { binding: 4, visibility: C, buffer: { type: "storage" } },
        { binding: 5, visibility: C, buffer: ro },
        { binding: 6, visibility: C, buffer: ro },
        { binding: 7, visibility: C, buffer: ro },
        { binding: 8, visibility: C, buffer: ro },
        { binding: 10, visibility: C, buffer: { type: "uniform" } },
      ],
    });

    this.viewLayout = device.createBindGroupLayout({
      label: "gate view",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: ro },
      ],
    });
    const module = device.createShaderModule({ label: "gate view", code: VIEW_WGSL });
    this.viewPipeline = device.createRenderPipeline({
      label: "gate view",
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format: this.format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  /** Build the pipelines for a compiled patch. Throws [`ShaderError`] with the
   * compiler's messages if the WGSL is rejected (which would be a codegen bug:
   * the same shader is naga-validated in the crate's tests). */
  async setProgram(wgsl: string, previewWgsl: string, previewCells: number): Promise<void> {
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const build = async (label: string, code: string) => {
      const module = this.device.createShaderModule({ label, code });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === "error");
      if (errors.length) {
        throw new ShaderError(
          `${label} shader failed to compile`,
          // `wgsl:L:C`, the form the patch core's `relocateError` reads.
          errors.map((m) => `wgsl:${m.lineNum}:${m.linePos} ${m.message}`),
        );
      }
      try {
        return await this.device.createComputePipelineAsync({
          label,
          layout: pipelineLayout,
          compute: { module, entryPoint: "main" },
        });
      } catch (e) {
        throw new ShaderError(`${label} pipeline failed`, [String(e)]);
      }
    };

    const main = await build("patch", wgsl);
    const preview = previewWgsl ? await build("patch preview", previewWgsl) : null;

    this.main = main;
    this.mainBind = this.bindGroup(this.globals, this.out);
    this.preview = preview;
    this.previewCells = preview ? previewCells : 0;
    this.previewOut?.destroy();
    this.previewRead?.destroy();
    this.previewOut = this.previewRead = this.previewBind = null;
    if (preview && previewCells > 0) {
      const bytes = previewCells * this.geometry.spokes * this.miniPixels() * 4;
      this.previewOut = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      this.previewRead = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      this.previewBind = this.bindGroup(this.previewGlobals, this.previewOut);
    }
  }

  private miniPixels(): number {
    return Math.min(this.limits.miniPixels, this.geometry.pixels);
  }

  private bindGroup(globals: GPUBuffer, out: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: globals } },
        { binding: 1, resource: { buffer: this.audio } },
        { binding: 3, resource: { buffer: this.fx } },
        { binding: 4, resource: { buffer: out } },
        { binding: 5, resource: { buffer: this.dabs } },
        { binding: 6, resource: { buffer: this.scope } },
        { binding: 7, resource: { buffer: this.video } },
        { binding: 8, resource: { buffer: this.slab } },
        { binding: 10, resource: { buffer: this.touches } },
      ],
    });
  }

  /** Upload one frame of inputs. */
  write(frame: FrameData) {
    const q = this.device.queue;
    q.writeBuffer(this.globals, 0, frame.globals as GPUAllowSharedBufferSource);
    q.writeBuffer(this.previewGlobals, 0, frame.previewGlobals as GPUAllowSharedBufferSource);
    q.writeBuffer(this.audio, 0, frame.audio as GPUAllowSharedBufferSource);
    if (frame.effects.byteLength) q.writeBuffer(this.fx, 0, frame.effects as GPUAllowSharedBufferSource);
    if (frame.dabs.byteLength) q.writeBuffer(this.dabs, 0, frame.dabs as GPUAllowSharedBufferSource);
    if (frame.slab.length) q.writeBuffer(this.slab, 0, frame.slab as GPUAllowSharedBufferSource);
    if (frame.touches.byteLength) {
      q.writeBuffer(this.touches, 0, frame.touches as GPUAllowSharedBufferSource);
    }
  }

  /** Per-source waveform + spectrum, `limits.scopeFloats` floats per source. */
  writeScope(data: Float32Array) {
    this.device.queue.writeBuffer(this.scope, 0, data as GPUAllowSharedBufferSource);
  }

  /** The frame the VIDEO buffer holds (RGBA8, `width × height`). Resizing
   * rebuilds the bind groups. */
  writeVideo(width: number, height: number, rgba: Uint8Array) {
    const bytes = Math.max(4, width * height * 4);
    if (this.video.size < bytes) {
      this.video.destroy();
      this.video = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      if (this.main) this.mainBind = this.bindGroup(this.globals, this.out);
      if (this.previewOut) this.previewBind = this.bindGroup(this.previewGlobals, this.previewOut);
    }
    this.device.queue.writeBuffer(this.video, 0, rgba as GPUAllowSharedBufferSource, 0, width * height * 4);
  }

  /** A Still image (IMAGE_SIZE² RGBA) into media cell `slot` (1..). */
  writeImage(slot: number, rgba: Uint8Array) {
    const cell = this.limits.imageSize * this.limits.imageSize * 4;
    if (slot < 1 || slot > this.limits.maxImages || rgba.byteLength !== cell) return;
    this.device.queue.writeBuffer(this.video, slot * cell, rgba as GPUAllowSharedBufferSource);
  }

  /** Render the frame: dispatch the patch, then draw every attached view. */
  render() {
    if (!this.main || !this.mainBind) return;
    const enc = this.device.createCommandEncoder({ label: "patch frame" });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.main);
    pass.setBindGroup(0, this.mainBind);
    pass.dispatchWorkgroups(Math.ceil((this.geometry.spokes * this.geometry.pixels) / 256));
    pass.end();
    for (const view of this.views.values()) this.drawView(enc, view);
    this.device.queue.submit([enc.finish()]);
  }

  /** Render the per-node thumbnails and read them back as 3-byte RGB cells
   * (`spokes × miniPixels` each), in `previewNodes` order. Resolves null when
   * there is nothing to preview or a readback is already in flight. */
  async readPreview(): Promise<{ spokes: number; pixels: number; cells: Uint8Array[] } | null> {
    if (!this.preview || !this.previewBind || !this.previewOut || !this.previewRead) return null;
    if (this.previewBusy) return null;
    this.previewBusy = true;
    const read = this.previewRead;
    const cells = this.previewCells;
    const spokes = this.geometry.spokes;
    const pixels = this.miniPixels();
    const perCell = spokes * pixels;
    try {
      const enc = this.device.createCommandEncoder({ label: "patch preview" });
      const pass = enc.beginComputePass();
      pass.setPipeline(this.preview);
      pass.setBindGroup(0, this.previewBind);
      pass.dispatchWorkgroups(Math.ceil((perCell * cells) / 256));
      pass.end();
      enc.copyBufferToBuffer(this.previewOut, 0, read, 0, read.size);
      this.device.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const packed = new Uint32Array(read.getMappedRange().slice(0));
      read.unmap();
      const out: Uint8Array[] = [];
      for (let c = 0; c < cells; c++) {
        const rgb = new Uint8Array(perCell * 3);
        for (let p = 0; p < perCell; p++) {
          const v = packed[c * perCell + p];
          rgb[p * 3] = v & 0xff;
          rgb[p * 3 + 1] = (v >> 8) & 0xff;
          rgb[p * 3 + 2] = (v >> 16) & 0xff;
        }
        out.push(rgb);
      }
      return { spokes, pixels, cells: out };
    } catch {
      // The buffer was replaced by a new program mid-flight; skip this round.
      return null;
    } finally {
      this.previewBusy = false;
    }
  }

  /** Draw the array into `canvas` every frame until detached. */
  attach(canvas: HTMLCanvasElement) {
    if (this.views.has(canvas)) return;
    const context = canvas.getContext("webgpu");
    if (!context) throw new WebGpuUnavailable("Could not create a WebGPU canvas context.");
    context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied" });
    const uniform = this.device.createBuffer({
      size: VIEW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bind = this.device.createBindGroup({
      layout: this.viewLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: this.out } },
      ],
    });
    this.views.set(canvas, { canvas, context, uniform, bind, drawn: 0 });
  }

  detach(canvas: HTMLCanvasElement) {
    const view = this.views.get(canvas);
    if (!view) return;
    view.context.unconfigure();
    view.uniform.destroy();
    this.views.delete(canvas);
  }

  private drawView(enc: GPUCommandEncoder, view: View) {
    const { canvas } = view;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    // Same decimation as the site's WebGL render: about one drawn dot per
    // 1.3 device pixels of spoke, each dot three spacings wide for the glow.
    const { spokes, pixels, innerOverOuter } = this.geometry;
    const radiusPx = (Math.min(w, h) / 2) * VIEW_FILL;
    const span = radiusPx * (1 - innerOverOuter);
    const drawn = Math.max(Math.min(32, pixels), Math.min(pixels, Math.round(span / 1.3)));
    const spacing = span / Math.max(drawn - 1, 1);
    const dotPx = Math.max(2, spacing * 3);
    const m = Math.min(w, h);
    const data = new ArrayBuffer(VIEW_BYTES);
    const u32 = new Uint32Array(data);
    const f32 = new Float32Array(data);
    u32[0] = spokes;
    u32[1] = pixels;
    u32[2] = drawn;
    f32[4] = innerOverOuter;
    f32[6] = (VIEW_FILL * m) / w;
    f32[7] = (VIEW_FILL * m) / h;
    f32[8] = dotPx / w;
    f32[9] = dotPx / h;
    this.device.queue.writeBuffer(view.uniform, 0, data);
    view.drawn = drawn;

    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: view.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.viewPipeline);
    pass.setBindGroup(0, view.bind);
    pass.draw(6, spokes * drawn);
    pass.end();
  }

  destroy() {
    for (const canvas of [...this.views.keys()]) this.detach(canvas);
    for (const b of [
      this.globals,
      this.previewGlobals,
      this.audio,
      this.fx,
      this.out,
      this.dabs,
      this.scope,
      this.video,
      this.slab,
      this.touches,
      this.previewOut,
      this.previewRead,
    ]) {
      b?.destroy();
    }
  }
}
