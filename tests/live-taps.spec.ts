// Debug taps on Live (plans/debug-node.md): a patch's Debug nodes whose Show on
// Live is on arrive in status as `patch_taps`, and Live shows a mini of each,
// a ring for a picture and a meter for a number or an event. None flagged, no
// cluster at all. Which nodes are flagged is the crate's business
// (codegen::live_taps, unit-tested in Rust); the mock just serves a status.

import { expect, test, type Page } from "@playwright/test";

async function openLiveAs(page: Page, id: string, patch_taps: unknown[]) {
  await page.addInitScript((v) => localStorage.setItem("empyrean-client-id", v), id);
  await page.request.post(`/mock/status?client=${id}`, { data: { patch_active: patch_taps.length > 0, patch_taps } });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
}

test("Live shows the patch's flagged Debug taps", async ({ page }) => {
  await openLiveAs(page, "taps-shown", [
    { id: "glow", label: "Glow", shape: "field_color" },
    { id: "sub/level", label: "Level", shape: "scalar" },
    { id: "kick", label: "Kick", shape: "event" },
  ]);
  const taps = page.getByLabel("Debug taps");
  await expect(taps).toBeVisible();
  await expect(taps.getByRole("img", { name: "Glow preview" })).toBeVisible();
  await expect(taps.locator(".live-tap", { hasText: "Glow" })).toBeVisible();
  await expect(taps.locator(".mini-meter")).toHaveCount(2);
  await expect(taps.locator(".mini-event")).toContainText("Kick");
  await expect(taps.locator(".mini-meter").first()).toContainText("Level");
});

test("Live shows nothing for taps while none are flagged", async ({ page }) => {
  await openLiveAs(page, "taps-none", []);
  await expect(page.locator(".live-layer-list-wrap")).toBeVisible();
  await expect(page.getByLabel("Debug taps")).toHaveCount(0);
});
