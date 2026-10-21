// The editor's status: a dot that beats with the engine's status messages
// (~2 Hz from its render loop), "stalled" when they stop, and the engine's
// numbers on hover or tap. Asked for 2026-10-21: the old steady "patch
// rendering" label read as stuck.

import { expect, test, type Page } from "@playwright/test";

/** Open a copy of the mock's built-in and put it on air. */
async function activateMockNoise(page: Page) {
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.locator(".patch-browser .browser-item", { hasText: "Mock Noise" }).click();
  await page.locator(".patch-lock-chip").click();
  await page.getByRole("button", { name: "Make a copy to edit" }).click();
  // The autosave (600 ms) names it; Activate is enabled once it has an id.
  const activate = page.getByRole("button", { name: "▶ Activate" });
  await expect(activate).toBeEnabled({ timeout: 5_000 });
  await activate.click();
}

test("on air, the status beats, and hover shows the engine's numbers", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await activateMockNoise(page);

  const live = page.locator(".patch-toolbar .patch-live");
  await expect(live).toHaveAttribute("data-liveness", "live");
  await expect(live).toHaveText("live");
  const first = Number(await live.getAttribute("data-beat"));
  await expect.poll(async () => Number(await live.getAttribute("data-beat"))).toBeGreaterThan(first);

  // Hover opens the details; leaving closes them.
  const details = page.getByRole("dialog", { name: "Patch status" });
  await live.hover();
  await expect(details).toContainText("✓ All OK");
  await expect(details.locator("dt", { hasText: "Frame rate" }).locator("+ dd")).toHaveText("60 fps");
  await expect(details.locator("dt", { hasText: "GPU" }).locator("+ dd")).toHaveText("Mock Vulkan Device");
  await page.mouse.move(10, 890);
  await expect(details).toHaveCount(0);

  // A click pins them open; Escape closes them.
  await live.click();
  await page.mouse.move(10, 890);
  await expect(details).toBeVisible();
  await expect(live).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
});

test("when the engine's status stops coming, the status says stalled", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  let drop = false;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      if (drop && typeof m === "string" && m.startsWith('{"type":"status"')) return;
      ws.send(m);
    });
  });
  await activateMockNoise(page);
  const live = page.locator(".patch-toolbar .patch-live");
  await expect(live).toHaveAttribute("data-liveness", "live");

  drop = true;
  await expect(live).toHaveAttribute("data-liveness", "stalled", { timeout: 6_000 });
  await expect(live).toHaveText("stalled");
  await live.click();
  await expect(page.getByRole("dialog", { name: "Patch status" })).toContainText("No new frames for");

  drop = false;
  await expect(live).toHaveAttribute("data-liveness", "live", { timeout: 3_000 });
});

test.describe("on a phone", () => {
  test.use({ hasTouch: true });

  test("the status is a chip, and a tap shows the details", async ({ page }) => {
    // On air from a wide window, then down to a phone's width: compact.
    await page.setViewportSize({ width: 1400, height: 900 });
    await activateMockNoise(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".patch-tab")).toHaveClass(/compact/);

    const chip = page.locator(".patch-canvas-chips .patch-live");
    await expect(chip).toHaveAttribute("data-liveness", "live");
    await chip.tap();
    const details = page.getByRole("dialog", { name: "Patch status" });
    await expect(details).toContainText("✓ All OK");
    // It fits the canvas, whichever chip it hangs from.
    const box = (await details.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // A tap elsewhere closes it.
    await page.locator(".react-flow__pane").tap({ position: { x: 200, y: 400 } });
    await expect(details).toHaveCount(0);
  });
});
