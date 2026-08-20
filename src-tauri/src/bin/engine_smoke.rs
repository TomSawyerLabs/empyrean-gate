//! Headless engine smoke test: init Vulkan, render a few frames with the default
//! config and layer stack, verify non-black output, print timing. Used by CI and for
//! quick local verification without opening a window.

use empyrean_gate_lib::config::AppConfig;
use empyrean_gate_lib::engine::{AudioUniform, Engine, FrameInputs, Globals};
use empyrean_gate_lib::layers::MAX_AUDIO_SOURCES;
use std::time::Instant;

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let cfg = AppConfig::default();
    let npix = cfg.geometry.pixel_count() as u32;

    // wgpu can panic (not error) when no backend exists for the platform; report
    // that as the same clean failure so CI can distinguish "no GPU" from a crash.
    let engine = std::panic::catch_unwind(|| Engine::new(npix)).unwrap_or_else(|p| {
        let msg = p
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_else(|| "unknown panic".into());
        Err(anyhow::anyhow!("No Vulkan adapter (GPU init panicked: {msg})"))
    });
    let mut engine = match engine {
        Ok(e) => e,
        Err(e) => {
            eprintln!("ENGINE INIT FAILED: {e:#}");
            std::process::exit(1);
        }
    };
    println!("adapter: {}", engine.gpu_name);

    let mut audio = [AudioUniform::default(); MAX_AUDIO_SOURCES];
    audio[0] = AudioUniform {
        level: 0.6,
        bass: 0.7,
        mid: 0.4,
        treble: 0.5,
        onset: 0.8,
        beat_phase: 0.3,
        bpm: 128.0,
        bass_att: 0.5,
        mid_att: 0.4,
        treble_att: 0.4,
        ..Default::default()
    };

    let mut checksum = 0u64;
    let mut nonzero = 0usize;
    let frames = 10;
    let t0 = Instant::now();
    for f in 0..frames {
        let t = f as f32 / 60.0;
        let layers: Vec<_> = cfg
            .layers
            .iter()
            .map(|l| l.to_gpu(t * l.speed))
            .collect();
        let inputs = FrameInputs {
            globals: Globals {
                spokes: cfg.geometry.spokes,
                pixels: cfg.geometry.pixels_per_spoke,
                layer_count: layers.len() as u32,
                effect_count: 0,
                time: t,
                dt: 1.0 / 60.0,
                master: 1.0,
                inner_over_outer: cfg.geometry.inner_radius_ft / cfg.geometry.outer_radius_ft,
                tilt_x: 0.0,
                tilt_y: 0.0,
                shake: 0.0,
                yaw: 0.0,
                ..Default::default()
            },
            audio,
            layers,
            effects: Vec::new(),
            dabs: Vec::new(),
            scope: vec![
                0.0;
                empyrean_gate_lib::engine::SCOPE_FLOATS
                    * empyrean_gate_lib::layers::MAX_AUDIO_SOURCES
            ],
        };
        match engine.render(&inputs) {
            Ok(Some(rgb)) => {
                for b in rgb {
                    checksum = checksum.wrapping_mul(31).wrapping_add(*b as u64);
                    if *b != 0 {
                        nonzero += 1;
                    }
                }
            }
            Ok(None) => {} // first frame: ping-pong warmup
            Err(e) => {
                eprintln!("RENDER FAILED at frame {f}: {e:#}");
                std::process::exit(1);
            }
        }
    }
    let elapsed = t0.elapsed();
    println!(
        "{} frames of {} px in {:.1} ms ({:.2} ms/frame), checksum {checksum:#x}, {nonzero} nonzero bytes",
        frames,
        npix,
        elapsed.as_secs_f32() * 1000.0,
        elapsed.as_secs_f32() * 1000.0 / frames as f32
    );
    if nonzero == 0 {
        eprintln!("SMOKE TEST FAILED: output is entirely black");
        std::process::exit(1);
    }
    println!("engine smoke test OK");
}
