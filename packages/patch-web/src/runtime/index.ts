// A patch running in the browser: the wasm patch core evaluates it, WebGPU
// renders it, and any number of canvases show it. Also a MiniSource, so the
// editor's node thumbnails and meters work exactly as they do against a gate.

import { pushScalar, type MiniScalar, type MiniSource } from "../editor/minis";
import type { PatchDoc } from "../types";
import { loadPatchCore, type PatchCore, type PatchSim } from "./core";
import { GateGpu, requestGateDevice, ShaderError, WebGpuUnavailable, type Geometry } from "./gpu";
import { MediaTexture, startMicrophone, startMotion, type Motion } from "./inputs";

export { loadPatchCore, type Limits, type PatchCore } from "./core";
export { screenToPolar, ShaderError, WebGpuUnavailable, type Geometry } from "./gpu";
export { MediaTexture, VIDEO_SIZE } from "./inputs";

/** The gate as built (`src-tauri/src/config.rs` defaults). */
export const GATE_GEOMETRY: Geometry = { spokes: 64, pixels: 378, innerOverOuter: 8 / 25 };

/** How often the node thumbnails refresh, as on the gate (`minis.rs`). */
const PREVIEW_INTERVAL_MS = 100;
/** Shake decay, as the engine applies to phone shakes. */
const SHAKE_TAU = 0.3;

export interface RuntimeStatus {
  /** A patch is compiled and rendering. */
  active: boolean;
  /** The running patch reads raw touch (a Touch / Touch mask / Touch glow
   * node), so it owns the touch surface: send `touch()` events, not taps. */
  touch: boolean;
  /** Why the latest document is not running (the previous one keeps going). */
  error: string | null;
}

/** An effect trigger: wire names as in the gate's `EffectCfg`. */
export interface EffectTrigger {
  kind: string;
  angle?: number;
  radius?: number;
  intensity?: number;
  size?: number;
  hue?: number;
  saturation?: number;
  brightness?: number;
  duration?: number;
  rotation?: number;
  grow?: number;
  edge?: number;
  fill?: number;
}

export class PatchRuntime implements MiniSource {
  readonly core: PatchCore;
  readonly gpu: GateGpu;
  readonly geometry: Geometry;

  private sim: PatchSim | null = null;
  private generation = 0;
  /** Frames are held (last image stays up) while new pipelines compile. */
  private pending = false;
  private raf = 0;
  private last = 0;
  private status: RuntimeStatus = { active: false, touch: false, error: null };
  private statusListeners = new Set<(s: RuntimeStatus) => void>();
  private frameListeners = new Set<(dt: number) => void>();

  private stopMic: (() => void) | null = null;
  private motion: { read: () => Motion; stop: () => void } | null = null;
  private shake = 0;
  private media: MediaTexture | null = null;

  // MiniSource
  spokes = 0;
  pixels = 0;
  cells = new Map<string, Uint8Array>();
  scalars = new Map<string, MiniScalar>();
  private miniRefs = 0;
  private miniListeners = new Set<() => void>();
  private lastPreview = 0;
  private previewNodes: string[] = [];
  private previewScalars: [string, string][] = [];

  private constructor(core: PatchCore, gpu: GateGpu) {
    this.core = core;
    this.gpu = gpu;
    this.geometry = gpu.geometry;
    gpu.device.lost.then((info) => {
      this.stop();
      this.setStatus({ active: false, touch: false, error: `The GPU was lost: ${info.message || info.reason}` });
    });
  }

