import { expect, test } from "@playwright/test";

test("quick settings edit mode opens the editor for a shortcut", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  // Not in edit mode: pressing Blackout fires it, no dialog.
  await page.getByRole("button", { name: /Blackout: Master brightness/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "✎ Edit" }).click();
  await page.getByRole("button", { name: "Edit Blackout" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit shortcut" })).toBeVisible();

  // Rename it and confirm it persists to localStorage under the new key.
  await page.getByLabel("Button label").fill("Panic");
  await page.getByRole("button", { name: "Save shortcut" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const stored = await page.evaluate(() =>
    localStorage.getItem("empyrean-live-quick-settings-v1"),
  );
  expect(stored).toContain("Panic");

  await page.getByRole("button", { name: "+ Add" }).click();
  await expect(page.getByRole("heading", { name: "New shortcut" })).toBeVisible();
});

test("legacy deck shortcuts migrate", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.evaluate(() => {
    localStorage.removeItem("empyrean-live-quick-settings-v1");
    localStorage.setItem(
      "empyrean-control-decks-v1",
      JSON.stringify([
        {
          id: "default",
          name: "d",
          layouts: {},
          widgets: [
            { id: "quick_settings", kind: "quick_settings", shortcuts: [
              { id: "x", label: "House lights", target: "master_brightness", value: 1, mode: "set", durationMs: 1000 },
            ] },
          ],
        },
      ]),
    );
  });
  await page.reload();
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await expect(page.getByRole("button", { name: /House lights/ })).toBeVisible();
});
