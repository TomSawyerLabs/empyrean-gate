// Guards the Live control columns against the failure that shipped in v0.6.0:
// the columns reflowed into narrow auto-fit tracks, the master cluster ended up
// ~165px wide, and after a 90px "Brightness" label and a 48px readout there was
// about 10px of actual slider left. You could drag brightness to 0 and then not
// get back off it — a blackout you cannot undo, on the performance surface.
//
// The layout gate cannot catch this: nothing overflowed and nothing was clipped.
// A control can be perfectly laid out and still be unusable.

import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "ultrawide", width: 2560, height: 1080 },
  { name: "show-display-1080p", width: 1920, height: 1080 },
  { name: "desktop-default", width: 1400, height: 900 },
  { name: "window-minimum", width: 900, height: 600 },
  { name: "ipad-landscape", width: 1180, height: 820 },
];

/// Below this a slider is not a control, it is a trap. 0..1 over fewer pixels
/// than this cannot be aimed with a finger in the dark.
const MIN_USABLE_SLIDER = 88;

for (const viewport of VIEWPORTS) {
  test(`master sliders stay usable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/#live");
    await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

    const sliders = page.locator('.live-side .master-ctl input[type="range"]');
    await expect(sliders).toHaveCount(2);

    for (const index of [0, 1]) {
      const box = await sliders.nth(index).boundingBox();
      expect(box, `slider ${index} has no box`).not.toBeNull();
      expect(
        Math.round(box!.width),
        `slider ${index} at ${viewport.name} is ${Math.round(box!.width)}px wide`,
      ).toBeGreaterThanOrEqual(MIN_USABLE_SLIDER);
    }
  });
}

test("brightness can be driven to 0 and back up", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  const brightness = page.locator('.live-side .master-ctl input[type="range"]').first();
  const readout = page.locator(".live-side .master-ctl .slider-row").first().locator(".slider-val");

  // Drag to the far left, then back — the round trip is the thing that broke.
  const box = (await brightness.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, y, { steps: 8 });
  await page.mouse.up();
  await expect(readout).toHaveText("0.00");

  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, y, { steps: 8 });
  await page.mouse.up();
  await expect(readout).not.toHaveText("0.00");
});
