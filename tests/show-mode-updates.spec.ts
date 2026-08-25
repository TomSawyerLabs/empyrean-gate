// Show mode keeps the top bar and also exposes the dedicated show update controls,
// so an update remains visible and refusable from the performance surface.
//
// Installing mid-show stays allowed on purpose (the two-phase handover costs
// about a frame). What is tested here is that you can SEE it coming, refuse it
// for tonight, and that "tonight" does not silently become "forever".

import { expect, test } from "@playwright/test";

/// Patches are addressed to one page: the suite runs parallel against a single
/// mock backend, so a global override would leak into other cases.
async function withUpdateAvailable(page: import("@playwright/test").Page, id: string) {
  await page.addInitScript((v) => localStorage.setItem("empyrean-client-id", v), id);
  await page.request.post(`/mock/status?client=${id}`, {
    data: { update_available: "9.9.9", update_state: "ready to install", update_staged: true },
  });
}

async function enterShowMode(page: import("@playwright/test").Page) {
  await page.addInitScript(() => localStorage.setItem("empyrean-show-mode", "1"));
}

/// Wait for the app to be up AND actually in show mode before asserting on what
/// show mode does or does not show. Asserting straight after `data-connected`
/// assumes React has already applied the class, which is an ordering assumption
/// rather than a fact — and one that gets less true the more loaded the machine
/// running the suite is.
async function ready(page: import("@playwright/test").Page) {
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.locator(".app.show-mode").waitFor({ state: "attached" });
}

test("an available update is visible and refusable without leaving show mode", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await withUpdateAvailable(page, "show-update-visible");
  await enterShowMode(page);
  await page.goto("/#live");
  await ready(page);

  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".topbar nav")).toBeVisible();

  // Staged, so the button promises an instant install rather than a download.
  const install = page.getByRole("button", { name: /Update to v9\.9\.9 now/ });
  await expect(install).toBeVisible();

  const auto = page.getByRole("checkbox", { name: /Auto-update/ });
  await expect(auto).toBeVisible();
  await expect(auto).not.toBeChecked(); // auto_install defaults to false
});

test("the retained top bar can leave show mode", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await enterShowMode(page);
  await page.goto("/#live");
  await ready(page);

  await page.locator(".topbar").getByRole("button", { name: "Exit show mode" }).click();
  await expect(page.locator(".app.show-mode")).toHaveCount(0);
  await expect(page.locator(".topbar")).toBeVisible();
});

test("nothing is added to show mode when there is no update", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await enterShowMode(page);
  await page.goto("/#live");
  await ready(page);

  // The show surface is deliberately near-empty; the update controls must not
  // be sitting there costing space on the ordinary path.
  await expect(page.locator(".show-update")).toHaveCount(0);
  await expect(page.locator(".show-exit")).toBeVisible();
});

test("show mode is left at the scheduled hour, on the following day", async ({ page }) => {
  // 22:00 — show mode is switched on well AFTER the 09:00 exit time, which is the
  // case that a naive "is it past 09:00?" check gets wrong by kicking the operator
  // straight back out at the start of the night.
  await page.clock.install({ time: new Date("2026-03-10T22:00:00") });
  await page.setViewportSize({ width: 1400, height: 900 });
  await enterShowMode(page);
  await page.goto("/#live");
  await ready(page);
  await expect(page.locator(".show-exit")).toBeVisible();

  // Through the small hours: still a show, still fullscreen.
  await page.clock.fastForward("04:00:00"); // 02:00
  await expect(page.locator(".show-exit")).toBeVisible();

  // Past 09:00 the next morning it lets go by itself, so a rig left in show mode
  // is reachable — and updatable — again.
  await page.clock.fastForward("07:30:00"); // 09:30
  await expect(page.locator(".show-exit")).toHaveCount(0);
  await expect(page.locator(".topbar")).toBeVisible();
});
