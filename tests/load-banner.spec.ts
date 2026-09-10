// The engine judges sustained underperformance; the UI shows one dismissible
// toast with the load-shedding knobs, and the meters carry a load sparkline.

import { expect, test } from "@playwright/test";

const CLIENT = "load-banner-test";

test("a load warning becomes a dismissible toast with shedding actions", async ({ page, request }) => {
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), CLIENT);
  await request.post(`/mock/status?client=${CLIENT}`, {
    data: { load_warning: true, load_history: [60, 90, 97, 99, 104, 101, 98, 103] },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  const banner = page.locator(".load-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("103% of budget");
  await expect(banner.getByRole("button", { name: /Cap phone previews at 15 fps/ })).toBeVisible();
  await expect(banner.getByRole("button", { name: /Render at 45 fps/ })).toBeVisible();
  // The load meter shows the same number, highlighted.
  await expect(page.locator(".spark-warn").first()).toContainText("103%");

  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
});

test("no warning, no toast — and the load meter is still there", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#control");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await expect(page.locator(".load-banner")).toHaveCount(0);
  await expect(page.locator(".spark-label", { hasText: "load" })).toBeVisible();
});
