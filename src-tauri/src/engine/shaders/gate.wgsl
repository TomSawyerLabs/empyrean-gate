// Empyrean Gate pattern compute shader.
//
// One invocation per pixel. idx = spoke * pixels_per_spoke + i, where i = 0 is the
// OUTER end of the spoke (strings are fed from the outside) and the last pixel is at
// the inner radius. The whole layer stack + triggered effects are evaluated from
// scratch every frame; there is no state between frames on the GPU.
//
// Struct layouts must match `layers.rs` / `engine/mod.rs` exactly.

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
    _pad_transition: f32,
    dj_link_visual_active: u32,
    dj_fade_position: f32,
    dj_fade_activity: f32,
    dj_looping: f32,
    // Game mode (plans/game-mode.md): the world crossfades over the scene.
    game_active: u32,
    game_mix: f32,
    game_theta: u32,
    game_rings: u32,
    game_alpha: f32,   // 0..1 from the previous sim generation to the current
    game_beat: f32,    // beat envelope for the brightness pulse
    _pad_game0: f32,
    _pad_game1: f32,
}

struct AudioU {
    level: f32,
    bass: f32,
    mid: f32,
    treble: f32,
    onset: f32,
    beat_phase: f32,
    bpm: f32,
    bpm_conf: f32, // 0..1 confidence in bpm; gate beat-driven motion on it
    // Smoothed (~0.25 s) twins: bass / bass_att > 1 means "hitting right now".
    bass_att: f32,
    mid_att: f32,
    treble_att: f32,
    _pad2: f32,
}

struct Layer {
    kind: u32,
    blend: u32,
    audio_source: u32,
    _pad: u32,
    opacity: f32,
    phase: f32,
    scale: f32,
    audio_amount: f32,
    hue: f32,
    hue_range: f32,
    saturation: f32,
    brightness: f32,
    tilt_amount: f32,
    param_a: f32,
    param_b: f32,
    param_c: f32,
    param_d: f32,
    // Whole-number part of `phase` for the kinds that index a hash by it; those
    // read `phase` as the fraction alone. Zero everywhere else. See
    // `LayerCfg::split_phase`.
    phase_epoch: u32,
    _pad2b: f32,
    _pad2c: f32,
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
    saturation: f32,
    brightness: f32,
    rotation: f32,  // shapes: the figure's own spin, independent of `angle`
    grow: f32,      // shapes: scale drift over the life, -1 .. 1
}

struct Dab {
    kind: u32,
    age: f32,     // 0..1 of the pen's lifetime
    angle: f32,
    radius: f32,
    hue: f32,
    size: f32,
    intensity: f32,
    dir: f32,     // stroke motion direction, for directional pens
    saturation: f32,
    brightness: f32,
    _pad0: f32,
    _pad1: f32,
}

@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var<uniform> AUDIO: array<AudioU, 4>;
@group(0) @binding(2) var<storage, read> LAYERS: array<Layer>;
@group(0) @binding(3) var<storage, read> FX: array<Effect>;
@group(0) @binding(4) var<storage, read_write> OUT: array<u32>;
@group(0) @binding(5) var<storage, read> DABS: array<Dab>;
// Per-source raw audio shapes: 256 waveform samples then 64 spectrum bins, per
// source, flattened. See `wave_at` / `spec_at`.
@group(0) @binding(6) var<storage, read> SCOPE: array<f32>;
// Latest browser-decoded video frame, packed RGBA8 (one u32 per texel).
@group(0) @binding(7) var<storage, read> VIDEO: array<u32>;
// Game grid: two packed-RGB snapshots (previous then current sim generation),
// game_theta × game_rings cells each, row-major with ring 0 at the hole.
// Colors are baked CPU-side — the shader never knows species or palettes.
@group(0) @binding(9) var<storage, read> GAME: array<u32>;

const WAVE_N: u32 = 256u;
const SPEC_N: u32 = 64u;
const SCOPE_STRIDE: u32 = WAVE_N + SPEC_N;

/// Waveform sample at t in [0,1) (oldest -> newest), roughly -1..1.
fn wave_at(src: u32, t: f32) -> f32 {
    let i = u32(fract(t) * f32(WAVE_N)) % WAVE_N;
    return SCOPE[src * SCOPE_STRIDE + i];
}

/// Normalized log-spaced spectrum bin (0 = lowest freq), 0..1.
fn spec_at(src: u32, i: u32) -> f32 {
    return SCOPE[src * SCOPE_STRIDE + WAVE_N + min(i, SPEC_N - 1u)];
}

fn video_texel(x: u32, y: u32) -> vec4f {
    let ix = min(x, G.video_width - 1u);
    let iy = min(y, G.video_height - 1u);
    return unpack4x8unorm(VIDEO[iy * G.video_width + ix]);
}

/// Bilinear sampling of the small live texture. UV origin matches HTML canvas:
/// top-left, with both axes in [0,1].
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

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;

// ---------------------------------------------------------------------------
// Simplex noise (3D) — Ashima Arts / Stefan Gustavson, ported to WGSL.
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

    let n_ = 0.142857142857; // 1/7
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
    // Piecewise via smooth select
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

/// Shortest angular distance, in radians.
fn ang_dist(a: f32, b: f32) -> f32 {
    let d = (a - b) % TAU;
    return abs(((d + 3.0 * PI) % TAU) - PI);
}

// ---------------------------------------------------------------------------
// Per-pixel context
// ---------------------------------------------------------------------------

