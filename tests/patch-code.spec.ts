// A Code node: its ports and body live on the instance (plans/code-node.md).
// The palette offers it under "Structure"; the side panel edits its ports and
// body (a CodeMirror editor with completion); renaming a port carries its
// wires along.

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
  const group = page.locator(".palette-group", { has: page.locator("h4", { hasText: "Structure" }) });
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
  await expect(body).toContainText("hsv2rgb");
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

test("the body editor completes the node's own ports and the lib's helpers", async ({ page }) => {
  const sent: string[] = [];
  const node = await newPatchWithCode(page, sent);
  await node.click();
  const panel = page.locator(".patch-side");
  const body = panel.getByLabel("Body (WGSL)");
  // Replace the body; typing a prefix offers the input port, Enter takes it.
  await body.fill("out = vec4f(tw");
  await body.press("End");
  await body.pressSequentially("i");
  const list = page.locator(".cm-tooltip-autocomplete");
  const selected = list.locator('[aria-selected="true"]');
  await expect(selected).toContainText("twist");
  // CodeMirror ignores Enter for 75 ms after a list opens (a typist's guard).
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await expect(body).toContainText("vec4f(twist");
  // A helper from the reference (the mock serves hsv2rgb), applied with
  // its parentheses.
  await body.pressSequentially(" + hsv2");
  await expect(selected).toContainText("hsv2rgb");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await expect(body).toContainText("hsv2rgb()");
  // The edit reached the patch (and so the save), coalesced.
  await expect
    .poll(() => sent.some((m) => m.includes('"patch_save"') && m.includes("vec4f(twist + hsv2rgb()")))
    .toBe(true);
});

test("a built-in node converts to a Code node in place, keeping its id and wire", async ({ page }) => {
  const sent: string[] = [];
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
  // Noise is convertible (the mock marks it); Output is not.
  await page.locator(".pnode", { hasText: "Output" }).click();
  const panel = page.locator(".patch-side");
  await expect(panel.getByRole("button", { name: "Convert to Code" })).toHaveCount(0);
  await page.locator(".pnode", { hasText: "Noise" }).click();
  await panel.getByRole("button", { name: "Convert to Code" }).click();
  // The node is a Code node now, with the stand-in body, still wired into Output.
  const node = page.locator(".pnode.cat-code");
  await expect(node).toBeVisible();
  await expect(node.locator(".pnode-port.in")).toHaveText(["scale"]);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(panel.locator("h3")).toHaveText("Code");
  await expect(panel.getByLabel("Body (WGSL)")).toContainText("Converted from");
  // A scalar input of a GPU node can be marked as a rate.
  await panel.getByLabel("Input scale is a rate").check();
  await expect(panel.locator(".patch-param-head").filter({ hasText: "scale" })).toContainText("(rate)");
  await expect
    .poll(() => sent.some((m) => m.includes('"patch_save"') && m.includes('"integrate":true')))
    .toBe(true);
  // Undo (from the toolbar: the checkbox has the focus) takes the flag back
  // in one step; the conversion itself was another.
  await page.getByRole("button", { name: "↶ Undo" }).click();
  await expect(panel.locator(".patch-param-head").filter({ hasText: "scale" })).not.toContainText("(rate)");
});

test("a conversion the core refuses says why under the button, and changes nothing", async ({ page }) => {
  // The core refuses e.g. an eight-layer Blend (more ports than a Code node
  // may have); the mock converts anything, so stand in for the refusal.
  const reason = "A Code node takes at most 16 inputs and this Blend would need 17; remove a layer or two first.";
  await page.route("**/patch/convert-to-code", (r) => r.fulfill({ status: 400, json: { error: reason } }));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await page.locator(".pnode", { hasText: "Noise" }).click();
  const panel = page.locator(".patch-side");
  await panel.getByRole("button", { name: "Convert to Code" }).click();
  await expect(panel.locator(".patch-status.error")).toHaveText(reason);
  await expect(page.locator(".pnode.cat-code")).toHaveCount(0);
  // It belongs to that node: selecting another clears it.
  await page.locator(".pnode", { hasText: "Output" }).click();
  await expect(panel.locator(".patch-status.error")).toHaveCount(0);
});

