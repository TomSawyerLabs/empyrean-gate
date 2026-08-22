# Feedback report bundles

A **report** is what the operator produces by hitting **⚑ Report** in the app
when the array does something they don't like. It pairs a typed description with
the last 5–20 seconds of everything that shaped the frames — so the complaint can
be investigated after the fact, by a person or by an agent, without anyone having
been present.

Bundles are written on the Gate machine to:

```
<config dir>/EmpyreanGate/reports/<id>/
```

`<id>` is `YYYYMMDD-HHMMSS-xxxxxx` (UTC, so ids sort chronologically). The 40
newest bundles are kept; older ones are pruned automatically.

Every file is also downloadable from any client over HTTP:

- `GET /reports` — JSON array of `info.json` summaries, newest first
- `GET /reports/<id>/<file>` — one file (`report.json`, `info.json`,
  `frames.bin`, `contact-sheet.png`)

## Files

| File | What it is |
| --- | --- |
| `report.json` | Everything: description, timeline, snapshots, full config, runtime status, frame metadata |
| `info.json` | Just the summary fields, so listing reports is cheap |
| `frames.bin` | The frames that were on the wire, decimated. Raw RGB8, no header |
| `contact-sheet.png` | Up to 12 of those frames rendered as a 4×3 grid — look at this first |

## Reading it

Start with `contact-sheet.png`. It renders the array the way the operator sees
it: spoke 0 at the top, going clockwise, pixel 0 at the **outer** rim. Cells run
left to right, top to bottom, evenly spaced across the captured window, ending on
the last frame captured.

Then `report.json`:

```jsonc
{
  "schema": "empyrean-gate/report/1",
  "description": "the fire layer strobes hard on every kick",
  "window_seconds": 10.0,
  "reported_by": "FOH iPad",
  "created": "2026-08-22T19:04:11Z",
  "app_version": "0.4.0",

  "timeline":  [ /* discrete operator actions */ ],
  "snapshots": [ /* 10 Hz state samples */ ],
  "frames":    { /* how to read frames.bin */ },
  "config":    { /* the whole AppConfig at capture time */ },
  "status":    { /* RuntimeStatus at capture time */ }
}
```

`timeline` holds **discrete actions** — an effect trigger, a slider move, a layer
edit, a video start. Each has `t` (seconds on the recorder's clock), `kind`,
`client` (which device did it) and a free-form `detail`. Drawing is folded to at
most four entries a second with running `messages`/`points` totals, so a stroke
doesn't bury everything else.

`snapshots` holds **continuous state**, sampled 10 times a second: `fps`, master
brightness/speed, live effect/dab counts, the phone control bus, per-source audio
features (level, bands, onset, BPM + confidence, beat phase), and — the important
part — `layers`, the layer parameters **as actually rendered**. Autopilot and the
gray-code layer walk mean the config on disk is routinely *not* what was on
screen; these are the post-walk, post-envelope values handed to the GPU.

Both share one clock, so a timeline entry at `t = 12.4` lines up with the
snapshot at `t = 12.4`.

## frames.bin

Concatenated frames, oldest first, no header or separators. Shape comes from
`report.json`'s `frames` object:

```jsonc
"frames": {
  "count": 100,             // frames in the file
  "hz": 10.0,               // sample rate
  "spokes": 64,
  "pixels_per_spoke": 44,   // AFTER decimation
  "decimate": 8,            // every 8th pixel of the real array was kept
  "layout": "rgb8, spoke-major; within a spoke pixel 0 is the OUTER end..."
}
```

So frame `n`, spoke `s`, pixel `i`, channel `c` is at byte:

```
n * spokes * pixels_per_spoke * 3  +  (s * pixels_per_spoke + i) * 3  +  c
```

Values are the engine's perceptual RGB — the same numbers that went to the sACN
sender, before any LED gamma.

## Caveats worth knowing

- **One frame of skew.** GPU readback runs a frame behind the dispatch, so the
  pixels stored with a snapshot trail its layer parameters by ~16 ms. Far below
  the 100 ms sampling period, but don't chase sub-frame timing here.
- **Geometry changes mid-window.** If someone edited spoke/pixel counts during
  the captured window, frames with the old shape are dropped rather than written
  under a header that would misdescribe them.
- **The window is bounded.** The backend keeps ~22 seconds; asking for more than
  that silently gets you what exists.
- **No audio is recorded**, only the extracted features. There is no microphone
  capture in a bundle.

## Handing one to an agent

The whole directory is self-contained — copy it anywhere. A useful prompt shape:

> Here is a feedback bundle from the Empyrean Gate light rig:
> `<path>`. Read `report.json` and look at `contact-sheet.png`. The operator's
> complaint is in `description`. Work out which layer or effect is responsible
> using `snapshots[].layers` (these are the effective, post-autopilot values) and
> propose a fix in the shader or in the layer defaults.
