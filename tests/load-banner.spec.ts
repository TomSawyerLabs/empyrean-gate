// The engine judges sustained underperformance; the UI shows one dismissible
// toast with the load-shedding knobs, and the meters carry a load sparkline.

import { expect, test } from "@playwright/test";

const CLIENT = "load-banner-test";

test("a load warning becomes a dismissible toast with shedding actions", async ({ page, request }) => {
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), CLIENT);
  await request.post(`/mock/status?client=${CLIENT}`, {
    data: { load_warning: true, load_history: [60, 90, 97, 99, 104, 101, 98, 103] },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  const banner = page.locator(".load-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("103% of budget");
  await expect(banner.getByRole("button", { name: /Cap phone previews at 15 fps/ })).toBeVisible();
  await expect(banner.getByRole("button", { name: /Render at 45 fps/ })).toBeVisible();
  // The load meter shows the same number, highlighted.
  await expect(page.locator(".spark-warn").first()).toContainText("103%");

  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
});

test("hitches show on the meters and name the stage that caused them", async ({ page, request }) => {
  const id = "hitch-test";
  await page.addInitScript((c) => localStorage.setItem("empyrean-client-id", c), id);
  await request.post(`/mock/status?client=${id}`, {
    data: {
      load_warning: true,
      load_history: [20, 22, 21],
      late_history: [0, 1, 6],
      frame_budget_ms: 16.7,
      slowest_frame: {
        interval_ms: 48,
        work_ms: 44,
        prep_ms: 1,
        ready_ms: 2,
        minis_ms: 1,
        program_ms: 38,
        other_ms: 2,
        stall_ms: 0,
        secs_ago: 2,
      },
    },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#control");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  // Load is low; the hitches are what the banner and the meter call out.
  const banner = page.locator(".load-banner");
  await expect(banner).toContainText("6 hitches a second");
  await expect(banner).toContainText("48 ms frame 2 s ago, mostly main render (38 ms)");
  await expect(page.locator(".meter-stack .spark-warn", { hasText: "hitches" })).toContainText("6 hitches");
  await expect(page.locator(".slow-frame")).toContainText("mostly main render");
});

test("a flapping display becomes a red banner naming the cable", async ({ page, request }) => {
  const id = "display-flap-test";
  await page.addInitScript((c) => localStorage.setItem("empyrean-client-id", c), id);
  await request.post(`/mock/status?client=${id}`, {
    data: {
      display_flapping: true,
      gpu_resets: 3,
      display_events: [
        { secs_ago: 12, detail: "2 monitors, primary 1920×1080 → 1 monitor, primary 1920×1080" },
        { secs_ago: 90, detail: "1 monitor, primary 1920×1080 → 2 monitors, primary 1920×1080" },
        { secs_ago: 300, detail: "2 monitors, primary 1920×1080 → 1 monitor, primary 1920×1080" },
      ],
    },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  const banner = page.locator(".display-banner");
  await expect(banner).toHaveClass(/error/);
  await expect(banner).toContainText("A display is flapping");
  await expect(banner).toContainText("3 changes in 10 min");
  await expect(banner).toContainText("3 GPU resets");
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
});

test("a monitor negotiated below its native mode gets a banner naming the USB-C link", async ({ page, request }) => {
  const id = "display-link-test";
  await page.addInitScript((c) => localStorage.setItem("empyrean-client-id", c), id);
  await request.post(`/mock/status?client=${id}`, {
    data: {
      display_links: [
        { name: "TYPEC", native_w: 2560, native_h: 1080, offered_w: 1920, offered_h: 1080, degraded: true },
        { name: "Show display", native_w: 1920, native_h: 1080, offered_w: 1920, offered_h: 1080, degraded: false },
      ],
      tdr_last_hour: 2,
      tdr_last_day: 2,
    },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  const banner = page.locator(".link-banner");
  await expect(banner).toContainText("TYPEC is running below its native 2560×1080");
  await expect(banner).toContainText("at most 1920×1080");
  await expect(banner).not.toContainText("Show display");
  await expect(banner).toContainText("2 display-driver resets in the last hour");
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
});

test("no warning, no toast — and the load meter is still there", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#control");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await expect(page.locator(".load-banner")).toHaveCount(0);
  await expect(page.locator(".spark-label", { hasText: "load" })).toBeVisible();
});
