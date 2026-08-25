import { expect, test } from "@playwright/test";

test("the Gate machine preview subscribes at render cadence", async ({ page }) => {
  const clientId = `local-preview-${Date.now()}`;
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

  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  const previewFps = await page.evaluate(() => {
    const subscriptions = (
      window as typeof window & { __previewSubscriptions: Array<{ fps: number }> }
    ).__previewSubscriptions;
    return subscriptions.at(-1)?.fps;
  });
  expect(previewFps, "the Gate machine preview should not add a 30 fps hold").toBe(60);
});

test("the fps and pkt/s meters line up with each other", async ({ page }) => {
  // They used to be two independently-centred rows, so the bars landed wherever
  // each row's own readout width put them — "60 fps" is much narrower than
  // "11520 pkt/s", and the two histograms sat visibly offset in the ring.
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  const bars = page.locator(".ring-meters .sparkbars svg");
  const values = page.locator(".ring-meters .spark-value");
  await expect(bars).toHaveCount(2);

  for (const [what, rows] of [
    ["histograms", bars],
    ["readouts", values],
  ] as const) {
    const lefts = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));
    expect(Math.abs(lefts[0] - lefts[1]), `the ${what} should share a left edge`).toBeLessThan(0.5);
  }
});
