import { expect, test } from "@playwright/test";

test("trackpad pinch zooms the Patch canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();

  const viewport = page.locator(".patch-canvas .react-flow__viewport");
  await viewport.waitFor();
  const zoom = () =>
    viewport.evaluate((element) =>
      new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
    );
  const initialZoom = await zoom();

  const pane = page.locator(".patch-canvas .react-flow__pane");
  await pane.evaluate((element) => {
    element.addEventListener(
      "wheel",
      (event) => {
        element.setAttribute(
          "data-prevented-before-patch-handler",
          String(event.defaultPrevented),
        );
      },
      { capture: true, once: true },
    );
  });
  await pane.dispatchEvent("wheel", {
    deltaY: 80,
    ctrlKey: true,
    clientX: 700,
    clientY: 450,
  });

  await expect(pane).toHaveAttribute("data-prevented-before-patch-handler", "false");
  await expect.poll(zoom).toBeLessThan(initialZoom);
  const zoomedOut = await zoom();

  await pane.dispatchEvent("wheel", {
    deltaY: -80,
    ctrlKey: true,
    clientX: 700,
    clientY: 450,
  });

  await expect.poll(zoom).toBeGreaterThan(zoomedOut);
});
