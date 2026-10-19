// An icon for every node kind and palette group: line drawings on a 24-unit
// grid, stroked in `currentColor`, so they take the colour of whatever they
// sit in (a palette chip, a node's header, the panel). Built from a few
// shape helpers rather than pasted path data, so each one reads as what it
// draws. `icons.test.ts` holds every registry kind to having one.

import type { PatchGroup, PatchNodeType } from "../types";

/** One stroke, or a filled shape when `fill` is set. */
type Mark = { d: string; fill?: boolean };
type Icon = Mark[];

const f = (n: number) => +n.toFixed(2);
const pt = (x: number, y: number) => `${f(x)} ${f(y)}`;

/** A stroked path. */
const p = (d: string): Mark => ({ d });
/** A filled path. */
const solid = (d: string): Mark => ({ d, fill: true });

const circleD = (cx: number, cy: number, r: number) =>
  `M${pt(cx - r, cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
const circle = (cx: number, cy: number, r: number) => p(circleD(cx, cy, r));
const dot = (cx: number, cy: number, r = 1.3) => solid(circleD(cx, cy, r));
const line = (x1: number, y1: number, x2: number, y2: number) => p(`M${pt(x1, y1)}L${pt(x2, y2)}`);
const poly = (...xy: number[]) => {
  let d = `M${pt(xy[0]!, xy[1]!)}`;
  for (let i = 2; i < xy.length; i += 2) d += `L${pt(xy[i]!, xy[i + 1]!)}`;
  return p(d);
};
const rect = (x: number, y: number, w: number, h: number, r = 0) =>
  r
    ? p(
        `M${pt(x + r, y)}H${f(x + w - r)}a${r} ${r} 0 0 1 ${r} ${r}V${f(y + h - r)}a${r} ${r} 0 0 1 ${-r} ${r}` +
          `H${f(x + r)}a${r} ${r} 0 0 1 ${-r} ${-r}V${f(y + r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`,
      )
    : p(`M${pt(x, y)}h${w}v${h}h${-w}Z`);
/** An arc of a circle from angle `a0` to `a1` (degrees, 0 = right, clockwise
 * on screen). */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const rad = (a: number) => (a * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad(a0));
  const y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a1));
  const y1 = cy + r * Math.sin(rad(a1));
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return p(`M${pt(x0, y0)}A${f(r)} ${f(r)} 0 ${large} ${a1 > a0 ? 1 : 0} ${pt(x1, y1)}`);
};
/** A curve through `n` samples of `fn(t)` for t in 0..1, as y over x0..x1. */
const plot = (x0: number, x1: number, fn: (t: number) => number, n = 24) => {
  let d = "";
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    d += `${i ? "L" : "M"}${pt(x0 + (x1 - x0) * t, fn(t))}`;
  }
  return p(d);
};
/** Spokes from `r0` to `r1` around (cx, cy), `n` of them, starting at `a0`. */
const spokes = (cx: number, cy: number, r0: number, r1: number, n: number, a0 = -90) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((a0 + (360 * i) / n) * Math.PI) / 180;
    return line(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), cx + r1 * Math.cos(a), cy + r1 * Math.sin(a));
  });
/** A four-pointed sparkle centred on (cx, cy). */
const star4 = (cx: number, cy: number, r: number) =>
  p(
    `M${pt(cx, cy - r)}Q${pt(cx, cy)} ${pt(cx + r, cy)}Q${pt(cx, cy)} ${pt(cx, cy + r)}` +
      `Q${pt(cx, cy)} ${pt(cx - r, cy)}Q${pt(cx, cy)} ${pt(cx, cy - r)}Z`,
  );
const bolt = (dx = 0, dy = 0, s = 1) =>
  poly(13 * s + dx, 2 * s + dy, 5 * s + dx, 13 * s + dy, 11 * s + dx, 13 * s + dy, 10 * s + dx, 22 * s + dy, 19 * s + dx, 10 * s + dy, 13 * s + dx, 10 * s + dy, 13 * s + dx, 2 * s + dy);
const cloud = (dx = 0, dy = 0) =>
  p(
    `M${pt(7 + dx, 18 + dy)}a4 4 0 0 1 -0.6 -7.95a5.5 5.5 0 0 1 10.6 -1.3a4.2 4.2 0 0 1 0.6 9.25Z`,
  );
/** An Archimedean spiral from radius `r0` to `r1` over `turns` turns. */
const spiral = (cx: number, cy: number, r0: number, r1: number, turns: number) => {
  let d = "";
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const a = t * turns * 2 * Math.PI;
    const r = r0 + t * (r1 - r0);
    d += `${i ? "L" : "M"}${pt(cx + r * Math.cos(a), cy + r * Math.sin(a))}`;
  }
  return p(d);
};
const sine = (x0: number, x1: number, cy: number, amp: number, cycles: number) =>
  plot(x0, x1, (t) => cy - amp * Math.sin(t * cycles * 2 * Math.PI), 32);
const phone = () => [rect(7, 2.5, 10, 19, 2), line(10.5, 18.5, 13.5, 18.5)];

const NODE_ICONS: Record<string, Icon> = {
  // -- Controls
  time: [circle(12, 12, 9), poly(12, 7, 12, 12, 15.5, 14)],
  slider: [line(3, 12, 21, 12), circle(14, 12, 2.6), line(3, 6, 8, 6), line(16, 18, 21, 18)],
  globals: [arc(12, 13, 8.5, 150, 390), line(12, 13, 16.5, 8.5), dot(12, 13, 1.6), line(5, 19.5, 19, 19.5)],

  // -- Live input
  audio: [line(4, 10, 4, 14), line(8, 6, 8, 18), line(12, 3, 12, 21), line(16, 8, 16, 16), line(20, 10.5, 20, 13.5)],
  imu: [...phone(), arc(12, 12, 10, -40, 40), poly(19.2, 16.5, 19.7, 18.4, 21.6, 17.6)],
  touch: [dot(12, 12, 2.4), circle(12, 12, 5.5), arc(12, 12, 9.5, -60, 60), arc(12, 12, 9.5, 120, 240)],
  touch_dabs: [p("M3 18c3-1 3-8 7-8s2 7 6 7 3-9 5-11"), dot(21, 6, 1.6)],
  tap: [poly(9, 9, 9, 21, 12, 17.5, 15, 22, 17, 21, 14.5, 16.5, 19, 16, 9, 9), line(9, 2, 9, 5), line(3.5, 4.5, 5.5, 6.5), line(14.5, 4.5, 12.5, 6.5), line(2, 10, 5, 10)],
  effects_in: [star4(12, 12, 8), ...spokes(12, 12, 9, 11, 4, -45)],
  dj_link: [rect(2, 5, 9, 14, 1.5), circle(6.5, 12, 3), rect(13, 5, 9, 14, 1.5), circle(17.5, 12, 3), line(11, 9, 13, 9)],

  // -- Media
  video_in: [rect(2.5, 6, 13, 12, 2), poly(15.5, 10, 21.5, 7, 21.5, 17, 15.5, 14)],
  image_in: [rect(3, 4, 18, 16, 2), dot(8.5, 9, 1.8), poly(3, 17, 9, 12, 13, 15.5, 16, 13, 21, 17)],
  clip: [rect(3, 3, 18, 18, 2), line(7, 3, 7, 21), line(17, 3, 17, 21), line(3, 8, 7, 8), line(3, 12, 7, 12), line(3, 16, 7, 16), line(17, 8, 21, 8), line(17, 12, 21, 12), line(17, 16, 21, 16)],
  texture_sample: [rect(3, 3, 13, 13, 1.5), line(3, 9.5, 16, 9.5), line(9.5, 3, 9.5, 16), circle(16, 16, 3.2), line(18.3, 18.3, 21.5, 21.5)],

  // -- Shape a signal
  scalar_math: [line(4, 7, 10, 7), line(7, 4, 7, 10), line(14, 7, 20, 7), line(4.5, 14.5, 9.5, 19.5), line(9.5, 14.5, 4.5, 19.5), line(14, 17, 20, 17), dot(17, 14, 1), dot(17, 20, 1)],
  map_range: [line(5, 9, 5, 15), line(19, 3, 19, 21), line(3.5, 9, 6.5, 9), line(3.5, 15, 6.5, 15), line(17.5, 3, 20.5, 3), line(17.5, 21, 20.5, 21), p("M6.5 9L17 3.5"), p("M6.5 15L17 20.5")],
  mix: [circle(9, 12, 6), circle(15, 12, 6)],
  clamp: [line(3, 6, 21, 6), line(3, 18, 21, 18), p("M3 12c2 0 3-6 4-6h3c1 0 2 12 3 12h3c1 0 2-6 5-6")],
  smooth: [poly(3, 18, 8, 18, 8, 6, 12, 6), p("M12 18c4 0 4-12 9-12")],
  threshold: [p("M3 20c6 0 8-16 18-16"), line(3, 11, 6, 11), line(9, 11, 12, 11), line(15, 11, 18, 11), dot(12.6, 11, 1.8)],

  // -- Motion
  lfo: [sine(2, 22, 12, 7, 1.5)],
  envelope: [poly(2, 20, 7, 4, 11, 11, 17, 11, 22, 20)],
  sequence: [rect(3, 13, 4, 7), rect(10, 6, 4, 14), rect(17, 10, 4, 10)],

  // -- Randomness
  random: [poly(2, 15, 7, 15, 7, 6, 12, 6, 12, 18, 17, 18, 17, 10, 22, 10)],
  full_random: [poly(2, 12, 4, 6, 6, 17, 8, 9, 10, 20, 12, 4, 14, 14, 16, 8, 18, 18, 20, 7, 22, 13)],
  random_walk: [poly(3, 19, 6, 16, 5, 12, 9, 11, 11, 7, 14, 9, 15, 5, 19, 6, 21, 3), dot(3, 19, 1.4)],
  smooth_noise: [p("M2 14c3 0 3-7 6-7s3 10 6 10 2-6 4-6 2 3 4 3")],

  // -- Events
  counter: [line(4, 5, 4, 19), line(8, 5, 8, 19), line(12, 5, 12, 19), line(16, 5, 16, 19), line(2, 16, 19, 8)],
  toggle: [rect(2, 7, 20, 10, 5), dot(17, 12, 3)],
  delay: [line(6, 3, 18, 3), line(6, 21, 18, 21), p("M7 3c0 6 10 6 10 9s-10 3-10 9"), p("M17 3c0 6-10 6-10 9s10 3 10 9")],
  event_merge: [p("M3 5c6 0 7 7 11 7"), p("M3 19c6 0 7-7 11-7"), poly(14, 12, 21, 12), poly(18, 9, 21, 12, 18, 15)],
  event_effect: [bolt(-3, 0, 0.9), star4(18, 17, 4.5)],

  // -- Building blocks
  solid: [solid("M4 4h16v16H4Z")],
  gradient: [rect(3, 3, 18, 18, 1.5), line(7, 3, 7, 21), line(10.5, 3, 10.5, 21), line(13.5, 3, 13.5, 21), line(16, 3, 16, 21), line(18, 3, 18, 21), line(19.6, 3, 19.6, 21)],
  gradient_radial: [circle(12, 12, 9.5), circle(12, 12, 6.5), circle(12, 12, 3.5), dot(12, 12, 1)],
  coordinate: [poly(4, 3, 4, 20, 21, 20), line(4, 10, 14, 10), line(14, 10, 14, 20), dot(14, 10, 2)],
  perlin_noise: [p("M3 7c4-3 7 3 10 0s6-2 8 0"), p("M3 12c4-3 7 3 10 0s6-2 8 0"), p("M3 17c4-3 7 3 10 0s6-2 8 0")],
  random_field: [dot(5, 5, 1.4), dot(11, 4, 1), dot(18, 6, 1.6), dot(7, 11, 1.7), dot(14, 10, 1.1), dot(19, 13, 1.2), dot(4, 18, 1), dot(10, 17, 1.5), dot(16, 19, 1.8), dot(13, 14.5, 0.8)],
  touch_mask: [p("M12 3a9 9 0 1 0 0.01 0Z"), solid(circleD(12, 12, 4))],
  feedback: [rect(8, 8, 8, 8, 1), arc(12, 12, 9, -150, 150), poly(2.5, 9.2, 4.2, 7.5, 6.2, 8.8)],

  // -- Patterns
  rainbow: [arc(12, 18, 10, 180, 360), arc(12, 18, 7, 180, 360), arc(12, 18, 4, 180, 360)],
  plasma: [p("M5 9c0-4 6-6 8-3s7 1 7 6-5 4-6 7-8 3-9-1-4-4-0-9Z"), p("M10 11c1-2 4-1 4 1s-3 2-4-1Z")],
  spiral: [spiral(12, 12, 1, 10, 3.2)],
  radial_waves: [dot(12, 12, 1.6), circle(12, 12, 4.5), circle(12, 12, 8), arc(12, 12, 11, -40, 40), arc(12, 12, 11, 140, 220)],
  wedges: [circle(12, 12, 9.5), ...spokes(12, 12, 0, 9.5, 6, -90), solid("M12 12L12 2.5A9.5 9.5 0 0 1 20.23 7.25Z")],
  interference: [circle(8, 12, 3), circle(8, 12, 6), circle(16, 12, 3), circle(16, 12, 6)],
  spoke_chase: [circle(12, 12, 2), ...spokes(12, 12, 4, 10, 8, -90).slice(1), p("M12 2V8"), arc(12, 12, 11, -80, -20)],
  breathe: [circle(12, 12, 4), circle(12, 12, 8.5), p("M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2")],
  sparkle: [star4(10, 13, 7.5), star4(18.5, 5.5, 3.5), dot(19, 19, 1)],
  noise_field: [cloud(0, -2), p("M5 21h4M12 21h7")],
  noise_color: [circle(9, 9, 5.5), circle(15, 9, 5.5), circle(12, 14.5, 5.5)],
  fire: [p("M12 22c-4.5 0-7-3-7-6.5 0-4 3.5-5.5 4-10 2.5 1.5 3.5 4 3.5 6 1-1 1.5-2.5 1.5-4 3 2 5 5.5 5 8.5 0 3.5-2.5 6-7 6Z"), p("M12 22c-1.8 0-3-1.2-3-3 0-2 1.5-2.5 2-4.5 2 1 3.5 2.8 3.5 4.5S13.8 22 12 22Z")],
  meteors: [line(4, 4, 13, 13), dot(14, 14, 2), line(10, 2, 17, 9), dot(18, 10, 1.4), line(2, 11, 7, 16), dot(8, 17, 1.2)],
  warp: [rect(2, 2, 20, 20, 1), rect(6, 6, 12, 12, 1), rect(9.5, 9.5, 5, 5, 0.5), line(2, 2, 9.5, 9.5), line(22, 2, 14.5, 9.5), line(2, 22, 9.5, 14.5), line(22, 22, 14.5, 14.5)],
  cosmic_drift: [circle(12, 12, 5), p("M3 15.5c-2-3 18-10 18-7s-16 10-18 7Z"), dot(4, 4, 0.9), dot(20, 19, 1.1), dot(19, 3, 0.7)],
  earth_current: [p("M5 19C5 10 10 4 20 4c0 10-6 15-15 15Z"), p("M5 19L14 10"), line(3, 21, 5, 19)],
  beat_rings: [circle(12, 12, 3), circle(12, 12, 7), circle(12, 12, 10.5), line(19, 5, 21, 3), line(5, 19, 3, 21)],
  waveform: [circle(12, 12, 10), sine(4, 20, 12, 4, 2)],
  spectrum: [line(4, 20, 4, 15), line(8, 20, 8, 9), line(12, 20, 12, 5), line(16, 20, 16, 11), line(20, 20, 20, 15), line(2, 20, 22, 20)],
  touch_glow: [dot(12, 12, 3), ...spokes(12, 12, 6, 10, 8, -90)],

  // -- Color & space
  colorize: [p("M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11Z"), solid("M12 20a6 6 0 0 1-6-6h12a6 6 0 0 1-6 6Z")],
  palette: [p("M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2.2-.7-1.6.3-2.8 2-2.8H18a3 3 0 0 0 3-3c0-5.5-4-10-9-10Z"), dot(7.5, 11, 1.4), dot(10, 7, 1.4), dot(15, 7.5, 1.4)],
  color_adjust: [circle(12, 12, 9), solid("M12 3a9 9 0 0 1 0 18Z")],
  luminance: [circle(12, 12, 4), ...spokes(12, 12, 7, 10, 8, -90)],
  field_math: [rect(3, 3, 18, 18, 2), line(7, 9, 12, 9), line(9.5, 6.5, 9.5, 11.5), line(12, 15.5, 17, 15.5)],
  transform: [poly(12, 2, 12, 22), poly(2, 12, 22, 12), poly(9.5, 4.5, 12, 2, 14.5, 4.5), poly(9.5, 19.5, 12, 22, 14.5, 19.5), poly(4.5, 9.5, 2, 12, 4.5, 14.5), poly(19.5, 9.5, 22, 12, 19.5, 14.5)],
  blend: [rect(3, 3, 12, 12, 1.5), rect(9, 9, 12, 12, 1.5), solid("M9 9h6v6H9Z")],

  // -- Draw streams
  render_points: [p("M4 20l3-1 11-11-2-2L5 17Z"), line(14, 6, 16, 8), dot(20, 20, 1), dot(16, 21, 0.8)],
  render_effects: [rect(2.5, 2.5, 19, 19, 2), star4(12, 12, 6.5)],

  // -- Structure
  subpatch: [rect(2.5, 2.5, 19, 19, 2), rect(7, 7, 10, 10, 1), line(2.5, 12, 7, 12), line(17, 12, 21.5, 12)],
  code: [poly(8, 6, 2, 12, 8, 18), poly(16, 6, 22, 12, 16, 18), line(14, 4, 10, 20)],
  note: [p("M4 3h12l4 4v14H4Z"), poly(16, 3, 16, 7, 20, 7), line(7.5, 11, 16.5, 11), line(7.5, 14.5, 16.5, 14.5), line(7.5, 18, 13, 18)],
  output: [circle(12, 12, 9.5), circle(12, 12, 4.5), line(1, 12, 9, 12), poly(6.5, 9.5, 9, 12, 6.5, 14.5)],
};

const GROUP_ICONS: Record<PatchGroup, Icon> = {
  controls: [line(6, 3, 6, 21), line(12, 3, 12, 21), line(18, 3, 18, 21), solid(circleD(6, 15, 2.3)), solid(circleD(12, 8, 2.3)), solid(circleD(18, 13, 2.3))],
  live: [dot(12, 12, 2), arc(12, 12, 5.5, -45, 45), arc(12, 12, 5.5, 135, 225), arc(12, 12, 9.5, -45, 45), arc(12, 12, 9.5, 135, 225)],
  media: [rect(2.5, 4.5, 19, 15, 2), poly(10, 9, 15, 12, 10, 15, 10, 9)],
  shape: [p("M3 18C9 18 9 6 15 6h6"), dot(3, 18, 1.6), dot(21, 6, 1.6)],
  motion: [sine(2, 22, 12, 6, 1), poly(18, 4, 21, 7, 18, 10)],
  random: [rect(3, 3, 18, 18, 3), dot(8, 8, 1.5), dot(16, 8, 1.5), dot(12, 12, 1.5), dot(8, 16, 1.5), dot(16, 16, 1.5)],
  events: [bolt()],
  blocks: [rect(3, 3, 8, 8, 1), rect(13, 3, 8, 8, 1), rect(3, 13, 8, 8, 1), solid("M13 13h8v8h-8Z")],
  patterns: [star4(12, 12, 9.5), star4(19, 4.5, 2.5)],
  color: [poly(12, 4, 20, 19, 4, 19, 12, 4), line(1.5, 13, 9, 12), line(15, 11, 22.5, 8), line(15.8, 12.6, 22.5, 12.5), line(16.6, 14.2, 22.5, 17)],
  draw: [p("M3 21l1-4L16 5l3 3L7 20Z"), line(14, 7, 17, 10)],
  structure: [rect(2, 3, 7, 6, 1), rect(15, 9, 7, 6, 1), rect(2, 15, 7, 6, 1), p("M9 6c3 0 3 6 6 6M9 18c3 0 3-6 6-6")],
};

/** For kinds this build has no drawing of (a newer gate's registry). */
const CATEGORY_ICONS: Record<PatchNodeType["category"], Icon> = {
  input: GROUP_ICONS.live,
  scalar: GROUP_ICONS.shape,
  generator: GROUP_ICONS.patterns,
  field: GROUP_ICONS.color,
  combine: NODE_ICONS.blend!,
  texture: GROUP_ICONS.media,
  sink: NODE_ICONS.output!,
  code: NODE_ICONS.code!,
};

/** The kinds that have their own drawing. */
export const ICON_KINDS: ReadonlySet<string> = new Set(Object.keys(NODE_ICONS));

function Svg({ icon, size, className }: { icon: Icon; size: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icon.map((m, i) => (
        <path key={i} d={m.d} fill={m.fill ? "currentColor" : undefined} stroke={m.fill ? "none" : undefined} />
      ))}
    </svg>
  );
}

/** A node kind's icon; a kind with none gets its category's. */
export function NodeIcon({
  kind,
  category,
  size = 16,
  className = "node-icon",
}: {
  kind: string;
  category?: PatchNodeType["category"];
  size?: number;
  className?: string;
}) {
  const icon = NODE_ICONS[kind] ?? (category ? CATEGORY_ICONS[category] : GROUP_ICONS.structure);
  return <Svg icon={icon} size={size} className={className} />;
}

/** A palette group's icon. */
export function GroupIcon({ group, size = 16, className = "group-icon" }: { group: PatchGroup; size?: number; className?: string }) {
  return <Svg icon={GROUP_ICONS[group]} size={size} className={className} />;
}
