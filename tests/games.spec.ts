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
        from_floor: false,
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

  const canvas = page.locator(".ringfall-canvas-wrap canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.85, box!.y + box!.height * 0.5);
  await controls.getByRole("button", { name: /Hard drop/ }).click();
  await expect.poll(() => sent.some((message) => message.includes('"game_input"'))).toBe(true);
  await expect.poll(() => sent.some((message) => message.includes('"hard_drop"'))).toBe(true);
  const aimIndex = sent.findIndex((message) => message.includes('"game_input"'));
  const dropIndex = sent.findIndex((message) => message.includes('"hard_drop"'));
  expect(aimIndex).toBeLessThan(dropIndex);

  await controls.getByRole("button", { name: /Rotate piece/ }).click();
  await expect.poll(() => sent.some((message) =>
    message.includes('"game_command"') && message.includes('"rotate_clockwise"'),
  )).toBe(true);

  for (const button of await controls.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }
});

test("the Games tab keeps hidden games under a key-holders label, startable by the operator", async ({ page }) => {
  const sent: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string") sent.push(frame.payload);
  }));
  await page.goto("/#games");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  const card = page.locator(".games-card.hidden-game", { hasText: "Perimeter" });
  await expect(card).toBeVisible();
  await expect(card.locator(".games-hidden-badge")).toContainText("key holders");
  await expect(page.locator(".games-hidden-label")).toContainText("Secret keys");
  // Open games come first, then the hidden ones; the DOOM easter egg's card
  // (plans/doom.md) trails them all, deeper still.
  await expect(page.locator(".games-card.hidden-game")).toHaveCount(2);
  await expect(page.locator(".games-card.hidden-game").last()).toContainText("Gathering");
  await expect(page.locator(".games-card").last()).toContainText("DOOM");
  await expect(page.locator(".games-card.hidden-game", { hasText: "Gathering" }).locator(".games-hidden-badge")).toContainText("key holders");
  await card.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => sent.some((m) => m.includes('"set_game_mode"') && m.includes('"perimeter"'))).toBe(true);
  // And it opens with its own truck count.
  await expect.poll(() => sent.some((m) => m.includes('"set_game_config"') && m.includes('"species":5'))).toBe(true);
});

test("Ringfall keyboard controls map to move, rotate, and drop commands", async ({ page }) => {
  const clientId = `ringfall-keys-${Date.now()}`;
  const sent: string[] = [];
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), clientId);
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string") sent.push(frame.payload);
  }));
  await page.request.post(`/mock/status?client=${clientId}`, {
    data: { game: { active: "radial_tetris", summary: "Ringfall", species: 4, effects_overlay: false, from_floor: false, blocked_by_show: null } },
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

// The classic-games set (plans/classic-games.md).

test("the five classics each have an open card that starts with its own count", async ({ page }) => {
  const sent: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string") sent.push(frame.payload);
  }));
  await page.goto("/#games");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  for (const name of ["Rimfire", "Echo", "Spacewar", "Trails", "Rally"]) {
    const card = page.locator(".games-card:not(.hidden-game)", { hasText: name });
    await expect(card, name).toBeVisible();
    await expect(card.getByRole("button", { name: "Start" })).toBeVisible();
  }
  await page.locator(".games-card", { hasText: "Rimfire" }).getByRole("button", { name: "Start" }).click();
  await expect.poll(() => sent.some((m) => m.includes('"set_game_mode"') && m.includes('"rimfire"'))).toBe(true);
  await expect.poll(() => sent.some((m) => m.includes('"set_game_config"') && m.includes('"species":4'))).toBe(true);
});

test("Spacewar's buttons act for the chosen color, by touch and by keyboard", async ({ page }) => {
  const clientId = `spacewar-${Date.now()}`;
  const sent: string[] = [];
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), clientId);
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string") sent.push(frame.payload);
  }));
  await page.request.post(`/mock/status?client=${clientId}`, {
    data: { game: { active: "spacewar", summary: "no kills yet · 0 fell into the star", species: 4, effects_overlay: false, from_floor: false, blocked_by_show: null } },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#games");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".games-chip")).toHaveCount(4);
  await page.locator(".games-chip").nth(2).click();
  const controls = page.getByRole("group", { name: "Game controls" });
  await expect(controls.getByRole("button")).toHaveCount(2);
  await controls.getByRole("button", { name: "Fire" }).click();
  await expect.poll(() => sent.some((m) => m.includes('"game_command"') && m.includes('"fire"') && m.includes('"species":2'))).toBe(true);
  // One press is one torpedo: the touch-down sends it, the click doesn't again.
  expect(sent.filter((m) => m.includes('"fire"')).length).toBe(1);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("h");
  await expect.poll(() => sent.some((m) => m.includes('"hyperspace"') && m.includes('"species":2'))).toBe(true);
  for (const button of await controls.getByRole("button").all()) {
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  }
});

test("Echo is played by tapping wedges: no chips, its own join line", async ({ page }) => {
  const clientId = `echo-${Date.now()}`;
  const sent: string[] = [];
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), clientId);
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string") sent.push(frame.payload);
  }));
  await page.request.post(`/mock/status?client=${clientId}`, {
    data: { game: { active: "echo", summary: "your turn — 0 of 3 · pattern 3 · best 5", species: 4, effects_overlay: false, from_floor: false, blocked_by_show: null } },
  });
  await page.goto("/#games");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".games-chip")).toHaveCount(0);
  await expect(page.locator(".games-join")).toContainText("tap the wedges back in order");
  await expect(page.getByRole("group", { name: "Game controls" })).toHaveCount(0);
  const canvas = page.locator(".games-canvas-wrap canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3);
  await expect.poll(() => sent.some((m) => m.includes('"game_input"'))).toBe(true);
});