  /** Load the patch core and a WebGPU device. Rejects with
   * [`WebGpuUnavailable`] where WebGPU is missing. */
  static async create(geometry: Geometry = GATE_GEOMETRY): Promise<PatchRuntime> {
    const [core, device] = await Promise.all([loadPatchCore(), requestGateDevice()]);
    return new PatchRuntime(core, new GateGpu(device, core.limits, geometry));
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  onStatus(listener: (s: RuntimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Run `listener(dt)` every frame, just before the patch is evaluated:
   * the place to feed inputs that change continuously (a synthetic beat). */
  onFrame(listener: (dt: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  private setStatus(s: RuntimeStatus) {
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  /** Run `doc`, or apply edits to the running patch. Knob-only edits never
   * reset phases. A document that cannot run leaves the previous one
   * rendering and reports why in the status. */
  async setPatch(doc: PatchDoc | null): Promise<void> {
    const gen = ++this.generation;
    if (!doc) {
      this.sim?.free();
      this.sim = null;
      this.clearMinis();
      this.setStatus({ active: false, touch: false, error: null });
      return;
    }
    let shader = false;
    try {
      if (this.sim) {
        shader = this.sim.update(JSON.stringify(doc)) === "shader";
      } else {
        const g = this.geometry;
        this.sim = this.core.createSim(doc, g.spokes, g.pixels, g.innerOverOuter);
        shader = true;
      }
    } catch (e) {
      this.setStatus({ ...this.status, active: this.sim !== null, error: errorText(e) });
      return;
    }
    const sim = this.sim!;
    if (shader) {
      this.pending = true;
      try {
        await this.gpu.setProgram(sim.wgsl(), sim.previewWgsl(), sim.previewNodes().length);
      } catch (e) {
        if (gen !== this.generation) return;
        const detail = e instanceof ShaderError ? `${e.message}: ${e.details.join("; ")}` : errorText(e);
        this.setStatus({ active: false, touch: false, error: detail });
        return;
      }
      if (gen !== this.generation) return;
      this.pending = false;
    }
    this.previewNodes = sim.previewNodes();
    this.previewScalars = JSON.parse(sim.previewScalars()) as [string, string][];
    if (shader) this.clearMinis();
    this.setStatus({ active: true, touch: sim.usesTouch(), error: null });
  }

  /** Show the array in `canvas` (sized by CSS; the backing store follows). */
  attach(canvas: HTMLCanvasElement) {
    this.gpu.attach(canvas);
  }

  detach(canvas: HTMLCanvasElement) {
    this.gpu.detach(canvas);
  }

  /** Start the frame loop. */
  start() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame(now: number) {
    const dt = Math.min(0.5, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const sim = this.sim;
    if (!sim || this.pending) return;

    if (this.motion) {
      const m = this.motion.read();
      this.shake = Math.min(3, this.shake + m.shake);
      sim.setMotion(m.yaw, m.pitch, m.roll, this.shake);
    } else if (this.shake > 0) {
      sim.setMotion(0, 0, 0, this.shake);
    }
    this.shake *= Math.exp(-dt / SHAKE_TAU);

    if (this.media) {
      const rgba = this.media.frame();
      if (rgba) {
        this.gpu.writeVideo(this.media.size, this.media.size, rgba);
        sim.setVideo(this.media.size, this.media.size);
      }
    }

    this.frameListeners.forEach((l) => l(dt));
    sim.step(dt);
    this.gpu.write({
      globals: sim.globals(),
      previewGlobals: sim.previewGlobals(),
      audio: sim.audio(),
      effects: sim.effects(),
      dabs: sim.dabs(),
      touches: sim.touches(),
      slab: sim.slab(),
    });
    if (this.stopMic) this.gpu.writeScope(sim.scope());
    this.gpu.render();

    if (this.miniRefs > 0 && now - this.lastPreview >= PREVIEW_INTERVAL_MS) {
      this.lastPreview = now;
      this.refreshMinis(sim);
    }
  }

  // --- inputs ---------------------------------------------------------------

  /** Fire an effect, as a tap on the gate's preview would. */
  trigger(effect: EffectTrigger) {
    this.sim?.triggerEffect(JSON.stringify(effect));
  }

  /** One raw pointer event for patches that own touch: `id` tells fingers
   * apart, `angle`/`radius` from `screenToPolar`. */
  touch(
    id: number,
    phase: "down" | "move" | "up",
    point: { angle: number; radius: number },
    color: { hue: number; saturation?: number; brightness?: number },
  ) {
    this.sim?.touch(
      0,
      id,
      phase,
      point.angle,
      point.radius,
      color.hue,
      color.saturation ?? 0.85,
      color.brightness ?? 1,
    );
  }

  /** Draw a stroke: `points` are `{angle, radius, dir}` in physical space. */
  draw(
    pen: string,
    points: { angle: number; radius: number; dir?: number }[],
    color: { hue: number; saturation?: number; brightness?: number },
    size = 0.5,
    intensity = 1,
  ) {
    const flat = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      flat[i * 3] = p.angle;
      flat[i * 3 + 1] = p.radius;
      flat[i * 3 + 2] = p.dir ?? 0;
    });
    this.sim?.draw(
      pen,
      flat,
      color.hue,
      color.saturation ?? 1,
      color.brightness ?? 1,
      size,
      intensity,
    );
  }

  /** Master brightness 0..1 and speed. */
  setMaster(brightness: number, speed: number) {
    this.sim?.setMaster(brightness, speed);
  }

  /** PRO DJ LINK stand-in: the 18 scalars in `setDjLink` order. */
  setDjLink(values: Float32Array) {
    this.sim?.setDjLink(values);
  }

  fireDjEvent(index: number) {
    this.sim?.fireDjEvent(index);
  }

  /** Audio features without a microphone (e.g. a synthetic groove). */
  setAudio(source: number, features: Float32Array) {
    this.sim?.setAudio(source, features);
  }

  get micActive(): boolean {
    return this.stopMic !== null;
  }

  /** Feed the microphone into audio source 0. */
  async startMic() {
    if (this.stopMic) return;
    this.stopMic = await startMicrophone((samples, rate) => this.sim?.feedAudio(0, rate, samples));
  }

  stopMicrophone() {
    this.stopMic?.();
    this.stopMic = null;
    this.sim?.stopAudio(0);
    this.gpu.writeScope(new Float32Array(this.core.limits.scopeFloats * this.core.limits.audioSources));
  }

  get motionActive(): boolean {
    return this.motion !== null;
  }

  async startMotion() {
    if (this.motion) return;
    this.motion = await startMotion();
  }

  stopMotion() {
    this.motion?.stop();
    this.motion = null;
    this.sim?.setMotion(0, 0, 0, 0);
  }

  /** Use a local video or image file as the VIDEO texture; null to clear. */
  async setMedia(file: File | null) {
    this.media?.dispose();
    this.media = null;
    if (!file) {
      this.sim?.setVideo(0, 0);
      return;
    }
    this.media = await MediaTexture.fromFile(file);
  }

  // --- MiniSource -------------------------------------------------------------

  retain() {
    this.miniRefs += 1;
  }

  release() {
    this.miniRefs = Math.max(0, this.miniRefs - 1);
  }

  onChange(listener: () => void): () => void {
    this.miniListeners.add(listener);
    return () => this.miniListeners.delete(listener);
  }

  private clearMinis() {
    this.cells.clear();
    this.scalars.clear();
    this.miniListeners.forEach((l) => l());
  }

  private refreshMinis(sim: PatchSim) {
    const values = sim.scalarValues();
    this.previewScalars.forEach(([node, port], i) =>
      pushScalar(this.scalars, `scalar:${node}:${port}`, values[i] ?? 0),
    );
    const nodes = this.previewNodes;
    const gen = this.generation;
    void this.gpu.readPreview().then((res) => {
      if (res && gen === this.generation) {
        this.spokes = res.spokes;
        this.pixels = res.pixels;
        this.cells.clear();
        res.cells.forEach((rgb, i) => {
          const id = nodes[i];
          if (id) this.cells.set(`node:${id}`, rgb);
        });
      }
      this.miniListeners.forEach((l) => l());
    });
  }

  dispose() {
    this.stop();
    this.stopMicrophone();
    this.stopMotion();
    this.media?.dispose();
    this.sim?.free();
    this.sim = null;
    this.gpu.destroy();
    this.gpu.device.destroy();
  }
}

function errorText(e: unknown): string {
  if (e instanceof WebGpuUnavailable) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
