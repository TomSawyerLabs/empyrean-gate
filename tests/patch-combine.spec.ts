// Drop-to-combine and minimized nodes (asked for 2026-10-17): a second wire
// dropped on an input that already has one puts a Blend (for colour; Field
// math, Merge events or Math for the other shapes) between the two, minimized
// and selected, and a further one becomes another layer of that Blend
// (2026-10-18); a minimized node is its mini with bare port dots. The wiring
// rules are unit-tested in packages/patch-web (combine.test.ts); this covers
// the canvas.

import { expect, test, type Locator, type Page } from "@playwright/test";

async function newPatch(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
}

async function center(l: Locator) {
  const box = (await l.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a wire from one port dot to another; `during` runs before release. */
async function wire(page: Page, from: Locator, to: Locator, during?: () => Promise<void>) {
  const a = await center(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const b = await center(to);
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await during?.();
  await page.mouse.up();
}

const node = (page: Page, label: string) => page.locator(".pnode", { hasText: label });
const outputIn = (page: Page) => node(page, "Output").locator(".pnode-port.in").first();

/** Add a palette node and move it clear of the others, so its dot is free.
 * Returns the new node (the last of its kind on the canvas). */
async function addNode(page: Page, label: string, to: { x: number; y: number }) {
  await page.locator(".palette-item", { hasText: label }).first().click();
  const added = node(page, label).last();
  const head = added.locator(".pnode-head");
  const at = await center(head);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  return added;
}

test("a second wire into a taken input makes a minimized Blend, as one undo step", async ({ page }) => {
  await newPatch(page);
  const plasma = await addNode(page, "Plasma", { x: 500, y: 700 });
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  const plasmaOut = plasma.locator(".pnode-port.out .port-dot");
  await wire(page, plasmaOut, outputIn(page).locator(".port-dot"), async () => {
    // Taken, but it would combine: it glows, marked as a combine.
    await expect(outputIn(page)).toHaveClass(/port-fit/);
    await expect(outputIn(page)).toHaveClass(/port-combine/);
  });

  const blend = page.locator(".pnode-collapsed", { hasText: "Blend" });
  await expect(blend).toHaveCount(1);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  // Noise (already there) is the base, Plasma goes over, Blend feeds Output.
  await expect(page.locator('.react-flow__edge[data-id$=".base"]')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge[data-id$=".over"]')).toHaveCount(1);
  // Minimized: its mode shows, its knob ports don't; selected, its panel is open.
  await expect(blend.locator(".pnode-choice")).toHaveText("add");
  await expect(blend.locator(".pnode-port.in")).toHaveCount(2);
  await expect(page.getByRole("complementary", { name: "Blend settings" })).toBeVisible();

  await page.getByRole("button", { name: "↶ Undo" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

/** Two Plasmas dropped in turn on Output's input, over the starter Noise:
 * one Blend with two layers. */
async function twoLayers(page: Page) {
  await newPatch(page);
  const first = await addNode(page, "Plasma", { x: 500, y: 650 });
  await wire(page, first.locator(".pnode-port.out .port-dot"), outputIn(page).locator(".port-dot"));
  await expect(page.locator(".pnode-collapsed")).toHaveCount(1);
  const second = await addNode(page, "Plasma", { x: 330, y: 820 });
  await wire(page, second.locator(".pnode-port.out .port-dot"), outputIn(page).locator(".port-dot"), async () => {
    await expect(outputIn(page)).toHaveClass(/port-combine/);
  });
}

/** `[from node, to node]` of the wire into the Blend input ending `port`. */
async function wireInto(page: Page, port: string) {
  const ids = await page.locator(".react-flow__edge").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")!));
  const hit = ids.find((x) => x.endsWith(`.${port}`));
  return hit ? hit.split(">").map((end) => end.split(".")[0]) : null;
}

test("a third wire becomes a second layer of that Blend, not another Blend", async ({ page }) => {
  await twoLayers(page);
  const blend = page.locator(".pnode-collapsed", { hasText: "Blend" });
  await expect(blend).toHaveCount(1);
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  await expect(page.locator('.react-flow__edge[data-id$=".over2"]')).toHaveCount(1);
  await expect(blend.locator(".pnode-choice")).toHaveText("2 layers");
  await expect(blend.locator(".pnode-port.in")).toHaveCount(3);

  await page.getByRole("button", { name: "↶ Undo" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await expect(blend.locator(".pnode-choice")).toHaveText("add");
});

test("the side panel lists the layers top first, and moves, removes and adds them", async ({ page }) => {
  await twoLayers(page);
  const panel = page.getByRole("complementary", { name: "Blend settings" });
  const layers = panel.getByRole("group", { name: "Layers" });
  await expect(layers.getByRole("region")).toHaveText([/^Layer 2/, /^Layer 1/]);
  const [first] = (await wireInto(page, "over"))!;
  const [second, mix] = (await wireInto(page, "over2"))!;

  // Lower the top layer: the two wires swap places.
  await layers.getByRole("button", { name: "Lower layer 2" }).click();
  expect(await wireInto(page, "over")).toEqual([second, mix]);
  expect(await wireInto(page, "over2")).toEqual([first, mix]);

  // Remove the bottom one: its wire goes and the other closes the gap.
  await layers.getByRole("button", { name: "Remove layer 1" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  expect(await wireInto(page, "over")).toEqual([first, mix]);
  await expect(layers.getByRole("region")).toHaveText([/^Layer 1/]);
  await expect(layers.getByRole("button", { name: "Remove layer 1" })).toHaveCount(0);

  // A new empty layer on top.
  await layers.getByRole("button", { name: "＋ Add layer" }).click();
  await expect(layers.getByRole("region", { name: "Layer 2" })).toContainText("empty");
  await expect(page.locator(".pnode-collapsed .pnode-choice")).toHaveText("2 layers");
});

test("any node minimizes to its mini and expands again", async ({ page }) => {
  await newPatch(page);
  const noise = node(page, "Noise");
  const full = (await noise.boundingBox())!;
  await noise.getByRole("button", { name: "Minimize Noise" }).click();
  await expect(noise).toHaveClass(/pnode-collapsed/);
  const small = (await noise.boundingBox())!;
  expect(small.width).toBeLessThan(full.width);
  expect(small.height).toBeLessThan(full.height);
  // Unwired knobs hide; the wired output stays, so the wire still lands.
  await expect(noise.locator(".pnode-port.in")).toHaveCount(0);
  await expect(noise.locator(".pnode-port.out")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  // Port names show while a wire is dragged, so the dots can be told apart.
  await expect(noise.locator(".pnode-port.out span")).toHaveCount(0);

  await noise.getByRole("button", { name: "Expand Noise" }).click();
  await expect(noise).not.toHaveClass(/pnode-collapsed/);
  await page.getByRole("button", { name: "↶ Undo" }).click();
  await expect(noise).toHaveClass(/pnode-collapsed/);
});
