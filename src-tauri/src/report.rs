//! Operator feedback bundles: "I don't like what the array just did".
//!
//! A visual complaint is worthless a minute later — the pattern that caused it is
//! gone, the sliders have moved on, and nobody can say what the audio was doing.
//! So the backend continuously keeps the last ~20 seconds of everything that
//! shapes a frame in a bounded ring buffer, and the Report button freezes a slice
//! of it to disk together with the operator's description.
//!
//! What lands in `<config dir>/EmpyreanGate/reports/<id>/`:
//!
//! - `report.json`   — description, config, timeline of operator input, 10 Hz
//!                     snapshots of effective layer params + audio features
//! - `frames.bin`    — the decimated frames that were actually on the wire
//! - `contact-sheet.png` — those frames rendered as a grid, so a human (or an
//!                     agent that can only read images) can *see* the complaint
//! - `info.json`     — small summary, so listing reports doesn't parse everything
//!
//! The bundle is self-describing on purpose: it gets handed to an agent that has
//! no other context. See `docs/report-bundle.md`.

use crate::config::AppConfig;
use crate::layers::LayerCfg;
use crate::state::SharedState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// How much history the rolling buffers keep. The UI offers up to 20 s; the
/// buffers hold a little more than the longest request so a slow click still
/// captures the full window.
pub const WINDOW_SECS: f32 = 22.0;
/// Snapshot/frame sample rate. 10 Hz is fast enough to see a pattern move and
/// slow enough that 20 seconds of frames stay under a couple of megabytes.
const SAMPLE_HZ: f32 = 10.0;
/// Keep every Nth pixel along each spoke in stored frames (350 px -> 44).
const FRAME_DECIMATE: u32 = 8;
/// Reports kept on disk; oldest are pruned. A show machine should never fill its
/// disk because someone had a lot of opinions.
const MAX_REPORTS: usize = 40;
/// Cells in the contact sheet, and the size each frame is rendered at.
const SHEET_COLS: usize = 4;
const SHEET_ROWS: usize = 3;
const CELL: usize = 256;

// ---------------------------------------------------------------------------
// Rolling capture
// ---------------------------------------------------------------------------

/// One operator action. `detail` is deliberately free-form JSON: the consumer is
/// an agent reading prose-ish data, not a parser we have to keep in step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEvent {
    /// Seconds since the recorder started (same clock as `Snapshot::t`).
    pub t: f32,
    /// "effect", "paint", "config", "master", "layer", "sacn", "video".
    pub kind: String,
    /// Friendly name of the device that did it, when known.
    pub client: String,
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AudioSnapshot {
    pub id: String,
    pub active: bool,
    pub level: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub onset: f32,
    pub bpm: f32,
    pub bpm_confidence: f32,
    pub beat_phase: f32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ControlSnapshot {
    pub yaw: f32,
    pub pitch: f32,
    pub roll: f32,
    pub shake: f32,
}

/// The engine's actual inputs for one frame — post-autopilot, post-walk-envelope,
/// which is the whole point: the config on disk is not what was rendered.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub t: f32,
    pub fps: f32,
    pub master_brightness: f32,
    pub master_speed: f32,
    pub effects_active: usize,
    pub dabs_active: usize,
    /// Phone tilt/shake control bus, which steers some layers.
    pub control: ControlSnapshot,
    pub audio: Vec<AudioSnapshot>,
    /// Effective layer parameters as handed to the GPU this frame.
    pub layers: Vec<LayerCfg>,
}

struct FrameSample {
    t: f32,
    spokes: u32,
    pixels: u32,
    rgb: Vec<u8>,
}

/// Bounded, always-on capture of everything that shaped recent frames.
pub struct Recorder {
    started: Instant,
    events: Mutex<VecDeque<TimelineEvent>>,
    snapshots: Mutex<VecDeque<Snapshot>>,
    frames: Mutex<VecDeque<FrameSample>>,
    next_sample: Mutex<Instant>,
}

impl Default for Recorder {
    fn default() -> Self {
        Self::new()
    }
}

