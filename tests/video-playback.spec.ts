import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  MAX_VIDEO_PLAYBACK_RATE,
  MIN_VIDEO_PLAYBACK_RATE,
  videoPlaybackRate,
} from "../src/videoPlayback";

test("video playback follows live LINK tempo relative to its reference BPM", () => {
  expect(videoPlaybackRate({
    baseRate: 1,
    mode: "pro_dj_link",
    referenceBpm: 120,
    linkBpm: 90,
    linkActive: true,
  })).toBe(0.75);
  expect(videoPlaybackRate({
    baseRate: 0.8,
    mode: "pro_dj_link",
    referenceBpm: 100,
    linkBpm: 125,
    linkActive: true,
  })).toBe(1);
});

test("video playback stays safe when LINK disappears or tempo scaling is extreme", () => {
  expect(videoPlaybackRate({
    baseRate: 0.75,
    mode: "pro_dj_link",
    referenceBpm: 120,
    linkBpm: 0,
    linkActive: false,
  })).toBe(0.75);
  expect(videoPlaybackRate({
    baseRate: 0.5,
    mode: "pro_dj_link",
    referenceBpm: 240,
    linkBpm: 40,
    linkActive: true,
  })).toBe(MIN_VIDEO_PLAYBACK_RATE);
  expect(videoPlaybackRate({
    baseRate: 2,
    mode: "pro_dj_link",
    referenceBpm: 40,
    linkBpm: 240,
    linkActive: true,
  })).toBe(MAX_VIDEO_PLAYBACK_RATE);
});

test("the Media player applies fixed speed live and exposes LINK reference tempo", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#media");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  await page.locator('input[type="file"][accept="video/*"]').setInputFiles({
    name: "playback-controls.webm",
    mimeType: "video/webm",
    // Decoding is irrelevant here: loading a local source is enough to mount
    // the real video element and exercise its live playbackRate property.
    buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  });

  const speed = page.getByLabel("Video base speed");
  await expect(speed).toBeVisible();
  await speed.fill("0.75");
  await expect.poll(() => page.locator("video").evaluate((video) => video.playbackRate)).toBe(0.75);

  await page.getByLabel("Follow PRO DJ LINK tempo").check();
  await expect(page.getByLabel("Video reference tempo")).toHaveValue("120");
  await expect(page.getByText(/waiting for live LINK tempo/)).toBeVisible();
});
