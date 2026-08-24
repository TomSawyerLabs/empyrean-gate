// The wheel's hue mapping is pointer maths against a CSS conic gradient: two
// independent conventions that have to agree. Getting one of them backwards
// looks completely plausible — the wheel still renders, the marker still moves,
// it just picks the wrong colour. These assert the compass points.

import { expect, test } from "@playwright/test";

/// Turns increase clockwise from the top: 0 red, 0.25 chartreuse, 0.5 cyan,
/// 0.75 violet. Compared by dominant channel rather than an exact hex so the
/// test survives a change of gradient stop count.
const COMPASS = [
  { at: "12 o'clock", fx: 0.5, fy: 0.06, expect: "r" },
  { at: "3 o'clock", fx: 0.94, fy: 0.5, expect: "g" },
  { at: "6 o'clock", fx: 0.5, fy: 0.94, expect: "b" },
] as const;

function channels(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: /custom color/i }).click();
  await page.locator(".color-wheel-disc").waitFor();
});

for (const point of COMPASS) {
  test(`the rim at ${point.at} is dominated by the ${point.expect} channel`, async ({ page }) => {
    const disc = (await page.locator(".color-wheel-disc").boundingBox())!;
    await page.mouse.click(disc.x + disc.width * point.fx, disc.y + disc.height * point.fy);

    const hex = await page.locator(".custom-color-hex input").inputValue();
    const c = channels(hex);
    const dominant = (["r", "g", "b"] as const).reduce((a, b) => (c[a] >= c[b] ? a : b));
    // 6 o'clock is cyan: green and blue tie at the top, so accept either.
    const acceptable = point.expect === "b" ? ["b", "g"] : [point.expect];
    expect(acceptable, `${point.at} picked ${hex}`).toContain(dominant);
  });
}

test("the centre is white and the rim is saturated", async ({ page }) => {
  const disc = (await page.locator(".color-wheel-disc").boundingBox())!;
  const hex = page.locator(".custom-color-hex input");

  await page.mouse.click(disc.x + disc.width / 2, disc.y + disc.height / 2);
  const middle = channels(await hex.inputValue());
  const spread = Math.max(middle.r, middle.g, middle.b) - Math.min(middle.r, middle.g, middle.b);
  expect(spread, "centre of the wheel should be unsaturated").toBeLessThanOrEqual(4);

  await page.mouse.click(disc.x + disc.width * 0.97, disc.y + disc.height / 2);
  const rim = channels(await hex.inputValue());
  const rimSpread = Math.max(rim.r, rim.g, rim.b) - Math.min(rim.r, rim.g, rim.b);
  expect(rimSpread, "rim of the wheel should be saturated").toBeGreaterThan(150);
});

test("the complement chip is 180 degrees away and is selectable", async ({ page }) => {
  const hex = page.locator(".custom-color-hex input");
  const before = channels(await hex.inputValue());

  await page.getByRole("button", { name: /Jump to the complement/ }).click();
  const after = channels(await hex.inputValue());

  // Complementary colours swap which side of the spectrum dominates; comparing
  // the red channel against the green+blue mean catches a no-op or a wrong turn.
  const beforeWarm = before.r - (before.g + before.b) / 2;
  const afterWarm = after.r - (after.g + after.b) / 2;
  expect(Math.sign(beforeWarm)).not.toBe(Math.sign(afterWarm));
});
