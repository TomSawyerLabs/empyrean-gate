// A saved patch or a preset can be dropped into another patch as one node: a
// Sub-patch, whose inputs are the inner patch's exposed knobs.

import { expect, test } from "@playwright/test";

test("a preset inserted as a Sub-patch offers its exposed knobs as ports", async ({ page }) => {
  const sent: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      if (typeof f.payload === "string") sent.push(f.payload);
    }),
  );
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);

  // The palette lists the presets (and saved patches) under Sub-patches.
  const group = page.locator(".palette-subpatches");
  await expect(group.locator("h4")).toHaveText("Sub-patches");
  await group.locator(".palette-sub", { hasText: "Mock Noise" }).first().click();

  const node = page.locator(".pnode", { hasText: "Sub-patch" });
  await expect(node).toBeVisible();
  await expect(node).toContainText("Mock Noise · 2 nodes");
  // The inner patch exposes n1.scale: that is this node's one input port.
  await expect(node.locator(".pnode-port.in")).toHaveText(["n1.scale"]);
  await expect(node.locator(".pnode-port.out")).toHaveText(["out"]);

  // Its side panel shows that knob by its exposed label, and the save
  // carries the inner document.
  await node.click();
  const panel = page.locator(".patch-side");
  await expect(panel.locator("h3")).toHaveText("Sub-patch");
  await expect(panel.locator(".patch-param-head").filter({ hasText: "Scale" })).toBeVisible();
  await expect
    .poll(() =>
      sent.some((m) => m.includes('"patch_save"') && m.includes('"kind":"subpatch"') && m.includes('"sub":{')),
    )
    .toBe(true);
});
