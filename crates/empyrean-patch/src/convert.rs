//! "Convert to Code": a built-in node becomes a Code node with the same id,
//! wires and knob values, and a body that reproduces it, as a starting
//! point for writing something new (plans/code-node.md, round 3).
//!
//! GPU kinds come from the generator itself, run in its symbolic mode (knob
//! names instead of slab slots, port names instead of neighbour calls), so
//! the body is exactly what the shader runs. CPU kinds have a script
//! template each, written to match `eval.rs` and checked against it in the
//! tests. Select params are baked into the body for the current choice (the
//! header comment says which). Knob names that are not valid port names
//! (`min`, `max`, `length`…) are renamed, wires and exposures following.

use crate::code::{self, CodeDef, CodePort};
use crate::registry::{self, ParamKind};
use crate::{NodeInst, PatchDoc, Shape};

/// Whether a node of this kind can be converted.
pub fn convertible(kind: &str) -> bool {
    if cpu_template_kind(kind) {
        return true;
    }
    registry::is_gpu_kind(kind)
        && !matches!(
            kind,
            // Read buffers that Code ports cannot name yet, or are sources
            // with no function of their own, or are the sink.
            "render_points"
                | "render_effects"
                | "texture_sample"
                | "touch_dabs"
                | "effects_in"
                | "video_in"
                | "image_in"
                | "clip"
                | "output"
        )
}

