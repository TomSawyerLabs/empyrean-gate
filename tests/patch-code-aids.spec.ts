// The Code body editor's aids (plans/code-node.md, round 6): search and
// several carets, snippets, signature help, quick fixes, the large view's
// reference column and text size, number scrubbing, colour swatches, the
// phone key row and live values.

import { expect, test, type Page } from "@playwright/test";

/** A new patch holding one Code node (the GPU starter), its panel open. */
async function codeNode(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  await expect(page.locator(".pnode")).toHaveCount(2);
  const group = page.locator(".palette-group", { has: page.locator("h4", { hasText: "Code" }) });
  await group.getByRole("button", { name: "Code" }).click();
  const node = page.locator(".pnode.cat-code");
  await node.click();
  const panel = page.locator(".patch-side");
  return { node, panel, body: panel.getByLabel("Body (WGSL)") };
}

test("Ctrl+F searches the body, and Ctrl+D adds a caret at each next match", async ({ page }) => {
  const { panel, body } = await codeNode(page);
  await body.fill("let k = 0.5;\nout = vec4f(k, k, k, 1.0);");
  await body.press("ControlOrMeta+Home");
  await body.press("ArrowRight");
  await body.press("ArrowRight");
  await body.press("ArrowRight");
  await body.press("ArrowRight");
  for (let i = 0; i < 4; i++) await body.press("ControlOrMeta+d");
  await body.pressSequentially("q");
  await expect(body).toHaveText("let q = 0.5;out = vec4f(q, q, q, 1.0);");

  await body.press("ControlOrMeta+f");
  const find = panel.locator(".cm-search input[name=search]");
  await expect(find).toBeFocused();
  await find.pressSequentially("vec4f");
  await expect(panel.locator(".cm-searchMatch")).toHaveCount(1);
  // Esc closes the search, not the panel around it.
  await find.press("Escape");
  await expect(panel.locator(".cm-search")).toHaveCount(0);
  await expect(panel).toBeVisible();

  // In the large view too: Esc closes the search and leaves the dialog open.
  await panel.getByRole("button", { name: "Open the body in a bigger editor" }).click();
  const modal = page.locator("dialog.code-modal");
  await modal.getByLabel("Body (WGSL)").press("ControlOrMeta+f");
  await modal.locator(".cm-search input[name=search]").press("Escape");
  await expect(modal.locator(".cm-search")).toHaveCount(0);
  await expect(modal).toBeVisible();
});
