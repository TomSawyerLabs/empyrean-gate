export type AmbientSceneKind = "entheos-prism" | "entheos-aura" | "entheos-sigil" | "brc-map" | "brc-plan";

export interface BrcEventBeacon {
  title: string;
  camp: string;
  location: string;
  startsAt: string;
  x: number;
  y: number;
}

interface BurningManOccurrence {
  start_time: string;
  end_time: string;
}

interface BurningManEvent {
  title: string;
  description?: string;
  print_description?: string;
  hosted_by_camp?: string;
  event_type?: { abbr?: string; label?: string };
  occurrence_set?: BurningManOccurrence[];
}

interface BurningManCamp {
  name: string;
  location_string?: string;
  location?: {
    frontage?: string;
    intersection?: string;
  };
}

export type BrcApiFetch = (resource: "event" | "camp", uid?: string) => Promise<unknown>;
// A schematic center aligned to the instantly recognizable 2026 plan: the
// horseshoe opens straight upward and the Man sits on its vertical axis.
const BRC_MAP_CENTER = { x: 0.5, y: 0.49 };
const STREET_RADII: Record<string, number> = {
  esplanade: 216.7 / 1536,
  esp: 216.7 / 1536,
  a: 254.4 / 1536,
  ararat: 254.4 / 1536,
  b: 278.7 / 1536,
  bodhi: 278.7 / 1536,
  c: 302.9 / 1536,
  chomolungma: 302.9 / 1536,
  d: 327.2 / 1536,
  delphi: 327.2 / 1536,
  e: 351.9 / 1536,
  eternal: 351.9 / 1536,
  f: 393.9 / 1536,
  fulcrum: 393.9 / 1536,
  g: 418.2 / 1536,
  "great oak": 418.2 / 1536,
  h: 442.5 / 1536,
  heiau: 442.5 / 1536,
  i: 466.8 / 1536,
  iroko: 466.8 / 1536,
  j: 482.4 / 1536,
  jiba: 482.4 / 1536,
  k: 498.8 / 1536,
  kundalini: 498.8 / 1536,
};

const COOL_WORDS = [
  "dj", "dance", "party", "sunset", "sunrise", "fire", "flame", "live music",
  "sound", "performance", "ceremony", "ritual", "parade", "mutant", "art tour",
];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function eventScore(event: BurningManEvent, startMs: number, nowMs: number): number {
  const haystack = `${event.title} ${event.description ?? ""} ${event.print_description ?? ""} ${event.event_type?.label ?? ""}`.toLowerCase();
  const keywordScore = COOL_WORDS.reduce((score, word) => score + (haystack.includes(word) ? 8 : 0), 0);
  const categoryScore = /music|performance|parade|fire|dance/i.test(event.event_type?.label ?? "") ? 18 : 0;
  const minutesAway = Math.max(0, (startMs - nowMs) / 60_000);
  return keywordScore + categoryScore + Math.max(0, 30 - minutesAway / 4);
}

/** Turn a 2026 camp clock address into the normalized coordinates of the map asset. */
export function brcAddressToMapPoint(camp: BurningManCamp): { x: number; y: number } | null {
  const address = `${camp.location?.intersection ?? ""} ${camp.location?.frontage ?? ""} ${camp.location_string ?? ""}`.toLowerCase();
  const clock = address.match(/\b(2|3|4|5|6|7|8|9|10)(?::([0-5]\d))?\b/);
  if (!clock) return null;
  const hour = Number(clock[1]) + Number(clock[2] ?? 0) / 60;
  const street = Object.keys(STREET_RADII)
    .sort((a, b) => b.length - a.length)
    .find((name) => new RegExp(`(?:^|[^a-z])${name.replace(" ", "\\s+")}(?:[^a-z]|$)`, "i").test(address));
  if (!street) return null;
  // Match the published 2026 plan orientation: 12:00 is straight up and each
  // clock hour advances 30 degrees clockwise.
  const angle = ((hour * 30 - 450) * Math.PI) / 180;
  const radius = STREET_RADII[street];
  return {
    x: clamp01(BRC_MAP_CENTER.x + Math.cos(angle) * radius),
    y: clamp01(BRC_MAP_CENTER.y + Math.sin(angle) * radius),
  };
}

/**
 * Select the strongest official event beginning soon and locate its host camp.
 * The supplied fetcher is the Gate's restricted same-origin API bridge.
 */
