import { expect, test } from "@playwright/test";

test("participant credential receives only the locked public surface", async ({ page }) => {
  await page.goto("/?join=participant-test");
  await expect(page.getByRole("heading", { name: "Empyrean Gate" })).toBeVisible();
  await expect(page.getByText("Private control", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect" })).toHaveCount(0);
});

test("phone participants can jump to bounded effects controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?join=participant-effects-test");
  const jump = page.getByRole("button", { name: "Colors & tools" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page.getByRole("heading", { name: "Draw" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Red" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Strobe" })).toHaveCount(0);
});
