// A patch running in the browser: the wasm patch core evaluates it, WebGPU
// renders it, and any number of canvases show it. Also a MiniSource, so the
// editor's node thumbnails and meters work exactly as they do against a gate.

import { pushScalar, type MiniScalar, type MiniSource } from "../editor/minis-source";
import type { PatchDoc } from "../types";
import { loadPatchCore, type PatchCore, type PatchSim } from "./core";
import { GateGpu, requestGateDevice, ShaderError, WebGpuUnavailable, type Geometry } from "./gpu";
import {
  MediaTexture,
  startMicrophone,
  startMotion,
  type Motion,
  type MotionSource,
} from "./inputs";
import { synthScope, TestFilm, type VideoSource } from "./standins";

export { loadPatchCore, type Limits, type PatchCore } from "./core";
export { requestGateDevice, screenToPolar, ShaderError, WebGpuUnavailable, type Geometry } from "./gpu";
export {
  CRATE,
  DJ_EVENTS,
  DJ_SCALARS,
  DjLinkSim,
  PHRASE_CODES,
  phraseAt,
  PLAY_MODES,
  SET_BPM,
  trackLayout,
  trackSound,
  type DeckAction,
  type DeckMode,
  type DjDeckState,
  type DjEvent,
  type DjLinkSimOptions,
  type DjLinkState,
  type DjScalar,
  type PhraseKind,
  type PlacedPhrase,
  type SimMove,
  type SimPhrase,
  type SimTrack,
  type TrackLayout,
  type TrackSound,
} from "./djlink";
export {
  attachGroove,
  GROOVE_BPM,
  grooveAt,
  grooveAudio,
  type GrooveFeatures,
  type GrooveSettings,
} from "./groove";
export {
  contactSheet,
  encodePng,
  frameStats,
  renderRing,
  toBase64,
  type FrameStats,
  type Picture,
  type RingOptions,
} from "./ring";
export { MediaTexture, VIDEO_SIZE, type Motion, type MotionSource } from "./inputs";
export {
  attachVisitors,
  seeded,
  synthScope,
  syntheticMotion,
  TestFilm,
  type VideoSource,
  type VisitorHost,
  type VisitorSettings,
} from "./standins";

/** The gate as built (`src-tauri/src/config.rs` defaults). */
export const GATE_GEOMETRY: Geometry = { spokes: 64, pixels: 378, innerOverOuter: 8 / 25 };

/** How often the node thumbnails refresh, as on the gate (`minis.rs`). */
const PREVIEW_INTERVAL_MS = 100;
/** Shake decay, as the engine applies to phone shakes. */
const SHAKE_TAU = 0.3;
/** Simulated frame rate when stepping without the display (a capture). */
const STEP_HZ = 60;
/** Most frames one capture returns. */
export const MAX_CAPTURE_FRAMES = 16;

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

export interface RuntimeOptions {
  /** The WebGPU entry point where there is no `navigator.gpu` (Node or Bun
   * with the `webgpu` package). */
  gpu?: GPU;
  /** The patch core's wasm bytes, where it cannot be fetched (see
   * `loadPatchCore`). */
  wasm?: BufferSource;
  /** Decode a Still image's or Clip's data URL into `size`² RGBA, where
   * there is no DOM to do it (Node). */
  decodeImage?: (dataUrl: string, size: number) => Promise<Uint8Array>;
}

export interface CaptureOptions {
  /** How many frames (default 1, at most `MAX_CAPTURE_FRAMES`). */
  frames?: number;
  /** Seconds of patch time between frames (default 0.5). */
  interval?: number;
  /** Seconds of patch time to run before the first frame (default 0, or 1
   * after a restart, so a fresh patch has had a moment to get going). */
  warmup?: number;
  /** Start the patch afresh first (phases, effects, counters), so the same
   * patch and options give the same frames. */
  restart?: boolean;
}

