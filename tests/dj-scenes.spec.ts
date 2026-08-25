import { expect, test } from "@playwright/test";
import { SCENE_PRESETS } from "../src/scenes";

test("DJ mode scenes combine master-audio anchors with LINK-synchronized layers", () => {
  const subduction = SCENE_PRESETS.find((scene) => scene.id === "dj-subduction-array");
  const prism = SCENE_PRESETS.find((scene) => scene.id === "dj-prism-relay");
  const accelerator = SCENE_PRESETS.find((scene) => scene.id === "dj-particle-accelerator");
  expect(subduction).toBeTruthy();
  expect(prism).toBeTruthy();
  expect(accelerator).toBeTruthy();

  expect(subduction!.layers.some((layer) => layer.kind === "waveform")).toBe(true);
  expect(prism!.layers.some((layer) => layer.kind === "spectrum")).toBe(true);
  expect(accelerator!.layers.some((layer) => layer.kind === "warp")).toBe(true);
  expect(accelerator!.layers.some((layer) => layer.kind === "meteors")).toBe(true);

  for (const scene of [subduction!, prism!, accelerator!]) {
    expect(scene.source).toContain("LINK clock/events + master audio");
    expect(scene.layers.every((layer) => layer.audio_source === 0)).toBe(true);
    expect(scene.layers.some((layer) => layer.audio_amount >= 0.9)).toBe(true);
  }
});

test("DJ mode scenes are available as distinct playable scene stacks", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#control");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  for (const name of ["DJ Subduction Array", "DJ Prism Relay", "DJ Particle Accelerator"]) {
    const card = page.locator(".scene-card", { has: page.getByRole("heading", { name }) });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(/LINK clock\/events \+ master audio/)).toBeVisible();
    await expect(card.getByRole("button", { name: "Load scene" })).toBeVisible();
  }
});
