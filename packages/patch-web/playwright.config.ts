import { defineConfig } from "@playwright/test";

/**
 * The browser shader check (`bun run test:browser`, after `build:wasm`):
 * every shader the patch core can generate, through Chrome's own WGSL
 * compiler. See `browser/shaders.spec.ts`.
 *
 * Always on SwiftShader, Chrome's software WebGPU, so a workstation tests
 * what the GPU-less CI runner does. Two details matter:
 * - `channel: "chromium"` is the full browser in new headless mode. The
 *   default headless shell gets no WebGPU adapter with any flags.
 * - `--use-webgpu-adapter=swiftshader` picks SwiftShader even where there
 *   is a real GPU.
 */
export default defineConfig({
  testDir: "./browser",
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Hundreds of pipelines in software: about half a minute on a workstation.
  timeout: 10 * 60_000,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    browserName: "chromium",
    channel: "chromium",
    launchOptions: {
      args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-webgpu-adapter=swiftshader"],
    },
  },
});
