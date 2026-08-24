# Quick layer edits without a tab switch

## Goal

Adjusting a layer mid-show meant leaving the Live tab. The Live layer cluster
only toggles a layer on and off, Control only has an opacity fader, and
everything else — speed, scale, hue, the kind's own parameters — lives in the
Settings tab's `LayerEditor`. Give those parameters a **long-press / right-click
popover** on the surfaces where the layers are already listed, so an operator
never has to leave the array to change one.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\Empyrean`, branch `master`.
- Where layers appear today:
  - `src/Live.tsx` → `.cluster.live-layer-list`, one button per layer, click
    toggles `enabled`.
  - `src/Control.tsx` → `LayerFader`, checkbox + name + opacity slider.
  - `src/Settings.tsx` → `LayerEditor`, the full set: kind, blend, audio source,
    ten named sliders and Param A–D, plus reorder and delete.
- `src/types.ts` has `PARAM_LABELS`, which names Param A–D per layer kind
  ("Arms", "Twist", "Sharpness" for Spiral, and so on). The popover uses it, so
  the four generic params read as what they actually are.
- `src/touch.ts` already suppresses `contextmenu` app-wide except in text fields
  (a resting finger on the show surface used to raise the Windows/iPadOS callout
  mid-stroke). `preventDefault` there does not stop propagation, so an element's
  own `onContextMenu` still runs — which is what makes right-click available.
- Editing convention to copy from `LayerEditor`: a local mirror of the layer so
  sliders feel instant, plus `useThrottled(l => client.updateLayer(index, l))`.

## Decisions already made (don't re-ask)

- **Popover anchored to the layer, not a full-screen modal.** The Live tab's
  entire design is "the array stays the largest thing"; a modal over it to nudge
  a hue would defeat that. Narrow windows (≤ 700px) get a bottom sheet instead,
  because there is no room to anchor anything.
- **Both gestures, on both surfaces.** Long-press (~450 ms) for touch, right-click
  for a mouse. Live and Control both, from one shared hook and one shared popover.
- **A long press must not also toggle the layer.** The hook owns the click
  handler and swallows the one that follows a fired press, rather than relying on
  `stopPropagation` from a capture handler.
- **No delete or reorder in the popover.** Those are destructive/structural and
  belong in the full editor, which the popover links to. Quick edit means
  parameters.
- **Grouped, not a flat list of fourteen sliders.** Mix / Motion / Colour / Audio
  / Pattern, in that order — Pattern last because it is the group whose contents
  change with the layer kind.
- **No `title=` tooltips anywhere** (global rule): the popover is the on-demand
  detail, and the discoverability hint is an inline line of text under the list.

## Plan / steps

1. `src/longPress.ts` — `useHoldMenu`, returning props to spread on a control.
2. `src/LayerQuickEdit.tsx` — the popover: local mirror, throttled updates,
   viewport clamping, Escape/backdrop dismiss.
3. Wire `Live.tsx`'s layer cluster and `Control.tsx`'s `LayerFader`.
4. CSS: popover, bottom sheet, slider grid.
5. Checks: typecheck, Playwright (add coverage for the gesture), screenshots.

## Findings / gotchas

- **The mock backend does not echo `update_layer`.** `scripts/mock-backend.ts`
  only answers `hello` / `get_state` / `subscribe_preview`, so a layer's config
  never changes in a Playwright run and no assertion about a chip's `active`
  class can ever pass. What the UI *did* is only observable on the wire, so the
  spec records every text frame the client sends — and the `page.on("websocket")`
  listener has to be attached **before** `page.goto`, or the socket already
  exists and nothing is captured.
- **`.field-row` becomes a column below 700px** (a deliberate Settings-page
  treatment). In the phone sheet that stacked three selects and cost ~120px of a
  pane that is already most of the window; the sheet overrides it back to a row.
- The backdrop is transparent rather than a scrim. Dimming the array while
  someone drags a slider to judge its effect on the array defeats the feature.
  The phone sheet does dim, because it covers most of the window anyway.
- Live's layer cluster is now a wrapper (`.live-layer-list-wrap`) around the grid
  plus the discoverability hint, so the `grid-row: span 2` that sized the cluster
  in the side columns had to move to the wrapper. The `height: 100%` and
  `grid-auto-rows` rules already selected `.live-side .live-layer-list`, which is
  the inner grid now — leave them pointing there, and do **not** re-declare them
  at higher specificity later in the file, or they will beat the portrait-mode
  `height: auto` override.

## Progress log

- [x] `src/longPress.ts` — `useHoldMenu` (450 ms, 10px slop, right-click, and it
      owns the click so a fired hold does not also toggle).
- [x] `src/LayerQuickEdit.tsx` — anchored popover / phone sheet, local mirror +
      throttled `update_layer`, measured viewport clamping, Escape and backdrop
      dismiss, "Full editor →" to Settings.
- [x] Live: layer chips hold-to-edit, tap still toggles, hint line under the list.
- [x] Control: the layer name is the handle and opens on a plain tap; right-click
      works anywhere on the row, including the fader.
- [x] CSS: popover, sheet, group grid, `.layer-fader-name`.
- [x] `tests/layer-quick-edit.spec.ts` — 8 cases: hold opens without toggling,
      tap still toggles, right-click + Escape, a slider reaches the wire as
      `"scale":2.5`, named params appear and generic ones never do, the card
      stays inside the window, a phone gets the sheet, Control opens on a tap.
- [x] `bun run typecheck`, full `playwright test` (108 pass), `docs/*.png`
      regenerated, README updated.

## Things not to do

- Don't reach for `git apply --unidiff-zero` to stage around the peer session's
  edits. It did exactly what its manual warns about on the previous commit: a
  zero-context hunk replacing `_pad0`/`_pad1` matched the *`Dab`* struct instead
  of `Effect`, which silently desynced the WGSL layout from `GpuEffect`. Stage
  with context, and verify the committed file, not just the diff.
- Don't put the hold gesture on a row that contains a slider. A careful nudge
  can sit inside the 10px slop for longer than 450 ms, and a popover opening
  mid-drag is worse than a gesture nobody finds. Right-click on the row is fine;
  the hold belongs on the label.
- Don't add reorder or delete to the popover. It is reached by a gesture that can
  fire while an operator is aiming at something else — destructive controls do
  not belong behind it.
- Don't use a `title=` attribute for the discoverability hint (or anything else):
  it is invisible on the touch screen this is mostly driven from.