fn cpu_template_kind(kind: &str) -> bool {
    matches!(
        kind,
        "time"
            | "slider"
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

/// The port name a built-in param or port gets on the Code node: itself
/// when the Code rules allow it, else a reading that does.
pub fn port_name(name: &str) -> String {
    if code::check_ident(name).is_ok() {
        return name.to_string();
    }
    let mapped = match name {
        "min" => "low",
        "max" => "high",
        "length" => "len",
        "floor" => "base",
        "step" => "advance",
        "set" => "turn_on",
        _ => "",
    };
    if !mapped.is_empty() && code::check_ident(mapped).is_ok() {
        return mapped.to_string();
    }
    format!("{name}_")
}

/// Convert node `id` of `doc` in place. The node keeps its id and position;
/// its knob values move under the (possibly renamed) port names; wires and
/// exposed entries that touch it are renamed to match.
pub fn convert(doc: &mut PatchDoc, id: &str) -> Result<(), String> {
    let index = doc
        .nodes
        .iter()
        .position(|n| n.id == id)
        .ok_or_else(|| format!("no node \"{id}\""))?;
    let node = &doc.nodes[index];
    if !convertible(&node.kind) {
        return Err(format!("a {} node cannot be converted to Code", node.kind));
    }
    let def = if cpu_template_kind(&node.kind) {
        cpu_template(node)?
    } else {
        gpu_definition(doc, index)?
    };
    // Every knob value moves under its port name; renamed ones follow.
    let renames: Vec<(String, String)> = registry::lookup(&node.kind)
        .map(|t| {
            t.params
                .iter()
                .map(|p| p.name)
                .chain(t.inputs.iter().map(|p| p.name))
                .chain(t.outputs.iter().map(|p| p.name))
                .filter(|n| port_name(n) != *n)
                .map(|n| (n.to_string(), port_name(n)))
                .collect()
        })
        .unwrap_or_default();
    let rename = |name: &str| -> String {
        renames
            .iter()
            .find(|(old, _)| old == name)
            .map(|(_, new)| new.clone())
            .unwrap_or_else(|| name.to_string())
    };
    let node = &mut doc.nodes[index];
    let params = std::mem::take(&mut node.params);
    for (k, v) in params {
        // Select values are baked into the body; only knobs stay.
        if def.input(&rename(&k)).is_some_and(|p| p.shape == Shape::Scalar) {
            node.params.insert(rename(&k), v);
        }
    }
    node.kind = code::KIND.to_string();
    node.code = Some(Box::new(def));
    for e in &mut doc.edges {
        if e.to.node == id {
            e.to.port = rename(&e.to.port);
        }
        if e.from.node == id {
            e.from.port = rename(&e.from.port);
        }
    }
    for x in &mut doc.exposed {
        if x.node == id {
            x.param = rename(&x.param);
        }
    }
    doc.exposed.retain(|x| {
        x.node != id || doc.nodes[index].code().is_some_and(|d| d.input(&x.param).is_some())
    });
    Ok(())
}

fn knob_port(p: &registry::ParamDef) -> CodePort {
    CodePort {
        name: port_name(p.name),
        shape: Shape::Scalar,
        min: p.min,
        max: p.max,
        default: p.default,
        integrate: p.integrate,
    }
}

/// `// kind: choice` lines for every Select param, so the baked choices
/// are visible at the top of the body.
fn header(node: &NodeInst, ty: &registry::NodeType) -> String {
    let mut h = format!("// Converted from {} ({}).", ty.label, ty.id);
    let mut baked = Vec::new();
    for p in ty.params {
        if let ParamKind::Select(options) = p.kind {
            let i = (node.param(p.name).round().clamp(0.0, options.len() as f32 - 1.0)) as usize;
            baked.push(format!("{} = {}", p.label, options[i]));
        }
    }
    if !baked.is_empty() {
        h.push_str("\n// Baked in: ");
        h.push_str(&baked.join("; "));
        h.push('.');
    }
    h
}

fn gpu_definition(doc: &PatchDoc, index: usize) -> Result<CodeDef, String> {
    let node = &doc.nodes[index];
    let ty = registry::lookup(&node.kind).ok_or("unknown kind")?;
    let out_shape = ty.output_shape("out").ok_or("no `out`")?;
    let inputs: Vec<CodePort> = ty
        .params
        .iter()
        .filter(|p| matches!(p.kind, ParamKind::Number))
        .map(knob_port)
        .chain(ty.inputs.iter().map(|p| CodePort {
            name: port_name(p.name),
            shape: p.shape,
            ..Default::default()
        }))
        .collect();
    let raw = crate::codegen::builtin_body(doc, index)?;
    let mut body = header(node, ty);
    body.push('\n');
    if raw.contains("c0") {
        body.push_str("let c0 = c;\n");
    }
    // Un-indent the generated body (four spaces inside a fn) and turn the
    // final `return X;` into `out = X;`.
    let mut lines: Vec<String> = raw
        .lines()
        .map(|l| l.strip_prefix("    ").unwrap_or(l).trim_end().to_string())
        .collect();
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    if let Some(last) = lines.last_mut()
        && let Some(expr) = last.trim().strip_prefix("return ")
    {
        *last = format!("out = {expr}");
    }
    body.push_str(&lines.join("\n"));
    body.push('\n');
    Ok(CodeDef {
        inputs,
        outputs: vec![CodePort {
            name: "out".into(),
            shape: out_shape,
            ..Default::default()
        }],
        body,
    })
}

// --- CPU templates ---------------------------------------------------------

fn cpu_template(node: &NodeInst) -> Result<CodeDef, String> {
    let ty = registry::lookup(&node.kind).ok_or("unknown kind")?;
    let sel = |name: &str| node.param(name).round() as u32;
    let scalar_out = |name: &str| CodePort {
        name: name.into(),
        shape: Shape::Scalar,
        ..Default::default()
    };
    let event = |name: &str| CodePort {
        name: port_name(name),
        shape: Shape::Event,
        ..Default::default()
    };
    let knobs: Vec<CodePort> = ty
        .params
        .iter()
        .filter(|p| matches!(p.kind, ParamKind::Number))
        .map(knob_port)
        .collect();
    let event_inputs: Vec<CodePort> = ty
        .inputs
        .iter()
        .filter(|p| p.shape == Shape::Event)
        .map(|p| event(p.name))
        .collect();
    let outputs: Vec<CodePort> = ty
        .outputs
        .iter()
        .map(|p| match p.shape {
            Shape::Event => event(p.name),
            _ => scalar_out(p.name),
        })
        .collect();
    let body = match node.kind.as_str() {
        "slider" => "out = value;".to_string(),
        "scalar_math" => {
            let op = match sel("op") {
                0 => "a + b",
                1 => "a - b",
                2 => "a * b",
                3 => "min(a, b)",
                4 => "max(a, b)",
                5 => "select(0.0, a / b, b != 0.0)",
                // Wraps into 0..b for a positive b, as the built-in does.
                6 => "select(0.0, a - b * floor(a / b), b != 0.0)",
                7 => "pow(a, b)",
                8 => "f32(a > b)",
                9 => "f32(a < b)",
                10 => "abs(a)",
                11 => "floor(a)",
                12 => "sin(TAU * a)",
                _ => "cos(TAU * a)",
            };
            format!("out = {op};")
        }
        "lfo" => {
            let wave = match sel("wave") {
                0 => "0.5 + 0.5 * sin(TAU * ph)",
                1 => "1.0 - abs(2.0 * ph - 1.0)",
                2 => "f32(ph < 0.5)",
                _ => "ph",
            };
            format!(
                "state.phase = fract(state.phase + max(rate, 0.0) * master_speed * dt);\n\
                 let ph = state.phase;\n\
                 let w = {wave};\n\
                 out = low + (high - low) * w;"
            )
        }
        "smooth" => "let k = select(min(dt / seconds, 1.0), 1.0, seconds <= 1e-4);\n\
                     state.y += (in - state.y) * k;\n\
                     out = state.y;"
            .to_string(),
        "envelope" => "if trigger {\n  state.t = 0.0;\n  state.armed = 1.0;\n} else {\n  state.t += dt;\n}\n\
                       if state.armed == 0.0 {\n  out = 0.0;\n  return;\n}\n\
                       let a = max(attack, 0.0);\n\
                       let d = max(decay, 1e-3);\n\
                       out = select(peak * exp(-(state.t - a) / d), peak * (state.t / max(a, 1e-4)), state.t < a);"
            .to_string(),
        "map_range" => {
            let clamp = if sel("clamp") == 1 {
                "\nv = clamp(v, min(out_min, out_max), max(out_min, out_max));"
            } else {
                ""
            };
            format!(
                "let t = select((in - in_min) / (in_max - in_min), 0.0, abs(in_max - in_min) < 1e-9);\n\
                 var v = out_min + (out_max - out_min) * t;{clamp}\n\
                 out = v;"
            )
        }
        "mix" => "out = a + (b - a) * t;".to_string(),
        "clamp" => "out = clamp(in, min(low, high), max(low, high));".to_string(),
        "random" => "// The built-in draws from xorshift seeded by the node id; this hashes a counter.\n\
                     var fire = trigger;\n\
                     if state.init == 0.0 {\n  state.init = 1.0;\n  state.n = 1.0;\n  state.target = low + (high - low) * fract(sin(state.n * 12.9898) * 43758.5453);\n  state.from = state.target;\n  state.glide_t = max(glide, 0.0);\n}\n\
                     if rate > 0.0 {\n  state.acc += max(rate, 0.0) * master_speed * dt;\n  if state.acc >= 1.0 {\n    state.acc = fract(state.acc);\n    fire = true;\n  }\n}\n\
                     let g = max(glide, 0.0);\n\
                     var current = state.target;\n\
                     if g > 1e-4 && state.glide_t < g {\n  current = state.from + (state.target - state.from) * (state.glide_t / g);\n}\n\
                     if fire {\n  state.from = current;\n  state.n += 1.0;\n  state.target = low + (high - low) * fract(sin(state.n * 12.9898) * 43758.5453);\n  state.glide_t = 0.0;\n  changed = true;\n} else {\n  state.glide_t += dt;\n}\n\
                     if g > 1e-4 && state.glide_t < g {\n  out = state.from + (state.target - state.from) * (state.glide_t / g);\n} else {\n  out = state.target;\n}"
            .to_string(),
        "counter" => "let n = max(round(steps), 0.0);\n\
                      if reset {\n  state.count = 0.0;\n}\n\
                      if count {\n  state.count += 1.0;\n}\n\
                      if n > 0.0 && state.count >= n {\n  state.count = 0.0;\n  wrap = count;\n}\n\
                      out = state.count;\n\
                      phase = select(0.0, state.count / n, n > 0.0);"
            .to_string(),
        "toggle" => format!(
            "if state.init == 0.0 {{\n  state.init = 1.0;\n  state.on = {initial};\n}}\n\
             let was = state.on;\n\
             var now = was;\n\
             if toggle {{\n  now = 1.0 - now;\n}}\n\
             if turn_on {{\n  now = 1.0;\n}}\n\
             if clear {{\n  now = 0.0;\n}}\n\
             on = now != was && now == 1.0;\n\
             off = now != was && now == 0.0;\n\
             state.on = now;\n\
             out = now;",
            initial = if sel("initial") == 1 { "1.0" } else { "0.0" }
        ),
        "threshold" => "let half = max(hysteresis, 0.0) * 0.5;\n\
                        var now = in > level;\n\
                        if state.init == 1.0 {\n  now = select(in > level + half, in >= level - half, state.latch == 1.0);\n}\n\
                        if state.init == 1.0 && f32(now) != state.latch {\n  rise = now;\n  fall = !now;\n}\n\
                        state.init = 1.0;\n\
                        state.latch = f32(now);\n\
                        out = f32(now);"
            .to_string(),
        "delay" => "// The built-in queues up to 64 pending fires (echoes included); this keeps one.\n\
                    if state.pending > 0.0 {\n  state.t -= dt;\n  if state.t <= 0.0 {\n    state.pending = 0.0;\n    out = true;\n  }\n}\n\
                    if in {\n  if max(seconds, 0.0) <= 1e-4 {\n    out = true;\n  } else {\n    state.pending = 1.0;\n    state.t = max(seconds, 0.0);\n  }\n}"
            .to_string(),
        // `c` is the pixel context's name, so that port is `c_`.
        "event_merge" => "out = open > 0.5 && (a || b || c_ || d);".to_string(),
        "sequence" => "let n = clamp(round(steps), 1.0, 8.0);\n\
                       if reset {\n  state.i = 0.0;\n}\n\
                       if advance {\n  state.i += 1.0;\n}\n\
                       if state.i >= n {\n  state.i = 0.0;\n  wrap = advance;\n}\n\
                       index = state.i;\n\
                       var v = v1;\n\
                       if state.i == 1.0 { v = v2; }\n\
                       if state.i == 2.0 { v = v3; }\n\
                       if state.i == 3.0 { v = v4; }\n\
                       if state.i == 4.0 { v = v5; }\n\
                       if state.i == 5.0 { v = v6; }\n\
                       if state.i == 6.0 { v = v7; }\n\
                       if state.i == 7.0 { v = v8; }\n\
                       out = v;"
            .to_string(),
        "time" => {
            let common = "if reset {\n  state.acc = 0.0;\n  state.cycle = 0.0;\n}\n\
                          if running > 0.5 {\n  state.acc += rate * master_speed * dt;\n}\n\
                          let span = end - start;\n\
                          let k = select(0.0, state.acc / span, span != 0.0);\n\
                          let cycle = floor(k);\n\
                          let f = k - cycle;\n";
            let wrap_cycles = "if span != 0.0 && cycle != state.cycle && !reset {\n  wrap = true;\n}\n\
                               state.cycle = cycle;\n";
            match sel("mode") {
                1 => format!("{common}out = start + span * f;\nphase = f;\n{wrap_cycles}"),
                2 => format!(
                    "{common}let p = select(1.0 - f, f, cycle % 2.0 == 0.0);\nout = start + span * p;\nphase = p;\n{wrap_cycles}"
                ),
                3 => format!(
                    "{common}let p = clamp(k, 0.0, 1.0);\nout = start + span * p;\nphase = p;\n\
                     if span != 0.0 {{\n  let done = k >= 1.0 || k < 0.0;\n  let was = state.cycle != 0.0;\n  state.cycle = f32(done);\n  wrap = done && !was;\n}}\n"
                ),
                _ => format!("{common}out = start + state.acc;\nphase = f;\n{wrap_cycles}"),
            }
        }
        other => return Err(format!("no template for {other}")),
    };
    let mut full = header(node, ty);
    full.push('\n');
    full.push_str(&body);
    full.push('\n');
    Ok(CodeDef {
        inputs: knobs.into_iter().chain(event_inputs).collect(),
        outputs,
        body: full,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi::{AudioUniform, MAX_AUDIO_SOURCES};
    use crate::codegen::compile;
    use crate::eval::{DjLinkInputs, EvalInputs, Runtime};
    use crate::touch::Touches;
    use crate::{Edge, PortRef};

    fn node(id: &str, kind: &str, params: &[(&str, f32)]) -> NodeInst {
        NodeInst {
            id: id.into(),
            kind: kind.into(),
            params: params.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            ..Default::default()
        }
    }

    fn edge(f: &str, fp: &str, t: &str, tp: &str) -> Edge {
        Edge {
            from: PortRef { node: f.into(), port: fp.into() },
            to: PortRef { node: t.into(), port: tp.into() },
        }
    }

    #[test]
    fn every_name_a_convertible_kind_uses_is_a_port_name() {
        for t in registry::TYPES {
            if !convertible(t.id) {
                continue;
            }
            for name in t
                .params
                .iter()
                .map(|p| p.name)
                .chain(t.inputs.iter().map(|p| p.name))
                .chain(t.outputs.iter().map(|p| p.name))
            {
                let mapped = port_name(name);
                assert!(code::check_ident(&mapped).is_ok(), "{}: {name} -> {mapped}", t.id);
            }
        }
    }

    /// Every convertible GPU kind converts, compiles, and validates as WGSL,
    /// with its knobs as ports and its field inputs wired through.
    #[test]
    fn gpu_kinds_convert_and_compile() {
        for t in registry::TYPES {
            if !convertible(t.id) || cpu_template_kind(t.id) {
                continue;
            }
            let mut doc = PatchDoc {
                nodes: vec![
                    node("grey", "coordinate", &[]),
                    node("colour", "noise_field", &[]),
                    node("n", t.id, &[]),
                    node("o", "output", &[]),
                ],
                edges: vec![edge("n", "out", "o", "in")],
                ..Default::default()
            };
            // Feed every field input so a converted body references its ports.
            for inp in t.inputs {
                let src = if inp.shape == Shape::FieldScalar { "grey" } else { "colour" };
                doc.edges.push(edge(src, "out", "n", inp.name));
            }
            // A knob set off its default must survive the conversion.
            let first_knob = t.params.iter().find(|p| matches!(p.kind, ParamKind::Number));
            if let Some(p) = first_knob {
                doc.nodes[2].params.insert(p.name.to_string(), p.min);
            }
            convert(&mut doc, "n").unwrap_or_else(|e| panic!("{}: {e}", t.id));
            let n = &doc.nodes[2];
            assert_eq!(n.kind, "code");
            let def = n.code().unwrap();
            assert!(def.body.starts_with("// Converted from"), "{}", t.id);
            assert!(def.body.contains("out = "), "{}: {}", t.id, def.body);
            if let Some(p) = first_knob {
                assert_eq!(n.params.get(&port_name(p.name)), Some(&p.min), "{}", t.id);
                assert!(def.input(&port_name(p.name)).is_some());
            }
            let prog = compile(&doc).unwrap_or_else(|e| panic!("{}: {e}\n{}", t.id, doc.nodes[2].code().unwrap().body));
            let module = naga::front::wgsl::parse_str(&prog.wgsl)
                .unwrap_or_else(|e| panic!("{}: {e}\n{}", t.id, def.body));
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::default(),
            )
            .validate(&module)
            .unwrap_or_else(|e| panic!("{}: {e:?}\n{}", t.id, def.body));
        }
    }

    #[test]
    fn selects_are_baked_and_named_and_rates_integrate() {
        let mut doc = PatchDoc {
            nodes: vec![node("n", "spoke_chase", &[("direction", 1.0), ("speed", 2.0)]), node("o", "output", &[])],
            edges: vec![edge("n", "out", "o", "in")],
            ..Default::default()
        };
        convert(&mut doc, "n").unwrap();
        let def = doc.nodes[0].code().unwrap();
        assert!(def.body.contains("Direction = outward"), "{}", def.body);
        assert!(def.input("speed").unwrap().integrate, "a rate stays a rate");
        assert!(!def.input("direction").is_some(), "selects are not ports");
        assert_eq!(doc.nodes[0].params.get("speed"), Some(&2.0));
        assert!(doc.nodes[0].params.get("direction").is_none());
        let prog = compile(&doc).unwrap();
        assert!(prog.slots.iter().any(|s| s.node == 0 && s.param.as_deref() == Some("speed") && s.integrate));
    }

    #[test]
    fn renamed_knobs_carry_their_wires_and_exposures() {
        let mut doc = PatchDoc {
            nodes: vec![node("lfo", "lfo", &[]), node("c", "clamp", &[("max", 0.5)]), node("sol", "solid", &[]), node("o", "output", &[])],
            edges: vec![edge("lfo", "out", "c", "min"), edge("c", "out", "sol", "brightness"), edge("sol", "out", "o", "in")],
            exposed: vec![crate::ExposedParam { node: "c".into(), param: "max".into(), label: "Max".into() }],
            ..Default::default()
        };
        convert(&mut doc, "c").unwrap();
        assert_eq!(doc.edges[0].to.port, "low");
        assert_eq!(doc.exposed[0].param, "high");
        assert_eq!(doc.nodes[1].params.get("high"), Some(&0.5));
        compile(&doc).expect("compiles");
    }

    #[test]
    fn unconvertible_kinds_are_refused() {
        for kind in ["output", "audio", "render_points", "video_in", "subpatch"] {
            let mut doc = PatchDoc {
                nodes: vec![node("n", kind, &[]), node("o", "output", &[])],
                ..Default::default()
            };
            assert!(convert(&mut doc, "n").is_err(), "{kind}");
            assert!(!convertible(kind));
        }
    }

    // -- CPU templates against the real nodes ---------------------------------

    fn inputs<'a>(audio: &'a [AudioUniform; MAX_AUDIO_SOURCES], touch: &'a crate::touch::TouchView, dt: f32) -> EvalInputs<'a> {
        EvalInputs {
            dt,
            // 1.25 keeps the per-frame steps exact in f32, so a phase that
            // lands on a cycle boundary lands there for both runtimes.
            master_speed: 1.25,
            master_brightness: 1.0,
            master_hue: 0.0,
            master_hue_amount: 0.0,
            audio,
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            shake: 0.0,
            effect_seq: 0,
            dj_link: DjLinkInputs::default(),
            touch,
        }
    }

    /// `kind` with `params`, its scalar inputs `wired` from a looping Time
    /// node's `out` and its event inputs from that node's `wrap` (every
    /// fourth frame at dt 0.25), run as the built-in and as its conversion
    /// for 120 frames: every scalar output within 1e-4 and every event
    /// identical, frame by frame.
    fn check_template(kind: &str, params: &[(&str, f32)], wired: &[&str], events: &[&str]) {
        let ty = registry::lookup(kind).unwrap();
        let mut doc = PatchDoc {
            nodes: vec![
                node("clock", "time", &[("mode", 1.0), ("rate", 0.7)]),
                node("n", kind, params),
                node("o", "output", &[]),
            ],
            ..Default::default()
        };
        for w in wired {
            doc.edges.push(edge("clock", "out", "n", w));
        }
        for e in events {
            doc.edges.push(edge("clock", "wrap", "n", e));
        }
        let mut converted = doc.clone();
        convert(&mut converted, "n").unwrap_or_else(|e| panic!("{kind}: {e}"));
        let body = converted.nodes[1].code().unwrap().body.clone();
        let a = compile(&doc).unwrap();
        let b = compile(&converted).unwrap_or_else(|e| panic!("{kind}: {e}\n{body}"));
        let mut ra = Runtime::new(a);
        let mut rb = Runtime::new(b);
        let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
        let touches = Touches::new();
        let view = touches.view(0.0, 0.0);
        for frame in 0..120 {
            let inp = inputs(&audio, &view, 0.25);
            ra.eval(&inp);
            rb.eval(&inp);
            for p in ty.outputs {
                let (va, vb) = (ra.scalar_value(1, p.name), rb.scalar_value(1, &port_name(p.name)));
                assert!(
                    (va - vb).abs() <= 1e-4 * va.abs().max(1.0),
                    "{kind}.{} differs at frame {frame}: built-in {va}, converted {vb}\n{body}",
                    p.name
                );
            }
        }
    }

    #[test]
    fn cpu_templates_match_the_builtins() {
        check_template("slider", &[("value", 0.3)], &[], &[]);
        for op in 0..14 {
            check_template("scalar_math", &[("op", op as f32), ("b", 0.7)], &["a"], &[]);
        }
        for wave in 0..4 {
            check_template("lfo", &[("wave", wave as f32), ("rate", 0.9), ("min", 0.2)], &["max"], &[]);
        }
        check_template("smooth", &[("seconds", 0.6)], &["in"], &[]);
        check_template("smooth", &[("seconds", 0.0)], &["in"], &[]);
        check_template("envelope", &[("attack", 0.3), ("decay", 0.8)], &[], &["trigger"]);
        check_template("map_range", &[("in_min", 0.2), ("out_max", 3.0)], &["in"], &[]);
        check_template("map_range", &[("clamp", 1.0), ("in_max", 0.5)], &["in"], &[]);
        check_template("mix", &[("t", 0.3)], &["a"], &[]);
        check_template("clamp", &[("min", 0.3), ("max", 0.6)], &["in"], &[]);
        check_template("counter", &[("steps", 3.0)], &[], &["count"]);
        for initial in 0..2 {
            check_template("toggle", &[("initial", initial as f32)], &[], &["toggle"]);
        }
        check_template("threshold", &[("level", 0.5), ("hysteresis", 0.2)], &["in"], &[]);
        check_template("delay", &[("seconds", 0.5)], &[], &["in"]);
        check_template("delay", &[("seconds", 0.0)], &[], &["in"]);
        check_template("event_merge", &[], &[], &["b"]);
        check_template("sequence", &[("steps", 3.0), ("v2", 0.9)], &[], &["step"]);
        for mode in 0..4 {
            check_template("time", &[("mode", mode as f32), ("rate", 0.8), ("end", 2.0)], &[], &["reset"]);
        }
    }

    /// Events are compared through their meters (fire counts), which
    /// `scalar_value` reports for event ports; this covers the event
    /// outputs of Counter, Toggle, Threshold, Delay, Merge, Sequence, Time.
    #[test]
    fn cpu_template_events_match() {
        for (kind, params, wired, events, out) in [
            ("counter", vec![("steps", 2.0)], vec![], vec!["count"], "wrap"),
            ("toggle", vec![], vec![], vec!["toggle"], "on"),
            ("threshold", vec![("level", 0.5)], vec!["in"], vec![], "rise"),
            ("delay", vec![("seconds", 0.5)], vec![], vec!["in"], "out"),
            ("event_merge", vec![], vec![], vec!["c"], "out"),
            ("sequence", vec![("steps", 2.0)], vec![], vec!["step"], "wrap"),
            ("time", vec![("mode", 1.0), ("rate", 0.8)], vec![], vec![], "wrap"),
        ] {
            let mut doc = PatchDoc {
                nodes: vec![node("clock", "time", &[("mode", 1.0), ("rate", 0.7)]), node("n", kind, &params), node("o", "output", &[])],
                ..Default::default()
            };
            for w in &wired {
                doc.edges.push(edge("clock", "out", "n", w));
            }
            for e in &events {
                doc.edges.push(edge("clock", "wrap", "n", e));
            }
            let mut converted = doc.clone();
            convert(&mut converted, "n").unwrap();
            let mut ra = Runtime::new(compile(&doc).unwrap());
            let mut rb = Runtime::new(compile(&converted).unwrap());
            let audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
            let touches = Touches::new();
            let view = touches.view(0.0, 0.0);
            for frame in 0..120 {
                let inp = inputs(&audio, &view, 0.25);
                ra.eval(&inp);
                rb.eval(&inp);
                assert_eq!(
                    ra.scalar_value(1, out),
                    rb.scalar_value(1, &port_name(out)),
                    "{kind}.{out} fire count differs at frame {frame}"
                );
            }
            assert!(ra.scalar_value(1, out) > 0.0, "{kind}.{out} never fired: the test is hollow");
        }
    }
}
