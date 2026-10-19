// The patch editor on a phone: the palette and a node's settings are sheets,
// opened on purpose and closed with Done, instead of columns that leave the
// canvas a sliver (reported 2026-10-16 from the empyreangate.org playground).

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  // Compact: there is no toolbar; a new patch comes from the patch chip's menu.
  await page.locator(".patch-name-chip").click();
  await page.getByRole("button", { name: "＋ Blank patch" }).click();
});

test("the palette is a sheet opened from Add node, and a pick closes it", async ({ page }) => {
  await expect(page.locator(".patch-tab")).toHaveClass(/compact/);
  await expect(page.locator(".patch-palette")).toHaveCount(0);
  const before = await page.locator(".pnode").count();
  await page.getByRole("button", { name: "Add node" }).click();
  const sheet = page.locator(".patch-palette.patch-sheet");
  await expect(sheet).toBeVisible();
  // A sheet covers the canvas rather than squeezing it.
  const box = (await sheet.boundingBox())!;
  expect(box.width).toBeGreaterThan(380);
  await sheet.getByRole("button", { name: "Noise", exact: true }).click();
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

  // The double-tap route, after a pause so it cannot pair with the tap above.
  await page.waitForTimeout(500);
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
  await expect(page.getByRole("button", { name: "Add node" })).toHaveCount(0);
  await page.locator(".pnode", { hasText: "Output" }).click();
  await expect(page.locator(".patch-side")).toBeVisible();
});

test("the toolbar is gone; the patch chip opens a menu with rename, open and new", async ({
  page,
}) => {
  await expect(page.locator(".patch-toolbar")).toHaveCount(0);
  const chip = page.locator(".patch-name-chip");
  await expect(chip).toContainText("New patch");
  await chip.click();
  const menu = page.locator(".patch-menu");
  await expect(menu).toBeVisible();
  await menu.getByLabel("Patch name").fill("Phone patch");
  await menu.getByRole("button", { name: "Done" }).click();
  await expect(menu).toHaveCount(0);
  await expect(chip).toContainText("Phone patch");

  // Another patch from the menu's list, then a blank one.
  await chip.click();
  await expect(page.locator(".patch-menu-list button").first()).toBeVisible();
  await page.getByRole("button", { name: "＋ Blank patch" }).click();
  await expect(page.locator(".patch-menu")).toHaveCount(0);
  await expect(chip).toContainText("New patch");
});
