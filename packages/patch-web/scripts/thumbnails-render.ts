// The palette's thumbnails, rendered: run under Node with Dawn (see
// thumbnails.ts, which bundles and launches this). For every node kind, a
// small showcase patch that puts the kind to work on the stand-ins (the
// simulated DJ set and its groove, the test film, simulated visitors, synthetic phone
// motion):
//
// - kinds that make a picture: the showcase's whole output, captured after a
//   few seconds and sampled down to 64 spokes × 24 LEDs;
// - kinds that make a number or an event: eight seconds of the output (and
//   what drives it, drawn faintly behind), from the patch core alone.
//
// Writes src/editor/thumbs.gen.ts.

import { writeFileSync } from "node:fs";
import { headlessRuntime, loadCore } from "../cli/host";
import { DjLinkSim } from "../src/runtime/djlink";
import type { PatchCore } from "../src/runtime/core";
import { encodePng, toBase64 } from "../src/runtime/ring";
import { attachVisitors, syntheticMotion, TestFilm, type VisitorHost } from "../src/runtime/standins";
import { GATE_GEOMETRY } from "../src/runtime/index";
import { ICON_ONLY, type ThumbData, type TraceThumb } from "../src/editor/thumbs";
import { isFieldShape, type PatchDoc, type PatchNode, type PatchNodeType } from "../src/types";

const out = process.argv[2];
if (!out) throw new Error("usage: thumbnails-render <out.ts>");

const SPOKES = 64;
const SAMPLES = 24;
const TRACE_SECONDS = 8;
const TRACE_POINTS = 96;
const STEP = 1 / 60;

/** One node of a showcase: `[id, kind, params?]`. */
type N = [id: string, kind: string, params?: Record<string, number>];
/** One wire: `[from, port, to, port]`. */
type W = [string, string, string, string];

interface Showcase {
  nodes: N[];
  wires: W[];
  /** Picture kinds: seconds before the capture. */
  at?: number;
  /** Picture kinds driven by events (taps, strokes, fingers): the brightest
   * of a few frames from `at` on, so the picture catches one. */
  brightest?: boolean;
  /** Trace kinds: the port of `n` to draw (an event port: ticks), and what
   * drives it, drawn faintly. */
  show?: string;
  drive?: [node: string, port: string];
}

/** Regular events for kinds that count or latch them: a looping Time. */
const clock = (rate: number): N => ["c", "time", { mode: 1, rate }];

