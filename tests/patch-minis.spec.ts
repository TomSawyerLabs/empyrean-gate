// A patch opened from a preset is an unsaved copy (blank id) until its first
// autosave assigns one. The nodes on the canvas must learn that id too: their
// live thumbnails key on it, and used to stay blank until the patch was
// reopened (reported 2026-10-15 on the playground).

import { expect, test, type Page } from "@playwright/test";

/** Open the built-in from the patch browser, then make the copy to edit. */
async function editCopyOfMockNoise(page: Page) {
  await page.locator(".patch-browser .browser-item", { hasText: "Mock Noise" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);
  await page.locator(".patch-lock-chip").click();
  await page.getByRole("button", { name: "Make a copy to edit" }).click();
  await expect(page.locator(".patch-lock-chip")).toHaveCount(0);
}

test("a preset copy shows node thumbnails once it is saved and on air", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await editCopyOfMockNoise(page);
  // The autosave (600 ms) names it; Activate is enabled once it has an id.
  const activate = page.getByRole("button", { name: "▶ Activate" });
  await expect(activate).toBeEnabled({ timeout: 5_000 });
  await activate.click();

  // On air: the generator's thumbnail appears without reopening the patch.
  await expect(page.locator(".pnode .mini-ring")).toHaveCount(1);
});

// Stream and texture sources thumbnail too: the crate previews them as their
// default consumer would draw them (strokes with their pens, an effects
// chain's own fires, the texture straight onto the ring), so the editor shows
// the ring for a points / effects / texture output, not only for fields.
test("stream and texture sources get a thumbnail on air", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await editCopyOfMockNoise(page);
  const activate = page.getByRole("button", { name: "▶ Activate" });
  await expect(activate).toBeEnabled({ timeout: 5_000 });
  await activate.click();
  await expect(page.locator(".pnode .mini-ring")).toHaveCount(1);

  for (const label of ["Touch strokes", "Triggered effects", "Still image in", "Clip"]) {
    await page.locator(".palette-item", { hasText: label }).click();
    await expect(
      page.locator(".pnode", { hasText: label }).getByRole("img", { name: `${label} preview` }),
    ).toBeVisible();
  }
  // The Output has no output of its own, so no ring.
  await expect(page.locator(".pnode", { hasText: "Output" }).locator(".mini-ring")).toHaveCount(0);
  await expect(page.locator(".pnode .mini-ring")).toHaveCount(5);
});