impl Recorder {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            events: Mutex::new(VecDeque::new()),
            snapshots: Mutex::new(VecDeque::new()),
            frames: Mutex::new(VecDeque::new()),
            next_sample: Mutex::new(Instant::now()),
        }
    }

    fn now(&self) -> f32 {
        self.started.elapsed().as_secs_f32()
    }

    /// Record an operator action. Cheap enough to call from the WS handler on
    /// every mutating message.
    pub fn event(&self, kind: &str, client: &str, detail: serde_json::Value) {
        let t = self.now();
        let mut events = self.events.lock();
        events.push_back(TimelineEvent {
            t,
            kind: kind.to_owned(),
            client: client.to_owned(),
            detail,
        });
        trim(&mut events, t, |e| e.t);
    }

    /// Drawing arrives ~30 times a second per finger and would otherwise bury
    /// every other action in the timeline. Consecutive strokes with the same pen
    /// from the same device fold into one entry per `FOLD_GAP`, keeping running
    /// totals so nothing is silently lost.
    pub fn paint_event(&self, client: &str, pen: &str, points: u64, hue: f32, size: f32) {
        const FOLD_GAP: f32 = 0.25;
        let t = self.now();
        let mut events = self.events.lock();
        if let Some(last) = events.back_mut()
            && last.kind == "paint"
            && last.client == client
            && last.detail["pen"] == pen
            && t - last.t < FOLD_GAP
        {
            let add = |v: &mut serde_json::Value, key: &str, n: u64| {
                let total = v[key].as_u64().unwrap_or(0) + n;
                v[key] = total.into();
            };
            add(&mut last.detail, "messages", 1);
            add(&mut last.detail, "points", points);
            return;
        }
        events.push_back(TimelineEvent {
            t,
            kind: "paint".into(),
            client: client.to_owned(),
            detail: serde_json::json!({
                "pen": pen,
                "messages": 1,
                "points": points,
                "hue": hue,
                "size": size,
            }),
        });
        trim(&mut events, t, |e| e.t);
    }

    /// True at most `SAMPLE_HZ` times a second. Called once per rendered frame;
    /// the engine only does the work of gathering a snapshot when this says yes.
    pub fn sample_due(&self) -> bool {
        let now = Instant::now();
        let mut next = self.next_sample.lock();
        if now < *next {
            return false;
        }
        let interval = std::time::Duration::from_secs_f32(1.0 / SAMPLE_HZ);
        // Accumulator, floored to now, so a stalled engine doesn't burst-catch-up.
        *next = (*next + interval).max(now);
        true
    }

    /// Store a snapshot plus the frame that went with it. `rgb` is the full
    /// frame; it is decimated here. The caller does not fill in `Snapshot::t` —
    /// one clock, owned here, keeps snapshots and events comparable.
    pub fn record(&self, mut snapshot: Snapshot, rgb: &[u8], spokes: u32, pixels: u32) {
        let t = self.now();
        snapshot.t = t;
        {
            let mut snapshots = self.snapshots.lock();
            snapshots.push_back(snapshot);
            trim(&mut snapshots, t, |s| s.t);
        }
        let kept = decimated_pixels(pixels);
        let mut small = Vec::with_capacity((spokes * kept * 3) as usize);
        for s in 0..spokes {
            for i in (0..pixels).step_by(FRAME_DECIMATE as usize) {
                let o = ((s * pixels + i) * 3) as usize;
                match rgb.get(o..o + 3) {
                    Some(px) => small.extend_from_slice(px),
                    None => small.extend_from_slice(&[0, 0, 0]),
                }
            }
        }
        let mut frames = self.frames.lock();
        frames.push_back(FrameSample {
            t,
            spokes,
            pixels: kept,
            rgb: small,
        });
        trim(&mut frames, t, |f| f.t);
    }
}

fn decimated_pixels(pixels: u32) -> u32 {
    pixels.div_ceil(FRAME_DECIMATE)
}

