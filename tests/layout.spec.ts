// The layout gate.
//
// CSS has no compile-time notion of "this doesn't fit", and the failure mode is
// nasty on a show surface: a control slides a few pixels past the edge, the whole
// app grows a scrollbar, and now a touch drag scrolls the page instead of drawing.
// This is the closest thing to a compile error we can get — it fails the build.
//
// Two rules, checked on every tab at every viewport in the matrix:
//
//   1. Nothing extends horizontally past the viewport, ever. Not the document,
//      not any individual element.
//   2. Nothing is silently clipped: a box that hides its overflow must be big
//      enough for what is inside it.
//
// Vertical scrolling is NOT a failure by itself — Settings is an explicitly
// scrolling surface, and so is Live below the 700px mobile breakpoint. See
// MUST_FIT_VERTICALLY.
//
// Anything deliberately parked offscreen must say so with `data-layout-exempt`.

import { expect, test } from "@playwright/test";

/**
 * Viewports that matter, not a survey. Each one is a real deployment.
 *
 * `mobile` marks the app's own <=700px breakpoint, where Live deliberately
 * becomes a scrolling column (canvas on top, control cards stacked below) and
 * the topbar sheds everything but the tabs and Report. There, vertical scrolling
 * is the design, so only the horizontal rule applies.
 */
const VIEWPORTS = [
  { name: "show-display-1080p", width: 1920, height: 1080, mobile: false },
  { name: "desktop-default", width: 1400, height: 900, mobile: false },
  { name: "window-minimum", width: 900, height: 600, mobile: false },
  { name: "aux-window-square", width: 900, height: 900, mobile: false },
  { name: "ultrawide", width: 2560, height: 1080, mobile: false },
  { name: "ipad-landscape", width: 1180, height: 820, mobile: false },
  { name: "ipad-portrait", width: 820, height: 1180, mobile: false },
  { name: "phone-portrait", width: 390, height: 844, mobile: true },
];

const TABS = ["live", "media", "control", "test", "settings"] as const;

/// Tabs required to fit on screen with no scrolling at all.
///
/// Live is the performance surface: a scrollbar there means a touch drag scrolls
/// the page instead of playing the array, which is the bug that prompted this
/// gate in the first place. The aspect-adaptive layout keeps the whole surface
/// inside the window at every viewport here; where a control column runs out of
/// height it scrolls itself, which is a nested scroller and not the document.
const MUST_FIT_VERTICALLY = new Set<string>(["live"]);

interface Overflow {
  axis: "horizontal" | "vertical";
  element: string;
  detail: string;
}

