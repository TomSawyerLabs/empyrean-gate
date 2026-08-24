// The quick-edit popover is the answer to "changing a layer meant leaving the
// Live tab". These check the two things that make it that: the gesture opens it
// without also toggling the layer, and moving a slider in it actually reaches
// the backend as an `update_layer`.

import { expect, test, type Page } from "@playwright/test";

/** Long-press: pointer down, hold past the hook's 450 ms, lift. */
async function hold(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

/**
 * Navigate with a recorder on every text frame the client sends. The mock
 * backend does not echo `update_layer` back as a new config, so what the UI
 * *did* is only observable on the wire — and the listener has to be attached
 * before the socket exists.
 */
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
  return {
    sent,
    updates: () => sent.filter((m) => m.includes('"update_layer"')),
  };
}

test("holding a Live layer opens its parameters instead of toggling it", async ({ page }) => {
  const wire = await openWithWire(page, "live");
  await hold(page, ".live-layer-list button");

  await expect(page.locator(".layer-quick-edit")).toBeVisible();
  // The click that follows the finger lifting must not also flip the layer.
  expect(wire.updates()).toHaveLength(0);
});

test("a plain tap on a Live layer still toggles it", async ({ page }) => {
  const wire = await openWithWire(page, "live");
  await page.locator(".live-layer-list button").first().click();
  await expect.poll(() => wire.updates().length).toBeGreaterThan(0);
  await expect(page.locator(".layer-quick-edit")).toHaveCount(0);
});

test("right-click opens it, Escape closes it", async ({ page }) => {
  await openWithWire(page, "live");
  await page.locator(".live-layer-list button").first().click({ button: "right" });
  await expect(page.locator(".layer-quick-edit")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".layer-quick-edit")).toHaveCount(0);
});

test("a slider in the popover sends update_layer", async ({ page }) => {
  const wire = await openWithWire(page, "live");
  await hold(page, ".live-layer-list button");
  const card = page.locator(".layer-quick-edit");
  await expect(card).toBeVisible();

  // "Scale" lives in the Motion group and exists for every layer kind.
  const scale = card.locator(".slider-row", { hasText: "Scale" }).locator("input[type=range]");
  await scale.fill("2.5");
  await expect.poll(() => wire.updates().length).toBeGreaterThan(0);
  expect(wire.updates().at(-1)).toContain('"scale":2.5');
});

test("the kind's own params appear under their real names", async ({ page }) => {
  await openWithWire(page, "live");
  // Layer 2 in the fixture is radial_waves, whose param_a/param_b are named
  // "Base freq" and "Harmonics" in PARAM_LABELS.
  const chips = page.locator(".live-layer-list button");
  const box = await chips.nth(1).boundingBox();
  if (!box) throw new Error("no chip");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();

  const card = page.locator(".layer-quick-edit");
  await expect(card).toBeVisible();
  await expect(card.locator(".slider-row", { hasText: "Base freq" })).toHaveCount(1);
  await expect(card.locator(".slider-row", { hasText: "Harmonics" })).toHaveCount(1);
  // Never the generic fallbacks: a kind with unnamed params shows no group.
  await expect(card.locator(".slider-row", { hasText: "Param " })).toHaveCount(0);
});

test("the popover stays inside the window when the layer is at its edge", async ({ page }) => {
  await openWithWire(page, "live");
  await hold(page, ".live-layer-list button");
  const card = page.locator(".layer-quick-edit");
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  const size = page.viewportSize();
  if (!box || !size) throw new Error("no geometry");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
});

test("a phone gets the sheet, not a popover", async ({ page }) => {
  await openWithWire(page, "live", 390, 844);
  await page.locator(".live-layer-list button").first().scrollIntoViewIfNeeded();
  await hold(page, ".live-layer-list button");
  await expect(page.locator(".layer-quick-edit.sheet")).toBeVisible();
});

test("Control's layer name opens the same popover on a plain tap", async ({ page }) => {
  await openWithWire(page, "control");
  const name = page.locator(".layer-fader-name").first();
  await name.scrollIntoViewIfNeeded();
  await name.click();
  await expect(page.locator(".layer-quick-edit")).toBeVisible();
});
