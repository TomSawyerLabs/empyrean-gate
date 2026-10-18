// Connection hints (asked for 2026-10-17): while a wire is dragged, ports
// that would take it glow and the rest dim; dropped on empty canvas, a
// "connect to…" chooser lists what could sit there, best guess first, and a
// pick adds that node already wired. The ranking is unit-tested in
// packages/patch-web (connect.test.ts); this covers the canvas.

import { expect, test, type Page } from "@playwright/test";

async function newPatch(page: Page) {
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
}

/** Press on a handle and drag to `to` (page pixels), without releasing. */
async function dragWire(page: Page, handle: ReturnType<Page["locator"]>, to: { x: number; y: number }) {
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

test("ports show whether they fit while a wire is dragged", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await newPatch(page);
  // From Output's `in` (a colour field): Noise's `out` fits (grey field, via
  // the adapter); Output's own ports never light for their own wire.
  const outputIn = page.locator(".pnode", { hasText: "Output" }).locator(".pnode-port.in .port-dot");
  await dragWire(page, outputIn, { x: 700, y: 700 });
  await expect(page.locator(".pnode", { hasText: "Noise" }).locator(".pnode-port.out.port-fit")).toHaveCount(1);
  await expect(page.locator(".pnode", { hasText: "Output" }).locator(".pnode-port.port-nofit")).toHaveCount(1);
  await page.mouse.up();
  // Released on empty canvas: the chooser; Escape dismisses it, no node added.
  const chooser = page.getByRole("dialog", { name: /Feed in/ });
  await expect(chooser).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chooser).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".pnode-port.port-fit, .pnode-port.port-nofit")).toHaveCount(0);
});

test("dropping a wire on empty canvas offers what fits, and a pick adds it wired", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await newPatch(page);
  const noiseOut = page.locator(".pnode", { hasText: "Noise" }).locator(".pnode-port.out .port-dot");
  await dragWire(page, noiseOut, { x: 760, y: 300 });
  await page.mouse.up();
  const chooser = page.getByRole("dialog", { name: /Send out/ });
  await expect(chooser).toBeVisible();
  // Noise makes a grey field: Output (colour, via the adapter) is on offer,
  // a Still image in (no inputs that take a field) is not.
  await expect(chooser.getByRole("button", { name: /^Output/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /Still image/ })).toHaveCount(0);
  // The filter box narrows the list.
  await chooser.getByLabel("Filter node types").fill("outp");
  await expect(chooser.locator(".palette-item")).toHaveCount(1);
  await chooser.getByRole("button", { name: /^Output/ }).click();
  await expect(chooser).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  // One undo step takes both the node and its wire back.
  await page.getByRole("button", { name: "↶ Undo" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("ports carry their shape in their accessible name", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await newPatch(page);
  await expect(
    page.locator(".pnode", { hasText: "Output" }).locator(".pnode-port.in"),
  ).toHaveAttribute("aria-label", /^in · field \((grey|colour)\) in$/);
});
