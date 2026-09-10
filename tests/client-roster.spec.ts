// The roster: who is on the floor, in arrival order, what they last did, the
// cutoff where live-view slots run out, and a Block per device. The mock
// status carries three connected devices (two viewing, one waiting) and one
// blocked offline tablet.

import { expect, test } from "@playwright/test";

// Be the mock's first device, so its row reads "you" and carries no Block.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("empyrean-client-id", "mock-client"));
});

test("Live folds the roster under the clients stat", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await expect(page.locator(".client-roster")).toHaveCount(0);
  await page.locator(".live-status-clients").click();
  const roster = page.locator(".live-status-roster .client-roster");
  await expect(roster).toBeVisible();

  // Arrival order, viewing first, then the cutoff, then whoever is waiting.
  const names = roster.locator(".roster-row:not(.offline) .roster-name");
  await expect(names).toHaveText([/Layout test/, /Dusty Playa/, /Neon Badger/]);
  await expect(roster.locator(".roster-cutoff")).toContainText("1 waiting");
  await expect(roster.locator(".roster-row").nth(1)).toContainText("drawing · now");
  await expect(roster.locator(".roster-row").nth(1)).toHaveClass(/playing/);

  // The offline, blocked tablet is folded away until asked for.
  await expect(roster.locator(".roster-row.offline")).toHaveCount(0);
  await roster.getByRole("button", { name: /Show 1 offline/ }).click();
  await expect(roster.locator(".roster-row.offline")).toContainText("Old tablet");
  await expect(roster.locator(".roster-row.offline")).toContainText("blocked");
  await expect(roster.locator(".roster-row.offline").getByRole("button")).toHaveText("Unblock");
});

test("Control lists the roster as a panel with a Block per device", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#control");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  const panel = page.locator(".panel", { has: page.locator("h2", { hasText: "Clients" }) });
  await expect(panel.locator(".roster-row:not(.offline)")).toHaveCount(3);
  // Never a Block button on your own row; one on every other connected device.
  await expect(panel.locator(".roster-row:not(.offline) .roster-toggle")).toHaveCount(2);
});
