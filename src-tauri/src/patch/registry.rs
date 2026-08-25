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

/// Shared color-mapping knobs used by every generator that owns its palette.
const HUE: ParamDef = num("hue", "Hue", 0.0, 1.0, 0.6);
const HUE_RANGE: ParamDef = num("hue_range", "Hue range", 0.0, 1.0, 0.2);
const SATURATION: ParamDef = num("saturation", "Saturation", 0.0, 1.0, 0.9);
const BRIGHTNESS: ParamDef = num("brightness", "Brightness", 0.0, 2.0, 1.0);

pub const TYPES: &[NodeType] = &[
    // -- Inputs -------------------------------------------------------------
    NodeType {
        id: "time",
        label: "Time",
        category: Category::Input,
        inputs: &[],
        outputs: SCALAR_OUT,
        params: &[num("rate", "Rate", 0.0, 8.0, 1.0)],
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
        id: "tap",
        label: "Taps",
        category: Category::Input,
        inputs: &[],
        outputs: &[PortDef {
            name: "tap",
            shape: Shape::Event,
        }],
        params: &[],
    },
    NodeType {
        id: "dj_link",
        label: "PRO DJ LINK",
        category: Category::Input,
        inputs: &[],
        outputs: &[
            PortDef { name: "active", shape: Shape::Scalar },
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
            PortDef { name: "play", shape: Shape::Event },
            PortDef { name: "cue", shape: Shape::Event },
            PortDef { name: "cue_release", shape: Shape::Event },
            PortDef { name: "on_air_event", shape: Shape::Event },
            PortDef { name: "off_air_event", shape: Shape::Event },
            PortDef { name: "loop_start", shape: Shape::Event },
            PortDef { name: "loop_wrap", shape: Shape::Event },
            PortDef { name: "loop_end", shape: Shape::Event },
            PortDef { name: "jump", shape: Shape::Event },
        ],
        params: &[],
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
    // -- Scalar ops ---------------------------------------------------------
    NodeType {
        id: "scalar_math",
        label: "Math",
        category: Category::ScalarOp,
        inputs: &[],
        outputs: SCALAR_OUT,
        params: &[
            sel("op", "Op", &["add", "subtract", "multiply", "min", "max"]),
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
    // -- Combine ------------------------------------------------------------
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
