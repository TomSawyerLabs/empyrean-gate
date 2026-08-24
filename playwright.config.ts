import { defineConfig, devices } from "@playwright/test";

const PORT = 9531;

/**
 * The layout gate plus the handful of UI behaviours that only exist in the
 * browser — this is not a general UI test suite.
 *
 * Two engines, split by what each is actually able to tell us:
 *
 * - **The layout gate runs on Chromium only.** WebView2 on the Gate machine and
 *   Safari on the iPads lay out to the same CSS box model, and this was checked
 *   rather than assumed: all 47 gate cases pass identically under WebKit. A
 *   second engine there would double the slowest job to re-derive the same
 *   geometry.
 * - **The behaviour specs run on both.** Box geometry is portable; range input
 *   rendering, pointer capture and canvas are not, and the iPads are first-class
 *   clients (QR join, Add to Home Screen, remote mic), not an afterthought.
 *   This is the half the gate is structurally blind to.
 *
 * Caveat worth knowing: Playwright's WebKit tracks current Safari. It does NOT
 * reproduce an iPad stuck on iPadOS 15 or 16, so the fallbacks aimed at those
 * (`-webkit-backdrop-filter`, the container-query default in styles.css) are
 * defensive and cannot be proven here.
 *
 * `bun run test:layout` builds the bundle, starts the mock backend, and runs the
 * gate; `bun run test:behavior` runs the rest against an already-built bundle.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A show machine shares six cores with everything else; layout checks are
  // cheap but browsers are not, so keep the fan-out modest.
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      // Explicitly listed rather than an ignore list: the gate is Chromium-only
      // by the reasoning above, and `screenshots.spec.ts` WRITES files, so a
      // second project running it would race the first over docs/*.png.
      testMatch: /(quick-settings|live-controls|color-wheel)\.spec\.ts/,
    },
  ],
  webServer: {
    command: `bun scripts/mock-backend.ts ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
