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
  const group = page.locator(".palette-group", { has: page.locator("h4", { hasText: "Structure" }) });
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

test("a snippet goes in from completion, its fields linked, and Tab moves on", async ({ page }) => {
  const sent: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      if (typeof f.payload === "string") sent.push(f.payload);
    }),
  );
  const { panel, body } = await codeNode(page);
  await body.fill("");
  await body.pressSequentially("ripp");
  const selected = panel.locator('.cm-tooltip-autocomplete [aria-selected="true"]');
  await expect(selected).toContainText("ripple");
  // CodeMirror ignores Enter for 75 ms after a list opens (a typist's guard).
  await page.waitForTimeout(150);
  await body.press("Enter");
  // The first field (the wave's name) is selected everywhere it appears.
  await body.pressSequentially("w");
  await expect(body).toContainText("let w = sin(c.rn * 12.0 - G.time * 2.0);");
  await expect(body).toContainText("out = vec4f(vec3f(0.5 + 0.5 * w), 1.0);");
  // Tab: the next field, the ring count.
  await body.press("Tab");
  await body.pressSequentially("20.0");
  await expect(body).toContainText("sin(c.rn * 20.0 -");
  await expect.poll(() => sent.some((m) => m.includes('"patch_save"') && m.includes("c.rn * 20.0"))).toBe(true);
});

test("inside a call, its signature shows with the argument being typed in bold", async ({ page }) => {
  const { panel, body } = await codeNode(page);
  await body.fill("out = vec4f(mix(0.2, ");
  await body.press("ControlOrMeta+End");
  const sig = panel.locator(".code-signature");
  await expect(sig.locator("code")).toHaveText("mix(a, b, t)");
  await expect(sig.locator("b")).toHaveText("b");
  await body.pressSequentially("0.8, ");
  await expect(sig.locator("b")).toHaveText("t");
  // Closing the call returns to the outer one.
  await body.pressSequentially("0.5)");
  await expect(sig.locator("code")).toHaveText("vec4f(x, y, z, w)");
  await expect(sig.locator("b")).toHaveText("x");
});

test("an error's quick fixes are buttons under it and actions on its mark", async ({ page }) => {
  // The mock does not compile bodies; it reports what a real host would for
  // the body typed below (the GPU check's wording for line 2).
  const client = `code-fixes-${Date.now()}`;
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), client);
  await page.request.post(`/mock/status?client=${client}`, {
    data: {
      patch_error:
        "Code node \"fixme\" line 1:9: unresolved call target 'hsv2rbg'\n" +
        'Code node "fixme" line 2:1: return a value: assign the output by name instead (`out = …;`), then `return;` if the body must stop early',
    },
  });
  const { panel, body } = await codeNode(page);
  await panel.getByLabel("Name", { exact: true }).fill("fixme");
  await body.fill("let w = hsv2rbg(0.5, 1.0, 1.0);\nreturn vec4f(w, 1.0);");

  const buttons = panel.locator(".code-fixes button");
  await expect(buttons).toHaveText(["Change to `hsv2rgb`", "Assign `out` instead"]);
  await buttons.filter({ hasText: "Assign" }).click();
  await expect(body).toHaveText("let w = hsv2rbg(0.5, 1.0, 1.0);out = vec4f(w, 1.0);");

  // The other through the mark's own tooltip.
  await panel.locator(".cm-lintRange-error").first().hover();
  await panel.locator(".cm-tooltip-lint .cm-diagnosticAction", { hasText: "Change to `hsv2rgb`" }).click();
  await expect(body).toHaveText("let w = hsv2rgb(0.5, 1.0, 1.0);out = vec4f(w, 1.0);");
});

test("the large view lists what the body can use beside it, and sets its text size", async ({ page }) => {
  const { panel, body } = await codeNode(page);
  await body.fill("out = vec4f(");
  await body.press("ControlOrMeta+End");
  await panel.getByRole("button", { name: "Open the body in a bigger editor" }).click();
  const modal = page.locator("dialog.code-modal");
  const big = modal.getByLabel("Body (WGSL)");
  const column = modal.getByRole("complementary", { name: "What the body can use" });
  await expect(column).toBeVisible();

  // A helper goes in at the caret, the caret inside its parentheses.
  await column.getByLabel("Filter what the body can use").fill("hsv");
  await column.locator(".code-refcol-item", { hasText: "hsv2rgb" }).click();
  await big.pressSequentially("0.5, 1.0, 1.0");
  await expect(big).toHaveText("out = vec4f(hsv2rgb(0.5, 1.0, 1.0)");
  // A snippet from the list, at the caret too.
  await big.press("ControlOrMeta+End");
  await big.pressSequentially("), 1.0);\n");
  await column.getByLabel("Filter what the body can use").fill("ripple");
  await column.locator(".code-refcol-item", { hasText: "ripple" }).click();
  await expect(big).toContainText("let wave = sin(c.rn * 12.0");

  // Text size, remembered.
  const scroller = modal.locator(".cm-scroller");
  const size = () => scroller.evaluate((e) => getComputedStyle(e).fontSize);
  expect(await size()).toBe("14px");
  await modal.getByRole("button", { name: "Larger text" }).click();
  await modal.getByRole("button", { name: "Larger text" }).click();
  expect(await size()).toBe("16px");
  await modal.getByRole("button", { name: "Reference" }).click();
  await expect(column).toHaveCount(0);
  await modal.getByRole("button", { name: "Done" }).click();
  await panel.getByRole("button", { name: "Open the body in a bigger editor" }).click();
  await expect(modal.locator(".cm-scroller")).toBeVisible();
  expect(await size()).toBe("16px");
  await expect(column).toHaveCount(0);
});

