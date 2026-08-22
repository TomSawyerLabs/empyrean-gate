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

const SHOTS = [
  { file: "live-wide.png", hash: "live", width: 1400, height: 900 },
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
    // Let the preview stream paint a few frames so the array is lit.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/${shot.file}` });
  });
}
