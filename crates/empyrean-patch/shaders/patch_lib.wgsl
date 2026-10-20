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
    transition_split: u32,
    transition_active: u32,
    transition_progress: f32,
    video_mix: f32,
    dj_link_visual_active: u32,
    dj_fade_position: f32,
    dj_fade_activity: f32,
    dj_looping: f32,
    game_active: u32,
    game_mix: f32,
    game_theta: u32,
    game_rings: u32,
    game_alpha: f32,
    game_beat: f32,
    _pad_game0: f32,
    _pad_game1: f32,
    rotation: f32,
    // Master hue pull ("warm colors now"): target hue in turns, strength
    // 0..1 (0 = off), and the loose-mask amount 0..1. See hue_pull().
    hue_target: f32,
    hue_amount: f32,
    hue_loose: f32,
    // Live records in TOUCH (binding 10); the pads keep the uniform a
    // multiple of 16 bytes.
    touch_count: u32,
    image_mask: u32,  // bit k: media cell k holds a Still image (patch only)
    _pad_touch1: u32,
    _pad_touch2: u32,
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
    kind: u32,      // effect kind index (burst, strobe, swoosh, …: EffectKind::ALL order)
    size: f32,      // size multiplier, 1 = as triggered
    age: f32,       // seconds since it was triggered
    duration: f32,  // seconds it lives (0 = the kind's default)
    angle: f32,     // where it was placed, radians
    radius: f32,    // where it was placed, 0 centre .. 1 outer edge
    intensity: f32, // brightness multiplier
    hue: f32,       // hue in turns; below 0 = white
    saturation: f32,
    brightness: f32,
    rotation: f32,  // radians, for the shapes
    grow: f32,      // -1..1: shrinks or grows over its life
    edge: f32,      // 0..1 edge softness of the shapes
    fill: f32,      // 0..1 how filled the shapes are
    source: u32,    // 0 = a client; else the emitting patch node (see abi.rs)
}

