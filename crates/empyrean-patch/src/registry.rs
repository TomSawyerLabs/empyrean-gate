//! Static node-type definitions — the palette.
//!
//! Every `Number` param is *also* an optional Scalar input port of the same
//! name: the knob value is the fallback when nothing is wired in (the
//! TouchDesigner/TiXL model). `inputs` therefore lists only shaped inputs
//! (fields, points, textures, events). `Select` params are enum-like topology
//! choices and are NOT connectable.
//!
//! This registry defines interfaces only; WGSL codegen support arrives
//! per-node in plan step 2 and activation is gated on it there.

use super::Shape;

#[derive(Debug, Clone, Copy)]
pub struct PortDef {
    pub name: &'static str,
    pub shape: Shape,
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    /// Signals from outside the graph: time, touch, audio, IMU, video.
    Input,
    /// Control-rate CPU operators.
    ScalarOp,
    /// Field generators (the old layer kinds live here).
    Generator,
    /// Field transforms and color mapping.
    FieldOp,
    /// Multi-field combination.
    Combine,
    /// Texture-tier nodes (materialized buffers).
    Texture,
    /// The one required end of every renderable patch.
    Sink,
    /// Nodes whose ports and body are written by the user (see `code`).
    Code,
}

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

/// The palette serialized for the editor (`GET /patch/registry`). Shapes use
/// the same snake_case names as patch JSON; `kind` is `"number"` or
/// `{"select": [labels…]}`.
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
    json!(
        TYPES
            .iter()
            .map(|t| {
                json!({
                    "id": t.id,
                    "label": t.label,
                    "category": category(t.category),
                    "inputs": t.inputs.iter().map(|p| json!({
                        "name": p.name,
                        "shape": shape(p.shape),
                    })).collect::<Vec<_>>(),
                    "outputs": t.outputs.iter().map(|p| json!({
                        "name": p.name,
                        "shape": shape(p.shape),
                    })).collect::<Vec<_>>(),
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
                    })).collect::<Vec<_>>(),
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
) -> ParamDef {
    ParamDef {
        name,
        label,
        kind: ParamKind::Number,
        min,
        max,
        default,
        integrate: false,
    }
}

/// A `num` whose value is a rate: the engine integrates it into a phase.
const fn rate(
    name: &'static str,
    label: &'static str,
    min: f32,
    max: f32,
    default: f32,
) -> ParamDef {
    ParamDef {
        name,
        label,
        kind: ParamKind::Number,
        min,
        max,
        default,
        integrate: true,
    }
}

const fn sel(
    name: &'static str,
    label: &'static str,
    options: &'static [&'static str],
) -> ParamDef {
    ParamDef {
        name,
        label,
        kind: ParamKind::Select(options),
        min: 0.0,
        max: options.len() as f32 - 1.0,
        default: 0.0,
        integrate: false,
    }
}

const fn out(shape: Shape) -> [PortDef; 1] {
    [PortDef { name: "out", shape }]
}

const COLOR_OUT: &[PortDef] = &out(Shape::FieldColor);
const SCALAR_OUT: &[PortDef] = &out(Shape::Scalar);

/// Keep this order in step with `layers::EffectKind::ALL`. `None` is useful
/// while building a patch and makes an event mapping disable-able without
/// deleting its wiring.
const EFFECT_KINDS: &[&str] = &[
    "None", "Burst", "Strobe", "Swoosh", "Collapse", "Bloom", "Pinwheel", "Twinkle", "Wipe",
    "Star", "Heart", "Flower", "Diamond", "Triangle", "Moon", "Ring", "Rotate",
];

/// Shared color-mapping knobs used by every generator that owns its palette.
const HUE: ParamDef = num("hue", "Hue", 0.0, 1.0, 0.6);
const HUE_RANGE: ParamDef = num("hue_range", "Hue range", 0.0, 1.0, 0.2);
const SATURATION: ParamDef = num("saturation", "Saturation", 0.0, 1.0, 0.9);
const BRIGHTNESS: ParamDef = num("brightness", "Brightness", 0.0, 2.0, 1.0);

/// Shared by Touch mask and Touch glow.
const TOUCH_FIELD_PARAMS: &[ParamDef] = &[
    num("radius", "Radius", 0.01, 0.8, 0.12),
    num("soft", "Softness", 0.0, 1.0, 0.6),
    num("fade", "Fade after release (s)", 0.0, 2.0, 0.8),
    num("grow", "Grow while held", 0.0, 3.0, 0.0),
    num("trail", "Motion trail", 0.0, 2.0, 0.3),
    num("intensity", "Intensity", 0.0, 3.0, 1.0),
];