struct Ctx {
    spoke: u32,
    i: u32,
    theta: f32,   // spoke angle, radians
    r01: f32,     // 0 = OUTER end of spoke, 1 = inner end (string order)
    rn: f32,      // radius normalized: inner/outer .. 1.0 (physical, 1 = outer edge)
    pos: vec2f,   // cartesian, outer edge at |pos| = 1
}

/// One meteor epoch. Callers also render the previous epoch's fading tail so an
/// epoch boundary never replaces the whole random field in a single frame.
fn meteor_event(L: Layer, ctx: Ctx, epoch: u32, progress: f32) -> vec4f {
    let alive = step(
        1.0 - (0.1 + L.param_a * 0.5),
        hash01(ctx.spoke * 31337u + epoch * 269u)
    );
    let dir_r = select(ctx.r01, 1.0 - ctx.r01, L.param_c > 0.5);
    let head = progress * 1.3;
    let d = head - dir_r;
    let tail = 0.08 + L.param_b * 0.15;
    let v = alive * exp(-d / tail) * step(0.0, d) * step(dir_r, head);
    let hue = L.hue + hash01(ctx.spoke * 911u + epoch) * L.hue_range;
    return vec4f(hsv2rgb(hue, L.saturation, v * L.brightness), v);
}

// ---------------------------------------------------------------------------
// Layers. Each returns premultiplied-ish (rgb, alpha) to be blended.
// ---------------------------------------------------------------------------

