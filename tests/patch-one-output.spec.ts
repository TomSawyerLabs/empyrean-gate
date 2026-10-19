// A patch has one Output (asked for 2026-10-18: "probably shouldn't be
// possible to have two outputs"). The palette's Output is disabled, with a
// visible reason, while the patch has one; delete it and the palette offers it
// again.

import { expect, test } from "@playwright/test";

test("the palette offers Output only while the patch has none", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  const outputs = page.locator(".pnode.cat-sink");
  await expect(outputs).toHaveCount(1);

  const add = page.locator(".patch-palette .palette-item.cat-sink");
  await expect(add).toBeDisabled();
  await expect(add).toContainText("one per patch");
  await add.click({ force: true });
  await expect(outputs).toHaveCount(1);

  await outputs.click();
  await page.keyboard.press("Delete");
  await expect(outputs).toHaveCount(0);
  await expect(add).toBeEnabled();
  await expect(add).not.toContainText("one per patch");

  await add.click();
  await expect(outputs).toHaveCount(1);
  await expect(add).toBeDisabled();
});
