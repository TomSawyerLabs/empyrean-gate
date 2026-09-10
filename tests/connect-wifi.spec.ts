// The connect dialog grows a second, separated QR for the venue Wi-Fi once the
// operator has typed the credentials in, and the Gate machine gets a poster
// link carrying the long-term staff token.

import { expect, test } from "@playwright/test";

test("Wi-Fi credentials add a numbered second code and a poster link", async ({ page, request }) => {
  await request.post("/mock/reset-config");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#settings");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });

  // Controlled input: it flips when the backend echoes the config, not on the
  // click itself, so wait for the state rather than demanding it at once.
  const enable = page.getByRole("checkbox", { name: /join the Wi-Fi/ });
  await enable.click();
  await expect(enable).toBeChecked();
  await page.getByRole("textbox", { name: /Network \(SSID\)/ }).fill("Playa; Guest");
  await page.getByRole("textbox", { name: /^Password/ }).fill("dust:storm");

  await page.getByRole("button", { name: "Connect a device" }).click();
  const modal = page.locator(".connect-modal");
  await expect(modal).toHaveClass(/with-wifi/);
  await expect(modal.locator(".connect-code h3")).toHaveText(["1 · Join the Wi-Fi", "2 · Open the show"]);
  // Escaped payload: ';' and ':' inside the fields are backslashed.
  const wifiQr = modal.locator(".connect-code").first().locator("img.qr");
  const src = decodeURIComponent((await wifiQr.getAttribute("src")) ?? "");
  expect(src).toContain("WIFI:T:WPA;S:Playa\\; Guest;P:dust\\:storm;;");
  // The two codes never share a box.
  const boxes = await modal.locator("img.qr").evaluateAll((imgs) =>
    imgs.map((img) => img.getBoundingClientRect()),
  );
  expect(boxes).toHaveLength(2);
  expect(boxes[1].left).toBeGreaterThan(boxes[0].right + 20);

  const poster = modal.getByRole("link", { name: /Poster for event staff/ });
  await expect(poster).toBeVisible();
  const href = (await poster.getAttribute("href")) ?? "";
  expect(href).toContain("/poster.html?");
  // The poster carries the long-term staff token, not the everyday one.
  expect(href).toContain("join%3Dmock-staff-token");
  expect(href).not.toContain("mock-join-token");
});

test("without credentials the dialog is the single code it always was", async ({ page, request }) => {
  await request.post("/mock/reset-config");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/#live");
  await page.locator('.app[data-connected="yes"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Connect a device" }).click();
  const modal = page.locator(".connect-modal");
  await expect(modal).not.toHaveClass(/with-wifi/);
  await expect(modal.locator("img.qr")).toHaveCount(1);
});
