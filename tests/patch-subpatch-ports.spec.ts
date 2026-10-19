// A Sub-patch's typed ports (asked for 2026-10-18: "sub-patches could not
// have outputs and just be more complicated intermediate things"; design
// approved 2026-10-19). A Patch in inside a patch is an input of its
// Sub-patch node and a Patch out an output, labelled by name; a block with
// Patch outs and no Output has no `out`. Dropping a wire on empty canvas
// offers a Patch out shaped to it. The rules themselves are tested in the
// patch core (flatten.rs) and in patch-web (subpatch-ports.test.ts).

import { expect, test, type Locator, type Page } from "@playwright/test";

async function center(l: Locator) {
  const box = (await l.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function newPatch(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);
}

test("a block's Patch in and Patch out are its Sub-patch's ports, and take wires", async ({ page }) => {
  await newPatch(page);
  await page.locator(".palette-sub", { hasText: "Mock Pass" }).click();
  const sub = page.locator(".pnode", { hasText: "Sub-patch" });
  await expect(sub.locator(".pnode-port.in")).toHaveText(["Picture"]);
  await expect(sub.locator(".pnode-port.out")).toHaveText(["Same"]);
  await expect(sub.locator(".pnode-port.out .port-dot")).toHaveClass(/shape-field_color/);

  // Noise (a grey field) into the colour inlet: the greyscale adapter.
  await page.getByRole("button", { name: "⇆ Arrange" }).click();
  await page.waitForTimeout(500);
  const noiseOut = page.locator(".pnode", { hasText: "Noise" }).locator(".pnode-port.out .port-dot");
  const from = await center(noiseOut);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await center(sub.locator(".pnode-port.in .port-dot"));
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("a wire dropped on empty canvas offers a Patch out shaped to it", async ({ page }) => {
  await newPatch(page);
  const noiseOut = page.locator(".pnode", { hasText: "Noise" }).locator(".pnode-port.out .port-dot");
  const from = await center(noiseOut);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(760, 300, { steps: 8 });
  await page.mouse.up();
  const chooser = page.getByRole("dialog", { name: /Send out/ });
  await chooser.getByRole("button", { name: /^Patch out/ }).click();
  const out = page.locator(".pnode", { hasText: "Patch out" });
  // Inside the patch a Patch out shows only its `in`, grey like the wire.
  await expect(out.locator(".pnode-port.in .port-dot")).toHaveClass(/shape-field_scalar/);
  await expect(out.locator(".pnode-port.out")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});