/** Showcases that are not "the kind, into the Output". */
const SHOWCASES: Record<string, Showcase> = {
  // -- numbers and events (traces)
  time: { nodes: [["n", "time", { mode: 1, rate: 0.4 }]], wires: [], show: "out" },
  audio: { nodes: [["n", "audio"]], wires: [], show: "bass" },
  imu: { nodes: [["n", "imu"]], wires: [], show: "roll" },
  touch: { nodes: [["n", "touch"]], wires: [], show: "x" },
  dj_link: { nodes: [["n", "dj_link"]], wires: [], show: "beat_in_bar" },
  scalar_math: {
    nodes: [["n", "scalar_math", { op: 2 }], ["s", "lfo", { rate: 0.25 }], ["t", "lfo", { rate: 1.5, wave: 1 }]],
    wires: [["s", "out", "n", "a"], ["t", "out", "n", "b"]],
    show: "out",
    drive: ["s", "out"],
  },
  map_range: {
    nodes: [["n", "map_range", { in_min: 0.25, in_max: 0.75, out_min: 0, out_max: 1, clamp: 1 }], ["s", "lfo", { rate: 0.3 }]],
    wires: [["s", "out", "n", "in"]],
    show: "out",
    drive: ["s", "out"],
  },
  mix: {
    nodes: [["n", "mix", { t: 0.5 }], ["s", "lfo", { rate: 0.2 }], ["r", "random", { rate: 2 }]],
    wires: [["s", "out", "n", "a"], ["r", "out", "n", "b"]],
    show: "out",
    drive: ["r", "out"],
  },
  clamp: {
    nodes: [["n", "clamp", { min: 0.25, max: 0.7 }], ["s", "lfo", { rate: 0.35 }]],
    wires: [["s", "out", "n", "in"]],
    show: "out",
    drive: ["s", "out"],
  },
  smooth: {
    nodes: [["n", "smooth", { seconds: 0.4 }], ["s", "random", { rate: 1.2 }]],
    wires: [["s", "out", "n", "in"]],
    show: "out",
    drive: ["s", "out"],
  },
  threshold: {
    nodes: [["n", "threshold", { level: 0.5 }], ["s", "lfo", { rate: 0.4 }]],
    wires: [["s", "out", "n", "in"]],
    show: "rise",
    drive: ["s", "out"],
  },
  lfo: { nodes: [["n", "lfo", { rate: 0.4 }]], wires: [], show: "out" },
  envelope: {
    nodes: [["n", "envelope", { decay: 0.8 }], clock(0.7)],
    wires: [["c", "wrap", "n", "trigger"]],
    show: "out",
    drive: ["c", "wrap"],
  },
  sequence: {
    nodes: [["n", "sequence", { steps: 8 }], clock(1.5)],
    wires: [["c", "wrap", "n", "step"]],
    show: "out",
    drive: ["c", "wrap"],
  },
  random: { nodes: [["n", "random", { rate: 1.5 }]], wires: [], show: "out" },

  counter: {
    nodes: [["n", "counter", { steps: 6 }], clock(2)],
    wires: [["c", "wrap", "n", "count"]],
    show: "out",
    drive: ["c", "wrap"],
  },
  toggle: {
    nodes: [["n", "toggle"], clock(1)],
    wires: [["c", "wrap", "n", "toggle"]],
    show: "out",
    drive: ["c", "wrap"],
  },
  delay: {
    nodes: [["n", "delay", { seconds: 0.4, echoes: 2 }], clock(0.4)],
    wires: [["c", "wrap", "n", "in"]],
    show: "out",
    drive: ["c", "wrap"],
  },
  event_merge: {
    nodes: [["n", "event_merge"], clock(0.6), ["t", "tap"]],
    wires: [["c", "wrap", "n", "a"], ["t", "tap", "n", "b"]],
    show: "out",
    drive: ["c", "wrap"],
  },
  tap: { nodes: [["n", "tap"]], wires: [], show: "tap" },

  // -- pictures that need something feeding them
  touch_dabs: { nodes: [["n", "touch_dabs"], ["r", "render_points"]], wires: [["n", "points", "r", "points"]], at: 6, brightest: true },
  render_points: { nodes: [["s", "touch_dabs"], ["n", "render_points", { pen: 4 }]], wires: [["s", "points", "n", "points"]], at: 6, brightest: true },
  effects_in: { nodes: [["n", "effects_in"], ["r", "render_effects"]], wires: [["n", "effects", "r", "effects"]], at: 0.5, brightest: true },
  render_effects: { nodes: [["s", "effects_in"], ["n", "render_effects"]], wires: [["s", "effects", "n", "effects"]], at: 0.5, brightest: true },
  event_effect: {
    nodes: [["a", "audio"], ["n", "event_effect", { effect: 5 }], ["r", "render_effects"]],
    wires: [["a", "beat", "n", "trigger"], ["n", "effects", "r", "effects"]],
    at: 3.2,
    brightest: true,
  },
  video_in: { nodes: [["n", "video_in"], ["t", "texture_sample"]], wires: [["n", "tex", "t", "tex"]], at: 3 },
  image_in: { nodes: [["n", "image_in"], ["t", "texture_sample"]], wires: [["n", "tex", "t", "tex"]], at: 1 },
  clip: { nodes: [["n", "clip", { fps: 4 }], ["t", "texture_sample"]], wires: [["n", "tex", "t", "tex"]], at: 1.3 },
  texture_sample: { nodes: [["s", "video_in"], ["n", "texture_sample", { kaleido: 3 }]], wires: [["s", "tex", "n", "tex"]], at: 3 },
  render_texture: {
    nodes: [["s", "spiral"], ["n", "render_texture"], ["t", "texture_sample"]],
    wires: [["s", "out", "n", "in"], ["n", "tex", "t", "tex"]],
  },
  texture_blur: {
    nodes: [["s", "spiral"], ["r", "render_texture"], ["n", "texture_blur", { radius: 0.25 }], ["t", "texture_sample"]],
    wires: [["s", "out", "r", "in"], ["r", "tex", "n", "tex"], ["n", "tex", "t", "tex"]],
  },
  texture_trails: {
    nodes: [["s", "spiral"], ["r", "render_texture"], ["n", "texture_trails", { fade: 1.5, zoom: 1.4, spin: 0.1 }], ["t", "texture_sample"]],
    wires: [["s", "out", "r", "in"], ["r", "tex", "n", "tex"], ["n", "tex", "t", "tex"]],
    at: 4,
  },
  transform: { nodes: [["s", "wedges"], ["n", "transform", { kaleido: 3, zoom: 1.4, rotate: 0.08 }]], wires: [["s", "out", "n", "in"]] },
  // LED data made smooth, then folded by a kaleidoscope: Transform reads it
  // between the LEDs, which only Resample allows.
  resample: {
    nodes: [["s", "random_field", { rate: 0 }], ["c", "colorize", { hue_range: 0.6 }], ["n", "resample", { mode: 1 }], ["t", "transform", { kaleido: 4, rotate: 0.06 }]],
    wires: [["s", "out", "c", "in"], ["c", "out", "n", "in"], ["n", "out", "t", "in"]],
  },
  colorize: { nodes: [["s", "perlin_noise"], ["n", "colorize"]], wires: [["s", "out", "n", "in"]] },
  palette: { nodes: [["s", "perlin_noise"], ["n", "palette", { palette: 6, cycles: 1.5 }]], wires: [["s", "out", "n", "in"]] },
  color_adjust: { nodes: [["s", "rainbow"], ["n", "color_adjust", { hue: 0.35, saturation: 1.6, contrast: 1.4 }]], wires: [["s", "out", "n", "in"]] },
  luminance: { nodes: [["s", "plasma"], ["n", "luminance"]], wires: [["s", "out", "n", "in"]] },
  field_math: {
    nodes: [["a", "coordinate"], ["b", "perlin_noise"], ["n", "field_math", { op: 2, gain: 1.6 }]],
    wires: [["a", "out", "n", "a"], ["b", "out", "n", "b"]],
  },
  blend: { nodes: [["a", "plasma"], ["b", "spiral"], ["n", "blend"]], wires: [["a", "out", "n", "base"], ["b", "out", "n", "over"]] },
  feedback: {
    nodes: [["n", "feedback", { decay: 0.9 }], ["t", "transform", { zoom: 0.9, spin: 0.25 }], ["m", "meteors"], ["b", "blend", { mode: 4 }]],
    wires: [["n", "out", "t", "in"], ["t", "out", "b", "base"], ["m", "out", "b", "over"]],
    at: 4,
  },
  touch_mask: { nodes: [["n", "touch_mask"]], wires: [], at: 4.2, brightest: true },
  touch_glow: { nodes: [["n", "touch_glow"]], wires: [], at: 4.2, brightest: true },
};


