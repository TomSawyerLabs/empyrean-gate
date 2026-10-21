// Past frames, for stepping back (plans/frame-step.md): a ring of the LED
// frame, the preview cells and the every-LED Debug cells as the GPU rendered
// them, copied GPU to GPU
// every frame (nothing is read back until one is shown), and on the CPU the
// meter values, frame number and patch time of each. A recording, not a
// simulation: showing a past frame never changes the patch's state.

/** Slots per GPU buffer, so a long history stays under `maxBufferSize`
 * (256 MB by default): 256 frames of the full gate is about 25 MB. */
const CHUNK_SLOTS = 256;

/** What one recorded frame says besides its pictures. */
export interface FrameMeta {
  frame: number;
  time: number;
  /** Meter values in `keys` order (`PatchSim.scalarValues`). */
  values: Float32Array;
  /** The meters' keys when it was recorded (`scalar:<node>:<port>`). */
  keys: readonly string[];
  /** The preview cells' node ids when it was recorded. */
  cells: readonly string[];
}

export class FrameHistory {
  /** Frames it can hold. */
  readonly capacity: number;
  private readonly frameBytes: number;
  private readonly previewBytes: number;
  /** Bytes of the every-LED Debug cells kept per frame (0: none). */
  readonly fullBytes: number;
  private frames: GPUBuffer[] = [];
  private previews: GPUBuffer[] = [];
  private fulls: GPUBuffer[] = [];
  private meta: (FrameMeta | null)[];
  /** The slot holding the newest frame (-1: none yet). */
  private head = -1;
  private filled = 0;

  /**
   * `frameBytes`: the LED frame (the first half of OUT); `previewBytes`: the
   * largest preview there can be (0: frames only); `fullBytes`: the patch's
   * every-LED Debug cells (0: none). Throws when the GPU refuses the memory.
   */
  static async create(
    device: GPUDevice,
    capacity: number,
    frameBytes: number,
    previewBytes: number,
    fullBytes = 0,
  ): Promise<FrameHistory> {
    device.pushErrorScope("out-of-memory");
    const h = new FrameHistory(device, capacity, frameBytes, previewBytes, fullBytes);
    const error = await device.popErrorScope();
    if (error) {
      h.destroy();
      throw new Error(`the GPU could not hold ${capacity} frames: ${error.message}`);
    }
    return h;
  }

  private constructor(
    device: GPUDevice,
    capacity: number,
    frameBytes: number,
    previewBytes: number,
    fullBytes: number,
  ) {
    this.capacity = Math.max(3, capacity);
    this.frameBytes = frameBytes;
    this.previewBytes = previewBytes;
    this.fullBytes = previewBytes > 0 ? fullBytes : 0;
    this.meta = new Array<FrameMeta | null>(this.capacity).fill(null);
    const usage = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    for (let first = 0; first < this.capacity; first += CHUNK_SLOTS) {
      const slots = Math.min(CHUNK_SLOTS, this.capacity - first);
      this.frames.push(device.createBuffer({ label: "past frames", size: slots * frameBytes, usage }));
      if (previewBytes > 0) {
        this.previews.push(device.createBuffer({ label: "past previews", size: slots * previewBytes, usage }));
      }
      if (this.fullBytes > 0) {
        this.fulls.push(device.createBuffer({ label: "past debug taps", size: slots * this.fullBytes, usage }));
      }
    }
  }

  /** Frames recorded and still held. */
  get count(): number {
    return this.filled;
  }

  /** It keeps preview cells, not only frames. */
  get previewed(): boolean {
    return this.previewBytes > 0;
  }

  /** Record the frame just rendered into `out` (and the preview cells into
   * `preview` and the every-LED ones into `full`, when it keeps them): a new
   * newest frame, or, with `replace`, a new version of the newest one (a
   * paused frame rendered again). */
  record(
    enc: GPUCommandEncoder,
    out: GPUBuffer,
    preview: GPUBuffer | null,
    meta: FrameMeta,
    replace = false,
    full: GPUBuffer | null = null,
  ) {
    if (!replace || this.head < 0) {
      this.head = (this.head + 1) % this.capacity;
      this.filled = Math.min(this.filled + 1, this.capacity);
    }
    const slot = this.head;
    const [chunk, at] = this.locate(slot);
    enc.copyBufferToBuffer(out, 0, this.frames[chunk]!, at * this.frameBytes, this.frameBytes);
    if (this.previewBytes > 0 && preview) {
      const bytes = Math.min(this.previewBytes, preview.size);
      enc.copyBufferToBuffer(preview, 0, this.previews[chunk]!, at * this.previewBytes, bytes);
    }
    if (this.fullBytes > 0 && full) {
      const bytes = Math.min(this.fullBytes, full.size);
      enc.copyBufferToBuffer(full, 0, this.fulls[chunk]!, at * this.fullBytes, bytes);
    }
    this.meta[slot] = meta;
  }

  /** What was recorded `back` frames before the newest (0: the newest). */
  at(back: number): FrameMeta | null {
    if (back < 0 || back >= this.filled) return null;
    return this.meta[this.slotAt(back)] ?? null;
  }

  /** Copy the frame `back` frames before the newest into `out` at `offset`
   * (and its preview cells into `preview`, its every-LED cells into `full`). */
  restore(
    enc: GPUCommandEncoder,
    back: number,
    out: GPUBuffer,
    preview: GPUBuffer | null,
    offset = 0,
    full: GPUBuffer | null = null,
  ) {
    if (back < 0 || back >= this.filled) return;
    const [chunk, at] = this.locate(this.slotAt(back));
    enc.copyBufferToBuffer(this.frames[chunk]!, at * this.frameBytes, out, offset, this.frameBytes);
    if (this.previewBytes > 0 && preview) {
      const bytes = Math.min(this.previewBytes, preview.size);
      enc.copyBufferToBuffer(this.previews[chunk]!, at * this.previewBytes, preview, 0, bytes);
    }
    if (this.fullBytes > 0 && full) {
      const bytes = Math.min(this.fullBytes, full.size);
      enc.copyBufferToBuffer(this.fulls[chunk]!, at * this.fullBytes, full, 0, bytes);
    }
  }

  /** The meter series for a past frame: per key, the values of the `length`
   * frames up to and including it that were recorded with the same meters,
   * oldest first. */
  series(back: number, length: number): Map<string, number[]> {
    const out = new Map<string, number[]>();
    const shown = this.at(back);
    if (!shown) return out;
    shown.keys.forEach((key) => out.set(key, []));
    for (let b = Math.min(this.filled - 1, back + length - 1); b >= back; b--) {
      const m = this.at(b);
      if (!m || m.keys !== shown.keys) continue;
      m.keys.forEach((key, i) => out.get(key)!.push(m.values[i] ?? 0));
    }
    return out;
  }

  /** Forget everything recorded (the patch's previews changed shape). */
  clear() {
    this.head = -1;
    this.filled = 0;
    this.meta.fill(null);
  }

  destroy() {
    for (const b of [...this.frames, ...this.previews, ...this.fulls]) b.destroy();
    this.frames = [];
    this.previews = [];
    this.fulls = [];
    this.clear();
  }

  private slotAt(back: number): number {
    return (this.head - back + this.capacity) % this.capacity;
  }

  private locate(slot: number): [chunk: number, at: number] {
    return [Math.floor(slot / CHUNK_SLOTS), slot % CHUNK_SLOTS];
  }
}