fn layer_color(L: Layer, ctx: Ctx) -> vec4f {
    let A = AUDIO[L.audio_source];
    let aud = L.audio_amount;
    let tilt = vec2f(G.tilt_x, G.tilt_y) * L.tilt_amount;

    switch L.kind {
        // Solid
        case 0u: {
            let v = L.brightness * (1.0 + aud * (A.level - 0.5));
            return vec4f(hsv2rgb(L.hue, L.saturation, max(v, 0.0)), 1.0);
        }
        // GradientRadial — hue sweeps along radius; tilt shifts the gradient center
        case 1u: {
            let t = ctx.rn + dot(ctx.pos, tilt) + L.phase * 0.1;
            let hue = L.hue + t * L.hue_range;
            let v = L.brightness * (1.0 + aud * A.bass);
            return vec4f(hsv2rgb(hue, L.saturation, max(v, 0.0)), 1.0);
        }
        // NoiseField — fBm brightness field, hue wanders with the noise
        case 2u: {
            let p = vec3f(ctx.pos * (2.0 * L.scale) + tilt, L.phase * 0.3);
            let n = fbm3(p, 4u);
            let cut = L.param_a; // threshold
            let v = smoothstep(cut - 0.3, cut + 0.5, n + aud * A.bass * 0.6);
            let hue = L.hue + n * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * L.brightness), v);
        }
        // NoiseColor — three offset simplex fields drive R/G/B independently
        case 3u: {
            let s = 2.0 * L.scale;
            let z = L.phase * 0.25;
            let p = vec3f(ctx.pos * s + tilt, z);
            let boost = 1.0 + aud * (A.level * 1.2 - 0.3);
            let r = 0.5 + 0.5 * snoise3(p);
            let g = 0.5 + 0.5 * snoise3(p + vec3f(31.4, 47.2, 12.9));
            let b = 0.5 + 0.5 * snoise3(p + vec3f(-17.7, 8.3, 91.1));
            // Rotate the noise RGB toward the layer hue
            let base = hsv2rgb(L.hue, L.saturation, 1.0);
            let c = mix(vec3f(r, g, b), vec3f(r, g, b) * base, 0.6);
            return vec4f(c * L.brightness * boost, 1.0);
        }
        // RadialWaves — stack of harmonically related ring waves
        case 4u: {
            let base_freq = 2.0 + L.param_a * 10.0;
            let harmonics = 1u + u32(L.param_b * 6.0);
            var v = 0.0;
            var norm = 0.0;
            for (var h = 1u; h <= harmonics; h++) {
                let fh = f32(h);
                let w = 1.0 / fh;
                v += w * sin((ctx.rn * base_freq * fh * L.scale) * TAU - L.phase * (1.0 + 0.2 * fh));
                norm += w;
            }
            v = v / norm * 0.5 + 0.5;
            v = pow(v, 2.0);
            let amp = L.brightness * (0.4 + aud * (A.bass * 1.4));
            let hue = L.hue + (ctx.rn - 0.5) * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * amp), v);
        }
        // Spiral — rotating arms, twist increases toward center
        case 5u: {
            let arms = max(1.0, floor(L.param_a * 12.0));
            let twist = (L.param_b * 8.0 - 4.0) * L.scale;
            let v0 = sin(arms * ctx.theta + twist * ctx.rn * TAU - L.phase + G.yaw * L.tilt_amount);
            let sharp = 1.0 + L.param_c * 8.0;
            let v = pow(max(v0, 0.0), sharp);
            let amp = L.brightness * (0.5 + aud * A.mid);
            let hue = L.hue + ctx.rn * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * amp), v);
        }
        // Plasma — sum of sines in polar + cartesian space
        case 6u: {
            let s = 3.0 * L.scale;
            let t = L.phase;
            var v = sin(ctx.pos.x * s + t);
            v += sin((ctx.pos.y * s + t) * 0.7);
            v += sin((ctx.pos.x + ctx.pos.y) * s * 0.6 + t * 1.3);
            v += sin(ctx.rn * s * 2.0 - t);
            v = v * 0.25 + 0.5;
            let hue = L.hue + v * L.hue_range + aud * A.mid * 0.1;
            return vec4f(hsv2rgb(hue, L.saturation, L.brightness * v), 1.0);
        }
        // SpokeChase — per-spoke comets running along the radius
        case 7u: {
            let h = hash01(ctx.spoke * 7919u);
            // Travel rate — direction (param_b), param_a and audio level — is
            // integrated into L.phase by LayerCfg::phase_rate (src/layers.rs).
            // Multiplying it in here instead would make every rate change jump
            // the comets by phase * delta.
            let head = fract(h + L.phase);
            let d = fract(ctx.r01 - head);
            let tail_len = 0.05 + L.param_c * 0.4;
            let v = exp(-d / tail_len) * step(0.0, d);
            let hue = L.hue + h * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * L.brightness), v);
        }
        // Sparkle — hash twinkles; density rides the treble
        case 8u: {
            let idx = ctx.spoke * G.pixels + ctx.i;
            // Re-roll rate (param_b) is integrated into L.phase — see phase_rate.
            // The clock arrives pre-split: whole twinkles in phase_epoch, the
            // fraction of the current one in phase. See split_phase.
            let cell = L.phase_epoch;
            let f = L.phase;
            let rnd0 = hash01(idx * 2654435761u + cell * 40503u);
            let rnd1 = hash01(idx * 2654435761u + (cell + 1u) * 40503u);
            let density = L.param_a * (0.3 + aud * A.treble * 1.5);
            let lit0 = step(1.0 - density * 0.2, rnd0);
            let lit1 = step(1.0 - density * 0.2, rnd1);
            let v0 = lit0 * (1.0 - f) * (1.0 - f);
            let v1 = lit1 * f * f;
            let v = max(v0, v1);
            let hue = L.hue + mix(rnd0, rnd1, f) * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * L.brightness), v);
        }
        // BeatRings — a ring expands outward (or inward) on every beat
        case 9u: {
            let A2 = AUDIO[L.audio_source];
            let dir = select(1.0 - ctx.r01, ctx.r01, L.param_b > 0.5);
            let width = 0.02 + L.param_a * 0.3;
            let front = A2.beat_phase;
            let d = abs(dir - front);
            let v = exp(-(d * d) / (width * width)) * (1.0 - A2.beat_phase * 0.5);
            let strength = mix(0.6, A2.onset * 0.7 + 0.5, aud);
            let hue = L.hue + front * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * L.brightness * strength), v);
        }
        // Breathe — multiplicative envelope, beat-synced when audio_amount is high
        case 10u: {
            let A2 = AUDIO[L.audio_source];
            let free = 0.5 + 0.5 * sin(L.phase);
            let beat = 1.0 - A2.beat_phase * 0.7;
            let env = mix(free, beat, aud);
            let floor_v = L.param_a; // how deep the breath dips
            let v = mix(floor_v, 1.0, env) * L.brightness;
            return vec4f(vec3f(v), 1.0);
        }
        // Rainbow — hue wheel around the circle, drifting; hue_range adds radial sweep
        case 11u: {
            let turns = max(1.0, floor(L.param_a * 4.0 + 0.5));
            let hue = L.hue + (ctx.theta / TAU) * turns + ctx.rn * L.hue_range + L.phase * 0.03;
            let v = L.brightness * (0.8 + aud * A.level * 0.6);
            return vec4f(hsv2rgb(hue, L.saturation, max(v, 0.0)), 1.0);
        }
        // Wedges — rotating pie slices; onset flashes the dark slices up
        case 12u: {
            let n = 2.0 + floor(L.param_a * 14.0);
            let soft = 0.05 + L.param_c * 0.3;
            let w = fract((ctx.theta / TAU + L.phase * 0.03) * n + ctx.rn * L.param_b);
            let d = abs(w - 0.5) * 2.0;
            var v = smoothstep(0.5 - soft, 0.5 + soft, d);
            v = max(v, aud * A.onset);
            let hue = L.hue + step(0.5, w) * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * L.brightness), v);
        }
        // Interference — two orbiting wave sources, moiré
        case 13u: {
            let orbit = 0.45 + L.param_b * 0.3;
            let p1 = orbit * vec2f(cos(L.phase * 0.31), sin(L.phase * 0.31));
            let p2 = -orbit * vec2f(cos(L.phase * 0.23), sin(L.phase * 0.23));
            let freq = (4.0 + L.param_a * 20.0) * L.scale;
            var v = sin(distance(ctx.pos, p1) * freq * TAU - L.phase)
                + sin(distance(ctx.pos, p2) * freq * TAU + L.phase * 0.8);
            v = v * 0.25 + 0.5;
            v = pow(v, 1.0 + L.param_c * 4.0);
            let amp = L.brightness * (0.6 + aud * A.mid * 0.8);
            let hue = L.hue + v * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * amp), v);
        }
        // Fire — noise flames climbing inward from the outer rim
        case 14u: {
            let A2 = AUDIO[L.audio_source];
            // Flame coordinate: 0 at the rim, growing inward; noise scrolls inward.
            let stretch = 2.0 + L.param_b * 4.0;
            let p = vec3f(
                cos(ctx.theta) * 3.0 * L.scale,
                sin(ctx.theta) * 3.0 * L.scale,
                0.0
            ) + vec3f(0.0, 0.0, ctx.r01 * stretch - L.phase);
            let n = fbm3(p, 4u) * 0.5 + 0.5;
            let reach = 0.4 + L.param_a * 0.6 + aud * A2.bass * 0.35;
            var heat = (1.0 - ctx.r01 / max(reach, 0.05)) * 1.3 - n * 0.9;
            heat = clamp(heat, 0.0, 1.0);
            let hue = L.hue + heat * 0.12; // default red base -> yellow tips
            let sat = clamp(1.3 - heat * 0.7, 0.0, 1.0) * L.saturation;
            let v = pow(heat, 1.4) * L.brightness;
            return vec4f(hsv2rgb(hue, sat, v), heat);
        }
        // Meteors — random radial shooting stars with trails
        case 15u: {
            // Launch rate (param_b) is integrated into L.phase — see phase_rate.
            // Phase arrives pre-split (see split_phase), so the per-spoke offset
            // is the only thing that can carry into the epoch here.
            let h0 = hash01(ctx.spoke * 4099u);
            let t = L.phase + h0 * 7.0;
            let epoch = L.phase_epoch + u32(t);
            let t_ep = fract(t);
            let current = meteor_event(L, ctx, epoch, t_ep);
            var previous = vec4f(0.0);
            if epoch > 0u {
                previous = meteor_event(L, ctx, epoch - 1u, t_ep + 1.0);
            }
            return vec4f(current.rgb + previous.rgb, clamp(current.a + previous.a, 0.0, 1.0));
        }
        // Warp — starfield streaming outward with streaks
        case 16u: {
            let cells = 6.0 + L.param_a * 20.0;
            let u = ctx.r01 * cells + hash01(ctx.spoke * 7919u) * 13.0;
            // Flow rate (param_b, audio level) is integrated into L.phase — see
            // phase_rate. r01 grows inward, so +phase streams outward. Phase
            // arrives pre-split, so only `u` can carry into the cell index.
            let flow = u + L.phase;
            let cell = L.phase_epoch + u32(flow);
            let f = fract(flow);
            let threshold = 1.0 - (0.15 + L.param_a * 0.2);
            let star0 = step(threshold, hash01(cell * 6151u + ctx.spoke * 389u));
            let star1 = step(threshold, hash01((cell + 1u) * 6151u + ctx.spoke * 389u));
            let streak = max(star0 * (1.0 - f) * (1.0 - f), star1 * f * f);
            // Stars brighten toward the rim (perspective).
            let persp = 0.35 + (1.0 - ctx.r01) * 0.65;
            let v = streak * persp;
            let hue = L.hue + hash01(cell * 127u) * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation * 0.6, v * L.brightness), v);
        }
        // Waveform — the raw PCM bent into a ring: a circular oscilloscope.
        // pa = base ring radius, pb = displacement depth, pc = line thickness.
        case 17u: {
            let t = fract(ctx.theta / TAU + L.phase * 0.03);
            let w = wave_at(L.audio_source, t);
            let depth = (0.08 + L.param_b * 0.3) * (1.0 + aud * A.level);
            let ring_r = mix(0.35, 0.95, L.param_a) + w * depth;
            let d = abs(ctx.rn - ring_r);
            let width = 0.012 + L.param_c * 0.06;
            let v = exp(-(d * d) / (width * width));
            let hue = L.hue + w * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * L.brightness), v);
        }
        // Spectrum — spoke-per-bin circular analyzer. Bars grow from the chosen
        // end of the spokes (pb: outer/inner); pa = bar length gain.
        case 18u: {
            let t = fract(ctx.theta / TAU + L.phase * 0.02);
            let e = spec_at(L.audio_source, u32(t * f32(SPEC_N)));
            let extent = clamp(e * (0.35 + L.param_a * 0.9), 0.0, 1.0);
            // Position along the spoke measured from the bar's root end.
            let pos = select(ctx.r01, 1.0 - ctx.r01, L.param_b > 0.5);
            let v = smoothstep(extent, extent - 0.2, pos) * (0.35 + e * 0.65);
            let hue = L.hue + t * L.hue_range;
            return vec4f(hsv2rgb(hue, L.saturation, v * L.brightness), v);
        }
        // Video — square-cropped browser video mapped across the radial array.
        // pa = zoom, pb = kaleidoscope segments, pc = contrast, pd = rotation.
        case 19u: {
            if G.video_active == 0u {
                return vec4f(0.0);
            }
            var p = ctx.pos;
            let rotation = (L.param_d - 0.5) * TAU + L.phase * 0.08;
            let cr = cos(rotation);
            let sr = sin(rotation);
            p = vec2f(p.x * cr - p.y * sr, p.x * sr + p.y * cr);

            let mirrors = u32(floor(clamp(L.param_b, 0.0, 1.0) * 10.0 + 0.5));
            if mirrors >= 2u {
                let sector = TAU / f32(mirrors);
                let a = abs(((atan2(p.y, p.x) + sector * 0.5) % sector) - sector * 0.5);
                p = length(p) * vec2f(cos(a), sin(a));
            }

            // Bass gently pumps the crop and onsets add a short punch. This is
            // deliberately restrained so ambient material breathes instead of
            // turning the source into a strobe at full response.
            let transient = max(A.onset, max(A.bass - A.bass_att, 0.0) * 2.0);
            let audio_zoom = 1.0 + aud * (A.bass * 0.08 + transient * 0.12);
            let zoom = mix(0.5, 1.5, clamp(L.param_a, 0.0, 1.0)) * max(L.scale, 0.05) * audio_zoom;
            let uv = vec2f(0.5 + p.x / (2.0 * zoom), 0.5 - p.y / (2.0 * zoom));
            let sample = video_at(uv);
            if sample.a == 0.0 {
                return sample;
            }
            let lum = dot(sample.rgb, vec3f(0.2126, 0.7152, 0.0722));
            let saturated = mix(vec3f(lum), sample.rgb, clamp(L.saturation, 0.0, 2.0));
            let tinted = hsv2rgb(L.hue, 0.85, lum);
            var rgb = mix(tinted, saturated, clamp(L.hue_range, 0.0, 1.0));
            let contrast = mix(0.5, 2.5, clamp(L.param_c, 0.0, 1.0)) + aud * transient * 0.3;
            rgb = clamp((rgb - vec3f(0.5)) * contrast + vec3f(0.5), vec3f(0.0), vec3f(1.0));
            rgb *= L.brightness * (1.0 + aud * (A.level * 0.25 + A.bass * 0.35 + transient * 0.55));
            return vec4f(rgb, sample.a);
        }
        default: {
            return vec4f(0.0);
        }
    }
}

