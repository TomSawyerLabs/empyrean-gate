// The shape pads carry two gestures: tap arms the figure, hold opens how figures
// are drawn. These check they stay separate, that the style actually reaches the
// backend on the next stamp, and that it persists.

import { expect, test, type Page } from "@playwright/test";

async function hold(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

async function openWithWire(page: Page, hash: string, width = 1400, height = 900) {
  const sent: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (frame) => {
      if (typeof frame.payload === "string") sent.push(frame.payload);
    }),
  );
  await page.setViewportSize({ width, height });
  await page.goto(`/#${hash}`);
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  return { sent, effects: () => sent.filter((m) => m.includes('"trigger_effect"')) };
}

test("holding a shape pad opens the definition menu without arming the shape", async ({ page }) => {
  await openWithWire(page, "live");
  const pad = page.locator(".shape-btn").first();
  await hold(page, ".shape-btn");
  await expect(page.locator(".shape-quick-edit")).toBeVisible();
  // The click that follows the finger lifting must not also select the tool.
  await expect(pad).toHaveAttribute("aria-pressed", "false");
});

test("a plain tap on a shape pad still arms it", async ({ page }) => {
  await openWithWire(page, "live");
  const pad = page.locator(".shape-btn").first();
  await pad.click();
  await expect(pad).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".shape-quick-edit")).toHaveCount(0);
});

test("Edge stays usable across its whole range", async ({ page }) => {
  await openWithWire(page, "live");
  await hold(page, ".shape-btn");
  const card = page.locator(".shape-quick-edit");
  const edge = card.locator(".slider-row", { hasText: "Edge" }).locator("input[type=range]");
  // The shader floors the width at the local resolution limit, so there is no
  // setting that draws nothing and none that needs a warning.
  for (const v of ["0", "0.5", "1"]) {
    await edge.fill(v);
    await expect(edge).toHaveValue(v === "0" ? "0" : v);
  }
  await expect(card.locator(".cluster-hint.warn")).toHaveCount(0);
});

test("the style reaches the backend on the next stamp", async ({ page }) => {
  const wire = await openWithWire(page, "live");
  await hold(page, ".shape-btn");
  const card = page.locator(".shape-quick-edit");
  await card.locator(".slider-row", { hasText: "Edge" }).locator("input[type=range]").fill("0.8");
  await card.locator(".slider-row", { hasText: "Fill" }).locator("input[type=range]").fill("0.9");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // Arm the shape, then stamp it on the array.
  await page.locator(".shape-btn").first().click();
  const canvas = page.locator(".live-canvas-wrap canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);

  await expect.poll(() => wire.effects().length).toBeGreaterThan(0);
  const last = wire.effects().at(-1) ?? "";
  expect(last).toContain('"edge":0.8');
  expect(last).toContain('"fill":0.9');
});

test("the style survives a reload", async ({ page }) => {
  await openWithWire(page, "live");
  await hold(page, ".shape-btn");
  await page
    .locator(".shape-quick-edit .slider-row", { hasText: "Edge" })
    .locator("input[type=range]")
    .fill("0.77");
  await page.keyboard.press("Escape");

  await page.reload();
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await hold(page, ".shape-btn");
  await expect(
    page.locator(".shape-quick-edit .slider-row", { hasText: "Edge" }).locator("input[type=range]"),
  ).toHaveValue("0.77");
});

test("Reset returns the shipped default", async ({ page }) => {
  await openWithWire(page, "live");
  await hold(page, ".shape-btn");
  const card = page.locator(".shape-quick-edit");
  const edge = card.locator(".slider-row", { hasText: "Edge" }).locator("input[type=range]");
  await edge.fill("0.9");
  await card.getByRole("button", { name: "Reset" }).click();
  await expect(edge).toHaveValue("0.3");
});

test("Control's shape pads carry the same gesture", async ({ page }) => {
  await openWithWire(page, "control");
  const pad = page.locator(".shape-grid.big .shape-btn").first();
  await pad.scrollIntoViewIfNeeded();
  await hold(page, ".shape-grid.big .shape-btn");
  await expect(page.locator(".shape-quick-edit")).toBeVisible();
});
