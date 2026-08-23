// Refreshes the screenshots in docs/ from the current UI.
//
//   bun run screenshots
//
// Not part of the normal run — it writes files. It lives here rather than in a
// standalone script because Playwright cannot be driven directly from Bun (its
// browser launch uses a pipe transport Bun does not support); the test runner
// spawns Node for us.
//
// It shares the layout gate's mock backend, so the shots are deterministic:
// same config, same status, same pattern, regardless of what this machine's own
// config or GPU happen to be doing.

import { test } from "@playwright/test";

interface Shot {
  file: string;
  hash: string;
  width: number;
  height: number;
  /** Enter show mode first: fullscreen, no chrome — how the Gate machine runs. */
  showMode?: boolean;
}

const SHOTS: Shot[] = [
  { file: "live-wide.png", hash: "live", width: 1400, height: 900 },
  { file: "live-show-1080p.png", hash: "live", width: 1920, height: 1080, showMode: true },
  { file: "live-square.png", hash: "live", width: 900, height: 900 },
  { file: "live-tall.png", hash: "live", width: 820, height: 1180 },
  { file: "control.png", hash: "control", width: 1400, height: 900 },
  { file: "settings.png", hash: "settings", width: 1400, height: 1200 },
];

for (const shot of SHOTS) {
  test(`screenshot ${shot.file}`, async ({ page }) => {
    test.skip(!process.env.UPDATE_SCREENSHOTS, "run via `bun run screenshots`");
    await page.setViewportSize({ width: shot.width, height: shot.height });
    await page.goto(`/#${shot.hash}`);
    await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
    if (shot.showMode) {
      await page.getByRole("button", { name: /Show mode/ }).click();
      await page.locator(".show-exit").waitFor();
    }
    // Let the preview stream paint a few frames so the array is lit.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/${shot.file}` });
  });
}