function doc(core: PatchCore, id: string, s: Showcase, last: string): PatchDoc {
  const nodes: PatchNode[] = s.nodes.map(([nid, kind, params]) => ({ id: nid, kind, name: "", params: params ?? {}, pos: [0, 0] }));
  const edges = s.wires.map(([a, ap, b, bp]) => ({ from: { node: a, port: ap }, to: { node: b, port: bp } }));
  nodes.push({ id: "o", kind: "output", name: "", params: {}, pos: [0, 0] });
  if (s.show === undefined) {
    const lastType = core.registry.find((t) => t.id === nodes.find((n) => n.id === last)!.kind)!;
    edges.push({ from: { node: last, port: lastType.outputs[0]!.name }, to: { node: "o", port: "in" } });
  }
  return { format: core.limits.patchFormat, id, name: id, description: "", nodes, edges, exposed: [] };
}

/** The showcase of `t`: its own, or the kind alone into the Output. */
function showcase(t: PatchNodeType): Showcase | null {
  if (SHOWCASES[t.id]) return SHOWCASES[t.id]!;
  const out = t.outputs[0]?.shape;
  if (!t.inputs.length && out !== undefined && isFieldShape(out)) return { nodes: [["n", t.id]], wires: [] };
  return null;
}

/** The node whose output the showcase shows: the last one listed. */
const lastNode = (s: Showcase) => s.nodes[s.nodes.length - 1]![0];