fn apply_blend(acc: vec3f, c: vec4f, opacity: f32, mode: u32) -> vec3f {
    let a = clamp(c.a * opacity, 0.0, 1.0);
    let rgb = c.rgb * opacity;
    switch mode {
        case 0u: { return acc + rgb; }                                    // Add
        case 1u: { return acc * mix(vec3f(1.0), c.rgb, opacity); }        // Multiply
        case 2u: { return 1.0 - (1.0 - acc) * (1.0 - clamp(rgb, vec3f(0.0), vec3f(1.0))); } // Screen
        case 3u: { return mix(acc, c.rgb, a); }                           // AlphaOver
        case 4u: { return max(acc, rgb); }                                // Max
        default: { return acc; }
    }
}

// ---------------------------------------------------------------------------
// Shape stamps
//
// The figure effects (star, heart, …) are drawn from exact signed distance
// fields — Inigo Quilez's, ported — rather than polar radius functions. An exact
// Euclidean distance gives the outline a constant width the whole way round; a
// radial `rn - R(theta)` proxy fattens the rim wherever the edge runs steeply in
// r, which on a star is most of it.
//
// Three GLSL-isms do not survive the port: `vec2 - float` does not broadcast in
// WGSL, `%` truncates instead of flooring (hence `fmod_pos`), and iq writes
// `atan(x, y)` for what WGSL spells `atan2(x, y)`.
// ---------------------------------------------------------------------------

