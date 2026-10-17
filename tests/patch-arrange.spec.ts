// Arrange: one button lays the graph out left to right by its wires, as one
// undo step (asked for 2026-10-17: "mermaid diagrams are able to do it,
// stably even"). The layout itself is unit-tested in patch-web; this checks
// the button, the undo, and that the result has no two nodes on top of each
// other.

import { expect, test, type Page } from "@playwright/test";

interface Placed {
  id: string;
  label: string;
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Every node: its document position (the transform) and its screen box. */
function placed(page: Page): Promise<Placed[]> {
  return page.locator(".react-flow__node").evaluateAll((els) =>
    els.map((el) => {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((el as HTMLElement).style.transform);
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-id") ?? "",
        label: el.querySelector(".pnode-head")?.textContent ?? "",
        x: Number(m?.[1]),
        y: Number(m?.[2]),
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      };
    }),
  );
}

function overlap(a: Placed, b: Placed): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

test("Arrange spreads the graph source → Output, and Undo puts it back", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "＋ New" }).click();
  // Two more nodes, which land on top of each other at the canvas centre.
  await page.locator(".palette-item", { hasText: "Noise" }).click();
  await page.locator(".palette-item", { hasText: "Noise" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  const before = await placed(page);
  expect(before.some((a) => before.some((b) => a.id !== b.id && overlap(a, b)))).toBe(true);

  await page.getByRole("button", { name: "⇆ Arrange" }).click();
  // fitView animates for 250 ms.
  await page.waitForTimeout(500);
  const after = await placed(page);
  for (const a of after) for (const b of after) if (a.id < b.id) expect(overlap(a, b), `${a.label} / ${b.label}`).toBe(false);
  const output = after.find((n) => n.label.startsWith("Output"))!;
  const wired = after.find((n) => n.id === "n1")!;
  expect(output.x).toBeGreaterThan(wired.x);
  // The positions are in the document, so they persist and they undo.
  await page.getByRole("button", { name: "↶ Undo" }).click();
  const back = await placed(page);
  for (const n of before) {
    const b = back.find((m) => m.id === n.id)!;
    expect([b.x, b.y]).toEqual([n.x, n.y]);
  }
  // And it is deterministic: arranging twice lands on the same spots.
  await page.getByRole("button", { name: "⇆ Arrange" }).click();
  await page.waitForTimeout(500);
  const again = await placed(page);
  for (const n of after) {
    const b = again.find((m) => m.id === n.id)!;
    expect([b.x, b.y]).toEqual([n.x, n.y]);
  }
});

test("on a phone, Arrange is in the patch menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#patch");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.locator(".patch-name-chip").click();
  await page.getByRole("button", { name: "＋ Blank patch" }).click();
  await page.locator(".patch-name-chip").click();
  await page.getByRole("button", { name: "⇆ Arrange" }).click();
  await expect(page.locator(".patch-menu")).toHaveCount(0);
  const nodes = await placed(page);
  expect(nodes.length).toBe(2);
  expect(overlap(nodes[0], nodes[1])).toBe(false);
});
