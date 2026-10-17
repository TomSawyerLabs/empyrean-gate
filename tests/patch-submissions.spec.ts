// The Patch tab's Submissions drawer: the playground's queue on
// empyreangate.org, through the backend. Opening a row puts its patch in the
// editor as a new patch credited to the sender; a decision takes the row out
// of the queue.

import { expect, test } from "@playwright/test";

test("submissions open as new credited patches and leave the queue once decided", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await page.getByRole("button", { name: "Submissions…" }).click();
  const drawer = page.getByRole("complementary", { name: "Playground submissions" });
  await expect(drawer.locator("li")).toHaveCount(2);
  await expect(drawer.locator("li").first()).toContainText("Ember Drift");
  await expect(drawer.locator("li").first()).toContainText("by Ada");

  await drawer.locator("li").first().getByRole("button", { name: "Open as a new patch" }).click();
  await expect(page.locator(".patch-name")).toHaveValue("Ember Drift");
  await expect(page.locator(".patch-credit")).toHaveText("by Ada");
  // A new patch here, not the sender's: the library grows by one.
  await expect(page.locator(".patch-toolbar select").first().locator("option")).toContainText([
    /Ember Drift/,
  ]);

  await drawer.locator("li").nth(1).getByRole("button", { name: "Decline" }).click();
  await expect(drawer.locator("li")).toHaveCount(1);
  await expect(drawer).not.toContainText("Night Tide");
});
