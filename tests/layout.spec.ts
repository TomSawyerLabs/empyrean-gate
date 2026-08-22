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
//   2. The Live tab must fit vertically too. It is the performance surface; if it
//      scrolls, the array view has been squeezed.
//
// Tabs that are legitimately long (Settings, Control, Video) may scroll
// vertically inside <main>, which is a scroll container by design.
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

const TABS = ["live", "media", "control", "settings"] as const;

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

    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (el.closest("[data-layout-exempt]")) continue;
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

    // Scroll containers: a horizontal one is always a bug here, and on the tabs
    // that must fit, a vertical one is too.
    //
    // Two things are not "clipping" and must not be flagged: replaced elements,
    // whose scrollWidth/scrollHeight describe internal rendering rather than
    // layout (a range input reports a 9px "content" in a 4px box), and text that
    // declares `text-overflow: ellipsis`, which is truncation on purpose.
    const REPLACED = new Set(["INPUT", "SELECT", "TEXTAREA", "CANVAS", "IMG", "SVG", "VIDEO", "IFRAME"]);
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (el.closest("[data-layout-exempt]")) continue;
      if (REPLACED.has(el.tagName)) continue;
      if (getComputedStyle(el).textOverflow === "ellipsis") continue;
      if (el.scrollWidth > el.clientWidth + SLACK) {
        problems.push({
          axis: "horizontal",
          element: describe(el),
          detail: `content ${el.scrollWidth} wider than box ${el.clientWidth}`,
        });
      }
      if (requireVerticalFit && el.scrollHeight > el.clientHeight + SLACK) {
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

        const problems = await overflows(page, tab === "live" && !viewport.mobile);
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

      const problems = await overflows(page, true);
      expect(
        problems,
        `Clipped or overflowing regions in show mode at ${viewport.width}x${viewport.height}:\n` +
          problems.map((p) => `  [${p.axis}] ${p.element} — ${p.detail}`).join("\n"),
      ).toEqual([]);
    });
  });
}