/// Floor-based modulo — GLSL `mod`, which WGSL's `%` is not.
fn fmod_pos(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

fn rot2(p: vec2f, a: f32) -> vec2f {
    let c = cos(a);
    let s = sin(a);
    return vec2f(c * p.x + s * p.y, c * p.y - s * p.x);
}

/// Regular `n`-pointed star of outer radius `r`. `m` in (2, n) sets how deep the
/// notches cut: 3 is the classic five-point star.
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

/// The classic polar heart, as a radius about the notch between the lobes. In
/// heart units the curve is 4.64 tall and 4.48 wide, the tip is 4.0 below the
/// notch and the figure's middle is 1.68 below it.
///
/// iq also has an exact heart SDF, and it was the first thing tried here. Its
/// cleft is only 9% of the figure's height, which on 64 spokes under a 0.11-wide
/// rim glow is not a cleft at all — it rendered as a disc. This curve's notch
/// goes all the way to the origin, which is the one feature that makes a heart
/// read as a heart. Every ray from the notch crosses the boundary exactly once,
/// so `length - r(angle)` is a sound inside/outside test.
fn heart_r(a: f32) -> f32 {
    let s = sin(a);
    return 2.0 - 2.0 * s + s * sqrt(abs(cos(a))) / (s + 1.4);
}

/// Rhombus with both half-diagonals `r`.
fn sd_diamond(p: vec2f, r: f32) -> f32 {
    return (abs(p.x) + abs(p.y) - r) * 0.70710678;
}

/// Equilateral triangle of circumradius `r`, point up. (iq's parameter is half
/// the side length; converted here so every shape below is sized the same way.)
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

/// Crescent: a disc of radius `ra` with a disc of radius `rb`, offset by `d`,
/// taken out of it. Opens toward +x.
fn sd_moon(p_in: vec2f, d: f32, ra: f32, rb: f32) -> f32 {
    let p = vec2f(p_in.x, abs(p_in.y));
    let a = (ra * ra - rb * rb + d * d) / (2.0 * d);
    let b = sqrt(max(ra * ra - a * a, 0.0));
    if d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.0) {
        return length(p - vec2f(a, b));
    }
    return max(length(p) - ra, -(length(p - vec2f(d, 0.0)) - rb));
}

/// World radius of a shape stamped at `size` 1 — the Live size slider's default.
/// Shapes have to be generous: 64 spokes is 5.6 degrees of arc, so a small figure
/// is just a blob.
const SHAPE_UNIT: f32 = 0.38;

/// Arrival envelope for a stamp: snaps to full size in the first fifth with a
/// small overshoot. A figure that eased in over its whole life never reads as one
/// thing. Any drift after that is the trigger's `grow`, not ours.
fn shape_scale(t: f32) -> f32 {
    let g = clamp(t / 0.18, 0.0, 1.0);
    let settle = 1.0 - pow(1.0 - g, 3.0);
    let overshoot = sin(PI * g) * 0.12;
    return settle + overshoot;
}

/// A stamp's local frame: the point relative to where the figure was tapped, with
/// the figure's own rotation undone, plus the radius it should be right now.
struct Stamp {
    p: vec2f,
    r: f32,
}

