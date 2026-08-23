# Remove the control-deck grid, restore the aspect-adaptive Live layout

## Goal

The Live tab is the performance surface. Since v0.5.0 it has been a
`react-grid-layout` "control deck": widgets on a 12/8/4-column grid, drag to move,
resize from a corner, saved per-device-class in localStorage. In practice that has
been more headache than help — the layout has to be *maintained* rather than just
being right, and the array preview no longer gets the biggest circle the window can
hold.

Go back to the layout that preceded it: **the circle is always as large as the window
allows, and whatever screen area is left over carries the controls**, chosen purely
by viewport aspect ratio in CSS with no JS resize handling.

Difference from the original: the deck era added four controls the old layout never
had a home for — **master** (brightness/speed), **quick settings** (Blackout-style
shortcut buttons), **layers**, and **show status**. All of them stay.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\Empyrean`, branch `master`.
- Frontend: React 19 + Vite, `src/Live.tsx` is the whole Live tab.
- Layout gate: `tests/layout.spec.ts` (Playwright, Chromium) — run with
  `bun run test:layout`. It fails the build if anything overflows horizontally, if
  anything is silently clipped, or if the **live** tab scrolls the document at all.
  Viewport matrix: 1920x1080, 1400x900, 900x600, 900x900, 2560x1080, 1180x820,
  820x1180, 390x844.
- Screenshots: `bun run screenshots` refreshes `docs/live-*.png` from the mock backend.
- Typecheck: `bun run typecheck`. Build: `bun run build`.

## Decisions already made (don't re-ask)

1. **Keep all ten controls**, not just the old five. On genuinely constrained sizes it
   is acceptable for some to be below the fold, or to live behind a popout. (Cameron,
   2026-08-23.)
2. **Delete the deck grid code outright** — `src/controlDecks.ts`, the deck editor UI,
   the deck CSS, and the `react-grid-layout` dependency. Git history keeps Allison's
   work recoverable. (Cameron, 2026-08-23.)
3. Quick settings (`src/quickSettings.ts`, `src/DeckQuickSettings.tsx`) **survive** the
   deletion — they are a real feature, only their *storage* was deck-shaped.
4. `package-lock.json` goes with it: `git log` shows it was created by the deck commit
   `aca9ded`, and this repo standardizes on `bun.lock`.

## Layout design

Three modes, selected by `@media (aspect-ratio: …)` on the viewport — the same
mechanism the pre-deck layout used, so it is correct at first paint with no
resize-observer.

### Wide (aspect > 1.30) — side columns

The canvas wrap is a height-driven square (`height: 100%; aspect-ratio: 1`) that does
not flex, so **the circle is exactly as tall as the main area**. The two side columns
are `flex: 1` and therefore split *all* the remaining width, rather than the old fixed
150px that left several hundred pixels of dead space at 1080p.

Each side is a `repeat(auto-fit, minmax(…))` grid, so it reflows into more sub-columns
as the leftover grows: ~1 column at 900x600, 2 at 1920x1080, 3-4 at 2560x1080. That
takes vertical pressure off the column instead of just making it taller.

- Side A: tools, effects, tempo, master
- Side B: colors, size, quick settings, layers, status

### Squarish (0.78 ≤ aspect ≤ 1.30) — corner floats + a "More" popout

There is by definition almost no leftover width here, so the clusters float in the four
canvas corners the inscribed circle never reaches (`tl` tools, `tr` effects + tempo,
`bl` colors, `br` size). The four remaining controls do not fit in a corner, so they go
behind a **More** toggle that opens a floating panel. This is the popout Cameron
sanctioned for constrained sizes.

### Tall (aspect < 0.78) — stacked

`.live-page` becomes a column: controls above, canvas, controls below, with the sides
turning into wrapping rows. The canvas is `min(remaining height, viewport width)`, so
here — and only here — the circle yields some size to the controls.

### Overflow safety net

`.live-side` gets `overflow-y: auto` + `min-height: 0`. A short window scrolls *the
column*, never the document, so the layout gate's "live must not scroll" rule still
holds and a touch drag on the canvas still draws instead of scrolling the page.

## Plan / steps

All done — see the progress log. The shipped shape differs from the sketch above in one
place: the four secondary clusters are wrapped in a `.live-extras` element that is
`display: contents` wherever there is room and folds into the sheet where there is not,
rather than the sheet duplicating any DOM.

## Findings / gotchas

- **The pre-deck CSS was never deleted.** `.live-page`, `.live-side`, `.corner*`, and
  both aspect-ratio media queries are all still live in `src/styles.css` (around lines
  266-372 and 915-970). The deck commit only *added* rules. So this is a `Live.tsx`
  revert plus CSS tuning, not a CSS rewrite from history.
- The pre-deck `Live.tsx` already **rendered the clusters twice** — once in the side
  columns, once in the corner cards — and let CSS pick. Duplicating the JSX is the
  established pattern here, not a smell.
- `.gate-canvas` sizing was fixed after the deck landed (commit for the 900x900 aux
  window): it is now `height: 100%; width: auto; max-width: 100%` rather than the old
  `width: min(100%, 100vh - 60px)`, which guessed at the chrome height and overflowed.
  Keep the new version.
- Most "deck" hits in `src-tauri/` and `README.md` are **DJ** decks (PRO DJ LINK) and
  are unrelated — do not touch them.
- **The README prose never described the deck.** `59b5315` only refreshed the images;
  the paragraph under Screenshots still described the aspect-adaptive layout, so it
  became true again on its own. Only the sheet needed adding.
- `src/main.tsx` imported `react-grid-layout/css/styles.css` **and**
  `react-resizable/css/styles.css`. The build kept passing after the dependency was
  dropped from `package.json` because `node_modules` still held the package —
  `rm -rf node_modules && bun install` is what actually proved it was gone.
- **Equal-width grid tracks are wrong for the stacked layout.** In portrait the side
  "columns" span the whole window; auto-fit gave the eight-button pen pad the same
  share as a lone Size slider and its labels spilled past their own panel. The layout
  gate did NOT catch it — `.cluster` has visible overflow and nothing crossed the
  viewport edge. Portrait uses `flex-flow: row wrap` so each cluster sizes to content.
- **`container-type` implies layout containment**, which makes the element a containing
  block for absolutely positioned descendants. `.live-side` is an inline-size container
  so the master sliders can restack in a narrow column — but the portrait "All controls"
  sheet is an absolutely positioned descendant of `.live-side.b`, so the portrait media
  query has to set `container-type: normal` or the sheet anchors to the wrong box.
- 900x600 **in show mode** is the tightest wide case: no topbar, so the canvas is the
  full 600 and each column gets 142px. That is what forced the master slider restack —
  a 90px label plus a "1.00×" readout plus a usable slider does not fit on one line.

## Things not to do

- Don't remove the squarish/tall media queries "because the grid handled it" — they are
  the whole mechanism.
- Don't let `.live-side` scroll the *document*; the layout gate treats a scrollbar on
  Live as a build failure, and it is a real bug on a touch surface.
- Don't touch `quickSettings.ts`'s target table or `DeckQuickSettings.tsx`'s behaviour;
  only its persistence moves.

## Progress log

- [x] Surveyed the deck feature, its commits, and what the pre-deck layout looked like.
- [x] Quick-setting shortcuts moved to `empyrean-live-quick-settings-v1`, with a
      one-way migration out of the old deck blob.
- [x] `src/DeckQuickSettings.tsx` → `src/LiveQuickSettings.tsx`, plus an explicit edit
      mode. The deck's only route into the shortcut editor was the widget drag handle,
      and the modal's "long-press any quick button" hint was never implemented (a
      "hold" shortcut already owns the long press). A press in edit mode opens the
      editor for that shortcut; the hint now says so.
- [x] `src/Live.tsx` rewritten: nine clusters, three CSS-chosen modes, `.live-extras`
      for the four that fold away.
- [x] `src/styles.css`: flexible columns, square canvas wrap, the sheet, the container
      query for narrow master sliders; ~460 lines of deck CSS deleted.
- [x] `src/controlDecks.ts`, `package-lock.json`, `react-grid-layout` and the two CSS
      imports in `src/main.tsx` all gone; `bun.lock` refreshed from a clean install.
- [x] `bun run typecheck` clean. `bun run test:layout`: 47 passed, 1 skipped (phone
      show mode, skipped by the suite itself).
- [x] `tests/quick-settings.spec.ts` covers edit mode and the migration;
      `bun run test:behavior` runs it and `checks.yml` now calls it after the gate.
- [x] `docs/live-{wide,square,tall,show-1080p}.png` refreshed; README paragraph extended
      to describe the sheet and the reflowing columns.
- [x] Committed.
- [x] Cut **v0.6.0** — `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
      `src-tauri/tauri.conf.json`, commit `2e80784` titled `v0.6.0` per this repo's
      convention, annotated tag `v0.6.0` on it. `release.yml` also picked up the UI
      behaviour tests so a release does not clear a lower bar than a push.
- [ ] **Not done, and deliberately Cameron's step:** pushing. `git push origin master`
      then `git push origin v0.6.0` — the tag push is what triggers `release.yml`,
      which builds the standalone binaries and creates the GitHub Release
      (`gh release create --verify-tag`, so the tag must be on the remote).

## Result

At 1920x1080 the circle is the full 1080 tall and each column gets ~440px, reflowing
into two sub-columns. At 820x1180 portrait the circle is ~790 wide (it was ~415 when
all nine clusters were inline, which is what forced the `.live-extras` split). Squarish
windows keep the corner floats and gain the sheet.