export async function fetchBrcEventBeacon(
  apiFetch: BrcApiFetch,
  now = new Date(),
): Promise<BrcEventBeacon | null> {
  const events = (await apiFetch("event")) as BurningManEvent[];
  const nowMs = now.getTime();
  const candidates = events.flatMap((event) =>
    (event.occurrence_set ?? []).map((occurrence) => ({ event, occurrence, startMs: Date.parse(occurrence.start_time) })),
  ).filter(({ event, startMs }) =>
    Boolean(event.hosted_by_camp) && Number.isFinite(startMs) && startMs >= nowMs - 20 * 60_000 && startMs <= nowMs + 2 * 60 * 60_000,
  ).sort((a, b) => eventScore(b.event, b.startMs, nowMs) - eventScore(a.event, a.startMs, nowMs));

  // A few events use custom locations or unparseable prose. Walk the best
  // candidates until one resolves to a real 2026 clock/street address.
  for (const candidate of candidates.slice(0, 12)) {
    let camp: BurningManCamp;
    try {
      camp = (await apiFetch("camp", candidate.event.hosted_by_camp)) as BurningManCamp;
    } catch {
      continue;
    }
    const point = brcAddressToMapPoint(camp);
    if (!point) continue;
    return {
      title: candidate.event.title,
      camp: camp.name,
      location: camp.location_string ?? `${camp.location?.intersection ?? ""} & ${camp.location?.frontage ?? ""}`,
      startsAt: candidate.occurrence.start_time,
      ...point,
    };
  }
  return null;
}

interface Scratch {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

const scratches = new WeakMap<CanvasRenderingContext2D, Scratch>();

function scratchFor(owner: CanvasRenderingContext2D, size: number): Scratch {
  let scratch = scratches.get(owner);
  if (!scratch) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    scratch = { canvas, ctx };
    scratches.set(owner, scratch);
  }
  if (scratch.canvas.width !== size) {
    scratch.canvas.width = size;
    scratch.canvas.height = size;
  }
  return scratch;
}

function drawSquare(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  size: number,
  scale = 1,
  rotation = 0,
): void {
  const fit = Math.min(size / image.naturalWidth, size / image.naturalHeight) * scale;
  const width = image.naturalWidth * fit;
  const height = image.naturalHeight * fit;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(rotation);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return [hue, max === 0 ? 0 : delta / max, max];
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1 * 6;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = value - chroma;
  const rgb = h < 1 ? [chroma, x, 0]
    : h < 2 ? [x, chroma, 0]
      : h < 3 ? [0, chroma, x]
        : h < 4 ? [0, x, chroma]
          : h < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  return rgb.map((channel) => Math.round((channel + m) * 255)) as [number, number, number];
}

function illuminateLogo(
  ctx: CanvasRenderingContext2D,
  size: number,
  elapsedMs: number,
  flowingColor: boolean,
  removeWhite = true,
): void {
  const frame = ctx.getImageData(0, 0, size, size);
  const pixels = frame.data;
  const t = elapsedMs / 1000;
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    const neutral = 1 - clamp01((high - low) / 42);
    const white = removeWhite ? smooth((low - 182) / 54) * neutral : 0;
    pixels[index + 3] = Math.round(pixels[index + 3] * (1 - white));
    if (pixels[index + 3] < 8) continue;
    const x = (index / 4) % size;
    const y = Math.floor(index / 4 / size);
    if (high < 92) {
      // Ink becomes dim pearl light: outlines and ENTHEOS remain readable on
      // an emissive installation, where literal black would disappear.
      const pulse = 0.8 + 0.12 * Math.sin(t * 0.28 + x * 0.025 - y * 0.018);
      const inWordmark = y / size > 0.385 && y / size < 0.575;
      const ink = inWordmark ? 214 : 76;
      pixels[index] = Math.round(ink * pulse * 0.92);
      pixels[index + 1] = Math.round(ink * pulse * 0.97);
      pixels[index + 2] = Math.round(ink * pulse * 1.08);
    } else if (flowingColor && high - low > 24) {
      const [h, s, v] = rgbToHsv(r, g, b);
      const current = Math.sin(x * 0.09 + y * 0.055 - t * 0.7) * 0.045;
      const [nr, ng, nb] = hsvToRgb(h + current, Math.min(1, s * 1.18), Math.min(1, v * 1.08));
      pixels[index] = nr;
      pixels[index + 1] = ng;
      pixels[index + 2] = nb;
    }
  }
  ctx.putImageData(frame, 0, 0);
}