fn stamp_frame(E: Effect, ctx: Ctx, t: f32, spin: f32) -> Stamp {
    let origin = E.radius * vec2f(cos(E.angle), sin(E.angle));
    var s: Stamp;
    s.p = rot2(ctx.pos - origin, E.rotation + spin);
    // Arrive, then hold / grow / shrink as the trigger asked. Floored rather than
    // clamped at zero: a `grow` of -1 closes the figure to a point exactly as it
    // ends, and the crescent's construction divides by its own offset.
    let drift = max(1.0 + E.grow * t, 0.0);
    s.r = max(SHAPE_UNIT * clamp(E.size, 0.1, 4.0) * shape_scale(t) * drift, 1e-3);
    return s;
}

/// Turn a signed distance into brightness: a bright rim of width `rim` on the
/// outline, plus a dimmer interior. Rim-first is deliberate — the array is a ring
/// with a 32% hole, so a stamp's middle is missing whatever we do, and a fill
/// bright enough to carry the figure on its own would swamp the layer stack the
/// effect is supposed to sit on top of.
fn shape_stamp(sd: f32, radius: f32) -> f32 {
    // The rim tracks the stamp's size, but only within a band: the array's
    // resolution does not change with the figure, so a full-array star wants the
    // same ~0.1 of outline a small one does. Under about a spoke pitch it reads
    // as a dotted line rather than a line; over 0.11 a five-pointed star's
    // notches fill in and it is just a disc. The floor also covers the frame it
    // is born on, where the radius is still zero.
    let w = clamp(0.14 * radius, 0.035, 0.11);
    let edge = exp(-(sd * sd) / (w * w));
    let interior = clamp(-sd / w, 0.0, 1.0);
    return edge + interior * 0.35;
}

/// Brightness envelope for a stamp: full while it is being read, then away. The
/// motion effects' `(1-t)^2` starts decaying immediately, which is right for a
/// wavefront and wrong for a figure.
fn shape_hold(t: f32) -> f32 {
    return 1.0 - smoothstep(0.45, 1.0, t);
}

// ---------------------------------------------------------------------------
// Triggered effects (transient, additive on top of the layer stack)
// ---------------------------------------------------------------------------

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
        // Burst — circular shockwave expanding from a point
        case 0u: {
            let origin = E.radius * vec2f(cos(E.angle), sin(E.angle));
            let d = distance(ctx.pos, origin);
            let front = t * 2.2; // wavefront reaches the far side of the array
            let width = (0.06 + t * 0.12) * E.size;
            let ring = exp(-((d - front) * (d - front)) / (width * width));
            return col * ring * fade * E.intensity * 2.0;
        }
        // Strobe — whole array flash
        case 1u: {
            return col * fade * E.intensity;
        }
        // Swoosh — a bright arm sweeping one revolution
        case 2u: {
            let sweep = E.angle + t * TAU;
            let d = ang_dist(ctx.theta, sweep);
            let width = 0.25;
            let v = exp(-(d * d) / (width * width));
            return col * v * fade * E.intensity * 1.5;
        }
        // Collapse — wave from the outer edge collapsing to the center
        case 3u: {
            let front = 1.0 - t * 1.1;
            let d = abs(ctx.rn - front);
            let v = exp(-(d * d) / 0.003);
            return col * v * fade * E.intensity * 1.8;
        }
        // Bloom — an iris opening from the center out, petalled, with a wake
        case 4u: {
            let s = max(E.size, 0.2);
            let front = t * 1.15;
            let d = ctx.rn - front;
            let w = 0.09 * s;
            let ring = exp(-(d * d) / (w * w));
            // Only behind the front, or the wake lights the whole array.
            let behind = front - ctx.rn;
            let wake = select(0.0, exp(-behind / (0.32 * s)) * 0.4, behind > 0.0);
            let petals = 0.7 + 0.3 * cos(6.0 * (ctx.theta - E.angle));
            return col * (ring + wake) * petals * fade * E.intensity * 1.7;
        }
        // Pinwheel — spiral arms whipping up to speed, then gone
        case 5u: {
            let spin = E.angle + TAU * 1.75 * t * t;
            let sharp = clamp(8.0 / max(E.size, 0.25), 1.0, 40.0);
            let arm = pow(max(cos(5.0 * (ctx.theta - spin) + ctx.rn * 3.0), 0.0), sharp);
            return col * arm * fade * E.intensity * 1.7;
        }
        // Twinkle — glitter storm swelling across the whole array
        case 6u: {
            // Rise and fall, so the storm arrives rather than starting at full tilt.
            let swell = sin(PI * clamp(t * 1.1, 0.0, 1.0));
            let seed = u32(abs(E.angle) * 1024.0);
            let idx = ctx.spoke * G.pixels + ctx.i;
            let cell = u32(t * 26.0);
            let rnd = hash01(idx * 2654435761u + cell * 40503u + seed * 7919u);
            // Glitter, not a wash: even at the top of the size range barely a
            // third of the array is alight at the peak of the swell.
            let density = clamp(0.07 * E.size, 0.02, 0.35) * swell;
            let lit = step(1.0 - density, rnd);
            let vary = 0.55 + 0.45 * hash01(idx * 97u + cell * 26699u + seed);
            return col * lit * vary * swell * E.intensity * 1.8;
        }
        // Wipe — a straight bar crossing the disc, lit wake behind it
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
        // Star — turning slowly on its own axis
        case 8u: {
            let s = stamp_frame(E, ctx, t, t * 0.5);
            let sd = sd_star(s.p, s.r, 5.0, 3.0);
            return col * shape_stamp(sd, s.r) * shape_hold(t) * E.intensity * 1.5;
        }
        // Heart — beats twice while it fades
        case 9u: {
            let s = stamp_frame(E, ctx, t, 0.0);
            let beat = 1.0 + 0.07 * sin(TAU * 2.0 * t) * (1.0 - t);
            // Heart units -> world, so the figure's half-height is `s.r`; the
            // curve is measured from the notch, which sits 1.68 above the middle.
            let unit = s.r * beat / 2.32;
            let q = s.p - vec2f(0.0, 1.68 * unit);
            let sd = length(q) - heart_r(atan2(q.y, q.x)) * unit;
            return col * shape_stamp(sd, s.r) * shape_hold(t) * E.intensity * 1.5;
        }
        // Flower — a circle that unfolds into six petals as it lands
        case 10u: {
            let s = stamp_frame(E, ctx, t, t * 0.4);
            let open = smoothstep(0.0, 0.35, t);
            let lobe = pow(abs(cos(3.0 * atan2(s.p.y, s.p.x))), 0.6);
            // The one shape with no closed-form SDF; its edges are smooth enough
            // in r that the radial proxy does not show.
            let sd = length(s.p) - s.r * mix(1.0, 0.5 + 0.5 * lobe, open);
            return col * shape_stamp(sd, s.r) * shape_hold(t) * E.intensity * 1.5;
        }
        // Diamond
        case 11u: {
            let s = stamp_frame(E, ctx, t, 0.0);
            return col * shape_stamp(sd_diamond(s.p, s.r), s.r)
                * shape_hold(t) * E.intensity * 1.5;
        }
        // Triangle
        case 12u: {
            let s = stamp_frame(E, ctx, t, 0.0);
            return col * shape_stamp(sd_triangle(s.p, s.r), s.r)
                * shape_hold(t) * E.intensity * 1.5;
        }
        // Moon — crescent, tilted to read the way the glyph does
        case 13u: {
            let s = stamp_frame(E, ctx, t, 0.35);
            let sd = sd_moon(s.p, 0.41 * s.r, s.r, 0.98 * s.r);
            return col * shape_stamp(sd, s.r) * shape_hold(t) * E.intensity * 1.5;
        }
        default: {
            return vec3f(0.0);
        }
    }
}

