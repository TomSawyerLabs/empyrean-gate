// The secret DOOM page (plans/doom.md) against the mock backend: the start
// screen, the controller's held keys, the keyboard, who-has-the-controls, and
// the typed code that gets the Gate machine's window there.

import { expect, test, type Page } from "@playwright/test";

const DOOM_STATUS = {
  health: 100,
  armor: 0,
  ammo: 50,
  max_ammo: 200,
  weapon: "Pistol",
  kills: 0,
  total_kills: 23,
  map: "E1M1",
  playing: true,
  menu: false,
  idle_secs: 0,
  frames: 120,
  controller_id: null as string | null,
  controller: null as string | null,
  turn: 0,
  mirror: false,
};

function gameStatus(doom: typeof DOOM_STATUS) {
  return {
    active: "doom",
    summary: "DOOM · E1M1 · 100 % · 0 kills · 1 min",
    species: 3,
    effects_overlay: false,
    blocked_by_show: null,
    doom,
    ended: null,
  };
}

async function wire(page: Page, clientId: string) {
  const sent: string[] = [];
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), clientId);
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") sent.push(frame.payload);
    }),
  );
  return sent;
}

test("the start screen starts DOOM at the chosen skill", async ({ page }) => {
  const sent = await wire(page, `doom-start-${Date.now()}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#doom");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".doom-start")).toBeVisible();
  await page.getByRole("radio", { name: /Ultra-Violence/ }).click();
  await page.getByRole("button", { name: "Rip and tear" }).click();
  await expect
    .poll(() => sent.find((m) => m.includes('"set_game_mode"')))
    .toContain('"game":"doom"');
  expect(sent.find((m) => m.includes('"set_game_mode"'))).toContain('"species":4');
  // The page that starts DOOM owns the controls from the first frame.
  expect(sent.find((m) => m.includes('"set_game_mode"'))).toContain('"claim":true');
});

test("pad buttons hold keys down and let go, and the keyboard works too", async ({ page }) => {
  const clientId = `doom-pad-${Date.now()}`;
  const sent = await wire(page, clientId);
  await page.request.post(`/mock/status?client=${clientId}`, {
    data: { game: gameStatus({ ...DOOM_STATUS, controller_id: clientId, controller: "Dusty Badger" }) },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#doom");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  // HUD from status, and the page knows it holds the controls.
  await expect(page.locator(".doom-hud")).toContainText("100");
  await expect(page.locator(".doom-hud")).toContainText("E1M1");
  await expect(page.locator(".doom-who")).toHaveText("You have the controls.");
  // Holding the controls with Run on asserts the sticky Run key at once.
  await expect.poll(() => sent.some((m) => m.includes('"game_key"') && m.includes('"run"') && m.includes('"down":true'))).toBe(true);

  const fire = page.getByRole("button", { name: "Fire" });
  const box = (await fire.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => sent.filter((m) => m.includes('"fire"')).length).toBe(1);
  expect(sent.find((m) => m.includes('"fire"'))).toContain('"down":true');
  // Run went down before the first real key, never a second time.
  const runIndex = sent.findIndex((m) => m.includes('"key":"run"'));
  const fireIndex = sent.findIndex((m) => m.includes('"key":"fire"'));
  expect(runIndex).toBeLessThan(fireIndex);
  expect(sent.filter((m) => m.includes('"key":"run"') && m.includes('"down":true')).length).toBe(1);
  await page.mouse.up();
  await expect.poll(() => sent.filter((m) => m.includes('"fire"')).length).toBe(2);
  expect(sent.filter((m) => m.includes('"fire"'))[1]).toContain('"down":false');

  await page.keyboard.down("ArrowUp");
  await expect.poll(() => sent.some((m) => m.includes('"key":"up"') && m.includes('"down":true'))).toBe(true);
  await page.keyboard.up("ArrowUp");
  await expect.poll(() => sent.some((m) => m.includes('"key":"up"') && m.includes('"down":false'))).toBe(true);

  // Every pad key is finger-sized.
  for (const button of await page.locator(".doom-pad .doom-key").all()) {
    const b = await button.boundingBox();
    expect(b?.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole("button", { name: "Quit DOOM" }).click();
  await expect.poll(() => sent.some((m) => m.includes('"set_game_mode"') && m.includes('"game":null'))).toBe(true);
});

test("another phone's controls are shown as taken and the pad is disabled", async ({ page }) => {
  const clientId = `doom-taken-${Date.now()}`;
  const sent = await wire(page, clientId);
  await page.request.post(`/mock/status?client=${clientId}`, {
    data: { game: gameStatus({ ...DOOM_STATUS, controller_id: "someone-else", controller: "Sonic Tumbleweed" }) },
  });
  await page.goto("/#doom");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".doom-who")).toHaveText("Sonic Tumbleweed has the controls.");
  await expect(page.getByRole("button", { name: "Fire" })).toBeDisabled();
  await page.waitForTimeout(200);
  expect(sent.some((m) => m.includes('"game_key"'))).toBe(false);
});

test("typing the secret code anywhere lands on the DOOM page", async ({ page }) => {
  await wire(page, `doom-code-${Date.now()}`);
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.keyboard.type("doom");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#doom");
  await expect(page.locator(".doom-start")).toBeVisible();
});

test("the game banner's play button goes to the DOOM page while DOOM runs", async ({ page }) => {
  const clientId = `doom-banner-${Date.now()}`;
  await wire(page, clientId);
  await page.request.post(`/mock/status?client=${clientId}`, {
    data: { game: gameStatus(DOOM_STATUS) },
  });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.locator(".game-banner-play").click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#doom");
  await expect(page.locator(".doom-pad")).toBeVisible();
});
