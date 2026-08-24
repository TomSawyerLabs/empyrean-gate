// Guards the two things that made the Live tab unusable on a phone.
//
// 1. Reachability. Below 700px the topbar hid Show mode, Connect, New window,
//    the connection state and the version chip outright, and spent two rows on a
//    seven-tab grid. The controls existed and there was no way to get to them.
//    They live behind the corner menu now, and the tab row's height went back to
//    the array.
//
// 2. Scrolling. `.live-page` carried `touch-action: none` so a stray contact
//    beside a pen button could not cancel a stroke mid-draw — but on a phone the
//    Live tab IS a scrolling column, and an ancestor `none` vetoes panning for
//    everything inside it. Every control below the array was unreachable by
//    finger. The rule belongs on the array's own square, not the page.

import { expect, test } from "@playwright/test";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1400, height: 900 };

async function live(page: import("@playwright/test").Page, size: typeof PHONE) {
  await page.setViewportSize(size);
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
}

test("the phone topbar trades the tab grid for a corner menu", async ({ page }) => {
  await live(page, PHONE);

  await expect(page.locator(".topbar > nav")).toBeHidden();
  const toggle = page.locator(".topbar-menu-toggle");
  await expect(toggle).toBeVisible();
  // It says where you are; a bare hamburger does not.
  await expect(toggle).toContainText("Live");

  // One row of chrome, not two. The old grid was 2 x 42px plus padding.
  const topbar = (await page.locator(".topbar").boundingBox())!;
  expect(Math.round(topbar.height)).toBeLessThan(70);
});

test("the corner menu carries every tab and the actions the narrow topbar drops", async ({
  page,
}) => {
  await live(page, PHONE);
  await page.locator(".topbar-menu-toggle").click();

  const menu = page.locator(".topbar-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".topbar-menu-tabs button")).toHaveCount(7);
  // The three actions `@media (max-width: 700px)` hides from the topbar. New
  // window is Tauri-only and legitimately absent in a browser.
  await expect(menu.getByRole("button", { name: /Show mode/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Connect a device/ })).toBeVisible();
  await expect(menu.locator(".conn")).toBeVisible();

  await menu.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".settings-page")).toBeVisible();
  await expect(page.locator(".topbar-menu-toggle")).toContainText("Settings");
});

test("the corner menu is a phone device only", async ({ page }) => {
  await live(page, DESKTOP);
  await expect(page.locator(".topbar-menu-toggle")).toBeHidden();
  await expect(page.locator(".topbar > nav")).toBeVisible();
});

test("a phone can scroll the Live tab to its controls, and the array still cannot", async ({
  page,
}) => {
  await live(page, PHONE);

  // The array's square swallows pans so a drag draws instead of scrolling; the
  // page around it must not, or nothing below the fold is reachable.
  await expect(page.locator(".live-canvas-wrap")).toHaveCSS("touch-action", "none");
  await expect(page.locator(".live-page")).toHaveCSS("touch-action", "pan-y");

  const main = page.locator("main");
  const scrollable = await main.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(scrollable, "the phone Live tab should overflow and scroll").toBe(true);

  // The last cluster is genuinely below the fold, and genuinely reachable.
  const status = page.locator(".live-side .live-status-grid");
  await status.scrollIntoViewIfNeeded();
  await expect(status).toBeInViewport();
});

// The slider is the one that regressed: the blanket `input { user-select: text }`
// opt-in next to `.app { user-select: none }` matched `type="range"` too, so
// dragging brightness on iOS could raise the selection magnifier over the show.
test("nothing on Live is selectable, sliders included", async ({ page }) => {
  await live(page, PHONE);
  for (const selector of [".live-page", ".pen-btn", '.live-side input[type="range"]']) {
    // WebKit still only reports the prefixed property, so ask for both and
    // require whichever the engine actually answers with to be "none".
    const values = await page.locator(selector).first().evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.userSelect, style.webkitUserSelect].filter(Boolean);
    });
    expect(values.length, `${selector} reports no user-select at all`).toBeGreaterThan(0);
    for (const value of values) expect(value, selector).toBe("none");
  }
});
