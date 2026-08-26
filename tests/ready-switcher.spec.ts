import { expect, test } from "@playwright/test";

async function openReadyWithWire(page: import("@playwright/test").Page) {
  const sent: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string") sent.push(frame.payload);
  }));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#ready");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  return {
    sent,
    prepares: () => sent.filter((message) => message.includes('"prepare_stack"')),
  };
}

test("a scene can be prepared off air and taken to Program", async ({ page, request }) => {
  await request.post("/mock/reset-config");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#ready");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".bus-card.program")).toContainText("Original Gate");
  await expect(page.locator(".bus-card.ready")).toContainText("No scene loaded");
  await expect(page.locator(".take-button")).toBeDisabled();

  await page.locator(".scene-tray-grid").getByRole("button", { name: /Warm Windstorm/ }).click();
  await expect(page.locator(".bus-card.ready")).toContainText("Warm Windstorm");
  await expect(page.locator(".bus-card.ready canvas")).toBeVisible();
  await expect(page.locator(".take-button")).toBeEnabled();

  await page.locator(".take-button").click();
  await expect(page.locator(".bus-card.program")).toContainText("Warm Windstorm");
  await expect(page.locator(".bus-card.ready")).toContainText("Previous program");
});

test("the phone layout keeps both buses and Take reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#ready");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".bus-card.program")).toBeVisible();
  await expect(page.locator(".take-button")).toBeVisible();
  await expect(page.locator(".bus-card.ready")).toBeVisible();
});

test("Ready exposes complete master and layer tuning without touching Program", async ({ page, request }) => {
  await request.post("/mock/reset-config");
  const wire = await openReadyWithWire(page);
  await page.locator(".scene-tray-grid").getByRole("button", { name: /Warm Windstorm/ }).click();

  const master = page.locator(".ready-master-grid section", { hasText: "Master" });
  await expect(master.locator(".slider-row", { hasText: "Brightness" })).toBeVisible();
  await master.locator(".slider-row", { hasText: "Brightness" }).locator("input").fill("0.42");
  await expect.poll(() => wire.prepares().at(-1) ?? "").toContain('"master_brightness":0.42');

  const fire = page.locator(".ready-layer-editor").nth(1);
  await fire.locator("summary").click();
  await expect(fire.locator(".slider-row", { hasText: "Flame reach" })).toBeVisible();
  await expect(fire.locator(".slider-row", { hasText: "Brightness" })).toBeVisible();
  await fire.locator(".slider-row", { hasText: "Flame reach" }).locator("input").fill("0.31");
  await expect.poll(() => wire.prepares().at(-1) ?? "").toContain('"param_a":0.31');

  expect(wire.sent.some((message) => message.includes('"take_ready"'))).toBe(false);
});
