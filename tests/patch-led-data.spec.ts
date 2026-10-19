// LED data and the plane (asked for 2026-10-18: "we need a distinction between
// a data type that matches the shape of our display, and one that matches
// things as mapped to a 2d grid"). LED data shows as a dotted wire and square
// ports; while it is dragged, an input that would read it between the LEDs
// (Transform's `in`) won't take it, and Resample, which turns it into the
// plane, will. The rule itself is unit-tested in packages/patch-web
// (domains.test.ts) and in the patch core.

import { expect, test, type Locator, type Page } from "@playwright/test";

async function center(l: Locator) {
  const box = (await l.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press on a handle and drag to `to`, without releasing. */
async function dragFrom(page: Page, handle: Locator, to: { x: number; y: number }) {
  const at = await center(handle);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

test("LED data is drawn as such, and only Resample's way leads into Transform", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  for (const label of ["Full random field", "Resample", "Transform"]) {
    await page.locator(".patch-palette .palette-item", { hasText: label }).click();
  }
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await page.getByRole("button", { name: "⇆ Arrange" }).click();
  await page.waitForTimeout(500);

  const nodeOf = (label: string) => page.locator(".pnode", { hasText: label });
  const snowOut = nodeOf("Full random field").locator(".pnode-port.out .port-dot");
  const resampleIn = nodeOf("Resample").locator(".pnode-port.in .port-dot");
  const resampleOut = nodeOf("Resample").locator(".pnode-port.out .port-dot");
  const transformIn = nodeOf("Transform").locator(".pnode-port.in .port-dot");
  await expect(snowOut).toHaveClass(/shape-led_scalar/);

  // Dragged, LED data fits Resample but not Transform; dropped on Transform,
  // no wire.
  await dragFrom(page, snowOut, await center(transformIn));
  await expect(nodeOf("Transform").locator(".pnode-port.in.port-nofit")).toHaveCount(1);
  await expect(nodeOf("Resample").locator(".pnode-port.in.port-fit")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // Into Resample: a dotted LED wire. Out of it: the plane, which Transform takes.
  await dragFrom(page, snowOut, await center(resampleIn));
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge.shape-led_scalar")).toHaveCount(1);
  await dragFrom(page, resampleOut, await center(transformIn));
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  // Resample hands Transform a plane colour field (the starter's Noise wire
  // is a grey one).
  await expect(page.locator(".react-flow__edge.shape-field_color")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.shape-led_scalar")).toHaveCount(1);
});
