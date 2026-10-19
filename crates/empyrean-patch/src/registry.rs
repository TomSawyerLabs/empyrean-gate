//! Static node-type definitions — the palette.
//!
//! Every `Number` param is *also* an optional Scalar input port of the same
//! name: the knob value is the fallback when nothing is wired in (the
//! TouchDesigner/TiXL model). `inputs` therefore lists only shaped inputs
//! (fields, points, textures, events). `Select` params are enum-like topology
//! choices and are NOT connectable.
//!
//! Every node type, port and param carries a `description`: plain sentences
//! for a person or an agent composing patches without opening the editor
//! (served in the palette JSON). Keep them true to `codegen` / `eval` when
//! behaviour changes; units go in the param's description.

use super::Shape;

#[derive(Debug, Clone, Copy)]
pub struct PortDef {
    pub name: &'static str,
    pub shape: Shape,
    /// What the port carries, with units and ranges where they matter.
    pub description: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub enum ParamKind {
    /// Continuous value; connectable as a Scalar input port.
    Number,
    /// Enum by index (UI shows the labels); not connectable.
    Select(&'static [&'static str]),
}

#[derive(Debug, Clone, Copy)]
pub struct ParamDef {
    pub name: &'static str,
    pub label: &'static str,
    pub kind: ParamKind,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    /// The engine integrates this param over time (× master speed) and the GPU
    /// sees the accumulated phase, so live speed changes never cause visual
    /// discontinuities — the same invariant the layer stack keeps per-layer.
    pub integrate: bool,
    /// What the param does: units, what the ends of the range mean, and for a
    /// Select what each option does.
    pub description: &'static str,
}

/// Palette groups. Serialized as the snake-ish ids in [`palette_json`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    /// `input`: signals from outside the graph — time, sliders, the crew's
    /// master controls, audio, phone motion, touch, PRO DJ LINK, the effect
    /// and stroke streams clients send, video and pictures.
    Input,
    /// `scalar`: control-rate CPU operators on Scalars and Events (math,
    /// LFOs, envelopes, counters, latches, event effects). They run once per
    /// frame, not per pixel.
    ScalarOp,
    /// `generator`: nodes that make a field from nothing (the old layer kinds
    /// live here), evaluated per pixel on the GPU.
    Generator,
    /// `field`: per-pixel transforms and colour mapping of fields, and the
    /// renderers that turn Points / Effects streams into colour.
    FieldOp,
    /// `combine`: multi-field combination (Blend) and Sub-patch.
    Combine,
    /// `texture`: texture-tier nodes (materialized buffers) — Texture sample.
    Texture,
    /// `sink`: the one required end of every renderable patch (Output).
    Sink,
    /// `code`: nodes whose ports and body are written by the user (see `code`).
    Code,
}

/// Where the palette shows a kind: grouped by what a person reaches for, not
/// by how it evaluates (that is [`Category`]). Serialized as the lowercase
/// ids in [`palette_json`]; the editor holds each group's label, icon and
/// order (patch-web `src/groups.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Group {
    /// `controls`: time, sliders and the crew's master controls.
    Controls,
    /// `live`: music, phone motion, touch, taps, strokes and PRO DJ LINK.
    Live,
    /// `media`: video, pictures, clips and sampling a texture.
    Media,
    /// `shape`: arithmetic and shaping of a Scalar.
    Shape,
    /// `motion`: Scalars that move on their own (LFO, envelope, sequencer).
    Motion,
    /// `random`: random Scalars.
    Random,
    /// `events`: counting, latching, delaying and merging events, and
    /// turning them into effects.
    Events,
    /// `blocks`: plain fields to build looks from (solid, gradients, the
    /// pixel's position, noise, masks, last frame).
    Blocks,
    /// `patterns`: finished looks, each a whole pattern on its own.
    Patterns,
    /// `color`: colouring, measuring, combining and moving fields.
    Color,
    /// `draw`: renderers for the Points and Effects streams.
    Draw,
    /// `structure`: Output, Sub-patch, Code and Note.
    Structure,
}

impl Group {
    pub const ALL: [Group; 12] = [
        Group::Controls,
        Group::Live,
        Group::Media,
        Group::Shape,
        Group::Motion,
        Group::Random,
        Group::Events,
        Group::Blocks,
        Group::Patterns,
        Group::Color,
        Group::Draw,
        Group::Structure,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Group::Controls => "controls",
            Group::Live => "live",
            Group::Media => "media",
            Group::Shape => "shape",
            Group::Motion => "motion",
            Group::Random => "random",
            Group::Events => "events",
            Group::Blocks => "blocks",
            Group::Patterns => "patterns",
            Group::Color => "color",
            Group::Draw => "draw",
            Group::Structure => "structure",
        }
    }
}

/// A remark on the canvas: text in `NodeInst::text`, no ports, never run.
pub const NOTE_KIND: &str = "note";

/// Node kinds the evaluator runs on the CPU every frame (Scalar/Event
/// tier). A Code node's tier is per instance: see `NodeInst::is_cpu`.
pub fn is_cpu_kind(kind: &str) -> bool {
    matches!(
        kind,
        "time"
            | "slider"
            | "globals"
            | "audio"
            | "imu"
            | "tap"
            | "touch"
            | "dj_link"
            | "event_effect"
            | "scalar_math"
            | "lfo"
            | "smooth"
            | "envelope"
            | "map_range"
            | "mix"
            | "clamp"
            | "random"
            | "full_random"
            | "random_walk"
            | "smooth_noise"
            | "counter"
            | "toggle"
            | "threshold"
            | "delay"
            | "event_merge"
            | "sequence"
    )
}

/// Node kinds codegen compiles into the patch shader. A Code node's tier is
/// per instance: see `NodeInst::is_gpu`.
pub fn is_gpu_kind(kind: &str) -> bool {
    matches!(
        kind,
        "solid"
            | "gradient"
            | "gradient_radial"
            | "noise_field"
            | "noise_color"
            | "perlin_noise"
            | "random_field"
            | "radial_waves"
            | "spiral"
            | "plasma"
            | "spoke_chase"
            | "sparkle"
            | "touch_mask"
            | "touch_glow"
            | "beat_rings"
            | "breathe"
            | "rainbow"
            | "wedges"
            | "interference"
            | "fire"
            | "cosmic_drift"
            | "earth_current"
            | "meteors"
            | "warp"
            | "waveform"
            | "spectrum"
            | "transform"
            | "colorize"
            | "blend"
            | "effects_in"
            | "render_effects"
            | "touch_dabs"
            | "render_points"
            | "video_in"
            | "image_in"
            | "clip"
            | "coordinate"
            | "feedback"
            | "field_math"
            | "luminance"
            | "color_adjust"
            | "palette"
            | "texture_sample"
            | "output"
    )
}

#[derive(Debug, Clone, Copy)]
pub struct NodeType {
    pub id: &'static str,
    pub label: &'static str,
    pub category: Category,
    /// The palette group it is listed under.
    pub group: Group,
    /// What the node does and outputs, what its inputs mean, and when to use
    /// it: one to three sentences.
    pub description: &'static str,
    /// Shaped inputs only; every `Number` param is additionally a Scalar input.
    pub inputs: &'static [PortDef],
    pub outputs: &'static [PortDef],
    pub params: &'static [ParamDef],
}

impl NodeType {
    pub fn param(&self, name: &str) -> Option<&'static ParamDef> {
        self.params.iter().find(|p| p.name == name)
    }

    pub fn output_shape(&self, name: &str) -> Option<Shape> {
        self.outputs
            .iter()
            .find(|p| p.name == name)
            .map(|p| p.shape)
    }

    /// Shape of an input port: a shaped input, or a `Number` param's implicit
    /// Scalar port. `None` for unknown ports AND for `Select` params (which is
    /// how validation refuses wiring into them).
    pub fn input_shape(&self, name: &str) -> Option<Shape> {
        if let Some(p) = self.inputs.iter().find(|p| p.name == name) {
            return Some(p.shape);
        }
        match self.param(name)?.kind {
            ParamKind::Number => Some(Shape::Scalar),
            ParamKind::Select(_) => None,
        }
    }
}

pub fn lookup(id: &str) -> Option<&'static NodeType> {
    TYPES.iter().find(|t| t.id == id)
}

/// Most layers a layered node may have (`NodeInst::layers`).
pub const MAX_LAYERS: u32 = 8;

/// The inputs and params a node of this kind repeats per layer, when it is
/// layered (only Blend is). Layer 1 uses the names as they are; layer `k`
/// (2..=[`MAX_LAYERS`]) the name followed by `k`: `over2`, `mode2`,
/// `opacity2`. Empty for every other kind.
pub fn layered(kind: &str) -> &'static [&'static str] {
    match kind {
        "blend" => &["over", "mode", "opacity"],
        _ => &[],
    }
}

/// The name layer `k` (1-based) gives one of the repeated names.
pub fn layer_name(name: &str, k: u32) -> String {
    if k <= 1 { name.to_string() } else { format!("{name}{k}") }
}

/// `(repeated name, k)` when `name` is layer `k`'s copy (k in
/// 2..=[`MAX_LAYERS`]) of one of `kind`'s repeated names: `over3` →
/// `("over", 3)`. `None` for layer 1's own names and anything else.
pub fn split_layer(kind: &str, name: &str) -> Option<(&'static str, u32)> {
    layered(kind).iter().find_map(|&base| {
        let digits = name.strip_prefix(base)?;
        let k: u32 = digits.parse().ok()?;
        // `over02` is not a layer name; `over1` is just `over`.
        (k.to_string() == digits && (2..=MAX_LAYERS).contains(&k)).then_some((base, k))
    })
}

/// The palette serialized for the editor (`GET /patch/registry`). Shapes use
/// the same snake_case names as patch JSON; `kind` is `"number"` or
/// `{"select": [labels…]}`. Nodes, ports and params each carry a
/// `description`; nodes also their palette `group` ([`Group::id`]).
pub fn palette_json() -> serde_json::Value {
    use serde_json::json;
    let shape = |s: Shape| serde_json::to_value(s).expect("shape serializes");
    let category = |c: Category| match c {
        Category::Input => "input",
        Category::ScalarOp => "scalar",
        Category::Generator => "generator",
        Category::FieldOp => "field",
        Category::Combine => "combine",
        Category::Texture => "texture",
        Category::Sink => "sink",
        Category::Code => "code",
    };
    let ports = |ports: &[PortDef]| {
        ports
            .iter()
            .map(|p| {
                json!({
                    "name": p.name,
                    "shape": shape(p.shape),
                    "description": p.description,
                })
            })
            .collect::<Vec<_>>()
    };
    json!(
        TYPES
            .iter()
            .map(|t| {
                let mut entry = json!({
                    "id": t.id,
                    "label": t.label,
                    "category": category(t.category),
                    "group": t.group.id(),
                    "description": t.description,
                    // Whether "Convert to Code" is offered (see `convert`).
                    "convertible": crate::convert::convertible(t.id),
                    "inputs": ports(t.inputs),
                    "outputs": ports(t.outputs),
                    "params": t.params.iter().map(|p| json!({
                        "name": p.name,
                        "label": p.label,
                        "min": p.min,
                        "max": p.max,
                        "default": p.default,
                        "integrate": p.integrate,
                        "kind": match p.kind {
                            ParamKind::Number => json!("number"),
                            ParamKind::Select(options) => json!({ "select": options }),
                        },
                        "description": p.description,
                    })).collect::<Vec<_>>(),
                });
                // The inputs and params repeated per layer (see `layered`);
                // absent on kinds that have no layers.
                if !layered(t.id).is_empty() {
                    entry["layered"] = json!({ "names": layered(t.id), "max": MAX_LAYERS });
                }
                entry
            })
            .collect::<Vec<_>>()
    )
}

/// The wire shapes, for agents and the editor:
/// `[{"id", "label", "description", "accepts": [shape ids]}]`, where
/// `accepts` lists the shapes a wire may carry into an input of this shape
/// ([`Shape::accepts`]). `id` is the snake_case name used in patch JSON and
/// in [`palette_json`].
pub fn shapes_json() -> serde_json::Value {
    use serde_json::json;
    let id = |s: Shape| serde_json::to_value(s).expect("shape serializes");
    json!(
        Shape::ALL
            .iter()
            .map(|&s| {
                json!({
                    "id": id(s),
                    "label": s.label(),
                    "description": s.description(),
                    "accepts": Shape::ALL
                        .iter()
                        .filter(|&&from| s.accepts(from))
                        .map(|&from| id(from))
                        .collect::<Vec<_>>(),
                })
            })
            .collect::<Vec<_>>()
    )
}

