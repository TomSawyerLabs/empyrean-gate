// The palette (asked for 2026-10-18: "list of node types needs an overhaul.
// it's too long"): purpose groups that fold away and stay folded, a filter
// with keyboard, a Recent row, the hovered kind described at the foot, drag
// onto the canvas, and an icon on every node.

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);
  return page.locator(".patch-palette");
}

test("kinds are grouped by purpose, and a folded group stays folded", async ({ page }) => {
  const palette = await open(page);
  const heads = palette.locator(".palette-group-label");
  // The mock registry's kinds, in palette order (Sub-patches last).
  await expect(heads).toHaveText(["Live input", "Media", "Patterns", "Color & space", "Structure", "Sub-patches"]);

  const patterns = palette.locator(".palette-group-patterns");
  await expect(patterns.locator(".palette-grid-item")).toHaveCount(2);
  await patterns.getByRole("button", { name: /Patterns/ }).click();
  await expect(patterns.getByRole("button", { name: /Patterns/ })).toHaveAttribute("aria-expanded", "false");
  await expect(patterns.locator(".palette-item")).toHaveCount(0);

  await page.reload();
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".palette-group-patterns .palette-item")).toHaveCount(0);
});

test("the filter finds kinds by name, Enter adds the best, and it joins Recent", async ({ page }) => {
  const palette = await open(page);
  // `/` from the canvas focuses the filter.
  await page.locator(".patch-canvas").click({ position: { x: 20, y: 400 } });
  await page.keyboard.press("/");
  const filter = palette.getByRole("searchbox", { name: "Find a node" });
  await expect(filter).toBeFocused();

  await page.keyboard.type("plas");
  const results = palette.locator(".palette-results .palette-item");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("Plasma");
  await expect(results.first()).toContainText("Patterns");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pnode", { hasText: "Plasma" })).toHaveCount(1);

  // Words match descriptions too, and Escape clears.
  await filter.fill("stroke");
  await expect(results.first()).toContainText("Touch strokes");
  await filter.press("Escape");
  await expect(filter).toHaveValue("");
  await expect(palette.locator(".palette-recent .palette-chip")).toHaveText(["Plasma"]);
});

test("arrows walk the list and Enter adds the focused kind", async ({ page }) => {
  const palette = await open(page);
  const filter = palette.getByRole("searchbox", { name: "Find a node" });
  await filter.fill("e");
  await filter.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const focused = palette.locator(".palette-item:focus");
  const label = (await focused.locator(".palette-item-label").textContent())!;
  await page.keyboard.press("Enter");
  await expect(page.locator(".pnode", { hasText: label })).not.toHaveCount(0);
});

test("the foot describes the hovered kind", async ({ page }) => {
  const palette = await open(page);
  await palette.locator(".palette-item", { hasText: "Field math" }).hover();
  await expect(palette.locator(".palette-details")).toContainText("Field math");
  await expect(palette.locator(".palette-details")).toContainText("Color & space");
});

test("a kind dragged onto the canvas lands where it is dropped", async ({ page }) => {
  const palette = await open(page);
  const canvas = page.locator(".patch-canvas");
  const box = (await canvas.boundingBox())!;
  await palette.locator(".palette-item", { hasText: "Field math" }).dragTo(canvas, {
    targetPosition: { x: box.width - 120, y: box.height - 120 },
  });
  const node = page.locator(".pnode", { hasText: "Field math" });
  await expect(node).toHaveCount(1);
  const at = (await node.boundingBox())!;
  // Its top-left corner is at the drop point (give or take the zoom).
  expect(Math.abs(at.x - (box.x + box.width - 120))).toBeLessThan(40);
  expect(Math.abs(at.y - (box.y + box.height - 120))).toBeLessThan(40);
});

test("every node and listed kind carries its kind's icon", async ({ page }) => {
  const palette = await open(page);
  // (Grid tiles show the kind's thumbnail instead, where there is one.)
  const entries = palette.locator(".palette-rows .palette-item");
  expect(await entries.count()).toBeGreaterThan(5);
  await expect(entries.locator("svg.node-icon")).toHaveCount(await entries.count());
  await expect(page.locator(".pnode .pnode-title svg.node-icon")).toHaveCount(2);
});