struct Dab {
    kind: u32,      // pen kind index (glow, comet, …: PenKind order)
    age: f32,       // seconds since it was drawn
    angle: f32,     // where it was drawn, radians
    radius: f32,    // where it was drawn, 0 centre .. 1 outer edge
    hue: f32,       // hue in turns; below 0 = white
    size: f32,      // 0..1 of the array's radius
    intensity: f32, // brightness multiplier
    dir: f32,       // stroke direction, radians
    saturation: f32,
    brightness: f32,
    _pad0: f32,
    _pad1: f32,
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

/// One finger (see crate::touch / abi::GpuTouch). Composition frame.
struct Touch {
    angle: f32,
    radius: f32,
    age: f32,       // seconds since touchdown
    released: f32,  // seconds since release; negative while held
    hue: f32,       // < 0 = white
    saturation: f32,
    brightness: f32,
    speed: f32,     // array radii per second
    dir: f32,       // motion direction, composition cartesian
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

/// Raw touches, for the Touch mask / Touch glow nodes (`G.touch_count` live).
/// A uniform, not storage: the shared bind group already uses the 8 storage
/// buffers per stage that wgpu and WebGPU allow by default. Binding 9 is the
/// layer stack's game grid, unused here. 32 = crate::touch::MAX_TOUCHES.
@group(0) @binding(10) var<uniform> TOUCH: array<Touch, 32>;

/// Textures the patch renders itself (abi::GRID_*): regions of up to
/// GRID_SIZE² cells of RGBA, written by the grid passes
/// that run before `main` and read by `grid_at`. Only patches with a grid
/// node use it (the gate binds it in the patch pipeline's own layout).
@group(0) @binding(11) var<storage, read_write> GRID: array<vec4f>;

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;

const WAVE_N: u32 = 256u;
const SPEC_N: u32 = 64u;
const SCOPE_STRIDE: u32 = WAVE_N + SPEC_N;

/// The audio waveform of source `src` (0..3) at `t` turns around its ring of 256 samples, -1..1.
fn wave_at(src: u32, t: f32) -> f32 {
    let i = u32(fract(t) * f32(WAVE_N)) % WAVE_N;
    return SCOPE[src * SCOPE_STRIDE + i];
}

/// Spectrum band `i` (0..63, low to high) of audio source `src` (0..3), 0..1.
fn spec_at(src: u32, i: u32) -> f32 {
    return SCOPE[src * SCOPE_STRIDE + WAVE_N + min(i, SPEC_N - 1u)];
}

fn video_texel(x: u32, y: u32) -> vec4f {
    let ix = min(x, G.video_width - 1u);
    let iy = min(y, G.video_height - 1u);
    return unpack4x8unorm(VIDEO[iy * G.video_width + ix]);
}

/// The live video frame at `uv` (0..1, y down), RGBA; transparent black outside it or with no video.
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

/// Simplex noise at `v` (use the third component for time), about -1..1.
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

/// Fractal noise: `octaves` layers of snoise3 at doubling frequency, about -1..1.
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

/// Hash of an integer lattice point to 0..2^32 (for gradient noise).
fn lattice_hash(i: vec3i, seed: u32) -> u32 {
    let u = bitcast<vec3u>(i);
    return wang_hash(u.x ^ wang_hash(u.y ^ wang_hash(u.z ^ wang_hash(seed))));
}

/// One of Perlin's twelve cube-edge gradients, chosen by `h`, dotted with `d`:
/// ±x±y for 0..3, ±x±z for 4..7, ±y±z for 8..11 (bit 0 negates the first
/// term, bit 1 the second). Branchless on purpose: as a twelve-case `switch`,
/// eight inlined copies kept SwiftShader (Chrome's software WebGPU) building
/// the pipeline for minutes.
fn perlin_grad(h: u32, d: vec3f) -> f32 {
    let k = h % 12u;
    let a = select(d.y, d.x, k < 8u);
    let b = select(d.z, d.y, k < 4u);
    return select(a, -a, (k & 1u) != 0u) + select(b, -b, (k & 2u) != 0u);
}

/// Classic (improved) Perlin gradient noise at `p`, about -1..1; `seed`
/// picks an independent noise. Use the third component for time.
fn perlin3(p: vec3f, seed: u32) -> f32 {
    let fl = floor(p);
    let i = vec3i(fl);
    let f = p - fl;
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let n000 = perlin_grad(lattice_hash(i, seed), f);
    let n100 = perlin_grad(lattice_hash(i + vec3i(1, 0, 0), seed), f - vec3f(1.0, 0.0, 0.0));
    let n010 = perlin_grad(lattice_hash(i + vec3i(0, 1, 0), seed), f - vec3f(0.0, 1.0, 0.0));
    let n110 = perlin_grad(lattice_hash(i + vec3i(1, 1, 0), seed), f - vec3f(1.0, 1.0, 0.0));
    let n001 = perlin_grad(lattice_hash(i + vec3i(0, 0, 1), seed), f - vec3f(0.0, 0.0, 1.0));
    let n101 = perlin_grad(lattice_hash(i + vec3i(1, 0, 1), seed), f - vec3f(1.0, 0.0, 1.0));
    let n011 = perlin_grad(lattice_hash(i + vec3i(0, 1, 1), seed), f - vec3f(0.0, 1.0, 1.0));
    let n111 = perlin_grad(lattice_hash(i + vec3i(1, 1, 1), seed), f - vec3f(1.0, 1.0, 1.0));
    let x00 = mix(n000, n100, u.x);
    let x10 = mix(n010, n110, u.x);
    let x01 = mix(n001, n101, u.x);
    let x11 = mix(n011, n111, u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

/// Fractal Perlin noise, 0..1: `harmonics` octaves (1..8) of `perlin3`,
/// each `spacing` times finer and `roughness` times weaker than the last.
/// `style` 0 sums them (smooth), 1 sums their absolute values (billowy:
/// dark creases), 2 sums (1 - |n|)² (ridged: bright ridges). Each style is
/// centred on its mean and divided by the root-sum-square of the octave
/// weights, so the spread is the same whatever the harmonics, then scaled
/// to fill 0..1 (about 2% clipped at each end for Smooth).
fn perlin_fbm(p: vec3f, harmonics: f32, roughness: f32, spacing: f32, style: u32, seed: u32) -> f32 {
    let octaves = u32(clamp(round(harmonics), 1.0, 8.0));
    var sum = 0.0;
    var norm = 0.0;
    var amp = 1.0;
    var q = p;
    for (var o = 0u; o < octaves; o++) {
        let n = perlin3(q, seed + o * 1013u);
        // Means of |n| and (1 - |n|)² for this noise, measured.
        var v = n;
        if style == 1u {
            v = abs(n) - 0.22;
        } else if style == 2u {
            let r = 1.0 - abs(n);
            v = r * r - 0.633;
        }
        sum += amp * v;
        norm += amp * amp;
        amp *= clamp(roughness, 0.0, 1.0);
        // A small turn per octave keeps the lattices from lining up.
        q = vec3f(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8, q.z) * max(spacing, 1.0);
    }
    let s = sum / sqrt(max(norm, 1e-6));
    if style == 1u {
        return clamp(0.4 + 1.6 * s, 0.0, 1.0);
    } else if style == 2u {
        return clamp(0.5 + 1.15 * s, 0.0, 1.0);
    }
    return clamp(0.5 + 0.9 * s, 0.0, 1.0);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/// Hue `h` in turns (wraps), saturation and value 0..1, to RGB.
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

/// RGB to (hue in turns, saturation, value).
fn rgb2hsv(c: vec3f) -> vec3f {
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    let d = mx - mn;
    var h = 0.0;
    if d > 0.0 {
        if mx == c.r {
            h = (c.g - c.b) / d;
        } else if mx == c.g {
            h = (c.b - c.r) / d + 2.0;
        } else {
            h = (c.r - c.g) / d + 4.0;
        }
        h = fract(h / 6.0 + 1.0);
    }
    let s = select(0.0, d / mx, mx > 0.0);
    return vec3f(h, s, mx);
}

// Master hue pull — keep in lockstep with the copy in gate.wgsl.
/// The crew's master hue pull applied to a colour (what the Output does to every pixel).
fn hue_pull(rgb: vec3f) -> vec3f {
    if G.hue_amount <= 0.0 {
        return rgb;
    }
    let hsv = rgb2hsv(rgb);
    let d = fract(hsv.x - G.hue_target + 0.5) - 0.5;
    let keep = G.hue_loose * smoothstep(0.12, 0.38, abs(d));
    let w = G.hue_amount * (1.0 - keep) * min(hsv.y * 4.0, 1.0);
    return hsv2rgb(hsv.x - d * w, hsv.y, hsv.z);
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

/// A fixed pseudo-random 0..1 for an integer seed (e.g. `led_cell(c).x`, a particle index).
fn hash01(seed: u32) -> f32 {
    return f32(wang_hash(seed)) / 4294967295.0;
}

/// The shortest angular distance between two angles in radians, 0..PI.
fn ang_dist(a: f32, b: f32) -> f32 {
    let d = (a - b) % TAU;
    return abs(((d + 3.0 * PI) % TAU) - PI);
}

/// A Still image node's picture: media cell `slot` (1..), IMAGE_SIZE² texels,
/// bilinear, transparent outside 0..1 or when the slot isn't loaded.
const IMAGE_SIZE: u32 = 256u;

fn image_texel(slot: u32, x: u32, y: u32) -> vec4f {
    let ix = min(x, IMAGE_SIZE - 1u);
    let iy = min(y, IMAGE_SIZE - 1u);
    return unpack4x8unorm(VIDEO[slot * IMAGE_SIZE * IMAGE_SIZE + iy * IMAGE_SIZE + ix]);
}

/// A Still image node's picture: media cell `slot` (1..4) at `uv` (0..1), bilinear; transparent outside or when empty.
fn image_at(slot: u32, uv: vec2f) -> vec4f {
    if (G.image_mask & (1u << slot)) == 0u || any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) {
        return vec4f(0.0);
    }
    let p = uv * f32(IMAGE_SIZE - 1u);
    let p0 = vec2u(floor(p));
    let p1 = min(p0 + vec2u(1u), vec2u(IMAGE_SIZE - 1u));
    let f = fract(p);
    let a = mix(image_texel(slot, p0.x, p0.y), image_texel(slot, p1.x, p0.y), f.x);
    let b = mix(image_texel(slot, p0.x, p1.y), image_texel(slot, p1.x, p1.y), f.x);
    return mix(a, b, f.y);
}


// Previews render node functions alone into their own buffer: nothing that
// reads the last frame may do so there. Set by the preview entry point.
var<private> PREVIEW: bool = false;

/// Which frame of a Clip to show: `phase` counts frames (fps integrated),
/// `frames` is how many cells of its sheet are in use.
fn clip_frame(phase: f32, frames: f32, mode: u32, scrub: f32) -> u32 {
    let n = i32(clamp(frames + 0.5, 1.0, 64.0));
    if mode == 2u {
        return u32(clamp(scrub, 0.0, 1.0) * f32(n - 1) + 0.5);
    }
    let k = i32(floor(clamp(phase, -1.0e6, 1.0e6)));
    if mode == 1u && n > 1 {
        let p = 2 * n - 2;
        let m = ((k % p) + p) % p;
        return u32(select(p - m, m, m < n));
    }
    return u32(((k % n) + n) % n);
}

/// Frame `frame` of the Clip in media cell `slot`, whose sheet is grid×grid
/// frames; bilinear inside the frame, transparent outside 0..1 or unloaded.
fn clip_at(slot: u32, uv: vec2f, frame: u32, grid: u32) -> vec4f {
    if (G.image_mask & (1u << slot)) == 0u || any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) {
        return vec4f(0.0);
    }
    let g = clamp(grid, 1u, 16u);
    let cell = IMAGE_SIZE / g;
    let f = frame % (g * g);
    let origin = vec2u(f % g, f / g) * cell;
    let p = uv * f32(cell - 1u);
    let p0 = vec2u(floor(p));
    let p1 = min(p0 + vec2u(1u), vec2u(cell - 1u));
    let fr = fract(p);
    let a = mix(
        image_texel(slot, origin.x + p0.x, origin.y + p0.y),
        image_texel(slot, origin.x + p1.x, origin.y + p0.y),
        fr.x,
    );
    let b = mix(
        image_texel(slot, origin.x + p0.x, origin.y + p1.y),
        image_texel(slot, origin.x + p1.x, origin.y + p1.y),
        fr.x,
    );
    return mix(a, b, fr.y);
}

/// Cosine colour ramps (after Inigo Quilez): `t` in turns, wraps.
fn cosine_palette(t: f32, which: u32) -> vec3f {
    var a = vec3f(0.5);
    var b = vec3f(0.5);
    var c = vec3f(1.0);
    var d = vec3f(0.0, 0.33, 0.67);
    switch which {
        case 1u: { a = vec3f(0.55, 0.2, 0.05); b = vec3f(0.45, 0.35, 0.15); d = vec3f(0.0, 0.15, 0.3); }
        case 2u: { a = vec3f(0.1, 0.35, 0.5); b = vec3f(0.1, 0.3, 0.4); d = vec3f(0.0, 0.1, 0.2); }
        case 3u: { c = vec3f(2.0, 1.0, 0.0); d = vec3f(0.5, 0.2, 0.25); }
        case 4u: { a = vec3f(0.8, 0.5, 0.4); b = vec3f(0.2, 0.4, 0.2); c = vec3f(2.0, 1.0, 1.0); d = vec3f(0.0, 0.25, 0.25); }
        case 5u: { d = vec3f(0.0); }
        case 6u: { d = vec3f(0.0, 0.1, 0.2); }
        case 7u: { a = vec3f(0.25, 0.4, 0.2); b = vec3f(0.25, 0.4, 0.2); d = vec3f(0.1, 0.3, 0.1); }
        default: {}
    }
    return max(a + b * cos(TAU * (c * t + d)), vec3f(0.0));
}

/// What the array showed last frame at ctx's position, 0..1 RGB. `finish`
/// keeps frame N-1 in the second half of OUT. Black in previews.
fn feedback_at(c: Ctx) -> vec3f {
    if PREVIEW {
        return vec3f(0.0);
    }
    let total = G.spokes * G.pixels;
    let led = led_cell(c);
    return unpack4x8unorm(OUT[total + led.x * G.pixels + led.y]).rgb;
}

// ---------------------------------------------------------------------------
// Per-pixel context — identical meaning to gate.wgsl's Ctx.
// ---------------------------------------------------------------------------

struct Ctx {
    spoke: u32,  // spoke index, 0..G.spokes
    i: u32,      // pixel index along the spoke, 0 at the outer end
    theta: f32,   // spoke angle, radians
    r01: f32,     // 0 = OUTER end of spoke, 1 = inner end (string order)
    rn: f32,      // radius normalized: inner/outer .. 1.0 (1 = outer edge)
    pos: vec2f,   // cartesian, outer edge at |pos| = 1
}

/// The context of the LED on physical spoke `spoke` at pixel `i` (0 = outer
/// end), exactly as the entry points build it for that LED.
fn led_ctx(spoke: u32, i: u32) -> Ctx {
    let theta = f32(spoke) / f32(G.spokes) * TAU - G.rotation;
    let r01 = f32(i) / f32(max(G.pixels - 1u, 1u));
    let rn = mix(1.0, G.inner_over_outer, r01);
    var c: Ctx;
    c.spoke = u32(fract(theta / TAU + 1.0) * f32(G.spokes)) % G.spokes;
    c.i = i;
    c.theta = theta;
    c.r01 = r01;
    c.rn = rn;
    c.pos = rn * vec2f(cos(theta), sin(theta));
    return c;
}

/// Where a position falls among the LEDs, in LED units: x is the physical
/// spoke (0..G.spokes, wrapping), y the pixel along it (0 = outer end; below
/// -0.5 or past G.pixels - 0.5 is off the ring).
fn led_coord(c: Ctx) -> vec2f {
    let s = fract((c.theta + G.rotation) / TAU + 1.0) * f32(G.spokes);
    let r01 = (1.0 - c.rn) / max(1.0 - G.inner_over_outer, 0.001);
    return vec2f(s, r01 * f32(max(G.pixels - 1u, 1u)));
}

/// The LED nearest a position, as (physical spoke, pixel), the pixel held to
/// the ring. At an LED it is that LED. Key a pattern on this rather than
/// `c.spoke` / `c.i` and it stays a plane field: Transform moves it.
fn led_cell(c: Ctx) -> vec2u {
    let p = led_coord(c);
    let spoke = u32(p.x + 0.5) % max(G.spokes, 1u);
    let i = u32(clamp(p.y + 0.5, 0.0, f32(max(G.pixels, 1u)) - 0.5));
    return vec2u(spoke, i);
}

/// The context of a point of the plane that need not be an LED (a grid
/// cell): `pos` as given, the LED fields from the LED nearest it.
fn plane_ctx(pos: vec2f) -> Ctx {
    let rn = length(pos);
    let theta = atan2(pos.y, pos.x);
    let r01 = clamp((1.0 - rn) / max(1.0 - G.inner_over_outer, 0.001), 0.0, 1.0);
    let led = led_cell(Ctx(0u, 0u, theta, r01, rn, pos));
    return Ctx(led.x, led.y, theta, r01, rn, pos);
}

/// Where cell `k` of a `res`² grid sits: its uv (0..1, y down) at the
/// cell's centre. Texture uv spans the disc's square: pos = (2u - 1, 1 - 2v).
fn grid_uv(k: u32, res: u32) -> vec2f {
    return (vec2f(f32(k % res), f32(k / res)) + 0.5) / f32(res);
}

fn uv_pos(uv: vec2f) -> vec2f {
    return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
}

fn grid_put(cell: u32, v: vec4f) {
    GRID[cell] = v;
}

fn grid_texel(base: u32, res: u32, x: u32, y: u32) -> vec4f {
    return GRID[base + min(y, res - 1u) * res + min(x, res - 1u)];
}

/// A texture the patch rendered: the `res`² grid at cell `base` of GRID, at
/// `uv` (0..1, y down), bilinear between cell centres; transparent outside.
fn grid_at(base: u32, res: u32, uv: vec2f) -> vec4f {
    if any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) {
        return vec4f(0.0);
    }
    let p = clamp(uv * f32(res) - 0.5, vec2f(0.0), vec2f(f32(res - 1u)));
    let p0 = vec2u(floor(p));
    let p1 = min(p0 + vec2u(1u), vec2u(res - 1u));
    let f = fract(p);
    let a = mix(grid_texel(base, res, p0.x, p0.y), grid_texel(base, res, p1.x, p0.y), f.x);
    let b = mix(grid_texel(base, res, p0.x, p1.y), grid_texel(base, res, p1.x, p1.y), f.x);
    return mix(a, b, f.y);
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

/// `x` wrapped into 0..`y` (unlike `%`, never negative).
fn fmod_pos(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

/// `p` rotated by `a` radians.
fn rot2(p: vec2f, a: f32) -> vec2f {
    let c = cos(a);
    let s = sin(a);
    return vec2f(c * p.x + s * p.y, c * p.y - s * p.x);
}

/// Signed distance to an `n`-pointed star of radius `r` (`m` sets how deep the points are, 2..n); negative inside.
fn sd_star(p_in: vec2f, r: f32, n: f32, m: f32) -> f32 {
    let an = PI / n;
    let en = PI / m;
    let acs = vec2f(cos(an), sin(an));
    let ecs = vec2f(cos(en), sin(en));
    let bn = fmod_pos(atan2(p_in.x, p_in.y), 2.0 * an) - an;
    var p = length(p_in) * vec2f(cos(bn), abs(sin(bn)));
    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
}

fn heart_r(a: f32) -> f32 {
    let s = sin(a);
    return 2.0 - 2.0 * s + s * sqrt(abs(cos(a))) / (s + 1.4);
}

/// Signed distance to a diamond of radius `r`; negative inside.
fn sd_diamond(p: vec2f, r: f32) -> f32 {
    return (abs(p.x) + abs(p.y) - r) * 0.70710678;
}

/// Signed distance to an equilateral triangle of radius `r`; negative inside.
fn sd_triangle(p_in: vec2f, r: f32) -> f32 {
    let k = sqrt(3.0);
    let h = r * 0.86602540;
    var p = vec2f(abs(p_in.x) - h, p_in.y + h / k);
    if p.x + k * p.y > 0.0 {
        p = vec2f(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    }
    p.x -= clamp(p.x, -2.0 * h, 0.0);
    return -length(p) * sign(p.y);
}

/// Signed distance to a crescent: a disc of radius `ra` minus one of radius `rb` offset by `d`; negative inside.
fn sd_moon(p_in: vec2f, d: f32, ra: f32, rb: f32) -> f32 {
    let p = vec2f(p_in.x, abs(p_in.y));
    let a = (ra * ra - rb * rb + d * d) / (2.0 * d);
    let b = sqrt(max(ra * ra - a * a, 0.0));
    if d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.0) {
        return length(p - vec2f(a, b));
    }
    return max(length(p) - ra, -(length(p - vec2f(d, 0.0)) - rb));
}

/// Isosceles trapezoid: half-widths `r1` at the bottom and `r2` at the top,
/// half-height `he`, centred on the origin (iq).
fn sd_trapezoid(p_in: vec2f, r1: f32, r2: f32, he: f32) -> f32 {
    let k1 = vec2f(r2, he);
    let k2 = vec2f(r2 - r1, 2.0 * he);
    let p = vec2f(abs(p_in.x), p_in.y);
    let ca = vec2f(p.x - min(p.x, select(r2, r1, p.y < 0.0)), abs(p.y) - he);
    let cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
    let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
    return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

/// Axis-aligned box of half-size `b`, centred on the origin (iq).
fn sd_box(p: vec2f, b: vec2f) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

/// The traffic cone's two reflective bands, as a mask over the figure's local
/// `y` in units of its radius: tape at 0.01..0.17 and 0.37..0.53 up the body.
fn cone_bands(y: f32) -> f32 {
    let a = 1.0 - smoothstep(0.08, 0.11, abs(y - 0.09));
    let b = 1.0 - smoothstep(0.08, 0.11, abs(y - 0.45));
    return max(a, b);
}

const SHAPE_UNIT: f32 = 0.38;

fn shape_scale(t: f32) -> f32 {
    let g = clamp(t / 0.18, 0.0, 1.0);
    let settle = 1.0 - pow(1.0 - g, 3.0);
    return settle + sin(PI * g) * 0.12;
}

struct Stamp {
    p: vec2f,
    r: f32,
}

fn stamp_frame(E: Effect, ctx: Ctx, t: f32, spin: f32) -> Stamp {
    let origin = E.radius * vec2f(cos(E.angle), sin(E.angle));
    var s: Stamp;
    s.p = rot2(ctx.pos - origin, E.rotation + spin);
    let drift = max(1.0 + E.grow * t, 0.0);
    s.r = max(SHAPE_UNIT * clamp(E.size, 0.1, 4.0) * shape_scale(t) * drift, 1e-3);
    return s;
}

// Kept identical to gate.wgsl's copy on purpose — the patch renderer draws
// the same figures and must answer the same controls. See the long note
// there for why the width floor tracks the pixel's radius.
fn shape_stamp(sd: f32, radius: f32, edge: f32, fill: f32, rn: f32) -> f32 {
    // Tangential sample spacing at this pixel. 0.7 of it is about the narrowest
    // Gaussian that still lands on every spoke it crosses.
    let pitch = max(rn, 0.05) * TAU / max(f32(G.spokes), 1.0);
    let thin = 0.7 * pitch;
    // The old ceiling, and never below `thin` — a small stamp must not be told
    // to draw an outline fatter than itself.
    let fat = max(min(0.14 * radius, 0.11), thin);
    let w = mix(thin, fat, clamp(edge, 0.0, 1.0));
    let rim = exp(-(sd * sd) / (w * w));
    let interior = clamp(-sd / w, 0.0, 1.0);
    return rim + interior * clamp(fill, 0.0, 1.0);
}

fn shape_hold(t: f32) -> f32 {
    return 1.0 - smoothstep(0.45, 1.0, t);
}

// ---------------------------------------------------------------------------
// Triggered effects + live-draw dabs: verbatim from gate.wgsl so both stay
// live while a patch renders (effect pads and drawing keep working).
// ---------------------------------------------------------------------------

/// What one triggered effect adds at this pixel (the Render effects node draws every effect with this), RGB.
fn effect_color(E: Effect, ctx: Ctx) -> vec3f {
    let t = clamp(E.age / max(E.duration, 0.001), 0.0, 1.0);
    let fade = (1.0 - t) * (1.0 - t);
    var col: vec3f;
    if E.hue < 0.0 {
        col = vec3f(1.0);
    } else {
        col = hsv2rgb(E.hue, E.saturation, E.brightness);
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
        case 4u: {
            let s = max(E.size, 0.2);
            let front = t * 1.15;
            let d = ctx.rn - front;
            let w = 0.09 * s;
            let ring = exp(-(d * d) / (w * w));
            let behind = front - ctx.rn;
            let wake = select(0.0, exp(-behind / (0.32 * s)) * 0.4, behind > 0.0);
            let petals = 0.7 + 0.3 * cos(6.0 * (ctx.theta - E.angle));
            return col * (ring + wake) * petals * fade * E.intensity * 1.7;
        }
        case 5u: {
            let spin = E.angle + TAU * 1.75 * t * t;
            let sharp = clamp(8.0 / max(E.size, 0.25), 1.0, 40.0);
            let arm = pow(max(cos(5.0 * (ctx.theta - spin) + ctx.rn * 3.0), 0.0), sharp);
            return col * arm * fade * E.intensity * 1.7;
        }
        case 6u: {
            let swell = sin(PI * clamp(t * 1.1, 0.0, 1.0));
            let seed = u32(abs(E.angle) * 1024.0);
            let led = led_cell(ctx);
            let idx = led.x * G.pixels + led.y;
            let cell = u32(t * 26.0);
            let rnd = hash01(idx * 2654435761u + cell * 40503u + seed * 7919u);
            let density = clamp(0.07 * E.size, 0.02, 0.35) * swell;
            let lit = step(1.0 - density, rnd);
            let vary = 0.55 + 0.45 * hash01(idx * 97u + cell * 26699u + seed);
            return col * lit * vary * swell * E.intensity * 1.8;
        }
        case 7u: {
            let s = max(E.size, 0.2);
            let dir = vec2f(cos(E.angle), sin(E.angle));
            let along = dot(ctx.pos, dir);
            let front = mix(-1.2, 1.2, t);
            let w = 0.09 * s;
            let bar = exp(-((along - front) * (along - front)) / (w * w));
            let behind = front - along;
            let wake = select(
                0.0,
                (1.0 - clamp(behind / (0.5 * s), 0.0, 1.0)) * 0.45,
                behind > 0.0
            );
            return col * (bar + wake) * fade * E.intensity * 1.6;
        }
        case 8u: {
            let s = stamp_frame(E, ctx, t, t * 0.5);
            return col * shape_stamp(sd_star(s.p, s.r, 5.0, 3.0), s.r, E.edge, E.fill, ctx.rn)
                * shape_hold(t) * E.intensity * 1.5;
        }
        case 9u: {
            let s = stamp_frame(E, ctx, t, 0.0);
            let beat = 1.0 + 0.07 * sin(TAU * 2.0 * t) * (1.0 - t);
            let unit = s.r * beat / 2.32;
            let q = s.p - vec2f(0.0, 1.68 * unit);
            let sd = length(q) - heart_r(atan2(q.y, q.x)) * unit;
            return col * shape_stamp(sd, s.r, E.edge, E.fill, ctx.rn) * shape_hold(t) * E.intensity * 1.5;
        }
        case 10u: {
            let s = stamp_frame(E, ctx, t, t * 0.4);
            let open = smoothstep(0.0, 0.35, t);
            let lobe = pow(abs(cos(3.0 * atan2(s.p.y, s.p.x))), 0.6);
            let sd = length(s.p) - s.r * mix(1.0, 0.5 + 0.5 * lobe, open);
            return col * shape_stamp(sd, s.r, E.edge, E.fill, ctx.rn) * shape_hold(t) * E.intensity * 1.5;
        }
        case 11u: {
            let s = stamp_frame(E, ctx, t, 0.0);
            return col * shape_stamp(sd_diamond(s.p, s.r), s.r, E.edge, E.fill, ctx.rn)
                * shape_hold(t) * E.intensity * 1.5;
        }
        case 12u: {
            let s = stamp_frame(E, ctx, t, 0.0);
            return col * shape_stamp(sd_triangle(s.p, s.r), s.r, E.edge, E.fill, ctx.rn)
                * shape_hold(t) * E.intensity * 1.5;
        }
        case 13u: {
            let s = stamp_frame(E, ctx, t, 0.35);
            let sd = sd_moon(s.p, 0.41 * s.r, s.r, 0.98 * s.r);
            return col * shape_stamp(sd, s.r, E.edge, E.fill, ctx.rn) * shape_hold(t) * E.intensity * 1.5;
        }
        case 14u: {
            let front = t * 1.12;
            let width = (0.035 + t * 0.045) * max(E.size, 0.2);
            let d = ctx.rn - front;
            let ring = exp(-(d * d) / (width * width));
            return col * ring * fade * E.intensity * 2.0;
        }
        case 15u: {
            return vec3f(0.0);
        }
        case 16u: {
            let s = stamp_frame(E, ctx, t, E.angle - PI * 0.5);
            let body = sd_trapezoid(s.p - vec2f(0.0, 0.20 * s.r), 0.42 * s.r, 0.10 * s.r, 0.65 * s.r);
            let plate = sd_box(s.p - vec2f(0.0, -0.60 * s.r), vec2f(0.72 * s.r, 0.14 * s.r));
            let sd = min(body, plate);
            let orange = hsv2rgb(0.07, 0.95, 1.0);
            let inside = clamp(-body / (0.08 * s.r), 0.0, 1.0);
            let tape = cone_bands(s.p.y / s.r) * inside * 0.85;
            return (orange * shape_stamp(sd, s.r, E.edge, E.fill, ctx.rn) + vec3f(1.0) * tape)
                * shape_hold(t) * E.intensity * 1.5;
        }
        default: {
            return vec3f(0.0);
        }
    }
}

/// What one drawn dab adds at this pixel (the Render points node draws every dab with this), RGB; `dab_index` seeds its sparkle.
fn dab_color(D: Dab, ctx: Ctx, dab_index: u32) -> vec3f {
    let fade = (1.0 - D.age) * (1.0 - D.age);
    let origin = D.radius * vec2f(cos(D.angle), sin(D.angle));
    let d = distance(ctx.pos, origin);
    var col: vec3f;
    if D.hue < 0.0 {
        col = vec3f(1.0);
    } else {
        col = hsv2rgb(D.hue, D.saturation, D.brightness);
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
            let led = led_cell(ctx);
            let idx = led.x * G.pixels + led.y;
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
            let led = led_cell(ctx);
            let idx = led.x * G.pixels + led.y;
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

/// How strongly finger `T` covers `ctx`: a soft disc of `radius` (array
/// radii) that grows by `grow` per second held, stretched back along the
/// finger's motion by `trail`, fading over `fade` seconds after release.
/// `soft` 0 is a hard edge, 1 a Gaussian-ish falloff.
fn touch_cover(T: Touch, ctx: Ctx, radius: f32, soft: f32, fade: f32, grow: f32, trail: f32) -> f32 {
    var life = 1.0;
    var held = T.age;
    if T.released >= 0.0 {
        life = 1.0 - T.released / max(fade, 0.001);
        if life <= 0.0 {
            return 0.0;
        }
        life = life * life;
        held = max(T.age - T.released, 0.0);
    }
    let size = max(radius * (1.0 + max(grow, 0.0) * held), 0.001);
    let origin = T.radius * vec2f(cos(T.angle), sin(T.angle));
    let d = ctx.pos - origin;
    let u = vec2f(cos(T.dir), sin(T.dir));
    var along = dot(d, u);
    let perp = d - along * u;
    if along < 0.0 {
        along = along / (1.0 + max(trail, 0.0) * T.speed);
    }
    let dist = length(perp + along * u);
    let edge = clamp(soft, 0.0, 1.0);
    return (1.0 - smoothstep(size * (1.0 - edge), size * (1.0 + edge * 0.5), dist)) * life;
}

/// Coverage 0..1 of the live touches at this pixel (the Touch mask node): spot `radius`, `soft` edge, `fade` seconds after release, `grow` while held, motion `trail`.
fn touch_mask(ctx: Ctx, radius: f32, soft: f32, fade: f32, grow: f32, trail: f32) -> f32 {
    var acc = 0.0;
    for (var t = 0u; t < G.touch_count; t++) {
        acc = max(acc, touch_cover(TOUCH[t], ctx, radius, soft, fade, grow, trail));
    }
    return acc;
}

/// The live touches at this pixel in each toucher's colour (the Touch glow node), RGBA; same knobs as touch_mask.
fn touch_glow(ctx: Ctx, radius: f32, soft: f32, fade: f32, grow: f32, trail: f32) -> vec4f {
    var acc = vec3f(0.0);
    var cover = 0.0;
    for (var t = 0u; t < G.touch_count; t++) {
        let T = TOUCH[t];
        let v = touch_cover(T, ctx, radius, soft, fade, grow, trail);
        var col = vec3f(1.0);
        if T.hue >= 0.0 {
            col = hsv2rgb(T.hue, T.saturation, T.brightness);
        }
        acc += col * v;
        cover = max(cover, v);
    }
    return vec4f(acc, cover);
}

/// Shared epilogue: hue pull, master, soft clip, pack.
fn finish(ctx: Ctx, idx: u32, patch_rgb: vec3f) {
    // Nothing is added here: effects and pen strokes reach the output only
    // through Render effects / Render points wired into the graph.
    var acc = patch_rgb;
    acc = hue_pull(acc);
    acc = acc * G.master;

    let knee = vec3f(0.8);
    let over = max(acc - knee, vec3f(0.0));
    acc = min(acc, knee) + over / (1.0 + over * 2.5);
    acc = clamp(acc, vec3f(0.0), vec3f(1.0));

    let r = u32(acc.r * 255.0 + 0.5);
    let g = u32(acc.g * 255.0 + 0.5);
    let b = u32(acc.b * 255.0 + 0.5);
    // Keep last frame's value for Feedback (OUT is twice the array; see
    // feedback_at), then write this one.
    OUT[G.spokes * G.pixels + idx] = OUT[idx];
    OUT[idx] = r | (g << 8u) | (b << 16u);
}
