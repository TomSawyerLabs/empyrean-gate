import { expect, test, type Page } from "@playwright/test";
import { liveColor } from "../src/liveColors";

async function openSettingsWithWire(page: Page) {
  const sent: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string") sent.push(frame.payload);
  }));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#settings");
  await expect(page.locator('.app[data-connected="yes"]')).toBeAttached();
  await page.getByLabel("Timing source").selectOption("pro_dj_link");
  await expect(page.locator(".dj-event-effects-disclosure")).toBeVisible();
  return sent;
}

function lastConfig(sent: string[]) {
  const message = sent
    .filter((frame) => frame.includes('"type":"set_config"'))
    .map((frame) => JSON.parse(frame))
    .at(-1);
  return message?.config;
}

test("DJ LINK diagnostics and event configuration stay collapsed until requested", async ({ page }) => {
  await openSettingsWithWire(page);
  const effects = page.locator(".dj-event-effects-disclosure");
  const inspector = page.locator(".dj-link-debug-panel");

  await expect(effects).not.toHaveAttribute("open", "");
  await expect(inspector).not.toHaveAttribute("open", "");
  await expect(effects.locator(".dj-event-effect-row").first()).not.toBeVisible();
  await expect(inspector.locator(".dj-link-debug-stream")).not.toBeVisible();

  await effects.locator(":scope > summary").click();
  await expect(effects).toHaveAttribute("open", "");
  await expect(effects.locator(".dj-event-effect-row")).toHaveCount(11);

  await inspector.locator(":scope > summary").click();
  await expect(inspector).toHaveAttribute("open", "");
  await expect(inspector.locator(".dj-link-debug-stream")).toBeVisible();
});

test("a DJ LINK event can use an exact fixed color and return to its deck color", async ({ page }) => {
  const sent = await openSettingsWithWire(page);
  const effects = page.locator(".dj-event-effects-disclosure");
  await effects.locator(":scope > summary").click();

  const picker = page.getByLabel("Choose Play effect 1 color (currently deck color)");
  const expected = liveColor("test", "Test", "#12ab34");
  await picker.fill(expected.hex);

  await expect.poll(() => lastConfig(sent)?.rhythm?.pro_dj_link_effects?.play?.[0]?.hue)
    .toBeCloseTo(expected.hue, 5);
  expect(lastConfig(sent).rhythm.pro_dj_link_effects.play[0].saturation)
    .toBeCloseTo(expected.saturation, 5);
  expect(lastConfig(sent).rhythm.pro_dj_link_effects.play[0].brightness)
    .toBeCloseTo(expected.brightness, 5);

  await page.getByRole("button", { name: "Use deck color for Play effect 1" }).click();
  await expect.poll(() => lastConfig(sent)?.rhythm?.pro_dj_link_effects?.play?.[0]?.hue)
    .toBe(-1);
  await expect(page.getByRole("button", { name: "Using deck color for Play effect 1" }))
    .toHaveAttribute("aria-pressed", "true");
});

test("the expanded event controls stay usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettingsWithWire(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const effects = page.locator(".dj-event-effects-disclosure");
  await effects.locator(":scope > summary").click();

  await expect(page.getByRole("button", { name: "Remove Play effect 1" })).toBeVisible();
  const overflow = await effects.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});
