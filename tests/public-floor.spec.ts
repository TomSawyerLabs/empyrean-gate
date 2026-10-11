// The public floor page: what a stranger's phone gets. It speaks the
// allowlisted half of the protocol against the mock (which answers hellos
// with `surface: "public"` using a `public_state` snapshot), so these specs
// check the page's behaviour, not the server's gates — those are Rust tests.

import { expect, test } from "@playwright/test";

function collectSent(page: import("@playwright/test").Page): string[] {
  const sent: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") sent.push(frame.payload);
    }),
  );
  return sent;
}

test("says hello as the public surface and offers only play tools", async ({ page }) => {
  const sent = collectSent(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/public.html");
  await page.locator('.public-app[data-connected="yes"]').waitFor({ state: "attached" });

  // The hello names the surface and carries a public-namespaced id.
  await expect.poll(() => sent.find((m) => m.includes('"hello"'))).toBeTruthy();
  const hello = JSON.parse(sent.find((m) => m.includes('"hello"'))!);
  expect(hello.surface).toBe("public");
  expect(hello.client_id).toMatch(/^pub-/);
  expect(Array.isArray(hello.keys)).toBe(true);

  // No operator chrome: no tabs, no settings, no roster.
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /settings/i })).toHaveCount(0);
  await expect(page.locator(".public-players")).toHaveText("7 playing");
  // The pads a stranger gets: motion effects without strobe, the six shapes
  // (the cone is a perk), the pens, and the colours.
  await expect(page.getByRole("button", { name: "Burst" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Strobe/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Heart" })).toBeVisible();
  await expect(page.locator(".public-pad.shape")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Cone" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Start / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Glow pen" })).toBeVisible();
  await expect(page.locator(".public-swatches .swatch")).toHaveCount(9);
  // The page itself never scrolls.
  const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1);
  expect(scrolls).toBe(false);
});

test("a tap fires the chosen effect where it landed; a pen drags paint", async ({ page }) => {
  const sent = collectSent(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/public.html");
  await page.locator('.public-app[data-connected="yes"]').waitFor({ state: "attached" });

  await page.getByRole("button", { name: "Bloom" }).click();
  const stage = page.locator(".public-stage canvas.gate-canvas");
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.5);
  await expect.poll(() => sent.some((m) => m.includes('"trigger_effect"') && m.includes('"bloom"'))).toBe(true);
  const effect = JSON.parse(sent.find((m) => m.includes('"trigger_effect"'))!).effect;
  expect(effect.radius).toBeGreaterThan(0.3);
  expect(effect.radius).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Glow pen" }).click();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => sent.some((m) => m.includes('"paint"') && m.includes('"glow"'))).toBe(true);
  // Nothing outside the allowlist ever goes out.
  expect(sent.some((m) => /"set_config"|"set_master"|"subscribe_mini_previews"/.test(m))).toBe(false);
});

