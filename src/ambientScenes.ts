export type AmbientSceneKind =
  | "entheos-prism"
  | "entheos-aura"
  | "entheos-sigil"
  | "brc-map"
  | "brc-plan"
  | "axis-mundi-portal";

export type BrcEventCategory = "music" | "performance" | "fire" | "gathering" | "food" | "wellness";

export interface BrcEventDot {
  id: string;
  title: string;
  camp: string;
  location: string;
  startsAt: string;
  endsAt: string;
  category: BrcEventCategory;
  categoryLabel: string;
  sourceType: string;
  description: string;
  score: number;
  x: number;
  y: number;
}

export interface BrcEventDiagnostic {
  level: "info" | "warn";
  summary: string;
  details: Record<string, string | number | boolean | null>;
}

export interface BrcEventScan {
  dots: BrcEventDot[];
  diagnostics: BrcEventDiagnostic[];
  eventCount: number;
  upcomingCount: number;
  coolCount: number;
  windowMode: "live" | "next-scheduled";
}

export const BRC_EVENT_CATEGORIES: ReadonlyArray<{
  id: BrcEventCategory;
  label: string;
  color: string;
}> = [
  { id: "music", label: "Music & dance", color: "#ff4fc3" },
  { id: "performance", label: "Performance", color: "#ffd166" },
  { id: "fire", label: "Fire & spectacle", color: "#ff593d" },
  { id: "gathering", label: "Ritual, tour & gathering", color: "#9b7cff" },
  { id: "food", label: "Food & drink", color: "#4ee6a8" },
  { id: "wellness", label: "Wellness & workshop", color: "#52d9ff" },
] as const;

interface BurningManOccurrence {
  start_time: string;
  end_time: string;
}

interface BurningManEvent {
  uid?: string;
  title: string;
  description?: string;
  print_description?: string;
  hosted_by_camp?: string;
  event_type?: { abbr?: string; label?: string };
  occurrence_set?: BurningManOccurrence[];
}