fn trim<T>(buf: &mut VecDeque<T>, now: f32, time_of: impl Fn(&T) -> f32) {
    while let Some(front) = buf.front() {
        if now - time_of(front) > WINDOW_SECS {
            buf.pop_front();
        } else {
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Bundle writing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportInfo {
    pub id: String,
    /// UTC, "YYYY-MM-DDTHH:MM:SSZ".
    pub created: String,
    pub created_unix_ms: u64,
    pub description: String,
    pub reported_by: String,
    pub window_seconds: f32,
    pub frames: usize,
    pub app_version: String,
    /// Absolute path of the bundle directory on the Gate machine.
    pub path: String,
}

#[derive(Serialize)]
struct FramesMeta {
    file: String,
    count: usize,
    hz: f32,
    spokes: u32,
    pixels_per_spoke: u32,
    decimate: u32,
    layout: &'static str,
}

#[derive(Serialize)]
struct Bundle<'a> {
    schema: &'static str,
    docs: &'static str,
    #[serde(flatten)]
    info: &'a ReportInfo,
    frames: FramesMeta,
    contact_sheet: &'static str,
    timeline: Vec<TimelineEvent>,
    snapshots: Vec<Snapshot>,
    status: crate::protocol::RuntimeStatus,
    config: &'a AppConfig,
}

pub fn reports_dir() -> PathBuf {
    crate::config::config_path()
        .parent()
        .map(|p| p.join("reports"))
        .unwrap_or_else(|| PathBuf::from("reports"))
}

/// Refuse anything path-like; ids are generated by us and used in URLs.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Freeze the last `seconds` of capture into a bundle on disk.
pub fn write_bundle(
    state: &SharedState,
    description: &str,
    seconds: f32,
    reported_by: &str,
) -> anyhow::Result<ReportInfo> {
    let recorder = &state.recorder;
    let seconds = seconds.clamp(1.0, WINDOW_SECS);
    let now = recorder.now();
    let cutoff = now - seconds;

    let timeline: Vec<TimelineEvent> = recorder
        .events
        .lock()
        .iter()
        .filter(|e| e.t >= cutoff)
        .cloned()
        .collect();
    let snapshots: Vec<Snapshot> = recorder
        .snapshots
        .lock()
        .iter()
        .filter(|s| s.t >= cutoff)
        .cloned()
        .collect();
    let (frames, spokes, pixels): (Vec<Vec<u8>>, u32, u32) = {
        let buf = recorder.frames.lock();
        let recent: Vec<&FrameSample> = buf.iter().filter(|f| f.t >= cutoff).collect();
        // Geometry can change mid-window (someone edits Settings); the newest
        // frame's shape wins and mismatched older frames are dropped rather than
        // written with a lying header.
        let (spokes, pixels) = recent
            .last()
            .map(|f| (f.spokes, f.pixels))
            .unwrap_or((0, 0));
        let kept = recent
            .into_iter()
            .filter(|f| f.spokes == spokes && f.pixels == pixels)
            .map(|f| f.rgb.clone())
            .collect();
        (kept, spokes, pixels)
    };

    let created_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let id = format!(
        "{}-{}",
        id_stamp(created_unix_ms / 1000),
        &uuid::Uuid::new_v4().to_string()[..6]
    );
    let dir = reports_dir().join(&id);
    std::fs::create_dir_all(&dir)?;

    let info = ReportInfo {
        id: id.clone(),
        created: utc_stamp(created_unix_ms / 1000),
        created_unix_ms,
        description: description.chars().take(8000).collect(),
        reported_by: reported_by.chars().take(120).collect(),
        window_seconds: seconds,
        frames: frames.len(),
        app_version: crate::updater::CURRENT_VERSION.to_string(),
        path: dir.to_string_lossy().into_owned(),
    };

    let mut frame_bytes = Vec::with_capacity(frames.iter().map(|f| f.len()).sum());
    for f in &frames {
        frame_bytes.extend_from_slice(f);
    }
    std::fs::write(dir.join("frames.bin"), &frame_bytes)?;

    let config = state.config.read().clone();
    let bundle = Bundle {
        schema: "empyrean-gate/report/1",
        docs: "docs/report-bundle.md in the empyrean-gate repository",
        info: &info,
        frames: FramesMeta {
            file: "frames.bin".into(),
            count: frames.len(),
            hz: SAMPLE_HZ,
            spokes,
            pixels_per_spoke: pixels,
            decimate: FRAME_DECIMATE,
            layout: "rgb8, spoke-major; within a spoke pixel 0 is the OUTER end \
                     of the array. Frames are concatenated oldest first.",
        },
        contact_sheet: "contact-sheet.png",
        timeline,
        snapshots,
        status: state.status.lock().clone(),
        config: &config,
    };
    std::fs::write(
        dir.join("report.json"),
        serde_json::to_vec_pretty(&bundle)?,
    )?;
    std::fs::write(dir.join("info.json"), serde_json::to_vec_pretty(&info)?)?;

    if spokes > 0 && pixels > 0 && !frames.is_empty() {
        let inner = config.geometry.inner_radius_ft / config.geometry.outer_radius_ft.max(0.001);
        let sheet = contact_sheet(&frames, spokes as usize, pixels as usize, inner);
        write_png(&dir.join("contact-sheet.png"), &sheet, (SHEET_COLS * CELL) as u32)?;
    }

    prune();
    log::info!("wrote feedback report to {}", dir.display());
    Ok(info)
}

/// Newest first.
pub fn list() -> Vec<ReportInfo> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(reports_dir()) else {
        return out;
    };
    for entry in entries.flatten() {
        let info = entry.path().join("info.json");
        if let Ok(text) = std::fs::read_to_string(&info)
            && let Ok(parsed) = serde_json::from_str::<ReportInfo>(&text)
        {
            out.push(parsed);
        }
    }
    out.sort_by(|a, b| b.created_unix_ms.cmp(&a.created_unix_ms));
    out
}

fn prune() {
    let mut dirs: Vec<PathBuf> = match std::fs::read_dir(reports_dir()) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect(),
        Err(_) => return,
    };
    if dirs.len() <= MAX_REPORTS {
        return;
    }
    // Ids start with a UTC timestamp, so lexicographic order is chronological.
    dirs.sort();
    for old in &dirs[..dirs.len() - MAX_REPORTS] {
        if let Err(e) = std::fs::remove_dir_all(old) {
            log::warn!("could not prune old report {}: {e}", old.display());
        }
    }
}