test("a running game takes the surface: colour chips, commands, game input", async ({ page }) => {
  const sent = collectSent(page);
  const clientId = `public-game-${Date.now()}`;
  await page.addInitScript((id) => localStorage.setItem("empyrean-public-id", id), clientId);
  await page.request.post(`/mock/public?client=${clientId}`, {
    data: {
      game: { active: "radial_tetris", summary: "Ringfall · Dot falling", species: 5, effects_overlay: false, from_floor: false, blocked_by_show: null },
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/public.html");
  await page.locator('.public-app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".public-banner")).toContainText("Ringfall");
  await expect(page.locator(".games-chip")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Burst" })).toHaveCount(0);
  await page.locator(".games-chip").nth(2).click();
  const stage = page.locator(".public-stage canvas.gate-canvas");
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.5);
  await expect.poll(() => sent.some((m) => m.includes('"game_input"') && m.includes('"species":2'))).toBe(true);
  await page.getByRole("button", { name: /Hard drop/ }).click();
  await expect.poll(() => sent.some((m) => m.includes('"hard_drop"'))).toBe(true);
});

test("a key that unlocks a hidden game offers Start, then Stop once the floor's game runs", async ({ page }) => {
  const sent = collectSent(page);
  const clientId = `public-hidden-${Date.now()}`;
  await page.addInitScript((id) => localStorage.setItem("empyrean-public-id", id), clientId);
  await page.request.post(`/mock/public?client=${clientId}`, {
    data: { perks: ["game:perimeter"], unlocked: ["GPE"] },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/public.html");
  await page.locator('.public-app[data-connected="yes"]').waitFor({ state: "attached" });

  // The Start pad sits above the ordinary tools, which stay available.
  const start = page.getByRole("button", { name: /Start Perimeter/ });
  await expect(start).toBeVisible();
  await expect(page.getByRole("button", { name: "Burst" })).toBeVisible();
  await start.click();
  await expect.poll(() => sent.some((m) => m.includes('"set_game_mode"') && m.includes('"perimeter"'))).toBe(true);
  // The mock answers with the floor's own game running: chips, the
  // how-to banner, and a Stop that only the floor's game gets.
  await expect(page.locator(".public-banner")).toContainText("Perimeter");
  await expect(page.locator(".games-chip")).toHaveCount(5);
  await expect(start).toHaveCount(0);
  const stop = page.getByRole("button", { name: /Stop Perimeter/ });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect.poll(() => sent.some((m) => m.includes('"set_game_mode"') && m.includes('"game":null'))).toBe(true);
  await expect(page.getByRole("button", { name: /Start Perimeter/ })).toBeVisible();
});

test("the operator's game shows no Stop to a key holder; a show blocks Start", async ({ page }) => {
  const clientId = `public-hidden-op-${Date.now()}`;
  await page.addInitScript((id) => localStorage.setItem("empyrean-public-id", id), clientId);
  await page.request.post(`/mock/public?client=${clientId}`, {
    data: {
      perks: ["game:perimeter"],
      game: { active: "perimeter", summary: "Perimeter · 3 caught", species: 5, effects_overlay: false, from_floor: false, blocked_by_show: null },
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/public.html");
  await page.locator('.public-app[data-connected="yes"]').waitFor({ state: "attached" });
  await expect(page.locator(".games-chip")).toHaveCount(5);
  await expect(page.getByRole("button", { name: /Stop Perimeter/ })).toHaveCount(0);

  await page.request.post(`/mock/public?client=${clientId}`, {
    data: {
      game: { active: null, summary: "", species: 3, effects_overlay: false, from_floor: false, blocked_by_show: "Saturday night" },
    },
  });
  await page.reload();
  await page.locator('.public-app[data-connected="yes"]').waitFor({ state: "attached" });
  await expect(page.getByRole("button", { name: "Burst" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start Perimeter/ })).toHaveCount(0);
});

test("a closed floor folds the tools away and says so", async ({ page }) => {
  const clientId = `public-closed-${Date.now()}`;
  await page.addInitScript((id) => localStorage.setItem("empyrean-public-id", id), clientId);
  await page.request.post(`/mock/public?client=${clientId}`, {
    data: { open: false, caps: { draw: false, effects: false, games: false, knobs: false, preview: false } },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/public.html");
  await page.locator('.public-app[data-connected="yes"]').waitFor({ state: "attached" });
  await expect(page.locator(".public-banner")).toContainText("closed");
  await expect(page.locator(".public-pad")).toHaveCount(0);
  await expect(page.locator(".public-app")).toHaveClass(/closed/);
});

test("a key in the URL is kept on the phone and replayed on hello; a typed code unlocks perks", async ({ page }) => {
  const sent = collectSent(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/k/SECRET-WORD-12");
  await page.locator('.public-app[data-connected="yes"]').waitFor({ state: "attached" });
  // Out of the address bar, into storage, onto the wire.
  expect(new URL(page.url()).pathname).toBe("/");
  const stored = await page.evaluate(() => localStorage.getItem("empyrean-public-keys"));
  expect(JSON.parse(stored!)).toEqual(["SECRET-WORD-12"]);
  const hello = JSON.parse(sent.find((m) => m.includes('"hello"'))!);
  expect(hello.keys).toEqual(["SECRET-WORD-12"]);

  // The strobe pad, the cone, and the bigger brush appear only once a key
  // grants them.
  await expect(page.getByRole("button", { name: /Strobe/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cone" })).toHaveCount(0);
  await page.getByRole("button", { name: "Have a code?" }).click();
  await page.getByLabel("Secret code").fill("FIREFLY-COMET-47");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator(".public-toast")).toContainText("Unlocked: Camp Mock");
  await expect(page.locator(".public-unlocked")).toContainText("Camp Mock");
  await expect(page.getByRole("button", { name: /Strobe/ })).toBeVisible();
  const max = await page.getByLabel("Stroke size").getAttribute("max");
  expect(Number(max)).toBeCloseTo(0.5);
  // The cone stamps where it is tapped, like any shape.
  await page.getByRole("button", { name: "Cone" }).click();
  const stage = page.locator(".public-stage canvas.gate-canvas");
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await expect.poll(() => sent.some((m) => m.includes('"trigger_effect"') && m.includes('"cone"'))).toBe(true);
});