interface BurningManCamp {
  uid?: string;
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

const CATEGORY_WORDS: ReadonlyArray<{
  id: BrcEventCategory;
  words: readonly string[];
}> = [
  { id: "fire", words: ["fire", "flame", "burn", "pyro", "spectacle"] },
  { id: "music", words: ["dj", "dance", "party", "music", "sound", "concert", "karaoke", "disco"] },
  { id: "performance", words: ["performance", "circus", "cabaret", "comedy", "theater", "theatre", "parade", "procession"] },
  { id: "food", words: ["food", "coffee", "breakfast", "brunch", "lunch", "dinner", "snack", "cocktail", "drinks", "bar "] },
  { id: "wellness", words: ["yoga", "meditation", "healing", "massage", "wellness", "workshop", "breathwork"] },
  { id: "gathering", words: ["ritual", "ceremony", "sunrise", "sunset", "gathering", "meetup", "talk", "tour", "art car", "mutant vehicle"] },
];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export function brcEventCategory(event: BurningManEvent): BrcEventCategory | null {
  const haystack = `${event.title} ${event.description ?? ""} ${event.print_description ?? ""} ${event.event_type?.label ?? ""}`.toLowerCase();
  const officialType = `${event.event_type?.label ?? ""} ${event.event_type?.abbr ?? ""}`.toLowerCase();
  if (/food|beverage|drink/.test(officialType)) return "food";
  if (/class|workshop|wellness|healing/.test(officialType)) return "wellness";
  if (/fire|flame|burn|pyro/.test(haystack)) return "fire";
  if (/music|party|dance/.test(officialType)) return "music";
  if (/performance|parade|circus|theat/.test(officialType)) return "performance";
  return CATEGORY_WORDS.find(({ words }) => words.some((word) => haystack.includes(word)))?.id ?? null;
}

function eventScore(event: BurningManEvent, category: BrcEventCategory, startMs: number, nowMs: number): number {
  const haystack = `${event.title} ${event.description ?? ""} ${event.print_description ?? ""} ${event.event_type?.label ?? ""}`.toLowerCase();
  const keywords = CATEGORY_WORDS.find((entry) => entry.id === category)?.words ?? [];
  const keywordScore = keywords.reduce((score, word) => score + (haystack.includes(word) ? 8 : 0), 0);
  const categoryScore = event.event_type?.label ? 12 : 0;
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

function apiRecords<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

/** Select and geocode several strong official events beginning within two hours. */
export async function fetchBrcEventDots(
  apiFetch: BrcApiFetch,
  now = new Date(),
): Promise<BrcEventScan> {
  const diagnostics: BrcEventDiagnostic[] = [];
  const [eventPayload, campPayload] = await Promise.all([apiFetch("event"), apiFetch("camp")]);
  const events = apiRecords<BurningManEvent>(eventPayload, ["events", "event", "data"]);
  const camps = apiRecords<BurningManCamp>(campPayload, ["camps", "camp", "data"]);
  const campsByUid = new Map(camps.flatMap((camp) => camp.uid ? [[camp.uid, camp] as const] : []));
  const nowMs = now.getTime();
  const occurrences = events.flatMap((event) => (event.occurrence_set ?? []).map((occurrence) => {
    const startMs = Date.parse(occurrence.start_time);
    const category = brcEventCategory(event);
    return { event, occurrence, startMs, category };
  })).filter(({ event, startMs }) => Boolean(event.hosted_by_camp) && Number.isFinite(startMs));
  let upcoming = occurrences.filter(({ startMs }) =>
    startMs >= nowMs - 20 * 60_000 && startMs <= nowMs + 2 * 60 * 60_000,
  );
  let windowMode: BrcEventScan["windowMode"] = "live";
  if (upcoming.length === 0) {
    // Before gates open (or between schedule blocks), keep the map useful by
    // previewing the first 24 hours of the next scheduled activity.
    const nextStart = occurrences
      .filter(({ startMs }) => startMs > nowMs)
      .sort((a, b) => a.startMs - b.startMs)[0]?.startMs;
    if (nextStart !== undefined) {
      upcoming = occurrences.filter(({ startMs }) => startMs >= nextStart && startMs < nextStart + 24 * 60 * 60_000);
      windowMode = "next-scheduled";
    }
  }
  const candidates = upcoming.filter((candidate): candidate is typeof candidate & { category: BrcEventCategory } =>
    candidate.category !== null,
  ).sort((a, b) => eventScore(b.event, b.category, b.startMs, nowMs) - eventScore(a.event, a.category, a.startMs, nowMs));
  const categoryGroups = new Map(BRC_EVENT_CATEGORIES.map(({ id }) => [
    id,
    candidates.filter((candidate) => candidate.category === id),
  ]));
  const priorityCandidates = Array.from({ length: 4 }, (_, rank) =>
    BRC_EVENT_CATEGORIES.map(({ id }) => categoryGroups.get(id)?.[rank]).filter((candidate) => candidate !== undefined),
  ).flat();
  const prioritized = new Set(priorityCandidates);
  const diversifiedCandidates = [...priorityCandidates, ...candidates.filter((candidate) => !prioritized.has(candidate))];

  diagnostics.push({
    level: "info",
    summary: `Loaded ${events.length} official events and ${camps.length} camps`,
    details: {
      events: events.length,
      camps: camps.length,
      upcoming: upcoming.length,
      cool: candidates.length,
      windowMode,
      windowStart: upcoming[0]?.occurrence.start_time ?? null,
    },
  });

  const dots: BrcEventDot[] = [];
  const categoryCounts = new Map<BrcEventCategory, number>();
  let missingCamp = 0;
  let unparseableAddress = 0;
  for (const candidate of diversifiedCandidates) {
    if ((categoryCounts.get(candidate.category) ?? 0) >= 6) continue;
    const camp = campsByUid.get(candidate.event.hosted_by_camp!);
    if (!camp) {
      missingCamp += 1;
      continue;
    }
    const point = brcAddressToMapPoint(camp);
    if (!point) {
      unparseableAddress += 1;
      continue;
    }
    const categoryMeta = BRC_EVENT_CATEGORIES.find((entry) => entry.id === candidate.category)!;
    const dot: BrcEventDot = {
      id: `${candidate.event.uid ?? candidate.event.title}:${candidate.occurrence.start_time}`,
      title: candidate.event.title,
      camp: camp.name,
      location: camp.location_string ?? `${camp.location?.intersection ?? ""} & ${camp.location?.frontage ?? ""}`,
      startsAt: candidate.occurrence.start_time,
      endsAt: candidate.occurrence.end_time,
      category: candidate.category,
      categoryLabel: categoryMeta.label,
      sourceType: candidate.event.event_type?.label ?? candidate.event.event_type?.abbr ?? "Unspecified",
      description: candidate.event.print_description || candidate.event.description || "",
      score: Math.round(eventScore(candidate.event, candidate.category, candidate.startMs, nowMs)),
      ...point,
    };
    dots.push(dot);
    categoryCounts.set(dot.category, (categoryCounts.get(dot.category) ?? 0) + 1);
    diagnostics.push({
      level: "info",
      summary: `${dot.categoryLabel}: ${dot.title}`,
      details: {
        camp: dot.camp,
        location: dot.location,
        startsAt: dot.startsAt,
        endsAt: dot.endsAt,
        officialType: dot.sourceType,
        category: dot.category,
        score: dot.score,
        x: Number(dot.x.toFixed(4)),
        y: Number(dot.y.toFixed(4)),
        description: dot.description,
      },
    });
    if (dots.length >= 24) break;
  }
  if (missingCamp || unparseableAddress) {
    diagnostics.push({
      level: "warn",
      summary: "Some upcoming events could not be placed on the street map",
      details: { missingCamp, unparseableAddress },
    });
  }
  return {
    dots,
    diagnostics,
    eventCount: events.length,
    upcomingCount: upcoming.length,
    coolCount: candidates.length,
    windowMode,
  };
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
  environment: HTMLImageElement,
  logo: HTMLImageElement,
  size: number,
  elapsedMs: number,
): void {
  const t = elapsedMs / 1000;
  const scratch = scratchFor(ctx, size);
  scratch.ctx.clearRect(0, 0, size, size);
  drawSquare(scratch.ctx, logo, size, 0.67 + Math.sin(t * 0.10) * 0.0025);
  // The vector reconstruction uses white as a deliberate keyline, unlike the
  // checkerboard-backed source PNG, so preserve it here.
  illuminateLogo(scratch.ctx, size, elapsedMs, false, false);

  // A narrow specular band crosses the exact vector artwork without moving
  // or deforming its silhouette. The pass takes almost a minute, so it reads
  // as changing light in a physical sculpture rather than an effect preset.
  scratch.ctx.save();
  scratch.ctx.globalCompositeOperation = "source-atop";
  scratch.ctx.translate(size / 2, size / 2);
  scratch.ctx.rotate(-0.34);
  scratch.ctx.translate(-size / 2, -size / 2);
  const sweepX = (((t / 52) % 1) * 1.7 - 0.35) * size;
  const sweep = scratch.ctx.createLinearGradient(sweepX - size * 0.16, 0, sweepX + size * 0.16, 0);
  sweep.addColorStop(0, "rgba(38,224,255,0)");
  sweep.addColorStop(0.42, "rgba(38,224,255,.18)");
  sweep.addColorStop(0.5, "rgba(255,255,255,.82)");
  sweep.addColorStop(0.58, "rgba(255,63,195,.18)");
  sweep.addColorStop(1, "rgba(255,63,195,0)");
  scratch.ctx.fillStyle = sweep;
  scratch.ctx.fillRect(0, 0, size, size);
  scratch.ctx.restore();

  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = "#010108";
  ctx.fillRect(0, 0, size, size);
  const center = size / 2;

  // The glass architecture is an AI-assisted source plate; its camera is kept
  // almost completely locked. Two minute-scale planes create the dimensional
  // motion that video generators do well, while the exact logo remains native.
  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(Math.sin(t * 0.014) * 0.008);
  ctx.translate(-center, -center);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.22;
  ctx.filter = `blur(${Math.max(2, size * 0.018).toFixed(1)}px) saturate(1.2)`;
  drawSquare(ctx, environment, size, 1.015 + Math.sin(t * 0.04) * 0.004);
  ctx.restore();
  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(Math.sin(t * 0.012) * -0.0045);
  ctx.translate(-center, -center);
  ctx.globalAlpha = 0.84;
  ctx.filter = "contrast(1.08) saturate(1.06)";
  drawSquare(ctx, environment, size, 0.955 + Math.sin(t * 0.038) * 0.0025);
  ctx.restore();

  // Deep, counter-moving caustics give the mark architectural depth while
  // staying subordinate to its exact geometry.
  const field = ctx.createRadialGradient(center, center, size * 0.05, center, center, size * 0.52);
  field.addColorStop(0, "rgba(4,7,20,.08)");
  field.addColorStop(0.43, "rgba(12,41,72,.26)");
  field.addColorStop(0.72, "rgba(45,10,62,.18)");
  field.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(center, center);
  ctx.globalCompositeOperation = "screen";
  ctx.lineCap = "round";
  for (let ring = 0; ring < 5; ring += 1) {
    const radius = size * (0.18 + ring * 0.072 + Math.sin(t * 0.045 + ring) * 0.004);
    const start = t * (ring % 2 === 0 ? 0.012 : -0.009) + ring * 1.1;
    ctx.strokeStyle = ring % 2 === 0 ? "rgba(46,220,255,.10)" : "rgba(255,63,195,.075)";
    ctx.lineWidth = Math.max(0.7, size * 0.004);
    ctx.setLineDash([size * 0.045, size * 0.10]);
    ctx.lineDashOffset = -t * (0.16 + ring * 0.025);
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, start + Math.PI * 1.55);
    ctx.stroke();
  }
  ctx.restore();

  // Slow optical echoes add depth without bending the vector mark.
  for (let echo = 1; echo <= 3; echo += 1) {
    const phase = (t * 0.018 + echo * 0.29) % 1;
    const scale = 1 + phase * 0.055;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(scale, scale);
    ctx.translate(-size / 2, -size / 2);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = (1 - phase) * (echo === 1 ? 0.14 : 0.07);
    ctx.filter = `blur(${Math.max(0.8, size / 150).toFixed(1)}px)`;
    ctx.drawImage(scratch.canvas, 0, 0);
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 1;
  ctx.drawImage(scratch.canvas, 0, 0);
  ctx.restore();
}

function drawAxisMundiPortal(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  size: number,
  elapsedMs: number,
): void {
  const t = elapsedMs / 1000;
  const breath = Math.sin(t * 0.055);
  const driftX = Math.sin(t * 0.021) * size * 0.0035;
  const driftY = Math.cos(t * 0.018) * size * 0.0025;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);

  // A diffused rear plane supplies depth; the sharp source plate itself stays
  // steady, following the stable-source guidance used by modern video models.
  ctx.save();
  ctx.translate(driftX * -1.8, driftY * -1.8);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.18 + breath * 0.025;
  ctx.filter = `blur(${Math.max(3, size * 0.025).toFixed(1)}px) saturate(1.25)`;
  drawSquare(ctx, image, size, 1.025 + breath * 0.006);
  ctx.restore();

  ctx.save();
  ctx.translate(driftX, driftY);
  ctx.globalAlpha = 0.98;
  ctx.filter = "contrast(1.08) saturate(1.08)";
  drawSquare(ctx, image, size, 0.95 + breath * 0.0025);
  ctx.restore();

  // Sparse sap-light motes orbit on minute-scale cycles. Cyan remains in the
  // canopy and amber in the roots so the generated plate's hierarchy survives.
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let mote = 0; mote < 22; mote += 1) {
    const seed = mote * 2.399963;
    const angle = seed + t * (0.008 + (mote % 5) * 0.0012);
    const radius = size * (0.255 + ((mote * 29) % 15) * 0.011);
    const x = size / 2 + Math.cos(angle) * radius;
    const y = size / 2 + Math.sin(angle) * radius;
    const upper = y < size / 2;
    const alpha = 0.12 + (mote % 4) * 0.035;
    ctx.fillStyle = upper ? `rgba(76,222,255,${alpha})` : `rgba(255,175,55,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.55, size * (0.002 + (mote % 3) * 0.0008)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Protect the portal as a true black void after every glow pass.
  const portalRadius = size * 0.155;
  const voidGradient = ctx.createRadialGradient(size / 2, size / 2, portalRadius * 0.72, size / 2, size / 2, portalRadius * 1.13);
  voidGradient.addColorStop(0, "rgba(0,0,0,1)");
  voidGradient.addColorStop(0.78, "rgba(0,0,0,.98)");
  voidGradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = voidGradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, portalRadius * 1.13, 0, Math.PI * 2);
  ctx.fill();
}

function drawEventDots(
  ctx: CanvasRenderingContext2D,
  size: number,
  elapsedMs: number,
  events: readonly BrcEventDot[],
): void {
  const t = elapsedMs / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  events.forEach((event, index) => {
    // Co-located events get a deterministic sub-pixel fan so their colors remain
    // visible instead of painting over one another at 128x128 transport size.
    const angle = index * 2.399963;
    const offset = (index % 3) * Math.max(0.35, size * 0.0018);
    const x = event.x * size + Math.cos(angle) * offset;
    const y = event.y * size + Math.sin(angle) * offset;
    const pulse = 0.92 + Math.sin(t * 2.2 + index * 0.83) * 0.08;
    const radius = Math.max(1.35, size * 0.0085) * pulse;
    const color = BRC_EVENT_CATEGORIES.find((entry) => entry.id === event.category)?.color ?? "#ffffff";

    ctx.globalAlpha = 0.24;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(1,4,10,.95)";
    ctx.lineWidth = Math.max(0.65, size * 0.0035);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function drawBrcMap(
  ctx: CanvasRenderingContext2D,
  _map: HTMLImageElement,
  size: number,
  elapsedMs: number,
  events: readonly BrcEventDot[],
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
  const roadWidth = Math.max(1.05, size * 0.0068);
  const outlineWidth = roadWidth + Math.max(1.05, size * 0.006);
  const breathe = 0.965 + Math.sin(t * 0.08) * 0.035;

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
  const cityGradient = ctx.createLinearGradient(0, cy - outerRadius, 0, cy + outerRadius);
  cityGradient.addColorStop(0, "rgba(13,47,92,.92)");
  cityGradient.addColorStop(0.48, "rgba(10,84,137,.90)");
  cityGradient.addColorStop(1, "rgba(7,44,83,.94)");
  ctx.strokeStyle = cityGradient;
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

  // Entheos is a compact survey light at 9:15 & Esplanade. Its inside edge is
  // tangent to Esplanade, matching the physical camp frontage without hiding
  // the adjacent streets.
  const entheosAngle = ((9.25 * 30 - 450) * Math.PI) / 180;
  const entheosRadius = STREET_RADII.esplanade * size;
  const markerRadius = Math.max(1.8, size * 0.0105);
  const markerDistance = entheosRadius + markerRadius;
  const ex = cx + Math.cos(entheosAngle) * markerDistance;
  const ey = cy + Math.sin(entheosAngle) * markerDistance;
  const markerGlow = ctx.createRadialGradient(ex, ey, 0, ex, ey, markerRadius * 3.2);
  markerGlow.addColorStop(0, "rgba(255,255,225,1)");
  markerGlow.addColorStop(0.32, "rgba(255,64,164,.82)");
  markerGlow.addColorStop(1, "rgba(255,20,130,0)");
  ctx.fillStyle = markerGlow;
  ctx.beginPath();
  ctx.arc(ex, ey, markerRadius * 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fffbdc";
  ctx.beginPath();
  ctx.arc(ex, ey, markerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawEventDots(ctx, size, elapsedMs, events);
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
  events: readonly BrcEventDot[],
): void {
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

  // Entheos: the same compact survey light used by the night map. The inner
  // edge touches Esplanade and does not obscure the literal street geometry.
  const entheosAngle = ((9.25 * 30 - 450) * Math.PI) / 180;
  const markerRadius = Math.max(1.8, size * 0.0105);
  const markerDistance = innerRadius + markerRadius;
  const ex = cx + Math.cos(entheosAngle) * markerDistance;
  const ey = cy + Math.sin(entheosAngle) * markerDistance;
  const markerGlow = ctx.createRadialGradient(ex, ey, 0, ex, ey, markerRadius * 3.2);
  markerGlow.addColorStop(0, "rgba(255,255,225,1)");
  markerGlow.addColorStop(0.32, "rgba(255,64,164,.82)");
  markerGlow.addColorStop(1, "rgba(255,20,130,0)");
  ctx.fillStyle = markerGlow;
  ctx.beginPath();
  ctx.arc(ex, ey, markerRadius * 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fffbdc";
  ctx.beginPath();
  ctx.arc(ex, ey, markerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawEventDots(ctx, size, elapsedMs, events);
}

export function drawAmbientScene(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement,
  overlay: HTMLImageElement | null,
  size: number,
  elapsedMs: number,
  kind: AmbientSceneKind,
  events: readonly BrcEventDot[] = [],
): void {
  if (kind === "entheos-prism") drawEntheosPrism(ctx, source, size, elapsedMs);
  else if (kind === "entheos-aura" && overlay?.complete && overlay.naturalWidth > 0) {
    drawEntheosAura(ctx, source, overlay, size, elapsedMs);
  }
  else if (kind === "entheos-sigil") {
    drawEntheosSigil(
      ctx,
      source,
      overlay?.complete && overlay.naturalWidth > 0 ? overlay : source,
      size,
      elapsedMs,
    );
  }
  else if (kind === "brc-map") drawBrcMap(ctx, source, size, elapsedMs, events);
  else if (kind === "brc-plan") drawBrcPlan(ctx, source, size, elapsedMs, events);
  else if (kind === "axis-mundi-portal") drawAxisMundiPortal(ctx, source, size, elapsedMs);
}