// ---------------------------------------------------------------------------
// Contact sheet
// ---------------------------------------------------------------------------

/// Render up to SHEET_COLS*SHEET_ROWS evenly-spaced frames into one RGB image.
/// The array is drawn the way the operator sees it: spoke 0 at the top, pixel 0
/// at the outer rim.
fn contact_sheet(frames: &[Vec<u8>], spokes: usize, pixels: usize, inner: f32) -> Vec<u8> {
    let width = SHEET_COLS * CELL;
    let height = SHEET_ROWS * CELL;
    let mut img = vec![0u8; width * height * 3];
    let cells = SHEET_COLS * SHEET_ROWS;
    let n = frames.len().min(cells);
    for cell in 0..n {
        // Evenly spaced across the captured window, always including the last
        // frame — the complaint is usually about what it just did.
        let idx = if n == 1 {
            frames.len() - 1
        } else {
            (cell * (frames.len() - 1)) / (n - 1)
        };
        let ox = (cell % SHEET_COLS) * CELL;
        let oy = (cell / SHEET_COLS) * CELL;
        draw_frame(&mut img, width, ox, oy, &frames[idx], spokes, pixels, inner);
    }
    img
}

#[allow(clippy::too_many_arguments)]
fn draw_frame(
    img: &mut [u8],
    img_width: usize,
    ox: usize,
    oy: usize,
    rgb: &[u8],
    spokes: usize,
    pixels: usize,
    inner: f32,
) {
    let center = CELL as f32 / 2.0;
    let scale = center * 0.95;
    for s in 0..spokes {
        let theta = (s as f32 / spokes as f32) * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
        let (sin, cos) = theta.sin_cos();
        for i in 0..pixels {
            let o = (s * pixels + i) * 3;
            let Some(px) = rgb.get(o..o + 3) else { continue };
            if px == [0, 0, 0] {
                continue;
            }
            let t = if pixels > 1 {
                i as f32 / (pixels - 1) as f32
            } else {
                0.0
            };
            // pixel 0 is the outer end
            let r = (inner + (1.0 - t) * (1.0 - inner)) * scale;
            let cx = center + r * cos;
            let cy = center - r * sin;
            // A 2x2 splat: adjacent samples along a spoke must touch or the ring
            // reads as dotted instead of continuous.
            for dy in 0..2 {
                for dx in 0..2 {
                    let x = cx as isize + dx;
                    let y = cy as isize + dy;
                    if x < 0 || y < 0 || x >= CELL as isize || y >= CELL as isize {
                        continue;
                    }
                    let dst = ((oy + y as usize) * img_width + ox + x as usize) * 3;
                    for c in 0..3 {
                        img[dst + c] = img[dst + c].saturating_add(px[c]);
                    }
                }
            }
        }
    }
}

