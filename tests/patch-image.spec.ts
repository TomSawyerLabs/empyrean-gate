// Each Still image node carries its own picture, chosen in its side panel and
// stored in the patch (reported 2026-10-15: they shared one global image).

import { expect, test } from "@playwright/test";

// A 2×2 red PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=",
  "base64",
);

test("a Still image node gets its own picture from its side panel", async ({ page }) => {
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
  await page.locator(".palette-item", { hasText: "Still image in" }).click();
  const node = page.locator(".pnode", { hasText: "Still image in" });
  await expect(node).toContainText("no image");
  await node.click();

  await page.locator(".patch-image input[type=file]").setInputFiles({
    name: "red.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  // Shown on the node and in the panel, and saved inside the patch.
  await expect(node.locator(".pnode-image img")).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator(".patch-image-preview")).toBeVisible();
  await expect
    .poll(() => sent.some((m) => m.includes('"patch_save"') && m.includes('"media":"data:image/')))
    .toBe(true);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(node).toContainText("no image");
});
