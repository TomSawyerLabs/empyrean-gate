// The gate's master brightness and speed in the editor's canvas: a card on a
// wide window, a one-line chip on a phone, live for every client (they are
// the Live tab's sliders, not part of the patch; asked for 2026-10-16 so the
// graph never hides what else shapes the picture).

import { expect, test, type Page } from "@playwright/test";

async function connected(page: Page) {
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
}

test("a wide window shows the globals card; its sliders are the gate's master", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await connected(page);
  await page.getByRole("button", { name: "＋ New" }).click();

  const card = page.locator(".patch-globals");
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/open/);
  const brightness = card.getByLabel("Brightness");
  await expect(brightness).toBeEnabled();
  await brightness.fill("0.5");
  await expect(card.locator("output").first()).toHaveText("50%");

  // The Live tab's own slider follows: it is the same config on the gate.
  await page.evaluate(() => {
    location.hash = "#live";
  });
  await expect(page.locator(".slider-row", { hasText: "Brightness" }).locator("input")).toHaveValue(
    "0.5",
  );
  // Back in the editor (a fresh mount: the unsaved patch is gone, so open
  // another), the card reads the gate's value, not a stale local one.
  await page.evaluate(() => {
    location.hash = "#patch";
  });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(card.getByLabel("Brightness")).toHaveValue("0.5");
  // Put it back for the other specs sharing this mock.
  await card.getByLabel("Brightness").fill("1");
  await expect(card.locator("output").first()).toHaveText("100%");

  // Collapsed, the head still shows the values.
  await card.getByRole("button", { name: /Hide the gate's globals/ }).click();
  await expect(card).not.toHaveClass(/open/);
  await expect(card).toContainText(/Brightness \d+% · Speed [\d.]+×/);
  await expect(card.locator("input")).toHaveCount(0);
});

test("a phone gets the one-line chip, which opens into the card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#patch");
  await connected(page);
  await page.locator(".patch-name-chip").click();
  await page.getByRole("button", { name: "＋ Blank patch" }).click();

  const card = page.locator(".patch-globals");
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/open/);
  await expect(card).toContainText(/Brightness \d+% · Speed [\d.]+×/);
  // It stays clear of the chips at the top and inside the canvas.
  const canvas = (await page.locator(".patch-canvas").boundingBox())!;
  const box = (await card.boundingBox())!;
  expect(box.y).toBeGreaterThan(canvas.y + canvas.height / 2);
  expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);

  await card.locator(".patch-globals-head").click();
  await expect(card).toHaveClass(/open/);
  await expect(card.getByLabel("Speed")).toBeVisible();
  await expect(card.locator(".patch-globals-note")).toContainText("Live tab");
});
