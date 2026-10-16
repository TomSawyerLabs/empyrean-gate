// Undo, redo and duplicate in the patch editor: Ctrl+Z / Ctrl+Shift+Z / Ctrl+D
// and the toolbar buttons.

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);
});

test("undo and redo walk the edits, from the keyboard and the toolbar", async ({ page }) => {
  const undo = page.getByRole("button", { name: "↶ Undo" });
  const redo = page.getByRole("button", { name: "↷ Redo" });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.locator(".palette-item", { hasText: "Noise" }).click();
  await expect(page.locator(".pnode")).toHaveCount(3);
  await expect(undo).toBeEnabled();

  await page.keyboard.press("Control+z");
  await expect(page.locator(".pnode")).toHaveCount(2);
  await expect(redo).toBeEnabled();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".pnode")).toHaveCount(3);

  await undo.click();
  await expect(page.locator(".pnode")).toHaveCount(2);
  await redo.click();
  await expect(page.locator(".pnode")).toHaveCount(3);
  // A new edit after an undo drops the redo branch.
  await undo.click();
  await page.locator(".palette-item", { hasText: "Noise" }).click();
  await expect(redo).toBeDisabled();
});

test("Ctrl+D and the panel's Duplicate copy the selected node", async ({ page }) => {
  const noise = page.locator(".pnode", { hasText: "Noise" }).first();
  await noise.click();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".pnode", { hasText: "Noise" })).toHaveCount(2);

  // The copy is selected now; the panel offers Duplicate for it too.
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.locator(".pnode", { hasText: "Noise" })).toHaveCount(3);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".pnode", { hasText: "Noise" })).toHaveCount(2);
  // Output nodes are never duplicated: a patch has one.
  await page.locator(".pnode", { hasText: "Output" }).click();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".pnode", { hasText: "Output" })).toHaveCount(1);
});
