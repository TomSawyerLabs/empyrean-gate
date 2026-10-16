import { describe, expect, test } from "bun:test";
import { COALESCE_MS, History } from "./history";

describe("History", () => {
  test("undo and redo walk the snapshots", () => {
    const h = new History<string>();
    expect(h.canUndo).toBe(false);
    h.push("a");
    h.push("b");
    expect(h.canUndo).toBe(true);
    expect(h.undo("c")).toBe("b");
    expect(h.undo("b")).toBe("a");
    expect(h.undo("a")).toBeNull();
    expect(h.canRedo).toBe(true);
    expect(h.redo("a")).toBe("b");
    expect(h.redo("b")).toBe("c");
    expect(h.redo("c")).toBeNull();
  });

  test("a new edit after undo drops the redo branch", () => {
    const h = new History<string>();
    h.push("a");
    h.undo("b");
    h.push("a");
    expect(h.canRedo).toBe(false);
  });

  test("edits on the same control in quick succession are one step", () => {
    const h = new History<string>();
    h.push("v0", "n1.hue", 1000);
    h.push("v1", "n1.hue", 1200);
    h.push("v2", "n1.hue", 1400);
    expect(h.undo("v3")).toBe("v0");
    // After the window, or on another control, a new step starts.
    h.clear();
    h.push("v0", "n1.hue", 1000);
    h.push("v1", "n1.hue", 1000 + COALESCE_MS + 1);
    h.push("v2", "n1.sat", 1000 + COALESCE_MS + 2);
    expect(h.undo("v3")).toBe("v2");
    expect(h.undo("v2")).toBe("v1");
    expect(h.undo("v1")).toBe("v0");
  });

  test("the same snapshot pushed twice is one step, and the stack is bounded", () => {
    const h = new History<string>(3);
    h.push("a");
    h.push("a");
    expect(h.undo("b")).toBe("a");
    expect(h.undo("a")).toBeNull();
    for (const s of ["1", "2", "3", "4", "5"]) h.push(s);
    expect(h.undo("6")).toBe("5");
    expect(h.undo("5")).toBe("4");
    expect(h.undo("4")).toBe("3");
    expect(h.undo("3")).toBeNull();
  });
});
