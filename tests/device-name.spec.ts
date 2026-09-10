// A device that never picked a name is minted a two-word one, nudged to pick
// its own from the top-bar chip, and the choice reaches the wire as
// set_client_name (and the hello on the next connect).

import { expect, test } from "@playwright/test";

test("a fresh device gets a two-word name and can change it", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  const chip = page.locator(".topbar .name-chip");
  await expect(chip).toHaveClass(/unconfirmed/);
  const minted = await page.evaluate(() => localStorage.getItem("empyrean-client-name"));
  expect(minted).toMatch(/^\S+ .+$/);
  await expect(chip).toContainText(minted!);

  await chip.click();
  const input = page.getByRole("textbox", { name: "Device name" });
  await expect(input).toHaveValue(minted!);
  await input.fill("Booth iPad");
  await page.getByRole("button", { name: "Use this name" }).click();

  await expect(chip).not.toHaveClass(/unconfirmed/);
  await expect(chip).toContainText("Booth iPad");
  expect(await page.evaluate(() => localStorage.getItem("empyrean-client-name"))).toBe("Booth iPad");
  expect(await page.evaluate(() => localStorage.getItem("empyrean-client-name-generated"))).toBeNull();
});

test("keeping the minted name confirms it", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  const chip = page.locator(".topbar .name-chip");
  await chip.click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(chip).not.toHaveClass(/unconfirmed/);
});
