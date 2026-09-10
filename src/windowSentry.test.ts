// The sentry's judgement is pure: which of the other windows' records count
// as idle for this window. `bun test src` (no browser, no Tauri).

import { expect, test } from "bun:test";
import { idleWindows, type WindowRecord } from "./windowSentry";

const now = 1_000_000_000;
const rec = (label: string, tab: string, activeAgo: number, hidden: boolean, atAgo = 1000): WindowRecord =>
  ({ label, tab, at: now - atAgo, active: now - activeAgo, hidden });

test("hidden or same-tab windows idle for five minutes are offered; busy, other-tab or stale ones are not", () => {
  const records = [
    rec("main", "live", 0, false), // me
    rec("aux-live", "live", 6 * 60_000, false), // duplicate of my tab, idle
    rec("aux-control", "control", 6 * 60_000, true), // hidden, idle
    rec("aux-ready", "ready", 6 * 60_000, false), // other tab, visible: doing its job
    rec("aux-patch", "patch", 6 * 60_000, true, 60_000), // stale heartbeat: gone
    rec("aux-games", "live", 30_000, false), // duplicate but busy
  ];
  expect(idleWindows(records, "main", "live", now).map((w) => `${w.label}:${w.reason}`)).toEqual([
    "aux-live:duplicate",
    "aux-control:hidden",
  ]);
});
