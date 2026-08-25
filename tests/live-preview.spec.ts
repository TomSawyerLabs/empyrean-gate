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