/** Page coordinates of the middle of `text` in the body editor under `root`. */
async function textPoint(page: Page, root: string, text: string) {
  return page.evaluate(
    ([sel, t]) => {
      const content = document.querySelector(`${sel} .cm-content`)!;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent!.indexOf(t);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        const box = r.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      throw new Error(`no ${t}`);
    },
    [root, text] as const,
  );
}

test("Alt-drag scrubs a number live, and one undo puts it back", async ({ page }) => {
  const sent: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      if (typeof f.payload === "string") sent.push(f.payload);
    }),
  );
  const { body } = await codeNode(page);
  await body.fill("let k = 0.5;\nout = vec4f(vec3f(k), 1.0);");
  const at = await textPoint(page, ".patch-side", "0.5");
  await page.keyboard.down("Alt");
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 20, at.y, { steps: 4 });
  // Live: the body (and so the patch) changes during the drag.
  await expect(body).toContainText("let k = 1.0;");
  await page.mouse.move(at.x + 40, at.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(body).toContainText("let k = 1.5;");
  await expect.poll(() => sent.some((m) => m.includes('"patch_save"') && m.includes("let k = 1.5;"))).toBe(true);
  // The whole drag is one step back.
  await body.press("ControlOrMeta+z");
  await expect(body).toContainText("let k = 0.5;");

  // Off a number, Alt-drag is still a column selection: a caret per line.
  const lines = page.locator(".patch-side .cm-line");
  const top = (await lines.nth(0).boundingBox())!;
  const below = (await lines.nth(1).boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(top.x + 10, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(top.x + 10, below.y + below.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  // What a caret per line does (counting the drawn carets is not reliable
  // on Linux): one keystroke lands on both lines.
  await page.keyboard.type("#");
  await expect(body).toHaveText(/^[^;#]*#[^;#]*;[^;#]*#[^#]*$/);
});

test("a colour in literals gets a swatch, and picking rewrites it as one step", async ({ page }) => {
  const { panel, body } = await codeNode(page);
  await body.fill("out = vec4f(1.0, 0.5, 0.0, 1.0);");
  const swatch = panel.locator(".code-swatch");
  await expect(swatch).toHaveCount(1);
  await expect(swatch).toHaveCSS("background-color", "rgb(255, 128, 0)");
  await swatch.click();
  // The platform picker stands in for a person: the hidden input it serves.
  const input = page.locator(".code-swatch-input");
  await expect(input).toHaveValue("#ff8000");
  await input.evaluate((el: HTMLInputElement) => {
    for (const hex of ["#00ff00", "#0000ff"]) {
      el.value = hex;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(body).toHaveText("out = vec4f(0.0, 0.0, 1.0, 1.0);");
  await expect(swatch).toHaveCSS("background-color", "rgb(0, 0, 255)");
  await body.press("ControlOrMeta+z");
  await expect(body).toHaveText("out = vec4f(1.0, 0.5, 0.0, 1.0);");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the large view has a key row, and scrub mode makes a drag on a number scrub", async ({ page }) => {
    await page.goto("/#patch");
    await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
    await page.locator(".patch-name-chip").click();
    await page.getByRole("button", { name: "＋ Blank patch" }).click();
    await page.getByRole("button", { name: "Add node" }).click();
    const group = page.locator(".palette-group", { has: page.locator("h4", { hasText: "Structure" }) });
    await group.getByRole("button", { name: "Code" }).click();
    await page.locator(".pnode.cat-code").click();
    await page.getByRole("button", { name: /settings/ }).click();
    await page.locator(".patch-side.patch-sheet").getByRole("button", { name: "Open the body in a bigger editor" }).click();
    const modal = page.locator("dialog.code-modal");
    const body = modal.getByLabel("Body (WGSL)");
    const keys = modal.getByRole("toolbar", { name: "Code keys" });
    await expect(keys).toBeVisible();

    await body.fill("let k = 0.5;\nout = vec4f");
    await body.press("ControlOrMeta+End");
    await keys.getByRole("button", { name: "(", exact: true }).click();
    // The key goes through CodeMirror's input handlers: `(` brings its `)`.
    await expect(body).toHaveText("let k = 0.5;out = vec4f()");
    await expect(body).toBeFocused();
    await body.press("ControlOrMeta+Home");
    await keys.getByRole("button", { name: "Tab" }).click();
    await expect(body).toHaveText("  let k = 0.5;out = vec4f()");

    // Scrub mode: a touch drag on the number changes it.
    const scrub = keys.getByRole("button", { name: "Scrub numbers by dragging" });
    await scrub.click();
    await expect(scrub).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => {
      const content = document.querySelector("dialog.code-modal .cm-content")!;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let box: DOMRect | null = null;
      for (let n = walker.nextNode(); n && !box; n = walker.nextNode()) {
        const i = n.textContent!.indexOf("0.5");
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 3);
        box = r.getBoundingClientRect();
      }
      const x = box!.x + box!.width / 2;
      const y = box!.y + box!.height / 2;
      const ev = (type: string, dx: number) =>
        new PointerEvent(type, { pointerType: "touch", clientX: x + dx, clientY: y, bubbles: true, cancelable: true });
      content.dispatchEvent(ev("pointerdown", 0));
      window.dispatchEvent(ev("pointermove", 20));
      window.dispatchEvent(ev("pointerup", 20));
    });
    await expect(body).toHaveText("  let k = 1.0;out = vec4f()");
  });
});
