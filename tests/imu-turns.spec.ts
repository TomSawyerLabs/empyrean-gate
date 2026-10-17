// Phone motion turns (plans/imu-turns.md): status says which phone drives the
// Phone IMU node and who waits; Settings shows this device its place, and
// buzzes it when its turn comes. The arbiter itself is unit-tested in Rust
// (state.rs imu_turn_tests); the mock just serves a status.

import { expect, test, type Page } from "@playwright/test";

async function openSettingsAs(page: Page, id: string, imu_turns: Record<string, unknown>) {
  await page.addInitScript((v) => {
    localStorage.setItem("empyrean-client-id", v);
    // Record buzzes; headless browsers have no vibration motor.
    (window as unknown as { __buzzes: unknown[] }).__buzzes = [];
    Object.defineProperty(navigator, "vibrate", {
      value: (p: unknown) => {
        (window as unknown as { __buzzes: unknown[] }).__buzzes.push(p);
        return true;
      },
      configurable: true,
    });
  }, id);
  await page.request.post(`/mock/status?client=${id}`, { data: { imu_turns } });
  await page.goto("/#settings");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
}

const buzzes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __buzzes: unknown[] }).__buzzes.length);

test("the holder sees its turn and gets a buzz", async ({ page }) => {
  await openSettingsAs(page, "turn-holder", {
    holder: "turn-holder",
    waiting: ["turn-other"],
    seconds_left: 45,
  });
  const note = page.locator(".imu-turn");
  await expect(note).toContainText("You have the gate's motion");
  await expect(note).toContainText(/4[0-5] s/);
  await expect.poll(() => buzzes(page)).toBe(1);
});

test("a waiting phone sees its place and does not buzz", async ({ page }) => {
  await openSettingsAs(page, "turn-second", {
    holder: "turn-holder",
    waiting: ["turn-first", "turn-second"],
    seconds_left: 30,
  });
  const note = page.locator(".imu-turn");
  await expect(note).toContainText("In line: 2nd of 2");
  await expect(note).toContainText(/about \d+ s/);
  expect(await buzzes(page)).toBe(0);
});

test("nothing is said while this phone is not in line", async ({ page }) => {
  await openSettingsAs(page, "turn-bystander", {
    holder: "turn-holder",
    waiting: [],
    seconds_left: null,
  });
  await expect(page.getByRole("button", { name: "Send motion / orientation" })).toBeVisible();
  await expect(page.locator(".imu-turn")).toHaveCount(0);
});