// ---------------------------------------------------------------------------
// Live-draw dabs (collaborative strokes from any client)
// ---------------------------------------------------------------------------

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
        // Glow — soft blob that swells slightly as it fades
        case 0u: {
            let s = D.size * (1.0 + D.age * 0.5);
            let v = exp(-(d * d) / (s * s * 0.5));
            return col * v * fade * D.intensity;
        }
        // Ripple — a small ring expanding from the dab
        case 1u: {
            let front = D.age * D.size * 4.0;
            let w = D.size * 0.25 + 0.01;
            let v = exp(-((d - front) * (d - front)) / (w * w));
            return col * v * fade * D.intensity * 1.2;
        }
        // Sparkle — glitter spray inside the dab footprint
        case 2u: {
            let s = D.size * 1.5;
            let inside = exp(-(d * d) / (s * s * 0.5));
            let idx = ctx.spoke * G.pixels + ctx.i;
            let cell = u32(D.age * 24.0);
            let rnd = hash01(idx * 2654435761u + dab_index * 97u + cell * 40503u);
            let lit = step(0.86, rnd);
            return col * inside * lit * fade * D.intensity * 1.6;
        }
        // Comet — teardrop streak elongated along the stroke's motion direction
        case 3u: {
            let dirv = vec2f(cos(D.dir), sin(D.dir));
            let off = ctx.pos - origin;
            let along = dot(off, dirv);          // + ahead of motion, - behind
            let across = off.x * dirv.y - off.y * dirv.x;
            let w = D.size * 0.35 + 0.01;
            let tail = D.size * 3.0;
            // Sharp nose, long exponential tail behind the motion.
            let head = select(exp(along / tail * 6.0), exp(-along / (w * 2.0)), along > 0.0);
            let v = exp(-(across * across) / (w * w)) * head;
            return col * v * fade * D.intensity * 1.6;
        }
        // Ring — a full hoop around the array at the dab's radius
        case 4u: {
            let w = D.size * 0.3 + 0.01;
            let v = exp(-((ctx.rn - D.radius) * (ctx.rn - D.radius)) / (w * w));
            return col * v * fade * D.intensity;
        }
        // Beam — the whole spoke ray at the dab's angle
        case 5u: {
            let a = ang_dist(ctx.theta, D.angle);
            let w = D.size * 0.6 + 0.02;
            let v = exp(-(a * a) / (w * w));
            return col * v * fade * D.intensity * 1.4;
        }
        // Ember — glitter drifting inward toward the center as it fades
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

// ---------------------------------------------------------------------------
// Game mode
// ---------------------------------------------------------------------------

fn game_unpack(v: u32) -> vec3f {
    return vec3f(
        f32(v & 0xffu),
        f32((v >> 8u) & 0xffu),
        f32((v >> 16u) & 0xffu),
    ) / 255.0;
}

