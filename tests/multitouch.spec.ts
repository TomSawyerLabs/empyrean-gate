// A second finger must work while the first is busy. Browsers only synthesize
// `click` for the PRIMARY pointer, so a swatch tapped with a second finger
// while the first is drawing on the array used to be silently ignored — the
// colour never changed mid-stroke. The drag router now fires such pads on
// release itself, and must not double-fire when a browser does send the click.

import { expect, test } from "@playwright/test";

type Init = { pointerId: number; isPrimary: boolean; x: number; y: number };

/** Dispatch a full press/release for one pointer straight at the element under
 *  (x, y), the way a touch contact reaches the page. `isPrimary: false` is
 *  what a second finger looks like while another is held. */
async function press(page: import("@playwright/test").Page, init: Init) {
  await page.evaluate(({ pointerId, isPrimary, x, y }) => {
    const target = document.elementFromPoint(x, y)!;
    const ev = (type: string) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "touch",
        isPrimary,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      });
    target.dispatchEvent(ev("pointerdown"));
    target.dispatchEvent(ev("pointerup"));
  }, init);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
});

test("a second (non-primary) finger can pick a colour", async ({ page }) => {
  const swatches = page.locator(".live-side .swatches .swatch:not(.custom-color-button)");
  const target = swatches.nth(3);
  await expect(target).not.toHaveClass(/active/);
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // First finger is down on the array (primary, captured by the canvas).
  const canvas = (await page.locator(".live-canvas-wrap canvas").first().boundingBox())!;
  await page.evaluate(
    ({ x, y }) => {
      document.elementFromPoint(x, y)!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
        }),
      );
    },
    { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height * 0.3 },
  );

  // Second finger taps a swatch: no native click will follow.
  await press(page, { pointerId: 2, isPrimary: false, x, y });
  await expect(target).toHaveClass(/active/);
});

test("a synthesized fire swallows the browser's duplicate click", async ({ page }) => {
  // Count how often the burst pad fires; pads are data-drag-fire too, and a
  // double fire there would be two effects on the rig.
  const pad = page.locator(".live-side .effect-btn").first();
  await pad.waitFor();
  const box = (await pad.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(() => {
    (window as unknown as { __clicks: number }).__clicks = 0;
    document.addEventListener("click", (e) => {
      if ((e.target as Element).closest("[data-drag-fire]")) {
        (window as unknown as { __clicks: number }).__clicks += 1;
      }
    });
  });
  await press(page, { pointerId: 7, isPrimary: false, x, y });
  // A browser that does dispatch click for a non-primary pointer follows up
  // with one here; the router must absorb it.
  await page.evaluate(({ x, y }) => {
    document.elementFromPoint(x, y)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  }, { x, y });
  const clicks = await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks);
  expect(clicks).toBe(1);
});
