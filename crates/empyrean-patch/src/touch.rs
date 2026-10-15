//! Raw touch: which finger, where, since when, how fast, and whose. The patch
//! decides what a touch means (the Touch, Touch mask and Touch glow nodes);
//! nothing here draws anything.
//!
//! Hosts feed [`TouchInput`]s as they arrive (the gate from every connected
//! client, the playground from its canvas) with a clock in seconds, and read a
//! [`TouchView`] (for the evaluator) and [`GpuTouch`] records (for the shader)
//! once per frame. Positions are stored as the finger touched them, in the
//! array's physical frame, and converted to the composition frame (which
//! [`crate::effects::Spin`] rotates) when read, so a finger's glow stays under
//! the finger while the pattern turns, and its angle wires straight into the
//! Event effect node.

use crate::abi::GpuTouch;
use serde::{Deserialize, Serialize};

/// Fingers tracked at once, held or fading. Oldest released go first, then
/// the oldest held. Also the length of the shader's TOUCH uniform array.
pub const MAX_TOUCHES: usize = 32;
/// Seconds a released finger stays in the GPU records, so fields can fade it.
pub const TOUCH_LINGER: f32 = 2.0;
/// A finger that hasn't moved for this long reports zero speed.
const STILL_AFTER: f32 = 0.12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TouchPhase {
    Down,
    Move,
    Up,
}

/// One pointer event, as a client sends it.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TouchInput {
    /// The client's pointer id; hosts namespace it per source.
    pub id: u32,
    pub phase: TouchPhase,
    /// Physical angle in radians (spoke 0 = 0), as the gate preview's
    /// `toPolar` reports it.
    pub angle: f32,
    /// 0 center .. 1 outer edge (a little past 1 is allowed).
    pub radius: f32,
}

/// The toucher's color (their pen/effect color on the client). Hue < 0 is
/// white.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TouchColor {
    pub hue: f32,
    pub saturation: f32,
    pub brightness: f32,
}

impl Default for TouchColor {
    fn default() -> Self {
        Self {
            hue: -1.0,
            saturation: 0.85,
            brightness: 1.0,
        }
    }
}

#[derive(Debug, Clone)]
struct Finger {
    source: u64,
    id: u32,
    /// Order of touchdown, for "latest" and "first".
    seq: u64,
    angle: f32,
    radius: f32,
    /// Smoothed velocity in the physical cartesian frame (units/s).
    vx: f32,
    vy: f32,
    down_at: f32,
    up_at: Option<f32>,
    moved_at: f32,
    color: TouchColor,
}

impl Finger {
    fn cart(&self) -> (f32, f32) {
        (
            self.radius * self.angle.cos(),
            self.radius * self.angle.sin(),
        )
    }
}

/// One finger as the evaluator sees it.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct FingerState {
    /// Order of touchdown (higher = later).
    pub seq: u64,
    pub held: bool,
    /// Composition-frame angle (what Event effect's `angle` expects).
    pub angle: f32,
    pub radius: f32,
    /// Screen position as the gate preview draws it: x right, y up, -1..1.
    pub x: f32,
    pub y: f32,
    /// Seconds since touchdown (frozen at release).
    pub held_for: f32,
    pub speed: f32,
    /// Direction of motion on screen, radians (atan2 of y over x).
    pub dir: f32,
    pub hue: f32,
}

/// Everything the evaluator needs about touch this frame.
#[derive(Debug, Clone, Default)]
pub struct TouchView {
    pub fingers: Vec<FingerState>,
    /// Monotonic counts of touchdowns and releases since the tracker began:
    /// a node fires once per advance, so a tap shorter than a frame still
    /// produces both events.
    pub downs: u64,
    pub ups: u64,
    /// The most recent finger to touch down, held or not (outputs hold their
    /// last values after release).
    pub last: Option<FingerState>,
}

impl TouchView {
    pub fn held_count(&self) -> usize {
        self.fingers.iter().filter(|f| f.held).count()
    }
}

/// No touches at all, for hosts (and tests) without a touch surface.
pub static NO_TOUCH: TouchView = TouchView {
    fingers: Vec::new(),
    downs: 0,
    ups: 0,
    last: None,
};

#[derive(Debug, Clone, Default)]
pub struct Touches {
    fingers: Vec<Finger>,
    next_seq: u64,
    downs: u64,
    ups: u64,
    /// Snapshot of the latest finger to land, kept after it is dropped.
    last: Option<Finger>,
}