async function overflows(
  page: import("@playwright/test").Page,
  requireVerticalFit: boolean,
): Promise<Overflow[]> {
  return page.evaluate((requireVerticalFit) => {
    const problems: Overflow[] = [];
    const root = document.documentElement;
    const vw = root.clientWidth;
    const vh = root.clientHeight;
    const SLACK = 1; // sub-pixel rounding at fractional device pixel ratios

    const describe = (el: Element): string => {
      const id = el.id ? `#${el.id}` : "";
      const cls =
        typeof el.className === "string" && el.className
          ? `.${el.className.trim().split(/\s+/).join(".")}`
          : "";
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };

    if (root.scrollWidth > vw + SLACK) {
      problems.push({
        axis: "horizontal",
        element: "document",
        detail: `scrollWidth ${root.scrollWidth} > viewport ${vw}`,
      });
    }
    if (requireVerticalFit && root.scrollHeight > vh + SLACK) {
      problems.push({
        axis: "vertical",
        element: "document",
        detail: `scrollHeight ${root.scrollHeight} > viewport ${vh}`,
      });
    }

    // Deliberately off-screen (`data-layout-exempt`) or a screen-reader-only box
    // (the standard 1px clipped `.visually-hidden` pattern, which by definition
    // "clips its content").
    const exempt = (el: Element) => !!el.closest("[data-layout-exempt], .visually-hidden");

    /// True when the element lives inside a scroll region other than <main> — a
    /// Live control column, a modal's scroll area. Content there is reachable by
    /// scrolling *that* region, so it is not clipped and not our business.
    /// <main> is excluded from that reasoning on purpose: it is the page, and a
    /// scrollbar on it is exactly the symptom this gate exists to catch.
    const inNestedScroller = (el: Element): boolean => {
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (/auto|scroll/.test(`${s.overflowX} ${s.overflowY}`)) return n.tagName !== "MAIN";
      }
      return false;
    };

    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (exempt(el)) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > vw + SLACK) {
        problems.push({
          axis: "horizontal",
          element: describe(el),
          detail: `right edge ${Math.round(rect.right)} past viewport width ${vw}`,
        });
      }
      if (rect.left < -SLACK) {
        problems.push({
          axis: "horizontal",
          element: describe(el),
          detail: `left edge ${Math.round(rect.left)} before viewport origin`,
        });
      }
    }

    // On a view that must fit, <main> having anything to scroll IS the bug:
    // the array view has been squeezed and a touch drag now scrolls the page.
    const main = document.querySelector("main");
    if (requireVerticalFit && main && main.scrollHeight > main.clientHeight + SLACK) {
      problems.push({
        axis: "vertical",
        element: "main",
        detail: `content ${main.scrollHeight} taller than box ${main.clientHeight}`,
      });
    }

    // Boxes that don't fit their own content. Not flagged: replaced elements,
    // whose scrollWidth/scrollHeight describe internal rendering rather than
    // layout (a range input reports a 9px "content" in a 4px box); text that
    // declares `text-overflow: ellipsis`, which is truncation on purpose; and
    // anything inside a nested scroll region, which is reachable by scrolling.
    const REPLACED = new Set(["INPUT", "SELECT", "TEXTAREA", "CANVAS", "IMG", "SVG", "VIDEO", "IFRAME"]);
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (exempt(el)) continue;
      if (REPLACED.has(el.tagName)) continue;
      const style = getComputedStyle(el);
      if (style.textOverflow === "ellipsis") continue;
      if (inNestedScroller(el)) continue;
      // Only a box that HIDES its overflow actually loses content. `visible`
      // spills (ugly, but caught by the viewport rules if it matters) and
      // `auto`/`scroll` is reachable.
      const clipsX = /hidden|clip/.test(style.overflowX);
      const clipsY = /hidden|clip/.test(style.overflowY);
      if (clipsX && el.scrollWidth > el.clientWidth + SLACK) {
        problems.push({
          axis: "horizontal",
          element: describe(el),
          detail: `content ${el.scrollWidth} wider than box ${el.clientWidth}`,
        });
      }
      if (requireVerticalFit && clipsY && el.scrollHeight > el.clientHeight + SLACK) {
        problems.push({
          axis: "vertical",
          element: describe(el),
          detail: `content ${el.scrollHeight} taller than box ${el.clientHeight}`,
        });
      }
    }

    // Deduplicate: one overflowing child usually reports through its ancestors.
    const seen = new Set<string>();
    return problems.filter((p) => {
      const key = `${p.axis}|${p.element}|${p.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, requireVerticalFit);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const tab of TABS) {
      test(`${tab} tab fits`, async ({ page }) => {
        await page.goto(`/#${tab}`);
        // Wait for the backend state to land: until it does, half the controls
        // (which are the things that overflow) have not rendered.
        await expect(page.locator('.app[data-connected="yes"]')).toBeAttached();
        await page.waitForTimeout(250);

        const problems = await overflows(
          page,
          MUST_FIT_VERTICALLY.has(tab) && !viewport.mobile,
        );
        expect(
          problems,
          `Clipped or overflowing regions on the ${tab} tab at ${viewport.width}x${viewport.height}:\n` +
            problems.map((p) => `  [${p.axis}] ${p.element} — ${p.detail}`).join("\n"),
        ).toEqual([]);
      });
    }

    test("show mode fits", async ({ page }) => {
      // Show mode is a desktop/tablet control: a PWA on a phone is already
      // fullscreen, and the narrow topbar has no room for the toggle.
      test.skip(viewport.mobile, "show mode is not offered below the 700px breakpoint");
      await page.goto("/#live");
      await expect(page.locator('.app[data-connected="yes"]')).toBeAttached();
      await page.getByRole("button", { name: /Show mode/ }).click();
      await expect(page.locator(".show-exit")).toBeVisible();
      await page.waitForTimeout(250);

      const problems = await overflows(page, MUST_FIT_VERTICALLY.has("live"));
      expect(
        problems,
        `Clipped or overflowing regions in show mode at ${viewport.width}x${viewport.height}:\n` +
          problems.map((p) => `  [${p.axis}] ${p.element} — ${p.detail}`).join("\n"),
      ).toEqual([]);
    });
  });
}