// The game world: a dumb lookup into the CPU simulation's cell grid,
// interpolating between the previous and current generation so fronts glide
// instead of strobing, with a gentle beat pulse on top.
fn game_color(ctx: Ctx) -> vec3f {
    let it = ctx.spoke * G.game_theta / G.spokes;
    // Ring 0 is at the hole; r01 is 0 at the OUTER end of the spoke.
    let t = 1.0 - ctx.r01;
    let ir = min(u32(t * f32(G.game_rings)), G.game_rings - 1u);
    let cell = ir * G.game_theta + it;
    let n = G.game_theta * G.game_rings;
    let a = game_unpack(GAME[cell]);
    let b = game_unpack(GAME[n + cell]);
    var c = mix(a, b, smoothstep(0.0, 1.0, clamp(G.game_alpha, 0.0, 1.0)));
    // Dim toward radial cell edges so the grid reads as tiles rather than an
    // unbroken smear. (θ edges are the physical gaps between spokes already.)
    let fr = fract(t * f32(G.game_rings));
    let edge = smoothstep(0.0, 0.18, fr) * smoothstep(1.0, 0.82, fr);
    c *= 0.75 + 0.25 * edge;
    return c * (1.0 + 0.18 * G.game_beat);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    let total = G.spokes * G.pixels;
    if idx >= total {
        return;
    }

    let spoke = idx / G.pixels;
    let i = idx % G.pixels;
    let theta = f32(spoke) / f32(G.spokes) * TAU;
    let r01 = f32(i) / f32(max(G.pixels - 1u, 1u));
    let rn = mix(1.0, G.inner_over_outer, r01);
    var ctx: Ctx;
    ctx.spoke = spoke;
    ctx.i = i;
    ctx.theta = theta;
    ctx.r01 = r01;
    ctx.rn = rn;
    ctx.pos = rn * vec2f(cos(theta), sin(theta));

    var acc = vec3f(0.0);
    if G.transition_active != 0u {
        var outgoing = vec3f(0.0);
        var incoming = vec3f(0.0);
        for (var l = 0u; l < G.layer_count; l++) {
            let L = LAYERS[l];
            let c = layer_color(L, ctx);
            if l < G.transition_split {
                outgoing = apply_blend(outgoing, c, L.opacity, L.blend);
            } else {
                incoming = apply_blend(incoming, c, L.opacity, L.blend);
            }
        }
        acc = mix(outgoing, incoming, clamp(G.transition_progress, 0.0, 1.0));
    } else {
        for (var l = 0u; l < G.layer_count; l++) {
            let L = LAYERS[l];
            let c = layer_color(L, ctx);
            acc = apply_blend(acc, c, L.opacity, L.blend);
        }
    }

    if G.dj_link_visual_active != 0u {
        // Master-clock geometry remains expressive even when the DJ is
        // monitoring entirely in headphones and no audio energy reaches Gate.
        // A four-lobed fan snaps outward on each beat and slowly rotates.
        let master_hit = exp(-AUDIO[0].beat_phase * 11.0);
        let master_fan = pow(max(0.0, cos(ctx.theta * 4.0 - G.time * 0.32)), 10.0);
        let master_ring = 0.45 + 0.55 * cos(TAU * (ctx.rn * 1.35 - AUDIO[0].beat_phase));
        let master_col = hsv2rgb(fract(0.52 + G.time * 0.006 + ctx.rn * 0.08), 0.78, 1.0);
        acc += master_col * master_hit * master_fan * max(master_ring, 0.0) * 0.26;

        // A deck handoff is an additive ribbon travelling across the Gate. It
        // deliberately never masks or scales the composition underneath it.
        if G.dj_fade_activity > 0.005 {
            let fade_y = mix(-0.92, 0.92, clamp(G.dj_fade_position, 0.0, 1.0));
            let width = 0.10 + 0.10 * G.dj_fade_activity;
            let ribbon = exp(-pow(ctx.pos.y - fade_y, 2.0) / (width * width));
            let shimmer = 0.65 + 0.35 * sin(TAU * (ctx.rn * 1.8 - AUDIO[0].beat_phase));
            let ribbon_col = hsv2rgb(mix(0.58, 0.08, G.dj_fade_position), 0.82, 1.0);
            acc += ribbon_col * ribbon * shimmer * G.dj_fade_activity * 0.75;
        }

        // Loops add concentric, beat-locked bands. Loop entry, wrap, and exit
        // also fire stronger transient effects in the link receiver.
        if G.dj_looping > 0.5 {
            let loop_wave = 0.5 + 0.5 * cos(TAU * (AUDIO[0].beat_phase - ctx.rn * 1.5));
            let loop_col = hsv2rgb(0.78, 0.72, 1.0);
            acc += loop_col * loop_wave * 0.24;
        }
    }

    // Game mode: the world crossfades over the scene (layers + DJ overlays).
    // Effects and dabs stay on top when the operator's overlay toggle is on —
    // the engine zeroes their counts when it isn't.
    if G.game_active != 0u {
        acc = mix(acc, game_color(ctx), clamp(G.game_mix, 0.0, 1.0));
    }

    for (var e = 0u; e < G.effect_count; e++) {
        acc += effect_color(FX[e], ctx);
    }

    for (var d = 0u; d < G.dab_count; d++) {
        acc += dab_color(DABS[d], ctx, d);
    }

    acc = acc * G.master;

    // Gentle soft clip: linear below 0.8, compressed knee above, hard cap at 1.
    let knee = vec3f(0.8);
    let over = max(acc - knee, vec3f(0.0));
    acc = min(acc, knee) + over / (1.0 + over * 2.5);
    acc = clamp(acc, vec3f(0.0), vec3f(1.0));

    let r = u32(acc.r * 255.0 + 0.5);
    let g = u32(acc.g * 255.0 + 0.5);
    let b = u32(acc.b * 255.0 + 0.5);
    OUT[idx] = r | (g << 8u) | (b << 16u);
}
