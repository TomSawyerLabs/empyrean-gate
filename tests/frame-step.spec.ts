// Frame by frame on the gate (plans/frame-step.md): the Patch tab's transport
// bar freezes the editor's views of the patch on air; the gate's engine (the
// show) keeps running, so the status never says "paused". Freezing and
// stepping through kept batches are unit-tested (src/miniPreview.test.ts);
// the mock sends no mini batches.

import { expect, test } from "@playwright/test";

test("the patch on air gets a bar that freezes its views, not the show", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.locator(".patch-browser .browser-item", { hasText: "Mock Noise" }).click();
  await page.locator(".patch-lock-chip").click();
  await page.getByRole("button", { name: "Make a copy to edit" }).click();

  // Not on air yet: no bar.
  const bar = page.getByRole("group", { name: "Frame by frame" });
  await expect(bar).toHaveCount(0);
  const activate = page.getByRole("button", { name: "▶ Activate" });
  await expect(activate).toBeEnabled({ timeout: 5_000 });
  await activate.click();

  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Freeze the views" })).toBeVisible();
  // Nothing kept yet, and forward only moves back up through what was kept.
  await expect(bar.getByRole("button", { name: "Step back a frame" })).toBeDisabled();
  await expect(bar.getByRole("button", { name: "Step forward a frame" })).toBeDisabled();

  await page.keyboard.press("k");
  await expect(bar.getByRole("button", { name: "Resume the views" })).toBeVisible();
  await expect(bar).toContainText("Views frozen; the gate keeps running");
  await expect(page.locator(".patch-live")).not.toHaveAttribute("data-liveness", "paused");
  await bar.getByRole("button", { name: "Resume the views" }).click();
  await expect(bar.getByRole("button", { name: "Freeze the views" })).toBeVisible();

  // Keep past frames offers its lengths with what each costs.
  const keep = bar.getByRole("combobox", { name: "Keep past frames" });
  await expect(keep.locator("option")).toHaveCount(5);
  await expect(keep.locator("option").nth(1)).toContainText(/2 s · \d+ MB/);
});