fn write_png(path: &std::path::Path, rgb: &[u8], width: u32) -> anyhow::Result<()> {
    let height = (rgb.len() / 3) as u32 / width;
    let file = std::fs::File::create(path)?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(rgb)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Timestamps (no date crate in the dependency tree, and one isn't worth it)
// ---------------------------------------------------------------------------

/// Days since the Unix epoch -> (year, month, day). Howard Hinnant's civil_from_days.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn parts(unix_secs: u64) -> (i64, u32, u32, u64, u64, u64) {
    let days = (unix_secs / 86_400) as i64;
    let rem = unix_secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    (y, m, d, rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn utc_stamp(unix_secs: u64) -> String {
    let (y, mo, d, h, mi, s) = parts(unix_secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Filesystem-safe and lexicographically chronological.
fn id_stamp(unix_secs: u64) -> String {
    let (y, mo, d, h, mi, s) = parts(unix_secs);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_match_known_instants() {
        assert_eq!(utc_stamp(0), "1970-01-01T00:00:00Z");
        // 2026-08-22T19:04:11Z
        assert_eq!(utc_stamp(1_787_425_451), "2026-08-22T19:04:11Z");
        assert_eq!(id_stamp(1_787_425_451), "20260822-190411");
        // Leap day, and the century rule that trips naive implementations.
        assert_eq!(utc_stamp(1_709_164_800), "2024-02-29T00:00:00Z");
        assert_eq!(utc_stamp(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn report_ids_sort_chronologically() {
        let mut ids = [id_stamp(1_787_425_451), id_stamp(0), id_stamp(1_709_164_800)];
        ids.sort();
        assert_eq!(ids[0], id_stamp(0));
        assert_eq!(ids[2], id_stamp(1_787_425_451));
    }

    #[test]
    fn rolling_buffers_stay_bounded() {
        let rec = Recorder::new();
        for _ in 0..1000 {
            rec.event("effect", "test", serde_json::json!({"kind": "burst"}));
        }
        // Nothing ages out within a single fast loop, but the trim must not panic
        // and every entry must carry a sane timestamp.
        let events = rec.events.lock();
        assert_eq!(events.len(), 1000);
        assert!(events.iter().all(|e| e.t >= 0.0));
    }

    #[test]
    fn stored_frames_are_decimated_and_shaped() {
        let rec = Recorder::new();
        let (spokes, pixels) = (4u32, 16u32);
        let rgb = vec![7u8; (spokes * pixels * 3) as usize];
        let snapshot = Snapshot {
            t: 0.0,
            fps: 60.0,
            master_brightness: 1.0,
            master_speed: 1.0,
            effects_active: 0,
            dabs_active: 0,
            control: ControlSnapshot::default(),
            audio: Vec::new(),
            layers: Vec::new(),
        };
        rec.record(snapshot, &rgb, spokes, pixels);
        let frames = rec.frames.lock();
        let f = frames.front().expect("one frame");
        assert_eq!(f.pixels, 2, "16 px decimated by 8");
        assert_eq!(f.rgb.len(), (spokes * 2 * 3) as usize);
        assert!(f.rgb.iter().all(|b| *b == 7));
    }

    #[test]
    fn ids_used_in_urls_reject_traversal() {
        assert!(valid_id("20260822-190411-a1b2c3"));
        assert!(!valid_id("../config.json"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
    }
}
