// A Clip node turns a video or an animated image into a sprite sheet stored
// in the patch, from its side panel.

import { expect, test } from "@playwright/test";

// A 1×1 GIF with two frames (black, then white), 10 ms apart.
const frame = (color: number, delay: number) => [
  0x21, 0xf9, 0x04, 0x00, delay, 0x00, 0x00, 0x00, // graphic control
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor
  0x02, 0x02, color === 0 ? 0x44 : 0x4c, 0x01, 0x00, // LZW: one pixel of colour index 0 or 1
];
const GIF = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, // 1×1, global colour table of 2
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff, // black, white
  ...frame(0, 1),
  ...frame(1, 1),
  0x3b,
]);

test("a Clip node gets its frames from a GIF in its side panel", async ({ page }) => {
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
  await page.locator(".palette-item", { hasText: "Clip" }).click();
  const node = page.locator(".pnode", { hasText: "Clip" });
  await expect(node).toContainText("no clip");
  await node.click();

  await page.locator(".patch-clip input[type=file]").setInputFiles({
    name: "blink.gif",
    mimeType: "image/gif",
    buffer: GIF,
  });
  await expect(node.locator(".pnode-image img")).toHaveAttribute("src", /^data:image\//);
  // Both frames land in the default 4×4 sheet, and the patch carries it.
  await expect(page.locator(".patch-clip")).toContainText("2 frames in a 4×4 sheet");
  await expect
    .poll(() =>
      sent.some(
        (m) => m.includes('"patch_save"') && m.includes('"kind":"clip"') && m.includes('"frames":2'),
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(node).toContainText("no clip");
});
