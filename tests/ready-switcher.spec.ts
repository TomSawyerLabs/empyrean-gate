import { expect, test } from "@playwright/test";

test("a scene can be prepared off air and taken to Program", async ({ page, request }) => {
  await request.post("/mock/reset-config");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#ready");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".bus-card.program")).toContainText("Original Gate");
  await expect(page.locator(".bus-card.ready")).toContainText("No scene loaded");
  await expect(page.locator(".take-button")).toBeDisabled();

  await page.locator(".scene-tray-grid").getByRole("button", { name: /Warm Windstorm/ }).click();
  await expect(page.locator(".bus-card.ready")).toContainText("Warm Windstorm");
  await expect(page.locator(".bus-card.ready canvas")).toBeVisible();
  await expect(page.locator(".take-button")).toBeEnabled();

  await page.locator(".take-button").click();
  await expect(page.locator(".bus-card.program")).toContainText("Warm Windstorm");
  await expect(page.locator(".bus-card.ready")).toContainText("Previous program");
});

test("the phone layout keeps both buses and Take reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#ready");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".bus-card.program")).toBeVisible();
  await expect(page.locator(".take-button")).toBeVisible();
  await expect(page.locator(".bus-card.ready")).toBeVisible();
});