pub const TYPES: &[NodeType] = &[
    // -- Inputs -------------------------------------------------------------
    NodeType {
        // A clock. Forever (the default) counts up from Start at Rate per
        // second, exactly as Time always did; Loop wraps Start→End, Ping-pong
        // bounces between them, Once stops at End. `phase` is the 0..1 position
        // through Start→End and `wrap` fires at each loop, bounce or arrival.
        id: "time",
        label: "Time",
        category: Category::Input,
        inputs: &[PortDef {
            name: "reset",
            shape: Shape::Event,
        }],
        outputs: &[
            PortDef {
                name: "out",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "phase",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "wrap",
                shape: Shape::Event,
            },
        ],
        params: &[
            num("rate", "Rate (per second)", -8.0, 8.0, 1.0),
            sel("mode", "Mode", &["forever", "loop", "ping-pong", "once"]),
            num("start", "Start", -100.0, 100.0, 0.0),
            num("end", "End", -100.0, 100.0, 1.0),
            num("running", "Running (0 pauses)", 0.0, 1.0, 1.0),
        ],
    },
    NodeType {
        id: "slider",
        label: "Slider",
        category: Category::Input,
        inputs: &[],
        outputs: SCALAR_OUT,
        params: &[num("value", "Value", 0.0, 1.0, 0.5)],
    },
    NodeType {
        // The crew's master controls, as the gate applies them outside the
        // patch: brightness (0..1; the Output is scaled by it), speed (the
        // multiplier every integrated param already follows), and the master
        // hue pull (target hue in turns; amount is 0 while the pull is off).
        // A patch can react to them, e.g. dim its accents as the crew dims
        // the gate.
        id: "globals",
        label: "Gate globals",
        category: Category::Input,
        inputs: &[],
        outputs: &[
            PortDef { name: "brightness", shape: Shape::Scalar },
            PortDef { name: "speed", shape: Shape::Scalar },
            PortDef { name: "hue", shape: Shape::Scalar },
            PortDef { name: "hue_amount", shape: Shape::Scalar },
        ],
        params: &[],
    },
    NodeType {
        id: "audio",
        label: "Audio",
        category: Category::Input,
        inputs: &[],
        outputs: &[
            PortDef {
                name: "level",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "bass",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "mid",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "treble",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "onset",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "beat_phase",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "bpm",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "tempo",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "beat",
                shape: Shape::Event,
            },
        ],
        params: &[sel("source", "Source", &["1", "2", "3", "4"])],
    },
    NodeType {
        id: "imu",
        label: "Phone IMU",
        category: Category::Input,
        inputs: &[],
        outputs: &[
            PortDef {
                name: "yaw",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "pitch",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "roll",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "shake",
                shape: Shape::Scalar,
            },
        ],
        params: &[],
    },
    NodeType {
        // Fires whenever any effect is triggered (pads, keys, a client's tap
        // tool) — not raw touch; that is the Touch node below.
        id: "tap",
        label: "Effect taps",
        category: Category::Input,
        inputs: &[],
        outputs: &[PortDef {
            name: "tap",
            shape: Shape::Event,
        }],
        params: &[],
    },
    NodeType {
        // Raw touch, one finger followed (see crate::touch). A patch with any
        // touch node owns the touch surface: clients send raw touches instead
        // of applying their own tap or pen tool.
        id: "touch",
        label: "Touch",
        category: Category::Input,
        inputs: &[],
        outputs: &[
            PortDef { name: "down", shape: Shape::Event },
            PortDef { name: "up", shape: Shape::Event },
            PortDef { name: "active", shape: Shape::Scalar },
            PortDef { name: "count", shape: Shape::Scalar },
            PortDef { name: "angle", shape: Shape::Scalar },
            PortDef { name: "radius", shape: Shape::Scalar },
            PortDef { name: "x", shape: Shape::Scalar },
            PortDef { name: "y", shape: Shape::Scalar },
            PortDef { name: "held", shape: Shape::Scalar },
            PortDef { name: "speed", shape: Shape::Scalar },
            PortDef { name: "dir", shape: Shape::Scalar },
            PortDef { name: "hue", shape: Shape::Scalar },
        ],
        params: &[sel("follow", "Follow", &["Latest finger", "First finger"])],
    },
    NodeType {
        id: "dj_link",
        label: "PRO DJ LINK",
        category: Category::Input,
        inputs: &[],
        outputs: &[
            PortDef { name: "active", shape: Shape::Scalar },
            PortDef { name: "energy", shape: Shape::Scalar },
            PortDef { name: "deck", shape: Shape::Scalar },
            PortDef { name: "deck_side", shape: Shape::Scalar },
            PortDef { name: "event_deck", shape: Shape::Scalar },
            PortDef { name: "event_side", shape: Shape::Scalar },
            PortDef { name: "playing", shape: Shape::Scalar },
            PortDef { name: "on_air", shape: Shape::Scalar },
            PortDef { name: "deck_1_on_air", shape: Shape::Scalar },
            PortDef { name: "deck_2_on_air", shape: Shape::Scalar },
            PortDef { name: "looping", shape: Shape::Scalar },
            PortDef { name: "mix", shape: Shape::Scalar },
            PortDef { name: "mix_activity", shape: Shape::Scalar },
            PortDef { name: "beat_in_bar", shape: Shape::Scalar },
            PortDef { name: "phrase_active", shape: Shape::Scalar },
            PortDef { name: "phrase_kind", shape: Shape::Scalar },
            PortDef { name: "phrase_progress", shape: Shape::Scalar },
            PortDef { name: "phrase_fill", shape: Shape::Scalar },
            PortDef { name: "play", shape: Shape::Event },
            PortDef { name: "cue", shape: Shape::Event },
            PortDef { name: "cue_release", shape: Shape::Event },
            PortDef { name: "on_air_event", shape: Shape::Event },
            PortDef { name: "off_air_event", shape: Shape::Event },
            PortDef { name: "loop_start", shape: Shape::Event },
            PortDef { name: "loop_wrap", shape: Shape::Event },
            PortDef { name: "loop_end", shape: Shape::Event },
            PortDef { name: "jump", shape: Shape::Event },
            PortDef { name: "phrase_change", shape: Shape::Event },
            PortDef { name: "fill_in", shape: Shape::Event },
        ],
        params: &[],
    },
    NodeType {
        id: "event_effect",
        label: "Event effect",
        category: Category::ScalarOp,
        // The effects it fires are a stream: they show only where `effects`
        // is wired into a Render effects (through any further Event effects
        // chained on `in`, which merges the upstream stream into this one).
        inputs: &[
            PortDef {
                name: "trigger",
                shape: Shape::Event,
            },
            PortDef {
                name: "in",
                shape: Shape::Effects,
            },
        ],
        outputs: &[PortDef {
            name: "effects",
            shape: Shape::Effects,
        }],
        params: &[
            sel("effect", "Effect", EFFECT_KINDS),
            num("angle", "Angle (rad)", -3.142, 3.142, 0.0),
            num("radius", "Radius", 0.0, 1.2, 0.5),
            num("intensity", "Intensity", 0.0, 2.0, 1.2),
            num("size", "Size", 0.1, 4.0, 1.0),
            num("hue", "Hue (-1 = white)", -1.0, 1.0, -1.0),
            num("saturation", "Saturation", 0.0, 1.0, 0.9),
            num("brightness", "Brightness", 0.0, 1.0, 1.0),
            num("duration", "Duration (0 = default)", 0.0, 10.0, 0.0),
            num("rotation", "Shape rotation", -3.142, 3.142, 0.0),
            num("grow", "Shape growth", -1.0, 1.0, 0.0),
            num("edge", "Shape edge", 0.0, 1.0, 0.3),
            num("fill", "Shape fill", 0.0, 1.0, 0.15),
        ],
    },
    NodeType {
        id: "touch_dabs",
        label: "Touch strokes",
        category: Category::Input,
        inputs: &[],
        outputs: &[PortDef {
            name: "points",
            shape: Shape::Points,
        }],
        params: &[],
    },
    NodeType {
        id: "effects_in",
        label: "Triggered effects",
        category: Category::Input,
        inputs: &[],
        outputs: &[PortDef {
            name: "effects",
            shape: Shape::Effects,
        }],
        params: &[],
    },
    NodeType {
        id: "video_in",
        label: "Video in",
        category: Category::Input,
        inputs: &[],
        outputs: &[PortDef {
            name: "tex",
            shape: Shape::Texture,
        }],
        params: &[],
    },
    NodeType {
        id: "image_in",
        label: "Still image in",
        category: Category::Input,
        inputs: &[],
        outputs: &[PortDef {
            name: "tex",
            shape: Shape::Texture,
        }],
        params: &[],
    },
    NodeType {
        // A short loop stored in the patch: `media` is a 256² sprite sheet of
        // grid×grid frames (see `clip_at`); `fps` integrates into a frame
        // phase, so speed changes never jump. Scrub mode follows `scrub`
        // (wire Touch or Time into it).
        id: "clip",
        label: "Clip",
        category: Category::Input,
        inputs: &[],
        outputs: &[PortDef {
            name: "tex",
            shape: Shape::Texture,
        }],
        params: &[
            rate("fps", "Frames per second", -30.0, 30.0, 10.0),
            sel("mode", "Mode", &["loop", "ping-pong", "scrub"]),
            num("scrub", "Scrub (scrub mode)", 0.0, 1.0, 0.0),
            num("frames", "Frames used", 1.0, 64.0, 16.0),
            // The sheet's layout; the picker sets it. Append only.
            sel(
                "grid",
                "Sheet",
                &["4×4 (16 frames of 64 px)", "8×8 (64 frames of 32 px)", "2×2 (4 frames of 128 px)"],
            ),
        ],
    },
    // -- Scalar ops ---------------------------------------------------------
    NodeType {
        id: "scalar_math",
        label: "Math",
        category: Category::ScalarOp,
        inputs: &[],
        outputs: SCALAR_OUT,
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
            ),
            num("a", "A", -8.0, 8.0, 0.0),
            num("b", "B", -8.0, 8.0, 0.0),
        ],
    },
    NodeType {
        id: "lfo",
        label: "LFO",
        category: Category::ScalarOp,
        inputs: &[],
        outputs: SCALAR_OUT,
        params: &[
            num("rate", "Rate (Hz)", 0.01, 20.0, 0.25),
            sel("wave", "Wave", &["sine", "triangle", "square", "saw"]),
            num("min", "Min", 0.0, 1.0, 0.0),
            num("max", "Max", 0.0, 1.0, 1.0),
        ],
    },
    NodeType {
        id: "smooth",
        label: "Smooth",
        category: Category::ScalarOp,
        inputs: &[],
        outputs: SCALAR_OUT,
        params: &[
            num("in", "In", -8.0, 8.0, 0.0),
            num("seconds", "Seconds", 0.0, 10.0, 0.3),
        ],
    },
    NodeType {
        id: "envelope",
        label: "Envelope",
        category: Category::ScalarOp,
        inputs: &[PortDef {
            name: "trigger",
            shape: Shape::Event,
        }],
        outputs: SCALAR_OUT,
        params: &[
            num("attack", "Attack (s)", 0.0, 5.0, 0.01),
            num("decay", "Decay (s)", 0.0, 10.0, 0.5),
            num("peak", "Peak", 0.0, 2.0, 1.0),
        ],
    },
    NodeType {
        // out = out_min + (in - in_min) / (in_max - in_min) * (out_max - out_min);
        // an inverted range (in_min > in_max, or out) flips the mapping.
        id: "map_range",
        label: "Map range",
        category: Category::ScalarOp,
        inputs: &[],
        outputs: SCALAR_OUT,
        params: &[
            num("in", "In", -8.0, 8.0, 0.0),
            num("in_min", "In min", -8.0, 8.0, 0.0),
            num("in_max", "In max", -8.0, 8.0, 1.0),
            num("out_min", "Out min", -8.0, 8.0, 0.0),
            num("out_max", "Out max", -8.0, 8.0, 1.0),
            sel("clamp", "Clamp to the out range", &["off", "on"]),
        ],
    },
    NodeType {
        id: "mix",
        label: "Mix",
        category: Category::ScalarOp,
        inputs: &[],
        outputs: SCALAR_OUT,
        params: &[
            num("a", "A", -8.0, 8.0, 0.0),
            num("b", "B", -8.0, 8.0, 1.0),
            num("t", "Mix (0 = A, 1 = B)", 0.0, 1.0, 0.5),
        ],
    },
    NodeType {
        id: "clamp",
        label: "Clamp",
        category: Category::ScalarOp,
        inputs: &[],
        outputs: SCALAR_OUT,
        params: &[
            num("in", "In", -8.0, 8.0, 0.0),
            num("min", "Min", -8.0, 8.0, 0.0),
            num("max", "Max", -8.0, 8.0, 1.0),
        ],
    },
    NodeType {
        // A new value in Min..Max on every `trigger`, and on its own clock
        // when Rate > 0; Glide eases towards it. The sequence is seeded from
        // the node id, so a saved patch replays the same values.
        id: "random",
        label: "Random",
        category: Category::ScalarOp,
        inputs: &[PortDef {
            name: "trigger",
            shape: Shape::Event,
        }],
        outputs: &[
            PortDef {
                name: "out",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "changed",
                shape: Shape::Event,
            },
        ],
        params: &[
            num("rate", "Rate (Hz, 0 = trigger only)", 0.0, 20.0, 0.0),
            num("min", "Min", -8.0, 8.0, 0.0),
            num("max", "Max", -8.0, 8.0, 1.0),
            num("glide", "Glide (s)", 0.0, 5.0, 0.0),
        ],
    },
    NodeType {
        // Counts `count` events; wraps back to 0 at Steps, firing `wrap`
        // (which is also "every Nth event"). `phase` is count / Steps.
        id: "counter",
        label: "Counter",
        category: Category::ScalarOp,
        inputs: &[
            PortDef {
                name: "count",
                shape: Shape::Event,
            },
            PortDef {
                name: "reset",
                shape: Shape::Event,
            },
        ],
        outputs: &[
            PortDef {
                name: "out",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "phase",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "wrap",
                shape: Shape::Event,
            },
        ],
        params: &[num("steps", "Wrap at (0 = never)", 0.0, 64.0, 8.0)],
    },
    NodeType {
        // A latch: `toggle` flips it, `set`/`clear` force it; `on`/`off`
        // fire on each change.
        id: "toggle",
        label: "Toggle",
        category: Category::ScalarOp,
        inputs: &[
            PortDef {
                name: "toggle",
                shape: Shape::Event,
            },
            PortDef {
                name: "set",
                shape: Shape::Event,
            },
            PortDef {
                name: "clear",
                shape: Shape::Event,
            },
        ],
        outputs: &[
            PortDef {
                name: "out",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "on",
                shape: Shape::Event,
            },
            PortDef {
                name: "off",
                shape: Shape::Event,
            },
        ],
        params: &[sel("initial", "Starts", &["off", "on"])],
    },
    NodeType {
        // Scalar → events: `rise` when In climbs past Level (+ half the
        // hysteresis), `fall` when it drops below (− half); `out` is 1 while
        // above.
        id: "threshold",
        label: "Threshold",
        category: Category::ScalarOp,
        inputs: &[],
        outputs: &[
            PortDef {
                name: "out",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "rise",
                shape: Shape::Event,
            },
            PortDef {
                name: "fall",
                shape: Shape::Event,
            },
        ],
        params: &[
            num("in", "In", -8.0, 8.0, 0.0),
            num("level", "Level", -8.0, 8.0, 0.5),
            num("hysteresis", "Hysteresis", 0.0, 2.0, 0.05),
        ],
    },
    NodeType {
        // Each `in` event comes out Seconds later, then again every Seconds
        // for Echoes more times. Real seconds (master speed does not apply).
        id: "delay",
        label: "Delay",
        category: Category::ScalarOp,
        inputs: &[PortDef {
            name: "in",
            shape: Shape::Event,
        }],
        outputs: &[PortDef {
            name: "out",
            shape: Shape::Event,
        }],
        params: &[
            num("seconds", "Seconds", 0.0, 10.0, 0.5),
            num("echoes", "Echoes", 0.0, 16.0, 0.0),
        ],
    },
    NodeType {
        // Any of a..d fires `out`, while Open is on (wire a Toggle in to
        // gate a stream of events).
        id: "event_merge",
        label: "Merge events",
        category: Category::ScalarOp,
        inputs: &[
            PortDef {
                name: "a",
                shape: Shape::Event,
            },
            PortDef {
                name: "b",
                shape: Shape::Event,
            },
            PortDef {
                name: "c",
                shape: Shape::Event,
            },
            PortDef {
                name: "d",
                shape: Shape::Event,
            },
        ],
        outputs: &[PortDef {
            name: "out",
            shape: Shape::Event,
        }],
        params: &[num("open", "Open (0 blocks)", 0.0, 1.0, 1.0)],
    },
    NodeType {
        // `step` advances through the first Steps values and wraps (firing
        // `wrap`); `out` is the current value, `index` its 0-based position.
        id: "sequence",
        label: "Step sequencer",
        category: Category::ScalarOp,
        inputs: &[
            PortDef {
                name: "step",
                shape: Shape::Event,
            },
            PortDef {
                name: "reset",
                shape: Shape::Event,
            },
        ],
        outputs: &[
            PortDef {
                name: "out",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "index",
                shape: Shape::Scalar,
            },
            PortDef {
                name: "wrap",
                shape: Shape::Event,
            },
        ],
        params: &[
            num("steps", "Steps", 1.0, 8.0, 4.0),
            num("v1", "Step 1", -8.0, 8.0, 0.0),
            num("v2", "Step 2", -8.0, 8.0, 0.25),
            num("v3", "Step 3", -8.0, 8.0, 0.5),
            num("v4", "Step 4", -8.0, 8.0, 0.75),
            num("v5", "Step 5", -8.0, 8.0, 1.0),
            num("v6", "Step 6", -8.0, 8.0, 0.75),
            num("v7", "Step 7", -8.0, 8.0, 0.5),
            num("v8", "Step 8", -8.0, 8.0, 0.25),
        ],
    },
    // -- Generators ---------------------------------------------------------
    NodeType {
        id: "solid",
        label: "Solid",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[HUE, SATURATION, BRIGHTNESS],
    },
    NodeType {
        id: "gradient",
        label: "Gradient",
        category: Category::Generator,
        inputs: &[],
        outputs: &out(Shape::FieldScalar),
        params: &[
            sel("along", "Along", &["radius", "angle"]),
            num("inner", "Inner", 0.0, 1.0, 0.0),
            num("outer", "Outer", 0.0, 1.0, 1.0),
        ],
    },
    NodeType {
        id: "noise_field",
        label: "Noise field",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("scale", "Scale", 0.1, 8.0, 1.0),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
            num("threshold", "Threshold", 0.0, 1.0, 0.5),
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
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("waves", "Waves", 1.0, 8.0, 3.0),
            num("scale", "Scale", 0.1, 8.0, 1.0),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
            num("sharpness", "Sharpness", 0.0, 1.0, 0.5),
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
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("arms", "Arms", 1.0, 12.0, 3.0),
            num("twist", "Twist", -4.0, 4.0, 1.0),
            rate("speed", "Speed", -4.0, 4.0, 1.0),
            num("sharpness", "Sharpness", 0.0, 1.0, 0.5),
            HUE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "gradient_radial",
        label: "Radial gradient",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            rate("drift", "Drift", 0.0, 4.0, 0.5),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "noise_color",
        label: "Color noise",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("scale", "Scale", 0.1, 8.0, 1.0),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
            HUE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "plasma",
        label: "Plasma",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("scale", "Scale", 0.1, 8.0, 1.0),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
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
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            rate("speed", "Speed", 0.0, 8.0, 1.0),
            sel("direction", "Direction", &["inward", "outward"]),
            num("tail", "Tail length", 0.05, 0.45, 0.2),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        // Every finger at once as a soft blob (a mask for colorize/blend).
        id: "touch_mask",
        label: "Touch mask",
        category: Category::Generator,
        inputs: &[],
        outputs: &[PortDef {
            name: "out",
            shape: Shape::FieldScalar,
        }],
        params: TOUCH_FIELD_PARAMS,
    },
    NodeType {
        // The same blobs, each in its toucher's own color.
        id: "touch_glow",
        label: "Touch glow",
        category: Category::Generator,
        inputs: &[],
        outputs: &[PortDef {
            name: "out",
            shape: Shape::FieldColor,
        }],
        params: TOUCH_FIELD_PARAMS,
    },
    NodeType {
        id: "sparkle",
        label: "Sparkle",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("density", "Density", 0.0, 1.0, 0.5),
            num("twinkle", "Twinkle rate", 0.0, 1.0, 0.5),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
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
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            // Wire audio.beat_phase in here for the classic beat-ring look.
            num("front", "Front position", 0.0, 1.0, 0.0),
            num("width", "Ring width", 0.02, 0.32, 0.1),
            sel("direction", "Direction", &["outward", "inward"]),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "breathe",
        label: "Breathe",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            rate("speed", "Speed", 0.0, 4.0, 1.0),
            num("floor", "Depth floor", 0.0, 1.0, 0.3),
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "rainbow",
        label: "Rainbow",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("turns", "Turns", 1.0, 4.0, 1.0),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "wedges",
        label: "Wedges",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("slices", "Slices", 2.0, 16.0, 8.0),
            num("softness", "Edge softness", 0.05, 0.35, 0.15),
            num("twist", "Radial twist", 0.0, 1.0, 0.5),
            // Wire audio.onset in here for the classic on-beat flash.
            num("flash", "Flash", 0.0, 1.0, 0.0),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "interference",
        label: "Interference",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("frequency", "Frequency", 0.0, 1.0, 0.5),
            num("orbit", "Orbit size", 0.0, 1.0, 0.5),
            num("sharpness", "Sharpness", 0.0, 1.0, 0.5),
            num("scale", "Scale", 0.1, 8.0, 1.0),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
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
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("reach", "Flame reach", 0.0, 1.0, 0.5),
            num("stretch", "Flame stretch", 0.0, 1.0, 0.5),
            num("scale", "Scale", 0.1, 8.0, 1.0),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
            HUE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "cosmic_drift",
        label: "Cosmic drift",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("depth", "Cloud depth", 0.0, 1.0, 0.55),
            num("trail", "Traveller trails", 0.0, 1.0, 0.45),
            rate("speed", "Flight speed", 0.0, 4.0, 0.35),
            num("pulse", "Pulse", 0.0, 1.0, 0.0),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "earth_current",
        label: "Forest canopy",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("scale", "Leaf scale", 0.1, 4.0, 0.9),
            num("warp", "Wind bend", 0.0, 1.0, 0.6),
            num("width", "Leaf coverage", 0.0, 1.0, 0.5),
            rate("speed", "Wind speed", 0.0, 4.0, 0.22),
            num("pulse", "Dappled sun", 0.0, 1.0, 0.0),
            num("root_hue", "Shadow green", 0.0, 1.0, 0.39),
            num("leaf_hue", "Leaf hue", 0.0, 1.0, 0.31),
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "meteors",
        label: "Meteors",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("density", "Density", 0.0, 1.0, 0.5),
            num("tail", "Rate / tail", 0.0, 1.0, 0.5),
            sel("direction", "Direction", &["inward", "outward"]),
            rate("speed", "Speed", 0.0, 4.0, 1.0),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "warp",
        label: "Warp",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            num("density", "Star density", 0.0, 1.0, 0.5),
            rate("speed", "Speed", 0.0, 8.0, 1.0),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "waveform",
        label: "Waveform",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            sel("source", "Source", &["1", "2", "3", "4"]),
            num("ring", "Ring radius", 0.0, 1.0, 0.5),
            num("depth", "Depth", 0.0, 1.0, 0.5),
            num("thickness", "Thickness", 0.0, 1.0, 0.5),
            rate("drift", "Drift", 0.0, 4.0, 1.0),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        id: "spectrum",
        label: "Spectrum",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[
            sel("source", "Source", &["1", "2", "3", "4"]),
            num("length", "Bar length", 0.0, 1.0, 0.5),
            sel("from", "Bars grow from", &["outer", "inner"]),
            rate("drift", "Drift", 0.0, 4.0, 1.0),
            HUE,
            HUE_RANGE,
            SATURATION,
            BRIGHTNESS,
        ],
    },
    NodeType {
        // The pixel's own position as a field: radius 0 (inner) → 1 (outer),
        // angle in turns, x/y 0..1, spoke and pixel index as fractions.
        // After a Transform it reports the transformed position.
        id: "coordinate",
        label: "Coordinate",
        category: Category::Generator,
        inputs: &[],
        outputs: &out(Shape::FieldScalar),
        params: &[
            sel("which", "Which", &["radius", "angle", "x", "y", "spoke", "pixel"]),
            num("scale", "Scale", -8.0, 8.0, 1.0),
            num("offset", "Offset", -2.0, 2.0, 0.0),
            sel("wrap", "Wrap into 0..1", &["off", "on"]),
        ],
    },
    NodeType {
        // What the array showed last frame, at this pixel (after a Transform:
        // at the transformed position, so zoom/rotate trails work), times
        // Decay. Blend it under a new source for trails and echoes.
        id: "feedback",
        label: "Feedback",
        category: Category::Generator,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[num("decay", "Decay", 0.0, 1.0, 0.9)],
    },
    // -- Field ops ----------------------------------------------------------
    NodeType {
        id: "transform",
        label: "Transform",
        category: Category::FieldOp,
        inputs: &[PortDef {
            name: "in",
            shape: Shape::FieldColor,
        }],
        outputs: COLOR_OUT,
        params: &[
            num("rotate", "Rotate (turns)", -1.0, 1.0, 0.0),
            rate("spin", "Spin (turns/s)", -2.0, 2.0, 0.0),
            num("zoom", "Zoom", 0.1, 8.0, 1.0),
            num("kaleido", "Kaleidoscope", 0.0, 10.0, 0.0),
            sel("mirror", "Mirror", &["off", "on"]),
        ],
    },
    NodeType {
        id: "colorize",
        label: "Colorize",
        category: Category::FieldOp,
        inputs: &[PortDef {
            name: "in",
            shape: Shape::FieldScalar,
        }],
        outputs: COLOR_OUT,
        params: &[HUE, HUE_RANGE, SATURATION, BRIGHTNESS],
    },
    NodeType {
        id: "field_math",
        label: "Field math",
        category: Category::FieldOp,
        inputs: &[
            PortDef {
                name: "a",
                shape: Shape::FieldScalar,
            },
            PortDef {
                name: "b",
                shape: Shape::FieldScalar,
            },
        ],
        outputs: &out(Shape::FieldScalar),
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
            ),
            num("gain", "Gain", -4.0, 4.0, 1.0),
            num("offset", "Offset", -2.0, 2.0, 0.0),
        ],
    },
    NodeType {
        id: "luminance",
        label: "Brightness of",
        category: Category::FieldOp,
        inputs: &[PortDef {
            name: "in",
            shape: Shape::FieldColor,
        }],
        outputs: &out(Shape::FieldScalar),
        params: &[sel("measure", "Measure", &["luminance", "brightest channel", "alpha"])],
    },
    NodeType {
        id: "color_adjust",
        label: "Color adjust",
        category: Category::FieldOp,
        inputs: &[PortDef {
            name: "in",
            shape: Shape::FieldColor,
        }],
        outputs: COLOR_OUT,
        params: &[
            num("hue", "Hue shift (turns)", -1.0, 1.0, 0.0),
            num("saturation", "Saturation ×", 0.0, 3.0, 1.0),
            num("brightness", "Brightness ×", 0.0, 3.0, 1.0),
            num("contrast", "Contrast", 0.0, 3.0, 1.0),
            sel("invert", "Invert", &["off", "on"]),
        ],
    },
    NodeType {
        // A scalar field through a colour ramp (cosine palettes).
        id: "palette",
        label: "Palette",
        category: Category::FieldOp,
        inputs: &[PortDef {
            name: "in",
            shape: Shape::FieldScalar,
        }],
        outputs: COLOR_OUT,
        params: &[
            sel(
                "palette",
                "Palette",
                &["rainbow", "fire", "ocean", "neon", "pastel", "mono", "sunset", "forest"],
            ),
            num("cycles", "Cycles", 0.1, 8.0, 1.0),
            num("offset", "Offset", -1.0, 1.0, 0.0),
            BRIGHTNESS,
        ],
    },
    // -- Combine ------------------------------------------------------------
    NodeType {
        // Another patch as one node (`NodeInst::sub`): its exposed knobs are
        // this node's inputs ("{node}.{param}"), its Output is `out`. Inlined
        // by `flatten` before validation and codegen; nothing downstream sees
        // it, so it has no static ports or params.
        id: "subpatch",
        label: "Sub-patch",
        category: Category::Combine,
        inputs: &[],
        outputs: COLOR_OUT,
        params: &[],
    },
    NodeType {
        // A Code node's ports and body live on the instance (`NodeInst::code`,
        // see `code`): all Scalar/Event ports → interpreted on the CPU; a
        // field output → pasted into the shader. No static ports or params.
        id: "code",
        label: "Code",
        category: Category::Code,
        inputs: &[],
        outputs: &[],
        params: &[],
    },
    NodeType {
        id: "blend",
        label: "Blend",
        category: Category::Combine,
        inputs: &[
            PortDef {
                name: "base",
                shape: Shape::FieldColor,
            },
            PortDef {
                name: "over",
                shape: Shape::FieldColor,
            },
        ],
        outputs: COLOR_OUT,
        params: &[
            sel(
                "mode",
                "Mode",
                &["add", "multiply", "screen", "alpha_over", "max"],
            ),
            num("opacity", "Opacity", 0.0, 1.0, 1.0),
        ],
    },
    // -- Points -------------------------------------------------------------
    NodeType {
        id: "render_points",
        label: "Render points",
        category: Category::FieldOp,
        inputs: &[PortDef {
            name: "points",
            shape: Shape::Points,
        }],
        outputs: COLOR_OUT,
        params: &[
            // "as drawn" keeps each stroke's own pen; the rest override it.
            sel(
                "pen",
                "Pen",
                &[
                    "as drawn", "glow", "ripple", "sparkle", "comet", "ring", "beam", "ember",
                ],
            ),
            num("size", "Size ×", 0.1, 4.0, 1.0),
            num("intensity", "Intensity ×", 0.0, 2.0, 1.0),
        ],
    },
    NodeType {
        id: "render_effects",
        label: "Render effects",
        category: Category::FieldOp,
        inputs: &[PortDef {
            name: "effects",
            shape: Shape::Effects,
        }],
        outputs: COLOR_OUT,
        params: &[
            num("size", "Size ×", 0.1, 4.0, 1.0),
            num("intensity", "Intensity ×", 0.0, 2.0, 1.0),
        ],
    },
    // -- Texture ------------------------------------------------------------
    NodeType {
        id: "texture_sample",
        label: "Texture sample",
        category: Category::Texture,
        inputs: &[PortDef {
            name: "tex",
            shape: Shape::Texture,
        }],
        outputs: COLOR_OUT,
        params: &[
            num("zoom", "Zoom", 0.1, 8.0, 1.0),
            num("rotate", "Rotate (turns)", -1.0, 1.0, 0.0),
            num("kaleido", "Kaleidoscope", 0.0, 10.0, 0.0),
            num("saturation", "Saturation", 0.0, 2.0, 1.0),
            num("brightness", "Brightness", 0.0, 2.0, 1.0),
        ],
    },
    // -- Sink ---------------------------------------------------------------
    NodeType {
        id: "output",
        label: "Output",
        category: Category::Sink,
        inputs: &[PortDef {
            name: "in",
            shape: Shape::FieldColor,
        }],
        outputs: &[],
        params: &[num("master", "Master", 0.0, 2.0, 1.0)],
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
}
