// A patch that reads raw touch (Touch / Touch mask / Touch glow nodes) owns the
// touch surface: while status says `patch_touch`, the canvas sends every
// pointer as `touch` events — down and up straight away, moves batched — and
// no tap effect or pen stroke of its own. See plans/touch-nodes.md.

import { expect, test, type Page } from "@playwright/test";

function collectSent(page: Page): string[] {
  const sent: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") sent.push(frame.payload);
    }),
  );
  return sent;
}

const touches = (sent: string[]) =>
  sent
    .filter((m) => m.includes('"type":"touch"'))
    .flatMap((m) => (JSON.parse(m) as { points: { id: number; phase: string }[] }).points);

async function drag(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  await page.mouse.move(...at(0.7, 0.5));
  await page.mouse.down();
  await page.mouse.move(...at(0.72, 0.4), { steps: 4 });
  await page.waitForTimeout(80);
  await page.mouse.move(...at(0.75, 0.3), { steps: 4 });
  await page.mouse.up();
}

test("the Live canvas sends raw touches while the patch owns touch", async ({ page }) => {
  const sent = collectSent(page);
  const clientId = `patch-touch-live-${Date.now()}`;
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), clientId);
  await page.request.post(`/mock/status?client=${clientId}`, { data: { patch_touch: true } });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await drag(page, ".live-canvas-wrap canvas");
  await expect.poll(() => touches(sent).map((p) => p.phase).join(",")).toMatch(/^down,(move,)+.*up$/);
  // One pointer, one id, from down to up.
  expect(new Set(touches(sent).map((p) => p.id)).size).toBe(1);
  // The tap tool did not fire on top of it.
  expect(sent.some((m) => m.includes('"trigger_effect"'))).toBe(false);
});

test("without a touch patch the Live canvas taps as before", async ({ page }) => {
  const sent = collectSent(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await drag(page, ".live-canvas-wrap canvas");
  await expect.poll(() => sent.some((m) => m.includes('"trigger_effect"'))).toBe(true);
  expect(touches(sent)).toHaveLength(0);
});

test("the public floor sends raw touches while the patch owns touch", async ({ page }) => {
  const sent = collectSent(page);
  const clientId = `public-touch-${Date.now()}`;
  await page.addInitScript((id) => localStorage.setItem("empyrean-public-id", id), clientId);
  await page.request.post(`/mock/public?client=${clientId}`, { data: { patch_touch: true } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/public.html");
  await page.locator('.public-app[data-connected="yes"]').waitFor({ state: "attached" });

  await drag(page, ".public-stage canvas.gate-canvas");
  await expect.poll(() => touches(sent).map((p) => p.phase)).toContain("up");
  expect(touches(sent)[0].phase).toBe("down");
  expect(sent.some((m) => m.includes('"trigger_effect"') || m.includes('"paint"'))).toBe(false);
});