impl Touches {
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply one pointer event from `source` (a connection) at clock `now`.
    pub fn apply(&mut self, source: u64, now: f32, input: TouchInput, color: TouchColor) {
        let angle = if input.angle.is_finite() {
            input.angle
        } else {
            0.0
        };
        let radius = if input.radius.is_finite() {
            input.radius.clamp(0.0, 1.5)
        } else {
            0.0
        };
        let live = self
            .fingers
            .iter()
            .position(|f| f.source == source && f.id == input.id && f.up_at.is_none());
        match (input.phase, live) {
            (TouchPhase::Down, existing) => {
                // A repeated down for a live pointer (a lost up) ends it first.
                if let Some(i) = existing {
                    self.fingers[i].up_at = Some(now);
                    self.ups += 1;
                }
                self.make_room();
                let seq = self.next_seq;
                self.next_seq += 1;
                self.downs += 1;
                let finger = Finger {
                    source,
                    id: input.id,
                    seq,
                    angle,
                    radius,
                    vx: 0.0,
                    vy: 0.0,
                    down_at: now,
                    up_at: None,
                    moved_at: now,
                    color,
                };
                self.last = Some(finger.clone());
                self.fingers.push(finger);
            }
            (TouchPhase::Move, Some(i)) | (TouchPhase::Up, Some(i)) => {
                let f = &mut self.fingers[i];
                let (x0, y0) = f.cart();
                let dt = (now - f.moved_at).max(1e-3);
                f.angle = angle;
                f.radius = radius;
                let (x1, y1) = f.cart();
                // Smooth the velocity so one jittery sample doesn't spike it.
                f.vx += ((x1 - x0) / dt - f.vx) * 0.5;
                f.vy += ((y1 - y0) / dt - f.vy) * 0.5;
                f.moved_at = now;
                f.color = color;
                if input.phase == TouchPhase::Up {
                    f.up_at = Some(now);
                    self.ups += 1;
                }
                if self.last.as_ref().is_some_and(|l| l.seq == f.seq) {
                    self.last = Some(f.clone());
                }
            }
            // A move or up for a pointer we never saw down (or already
            // dropped): nothing to update.
            (TouchPhase::Move, None) | (TouchPhase::Up, None) => {}
        }
    }

    /// Fingers `source` currently holds down.
    pub fn live_count(&self, source: u64) -> usize {
        self.fingers
            .iter()
            .filter(|f| f.source == source && f.up_at.is_none())
            .count()
    }

    /// Release every live pointer of `source` (a client disconnected).
    pub fn release_source(&mut self, source: u64, now: f32) {
        for f in &mut self.fingers {
            if f.source == source && f.up_at.is_none() {
                f.up_at = Some(now);
                self.ups += 1;
            }
        }
    }

    /// Forget fingers released more than [`TOUCH_LINGER`] ago.
    pub fn expire(&mut self, now: f32) {
        self.fingers
            .retain(|f| f.up_at.is_none_or(|t| now - t < TOUCH_LINGER));
    }

    fn make_room(&mut self) {
        if self.fingers.len() < MAX_TOUCHES {
            return;
        }
        let victim = self
            .fingers
            .iter()
            .enumerate()
            .filter(|(_, f)| f.up_at.is_some())
            .min_by(|a, b| a.1.up_at.partial_cmp(&b.1.up_at).unwrap())
            .or_else(|| self.fingers.iter().enumerate().min_by_key(|(_, f)| f.seq))
            .map(|(i, _)| i);
        if let Some(i) = victim {
            if self.fingers[i].up_at.is_none() {
                self.ups += 1;
            }
            self.fingers.remove(i);
        }
    }

    fn state(f: &Finger, now: f32, rotation: f32) -> FingerState {
        let still = now - f.moved_at > STILL_AFTER;
        let (vx, vy) = if still { (0.0, 0.0) } else { (f.vx, f.vy) };
        let end = f.up_at.unwrap_or(now);
        // Screen frame of the gate preview: spoke 0 at the bottom, so a
        // physical angle θ sits at (sin θ, -cos θ). Velocity likewise.
        let (s, c) = f.angle.sin_cos();
        FingerState {
            seq: f.seq,
            held: f.up_at.is_none(),
            angle: f.angle - rotation,
            radius: f.radius,
            x: f.radius * s,
            y: -f.radius * c,
            held_for: (end - f.down_at).max(0.0),
            speed: vx.hypot(vy),
            // Physical cartesian (cos θ, sin θ) to screen is a quarter turn.
            dir: (vy.atan2(vx) - std::f32::consts::FRAC_PI_2).rem_euclid(std::f32::consts::TAU),
            hue: f.color.hue,
        }
    }

    /// The evaluator's view at clock `now`, with the composition turned by
    /// `rotation` radians.
    pub fn view(&self, now: f32, rotation: f32) -> TouchView {
        TouchView {
            fingers: self
                .fingers
                .iter()
                .map(|f| Self::state(f, now, rotation))
                .collect(),
            downs: self.downs,
            ups: self.ups,
            last: self.last.as_ref().map(|f| Self::state(f, now, rotation)),
        }
    }

