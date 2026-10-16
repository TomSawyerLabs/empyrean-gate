// The patch editor on a phone: the palette and a node's settings are sheets,
// opened on purpose and closed with Done, instead of columns that leave the
// canvas a sliver (reported 2026-10-16 from the empyreangate.org playground).

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
});

test("the palette is a sheet opened from Add node, and a pick closes it", async ({ page }) => {
  await expect(page.locator(".patch-tab")).toHaveClass(/compact/);
  await expect(page.locator(".patch-palette")).toHaveCount(0);
  const before = await page.locator(".pnode").count();
  await page.getByRole("button", { name: "＋ Add node" }).click();
  const sheet = page.locator(".patch-palette.patch-sheet");
  await expect(sheet).toBeVisible();
  // A sheet covers the canvas rather than squeezing it.
  const box = (await sheet.boundingBox())!;
  expect(box.width).toBeGreaterThan(380);
  await sheet.locator(".palette-item", { hasText: "Noise" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".pnode")).toHaveCount(before + 1);
});

test("a node's settings open on a second tap or from the pill, and Done closes them", async ({
  page,
}) => {
  const node = page.locator(".pnode", { hasText: "Output" });
  await node.click();
  // One tap selects only; the settings are offered, not forced.
  await expect(page.locator(".patch-side")).toHaveCount(0);
  const pill = page.getByRole("button", { name: /Output settings/ });
  await expect(pill).toBeVisible();
  await pill.click();
  const sheet = page.locator(".patch-side.patch-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("h3")).toHaveText("Output");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);

  // The double-tap route.
  await node.click();
  await node.click();
  await expect(page.locator(".patch-side.patch-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".patch-side.patch-sheet")).toHaveCount(0);
});

test("a wide window keeps the columns", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.locator(".patch-tab")).not.toHaveClass(/compact/);
  await expect(page.locator(".patch-palette")).toBeVisible();
  await expect(page.getByRole("button", { name: "＋ Add node" })).toHaveCount(0);
  await page.locator(".pnode", { hasText: "Output" }).click();
  await expect(page.locator(".patch-side")).toBeVisible();
});
