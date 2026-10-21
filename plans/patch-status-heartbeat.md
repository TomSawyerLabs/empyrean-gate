# Patch status — a live heartbeat with details, and "no WebGPU" said out loud

Status: **in progress** (2026-10-21).

## Goal

The editor's toolbar shows a steady green "patch rendering" whenever the
renderer has accepted the patch. On the website's playground, that's always
the case, so it reads like a stuck label. Cameron, 2026-10-21:

> It's a live status? maybe give it a heartbeat? hover gives a modal "all ok"
> with some stats.
>
> No WebGPU should be called out instead of not showing anything. hover/tap
> for more details.

So:

1. **Heartbeat**: the status pulses each time the host confirms new frames
   were rendered. It is driven by real frames, not a CSS loop, so it stops
   when rendering stops. When the beats stop it says so ("stalled").
2. **Details on hover / tap**: a popover reading "All OK", with the host's
   stats (frame rate, frame time, GPU, LEDs, …). For an error it explains the
   error, and for "no WebGPU" it explains why. Hover on a mouse, tap on touch,
   Escape and an outside click close it. No `title=` (Cameron's tooltip rule).
3. **No WebGPU is shown**: where the host can't render at all, the status
   reads "no WebGPU" (amber), and the details give the reason and say what
   still works.

## Environment / context

| What | Where |
| --- | --- |
| Gate repo worktree | `C:\Users\camer\.t3\worktrees\Empyrean\patch-status`, branch `patch-status` → gate `master` |
| Editor | `packages/patch-web/src/editor/PatchEditor.tsx` (`statusLine`, compact `patch-status-chip`), `editor.css` |
| New component | `packages/patch-web/src/editor/PatchStatus.tsx` |
| Browser runtime | `packages/patch-web/src/runtime/index.ts` (`PatchRuntime`: frame loop, `RuntimeStatus`), `gpu.ts` (adapter) |
| Gate app host | `src/Patch.tsx` (passes `status` from the gate's `RuntimeStatus`: `patch_active`, `patch_error`, `engine_fps`, `frame_time_ms`, `gpu_name`) |
| Site host | `empyreangate.org` `app/playground/Playground.tsx` (`runtime.onStatus`, `gpuError`, `.pg-nogpu`), own worktree `.t3/worktrees/empyreangate.org/patch-status` → site `dev` |
| How the site gets the editor | `@empyrean-gate/patch-web` from `github:TomSawyerLabs/empyrean-gate#web-dist`. CI builds `web-dist` from gate master and a bot bumps the site's `bun.lock` on dev. Local testing: `PATCH_WEB_DIR` points the site at a gate checkout. |

The gate engine publishes `Status` at ~2 Hz from the render loop
(`src-tauri/src/engine/mod.rs`, "Status at ~2 Hz"), so on the gate each
status message is a sign the engine is alive.

## Decisions already made (don't re-ask)

- Heartbeat and hover/tap details, as Cameron asked above.
- "No WebGPU" is called out in the status, with details on hover/tap.
- No `title=` anywhere in what this touches. The compact error chip's
  `title=` goes too.

## Design

`status` prop (editor `PatchStatus`, backward compatible with `{active, error}`):

```ts
interface PatchStatus {
  active: boolean;            // a patch is compiled and rendering
  error: string | null;       // why the latest document isn't running
  unavailable?: { label: string; reason: string } | null; // can't render here at all
  beat?: number;              // advances each time the host sees new frames (~1–2 Hz)
  details?: [string, string][]; // label/value rows for the popover
  note?: string;              // one host-specific line under the rows
}
```

- Indicator states, in order: **no WebGPU** (unavailable), **live** (active,
  beating), **stalled** (active, a `beat` host, no beat for 3 s), nothing
  (idle). The red error text is shown next to it as before. While an edit
  can't run, the previous version keeps rendering, so "live" and the error
  can both be true.
- Pulse: the dot is re-keyed on each `beat`, so a one-shot CSS animation plays
  per beat. `prefers-reduced-motion` gets a colour blink in place of the
  scale animation.
- Popover: a disclosure button (`aria-expanded`, `aria-controls`). Pointer
  hover opens it (with a short close delay so the pointer can reach it). A
  click or tap pins it open. Escape or an outside click closes it.
- Compact (phone) mode: the canvas chip shows the same indicator (⚠ when
  there's an error), and a tap opens the same details. It used to open the
  menu.
- Runtime: `PatchRuntime.onStats(listener)`, emitted about once a second
  from the frame loop (so a stalled loop emits nothing):
  `{ frames, fps, cpuMs }`, plus `adapter` (GPU description) from
  `requestGateDevice`.

## Plan / steps

1. **(current)** Editor: `PatchStatus.tsx` + CSS, wire into toolbar, compact
   chip, menu. Demo host shows it. Bun unit test of the stall logic if it's
   separable; a Playwright spec in `tests/` against the mock backend.
2. Runtime: frame stats + adapter description, `onStats`. Unit test.
3. Gate app `src/Patch.tsx`: beat per status message; details: frame rate,
   frame time, GPU, render load.
4. Gate checks: `bun run typecheck`, `bun test` in patch-web, relevant
   Playwright specs. Commit and push gate master (allowed).
5. Site: once web-dist has it (bot bump), `Playground.tsx` passes beat and
   details from `onStats`, plus `unavailable` from `gpuError`. Update
   `tests/playground.spec.ts` ("patch rendering" text). README if it
   mentions the status. Push dev, check the Preview in Chrome.

## Findings / gotchas

- On the gate, `status.active` means *a* patch renders, which may not be
  the one open in the editor (`activeId`). The popover says which.

## Progress log

- [ ] Editor component + wiring
- [ ] Runtime stats
- [ ] Gate app host
- [ ] Gate checks, commit, push
- [ ] Site host + tests, push dev, Preview check

## Open questions for the user

(none yet)

## Things not to do

- Don't run a CSS infinite pulse: a heartbeat that keeps beating while the
  renderer is stuck is a lie.
- Don't use `title=` for the details.
- Don't edit the shared site checkout (`git/Personal Projects/empyreangate.org`)
  for this. Use the site worktree.
