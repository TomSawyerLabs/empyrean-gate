import { defineConfig, devices } from "@playwright/test";

const PORT = 9531;

/**
 * Layout gate only — this is not a general UI test suite. One browser
 * (Chromium: WebView2 on the Gate machine and Safari/Chrome on the iPads all
 * lay out to the same CSS box model, and a second engine would double CI time
 * to re-check the same rules).
 *
 * `bun run test:layout` builds the bundle, starts the mock backend, and runs it.
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
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `bun scripts/mock-backend.ts ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
