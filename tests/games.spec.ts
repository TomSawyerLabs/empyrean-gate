import { expect, test } from "@playwright/test";

test("Radial Tetris is selectable and exposes touch-sized play controls", async ({ page }) => {
  const clientId = `radial-tetris-${Date.now()}`;
  await page.addInitScript(() => {
    const sent: unknown[] = [];
    Object.defineProperty(window, "__previewSubscriptions", { value: sent });
    const original = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        const message = JSON.parse(data);
        if (message.type === "subscribe_preview") sent.push(message);
      }
      return original.call(this, data);
    };
  });
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), clientId);
  await page.request.post(`/mock/status?client=${clientId}`, {
    data: {
      game: {
        active: "radial_tetris",
        summary: "Radial Tetris · 42s",
        species: 4,
        effects_overlay: false,
        blocked_by_show: null,
      },
    },
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#games");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  const card = page.locator(".games-card", { hasText: "Radial Tetris" });
  await expect(card).toHaveClass(/active/);
  await expect(card.getByRole("button", { name: "Stop" })).toBeVisible();

  const controls = page.getByRole("group", { name: "Radial Tetris controls" });
  await expect(controls.getByRole("button")).toHaveCount(4);
  await expect(controls.getByRole("button", { name: "Rotate" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Hard drop" })).toBeVisible();

  for (const button of await controls.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }

  const previewFps = await page.evaluate(() => {
    const subscriptions = (
      window as typeof window & { __previewSubscriptions: Array<{ fps: number }> }
    ).__previewSubscriptions;
    return subscriptions.at(-1)?.fps;
  });
  expect(previewFps, "the Gate machine preview should not add a 30 fps hold").toBe(60);
});
