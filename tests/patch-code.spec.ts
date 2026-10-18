// A Code node: its ports and body live on the instance (plans/code-node.md).
// The palette offers it under "Code"; the side panel edits its ports and
// body; renaming a port carries its wires along.

import { expect, test, type Page } from "@playwright/test";

async function newPatchWithCode(page: Page, sent: string[]) {
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      if (typeof f.payload === "string") sent.push(f.payload);
    }),
  );
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);
  const group = page.locator(".palette-group", { has: page.locator("h4", { hasText: "Code" }) });
  await group.getByRole("button", { name: "Code" }).click();
  const node = page.locator(".pnode.cat-code");
  await expect(node).toBeVisible();
  return node;
}

test("a Code node starts as a colour field with one knob, and saves its code", async ({ page }) => {
  const sent: string[] = [];
  const node = await newPatchWithCode(page, sent);
  // The starter: one scalar input (a knob), one colour-field output, a body.
  await expect(node.locator(".pnode-port.in")).toHaveText(["twist"]);
  await expect(node.locator(".pnode-port.out")).toHaveText(["out"]);
  await expect(node.locator(".pnode-code")).toContainText("GPU");

  await node.click();
  const panel = page.locator(".patch-side");
  await expect(panel.locator("h3")).toHaveText("Code");
  await expect(panel.locator(".code-tier")).toContainText("GPU");
  const body = panel.getByLabel("Body (WGSL)");
  await expect(body).toHaveValue(/hsv2rgb/);
  // The knob is a slider like any other, and can be exposed.
  await expect(panel.locator(".patch-param-head").filter({ hasText: "twist" })).toBeVisible();

  // The save carries the definition.
  await expect
    .poll(() =>
      sent.some((m) => m.includes('"patch_save"') && m.includes('"kind":"code"') && m.includes('"code":{"inputs"')),
    )
    .toBe(true);
});

test("ports are edited in the panel and renaming one keeps its wire", async ({ page }) => {
  const sent: string[] = [];
  const node = await newPatchWithCode(page, sent);
  const panel = page.locator(".patch-side");
  // The mock registry's Output takes a grey field, and Noise already has
  // it: make the Code node's output grey and drop Noise.
  await node.click();
  await panel.getByLabel("Output 1 shape").selectOption("field_scalar");
  await page.locator(".pnode", { hasText: "Noise" }).click();
  await panel.getByRole("button", { name: "Delete node" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  // Wire the Code node into the Output.
  const from = node.locator(".pnode-port.out .port-dot");
  const to = page.locator(".pnode", { hasText: "Output" }).locator(".pnode-port.in .port-dot");
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await node.click();
  // Rename the output: the wire follows.
  const outName = panel.getByLabel("Output 1 name");
  await outName.fill("colour");
  await expect(node.locator(".pnode-port.out")).toHaveText(["colour"]);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect
    .poll(() => sent.some((m) => m.includes('"patch_save"') && m.includes('"port":"colour"')))
    .toBe(true);

  // Add an input; it appears on the node as a knob; remove it again.
  await panel.getByRole("button", { name: "＋ input" }).click();
  await expect(node.locator(".pnode-port.in")).toHaveText(["twist", "in"]);
  await panel.getByLabel("Remove input in").click();
  await expect(node.locator(".pnode-port.in")).toHaveText(["twist"]);

  // A bad name is flagged in place.
  const inName = panel.getByLabel("Input 1 name");
  await inName.fill("2bad");
  await expect(inName).toHaveAttribute("aria-invalid", "true");
  await inName.fill("spin");
  await expect(inName).toHaveAttribute("aria-invalid", "false");
  await expect(node.locator(".pnode-port.in")).toHaveText(["spin"]);

  // Turning the output into a scalar moves the node to the CPU tier and
  // drops the wire that no longer fits.
  await panel.getByLabel("Output 1 shape").selectOption("scalar");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(node.locator(".pnode-code")).toContainText("CPU");
  await expect(panel.locator(".code-tier")).toContainText("CPU");
});

test("the body takes a Tab as two spaces", async ({ page }) => {
  const sent: string[] = [];
  const node = await newPatchWithCode(page, sent);
  await node.click();
  const body = page.locator(".patch-side").getByLabel("Body (WGSL)");
  await body.fill("out = vec4f(1.0);");
  await body.press("Home");
  await body.press("Tab");
  await expect(body).toHaveValue("  out = vec4f(1.0);");
});
