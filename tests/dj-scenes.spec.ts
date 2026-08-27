import { expect, test } from "@playwright/test";
import { SCENE_PRESETS } from "../src/scenes";

test("new visual studies have distinct silhouettes, palettes, and motion", () => {
  const studies = [
    SCENE_PRESETS.find((scene) => scene.id === "monochrome-switchyard"),
    SCENE_PRESETS.find((scene) => scene.id === "hyperfruit-pinball"),
    SCENE_PRESETS.find((scene) => scene.id === "infrared-topography"),
  ];

  expect(studies.every(Boolean)).toBe(true);
  expect(new Set(studies.map((scene) => scene!.layers.map((layer) => layer.kind).join(","))).size).toBe(3);
  expect(studies[0]!.layers.some((layer) => layer.kind === "solid")).toBe(true);
  expect(studies[1]!.layers.some((layer) => layer.kind === "meteors")).toBe(true);
  expect(studies[2]!.layers.some((layer) => layer.blend === "multiply")).toBe(true);
  expect(new Set(studies.map((scene) => scene!.palette.join(","))).size).toBe(3);
});

test("the Math Camp scene is an exact polar rose and golden-angle construction", () => {
  const scene = SCENE_PRESETS.find((candidate) => candidate.id === "math-camp-golden-rose");
  expect(scene).toBeTruthy();
  expect(scene!.source).toContain("cos(5θ)");
  expect(scene!.source).toContain("π(3−√5)");
  expect(scene!.layers.map((layer) => layer.kind)).toEqual(["solid", "golden_rose"]);
  expect(scene!.layers.every((layer) => layer.audio_amount <= 0.02)).toBe(true);
  expect(scene!.layers.every((layer) => layer.walk_amount === 0)).toBe(true);
});

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