const fn num(
    name: &'static str,
    label: &'static str,
    min: f32,
    max: f32,
    default: f32,
    description: &'static str,
) -> ParamDef {
    ParamDef {
        name,
        label,
        kind: ParamKind::Number,
        min,
        max,
        default,
        integrate: false,
        description,
    }
}

/// A `num` whose value is a rate: the engine integrates it into a phase.
const fn rate(
    name: &'static str,
    label: &'static str,
    min: f32,
    max: f32,
    default: f32,
    description: &'static str,
) -> ParamDef {
    ParamDef {
        name,
        label,
        kind: ParamKind::Number,
        min,
        max,
        default,
        integrate: true,
        description,
    }
}

const fn sel(
    name: &'static str,
    label: &'static str,
    options: &'static [&'static str],
    description: &'static str,
) -> ParamDef {
    ParamDef {
        name,
        label,
        kind: ParamKind::Select(options),
        min: 0.0,
        max: options.len() as f32 - 1.0,
        default: 0.0,
        integrate: false,
        description,
    }
}

const fn port(name: &'static str, shape: Shape, description: &'static str) -> PortDef {
    PortDef {
        name,
        shape,
        description,
    }
}

const COLOR_OUT: &[PortDef] = &[port(
    "out",
    Shape::FieldColor,
    "The colour field: RGB per pixel (may exceed 1; the Output soft-clips), plus a 0..1 coverage alpha that Blend's alpha_over uses.",
)];

/// Keep this order in step with `layers::EffectKind::ALL`. `None` is useful
/// while building a patch and makes an event mapping disable-able without
/// deleting its wiring.
const EFFECT_KINDS: &[&str] = &[
    "None", "Burst", "Strobe", "Swoosh", "Collapse", "Bloom", "Pinwheel", "Twinkle", "Wipe",
    "Star", "Heart", "Flower", "Diamond", "Triangle", "Moon", "Ring", "Rotate",
];

/// Shared description of a generator's integrated `speed`.
const SPEED: &str = "Animation rate, integrated into a phase (× the gate's master speed) so changes never jump; 0 freezes the motion.";

/// Shared color-mapping knobs used by every generator that owns its palette.
const HUE: ParamDef = num(
    "hue",
    "Hue",
    0.0,
    1.0,
    0.6,
    "Base hue in turns: 0 red, 1/3 green, 2/3 blue (wraps, so 1 is red again).",
);
const HUE_RANGE: ParamDef = num(
    "hue_range",
    "Hue range",
    0.0,
    1.0,
    0.2,
    "How far the hue spreads across the pattern, in turns added to Hue (0 = a single hue).",
);
const SATURATION: ParamDef = num(
    "saturation",
    "Saturation",
    0.0,
    1.0,
    0.9,
    "Colour saturation: 0 white/grey, 1 full colour.",
);
const BRIGHTNESS: ParamDef = num(
    "brightness",
    "Brightness",
    0.0,
    2.0,
    1.0,
    "Brightness multiplier: 0 black, 1 normal, above 1 overdrives toward the Output's soft clip.",
);

/// Shared by Touch mask and Touch glow.
const TOUCH_FIELD_PARAMS: &[ParamDef] = &[
    num(
        "radius",
        "Radius",
        0.01,
        0.8,
        0.12,
        "Blob radius in array radii (1 = centre to rim).",
    ),
    num(
        "soft",
        "Softness",
        0.0,
        1.0,
        0.6,
        "Edge softness: 0 a hard edge, 1 a wide soft falloff.",
    ),
    num(
        "fade",
        "Fade after release (s)",
        0.0,
        2.0,
        0.8,
        "Seconds a blob takes to fade out after its finger lifts (released fingers are kept at most 2 s).",
    ),
    num(
        "grow",
        "Grow while held",
        0.0,
        3.0,
        0.0,
        "How fast a held blob grows: its radius is multiplied by 1 + Grow × seconds held.",
    ),
    num(
        "trail",
        "Motion trail",
        0.0,
        2.0,
        0.3,
        "Stretches each blob back along its finger's motion, in proportion to the finger's speed.",
    ),
    num(
        "intensity",
        "Intensity",
        0.0,
        3.0,
        1.0,
        "Strength multiplier on the blobs (mask value or glow brightness).",
    ),
];