test("the body opens in a large modal, edits there reach the patch, Esc comes back", async ({ page }) => {
  const sent: string[] = [];
  const node = await newPatchWithCode(page, sent);
  await node.click();
  const panel = page.locator(".patch-side");
  await panel.getByRole("button", { name: "Open the body in a bigger editor" }).click();
  const modal = page.locator("dialog.code-modal");
  await expect(modal).toBeVisible();
  // One editor: the panel's own moved into the modal.
  await expect(panel.locator(".code-body .cm-editor")).toHaveCount(0);
  await expect(modal.locator(".cm-editor")).toHaveCount(1);
  const body = modal.getByLabel("Body (WGSL)");
  await body.fill("out = vec4f(0.5);");
  await expect
    .poll(() => sent.some((m) => m.includes('"patch_save"') && m.includes("out = vec4f(0.5);")))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(panel.getByLabel("Body (WGSL)")).toContainText("out = vec4f(0.5);");
});

// The site's root.css resets every margin, the dialog's centring included.
const HOST_RESET = "*, ::before, ::after { margin: 0; padding: 0; }";

test("the large modal is centred and nearly the window under a host's margin reset", async ({ page }) => {
  const sent: string[] = [];
  const node = await newPatchWithCode(page, sent);
  await page.addStyleTag({ content: HOST_RESET });
  await node.click();
  await page.locator(".patch-side").getByRole("button", { name: "Open the body in a bigger editor" }).click();
  const modal = page.locator("dialog.code-modal");
  await expect(modal).toBeVisible();
  const box = (await modal.boundingBox())!;
  expect(box.width).toBeGreaterThan(1300);
  expect(box.height).toBeGreaterThan(800);
  expect(Math.abs(box.x + box.width / 2 - 700)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(2);
});

test("on a phone the large modal is the whole screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.addStyleTag({ content: HOST_RESET });
  await page.locator(".patch-name-chip").click();
  await page.getByRole("button", { name: "＋ Blank patch" }).click();
  await page.getByRole("button", { name: "Add node" }).click();
  const group = page.locator(".palette-group", { has: page.locator("h4", { hasText: "Structure" }) });
  await group.getByRole("button", { name: "Code" }).click();
  await page.locator(".pnode.cat-code").click();
  await page.getByRole("button", { name: /settings/ }).click();
  const sheet = page.locator(".patch-side.patch-sheet");
  await sheet.getByRole("button", { name: "Open the body in a bigger editor" }).click();
  const modal = page.locator("dialog.code-modal");
  await expect(modal).toBeVisible();
  const box = (await modal.boundingBox())!;
  expect([box.x, box.y, box.width, box.height].map(Math.round)).toEqual([0, 0, 390, 844]);
  await expect(modal.locator(".cm-editor")).toBeVisible();
  await modal.getByRole("button", { name: "Done" }).click();
  await expect(modal).toHaveCount(0);
  await expect(sheet).toBeVisible();
});

test("the body takes a Tab as an indent", async ({ page }) => {
  const sent: string[] = [];
  const node = await newPatchWithCode(page, sent);
  await node.click();
  const body = page.locator(".patch-side").getByLabel("Body (WGSL)");
  await body.fill("out = vec4f(1.0);");
  await body.press("Home");
  await body.press("Tab");
  await expect(body).toHaveText("  out = vec4f(1.0);");
});

test("a Note node holds text on the canvas and in its panel, and saves it", async ({ page }) => {
  const sent: string[] = [];
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
  await page.locator(".palette-group", { has: page.locator("h4", { hasText: "Structure" }) }).getByRole("button", { name: "Note" }).click();
  const note = page.locator(".pnode", { has: page.locator(".pnode-note") });
  await expect(note).toBeVisible();
  await expect(note.locator(".pnode-port")).toHaveCount(0);
  await note.click();
  const text = page.locator(".patch-side").getByLabel("Note text");
  await text.fill("Turn the twist knob first.");
  await expect(note.locator(".pnode-note")).toHaveText("Turn the twist knob first.");
  await expect
    .poll(() => sent.some((m) => m.includes('"patch_save"') && m.includes('"kind":"note"') && m.includes('"text":"Turn the twist knob first."')))
    .toBe(true);
});
