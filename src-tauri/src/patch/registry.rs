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
            num("speed", "Speed", 0.0, 4.0, 1.0),
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
            num("speed", "Speed", 0.0, 4.0, 1.0),
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
            num("speed", "Speed", -4.0, 4.0, 1.0),
            HUE,
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
            num("spin", "Spin (turns/s)", -2.0, 2.0, 0.0),
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
            sel(
                "pen",
                "Pen",
                &[
                    "glow", "ripple", "sparkle", "comet", "ring", "beam", "ember",
                ],
            ),
            num("size", "Size", 0.01, 1.0, 0.12),
            num("intensity", "Intensity", 0.0, 2.0, 1.0),
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