pub const TYPES: &[NodeType] = &[
    // -- Inputs -------------------------------------------------------------
    NodeType {
        id: "time",
        label: "Time",
        category: Category::Input,
        group: Group::Controls,
        description: "A clock. In Forever mode `out` counts up from Start at Rate per second (× master speed); Loop wraps from Start to End, Ping-pong bounces between them, Once stops at End. `phase` is the 0..1 position through Start→End and `wrap` fires at each loop, bounce or arrival — wire `out` into a knob for steady motion, `phase` for repeating sweeps.",
        inputs: &[port(
            "reset",
            Shape::Event,
            "Jumps the clock back to Start (and restarts its cycle count) when it fires.",
        )],
        outputs: &[
            port(
                "out",
                Shape::Scalar,
                "The clock value: Start + elapsed × Rate in Forever mode, else the position between Start and End.",
            ),
            port(
                "phase",
                Shape::Scalar,
                "0..1 through the Start→End span: cycles every span in Forever and Loop, goes back and forth in Ping-pong, holds at 1 in Once.",
            ),
            port(
                "wrap",
                Shape::Event,
                "Fires each time the clock wraps or bounces, or (Once) arrives at End.",
            ),
        ],
        params: &[
            num(
                "rate",
                "Rate (per second)",
                -8.0,
                8.0,
                1.0,
                "Units the clock advances per second (× master speed); negative runs it backwards.",
            ),
            sel(
                "mode",
                "Mode",
                &["forever", "loop", "ping-pong", "once"],
                "forever: count up without limit; loop: wrap from End back to Start; ping-pong: bounce between Start and End; once: stop at End.",
            ),
            num(
                "start",
                "Start",
                -100.0,
                100.0,
                0.0,
                "Value the clock starts from (and returns to on reset).",
            ),
            num(
                "end",
                "End",
                -100.0,
                100.0,
                1.0,
                "End of the Start→End span used by loop, ping-pong and once, and by `phase`.",
            ),
            num(
                "running",
                "Running (0 pauses)",
                0.0,
                1.0,
                1.0,
                "Above 0.5 the clock runs; below, it pauses where it is (wire a Toggle in).",
            ),
        ],
    },
    NodeType {
        id: "slider",
        label: "Slider",
        category: Category::Input,
        group: Group::Controls,
        description: "One knob as a Scalar: outputs Value. Use it to drive several inputs from one control, or as a knob to expose on the Control tab.",
        inputs: &[],
        outputs: &[port("out", Shape::Scalar, "The slider's value.")],
        params: &[num(
            "value",
            "Value",
            0.0,
            1.0,
            0.5,
            "The value it outputs (0..1 on the knob; a wired value passes through unclamped).",
        )],
    },
    NodeType {
        // The crew's master controls, as the gate applies them outside the
        // patch: a patch can react to them, e.g. dim its accents as the crew
        // dims the gate.
        id: "globals",
        label: "Gate globals",
        category: Category::Input,
        group: Group::Controls,
        description: "The crew's master controls as the gate applies them outside the patch: brightness (the Output is already scaled by it), speed (the multiplier every integrated param already follows) and the master hue pull. Use it to react to them — e.g. dim accents as the crew dims the gate; you never need it to apply them.",
        inputs: &[],
        outputs: &[
            port(
                "brightness",
                Shape::Scalar,
                "Master brightness 0..1 (already applied to the Output).",
            ),
            port(
                "speed",
                Shape::Scalar,
                "Master speed multiplier, 0 = paused (already applied to integrated params, Time, LFO and Random).",
            ),
            port(
                "hue",
                Shape::Scalar,
                "Target hue of the master hue pull, in turns 0..1.",
            ),
            port(
                "hue_amount",
                Shape::Scalar,
                "Strength of the master hue pull 0..1; 0 while the pull is off.",
            ),
        ],
        params: &[],
    },
    NodeType {
        id: "audio",
        label: "Audio",
        category: Category::Input,
        group: Group::Live,
        description: "Live analysis of one audio input: loudness, three bands, onsets and a tracked beat clock. Levels are normalised by a slow automatic gain so they read 0..1 at any volume. Wire bands into brightness or size knobs, `beat_phase` into Beat rings' front, or `beat` into an Envelope or Event effect.",
        inputs: &[],
        outputs: &[
            port(
                "level",
                Shape::Scalar,
                "Overall loudness (RMS), 0..1 after automatic gain.",
            ),
            port(
                "bass",
                Shape::Scalar,
                "Energy from 20 to 150 Hz, 0..1 after automatic gain.",
            ),
            port(
                "mid",
                Shape::Scalar,
                "Energy from 150 Hz to 2 kHz, 0..1 after automatic gain.",
            ),
            port(
                "treble",
                Shape::Scalar,
                "Energy from 2 to 8 kHz, 0..1 after automatic gain.",
            ),
            port(
                "onset",
                Shape::Scalar,
                "Jumps to 1 on a detected onset (a hit) and decays over about 0.15 s: a ready-made flash envelope.",
            ),
            port(
                "beat_phase",
                Shape::Scalar,
                "0..1 ramp through the current beat of the tracked tempo (0 on the beat); 0 while no tempo is locked.",
            ),
            port(
                "bpm",
                Shape::Scalar,
                "Tracked tempo in beats per minute (roughly 60–190); 0 while none.",
            ),
            port(
                "tempo",
                Shape::Scalar,
                "Tempo relative to 120 BPM (bpm / 120): multiply a speed by it to follow the music.",
            ),
            port(
                "beat",
                Shape::Event,
                "Fires on each beat of the tracked tempo (when beat_phase wraps).",
            ),
        ],
        params: &[sel(
            "source",
            "Source",
            &["1", "2", "3", "4"],
            "Which of the (up to four) audio inputs to read.",
        )],
    },
    NodeType {
        id: "imu",
        label: "Phone IMU",
        category: Category::Input,
        group: Group::Live,
        description: "Motion of the phone that currently holds the gate's motion control (phones take turns; a phone sends motion once enabled in its Settings). Outputs hold their last values; all read 0 until a phone has sent any.",
        inputs: &[],
        outputs: &[
            port(
                "yaw",
                Shape::Scalar,
                "Compass heading in radians, 0..2π.",
            ),
            port(
                "pitch",
                Shape::Scalar,
                "Forward/back tilt, -1..1 (±90°).",
            ),
            port(
                "roll",
                Shape::Scalar,
                "Left/right tilt, -1..1 (±90°).",
            ),
            port(
                "shake",
                Shape::Scalar,
                "Shake intensity, 0..3: jumps when the phone is shaken, then decays.",
            ),
        ],
        params: &[],
    },
    NodeType {
        // Fires whenever any effect is triggered (pads, keys, a client's tap
        // tool) — not raw touch; that is the Touch node below.
        id: "tap",
        label: "Effect taps",
        category: Category::Input,
        group: Group::Live,
        description: "Fires whenever anyone triggers an effect from a client: effect pads, keys, a tap on the preview with the tap tool. Not raw touch (that is the Touch node), and not effects fired by this patch's own Event effect nodes.",
        inputs: &[],
        outputs: &[port(
            "tap",
            Shape::Event,
            "Fires once per client-triggered effect.",
        )],
        params: &[],
    },
    NodeType {
        // Raw touch, one finger followed (see crate::touch).
        id: "touch",
        label: "Touch",
        category: Category::Input,
        group: Group::Live,
        description: "Raw touch from every connected client, following one finger. A patch with any Touch, Touch mask or Touch glow node owns the touch surface: clients send it raw touches instead of applying their own tap or pen tool, so Triggered effects and Touch strokes stop receiving taps and strokes. Outputs hold their last values after the finger lifts.",
        inputs: &[],
        outputs: &[
            port(
                "down",
                Shape::Event,
                "Fires when a finger touches down (First finger mode: only when the first finger lands).",
            ),
            port(
                "up",
                Shape::Event,
                "Fires when a finger lifts (First finger mode: only when the last finger lifts).",
            ),
            port(
                "active",
                Shape::Scalar,
                "1 while the followed finger is held, else 0.",
            ),
            port(
                "count",
                Shape::Scalar,
                "How many fingers are held right now.",
            ),
            port(
                "angle",
                Shape::Scalar,
                "The followed finger's angle in radians, in the composition frame (wires straight into Event effect's angle).",
            ),
            port(
                "radius",
                Shape::Scalar,
                "The followed finger's distance from the centre: 0 centre .. 1 outer edge (a little past 1 is possible).",
            ),
            port(
                "x",
                Shape::Scalar,
                "Screen x of the followed finger as the gate preview draws it, -1 left .. 1 right.",
            ),
            port(
                "y",
                Shape::Scalar,
                "Screen y of the followed finger, -1 bottom .. 1 top.",
            ),
            port(
                "held",
                Shape::Scalar,
                "Seconds since the followed finger touched down (frozen when it lifts).",
            ),
            port(
                "speed",
                Shape::Scalar,
                "Finger speed in array radii per second (0 once it has been still for about 0.1 s).",
            ),
            port(
                "dir",
                Shape::Scalar,
                "Direction the finger is moving on screen, in radians 0..2π.",
            ),
            port(
                "hue",
                Shape::Scalar,
                "The toucher's own colour hue in turns; -1 for white, or before anyone has touched.",
            ),
        ],
        params: &[sel(
            "follow",
            "Follow",
            &["Latest finger", "First finger"],
            "Latest finger: follow the most recent touch. First finger: follow the oldest held finger (and down/up mean the first lands / the last lifts).",
        )],
    },
    NodeType {
        id: "dj_link",
        label: "PRO DJ LINK",
        category: Category::Input,
        group: Group::Live,
        description: "Pioneer PRO DJ LINK state from the CDJs and mixer on the gate's network: transport, on-air and crossfade, beat in bar, rekordbox phrases, and an event per transport change. Only the desktop gate has a LINK (elsewhere everything reads 0 unless a host simulates it); use `active` to fall back to other inputs.",
        inputs: &[],
        outputs: &[
            port(
                "active",
                Shape::Scalar,
                "1 while a PRO DJ LINK source is connected and driving visuals, else 0.",
            ),
            port(
                "energy",
                Shape::Scalar,
                "Musical energy 0..1 of the followed deck (from the rekordbox waveform, or a beat-pulsed fallback).",
            ),
            port(
                "deck",
                Shape::Scalar,
                "Player number of the deck the gate follows (normally the tempo master); 0 if none.",
            ),
            port(
                "deck_side",
                Shape::Scalar,
                "-1 when the followed deck is player 1, +1 for player 2, 0 otherwise.",
            ),
            port(
                "event_deck",
                Shape::Scalar,
                "Player number of the deck that fired the most recent event.",
            ),
            port(
                "event_side",
                Shape::Scalar,
                "Side of the deck that fired the most recent event: -1 player 1, +1 player 2, 0 otherwise.",
            ),
            port(
                "playing",
                Shape::Scalar,
                "1 while the followed deck is playing.",
            ),
            port(
                "on_air",
                Shape::Scalar,
                "1 while the followed deck is on air at the mixer.",
            ),
            port("deck_1_on_air", Shape::Scalar, "1 while player 1 is on air."),
            port("deck_2_on_air", Shape::Scalar, "1 while player 2 is on air."),
            port(
                "looping",
                Shape::Scalar,
                "1 while player 1 or 2 is in a loop.",
            ),
            port(
                "mix",
                Shape::Scalar,
                "Eased crossfade position: 0 = player 1 alone on air, 1 = player 2, 0.5 = both; glides over about a second.",
            ),
            port(
                "mix_activity",
                Shape::Scalar,
                "How fast the mix is moving, 0..1, decaying over about half a second: high during a transition.",
            ),
            port(
                "beat_in_bar",
                Shape::Scalar,
                "Beat within the bar on the followed deck, 1..4 (0 when unknown).",
            ),
            port(
                "phrase_active",
                Shape::Scalar,
                "1 while a rekordbox phrase analysis covers the playhead.",
            ),
            port(
                "phrase_kind",
                Shape::Scalar,
                "The current phrase as a code: 1 intro, 2 up, 3 down, 4 chorus, 5 outro, 6 verse, 7 bridge, 0 none or unknown.",
            ),
            port(
                "phrase_progress",
                Shape::Scalar,
                "0..1 through the current phrase.",
            ),
            port(
                "phrase_fill",
                Shape::Scalar,
                "1 during the current phrase's fill-in.",
            ),
            port(
                "play",
                Shape::Event,
                "Fires when a deck starts playing (event_deck says which).",
            ),
            port(
                "cue",
                Shape::Event,
                "Fires when a deck goes to its cue point or starts cue-playing.",
            ),
            port(
                "cue_release",
                Shape::Event,
                "Fires when a deck's cue is released.",
            ),
            port(
                "on_air_event",
                Shape::Event,
                "Fires when a deck goes on air.",
            ),
            port(
                "off_air_event",
                Shape::Event,
                "Fires when a deck goes off air.",
            ),
            port("loop_start", Shape::Event, "Fires when a loop starts."),
            port(
                "loop_wrap",
                Shape::Event,
                "Fires each time a loop jumps back to its start.",
            ),
            port("loop_end", Shape::Event, "Fires when a loop ends."),
            port(
                "jump",
                Shape::Event,
                "Fires when a deck's playhead jumps within the track.",
            ),
            port(
                "phrase_change",
                Shape::Event,
                "Fires when a new rekordbox phrase begins.",
            ),
            port(
                "fill_in",
                Shape::Event,
                "Fires when the current phrase's fill-in starts.",
            ),
        ],
        params: &[],
    },
    NodeType {
        id: "event_effect",
        label: "Event effect",
        category: Category::ScalarOp,
        group: Group::Events,
        // The effects it fires are a stream: they show only where `effects`
        // is wired into a Render effects (through any further Event effects
        // chained on `in`, which merges the upstream stream into this one).
        description: "Fires a show effect (burst, strobe, sweeps, figures …) each time `trigger` fires, looking as its knobs say — wire Touch angle/radius into Angle/Radius to place it under a finger. The effects are a stream: they show only where `effects` reaches a Render effects node, directly or through further Event effects chained on `in`.",
        inputs: &[
            port(
                "trigger",
                Shape::Event,
                "Fires one effect each time an event arrives.",
            ),
            port(
                "in",
                Shape::Effects,
                "Another effects stream to merge into this node's output (chain Event effects, or start from Triggered effects).",
            ),
        ],
        outputs: &[port(
            "effects",
            Shape::Effects,
            "This node's effects plus everything chained into `in`; wire into Render effects to see them.",
        )],
        params: &[
            sel(
                "effect",
                "Effect",
                EFFECT_KINDS,
                "None: fires nothing (keeps the wiring). Burst: shockwave ring from Angle/Radius. Strobe: whole-array flash. Swoosh: an arm sweeping a full turn from Angle. Collapse: a ring closing from the rim to the centre. Bloom: a petalled iris opening from the centre. Pinwheel: spiral arms whipping up. Twinkle: a glitter storm. Wipe: a bar sweeping across toward Angle. Star, Heart, Flower, Diamond, Triangle, Moon: figures stamped at Angle/Radius. Ring: a clean ring expanding from the centre. Rotate: spins the whole composition (the sign of Angle picks the direction, Intensity the kick).",
            ),
            num(
                "angle",
                "Angle (rad)",
                -3.142,
                3.142,
                0.0,
                "Where the effect lands, in radians (composition frame, as Touch's angle); also Swoosh's start, Wipe's direction and Rotate's direction (by sign).",
            ),
            num(
                "radius",
                "Radius",
                0.0,
                1.2,
                0.5,
                "Distance of the origin from the centre: 0 centre .. 1 outer edge (Burst and the figures).",
            ),
            num(
                "intensity",
                "Intensity",
                0.0,
                2.0,
                1.2,
                "Brightness multiplier (for Rotate: the strength of the spin kick).",
            ),
            num(
                "size",
                "Size",
                0.1,
                4.0,
                1.0,
                "Width or scale multiplier for effects with a footprint (1 = default).",
            ),
            num(
                "hue",
                "Hue (-1 = white)",
                -1.0,
                1.0,
                -1.0,
                "Hue in turns; any negative value is white.",
            ),
            num(
                "saturation",
                "Saturation",
                0.0,
                1.0,
                0.9,
                "Colour saturation 0..1 (unused for white).",
            ),
            num(
                "brightness",
                "Brightness",
                0.0,
                1.0,
                1.0,
                "Colour value 0..1 (unused for white).",
            ),
            num(
                "duration",
                "Duration (0 = default)",
                0.0,
                10.0,
                0.0,
                "Lifetime in seconds; 0 uses the effect's own default (0.25 s for Strobe up to 1.8 s for figures).",
            ),
            num(
                "rotation",
                "Shape rotation",
                -3.142,
                3.142,
                0.0,
                "Figures only: the figure's own rotation in radians (separate from where it lands).",
            ),
            num(
                "grow",
                "Shape growth",
                -1.0,
                1.0,
                0.0,
                "Figures only: scale change over its life, × (1 + Grow × age): +1 doubles by the end, -1 shrinks to nothing.",
            ),
            num(
                "edge",
                "Shape edge",
                0.0,
                1.0,
                0.3,
                "Figures only: outline thickness, 0 hairline .. 1 fat (below about 0.3 the line breaks up between spokes).",
            ),
            num(
                "fill",
                "Shape fill",
                0.0,
                1.0,
                0.15,
                "Figures only: interior brightness, 0 outline only .. 1 solid.",
            ),
        ],
    },
    NodeType {
        id: "touch_dabs",
        label: "Touch strokes",
        category: Category::Input,
        group: Group::Live,
        description: "The live-draw strokes clients paint with their pen tool, as a Points stream (each dab keeps its pen, colour and size). Wire it into Render points to draw them. No strokes arrive while the patch reads raw touch (any Touch, Touch mask or Touch glow node).",
        inputs: &[],
        outputs: &[port(
            "points",
            Shape::Points,
            "Every live dab, each fading over its pen's lifetime.",
        )],
        params: &[],
    },
    NodeType {
        id: "effects_in",
        label: "Triggered effects",
        category: Category::Input,
        group: Group::Live,
        description: "The show effects clients trigger (effect pads, keys, taps on the preview), as an Effects stream. Wire it into Render effects, or into an Event effect's `in`: nothing reaches the Output unless it is wired.",
        inputs: &[],
        outputs: &[port(
            "effects",
            Shape::Effects,
            "Every live client-triggered effect.",
        )],
        params: &[],
    },
    NodeType {
        id: "video_in",
        label: "Video in",
        category: Category::Input,
        group: Group::Media,
        description: "The live video frame the host provides (a camera or video playing on the gate or in the playground), as a Texture. Map it onto the ring with Texture sample; transparent while no video plays.",
        inputs: &[],
        outputs: &[port("tex", Shape::Texture, "The current video frame (RGBA).")],
        params: &[],
    },
    NodeType {
        id: "image_in",
        label: "Still image in",
        category: Category::Input,
        group: Group::Media,
        description: "A still picture stored in the patch itself (the node's `media`: a 256×256 data:image URL), as a Texture for Texture sample. A patch carries at most four Still images and Clips together.",
        inputs: &[],
        outputs: &[port(
            "tex",
            Shape::Texture,
            "The picture (RGBA); transparent outside it and until it has loaded.",
        )],
        params: &[],
    },
    NodeType {
        // A short loop stored in the patch: `media` is a 256² sprite sheet of
        // grid×grid frames (see `clip_at`); `fps` integrates into a frame
        // phase, so speed changes never jump.
        id: "clip",
        label: "Clip",
        category: Category::Input,
        group: Group::Media,
        description: "A short looping animation stored in the patch: `media` is a 256×256 sprite sheet with its frames in a grid, row by row from the top left. It loops or ping-pongs at FPS (integrated, so speed changes never jump) or follows Scrub; map it onto the ring with Texture sample. Counts toward the four-picture limit with Still images.",
        inputs: &[],
        outputs: &[port("tex", Shape::Texture, "The current frame (RGBA).")],
        params: &[
            rate(
                "fps",
                "Frames per second",
                -30.0,
                30.0,
                10.0,
                "Frames per second (× master speed); negative plays backwards.",
            ),
            sel(
                "mode",
                "Mode",
                &["loop", "ping-pong", "scrub"],
                "loop: play the frames in order and wrap; ping-pong: forwards then backwards; scrub: show the frame Scrub picks.",
            ),
            num(
                "scrub",
                "Scrub (scrub mode)",
                0.0,
                1.0,
                0.0,
                "Scrub mode only: 0 the first frame .. 1 the last frame used (wire Touch or Time in).",
            ),
            num(
                "frames",
                "Frames used",
                1.0,
                64.0,
                16.0,
                "How many cells of the sheet are frames (counted row by row from the top left).",
            ),
            // The sheet's layout; the picker sets it. Append only.
            sel(
                "grid",
                "Sheet",
                &["4×4 (16 frames of 64 px)", "8×8 (64 frames of 32 px)", "2×2 (4 frames of 128 px)"],
                "The sheet's layout (the clip picker sets it to match the media).",
            ),
        ],
    },
    // -- Scalar ops ---------------------------------------------------------
    NodeType {
        id: "scalar_math",
        label: "Math",
        category: Category::ScalarOp,
        group: Group::Shape,
        description: "Control-rate arithmetic on A and B (wire Scalars in or set the knobs); unary ops use A only. A result that is not finite (dividing by 0, say) outputs 0.",
        inputs: &[],
        outputs: &[port("out", Shape::Scalar, "The result.")],
        params: &[
            // Append only: patches store the index. Unary ops use A.
            sel(
                "op",
                "Op",
                &[
                    "add",
                    "subtract",
                    "multiply",
                    "min",
                    "max",
                    "divide",
                    "modulo (wraps into 0..B)",
                    "power",
                    "greater than (1/0)",
                    "less than (1/0)",
                    "abs (A)",
                    "floor (A)",
                    "sine (A in turns)",
                    "cosine (A in turns)",
                ],
                "The operation. Modulo always lands in 0..B, negatives included (so `time mod 1` loops); comparisons output 1 or 0; sine and cosine take A in turns, i.e. sin(2π·A).",
            ),
            num(
                "a",
                "A",
                -8.0,
                8.0,
                0.0,
                "First operand (the only one for abs, floor, sine and cosine).",
            ),
            num("b", "B", -8.0, 8.0, 0.0, "Second operand."),
        ],
    },
    NodeType {
        id: "lfo",
        label: "LFO",
        category: Category::ScalarOp,
        group: Group::Motion,
        description: "A low-frequency oscillator: a repeating wave between Min and Max at Rate cycles per second (× master speed). Its phase survives edits, so changing the rate never jumps.",
        inputs: &[],
        outputs: &[port("out", Shape::Scalar, "The wave, between Min and Max.")],
        params: &[
            num(
                "rate",
                "Rate (Hz)",
                0.01,
                20.0,
                0.25,
                "Cycles per second (× master speed).",
            ),
            sel(
                "wave",
                "Wave",
                &["sine", "triangle", "square", "saw"],
                "sine: smooth; triangle: straight up and down; square: Max for the first half of each cycle, then Min; saw: ramps from Min to Max, then drops.",
            ),
            num("min", "Min", 0.0, 1.0, 0.0, "Value at the bottom of the wave."),
            num("max", "Max", 0.0, 1.0, 1.0, "Value at the top of the wave."),
        ],
    },
    NodeType {
        id: "smooth",
        label: "Smooth",
        category: Category::ScalarOp,
        group: Group::Shape,
        description: "Eases its output toward In with a one-pole low-pass filter, taking the jitter and steps out of audio bands, touch or stepped values.",
        inputs: &[],
        outputs: &[port("out", Shape::Scalar, "The smoothed value.")],
        params: &[
            num("in", "In", -8.0, 8.0, 0.0, "The value to follow."),
            num(
                "seconds",
                "Seconds",
                0.0,
                10.0,
                0.3,
                "Smoothing time constant in seconds (0 passes In straight through).",
            ),
        ],
    },
    NodeType {
        id: "envelope",
        label: "Envelope",
        category: Category::ScalarOp,
        group: Group::Motion,
        description: "An attack/decay envelope: each `trigger` restarts it from 0, rising linearly to Peak over Attack seconds, then decaying exponentially. Outputs 0 until first triggered; wire audio `beat` or Touch `down` in for flashes and pulses.",
        inputs: &[port("trigger", Shape::Event, "Restarts the envelope from 0.")],
        outputs: &[port("out", Shape::Scalar, "The envelope value, 0..Peak.")],
        params: &[
            num(
                "attack",
                "Attack (s)",
                0.0,
                5.0,
                0.01,
                "Seconds to rise from 0 to Peak.",
            ),
            num(
                "decay",
                "Decay (s)",
                0.0,
                10.0,
                0.5,
                "Decay time constant in seconds after the peak (about 37% of Peak remains after Decay seconds).",
            ),
            num("peak", "Peak", 0.0, 2.0, 1.0, "Height of the envelope."),
        ],
    },
    NodeType {
        // out = out_min + (in - in_min) / (in_max - in_min) * (out_max - out_min);
        // an inverted range (in_min > in_max, or out) flips the mapping.
        id: "map_range",
        label: "Map range",
        category: Category::ScalarOp,
        group: Group::Shape,
        description: "Linearly maps In from In min..In max onto Out min..Out max: out = Out min + (In − In min) / (In max − In min) × (Out max − Out min). An inverted range flips the mapping; Clamp keeps the result inside the out range.",
        inputs: &[],
        outputs: &[port("out", Shape::Scalar, "The mapped value.")],
        params: &[
            num("in", "In", -8.0, 8.0, 0.0, "The value to map."),
            num(
                "in_min",
                "In min",
                -8.0,
                8.0,
                0.0,
                "Input value that maps to Out min.",
            ),
            num(
                "in_max",
                "In max",
                -8.0,
                8.0,
                1.0,
                "Input value that maps to Out max.",
            ),
            num(
                "out_min",
                "Out min",
                -8.0,
                8.0,
                0.0,
                "Output when In equals In min.",
            ),
            num(
                "out_max",
                "Out max",
                -8.0,
                8.0,
                1.0,
                "Output when In equals In max.",
            ),
            sel(
                "clamp",
                "Clamp to the out range",
                &["off", "on"],
                "on: hold the result between Out min and Out max; off: extrapolate beyond them.",
            ),
        ],
    },
    NodeType {
        id: "mix",
        label: "Mix",
        category: Category::ScalarOp,
        group: Group::Shape,
        description: "A linear crossfade between two values: out = A + (B − A) × Mix.",
        inputs: &[],
        outputs: &[port("out", Shape::Scalar, "The blended value.")],
        params: &[
            num("a", "A", -8.0, 8.0, 0.0, "Value at Mix 0."),
            num("b", "B", -8.0, 8.0, 1.0, "Value at Mix 1."),
            num(
                "t",
                "Mix (0 = A, 1 = B)",
                0.0,
                1.0,
                0.5,
                "Crossfade amount: 0 = A, 1 = B (a wired value outside 0..1 extrapolates).",
            ),
        ],
    },
    NodeType {
        id: "clamp",
        label: "Clamp",
        category: Category::ScalarOp,
        group: Group::Shape,
        description: "Holds In between Min and Max (either may be the larger).",
        inputs: &[],
        outputs: &[port("out", Shape::Scalar, "In, limited to the range.")],
        params: &[
            num("in", "In", -8.0, 8.0, 0.0, "The value to limit."),
            num("min", "Min", -8.0, 8.0, 0.0, "One end of the allowed range."),
            num("max", "Max", -8.0, 8.0, 1.0, "The other end of the allowed range."),
        ],
    },
    NodeType {
        // The sequence is seeded from the node id, so a saved patch replays
        // the same values.
        id: "random",
        label: "Random",
        category: Category::ScalarOp,
        group: Group::Random,
        description: "A random value in Min..Max, drawn anew on every `trigger` and also Rate times a second when Rate > 0 (× master speed); Glide eases from one value to the next. Seeded from the node id, so a saved patch replays the same sequence.",
        inputs: &[port("trigger", Shape::Event, "Draws a new value now.")],
        outputs: &[
            port(
                "out",
                Shape::Scalar,
                "The current value (gliding toward the latest draw).",
            ),
            port(
                "changed",
                Shape::Event,
                "Fires each time a new value is drawn.",
            ),
        ],
        params: &[
            num(
                "rate",
                "Rate (Hz, 0 = trigger only)",
                0.0,
                20.0,
                0.0,
                "Automatic draws per second (× master speed); 0 draws only on trigger.",
            ),
            num("min", "Min", -8.0, 8.0, 0.0, "Lowest value drawn."),
            num("max", "Max", -8.0, 8.0, 1.0, "Highest value drawn."),
            num(
                "glide",
                "Glide (s)",
                0.0,
                5.0,
                0.0,
                "Seconds to ease from the old value to the new one (0 = jump).",
            ),
        ],
    },
    NodeType {
        // Seeded from the node id, like Random.
        id: "full_random",
        label: "Full random",
        category: Category::ScalarOp,
        group: Group::Random,
        description: "White noise: a fresh random value in Min..Max on every frame, uncorrelated with the last. Bell piles the values toward the middle. For jitter and flicker; Random holds a value, Random walk and Smooth noise wander.",
        inputs: &[],
        outputs: &[port("out", Shape::Scalar, "This frame's value.")],
        params: &[
            num("min", "Min", -8.0, 8.0, 0.0, "Lowest value."),
            num("max", "Max", -8.0, 8.0, 1.0, "Highest value."),
            sel(
                "distribution",
                "Distribution",
                &["Uniform", "Bell"],
                "Uniform: every value in range equally likely. Bell: a normal curve centred on the middle, ±3 standard deviations reaching the ends (clamped).",
            ),
        ],
    },
    NodeType {
        // Seeded from the node id, like Random.
        id: "random_walk",
        label: "Random walk",
        category: Category::ScalarOp,
        group: Group::Random,
        description: "A value that wanders by tiny random steps every frame (Brownian motion), kept within Min..Max, optionally pulled back toward the middle; a `step` event also makes one bigger random jump. Starts in the middle. Good for slow, natural drift of any knob.",
        inputs: &[
            port("step", Shape::Event, "Jumps by a random amount up to ±Jump now."),
            port("reset", Shape::Event, "Back to the middle of the range."),
        ],
        outputs: &[port("out", Shape::Scalar, "The current position.")],
        params: &[
            num(
                "wander",
                "Wander",
                0.0,
                2.0,
                0.25,
                "How far it typically drifts in one second, as a fraction of the range (× master speed); 0 moves only on `step`.",
            ),
            num(
                "jump",
                "Jump",
                0.0,
                1.0,
                0.2,
                "Largest jump a `step` event makes, as a fraction of the range.",
            ),
            num(
                "pull",
                "Pull",
                0.0,
                4.0,
                0.0,
                "Pull back toward the middle, per second (× master speed): 0 roams freely, higher stays closer to the centre.",
            ),
            num("min", "Min", -8.0, 8.0, 0.0, "One edge of the range."),
            num("max", "Max", -8.0, 8.0, 1.0, "The other edge."),
            sel(
                "edges",
                "Edges",
                &["Bounce", "Wrap", "Stick"],
                "At an edge, Bounce reflects back in, Wrap comes in from the other side (for hues and angles), Stick holds at the edge until it wanders away.",
            ),
        ],
    },
    NodeType {
        // Offset in the noise by the node id, so two of them differ.
        id: "smooth_noise",
        label: "Smooth noise",
        category: Category::ScalarOp,
        group: Group::Random,
        description: "Perlin noise over time: a smooth, never-repeating wander in Min..Max, built from Harmonics layers of noise at rising speeds. Roughness sets how much the faster layers add (low = lazy swells, high = nervous detail). The scalar sibling of Perlin noise.",
        inputs: &[],
        outputs: &[port("out", Shape::Scalar, "The current value.")],
        params: &[
            num(
                "speed",
                "Speed (Hz)",
                0.0,
                10.0,
                0.5,
                "Swells per second of the first harmonic (× master speed); 0 freezes it.",
            ),
            num(
                "harmonics",
                "Harmonics",
                1.0,
                8.0,
                3.0,
                "Layers of noise summed, each faster than the last (1 = one smooth wave).",
            ),
            num(
                "roughness",
                "Roughness",
                0.0,
                1.0,
                0.5,
                "Each harmonic's strength relative to the one before it.",
            ),
            num(
                "spacing",
                "Spacing",
                1.5,
                4.0,
                2.0,
                "Each harmonic's speed relative to the one before it.",
            ),
            num("min", "Min", -8.0, 8.0, 0.0, "Lowest value."),
            num("max", "Max", -8.0, 8.0, 1.0, "Highest value."),
        ],
    },
    NodeType {
        id: "counter",
        label: "Counter",
        category: Category::ScalarOp,
        group: Group::Events,
        description: "Counts `count` events. With Wrap at above 0 it wraps back to 0 on reaching it and fires `wrap`, which also makes it an every-Nth-event divider; `phase` is count / Wrap at.",
        inputs: &[
            port("count", Shape::Event, "Adds one."),
            port(
                "reset",
                Shape::Event,
                "Back to 0 (without firing wrap).",
            ),
        ],
        outputs: &[
            port(
                "out",
                Shape::Scalar,
                "The count, 0 .. Wrap at − 1.",
            ),
            port(
                "phase",
                Shape::Scalar,
                "count / Wrap at, 0..1 (0 when it never wraps).",
            ),
            port(
                "wrap",
                Shape::Event,
                "Fires each time the count wraps to 0 (every Nth event).",
            ),
        ],
        params: &[num(
            "steps",
            "Wrap at (0 = never)",
            0.0,
            64.0,
            8.0,
            "Count at which it wraps back to 0 (rounded); 0 counts forever.",
        )],
    },
    NodeType {
        id: "toggle",
        label: "Toggle",
        category: Category::ScalarOp,
        group: Group::Events,
        description: "A latch: `toggle` flips it, `set` turns it on and `clear` turns it off (several in one frame apply in that order); `on` and `off` fire on each change. Use it to switch things with a tap, or to gate events through Merge events' Open.",
        inputs: &[
            port("toggle", Shape::Event, "Flips the state."),
            port("set", Shape::Event, "Turns it on."),
            port("clear", Shape::Event, "Turns it off."),
        ],
        outputs: &[
            port("out", Shape::Scalar, "1 while on, else 0."),
            port("on", Shape::Event, "Fires when it turns on."),
            port("off", Shape::Event, "Fires when it turns off."),
        ],
        params: &[sel(
            "initial",
            "Starts",
            &["off", "on"],
            "Its state before any event arrives.",
        )],
    },
    NodeType {
        id: "threshold",
        label: "Threshold",
        category: Category::ScalarOp,
        group: Group::Shape,
        description: "Turns a Scalar into events: `rise` fires when In climbs above Level (plus half the Hysteresis), `fall` when it drops below Level (minus half); `out` is 1 while above. Hysteresis stops a noisy signal from chattering — use it to fire effects from an audio band.",
        inputs: &[],
        outputs: &[
            port("out", Shape::Scalar, "1 while In is above the level, else 0."),
            port("rise", Shape::Event, "Fires when In crosses upward."),
            port("fall", Shape::Event, "Fires when In crosses downward."),
        ],
        params: &[
            num("in", "In", -8.0, 8.0, 0.0, "The value to watch."),
            num("level", "Level", -8.0, 8.0, 0.5, "The threshold."),
            num(
                "hysteresis",
                "Hysteresis",
                0.0,
                2.0,
                0.05,
                "Dead band around Level: In must pass Level ± half of it to switch.",
            ),
        ],
    },
    NodeType {
        id: "delay",
        label: "Delay",
        category: Category::ScalarOp,
        group: Group::Events,
        description: "Delays events: each `in` event comes out Seconds later, then again every Seconds for Echoes more times. Real seconds (master speed does not apply); at most 64 events wait at once.",
        inputs: &[port("in", Shape::Event, "Events to delay.")],
        outputs: &[port(
            "out",
            Shape::Event,
            "The delayed events (several falling due in one frame fire once).",
        )],
        params: &[
            num(
                "seconds",
                "Seconds",
                0.0,
                10.0,
                0.5,
                "Delay, and the spacing of the echoes, in seconds (0 passes events straight through).",
            ),
            num(
                "echoes",
                "Echoes",
                0.0,
                16.0,
                0.0,
                "Extra repeats after the first delayed copy (rounded).",
            ),
        ],
    },
    NodeType {
        id: "event_merge",
        label: "Merge events",
        category: Category::ScalarOp,
        group: Group::Events,
        description: "Fires `out` whenever any of a..d fires, while Open is on: merge several triggers into one, or gate a stream of events by wiring a Toggle's `out` into Open.",
        inputs: &[
            port("a", Shape::Event, "An event to merge."),
            port("b", Shape::Event, "An event to merge."),
            port("c", Shape::Event, "An event to merge."),
            port("d", Shape::Event, "An event to merge."),
        ],
        outputs: &[port(
            "out",
            Shape::Event,
            "Fires when any input fires (at most once a frame).",
        )],
        params: &[num(
            "open",
            "Open (0 blocks)",
            0.0,
            1.0,
            1.0,
            "Above 0.5 events pass; below, they are blocked.",
        )],
    },
    NodeType {
        id: "sequence",
        label: "Step sequencer",
        category: Category::ScalarOp,
        group: Group::Motion,
        description: "Each `step` event advances through the first Steps values (Step 1..Step 8) and wraps, firing `wrap`; `out` is the current step's value and `index` its 0-based position. Wire beats into `step` for patterns that change with the music.",
        inputs: &[
            port("step", Shape::Event, "Advances one step."),
            port("reset", Shape::Event, "Back to Step 1."),
        ],
        outputs: &[
            port("out", Shape::Scalar, "The current step's value."),
            port("index", Shape::Scalar, "The current step, 0-based."),
            port(
                "wrap",
                Shape::Event,
                "Fires each time it wraps back to Step 1.",
            ),
        ],
        params: &[
            num(
                "steps",
                "Steps",
                1.0,
                8.0,
                4.0,
                "How many of the eight values to cycle through (rounded).",
            ),
            num("v1", "Step 1", -8.0, 8.0, 0.0, "Value at step 1."),
            num("v2", "Step 2", -8.0, 8.0, 0.25, "Value at step 2."),
            num("v3", "Step 3", -8.0, 8.0, 0.5, "Value at step 3."),
            num("v4", "Step 4", -8.0, 8.0, 0.75, "Value at step 4."),
            num("v5", "Step 5", -8.0, 8.0, 1.0, "Value at step 5."),
            num("v6", "Step 6", -8.0, 8.0, 0.75, "Value at step 6."),
            num("v7", "Step 7", -8.0, 8.0, 0.5, "Value at step 7."),
            num("v8", "Step 8", -8.0, 8.0, 0.25, "Value at step 8."),
        ],
    },
    // -- Generators ---------------------------------------------------------
    NodeType {
        id: "solid",
        label: "Solid",
        category: Category::Generator,
        group: Group::Blocks,
        description: "One colour over the whole array, fully opaque. Use it as a background, as a flat colour to Blend with, or as a tint to Multiply over a pattern.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[HUE, SATURATION, BRIGHTNESS],
    },
    NodeType {
        id: "gradient",
        label: "Gradient",
        category: Category::Generator,
        group: Group::Blocks,
        description: "A Field<f32> ramp across the array: along each spoke (Inner at the inner end, Outer at the rim) or once around the ring (Inner at angle 0, reaching Outer a full turn later). Feed it to Colorize, Palette, Field math or a mask.",
        inputs: &[],
        outputs: &[port("out", Shape::FieldScalar, "The ramp value at each pixel.")],
        params: &[
            sel(
                "along",
                "Along",
                &["radius", "angle"],
                "radius: from the inner end of each spoke to the rim; angle: once around the ring.",
            ),
            num(
                "inner",
                "Inner",
                0.0,
                1.0,
                0.0,
                "Value at the inner end (or at angle 0).",
            ),
            num(
                "outer",
                "Outer",
                0.0,
                1.0,
                1.0,
                "Value at the rim (or after a full turn).",
            ),
        ],
    },
    NodeType {
        id: "noise_field",
        label: "Noise field",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Drifting fractal simplex noise, thresholded into soft clouds and coloured by the noise value; the alpha follows the clouds. A good organic base layer.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "scale",
                "Scale",
                0.1,
                8.0,
                1.0,
                "Feature density: higher makes smaller, busier clouds.",
            ),
            rate("speed", "Speed", 0.0, 4.0, 1.0, SPEED),
            num(
                "threshold",
                "Threshold",
                0.0,
                1.0,
                0.5,
                "Cut level: higher leaves less of the noise lit.",
            ),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "radial_waves",
        label: "Radial waves",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Concentric rings rippling outward from the centre, built from up to eight harmonics; the hue shifts with radius by Hue range.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "waves",
                "Waves",
                1.0,
                8.0,
                3.0,
                "Harmonics summed (1 = a pure sine; more = peakier, more complex rings).",
            ),
            num(
                "scale",
                "Scale",
                0.1,
                8.0,
                1.0,
                "Ring density across the radius.",
            ),
            rate("speed", "Speed", 0.0, 4.0, 1.0, SPEED),
            num(
                "sharpness",
                "Sharpness",
                0.0,
                1.0,
                0.5,
                "Narrows the bright bands (0 = a soft sine).",
            ),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "spiral",
        label: "Spiral",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Spiral arms turning around the centre: Twist curls them with radius and Speed spins them (negative reverses). The hue shifts slightly toward the rim.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("arms", "Arms", 1.0, 12.0, 3.0, "Number of arms (rounded)."),
            num(
                "twist",
                "Twist",
                -4.0,
                4.0,
                1.0,
                "Turns of curl from centre to rim; the sign sets the handedness (0 = straight arms).",
            ),
            rate(
                "speed",
                "Speed",
                -4.0,
                4.0,
                1.0,
                "Spin rate, integrated into a phase (× master speed); negative spins the other way, 0 stops.",
            ),
            num(
                "sharpness",
                "Sharpness",
                0.0,
                1.0,
                0.5,
                "Narrows the arms (0 = wide soft arms).",
            ),
            HUE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "gradient_radial",
        label: "Radial gradient",
        category: Category::Generator,
        group: Group::Blocks,
        description: "Fully lit hue bands from the centre to the rim, scrolling toward the centre over time (Drift). The simplest colourful background.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            rate(
                "drift",
                "Drift",
                0.0,
                4.0,
                0.5,
                "Scroll rate of the bands, integrated (× master speed); 0 holds still.",
            ),
            HUE,
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Hue change per array radius, in turns (0 = one flat hue).",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "noise_color",
        label: "Color noise",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Three independent simplex noises as red, green and blue, leaning 60% toward the Hue/Saturation tint: shifting multicoloured clouds, fully opaque.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "scale",
                "Scale",
                0.1,
                8.0,
                1.0,
                "Feature density: higher makes smaller, busier clouds.",
            ),
            rate("speed", "Speed", 0.0, 4.0, 1.0, SPEED),
            num(
                "hue",
                "Hue",
                0.0,
                1.0,
                0.6,
                "Hue of the tint the colours lean toward, in turns.",
            ),
            num(
                "saturation",
                "Saturation",
                0.0,
                1.0,
                0.9,
                "Saturation of the tint (0 = no tint).",
            ),
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "perlin_noise",
        label: "Perlin noise",
        category: Category::Generator,
        group: Group::Blocks,
        description: "Classic Perlin gradient noise as a grey 0..1 field, evolving over time: Harmonics layers (octaves) at rising detail, Roughness and Spacing shaping how they stack, and a Style for soft clouds, billows or sharp ridges. Wire it into Colorize or Palette for colour, into Field math as a mask, or straight into Output as grey.",
        inputs: &[],
        outputs: &[port(
            "out",
            Shape::FieldScalar,
            "The noise, 0..1 per pixel (0.5 on average).",
        )],
        params: &[
            num(
                "scale",
                "Scale",
                0.1,
                8.0,
                1.5,
                "Size of the first harmonic's features: higher makes them smaller and busier.",
            ),
            num(
                "harmonics",
                "Harmonics",
                1.0,
                8.0,
                4.0,
                "Layers of noise summed, each finer than the last (1 = plain, smooth Perlin).",
            ),
            num(
                "roughness",
                "Roughness",
                0.0,
                1.0,
                0.5,
                "Each harmonic's strength relative to the one before it: low stays soft, high is grainy.",
            ),
            num(
                "spacing",
                "Spacing",
                1.5,
                4.0,
                2.0,
                "Each harmonic's frequency relative to the one before it (2 = an octave).",
            ),
            sel(
                "style",
                "Style",
                &["Smooth", "Billowy", "Ridged"],
                "Smooth: plain fractal noise. Billowy: the absolute value of each layer, puffy clouds with dark creases. Ridged: inverted creases, sharp bright ridges like veins or lightning.",
            ),
            num(
                "contrast",
                "Contrast",
                0.0,
                4.0,
                1.0,
                "Stretches the values away from (above 1) or toward (below 1) the middle grey, clamped to 0..1.",
            ),
            rate(
                "speed",
                "Speed",
                0.0,
                4.0,
                0.3,
                "How fast the noise evolves in place, integrated (× the gate's master speed) so changes never jump; 0 freezes it.",
            ),
            num(
                "seed",
                "Seed",
                0.0,
                100.0,
                0.0,
                "Picks a different stretch of noise, so two Perlin nodes need not match.",
            ),
        ],
    },
    NodeType {
        id: "random_field",
        label: "Full random field",
        category: Category::Generator,
        group: Group::Blocks,
        description: "Static: an independent random grey value 0..1 for every LED (or every spoke, or every ring), re-rolled Rate times a second. Keys on the physical LED, so Transform does not move it. A mask for glitter and glitches, or TV snow straight into Output.",
        inputs: &[],
        outputs: &[port(
            "out",
            Shape::FieldScalar,
            "A random 0..1 per LED, spoke or ring.",
        )],
        params: &[
            rate(
                "rate",
                "Rate (Hz)",
                0.0,
                60.0,
                30.0,
                "Re-rolls per second (× master speed; 30 and up looks like every frame); 0 freezes the pattern.",
            ),
            sel(
                "grain",
                "Grain",
                &["LED", "Spoke", "Ring"],
                "What shares one value: each LED, a whole spoke, or every LED at the same distance from the centre.",
            ),
            num(
                "seed",
                "Seed",
                0.0,
                100.0,
                0.0,
                "Picks a different pattern, so two of these need not match.",
            ),
        ],
    },
    NodeType {
        id: "plasma",
        label: "Plasma",
        category: Category::Generator,
        group: Group::Patterns,
        description: "The classic demoscene plasma: overlapping sine waves across the disc, giving smoothly morphing blobs whose brightness and hue follow the wave sum. Fully opaque.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "scale",
                "Scale",
                0.1,
                8.0,
                1.0,
                "Wave density: higher makes smaller blobs.",
            ),
            rate("speed", "Speed", 0.0, 4.0, 1.0, SPEED),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "spoke_chase",
        label: "Spoke chase",
        category: Category::Generator,
        group: Group::Patterns,
        description: "A bright head on every spoke running along it with an exponential tail, each spoke offset at random and tinted by Hue range: rain or comets running along the spokes.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            rate(
                "speed",
                "Speed",
                0.0,
                8.0,
                1.0,
                "Running rate, integrated (× master speed): at 1 a head takes about 5 s to run a spoke; 0 stops.",
            ),
            sel(
                "direction",
                "Direction",
                &["inward", "outward"],
                "inward: heads run from the rim toward the centre; outward: from the centre to the rim.",
            ),
            num(
                "tail",
                "Tail length",
                0.05,
                0.45,
                0.2,
                "Tail length as a fraction of the spoke.",
            ),
            HUE,
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Random hue spread between spokes, in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "touch_mask",
        label: "Touch mask",
        category: Category::Generator,
        group: Group::Blocks,
        description: "Every held (and recently lifted) finger as a soft blob in a 0..1 Field<f32> mask, the strongest blob winning where they overlap. Use it as a mask for Colorize, Field math or Blend so touch reveals or paints a pattern. Reading touch makes the patch own the touch surface (see Touch).",
        inputs: &[],
        outputs: &[port(
            "out",
            Shape::FieldScalar,
            "Finger coverage, 0..1 × Intensity.",
        )],
        params: TOUCH_FIELD_PARAMS,
    },
    NodeType {
        id: "touch_glow",
        label: "Touch glow",
        category: Category::Generator,
        group: Group::Patterns,
        description: "The same finger blobs as Touch mask, each in its toucher's own colour (white for clients without one), summed into a colour field whose alpha is the coverage. Reading touch makes the patch own the touch surface (see Touch).",
        inputs: &[],
        outputs: &[port(
            "out",
            Shape::FieldColor,
            "The glow: colours summed over fingers × Intensity; alpha is the strongest coverage.",
        )],
        params: TOUCH_FIELD_PARAMS,
    },
    NodeType {
        id: "sparkle",
        label: "Sparkle",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Glitter: random LEDs flash and fade, each LED re-rolling its chance every twinkle; hues spread by Hue range. It keys on the physical LED, so Transform does not move it.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "density",
                "Density",
                0.0,
                1.0,
                0.5,
                "Share of LEDs lit per twinkle (1 = 20% of them).",
            ),
            num(
                "twinkle",
                "Twinkle rate",
                0.0,
                1.0,
                0.5,
                "How often the LEDs re-roll: 0 = 4, 1 = 24 twinkles per unit of phase.",
            ),
            rate("speed", "Speed", 0.0, 4.0, 1.0, SPEED),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "beat_rings",
        label: "Beat rings",
        category: Category::Generator,
        group: Group::Patterns,
        description: "One soft ring at Front along the radius, dimming to half as it reaches the far end, its hue shifting with position. Wire audio `beat_phase` into Front for a ring per beat, or an Envelope or Time phase for other sweeps.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            // Wire audio.beat_phase in here for the classic beat-ring look.
            num(
                "front",
                "Front position",
                0.0,
                1.0,
                0.0,
                "Ring position: 0 at the starting end, 1 at the far end (see Direction).",
            ),
            num(
                "width",
                "Ring width",
                0.02,
                0.32,
                0.1,
                "Ring width as a fraction of the spoke.",
            ),
            sel(
                "direction",
                "Direction",
                &["outward", "inward"],
                "outward: Front 0 is the inner end and 1 the rim; inward: the reverse.",
            ),
            HUE,
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Hue shift as the ring travels from Front 0 to 1, in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "breathe",
        label: "Breathe",
        category: Category::Generator,
        group: Group::Patterns,
        description: "The whole array pulsing slowly in white between Depth floor and full brightness. It is uncoloured: Multiply-blend it over a pattern to make that pattern breathe.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            rate(
                "speed",
                "Speed",
                0.0,
                4.0,
                1.0,
                "Breathing rate, integrated (× master speed): at 1 a breath takes about 6.3 s; 0 holds.",
            ),
            num(
                "floor",
                "Depth floor",
                0.0,
                1.0,
                0.3,
                "Brightness at the bottom of each breath, as a fraction of the top.",
            ),
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "rainbow",
        label: "Rainbow",
        category: Category::Generator,
        group: Group::Patterns,
        description: "A hue wheel around the ring (repeated Turns times), optionally shifting toward the rim by Hue range; Speed rotates the colours. Fully opaque.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "turns",
                "Turns",
                1.0,
                4.0,
                1.0,
                "Times the hue wheel repeats around the ring (rounded).",
            ),
            rate(
                "speed",
                "Speed",
                0.0,
                4.0,
                1.0,
                "Colour rotation rate, integrated (× master speed); 0 holds still.",
            ),
            num(
                "hue",
                "Hue",
                0.0,
                1.0,
                0.6,
                "Hue offset of the wheel, in turns.",
            ),
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Extra hue shift per array radius, in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "wedges",
        label: "Wedges",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Bright pie slices with dark gaps around the ring, soft-edged, sheared into a pinwheel by Twist and rotating with Speed; each slice is half Hue, half Hue + Hue range. Flash lights the gaps too (wire audio onset in for an on-beat flash).",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "slices",
                "Slices",
                2.0,
                16.0,
                8.0,
                "Number of slices (rounded).",
            ),
            num(
                "softness",
                "Edge softness",
                0.05,
                0.35,
                0.15,
                "Softness of the slice edges.",
            ),
            num(
                "twist",
                "Radial twist",
                0.0,
                1.0,
                0.5,
                "Shears the slices with radius into a pinwheel (0 = straight).",
            ),
            // Wire audio.onset in here for the classic on-beat flash.
            num(
                "flash",
                "Flash",
                0.0,
                1.0,
                0.0,
                "Lights the gaps: 0 none .. 1 the whole ring lit.",
            ),
            rate(
                "speed",
                "Speed",
                0.0,
                4.0,
                1.0,
                "Rotation rate, integrated (× master speed); 0 holds still.",
            ),
            HUE,
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Hue difference between the two halves of each slice, in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "interference",
        label: "Interference",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Two point sources orbiting the centre, their circular waves interfering into moving moiré fringes.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "frequency",
                "Frequency",
                0.0,
                1.0,
                0.5,
                "Wave density: more, tighter fringes.",
            ),
            num(
                "orbit",
                "Orbit size",
                0.0,
                1.0,
                0.5,
                "Size of the sources' orbits.",
            ),
            num(
                "sharpness",
                "Sharpness",
                0.0,
                1.0,
                0.5,
                "Narrows the bright fringes.",
            ),
            num(
                "scale",
                "Scale",
                0.1,
                8.0,
                1.0,
                "Overall wave-density multiplier.",
            ),
            rate("speed", "Speed", 0.0, 4.0, 1.0, SPEED),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "fire",
        label: "Fire",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Flames licking inward from the rim: fractal noise rising along each spoke, hottest at the outer edge, the hottest parts paling toward white. Hue sets the flame colour — near 0 (red-orange) for classic fire; the default 0.6 burns blue.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "reach",
                "Flame reach",
                0.0,
                1.0,
                0.5,
                "How far toward the centre the flames reach.",
            ),
            num(
                "stretch",
                "Flame stretch",
                0.0,
                1.0,
                0.5,
                "Elongates the flames along the spokes.",
            ),
            num(
                "scale",
                "Scale",
                0.1,
                8.0,
                1.0,
                "Noise scale around the ring: higher gives more, narrower tongues.",
            ),
            rate("speed", "Speed", 0.0, 4.0, 1.0, SPEED),
            num(
                "hue",
                "Hue",
                0.0,
                1.0,
                0.6,
                "Flame base hue in turns (the hottest parts shift about 0.12 above it); near 0 for red-orange fire.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "cosmic_drift",
        label: "Cosmic drift",
        category: Category::Generator,
        group: Group::Patterns,
        description: "A deep-space flight: dim nebula clouds and filaments drifting past, with six bright travellers streaking outward along curving lanes. Fully opaque.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "depth",
                "Cloud depth",
                0.0,
                1.0,
                0.55,
                "Depth and detail of the nebula clouds.",
            ),
            num(
                "trail",
                "Traveller trails",
                0.0,
                1.0,
                0.45,
                "Length of the travellers' tails.",
            ),
            rate(
                "speed",
                "Flight speed",
                0.0,
                4.0,
                0.35,
                "Flight speed, integrated (× master speed); 0 holds still.",
            ),
            num(
                "pulse",
                "Pulse",
                0.0,
                1.0,
                0.0,
                "Extra traveller brightness (wire audio onset or an Envelope in to pulse with the music).",
            ),
            num("hue", "Hue", 0.0, 1.0, 0.6, "Nebula hue, in turns."),
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Hue spread of the clouds and travellers, in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "earth_current",
        label: "Forest canopy",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Layered canopy leaves swaying in the wind, with shadowed depths and sunlit highlights; green by default (Shadow green and Leaf hue set the colours). Fully opaque.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "scale",
                "Leaf scale",
                0.1,
                4.0,
                0.9,
                "Leaf density: higher packs in more, smaller leaf masses.",
            ),
            num(
                "warp",
                "Wind bend",
                0.0,
                1.0,
                0.6,
                "How much the wind bends the leaves.",
            ),
            num(
                "width",
                "Leaf coverage",
                0.0,
                1.0,
                0.5,
                "How much of the canopy is lit leaf.",
            ),
            rate(
                "speed",
                "Wind speed",
                0.0,
                4.0,
                0.22,
                "Wind speed, integrated (× master speed); 0 holds still.",
            ),
            num(
                "pulse",
                "Dappled sun",
                0.0,
                1.0,
                0.0,
                "Brightens the sunlit layer (wire audio onset in to flicker it).",
            ),
            num(
                "root_hue",
                "Shadow green",
                0.0,
                1.0,
                0.39,
                "Hue of the deep shadow layer, in turns.",
            ),
            num(
                "leaf_hue",
                "Leaf hue",
                0.0,
                1.0,
                0.31,
                "Base hue of the leaves, in turns (the layers vary around it).",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "meteors",
        label: "Meteors",
        category: Category::Generator,
        group: Group::Patterns,
        description: "Meteors shooting along random spokes with fading tails, each spoke launching at random times.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "density",
                "Density",
                0.0,
                1.0,
                0.5,
                "Share of spokes carrying a meteor at a time.",
            ),
            num(
                "tail",
                "Rate / tail",
                0.0,
                1.0,
                0.5,
                "Both how often meteors launch and how long their tails are.",
            ),
            sel(
                "direction",
                "Direction",
                &["inward", "outward"],
                "inward: from the rim toward the centre; outward: from the centre to the rim.",
            ),
            rate("speed", "Speed", 0.0, 4.0, 1.0, SPEED),
            HUE,
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Random hue spread between meteors, in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "warp",
        label: "Warp",
        category: Category::Generator,
        group: Group::Patterns,
        description: "A hyperspace starfield: short star streaks rushing outward along the spokes, brighter toward the rim. Colours stay pale (saturation × 0.6).",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num(
                "density",
                "Star density",
                0.0,
                1.0,
                0.5,
                "How many stars, and how closely they follow each other along a spoke.",
            ),
            rate(
                "speed",
                "Speed",
                0.0,
                8.0,
                1.0,
                "Rush speed, integrated (× master speed); 0 holds still.",
            ),
            HUE,
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Random hue spread between stars, in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "waveform",
        label: "Waveform",
        category: Category::Generator,
        group: Group::Patterns,
        description: "An oscilloscope ring: a circle whose radius wobbles with the live audio waveform, traced once around the ring; Drift rotates the trace.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            sel(
                "source",
                "Source",
                &["1", "2", "3", "4"],
                "Which audio input's waveform to draw.",
            ),
            num(
                "ring",
                "Ring radius",
                0.0,
                1.0,
                0.5,
                "Base radius of the circle: 0 = 0.35, 1 = 0.95 of the array radius.",
            ),
            num(
                "depth",
                "Depth",
                0.0,
                1.0,
                0.5,
                "How far the waveform pushes the ring in and out.",
            ),
            num(
                "thickness",
                "Thickness",
                0.0,
                1.0,
                0.5,
                "Line thickness.",
            ),
            rate(
                "drift",
                "Drift",
                0.0,
                4.0,
                1.0,
                "Rotation rate of the trace, integrated (× master speed); 0 holds still.",
            ),
            HUE,
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Hue shift with the waveform's value, in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "spectrum",
        label: "Spectrum",
        category: Category::Generator,
        group: Group::Patterns,
        description: "A radial spectrum analyser: 64 log-spaced frequency bars around the ring, lows to highs, each growing along its spokes with that band's energy.",
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            sel(
                "source",
                "Source",
                &["1", "2", "3", "4"],
                "Which audio input's spectrum to draw.",
            ),
            num(
                "length",
                "Bar length",
                0.0,
                1.0,
                0.5,
                "How far a loud band's bar reaches along the spoke.",
            ),
            sel(
                "from",
                "Bars grow from",
                &["outer", "inner"],
                "outer: bars grow inward from the rim; inner: outward from the inner end.",
            ),
            rate(
                "drift",
                "Drift",
                0.0,
                4.0,
                1.0,
                "Rotation rate of the bars, integrated (× master speed); 0 holds still.",
            ),
            HUE,
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Hue shift once around the ring (lows to highs), in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        // After a Transform it reports the transformed position.
        id: "coordinate",
        label: "Coordinate",
        category: Category::Generator,
        group: Group::Blocks,
        description: "The pixel's own position as a Field<f32>, for building custom gradients and masks with Field math, Colorize or Palette. After a Transform it reports the transformed position (except Spoke, which stays physical).",
        inputs: &[],
        outputs: &[port(
            "out",
            Shape::FieldScalar,
            "The chosen coordinate × Scale + Offset (wrapped into 0..1 if Wrap is on).",
        )],
        params: &[
            sel(
                "which",
                "Which",
                &["radius", "angle", "x", "y", "spoke", "pixel"],
                "radius: 0 at the inner end .. 1 at the rim; angle: once around the ring in turns, 0..1; x, y: 0..1 across the disc; spoke: the spoke's index as a fraction 0..1; pixel: position along the spoke, 0 at the outer end .. 1 at the inner end.",
            ),
            num(
                "scale",
                "Scale",
                -8.0,
                8.0,
                1.0,
                "Multiplier on the coordinate (negative flips it).",
            ),
            num(
                "offset",
                "Offset",
                -2.0,
                2.0,
                0.0,
                "Added after scaling.",
            ),
            sel(
                "wrap",
                "Wrap into 0..1",
                &["off", "on"],
                "on: keep only the fractional part, so the ramp repeats Scale times.",
            ),
        ],
    },
    NodeType {
        // What the array showed last frame, at this pixel (after a Transform:
        // at the transformed position, so zoom/rotate trails work).
        id: "feedback",
        label: "Feedback",
        category: Category::Generator,
        group: Group::Blocks,
        description: "What the array showed last frame at this pixel (the final, mastered picture) times Decay — downstream of a Transform, at the transformed position. Blend new content over it (Blend max or add, with a Transform zoom or spin in between) for trails, echoes and tunnels. Black in node thumbnails.",
        inputs: &[],
        outputs: &[port(
            "out",
            Shape::FieldColor,
            "Last frame's colour × Decay; alpha is its brightest channel.",
        )],
        params: &[num(
            "decay",
            "Decay",
            0.0,
            1.0,
            0.9,
            "How much of last frame survives each frame: 0 none, 1 everything (trails never fade).",
        )],
    },
    // -- Field ops ----------------------------------------------------------
    NodeType {
        id: "transform",
        label: "Transform",
        category: Category::FieldOp,
        group: Group::Color,
        description: "Moves where everything upstream is sampled: rotate, spin, zoom, an N-way kaleidoscope and a left/right mirror, for any colour field (generators, video, feedback). Nodes that key on the physical LED or spoke (Sparkle, and the per-spoke randomness of Spoke chase, Meteors and Warp) only partly follow it.",
        inputs: &[port("in", Shape::FieldColor, "The colour field to transform.")],
        outputs: &[port("out", Shape::FieldColor, "The transformed field.")],
        params: &[
            num(
                "rotate",
                "Rotate (turns)",
                -1.0,
                1.0,
                0.0,
                "Fixed rotation in turns (wire Time in for steady rotation that never wraps).",
            ),
            rate(
                "spin",
                "Spin (turns/s)",
                -2.0,
                2.0,
                0.0,
                "Continuous rotation in turns per second, integrated (× master speed); negative spins the other way.",
            ),
            num(
                "zoom",
                "Zoom",
                0.1,
                8.0,
                1.0,
                "Magnification: above 1 enlarges the pattern (samples nearer the centre), below 1 shrinks it.",
            ),
            num(
                "kaleido",
                "Kaleidoscope",
                0.0,
                10.0,
                0.0,
                "Kaleidoscope segments (rounded): 2 or more folds the disc into that many mirrored wedges; 0 or 1 is off.",
            ),
            sel(
                "mirror",
                "Mirror",
                &["off", "on"],
                "on: mirror one half of the disc onto the other (left/right).",
            ),
        ],
    },
    NodeType {
        id: "colorize",
        label: "Colorize",
        category: Category::FieldOp,
        group: Group::Color,
        description: "Turns a Field<f32> into colour: brightness follows the value (× Brightness), hue is Hue + value × Hue range, alpha is the value clamped to 0..1. A Scalar wired into `in` colours the whole array uniformly.",
        inputs: &[port(
            "in",
            Shape::FieldScalar,
            "The value field (typically 0..1); unwired reads 0, which is black.",
        )],
        outputs: COLOR_OUT,
        params: &[
            num("hue", "Hue", 0.0, 1.0, 0.6, "Hue at value 0, in turns."),
            num(
                "hue_range",
                "Hue range",
                0.0,
                1.0,
                0.2,
                "Hue added per unit of value, in turns.",
            ),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "field_math",
        label: "Field math",
        category: Category::FieldOp,
        group: Group::Color,
        description: "Per-pixel arithmetic on two Field<f32> inputs: (A op B) × Gain + Offset. A Scalar wired into A or B becomes a uniform field; an unwired input reads 0.",
        inputs: &[
            port("a", Shape::FieldScalar, "First operand (the only one for invert)."),
            port("b", Shape::FieldScalar, "Second operand."),
        ],
        outputs: &[port(
            "out",
            Shape::FieldScalar,
            "(A op B) × Gain + Offset at each pixel.",
        )],
        params: &[
            // Append only. Unary ops use A.
            sel(
                "op",
                "Op",
                &[
                    "add",
                    "subtract",
                    "multiply",
                    "min",
                    "max",
                    "difference",
                    "greater than (1/0)",
                    "step (A around B)",
                    "invert (1 − A)",
                    "power",
                ],
                "add, subtract, multiply, min, max; difference: |A − B|; greater than: 1 where A > B, else 0; step: a soft 0→1 edge as A passes B ± 0.1; invert: 1 − A; power: A (clamped to ≥ 0) raised to B.",
            ),
            num(
                "gain",
                "Gain",
                -4.0,
                4.0,
                1.0,
                "Multiplier on the result.",
            ),
            num(
                "offset",
                "Offset",
                -2.0,
                2.0,
                0.0,
                "Added after Gain.",
            ),
        ],
    },
    NodeType {
        id: "luminance",
        label: "Brightness of",
        category: Category::FieldOp,
        group: Group::Color,
        description: "Measures a colour field back into a Field<f32> (perceived luminance, the brightest channel, or the alpha coverage) to drive masks, Field math or Palette from any pattern or video.",
        inputs: &[port("in", Shape::FieldColor, "The colour field to measure.")],
        outputs: &[port("out", Shape::FieldScalar, "The measurement at each pixel.")],
        params: &[sel(
            "measure",
            "Measure",
            &["luminance", "brightest channel", "alpha"],
            "luminance: perceived brightness (Rec. 709 weights); brightest channel: max(R, G, B); alpha: the field's coverage.",
        )],
    },
    NodeType {
        id: "color_adjust",
        label: "Color adjust",
        category: Category::FieldOp,
        group: Group::Color,
        description: "Adjusts a colour field in HSV (shift hue, scale saturation and brightness), then applies contrast around mid-grey and an optional invert. Alpha passes through.",
        inputs: &[port("in", Shape::FieldColor, "The colour field to adjust.")],
        outputs: COLOR_OUT,
        params: &[
            num(
                "hue",
                "Hue shift (turns)",
                -1.0,
                1.0,
                0.0,
                "Hue shift in turns (±0.5 = complementary colours).",
            ),
            num(
                "saturation",
                "Saturation ×",
                0.0,
                3.0,
                1.0,
                "Saturation multiplier: 0 greyscale, 1 unchanged.",
            ),
            num(
                "brightness",
                "Brightness ×",
                0.0,
                3.0,
                1.0,
                "Brightness (HSV value) multiplier.",
            ),
            num(
                "contrast",
                "Contrast",
                0.0,
                3.0,
                1.0,
                "Contrast around 0.5 grey: 1 unchanged, 0 flat grey, above 1 punchier.",
            ),
            sel(
                "invert",
                "Invert",
                &["off", "on"],
                "on: replace each channel with 1 − it.",
            ),
        ],
    },
    NodeType {
        // A scalar field through a colour ramp (cosine palettes).
        id: "palette",
        label: "Palette",
        category: Category::FieldOp,
        group: Group::Color,
        description: "Maps a Field<f32> through a smooth cosine colour ramp (after Inigo Quilez); the ramp repeats every 1 / Cycles of input, and alpha is the input clamped to 0..1. A Scalar wired into `in` gives one uniform colour.",
        inputs: &[port(
            "in",
            Shape::FieldScalar,
            "The value field to colour; unwired reads 0.",
        )],
        outputs: COLOR_OUT,
        params: &[
            sel(
                "palette",
                "Palette",
                &["rainbow", "fire", "ocean", "neon", "pastel", "mono", "sunset", "forest"],
                "Which colour ramp (named for its look).",
            ),
            num(
                "cycles",
                "Cycles",
                0.1,
                8.0,
                1.0,
                "Ramp repeats per unit of input.",
            ),
            num(
                "offset",
                "Offset",
                -1.0,
                1.0,
                0.0,
                "Shift along the ramp, in turns of it.",
            ),
            BRIGHTNESS,
        ],
    },
    // -- Combine ------------------------------------------------------------
    NodeType {
        // Another patch as one node (`NodeInst::sub`). Inlined by `flatten`
        // before validation and codegen; nothing downstream sees it, so it has
        // no static ports or params.
        id: "subpatch",
        label: "Sub-patch",
        category: Category::Combine,
        group: Group::Structure,
        description: "Another patch embedded as one node (its document lives in the node's `sub`): every param its document exposes becomes an input of this node named \"{inner node}.{param}\", and whatever feeds its Output is this node's `out`. It is inlined before validation, so it costs exactly what its contents cost; nesting is limited to four levels.",
        inputs: &[],
        outputs: &[port(
            "out",
            Shape::FieldColor,
            "The embedded patch's picture (what feeds its Output; black if nothing does).",
        )],
        params: &[],
    },
    NodeType {
        // A Code node's ports and body live on the instance (`NodeInst::code`,
        // see `code`). No static ports or params.
        id: "code",
        label: "Code",
        category: Category::Code,
        group: Group::Structure,
        description: "A node whose ports and body you write (stored in the node's `code`). If every port is a Scalar or Event, the body (a WGSL subset) runs on the CPU every frame; if it outputs a field, the WGSL body is compiled into the patch shader and runs per pixel. Scalar inputs are knobs like a built-in node's params.",
        inputs: &[],
        outputs: &[],
        params: &[],
    },
    NodeType {
        id: "note",
        label: "Note",
        category: Category::Code,
        group: Group::Structure,
        description: "A remark on the canvas (`text` on the node): no ports, never run. For explaining a patch, a sub-patch, or a Code node to the next person.",
        inputs: &[],
        outputs: &[],
        params: &[],
    },
    NodeType {
        id: "blend",
        label: "Blend",
        category: Category::Combine,
        group: Group::Color,
        description: "Combines colour fields: Over is applied to Base with the chosen mode at Opacity. The result's alpha is Over's coverage composited over Base's. A Blend can stack more layers (`layers` on the node, up to 8): layer k adds Over k, Mode k and Opacity k, applied in turn on top; an unwired one is skipped.",
        inputs: &[
            port("base", Shape::FieldColor, "The lower layer."),
            port("over", Shape::FieldColor, "The layer applied on top."),
        ],
        outputs: COLOR_OUT,
        params: &[
            sel(
                "mode",
                "Mode",
                &["add", "multiply", "screen", "alpha_over", "max"],
                "add: sums the light (brightens); multiply: darkens Base by Over (white keeps it); screen: brightens without blowing out; alpha_over: Over replaces Base where its alpha (coverage) is high; max: the brighter of each channel.",
            ),
            num(
                "opacity",
                "Opacity",
                0.0,
                1.0,
                1.0,
                "How much of Over applies: 0 Base alone, 1 full effect.",
            ),
        ],
    },
    // -- Points -------------------------------------------------------------
    NodeType {
        id: "render_points",
        label: "Render points",
        category: Category::FieldOp,
        group: Group::Draw,
        description: "Draws a Points stream (Touch strokes) as glowing marks, each in its own pen or all in one Pen, scaled by Size and Intensity. Unwired, it is black.",
        inputs: &[port("points", Shape::Points, "The strokes to draw.")],
        outputs: COLOR_OUT,
        params: &[
            // "as drawn" keeps each stroke's own pen; the rest override it.
            sel(
                "pen",
                "Pen",
                &[
                    "as drawn", "glow", "ripple", "sparkle", "comet", "ring", "beam", "ember",
                ],
                "as drawn: each stroke keeps the pen it was drawn with. Otherwise all use one: glow (soft blob), ripple (expanding ring), sparkle (glitter spray), comet (streak along the motion), ring (a hoop round the array at the dab's radius), beam (lights the dab's whole spoke), ember (glitter drifting inward).",
            ),
            num(
                "size",
                "Size ×",
                0.1,
                4.0,
                1.0,
                "Multiplier on each mark's size.",
            ),
            num(
                "intensity",
                "Intensity ×",
                0.0,
                2.0,
                1.0,
                "Multiplier on each mark's brightness.",
            ),
        ],
    },
    NodeType {
        id: "render_effects",
        label: "Render effects",
        category: Category::FieldOp,
        group: Group::Draw,
        description: "Draws an Effects stream (Triggered effects and/or Event effect chains) into a colour field, scaled by Size and Intensity. Only effects from the sources wired in are drawn; unwired, it is black.",
        inputs: &[port("effects", Shape::Effects, "The effects to draw.")],
        outputs: COLOR_OUT,
        params: &[
            num(
                "size",
                "Size ×",
                0.1,
                4.0,
                1.0,
                "Multiplier on each effect's size.",
            ),
            num(
                "intensity",
                "Intensity ×",
                0.0,
                2.0,
                1.0,
                "Multiplier on each effect's brightness.",
            ),
        ],
    },
    // -- Texture ------------------------------------------------------------
    NodeType {
        id: "texture_sample",
        label: "Texture sample",
        category: Category::Texture,
        group: Group::Media,
        description: "Maps a Texture (Video in, Still image in, Clip) onto the disc: the picture's square spans the ring, its edges touching the rim, with zoom, rotation and kaleidoscope plus saturation and brightness. Outside the picture is transparent; unwired, it is black.",
        inputs: &[port("tex", Shape::Texture, "The texture to sample.")],
        outputs: COLOR_OUT,
        params: &[
            num(
                "zoom",
                "Zoom",
                0.1,
                8.0,
                1.0,
                "Magnification: above 1 enlarges the picture.",
            ),
            num(
                "rotate",
                "Rotate (turns)",
                -1.0,
                1.0,
                0.0,
                "Rotation in turns.",
            ),
            num(
                "kaleido",
                "Kaleidoscope",
                0.0,
                10.0,
                0.0,
                "Kaleidoscope segments (rounded): 2 or more folds the picture into that many mirrored wedges; 0 or 1 is off.",
            ),
            num(
                "saturation",
                "Saturation",
                0.0,
                2.0,
                1.0,
                "0 greyscale, 1 the picture's own colours, 2 boosted.",
            ),
            num(
                "brightness",
                "Brightness",
                0.0,
                2.0,
                1.0,
                "Brightness multiplier.",
            ),
        ],
    },
    // -- Sink ---------------------------------------------------------------
    NodeType {
        id: "output",
        label: "Output",
        category: Category::Sink,
        group: Group::Structure,
        description: "The patch's one sink: the colour field wired into `in` is what the gate shows. It is scaled by Master, then by the crew's master brightness and hue pull, soft-clipped above 0.8 and sent to the LEDs; nothing that is not wired here is drawn.",
        inputs: &[port(
            "in",
            Shape::FieldColor,
            "The final picture (its alpha is ignored).",
        )],
        outputs: &[],
        params: &[num(
            "master",
            "Master",
            0.0,
            2.0,
            1.0,
            "Patch-level brightness, applied before the crew's master brightness.",
        )],
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn type_ids_are_unique() {
        for (i, a) in TYPES.iter().enumerate() {
            for b in &TYPES[i + 1..] {
                assert_ne!(a.id, b.id);
            }
        }
    }

    #[test]
    fn port_and_param_names_are_unique_per_type() {
        for t in TYPES {
            let mut names: Vec<&str> = t
                .inputs
                .iter()
                .map(|p| p.name)
                .chain(t.params.iter().map(|p| p.name))
                .collect();
            names.sort_unstable();
            names.dedup();
            assert_eq!(
                names.len(),
                t.inputs.len() + t.params.len(),
                "duplicate input/param name in {}",
                t.id
            );
        }
    }

    #[test]
    fn number_params_are_scalar_ports_and_selects_are_not() {
        let lfo = lookup("lfo").unwrap();
        assert_eq!(lfo.input_shape("rate"), Some(Shape::Scalar));
        assert_eq!(
            lfo.input_shape("wave"),
            None,
            "select params are not connectable"
        );
        assert_eq!(lfo.input_shape("nope"), None);

        let blend = lookup("blend").unwrap();
        assert_eq!(blend.input_shape("base"), Some(Shape::FieldColor));
        assert_eq!(blend.input_shape("opacity"), Some(Shape::Scalar));
        assert_eq!(blend.input_shape("mode"), None);
    }

    #[test]
    fn exactly_one_sink_type() {
        assert_eq!(
            TYPES
                .iter()
                .filter(|t| t.category == Category::Sink)
                .count(),
            1
        );
    }

    /// Agents compose patches from these alone: nothing may be undocumented.
    #[test]
    fn every_node_port_and_param_is_described() {
        for t in TYPES {
            assert!(!t.description.trim().is_empty(), "{} needs a description", t.id);
            for p in t.inputs.iter().chain(t.outputs) {
                assert!(
                    !p.description.trim().is_empty(),
                    "port {}.{} needs a description",
                    t.id,
                    p.name
                );
            }
            for p in t.params {
                assert!(
                    !p.description.trim().is_empty(),
                    "param {}.{} needs a description",
                    t.id,
                    p.name
                );
            }
        }
    }

    #[test]
    fn shapes_json_lists_every_shape_with_its_adapters() {
        let json = shapes_json();
        let shapes = json.as_array().unwrap();
        assert_eq!(shapes.len(), Shape::ALL.len());
        for s in shapes {
            assert!(s["description"].as_str().is_some_and(|d| !d.is_empty()));
            assert!(s["label"].as_str().is_some_and(|d| !d.is_empty()));
        }
        let accepts = |id: &str| {
            shapes.iter().find(|s| s["id"] == id).unwrap()["accepts"].clone()
        };
        assert_eq!(accepts("field_scalar"), serde_json::json!(["scalar", "field_scalar"]));
        assert_eq!(accepts("field_color"), serde_json::json!(["field_scalar", "field_color"]));
        assert_eq!(accepts("event"), serde_json::json!(["event"]));
        // Every shape a registry port uses is listed.
        for t in TYPES {
            for p in t.inputs.iter().chain(t.outputs) {
                assert!(Shape::ALL.contains(&p.shape));
            }
        }
    }

    #[test]
    fn palette_json_carries_descriptions() {
        let json = palette_json();
        let solid = json
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == "solid")
            .unwrap();
        assert!(solid["description"].as_str().is_some_and(|s| !s.is_empty()));
        assert!(solid["outputs"][0]["description"].is_string());
        assert!(solid["params"][0]["description"].is_string());
        assert_eq!(solid["group"], "blocks");
    }

    #[test]
    fn every_group_is_used() {
        for g in Group::ALL {
            assert!(
                TYPES.iter().any(|t| t.group == g),
                "no node is in group {}",
                g.id()
            );
        }
    }
}
