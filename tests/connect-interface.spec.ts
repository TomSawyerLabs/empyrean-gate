// The connect QR's interface picker remembers the OPERATOR'S CHOICE, not the
// address that choice happened to resolve to. Ethernet addresses come from
// DHCP: remembering the bare IP meant the stored value stopped matching at the
// next venue and the picker silently fell back to the first interface, so
// "Ethernet" had to be re-picked every single time the dialog opened.
//
// The mock backend reports two interfaces:
//   "Ethernet — 10.255.0.77"  (first: the fallback)
//   "Wi-Fi — 192.168.1.50"

import { expect, test } from "@playwright/test";

const KEY = "empyrean-connect-interface";

async function openConnect(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Connect a device" }).click();
  await expect(page.locator(".modal h2")).toHaveText("Connect a device");
}

test("picking an interface stores its name, not its address", async ({ page }) => {
  await openConnect(page);
  await page.locator(".modal select").selectOption("192.168.1.50");
  await expect(page.locator(".join-url")).toContainText("192.168.1.50");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("Wi-Fi");
});

test("the pick survives its interface getting a new DHCP address", async ({ page }) => {
  // Stored on a previous night, when Wi-Fi held some other lease. Only the
  // name is stored, so whatever address Wi-Fi has TODAY is what the QR uses.
  await page.addInitScript((k) => localStorage.setItem(k, "Wi-Fi"), KEY);
  await openConnect(page);
  await expect(page.locator(".modal select")).toHaveValue("192.168.1.50");
  await expect(page.locator(".join-url")).toContainText("192.168.1.50");
});

test("a bare address stored by an older build still matches", async ({ page }) => {
  await page.addInitScript((k) => localStorage.setItem(k, "192.168.1.50"), KEY);
  await openConnect(page);
  await expect(page.locator(".modal select")).toHaveValue("192.168.1.50");
});

test("a pick that no longer exists falls back to the first interface", async ({ page }) => {
  await page.addInitScript((k) => localStorage.setItem(k, "USB LAN"), KEY);
  await openConnect(page);
  await expect(page.locator(".modal select")).toHaveValue("10.255.0.77");
  await expect(page.locator(".join-url")).toContainText("10.255.0.77");
});
