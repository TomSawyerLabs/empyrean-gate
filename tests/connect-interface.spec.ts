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

// Once a public URL exists it is the venue QR: the dialog opens on it, the
// LAN join link stays a tap away for crew, and the poster carries the public
// address instead of a token that could go stale.
test("a public URL becomes the default QR and the poster's address", async ({ page }) => {
  const clientId = `connect-public-${Date.now()}`;
  await page.addInitScript((id) => localStorage.setItem("empyrean-client-id", id), clientId);
  await page.request.post(`/mock/config?client=${clientId}`, {
    data: {
      public: {
        enabled: true,
        bind: "127.0.0.1",
        port: 9521,
        url: "https://play.example.com",
        trust_forwarded_headers: true,
        open: true,
        allow_draw: true,
        allow_effects: true,
        allow_games: true,
        allow_knobs: false,
        input_level: 1,
        preview_fps: 0,
        preview_decimate: 12,
        max_connections: 300,
        max_per_ip: 6,
        messages_per_second: 40,
        keys: [],
      },
    },
  });
  await openConnect(page);
  const access = page.getByRole("group", { name: "Access level" });
  await expect(access.getByRole("button", { name: "Public" })).toHaveClass(/active/);
  await expect(page.locator(".join-url")).toHaveText("https://play.example.com");
  await expect(page.getByRole("link", { name: /Poster for event staff/ })).toHaveAttribute(
    "href",
    /url=https%3A%2F%2Fplay\.example\.com/,
  );
  // Crew still get the LAN link with its token.
  await access.getByRole("button", { name: "Guest" }).click();
  await expect(page.locator(".join-url")).toContainText("/?join=mock-join-token");
});
