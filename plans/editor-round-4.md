# Patch editor, round 4: clips, fields, sub-patches, undo, admin push (2026-10-16)

Status: **in progress** (gate worktree `C:\Users\camer\.t3\worktrees\Empyrean\playground`,
branch `patch-crate`, kept fast-forwarded to gate `master`; site via CI
web-dist and the site's `dev`, never its `master`). Another agent
("playground-mobile") shares both trees; see the uncommitted `.agents.txt`.

## Goal

Cameron (2026-10-16), on the round-3 report:

1. "clip node sounds best": per-node moving pictures as a **Clip** node, a
   short loop stored inside the patch (like Still image), not a host feed.
2. "do them all!": the remaining node ideas: field math, polar/coordinate
   fields, colour adjust and palette, feedback, sub-patches, editor
   undo/duplicate.
3. "we should add PWA notifications for admins": submissions notify the crew
   through Web Push to an installed PWA, instead of a webhook.

## Environment / context

- See `plans/editor-round-3.md` for the crate layout and the deploy chain.
- Media cells: `abi::MEDIA_CELLS` (1 live video + `MAX_PATCH_IMAGES` = 4)
  of 256² RGBA in the VIDEO buffer (binding 7); `Program.images` lists which
  node owns which cell; hosts decode `NodeInst.media` into the cell.
- Both hosts' mini-preview dispatch writes its own buffer, not OUT, so OUT
  can carry a second half with the previous frame for feedback.
- Site: static prerender + one Worker (`worker/index.ts`, `/api/submit`);
  submissions go to R2 `SUBMISSIONS` (bucket not created yet). No service
  worker or manifest yet.

## Design

### Clip (`clip`, Input, Texture out)
- `media`: a 256² sprite sheet (WebP data URL) of `grid × grid` frames,
  `grid` ∈ {2, 4, 8} (128/64/32 px frames; 4/16/64 frames). Params:
  `fps` (rate, integrated → phase in frames), `mode` loop/ping-pong/scrub,
  `scrub` 0..1, `frames` (how many cells of the sheet are used), `grid`.
- Owns a media cell like Still image (counted against `MAX_PATCH_IMAGES`);
  `clip_at(slot, uv, frame, grid)` samples one frame bilinearly.
- Editor: `ClipPicker` (new file) takes a video (seeks evenly spaced
  frames) or an animated GIF/WebP (`ImageDecoder` where available), builds
  the sheet, sets `frames`/`grid`. The node shows the sheet as its thumbnail.
- Gate: nothing new; `patch::media::decode` already yields 256² RGBA.

### Field nodes (GPU)
- `coordinate` (Generator → FieldScalar): which = radius / angle / x / y /
  spoke / pixel, × scale + offset, optional wrap.
- `field_math` (FieldOp, a, b FieldScalar → FieldScalar): add, subtract,
  multiply, min, max, difference, greater, smoothstep, invert A, power;
  × gain + offset. Scalars wire into a/b through the existing adapter.
- `luminance` (FieldOp, FieldColor → FieldScalar): luminance / max / alpha.
- `color_adjust` (FieldOp, FieldColor → FieldColor): hue shift, saturation,
  brightness, contrast, invert.
- `palette` (FieldOp, FieldScalar → FieldColor): cosine palettes (rainbow,
  fire, ocean, neon, pastel, mono, sunset, forest), cycles, offset,
  brightness; alpha = clamp(in).
- `feedback` (Generator → FieldColor): the previous frame at this pixel
  (after an upstream Transform: at the transformed position, so zoom/rotate
  trails work), × decay. `finish()` keeps frame N-1 in OUT[total + idx]
  before writing idx; hosts allocate OUT twice as large. A read of a
  neighbour that has already been written this frame sees N-1 instead of
  N-2: one frame of jitter, no tearing (u32 writes). Black in previews.

### Sub-patches (format 4)
- `NodeInst.sub: Option<Box<PatchDoc>>` on kind `subpatch`. Its inputs are
  the inner doc's `exposed` entries, port name `"{node}.{param}"`, knob
  values in the node's `params` under the same key; output `out` is what
  the inner Output's `in` receives (unwired: black).
- `flatten::flatten(doc)` inlines sub-patches (ids `"{sub}/{inner}"`, the
  inner root takes the sub-patch's own id so `out` wires and thumbnails
  keep working), rewrites edges and `exposed`, depth ≤ 4, size limits apply
  after. `validate` and `compile` run on the flattened doc; `Runtime`
  evaluates it (`Program.doc`). Migration 3→4 is a no-op (the field is new).
- Editor: a "Sub-patches" palette group (saved patches + presets) inserts a
  copy; the side panel shows the inner exposed knobs; `inputPorts` reads the
  instance for `subpatch`.

### Editor history
- Undo/redo stack in the editor (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y and toolbar
  buttons), slider drags on one knob coalesced; Ctrl+D / "Duplicate"
  duplicates the selected nodes with the wires between them.

### PWA notifications for admins (site)
- `public/manifest.webmanifest` + generated icons, `public/sw.js` (push +
  click), `/admin` page: enter the admin token, enable notifications on this
  device, send a test, disable.
- Worker: `GET /api/notify/key`, `POST|DELETE /api/notify/subscribe`,
  `POST /api/notify/test` (Bearer `ADMIN_TOKEN`); subscriptions stored in
  the SUBMISSIONS bucket under `notify/`; on each submission, Web Push
  (RFC 8291 aes128gcm + RFC 8292 VAPID, WebCrypto, `worker/webpush.ts`) to
  every subscription; gone ones (404/410) are removed.
- Secrets to set (Cameron's yes): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
  (`bun run vapid` prints a pair), `ADMIN_TOKEN`. Until then the endpoints
  answer 503 like Submit.

## Plan / steps

1. **Now.** Crate: coordinate, field_math, luminance, color_adjust, palette,
   feedback, clip (+ WGSL, validate, abi, engine/runtime OUT size). Tests,
   engine-smoke on real Vulkan.
2. Crate + TS: sub-patches (flatten, format 4, wasm, types/files, editor).
3. Editor: undo/redo/duplicate; ClipPicker; thumbnails. Gate behaviour tests.
4. Gate `master` → CI web-dist → site `bun.lock` → `dev` → Preview check.
5. Site: PWA notifications (worker, webpush, admin page, sw, manifest,
   tests, README, staged secrets). Push `dev`; check the Preview.

## Progress log

- [ ] Step 1
- [ ] Step 2
- [ ] Step 3
- [ ] Step 4
- [ ] Step 5

## Open questions for the user

1. The three notification secrets (and the bucket, already pending) need
   your yes; commands are listed under step 5 once written.

## Things not to do

- Never push the website's `master`. Ask before a gate release tag.
- No whole-tree `cargo fmt`; the other agent is in `PatchEditor.tsx` and
  `editor.css` (note hooks in `.agents.txt` before touching them).
