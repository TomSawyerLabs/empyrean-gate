import { expect, test } from "@playwright/test";

test("Ringfall exposes complete touch controls and sends immediate commands", async ({ page }) => {
  const clientId = `ringfall-${Date.now()}`;
  const sent: string[] = [];
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), clientId);
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string") sent.push(frame.payload);
  }));
  await page.request.post(`/mock/status?client=${clientId}`, {
    data: {
      game: {
        active: "radial_tetris",
        summary: "Ringfall · Dot falling · Domino next · 3 rings",
        species: 6,
        effects_overlay: false,
        blocked_by_show: null,
      },
    },
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#games");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  const card = page.locator(".games-card", { hasText: "Ringfall" });
  await expect(card).toHaveClass(/active/);
  await expect(card.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByText("Frequent gap fillers")).toBeVisible();

  const controls = page.getByRole("group", { name: "Ringfall controls" });
  await expect(controls.getByRole("button")).toHaveCount(5);
  await controls.getByRole("button", { name: /Rotate piece/ }).click();
  await expect.poll(() => sent.some((message) =>
    message.includes('"game_command"') && message.includes('"rotate_clockwise"'),
  )).toBe(true);

  for (const button of await controls.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }
});

test("Ringfall keyboard controls map to move, rotate, and drop commands", async ({ page }) => {
  const clientId = `ringfall-keys-${Date.now()}`;
  const sent: string[] = [];
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), clientId);
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string") sent.push(frame.payload);
  }));
  await page.request.post(`/mock/status?client=${clientId}`, {
    data: { game: { active: "radial_tetris", summary: "Ringfall", species: 4, effects_overlay: false, blocked_by_show: null } },
  });
  await page.goto("/#games");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect.poll(() => sent.filter((message) => message.includes('"game_command"')).length).toBeGreaterThanOrEqual(3);
  expect(sent.some((message) => message.includes('"move_counter_clockwise"'))).toBe(true);
  expect(sent.some((message) => message.includes('"rotate_clockwise"'))).toBe(true);
  expect(sent.some((message) => message.includes('"hard_drop"'))).toBe(true);
});
