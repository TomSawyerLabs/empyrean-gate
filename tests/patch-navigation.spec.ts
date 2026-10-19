// Getting around patches: the patch browser (built-ins read-only, your
// patches, three views), opening a Sub-patch by double-clicking it, and
// linked Sub-patches that follow their source until cloned for the project
// (Cameron, 2026-10-18: "back/forward button should work to move between
// patches. double click a sub-patch should open it."). The playground's URLs
// and Back/Forward are the site's; this is the editor's half.

import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
});

const browser = (page: Page) => page.locator(".patch-browser-panel");
const subNode = (page: Page) => page.locator(".pnode", { hasText: "Sub-patch" });

/** A new patch, renamed and saved (its id assigned by the autosave). */
async function newPatch(page: Page, name: string) {
  await page.getByRole("button", { name: "＋ New" }).click();
  await page.locator(".patch-name").fill(name);
  await expect(page.getByRole("button", { name: "▶ Activate" })).toBeEnabled({ timeout: 5_000 });
}

async function openFromBrowser(page: Page, name: string) {
  if (!(await browser(page).isVisible())) await page.getByRole("button", { name: "📁 Patches" }).click();
  await browser(page).locator(".browser-item", { hasText: name }).first().click();
  await expect(page.locator(".patch-name")).toHaveValue(name);
}

test("a built-in opens read-only, and an edit offers a copy to edit", async ({ page }) => {
  // Nothing open yet: the browser is there, built-ins and your patches.
  await expect(browser(page).locator(".browser-folder summary")).toContainText(["Built-in", "Your patches"]);
  await browser(page).locator(".browser-item", { hasText: "Mock Noise" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);
  await expect(page.locator(".patch-lock-chip")).toHaveText("🔒 Built-in");
  await expect(page.getByRole("button", { name: "▶ Activate" })).toHaveCount(0);

  // An edit (a node from the palette) changes nothing and says why.
  await page.locator(".palette-item", { hasText: "Plasma" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);
  const bar = page.locator(".patch-lock-bar");
  await expect(bar).toContainText("is built in, so it can't change");
  await bar.getByRole("button", { name: "Make a copy to edit" }).click();

  // The copy is a patch of its own: editable, saved, in your patches.
  await expect(page.locator(".patch-lock-chip")).toHaveCount(0);
  await page.locator(".palette-item", { hasText: "Plasma" }).click();
  await expect(page.locator(".pnode")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "▶ Activate" })).toBeEnabled({ timeout: 5_000 });
  await page.getByRole("button", { name: "📁 Patches" }).click();
  await expect(
    browser(page).locator(".browser-folder", { hasText: "Your patches" }).locator(".browser-item"),
  ).toContainText([/Mock Noise/]);
});

test("double-clicking a Sub-patch opens it; the breadcrumb leads back out", async ({ page }) => {
  await newPatch(page, "Outer");
  await page.locator(".palette-sub", { hasText: "Mock Noise" }).click();
  await expect(subNode(page)).toContainText("Mock Noise · 2 nodes");

  await subNode(page).dblclick();
  const crumbs = page.locator(".patch-crumbs");
  await expect(crumbs.locator(".patch-crumb")).toHaveText(["Outer ›", "Mock Noise"]);
  await expect(page.locator(".pnode")).toHaveCount(2);
  await expect(page.locator(".pnode", { hasText: "Output" })).toBeVisible();
  // Linked to a built-in: it follows that, so it can't change here...
  await expect(page.locator(".patch-lock-chip")).toHaveText("🔗 Linked to Mock Noise");
  await page.locator(".palette-item", { hasText: "Plasma" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);
  // ...until it is cloned for this project.
  await page.locator(".patch-lock-bar").getByRole("button", { name: "Clone for this project" }).click();
  await expect(page.locator(".patch-lock-chip")).toHaveCount(0);
  await page.locator(".palette-item", { hasText: "Plasma" }).click();
  await expect(page.locator(".pnode")).toHaveCount(3);

  // Back out: the outer patch, whose Sub-patch now holds three nodes.
  await crumbs.getByRole("button", { name: "Outer" }).click();
  await expect(page.locator(".patch-crumbs")).toHaveCount(0);
  await expect(subNode(page)).toContainText("Mock Noise · 3 nodes");
  await subNode(page).click();
  await expect(page.locator(".patch-side")).toContainText("This project's own copy of Mock Noise");

  // The browser's tree shows the Sub-patch under its patch, and opens it.
  await page.getByRole("button", { name: "📁 Patches" }).click();
  await browser(page).getByRole("button", { name: "Show the sub-patches of Outer" }).click();
  await browser(page).locator(".browser-sub", { hasText: "Mock Noise" }).click();
  await expect(page.locator(".patch-crumbs .patch-crumb")).toHaveText(["Outer ›", "Mock Noise"]);
});

test("a linked Sub-patch follows its source; a clone offers the update", async ({ page }) => {
  await newPatch(page, "Alpha");
  await newPatch(page, "Beta");
  await page.locator(".palette-sub", { hasText: "Alpha" }).click();
  await expect(subNode(page)).toContainText("Alpha · 2 nodes");
  await expect(page.getByRole("button", { name: "▶ Activate" })).toBeEnabled();

  // Change Alpha: Beta's linked copy follows.
  await openFromBrowser(page, "Alpha");
  await page.locator(".palette-item", { hasText: "Plasma" }).click();
  await expect(page.locator(".pnode")).toHaveCount(3);
  await page.waitForTimeout(900); // the autosave
  await openFromBrowser(page, "Beta");
  await expect(subNode(page)).toContainText("Alpha · 3 nodes");

  // Clone it, change Alpha again: the clone stays, and offers the update.
  await subNode(page).click();
  const panel = page.locator(".patch-side");
  await expect(panel).toContainText("Linked to Alpha");
  await panel.getByRole("button", { name: "Clone for this project" }).click();
  await expect(panel).toContainText("This project's own copy of Alpha");
  await page.waitForTimeout(900);
  await panel.getByRole("button", { name: "Open Alpha" }).click();
  await expect(page.locator(".patch-name")).toHaveValue("Alpha");
  await page.locator(".palette-item", { hasText: "Plasma" }).click();
  await expect(page.locator(".pnode")).toHaveCount(4);
  await page.waitForTimeout(900);
  await openFromBrowser(page, "Beta");
  await expect(subNode(page)).toContainText("Alpha · 3 nodes");
  await subNode(page).click();
  await expect(panel).toContainText("Alpha has changed since it was copied");
  await panel.getByRole("button", { name: "Update from Alpha" }).click();
  await expect(subNode(page)).toContainText("Alpha · 4 nodes");
  await expect(panel.getByRole("button", { name: "Update from Alpha" })).toHaveCount(0);
});

test("the browser has tree, topic and list views", async ({ page }) => {
  await newPatch(page, "Zed");
  await page.getByRole("button", { name: "📁 Patches" }).click();
  const views = browser(page).getByRole("radiogroup", { name: "View" });
  await views.getByRole("radio", { name: "Topics" }).click();
  // Mock Noise and a new patch both use a noise field.
  const noise = browser(page).locator(".browser-folder", { hasText: "Noise and chance" });
  await noise.locator("summary").click();
  await expect(noise.locator(".browser-item")).toContainText([/Mock Noise/, /Zed/]);
  await views.getByRole("radio", { name: "List" }).click();
  await expect(browser(page).locator(".browser-item")).toContainText([/Mock Noise/, /Zed/]);
  await expect(browser(page).locator(".browser-item").first()).toContainText("🔒");
  // The choice sticks.
  await page.reload();
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await expect(page.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
});
