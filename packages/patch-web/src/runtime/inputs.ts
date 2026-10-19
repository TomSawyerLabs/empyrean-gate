// Browser stand-ins for the gate's hardware inputs. Each starts on a user
// gesture and returns a stop function. They only gather raw data; the analysis
// that the patch actually sees (beat tracking, bands, scope) happens in the
// wasm patch core, exactly as on the gate.

/** Raw mono samples from the microphone, in blocks of 128 frames. */
export async function startMicrophone(
  onSamples: (samples: Float32Array, sampleRate: number) => void,
): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot capture the microphone.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  // A worklet that forwards channel 0, so analysis sees every sample (an
  // AnalyserNode would hand us snapshots, not a continuous stream).
  const source = `
    registerProcessor("gate-tap", class extends AudioWorkletProcessor {
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) this.port.postMessage(ch.slice(0));
        return true;
      }
    });`;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const mic = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "gate-tap", { numberOfOutputs: 0 });
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data, ctx.sampleRate);
  mic.connect(tap);
  await ctx.resume();
  return () => {
    tap.port.onmessage = null;
    mic.disconnect();
    void ctx.close();
    stream.getTracks().forEach((t) => t.stop());
  };
}

export interface Motion {
  yaw: number;
  pitch: number;
  roll: number;
  /** Spike size of the latest shake, 0 when none since the last read. */
  shake: number;
}

/** Where motion comes from: the device's sensors, or a host's stand-in. */
export interface MotionSource {
  /** The current orientation; returns and clears the shake spike. */
  read(): Motion;
  stop(): void;
}

/** Phone orientation and shakes, scaled as the gate's own phone client
 * (src/sensors.ts) sends them. `read()` returns and clears the shake spike. */
export async function startMotion(): Promise<MotionSource> {
  if (!window.isSecureContext) {
    throw new Error("Motion and orientation need a secure (https) page.");
  }
  const doe = (
    globalThis as unknown as {
      DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
    }
  ).DeviceOrientationEvent;
  if (!doe) throw new Error("Motion and orientation are not available in this browser.");
  if (typeof doe.requestPermission === "function") {
    const res = await doe.requestPermission();
    if (res !== "granted") throw new Error("Motion permission was not granted.");
  }
  const m: Motion = { yaw: 0, pitch: 0, roll: 0, shake: 0 };
  const onOrient = (e: DeviceOrientationEvent) => {
    m.yaw = ((e.alpha ?? 0) * Math.PI) / 180;
    m.pitch = Math.max(-1, Math.min(1, (e.beta ?? 0) / 90));
    m.roll = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 90));
  };
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (!a) return;
    const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    if (mag > 4) m.shake = Math.min(3, mag / 10);
  };
  window.addEventListener("deviceorientation", onOrient);
  window.addEventListener("devicemotion", onMotion);
  return {
    read() {
      const out = { ...m };
      m.shake = 0;
      return out;
    },
    stop() {
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
    },
  };
}

/** Side of the square texture the gate's VIDEO buffer holds
 * (`MAX_VIDEO_DIMENSION` in src-tauri/src/protocol.rs). */
export const VIDEO_SIZE = 256;

/** A local video or image file, or a camera, as the patch's VIDEO texture:
 * center-cropped to a square and scaled to [`VIDEO_SIZE`], as the gate's
 * Media tab sends it. */
export class MediaTexture {
  readonly size = VIDEO_SIZE;
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private url: string | null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private image: HTMLImageElement | null = null;
  private stillDone = false;

  private constructor(file: File | null) {
    this.canvas.width = this.canvas.height = VIDEO_SIZE;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    this.url = file ? URL.createObjectURL(file) : null;
  }

  /** The device's camera (asks for permission; rejects when refused). */
  static async fromCamera(): Promise<MediaTexture> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use a camera.");
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    const tex = new MediaTexture(null);
    tex.stream = stream;
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    tex.video = video;
    return tex;
  }

  static async fromFile(file: File): Promise<MediaTexture> {
    const tex = new MediaTexture(file);
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = tex.url!;
      await img.decode();
      tex.image = img;
    } else {
      const video = document.createElement("video");
      video.src = tex.url!;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      tex.video = video;
    }
    return tex;
  }

  /** The current frame as RGBA bytes, or null when unchanged (a still image
   * after its first frame) or not ready. */
  frame(): Uint8Array | null {
    const src = this.video ?? this.image;
    if (!src) return null;
    if (this.image && this.stillDone) return null;
    if (this.video && this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const sw = this.video ? this.video.videoWidth : this.image!.naturalWidth;
    const sh = this.video ? this.video.videoHeight : this.image!.naturalHeight;
    if (!sw || !sh) return null;
    const side = Math.min(sw, sh);
    this.ctx.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, VIDEO_SIZE, VIDEO_SIZE);
    this.stillDone = this.image !== null;
    const data = this.ctx.getImageData(0, 0, VIDEO_SIZE, VIDEO_SIZE).data;
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  dispose() {
    this.video?.pause();
    this.video = this.image = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.url) URL.revokeObjectURL(this.url);
  }
}
