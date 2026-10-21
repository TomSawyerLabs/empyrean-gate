// A patch opens fitted to the canvas, and stays fitted while its cards grow
// (they are measured, then gain their minis once the preview runs, all after
// the first fit), until the person moves the view. Here the growth is a
// style that widens every card.

import { expect, test, type Page } from "@playwright/test";

function zoom(page: Page) {
  return page
    .locator(".patch-canvas .react-flow__viewport")
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
}

/** How far the cards reach past the canvas's edges, in px (0: all in view). */
function overhang(page: Page) {
  return page.locator(".patch-canvas .react-flow").evaluate((flow) => {
    const pane = flow.getBoundingClientRect();
    let worst = 0;
    for (const n of flow.querySelectorAll(".react-flow__node")) {
      const b = n.getBoundingClientRect();
      worst = Math.max(worst, pane.left - b.left, b.right - pane.right, pane.top - b.top, b.bottom - pane.bottom);
    }
    return worst;
  });
}

async function growCards(page: Page, width: number) {
  await page.addStyleTag({ content: `.patch-canvas .react-flow__node { min-width: ${width}px; }` });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0);
  await expect.poll(() => overhang(page)).toBeLessThanOrEqual(1);
});

test("cards that grow after a patch opens are refitted into view", async ({ page }) => {
  const before = await zoom(page);
  await growCards(page, 1400);
  await expect.poll(() => zoom(page)).toBeLessThan(before);
  await expect.poll(() => overhang(page)).toBeLessThanOrEqual(1);
});

test("once the person zooms, a card growing leaves the view alone", async ({ page }) => {
  await page.locator(".patch-canvas .react-flow__pane").dispatchEvent("wheel", {
    deltaY: -80,
    ctrlKey: true,
    clientX: 700,
    clientY: 450,
  });
  await page.waitForTimeout(400);
  const zoomed = await zoom(page);
  await growCards(page, 1400);
  await page.waitForTimeout(600);
  expect(await zoom(page)).toBe(zoomed);
});