/** The stand-in film as a picture, for Still image in and Clip. */
async function filmPicture(core: PatchCore, grid: number, cell: number): Promise<string> {
  const film = new TestFilm(cell);
  const size = grid * cell;
  const rgba = new Uint8Array(size * size * 4);
  for (let f = 0; f < grid * grid; f++) {
    const frame = film.frame(f === 0 ? 2 : 0.25);
    const ox = (f % grid) * cell;
    const oy = Math.floor(f / grid) * cell;
    for (let y = 0; y < cell; y++) rgba.set(frame.subarray(y * cell * 4, (y + 1) * cell * 4), ((oy + y) * size + ox) * 4);
  }
  const png = await encodePng({ width: size, height: size, rgba });
  if (png.length > core.limits.maxMediaBytes) throw new Error("stand-in picture too large");
  return `data:image/png;base64,${toBase64(png)}`;
}

/** `rgb` (every LED) sampled down to SPOKES × SAMPLES, averaging along each
 * spoke. */
function sampleRing(rgb: Uint8Array): Uint8Array {
  const { spokes, pixels } = GATE_GEOMETRY;
  const outRgb = new Uint8Array(SPOKES * SAMPLES * 3);
  for (let s = 0; s < SPOKES; s++) {
    const spoke = Math.floor((s * spokes) / SPOKES);
    for (let k = 0; k < SAMPLES; k++) {
      const i0 = Math.floor((k * pixels) / SAMPLES);
      const i1 = Math.floor(((k + 1) * pixels) / SAMPLES);
      const sum = [0, 0, 0];
      for (let i = i0; i < i1; i++) for (let c = 0; c < 3; c++) sum[c]! += rgb[(spoke * pixels + i) * 3 + c]!;
      for (let c = 0; c < 3; c++) outRgb[(s * SAMPLES + k) * 3 + c] = Math.round(sum[c]! / (i1 - i0));
    }
  }
  return outRgb;
}

/** Eight seconds of a showcase on the patch core alone: the shown port and
 * what drives it. */
function trace(core: PatchCore, d: PatchDoc, s: Showcase): TraceThumb {
  const g = GATE_GEOMETRY;
  const sim = core.createSim(d, g.spokes, g.pixels, g.innerOverOuter);
  const keys = JSON.parse(sim.previewScalars()) as [string, string][];
  const index = (node: string, port: string) => keys.findIndex(([n, p]) => n === node && p === port);
  let t = 0;
  const dj = new DjLinkSim();
  const frames = new Set<(dt: number) => void>();
  const host: VisitorHost = {
    onFrame: (l) => (frames.add(l), () => frames.delete(l)),
    onRestart: () => () => false,
    getStatus: () => ({ active: true, touch: sim.usesTouch(), error: null }),
    trigger: (e) => sim.triggerEffect(JSON.stringify(e)),
    touch: (id, phase, p, c) => sim.touch(0, id, phase, p.angle, p.radius, c.hue, c.saturation ?? 0.85, c.brightness ?? 1),
    draw: () => {},
  };
  attachVisitors(host);
  const motion = syntheticMotion(() => t * 1000);
  sim.setHuePull(0.08, 0.6, 0);
  const shown = index("n", s.show!);
  const driver = s.drive ? index(...s.drive) : -1;
  const samples = TRACE_SECONDS / STEP;
  const outV: number[] = [];
  const inV: number[] = [];
  const ticks: number[] = [];
  const inTicks: number[] = [];
  const nType = core.registry.find((x) => x.id === d.nodes.find((n) => n.id === "n")!.kind)!;
  const isEvent = (node: string, port: string) => {
    const kind = d.nodes.find((n) => n.id === node)!.kind;
    return core.registry.find((x) => x.id === kind)!.outputs.find((o) => o.name === port)?.shape === "event";
  };
  const outEvent = nType.outputs.find((o) => o.name === s.show)?.shape === "event";
  const inEvent = s.drive ? isEvent(...s.drive) : false;
  let lastOut = 0;
  let lastIn = 0;
  for (let i = 0; i < samples; i++) {
    t += STEP;
    const fired = dj.step(STEP);
    sim.setAudio(0, dj.audio());
    sim.setDjLink(dj.scalars());
    for (const [event] of fired) sim.fireDjEvent(event);
    const m = motion.read();
    sim.setMotion(m.yaw, m.pitch, m.roll, m.shake);
    frames.forEach((l) => l(STEP));
    sim.step(STEP);
    const v = sim.scalarValues();
    const frac = i / samples;
    if (outEvent) {
      if (v[shown]! > lastOut) ticks.push(+frac.toFixed(3));
      lastOut = v[shown]!;
    }
    if (driver >= 0 && inEvent) {
      if (v[driver]! > lastIn) inTicks.push(+frac.toFixed(3));
      lastIn = v[driver]!;
    }
    if (i % (samples / TRACE_POINTS) === 0) {
      outV.push(v[shown]!);
      if (driver >= 0) inV.push(v[driver]!);
    }
  }
  sim.free();
  // One scale for the output and its driver, so their relation shows.
  const both = [...(outEvent ? [] : outV), ...(inEvent ? [] : inV)];
  const lo = Math.min(...both);
  const hi = Math.max(...both);
  const line = (vals: number[]) =>
    toBase64(Uint8Array.from(vals, (x) => (hi - lo < 1e-6 ? 128 : Math.round(((x - lo) / (hi - lo)) * 255))));
  const result: TraceThumb = {};
  if (outEvent) result.ticks = ticks;
  else result.out = line(outV);
  if (driver >= 0) {
    if (inEvent) result.inTicks = inTicks;
    else result.in = line(inV);
  }
  return result;
}

