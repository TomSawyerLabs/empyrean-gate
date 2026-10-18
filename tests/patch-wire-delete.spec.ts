// Deleting a wire without a keyboard (asked for 2026-10-18: "mobile/touch
// needs a way to delete a link between nodes"): a tapped wire is selected and
// carries a ✕ at its middle; the ✕ removes it as one undo step. Desks get the
// same button, beside the Delete key.

import { expect, test, type Page } from "@playwright/test";

/** The screen point halfway along a wire, where a finger would land. */
function wireMiddle(page: Page) {
  return page.locator(".react-flow__edge-interaction").first().evaluate((el) => {
    const path = el as SVGPathElement;
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM()!;
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a tapped wire offers ✕, which deletes it, and Undo brings it back", async ({ page }) => {
    await page.goto("/#patch");
    await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
    await page.locator(".patch-name-chip").click();
    await page.getByRole("button", { name: "＋ Blank patch" }).click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    const del = page.getByRole("button", { name: "Delete wire" });
    await expect(del).toHaveCount(0);

    const at = await wireMiddle(page);
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
    await expect(del).toBeVisible();
    // Big enough for a thumb whatever the zoom.
    const box = (await del.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(30);

    await del.tap();
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
    await expect(del).toHaveCount(0);

    await page.getByRole("button", { name: "Undo", exact: true }).tap();
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  });
});

test("on a desk a clicked wire shows the same ✕", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  const at = await wireMiddle(page);
  await page.mouse.click(at.x, at.y);
  await page.getByRole("button", { name: "Delete wire" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});