function drawEntheosPrism(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  size: number,
  elapsedMs: number,
): void {
  const scratch = scratchFor(ctx, size);
  scratch.ctx.clearRect(0, 0, size, size);
  drawSquare(scratch.ctx, image, size, 0.91);
  illuminateLogo(scratch.ctx, size, elapsedMs, true);

  ctx.clearRect(0, 0, size, size);
  const t = elapsedMs / 1000;
  // Two-pixel ribbons travel in opposing currents through the mark. This is a
  // true spatial deformation, not a single Ken Burns transform.
  for (let y = 0; y < size; y += 2) {
    const offset = Math.sin(y * 0.13 - t * 0.52) * 1.4 + Math.sin(y * 0.035 + t * 0.21) * 0.8;
    ctx.drawImage(scratch.canvas, 0, y, size, 2, offset, y, size, 2);
  }
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.22 + Math.sin(t * 0.31) * 0.04;
  ctx.filter = `blur(${Math.max(0.5, size / 128).toFixed(1)}px)`;
  ctx.drawImage(scratch.canvas, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawEntheosAura(
  ctx: CanvasRenderingContext2D,
  aura: HTMLImageElement,
  logo: HTMLImageElement,
  size: number,
  elapsedMs: number,
): void {
  const t = elapsedMs / 1000;
  ctx.clearRect(0, 0, size, size);
  const breath = 1.02 + Math.sin(t * 0.12) * 0.025;
  drawSquare(ctx, aura, size, breath, Math.sin(t * 0.08) * 0.035);

  // A faint counter-rotating echo makes the wisps evolve against themselves.
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.2;
  ctx.filter = `blur(${Math.max(0.8, size / 96).toFixed(1)}px)`;
  drawSquare(ctx, aura, size, 0.985, -Math.sin(t * 0.07) * 0.045);
  ctx.restore();

  const scratch = scratchFor(ctx, size);
  scratch.ctx.clearRect(0, 0, size, size);
  drawSquare(scratch.ctx, logo, size, 0.86 + Math.sin(t * 0.18) * 0.012);
  illuminateLogo(scratch.ctx, size, elapsedMs, false);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.84;
  ctx.drawImage(scratch.canvas, 0, 0);
  ctx.restore();
}

function drawEntheosSigil(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  size: number,
  elapsedMs: number,
): void {
  const t = elapsedMs / 1000;
  const scratch = scratchFor(ctx, size);
  scratch.ctx.clearRect(0, 0, size, size);
  drawSquare(scratch.ctx, image, size, 0.91 + Math.sin(t * 0.16) * 0.003);
  // The vector reconstruction uses white as a deliberate keyline, unlike the
  // checkerboard-backed source PNG, so preserve it here.
  illuminateLogo(scratch.ctx, size, elapsedMs, false, false);

  ctx.clearRect(0, 0, size, size);
  // Two slow expanding light echoes add motion without bending the vector mark.
  for (let echo = 1; echo <= 2; echo += 1) {
    const phase = (t * 0.035 + echo * 0.36) % 1;
    const scale = 1 + phase * 0.075;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(scale, scale);
    ctx.translate(-size / 2, -size / 2);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = (1 - phase) * (echo === 1 ? 0.2 : 0.1);
    ctx.filter = `blur(${Math.max(1, size / 96).toFixed(1)}px)`;
    ctx.drawImage(scratch.canvas, 0, 0);
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.97;
  ctx.drawImage(scratch.canvas, 0, 0);
  ctx.restore();
}

function drawFireBeacon(
  ctx: CanvasRenderingContext2D,
  size: number,
  elapsedMs: number,
  beacon: BrcEventBeacon,
): void {
  const t = elapsedMs / 1000;
  const x = beacon.x * size;
  const y = beacon.y * size;
  const pulse = 0.82 + Math.sin(t * 4.4) * 0.18;
  const radius = Math.max(4, size * 0.045) * pulse;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.2);
  gradient.addColorStop(0, "rgba(255,255,210,1)");
  gradient.addColorStop(0.18, "rgba(255,184,35,1)");
  gradient.addColorStop(0.48, "rgba(255,43,24,.92)");
  gradient.addColorStop(1, "rgba(255,0,20,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.2, 0, Math.PI * 2);
  ctx.fill();

  // A tiny licking flame reads more naturally than a sterile map pin.
  const sway = Math.sin(t * 5.1) * radius * 0.38;
  ctx.fillStyle = "#ff4028";
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.72, y + radius * 0.55);
  ctx.quadraticCurveTo(x - radius * 0.35, y - radius * 0.45, x + sway, y - radius * 1.65);
  ctx.quadraticCurveTo(x + radius * 0.65, y - radius * 0.25, x + radius * 0.72, y + radius * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffd14a";
  ctx.beginPath();
  ctx.ellipse(x + sway * 0.25, y + radius * 0.12, radius * 0.34, radius * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBrcMap(
  ctx: CanvasRenderingContext2D,
  _map: HTMLImageElement,
  size: number,
  elapsedMs: number,
  beacon: BrcEventBeacon | null,
): void {
  const t = elapsedMs / 1000;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#020713";
  ctx.fillRect(0, 0, size, size);

  const cx = BRC_MAP_CENTER.x * size;
  const cy = BRC_MAP_CENTER.y * size;
  const startAngle = (-30 * Math.PI) / 180; // 2:00
  const endAngle = (210 * Math.PI) / 180; // 10:00, clockwise through the horseshoe
  const streetRadii = [...new Set(Object.values(STREET_RADII))].sort((a, b) => a - b);
  const innerRadius = streetRadii[0] * size;
  const outerRadius = streetRadii[streetRadii.length - 1] * size;
  const roadWidth = Math.max(2.25, size * 0.013);
  const outlineWidth = roadWidth + Math.max(1.5, size * 0.008);
  const breathe = 0.93 + Math.sin(t * 0.16) * 0.07;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = breathe;

  // The angular trash-fence perimeter is as important to BRC's silhouette as
  // the street horseshoe. Keep it well outside the city and visibly polygonal.
  const fencePoints = [
    [0.5, 0.035],
    [0.955, 0.355],
    [0.785, 0.925],
    [0.215, 0.925],
    [0.045, 0.355],
  ] as const;
  ctx.strokeStyle = "rgba(255,82,43,.92)";
  ctx.lineWidth = Math.max(1.4, size * 0.007);
  ctx.setLineDash([Math.max(4, size * 0.018), Math.max(2, size * 0.009)]);
  ctx.beginPath();
  fencePoints.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x * size, y * size);
    else ctx.lineTo(x * size, y * size);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // A handful of nearly-static dust motes keep the map alive without moving
  // its cartography. Their drift cycle is measured in minutes, not beats.
  for (let mote = 0; mote < 14; mote += 1) {
    const angle = mote * 2.39996 + t * (0.0025 + (mote % 3) * 0.0007);
    const radius = size * (0.08 + ((mote * 37) % 100) / 230);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle * 0.91) * radius * 0.74;
    const alpha = 0.018 + (mote % 4) * 0.006;
    ctx.fillStyle = `rgba(255,164,77,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.7, size * (0.003 + (mote % 3) * 0.0015)), 0, Math.PI * 2);
    ctx.fill();
  }

  // Broad, low-level block fill makes the city footprint readable even where
  // no road happens to hit a spoke, while preserving dark separation.
  ctx.lineCap = "butt";
  ctx.strokeStyle = "rgba(8,75,124,.82)";
  ctx.lineWidth = outerRadius - innerRadius;
  ctx.beginPath();
  ctx.arc(cx, cy, (innerRadius + outerRadius) / 2, startAngle, endAngle);
  ctx.stroke();
  ctx.lineCap = "round";

  // Each named street gets a dark casing and a bright centerline. The casing
  // is intentional: at 128×128 it prevents adjacent lanes becoming one blob.
  streetRadii.forEach((radius, index) => {
    ctx.strokeStyle = "rgba(0,4,12,.96)";
    ctx.lineWidth = outlineWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * size, startAngle, endAngle);
    ctx.stroke();

    const major = index === 0 || index === streetRadii.length - 1;
    ctx.strokeStyle = major
      ? "rgba(255,224,132,.98)"
      : index % 2 === 0
        ? "rgba(84,218,239,.97)"
        : "rgba(45,143,218,.96)";
    ctx.lineWidth = major ? roadWidth * 1.18 : roadWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * size, startAngle, endAngle);
    ctx.stroke();
  });

  // Half-hour clock avenues are fatter than literal roads so the radial Gate
  // samples them as continuous corridors instead of isolated dashes.
  for (let halfHour = 4; halfHour <= 20; halfHour += 1) {
    const hour = halfHour / 2;
    const angle = ((hour * 30 - 450) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.strokeStyle = "rgba(0,4,12,.96)";
    ctx.lineWidth = outlineWidth * 1.1;
    ctx.beginPath();
    ctx.moveTo(cx + cos * innerRadius, cy + sin * innerRadius);
    ctx.lineTo(cx + cos * outerRadius, cy + sin * outerRadius);
    ctx.stroke();
    ctx.strokeStyle = halfHour % 2 === 0 ? "rgba(255,236,173,.98)" : "rgba(92,220,231,.94)";
    ctx.lineWidth = roadWidth * 1.05;
    ctx.beginPath();
    ctx.moveTo(cx + cos * innerRadius, cy + sin * innerRadius);
    ctx.lineTo(cx + cos * outerRadius, cy + sin * outerRadius);
    ctx.stroke();
  }

  // The 3:00–9:00 and 12:00–6:00 axes keep the open playa from reading as an
  // arbitrary missing pie slice. They are thin, architectural orientation cues.
  ctx.strokeStyle = "rgba(0,4,12,.96)";
  ctx.lineWidth = Math.max(2.2, size * 0.012);
  ctx.beginPath();
  ctx.moveTo(cx - outerRadius, cy);
  ctx.lineTo(cx + outerRadius, cy);
  ctx.moveTo(cx, cy - innerRadius * 1.45);
  ctx.lineTo(cx, cy + outerRadius);
  ctx.stroke();
  ctx.strokeStyle = "rgba(205,236,241,.9)";
  ctx.lineWidth = Math.max(0.9, size * 0.004);
  ctx.beginPath();
  ctx.moveTo(cx - outerRadius, cy);
  ctx.lineTo(cx + outerRadius, cy);
  ctx.moveTo(cx, cy - innerRadius * 1.45);
  ctx.lineTo(cx, cy + outerRadius);
  ctx.stroke();

  const manRadius = Math.max(3.2, size * 0.025);
  const manGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, manRadius * 2.5);
  manGlow.addColorStop(0, "rgba(255,255,222,1)");
  manGlow.addColorStop(0.3, "rgba(255,190,43,1)");
  manGlow.addColorStop(1, "rgba(255,70,20,0)");
  ctx.fillStyle = manGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, manRadius * 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff4b5";
  ctx.beginPath();
  ctx.arc(cx, cy, manRadius, 0, Math.PI * 2);
  ctx.fill();

  const templeAngle = -Math.PI / 2;
  const templeDistance = innerRadius * 0.64;
  const tx = cx + Math.cos(templeAngle) * templeDistance;
  const ty = cy + Math.sin(templeAngle) * templeDistance;
  const templeSize = Math.max(3, size * 0.022);
  ctx.fillStyle = "#5ff5ff";
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-templeSize / 2, -templeSize / 2, templeSize, templeSize);
  ctx.restore();

  // Entheos is at 9:15 & Esplanade. Isolate it from the Esplanade keyline and
  // make the five-point silhouette large enough to survive 128×128 transport.
  const entheosAngle = ((9.25 * 30 - 450) * Math.PI) / 180;
  const entheosRadius = STREET_RADII.esplanade * size;
  const ex = cx + Math.cos(entheosAngle) * entheosRadius;
  const ey = cy + Math.sin(entheosAngle) * entheosRadius;
  const starRadius = Math.max(6.5, size * 0.031) * (0.97 + Math.sin(t * 0.48) * 0.03);
  ctx.fillStyle = "rgba(1,4,10,.88)";
  ctx.beginPath();
  ctx.arc(ex, ey, starRadius * 1.72, 0, Math.PI * 2);
  ctx.fill();
  const starGlow = ctx.createRadialGradient(ex, ey, 0, ex, ey, starRadius * 2.45);
  starGlow.addColorStop(0, "rgba(255,255,221,.95)");
  starGlow.addColorStop(0.28, "rgba(255,39,137,.9)");
  starGlow.addColorStop(1, "rgba(255,20,120,0)");
  ctx.fillStyle = starGlow;
  ctx.beginPath();
  ctx.arc(ex, ey, starRadius * 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff6c9";
  ctx.strokeStyle = "#ff2489";
  ctx.lineWidth = Math.max(1.2, size * 0.005);
  ctx.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const radius = point % 2 === 0 ? starRadius : starRadius * 0.43;
    const angle = -Math.PI / 2 + (point * Math.PI) / 5;
    const x = ex + Math.cos(angle) * radius;
    const y = ey + Math.sin(angle) * radius;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (beacon) drawFireBeacon(ctx, size, elapsedMs, beacon);
}

/**
 * A literal LED-negative trace of the published 2026 plan. Paper white becomes
 * black/off, while every street is an explicit luminous stroke over contiguous
 * blue blocks; no road is represented by an empty wedge between shapes.
 */
function drawBrcPlan(
  ctx: CanvasRenderingContext2D,
  _map: HTMLImageElement,
  size: number,
  elapsedMs: number,
  beacon: BrcEventBeacon | null,
): void {
  const t = elapsedMs / 1000;
  const cx = size * 0.5;
  const cy = size * 0.49;
  const startAngle = -Math.PI / 6;
  const endAngle = (7 * Math.PI) / 6;
  const streetRadii = [...new Set(Object.values(STREET_RADII))].sort((a, b) => a - b);
  const innerRadius = streetRadii[0] * size;
  const outerRadius = streetRadii[streetRadii.length - 1] * size;
  const hairline = Math.max(0.9, size * 0.0042);
  const majorLine = Math.max(1.4, size * 0.0065);

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#01040a";
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";

  // Continuous blue city footprint first. Streets are drawn on top as lines,
  // matching the reference's block topology rather than subtracting road gaps.
  const cityFill = ctx.createLinearGradient(0, cy - outerRadius, 0, cy + outerRadius);
  cityFill.addColorStop(0, "#62c8f4");
  cityFill.addColorStop(0.52, "#219fe9");
  cityFill.addColorStop(1, "#0f7fc8");
  ctx.strokeStyle = cityFill;
  ctx.lineWidth = outerRadius - innerRadius;
  ctx.beginPath();
  ctx.arc(cx, cy, (innerRadius + outerRadius) / 2, startAngle, endAngle);
  ctx.stroke();

  // Precise concentric named streets. A dark keyline preserves the reference's
  // ink drawing; the narrow ivory center is the actual luminous street.
  streetRadii.forEach((radius, index) => {
    const r = radius * size;
    ctx.strokeStyle = "rgba(0,18,32,.96)";
    ctx.lineWidth = index === 0 || index === streetRadii.length - 1 ? majorLine * 2.5 : hairline * 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.stroke();
    ctx.strokeStyle = index === 0 || index === streetRadii.length - 1
      ? "rgba(255,239,184,.98)"
      : "rgba(225,247,250,.94)";
    ctx.lineWidth = index === 0 || index === streetRadii.length - 1 ? majorLine : hairline;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.stroke();
  });

  // Every quarter-hour from 2:00 through 10:00 is a line, just as in the plan.
  // Major half-hour avenues are slightly heavier, never represented as gaps.
  for (let quarter = 8; quarter <= 40; quarter += 1) {
    const hour = quarter / 4;
    const angle = ((hour * 30 - 450) * Math.PI) / 180;
    const isHalfHour = quarter % 2 === 0;
    const isHour = quarter % 4 === 0;
    const width = isHour ? majorLine : isHalfHour ? hairline * 1.25 : hairline * 0.82;
    const x1 = cx + Math.cos(angle) * innerRadius;
    const y1 = cy + Math.sin(angle) * innerRadius;
    const x2 = cx + Math.cos(angle) * outerRadius;
    const y2 = cy + Math.sin(angle) * outerRadius;
    ctx.strokeStyle = "rgba(0,18,32,.94)";
    ctx.lineWidth = width * 2.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = isHour ? "rgba(255,239,190,.98)" : "rgba(215,244,249,.9)";
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Open-playa axes, center Man, Temple, and Center Camp ring.
  ctx.strokeStyle = "rgba(224,245,248,.86)";
  ctx.lineWidth = hairline;
  ctx.beginPath();
  ctx.moveTo(cx - outerRadius - size * 0.055, cy);
  ctx.lineTo(cx + outerRadius + size * 0.055, cy);
  ctx.moveTo(cx, cy - innerRadius * 1.55);
  ctx.lineTo(cx, cy + outerRadius + size * 0.055);
  ctx.stroke();

  const centerCampY = cy + innerRadius + size * 0.022;
  ctx.strokeStyle = "rgba(225,247,250,.95)";
  ctx.lineWidth = majorLine;
  ctx.beginPath();
  ctx.ellipse(cx, centerCampY, size * 0.035, size * 0.024, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, centerCampY, size * 0.011, 0, Math.PI * 2);
  ctx.stroke();

  const manRadius = Math.max(3.6, size * 0.024);
  const manGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, manRadius * 2.6);
  manGlow.addColorStop(0, "rgba(255,255,230,1)");
  manGlow.addColorStop(0.34, "rgba(255,177,36,.96)");
  manGlow.addColorStop(1, "rgba(255,70,15,0)");
  ctx.fillStyle = manGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, manRadius * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff5c7";
  ctx.beginPath();
  ctx.arc(cx, cy, manRadius, 0, Math.PI * 2);
  ctx.fill();

  const templeY = cy - innerRadius * 1.12;
  ctx.fillStyle = "#63efff";
  ctx.save();
  ctx.translate(cx, templeY);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-size * 0.012, -size * 0.012, size * 0.024, size * 0.024);
  ctx.restore();

  // Reference-shaped pentagonal trash fence.
  const fencePoints = [
    [0.5, 0.035], [0.955, 0.355], [0.785, 0.925],
    [0.215, 0.925], [0.045, 0.355],
  ] as const;
  ctx.strokeStyle = "rgba(255,72,38,.96)";
  ctx.lineWidth = Math.max(1.2, size * 0.0055);
  ctx.setLineDash([Math.max(3, size * 0.014), Math.max(1.6, size * 0.007)]);
  ctx.beginPath();
  fencePoints.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x * size, y * size);
    else ctx.lineTo(x * size, y * size);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Entheos: isolated dark halo, magenta rays, and a white five-point core.
  const entheosAngle = ((9.25 * 30 - 450) * Math.PI) / 180;
  const ex = cx + Math.cos(entheosAngle) * innerRadius;
  const ey = cy + Math.sin(entheosAngle) * innerRadius;
  const starRadius = Math.max(6.5, size * 0.031) * (0.97 + Math.sin(t * 0.42) * 0.03);
  ctx.fillStyle = "rgba(1,4,10,.88)";
  ctx.beginPath();
  ctx.arc(ex, ey, starRadius * 2.15, 0, Math.PI * 2);
  ctx.fill();
  const starGlow = ctx.createRadialGradient(ex, ey, 0, ex, ey, starRadius * 2.5);
  starGlow.addColorStop(0, "rgba(255,255,231,1)");
  starGlow.addColorStop(0.22, "rgba(255,38,144,.96)");
  starGlow.addColorStop(1, "rgba(255,18,112,0)");
  ctx.fillStyle = starGlow;
  ctx.beginPath();
  ctx.arc(ex, ey, starRadius * 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff9d7";
  ctx.strokeStyle = "#ff1681";
  ctx.lineWidth = Math.max(1.4, size * 0.005);
  ctx.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const r = point % 2 === 0 ? starRadius : starRadius * 0.42;
    const a = -Math.PI / 2 + point * Math.PI / 5;
    const x = ex + Math.cos(a) * r;
    const y = ey + Math.sin(a) * r;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (beacon) drawFireBeacon(ctx, size, elapsedMs, beacon);
}

export function drawAmbientScene(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement,
  overlay: HTMLImageElement | null,
  size: number,
  elapsedMs: number,
  kind: AmbientSceneKind,
  beacon: BrcEventBeacon | null,
): void {
  if (kind === "entheos-prism") drawEntheosPrism(ctx, source, size, elapsedMs);
  else if (kind === "entheos-aura" && overlay?.complete && overlay.naturalWidth > 0) {
    drawEntheosAura(ctx, source, overlay, size, elapsedMs);
  }
  else if (kind === "entheos-sigil") drawEntheosSigil(ctx, source, size, elapsedMs);
  else if (kind === "brc-map") drawBrcMap(ctx, source, size, elapsedMs, beacon);
  else if (kind === "brc-plan") drawBrcPlan(ctx, source, size, elapsedMs, beacon);
}