/** One captured frame: `t` seconds of patch time after the capture began,
 * `rgb` as `GateGpu.readFrame` gives it. */
export interface CapturedFrame {
  t: number;
  rgb: Uint8Array;
}

export class PatchRuntime implements MiniSource {
  readonly core: PatchCore;
  readonly gpu: GateGpu;
  readonly geometry: Geometry;

  private sim: PatchSim | null = null;
  /** The document last given to `setPatch`, for `restart`. */
  private doc: PatchDoc | null = null;
  private generation = 0;
  /** The generation whose shader is being installed, while one is. */
  private pendingGen = 0;
  /** Frames are held (last image stays up) while new pipelines compile. */
  private pending = false;
  private raf = 0;
  private last = 0;
  private status: RuntimeStatus = { active: false, touch: false, error: null };
  private statusListeners = new Set<(s: RuntimeStatus) => void>();
  private frameListeners = new Set<(dt: number) => void>();
  private restartListeners = new Set<() => void>();

  private stopMic: (() => void) | null = null;
  private motion: { read: () => Motion; stop: () => void } | null = null;
  private shake = 0;
  /** Video in's picture: a file or camera when a host sets one, otherwise
   * the stand-in film. Frames are uploaded only while the patch reads them. */
  private video: VideoSource = new TestFilm();
  private usesVideo = false;
  /** Audio source 0's features as last set, and the clock for the scope
   * made from them while no microphone gives a real one. */
  private audioFeatures: Float32Array | null = null;
  private scopeT = 0;

  // MiniSource
  spokes = 0;
  pixels = 0;
  cells = new Map<string, Uint8Array>();
  scalars = new Map<string, MiniScalar>();
  private miniRefs = 0;
  private miniListeners = new Set<() => void>();
  private lastPreview = 0;
  private previewNodes: string[] = [];
  /** The picture currently uploaded to each media cell (by data URL). */
  private uploadedImages = new Map<number, string>();
  private previewScalars: [string, string][] = [];

  private readonly decode: (dataUrl: string, size: number) => Promise<Uint8Array>;

  private constructor(
    core: PatchCore,
    gpu: GateGpu,
    decode: (dataUrl: string, size: number) => Promise<Uint8Array> = decodeImage,
  ) {
    this.core = core;
    this.gpu = gpu;
    this.decode = decode;
    this.geometry = gpu.geometry;
    gpu.device.lost.then((info) => {
      this.stop();
      this.setStatus({ active: false, touch: false, error: `The GPU was lost: ${info.message || info.reason}` });
    });
  }

