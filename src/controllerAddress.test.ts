// Controller list parsing must agree with the backend's `addressing::parse_entry`,
// or Settings would flag lines the backend accepts (or the reverse).
// `bun test src` (no browser, no Tauri).

import { expect, test } from "bun:test";
import { assignMac, canonicalMac, entryKind, parseControllerList } from "./controllerAddress";

test("entries classify like the backend: IP, MAC in any spelling, empty, invalid", () => {
  expect(entryKind("10.0.0.5")).toBe("ip");
  expect(entryKind(" 10.0.0.5 ")).toBe("ip");
  expect(entryKind("10.0.0.256")).toBe("invalid");
  expect(entryKind("")).toBe("empty");
  expect(entryKind("   ")).toBe("empty");
  for (const mac of ["00:50:C2:1A:2B:3C", "00:50:c2:1a:2b:3c", "00-50-C2-1A-2B-3C", "0050.c21a.2b3c", "0050C21A2B3C"]) {
    expect(entryKind(mac)).toBe("mac");
    expect(canonicalMac(mac)).toBe("00:50:C2:1A:2B:3C");
  }
  for (const bad of ["00:50-C2:1A:2B:3C", "00:50:C2:1A:2B", "0050C21A2B3", "pixlite-3"]) {
    expect(entryKind(bad)).toBe("invalid");
  }
});

test("the list keeps interior blank lines, because position assigns spokes", () => {
  expect(parseControllerList("10.0.0.1\n\n10.0.0.3\n\n\n")).toEqual(["10.0.0.1", "", "10.0.0.3"]);
  expect(parseControllerList("")).toEqual([]);
});

test("assigning a MAC pads to its position and moves it off any other position", () => {
  expect(assignMac([], 2, "00:50:c2:00:00:01")).toEqual(["", "", "00:50:C2:00:00:01"]);
  expect(assignMac(["00:50:C2:00:00:01", "10.0.0.2"], 1, "0050.c200.0001")).toEqual(["", "00:50:C2:00:00:01"]);
  expect(assignMac(["10.0.0.1", "00:50:C2:00:00:01"], 0, "00:50:C2:00:00:01")).toEqual(["00:50:C2:00:00:01"]);
});