    /// The shader's records (binding 10), composition frame.
    pub fn gpu(&self, now: f32, rotation: f32) -> Vec<GpuTouch> {
        self.fingers
            .iter()
            .map(|f| {
                let still = now - f.moved_at > STILL_AFTER;
                let (vx, vy) = if still { (0.0, 0.0) } else { (f.vx, f.vy) };
                GpuTouch {
                    angle: f.angle - rotation,
                    radius: f.radius,
                    age: (now - f.down_at).max(0.0),
                    released: f.up_at.map_or(-1.0, |t| (now - t).max(0.0)),
                    hue: f.color.hue,
                    saturation: f.color.saturation.clamp(0.0, 1.0),
                    brightness: f.color.brightness.clamp(0.0, 1.0),
                    speed: vx.hypot(vy),
                    // Motion direction in the composition's cartesian frame.
                    dir: vy.atan2(vx) - rotation,
                    _pad: [0.0; 3],
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: u32, phase: TouchPhase, angle: f32, radius: f32) -> TouchInput {
        TouchInput {
            id,
            phase,
            angle,
            radius,
        }
    }

    #[test]
    fn a_tap_inside_one_frame_still_counts_down_and_up() {
        let mut t = Touches::new();
        let c = TouchColor::default();
        t.apply(1, 0.0, input(7, TouchPhase::Down, 1.0, 0.5), c);
        t.apply(1, 0.01, input(7, TouchPhase::Up, 1.0, 0.5), c);
        let v = t.view(0.02, 0.0);
        assert_eq!((v.downs, v.ups), (1, 1));
        assert_eq!(v.held_count(), 0);
        assert_eq!(v.last.unwrap().angle, 1.0);
        // It lingers for the GPU, then goes.
        assert_eq!(t.gpu(1.0, 0.0).len(), 1);
        t.expire(3.0);
        assert!(t.gpu(3.0, 0.0).is_empty());
    }

    #[test]
    fn same_pointer_id_from_two_sources_are_two_fingers() {
        let mut t = Touches::new();
        let c = TouchColor::default();
        t.apply(1, 0.0, input(0, TouchPhase::Down, 0.0, 0.5), c);
        t.apply(2, 0.0, input(0, TouchPhase::Down, 1.0, 0.5), c);
        assert_eq!(t.view(0.0, 0.0).held_count(), 2);
        t.release_source(1, 0.5);
        let v = t.view(0.5, 0.0);
        assert_eq!(v.held_count(), 1);
        assert_eq!(v.ups, 1);
    }

    #[test]
    fn movement_gives_speed_then_settles() {
        let mut t = Touches::new();
        let c = TouchColor::default();
        t.apply(1, 0.0, input(0, TouchPhase::Down, 0.0, 0.2), c);
        for k in 1..=10 {
            t.apply(
                1,
                k as f32 * 0.02,
                input(0, TouchPhase::Move, 0.0, 0.2 + k as f32 * 0.02),
                c,
            );
        }
        let moving = t.view(0.2, 0.0).fingers[0];
        assert!(moving.speed > 0.5, "speed {}", moving.speed);
        let still = t.view(1.0, 0.0).fingers[0];
        assert_eq!(still.speed, 0.0);
        assert!((still.held_for - 1.0).abs() < 1e-5);
    }

    #[test]
    fn rotation_moves_the_composition_not_the_finger() {
        let mut t = Touches::new();
        t.apply(
            1,
            0.0,
            input(0, TouchPhase::Down, 1.0, 0.5),
            TouchColor::default(),
        );
        let v = t.view(0.0, 0.25);
        assert!((v.fingers[0].angle - 0.75).abs() < 1e-6);
        // Screen position is physical: unaffected by rotation.
        let v0 = t.view(0.0, 0.0);
        assert_eq!(v.fingers[0].x, v0.fingers[0].x);
        assert_eq!(t.gpu(0.0, 0.25)[0].angle, 0.75);
    }

    #[test]
    fn capacity_drops_released_before_held() {
        let mut t = Touches::new();
        let c = TouchColor::default();
        t.apply(1, 0.0, input(0, TouchPhase::Down, 0.0, 0.5), c);
        t.apply(1, 0.0, input(0, TouchPhase::Up, 0.0, 0.5), c);
        for id in 1..=MAX_TOUCHES as u32 {
            t.apply(1, 0.1, input(id, TouchPhase::Down, 0.0, 0.5), c);
        }
        let v = t.view(0.2, 0.0);
        assert_eq!(v.fingers.len(), MAX_TOUCHES);
        assert_eq!(v.held_count(), MAX_TOUCHES);
    }
}