  /** Load the patch core and a WebGPU device. Rejects with
   * [`WebGpuUnavailable`] where WebGPU is missing. */
  static async create(geometry: Geometry = GATE_GEOMETRY, options: RuntimeOptions = {}): Promise<PatchRuntime> {
    const [core, device] = await Promise.all([loadPatchCore(options.wasm), requestGateDevice(options.gpu)]);
    return new PatchRuntime(core, new GateGpu(device, core.limits, geometry), options.decodeImage);
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

  /** Run `listener` whenever `restart` starts the patch afresh: the place to
   * reset a host's own clocks (a synthetic beat), so a capture repeats. */
  onRestart(listener: () => void): () => void {
    this.restartListeners.add(listener);
    return () => this.restartListeners.delete(listener);
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
    this.doc = doc;
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
        // A fresh sim has no cells marked loaded: upload its images anew.
        this.uploadedImages.clear();
        shader = true;
      }
    } catch (e) {
      this.setStatus({ ...this.status, active: this.sim !== null, error: errorText(e) });
      return;
    }
    const sim = this.sim!;
    if (shader) {
      this.pending = true;
      this.pendingGen = gen;
      try {
        await this.gpu.setProgram(sim.wgsl(), sim.previewWgsl(), sim.previewNodes().length);
      } catch (e) {
        if (this.pendingGen === gen) this.pending = false;
        if (gen !== this.generation) return;
        // Locations inside a Code node's body are reported against the
        // user's own lines.
        const detail =
          e instanceof ShaderError
            ? sim.relocateError(`${e.message}: ${e.details.join("; ")}`)
            : errorText(e);
        this.setStatus({ active: false, touch: false, error: detail });
        return;
      }
      // An edit may have arrived meanwhile that needed no shader of its own
      // (a CPU-only node, a knob): it runs on the program just installed, so
      // the frame loop resumes here even though the rest of this call is
      // superseded. Only a newer shader install keeps the loop paused.
      if (this.pendingGen === gen) this.pending = false;
      if (gen !== this.generation) return;
    }
    this.syncImages(sim);
    this.previewNodes = sim.previewNodes();
    this.previewScalars = JSON.parse(sim.previewScalars()) as [string, string][];
    if (shader) this.clearMinis();
    this.usesVideo = sim.usesVideo();
    this.setStatus({ active: true, touch: sim.usesTouch(), error: null });
  }

  /** Upload each Still image node's picture to its media cell (only what
   * changed) and tell the sim which cells hold one. */
  private syncImages(sim: PatchSim) {
    const wanted = JSON.parse(sim.images()) as { slot: number; media: string | null }[];
    const size = this.core.limits.imageSize;
    for (let slot = 1; slot <= this.core.limits.maxImages; slot++) {
      const media = wanted.find((w) => w.slot === slot)?.media ?? null;
      if ((this.uploadedImages.get(slot) ?? null) === media) continue;
      if (!media) {
        this.uploadedImages.delete(slot);
        sim.setImageLoaded(slot, false);
        continue;
      }
      this.uploadedImages.set(slot, media);
      void this.decode(media, size)
        .then((rgba) => {
          // Still the picture this cell should hold?
          if (this.uploadedImages.get(slot) !== media || this.sim !== sim) return;
          this.gpu.writeImage(slot, rgba);
          sim.setImageLoaded(slot, true);
        })
        .catch(() => {
          if (this.uploadedImages.get(slot) === media) sim.setImageLoaded(slot, false);
        });
    }
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
    // Guarded: a host with no display (Node) has no animation frames.
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** The frame loop is running (`start`ed and not `stop`ped). */
  get running(): boolean {
    return this.raf !== 0;
  }

  private frame(now: number) {
    const dt = Math.min(0.5, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.advance(dt, now);
  }

  /** Run exactly one frame of `dt` seconds, whether or not the loop is
   * running: evaluate, render, draw the views. For stepping by hand (tests,
   * captures); with the loop running, its own frames come in between. */
  step(dt: number) {
    this.advance(Math.max(0, dt), performance.now());
  }

  /** Start the running patch afresh, as if it had just been opened: phases,
   * effects, strokes and counters all reset. */
  async restart(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    this.sim?.free();
    this.sim = null;
    this.shake = 0;
    this.video.reset?.();
    this.restartListeners.forEach((l) => l());
    await this.setPatch(doc);
  }

  /** The LED colors of the frame last rendered (see `GateGpu.readFrame`). */
  async readFrame(): Promise<Uint8Array> {
    for (;;) {
      const rgb = await this.gpu.readFrame();
      if (rgb) return rgb;
      await new Promise((r) => setTimeout(r, 4));
    }
  }

  /**
   * Frames of the running patch for someone who cannot watch it (an agent):
   * the loop pauses, the patch is stepped through patch time at a steady
   * 60 Hz (so it does not depend on how fast this machine is), each frame is
   * read back, and the loop resumes where it was. Rejects when no patch is
   * running, with the reason when it is one that cannot run.
   */
  async capture(options: CaptureOptions = {}): Promise<CapturedFrame[]> {
    const frames = Math.max(1, Math.min(MAX_CAPTURE_FRAMES, Math.round(options.frames ?? 1)));
    const interval = Math.max(0, options.interval ?? 0.5);
    const warmup = Math.max(0, options.warmup ?? (options.restart ? 1 : 0));
    const wasRunning = this.running;
    this.stop();
    try {
      if (options.restart) await this.restart();
      // A shader still installing holds frames; wait for it (bounded).
      for (let waited = 0; this.pending && waited < 15000; waited += 16) {
        await new Promise((r) => setTimeout(r, 16));
      }
      if (!this.sim || this.pending || !this.status.active) {
        throw new Error(this.status.error ?? "No patch is running.");
      }
      const out: CapturedFrame[] = [];
      let t = 0;
      const run = (seconds: number) => {
        const n = Math.ceil(seconds * STEP_HZ);
        for (let i = 0; i < n; i++) this.step(seconds / n);
        t += seconds;
      };
      // Something to read even with no warmup: the frame as it stands.
      run(warmup > 0 ? warmup : 1 / STEP_HZ);
      for (let f = 0; f < frames; f++) {
        if (f > 0) run(interval);
        out.push({ t: Math.round(t * 1000) / 1000, rgb: await this.readFrame() });
      }
      return out;
    } finally {
      if (wasRunning) this.start();
    }
  }

  private advance(dt: number, now: number) {
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

    if (this.usesVideo) {
      const rgba = this.video.frame(dt);
      if (rgba) {
        this.gpu.writeVideo(this.video.size, this.video.size, rgba);
        sim.setVideo(this.video.size, this.video.size);
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
    else if (this.audioFeatures) {
      const { scopeWave, scopeSpectrum, scopeFloats, audioSources } = this.core.limits;
      this.scopeT += dt;
      const scope = new Float32Array(scopeFloats * audioSources);
      scope.set(synthScope(this.audioFeatures, this.scopeT, scopeWave, scopeSpectrum));
      this.gpu.writeScope(scope);
    }
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

  /** The master hue pull, as the crew sets it on the gate: every colour is
   * pulled toward `target` (turns) by `amount` (0 = off, 1 = all the way);
   * `loose` 0..1 lets far-off hues keep their identity as flourishes. */
  setHuePull(target: number, amount: number, loose = 0) {
    this.sim?.setHuePull(target, amount, loose);
  }

  /** PRO DJ LINK: the 18 scalars in `DJ_SCALARS` order (`DjLinkSim` makes
   * them for a simulated set). */
  setDjLink(values: Float32Array) {
    this.sim?.setDjLink(values);
  }

  fireDjEvent(index: number) {
    this.sim?.fireDjEvent(index);
  }

  /** Audio features without a microphone (e.g. a synthetic groove). */
  setAudio(source: number, features: Float32Array) {
    if (source === 0) this.audioFeatures = features;
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

  /** Feed motion from somewhere other than the device's sensors: a host's
   * stand-in on a desktop, so a Phone IMU node can be tried without a phone.
   * Replaces whatever source was running; `stopMotion` ends it. */
  setMotionSource(source: MotionSource) {
    this.motion?.stop();
    this.motion = source;
  }

  /** Use a local video or image file as the VIDEO texture; null goes back
   * to the stand-in film. */
  async setMedia(file: File | null) {
    this.setVideoSource(file ? await MediaTexture.fromFile(file) : null);
  }

  /** Where Video in's picture comes from (a file, a camera); null goes back
   * to the stand-in film. The previous source is disposed. */
  setVideoSource(source: VideoSource | null) {
    this.video.dispose();
    this.video = source ?? new TestFilm();
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
    this.video.dispose();
    this.sim?.free();
    this.sim = null;
    this.gpu.destroy();
    this.gpu.device.destroy();
  }
}

/** A data URL picture as `size`² RGBA (center-cropped square, like the gate). */
async function decodeImage(dataUrl: string, size: number): Promise<Uint8Array> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const data = ctx.getImageData(0, 0, size, size).data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function errorText(e: unknown): string {
  if (e instanceof WebGpuUnavailable) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
