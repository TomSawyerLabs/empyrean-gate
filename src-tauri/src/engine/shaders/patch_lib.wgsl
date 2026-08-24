// Runtime library for GENERATED patch shaders (see patch/codegen.rs).
//
// The Rust codegen appends per-node functions and a `main` entry point to this
// prelude. Bindings mirror gate.wgsl's layout (the engine shares one bind group
// across both pipelines); binding 2 (the layer stack) is deliberately absent —
// patches replace it — and binding 8 is the patch parameter slab, written by
// the CPU control-rate evaluator every frame.
//
// Generated code references ONLY mangled names (`n<i>_f`) and `P[<slot>]`;
// user strings never reach WGSL (reserved-word/injection safety).

struct Globals {
    spokes: u32,
    pixels: u32,
    layer_count: u32,
    effect_count: u32,
    time: f32,
    dt: f32,
    master: f32,
    inner_over_outer: f32,
    tilt_x: f32,
    tilt_y: f32,
    shake: f32,
    yaw: f32,
    dab_count: u32,
    video_width: u32,
    video_height: u32,
    video_active: u32,
}

struct AudioU {
    level: f32,
    bass: f32,
    mid: f32,
    treble: f32,
    onset: f32,
    beat_phase: f32,
    bpm: f32,
    _pad: f32,
    bass_att: f32,
    mid_att: f32,
    treble_att: f32,
    _pad2: f32,
}

struct Effect {
    kind: u32,
    size: f32,
    age: f32,
    duration: f32,
    angle: f32,
    radius: f32,
    intensity: f32,
    hue: f32,
}

struct Dab {
    kind: u32,
    age: f32,
    angle: f32,
    radius: f32,
    hue: f32,
    size: f32,
    intensity: f32,
    dir: f32,
}

@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var<uniform> AUDIO: array<AudioU, 4>;
@group(0) @binding(3) var<storage, read> FX: array<Effect>;
@group(0) @binding(4) var<storage, read_write> OUT: array<u32>;
@group(0) @binding(5) var<storage, read> DABS: array<Dab>;
@group(0) @binding(6) var<storage, read> SCOPE: array<f32>;
@group(0) @binding(7) var<storage, read> VIDEO: array<u32>;
/// Patch parameter slab: one f32 per (node, param) slot, laid out by codegen.
@group(0) @binding(8) var<storage, read> P: array<f32>;

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;

const WAVE_N: u32 = 256u;
const SPEC_N: u32 = 64u;
const SCOPE_STRIDE: u32 = WAVE_N + SPEC_N;

fn wave_at(src: u32, t: f32) -> f32 {
    let i = u32(fract(t) * f32(WAVE_N)) % WAVE_N;
    return SCOPE[src * SCOPE_STRIDE + i];
}

fn spec_at(src: u32, i: u32) -> f32 {
    return SCOPE[src * SCOPE_STRIDE + WAVE_N + min(i, SPEC_N - 1u)];
}

fn video_texel(x: u32, y: u32) -> vec4f {
    let ix = min(x, G.video_width - 1u);
    let iy = min(y, G.video_height - 1u);
    return unpack4x8unorm(VIDEO[iy * G.video_width + ix]);
}

fn video_at(uv: vec2f) -> vec4f {
    if G.video_active == 0u || G.video_width == 0u || G.video_height == 0u
        || any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) {
        return vec4f(0.0);
    }
    let p = uv * vec2f(f32(G.video_width - 1u), f32(G.video_height - 1u));
    let p0 = vec2u(floor(p));
    let p1 = min(p0 + vec2u(1u), vec2u(G.video_width - 1u, G.video_height - 1u));
    let f = fract(p);
    let a = mix(video_texel(p0.x, p0.y), video_texel(p1.x, p0.y), f.x);
    let b = mix(video_texel(p0.x, p1.y), video_texel(p1.x, p1.y), f.x);
    return mix(a, b, f.y);
}

// ---------------------------------------------------------------------------
// Simplex noise (3D) — Ashima Arts / Stefan Gustavson (same port as gate.wgsl).
// ---------------------------------------------------------------------------

fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289v4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute4(x: vec4f) -> vec4f { return mod289v4(((x * 34.0) + 1.0) * x); }
fn taylor_inv_sqrt4(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }

fn snoise3(v: vec3f) -> f32 {
    let C = vec2f(1.0 / 6.0, 1.0 / 3.0);
    let D = vec4f(0.0, 0.5, 1.0, 2.0);

    var i = floor(v + dot(v, C.yyy));
    let x0 = v - i + dot(i, C.xxx);

    let g = step(x0.yzx, x0.xyz);
    let l = 1.0 - g;
    let i1 = min(g.xyz, l.zxy);
    let i2 = max(g.xyz, l.zxy);

    let x1 = x0 - i1 + C.xxx;
    let x2 = x0 - i2 + C.yyy;
    let x3 = x0 - D.yyy;

    i = mod289v3(i);
    let p = permute4(permute4(permute4(
        i.z + vec4f(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4f(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4f(0.0, i1.x, i2.x, 1.0));

    let n_ = 0.142857142857;
    let ns = n_ * D.wyz - D.xzx;

    let j = p - 49.0 * floor(p * ns.z * ns.z);

    let x_ = floor(j * ns.z);
    let y_ = floor(j - 7.0 * x_);

    let x = x_ * ns.x + ns.yyyy;
    let y = y_ * ns.x + ns.yyyy;
    let h = 1.0 - abs(x) - abs(y);

    let b0 = vec4f(x.xy, y.xy);
    let b1 = vec4f(x.zw, y.zw);

    let s0 = floor(b0) * 2.0 + 1.0;
    let s1 = floor(b1) * 2.0 + 1.0;
    let sh = -step(h, vec4f(0.0));

    let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    let a1 = b1.xzyw + s1.xzyw * sh.zzww;

    var p0 = vec3f(a0.xy, h.x);
    var p1 = vec3f(a0.zw, h.y);
    var p2 = vec3f(a1.xy, h.z);
    var p3 = vec3f(a1.zw, h.w);

    let norm = taylor_inv_sqrt4(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 = p0 * norm.x;
    p1 = p1 * norm.y;
    p2 = p2 * norm.z;
    p3 = p3 * norm.w;

    var m = max(0.6 - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4f(0.0));
    m = m * m;
    return 42.0 * dot(m * m, vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

fn fbm3(p: vec3f, octaves: u32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var q = p;
    for (var o = 0u; o < octaves; o++) {
        value += amplitude * snoise3(q);
        q = q * 2.02;
        amplitude *= 0.5;
    }
    return value;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3f {
    let hh = fract(h) * 6.0;
    let c = v * s;
    let x = c * (1.0 - abs(fract(hh * 0.5) * 2.0 - 1.0) * 1.0);
    var rgb: vec3f;
    let i = u32(hh) % 6u;
    switch i {
        case 0u: { rgb = vec3f(c, x, 0.0); }
        case 1u: { rgb = vec3f(x, c, 0.0); }
        case 2u: { rgb = vec3f(0.0, c, x); }
        case 3u: { rgb = vec3f(0.0, x, c); }
        case 4u: { rgb = vec3f(x, 0.0, c); }
        default: { rgb = vec3f(c, 0.0, x); }
    }
    return rgb + vec3f(v - c);
}

fn wang_hash(seed: u32) -> u32 {
    var s = seed;
    s = (s ^ 61u) ^ (s >> 16u);
    s = s * 9u;
    s = s ^ (s >> 4u);
    s = s * 0x27d4eb2du;
    s = s ^ (s >> 15u);
    return s;
}

fn hash01(seed: u32) -> f32 {
    return f32(wang_hash(seed)) / 4294967295.0;
}

fn ang_dist(a: f32, b: f32) -> f32 {
    let d = (a - b) % TAU;
    return abs(((d + 3.0 * PI) % TAU) - PI);
}

// ---------------------------------------------------------------------------
// Per-pixel context — identical meaning to gate.wgsl's Ctx.
// ---------------------------------------------------------------------------

struct Ctx {
    spoke: u32,
    i: u32,
    theta: f32,   // spoke angle, radians
    r01: f32,     // 0 = OUTER end of spoke, 1 = inner end (string order)
    rn: f32,      // radius normalized: inner/outer .. 1.0 (1 = outer edge)
    pos: vec2f,   // cartesian, outer edge at |pos| = 1
}

/// Domain transform for the Transform node: rotate (radians), zoom, N-way
/// kaleidoscope fold, and left/right mirror — applied to the sampling context
/// so ANY upstream field is transformed, not just video.
fn ctx_transform(c0: Ctx, rot: f32, zoom: f32, kaleido: f32, mirror: f32) -> Ctx {
    var a = c0.theta - rot;
    let seg = u32(clamp(kaleido, 0.0, 10.0) + 0.5);
    if seg >= 2u {
        let sector = TAU / f32(seg);
        a = ((a % sector) + sector) % sector;
        a = sector * 0.5 - abs(a - sector * 0.5);
    }
    if mirror > 0.5 {
        a = ((a % TAU) + TAU) % TAU;
        a = PI - abs(PI - a);
    }
    var c = c0;
    c.theta = a;
    let z = max(zoom, 0.05);
    c.rn = c0.rn / z;
    c.r01 = clamp((1.0 - c.rn) / max(1.0 - G.inner_over_outer, 0.001), 0.0, 1.0);
    c.pos = c.rn * vec2f(cos(a), sin(a));
    return c;
}

/// Grayscale adapter: Field<f32> flowing into a Field<color> input.
fn gray(v: f32) -> vec4f {
    return vec4f(vec3f(v), clamp(v, 0.0, 1.0));
}

/// Blend an (rgb, alpha) field over an accumulator — same modes as the stack.
fn apply_blend(acc: vec3f, c: vec4f, opacity: f32, mode: u32) -> vec3f {
    let op = clamp(opacity, 0.0, 1.0);
    let a = clamp(c.a * op, 0.0, 1.0);
    let rgb = c.rgb * op;
    switch mode {
        case 0u: { return acc + rgb; }                                    // Add
        case 1u: { return acc * mix(vec3f(1.0), c.rgb, op); }             // Multiply
        case 2u: { return 1.0 - (1.0 - acc) * (1.0 - clamp(rgb, vec3f(0.0), vec3f(1.0))); } // Screen
        case 3u: { return mix(acc, c.rgb, a); }                           // AlphaOver
        case 4u: { return max(acc, rgb); }                                // Max
        default: { return acc; }
    }
}

// ---------------------------------------------------------------------------
// Triggered effects + live-draw dabs: verbatim from gate.wgsl so both stay
// live while a patch renders (effect pads and drawing keep working).
// ---------------------------------------------------------------------------

fn effect_color(E: Effect, ctx: Ctx) -> vec3f {
    let t = clamp(E.age / max(E.duration, 0.001), 0.0, 1.0);
    let fade = (1.0 - t) * (1.0 - t);
    var col: vec3f;
    if E.hue < 0.0 {
        col = vec3f(1.0);
    } else {
        col = hsv2rgb(E.hue, 0.85, 1.0);
    }

    switch E.kind {
        case 0u: {
            let origin = E.radius * vec2f(cos(E.angle), sin(E.angle));
            let d = distance(ctx.pos, origin);
            let front = t * 2.2;
            let width = (0.06 + t * 0.12) * E.size;
            let ring = exp(-((d - front) * (d - front)) / (width * width));
            return col * ring * fade * E.intensity * 2.0;
        }
        case 1u: {
            return col * fade * E.intensity;
        }
        case 2u: {
            let sweep = E.angle + t * TAU;
            let d = ang_dist(ctx.theta, sweep);
            let width = 0.25;
            let v = exp(-(d * d) / (width * width));
            return col * v * fade * E.intensity * 1.5;
        }
        case 3u: {
            let front = 1.0 - t * 1.1;
            let d = abs(ctx.rn - front);
            let v = exp(-(d * d) / 0.003);
            return col * v * fade * E.intensity * 1.8;
        }
        default: {
            return vec3f(0.0);
        }
    }
}

fn dab_color(D: Dab, ctx: Ctx, dab_index: u32) -> vec3f {
    let fade = (1.0 - D.age) * (1.0 - D.age);
    let origin = D.radius * vec2f(cos(D.angle), sin(D.angle));
    let d = distance(ctx.pos, origin);
    var col: vec3f;
    if D.hue < 0.0 {
        col = vec3f(1.0);
    } else {
        col = hsv2rgb(D.hue, 0.85, 1.0);
    }

    switch D.kind {
        case 0u: {
            let s = D.size * (1.0 + D.age * 0.5);
            let v = exp(-(d * d) / (s * s * 0.5));
            return col * v * fade * D.intensity;
        }
        case 1u: {
            let front = D.age * D.size * 4.0;
            let w = D.size * 0.25 + 0.01;
            let v = exp(-((d - front) * (d - front)) / (w * w));
            return col * v * fade * D.intensity * 1.2;
        }
        case 2u: {
            let s = D.size * 1.5;
            let inside = exp(-(d * d) / (s * s * 0.5));
            let idx = ctx.spoke * G.pixels + ctx.i;
            let cell = u32(D.age * 24.0);
            let rnd = hash01(idx * 2654435761u + dab_index * 97u + cell * 40503u);
            let lit = step(0.86, rnd);
            return col * inside * lit * fade * D.intensity * 1.6;
        }
        case 3u: {
            let dirv = vec2f(cos(D.dir), sin(D.dir));
            let off = ctx.pos - origin;
            let along = dot(off, dirv);
            let across = off.x * dirv.y - off.y * dirv.x;
            let w = D.size * 0.35 + 0.01;
            let tail = D.size * 3.0;
            let head = select(exp(along / tail * 6.0), exp(-along / (w * 2.0)), along > 0.0);
            let v = exp(-(across * across) / (w * w)) * head;
            return col * v * fade * D.intensity * 1.6;
        }
        case 4u: {
            let w = D.size * 0.3 + 0.01;
            let v = exp(-((ctx.rn - D.radius) * (ctx.rn - D.radius)) / (w * w));
            return col * v * fade * D.intensity;
        }
        case 5u: {
            let a = ang_dist(ctx.theta, D.angle);
            let w = D.size * 0.6 + 0.02;
            let v = exp(-(a * a) / (w * w));
            return col * v * fade * D.intensity * 1.4;
        }
        case 6u: {
            let drift = D.radius * (1.0 - D.age * 0.5);
            let center = drift * vec2f(cos(D.angle), sin(D.angle));
            let dd = distance(ctx.pos, center);
            let s = D.size * 1.2;
            let inside = exp(-(dd * dd) / (s * s * 0.5));
            let idx = ctx.spoke * G.pixels + ctx.i;
            let cell = u32(D.age * 14.0);
            let rnd = hash01(idx * 2654435761u + dab_index * 131u + cell * 40503u);
            let lit = step(0.8, rnd);
            return col * inside * lit * fade * D.intensity * 1.5;
        }
        default: {
            return vec3f(0.0);
        }
    }
}

/// Shared epilogue: effects + dabs composite, master, soft-clip, pack.
/// An explicitly wired stream renderer takes ownership of that stream and
/// disables its automatic pass here, avoiding double rendering.
fn finish(ctx: Ctx, idx: u32, patch_rgb: vec3f, auto_effects: bool, auto_dabs: bool) {
    var acc = patch_rgb;

    if auto_effects {
        for (var e = 0u; e < G.effect_count; e++) {
            acc += effect_color(FX[e], ctx);
        }
    }
    if auto_dabs {
        for (var d = 0u; d < G.dab_count; d++) {
            acc += dab_color(DABS[d], ctx, d);
        }
    }

    acc = acc * G.master;

    let knee = vec3f(0.8);
    let over = max(acc - knee, vec3f(0.0));
    acc = min(acc, knee) + over / (1.0 + over * 2.5);
    acc = clamp(acc, vec3f(0.0), vec3f(1.0));

    let r = u32(acc.r * 255.0 + 0.5);
    let g = u32(acc.g * 255.0 + 0.5);
    let b = u32(acc.b * 255.0 + 0.5);
    OUT[idx] = r | (g << 8u) | (b << 16u);
}
