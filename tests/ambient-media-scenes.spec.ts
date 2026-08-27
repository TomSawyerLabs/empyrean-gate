import { expect, test } from "@playwright/test";

interface CanvasMetrics {
  width: number;
  height: number;
  litRatio: number;
  colorfulRatio: number;
  blackCenterRatio: number;
}

async function canvasMetrics(page: import("@playwright/test").Page, label: string): Promise<CanvasMetrics> {
  return page.getByLabel(label).evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("ambient preview is not a canvas");
    const context = element.getContext("2d");
    if (!context) throw new Error("ambient preview has no 2D context");
    const { width, height } = element;
    const pixels = context.getImageData(0, 0, width, height).data;
    let lit = 0;
    let colorful = 0;
    let centerBlack = 0;
    let centerCount = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const high = Math.max(r, g, b);
      const low = Math.min(r, g, b);
      if (high > 32) lit += 1;
      if (high > 50 && high - low > 28) colorful += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (Math.hypot(x - width / 2, y - height / 2) < width * 0.11) {
        centerCount += 1;
        if (high < 18) centerBlack += 1;
      }
    }
    return {
      width,
      height,
      litRatio: lit / (width * height),
      colorfulRatio: colorful / (width * height),
      blackCenterRatio: centerBlack / centerCount,
    };
  });
}

async function renderedCanvasMetrics(
  page: import("@playwright/test").Page,
  label: string,
  minimumLitRatio: number,
): Promise<CanvasMetrics> {
  await expect.poll(
    async () => (await canvasMetrics(page, label)).litRatio,
    { message: `${label} should render its first source-image frame` },
  ).toBeGreaterThan(minimumLitRatio);
  return canvasMetrics(page, label);
}

test("the ambient artwork set renders at transport resolution and keeps its visual hierarchy", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#media");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await page.getByRole("button", { name: /Entheos chromatic temple/ }).click();
  await expect(page.getByLabel("Entheos · Chromatic Temple animated preview")).toBeVisible();
  const entheos = await renderedCanvasMetrics(page, "Entheos · Chromatic Temple animated preview", 0.23);
  expect(entheos.width).toBeGreaterThanOrEqual(384);
  expect(entheos.height).toBe(entheos.width);
  await expect(page.getByRole("combobox", { name: "Texture", exact: true })).toHaveValue("128");
  expect(entheos.colorfulRatio).toBeGreaterThan(0.12);

  await page.getByRole("button", { name: /BRC night survey/ }).click();
  await expect(page.getByLabel("Black Rock City · Night Survey animated preview")).toBeVisible();
  const nightMap = await renderedCanvasMetrics(page, "Black Rock City · Night Survey animated preview", 0.14);
  expect(nightMap.colorfulRatio).toBeGreaterThan(0.06);

  await page.getByRole("button", { name: /BRC literal plan/ }).click();
  await expect(page.getByLabel("Black Rock City · Literal Plan animated preview")).toBeVisible();
  const literalMap = await renderedCanvasMetrics(page, "Black Rock City · Literal Plan animated preview", 0.16);
  expect(literalMap.colorfulRatio).toBeGreaterThan(0.08);

  await page.getByRole("button", { name: /Axis Mundi living portal/ }).click();
  await expect(page.getByLabel("Axis Mundi · Living Portal animated preview")).toBeVisible();
  const axis = await renderedCanvasMetrics(page, "Axis Mundi · Living Portal animated preview", 0.12);
  expect(axis.colorfulRatio).toBeGreaterThan(0.07);
  expect(axis.blackCenterRatio).toBeGreaterThan(0.96);
});