const core = await loadCore();
const headless = await headlessRuntime();
if (!headless) throw new Error("No WebGPU: install the `webgpu` package where this runs.");
const { runtime } = headless;
attachVisitors(runtime);
let clockT = 0;
runtime.onFrame((dt) => (clockT += dt));
runtime.onRestart(() => (clockT = 0));
runtime.setMotionSource(syntheticMotion(() => clockT * 1000));
runtime.setHuePull(0.08, 0.6, 0);

const still = await filmPicture(core, 1, 128);
const sheet = await filmPicture(core, 4, 64);

const data: ThumbData = {
  spokes: SPOKES,
  samples: SAMPLES,
  innerOverOuter: GATE_GEOMETRY.innerOverOuter,
  traceSeconds: TRACE_SECONDS,
  rings: {},
  traces: {},
};

for (const t of core.registry) {
  if (ICON_ONLY.has(t.id)) continue;
  const s = showcase(t);
  if (!s) {
    console.warn(`  (no showcase for ${t.id})`);
    continue;
  }
  const d = doc(core, t.id, s, lastNode(s));
  for (const n of d.nodes) {
    if (n.kind === "image_in") n.media = still;
    if (n.kind === "clip") n.media = sheet;
  }
  const errors = core.validate(d);
  if (errors.length) throw new Error(`${t.id}: ${errors.join("; ")}`);
  if (s.show !== undefined) {
    data.traces[t.id] = trace(core, d, s);
    console.log(`trace ${t.id}`);
    continue;
  }
  await runtime.setPatch(d);
  const frames = await runtime.capture({
    frames: s.brightest ? 16 : 1,
    interval: 0.3,
    warmup: s.at ?? 2.5,
    restart: true,
  });
  const light = (rgb: Uint8Array) => rgb.reduce((a, v) => a + v, 0);
  const frame = frames.reduce((best, f) => (light(f.rgb) > light(best.rgb) ? f : best));
  data.rings[t.id] = toBase64(sampleRing(frame.rgb));
  console.log(`ring  ${t.id}`);
}
runtime.dispose();

const body = JSON.stringify(data, null, 2).replace(/\n {6}/g, " ").replace(/\n {4}\]/g, " ]");
writeFileSync(
  out,
  `// Generated by \`bun run thumbnails\` (scripts/thumbnails.ts). Do not edit.\n\n` +
    `import type { ThumbData } from "./thumbs";\n\n` +
    `export const THUMBS: ThumbData = ${body};\n`,
);
console.log(`${Object.keys(data.rings).length} rings, ${Object.keys(data.traces).length} traces → ${out}`);
