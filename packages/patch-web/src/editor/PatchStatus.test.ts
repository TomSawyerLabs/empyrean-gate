import { describe, expect, test } from "bun:test";
import { liveness, STALL_MS } from "./PatchStatus";

describe("liveness", () => {
  const ok = { active: true, error: null };

  test("an active patch is live", () => {
    expect(liveness(ok, 0)).toBe("live");
    expect(liveness({ ...ok, beat: 4 }, STALL_MS - 1)).toBe("live");
  });

  test("beats that stop are a stall", () => {
    expect(liveness({ ...ok, beat: 4 }, STALL_MS)).toBe("stalled");
  });

  test("paused frame by frame is not a stall", () => {
    expect(liveness({ ...ok, beat: 4 }, STALL_MS * 10, true)).toBe("paused");
    expect(liveness({ active: false, error: null }, 0, true)).toBe("idle");
  });

  test("a host without beats can't stall", () => {
    expect(liveness(ok, STALL_MS * 10)).toBe("live");
  });

  test("nothing active is idle, an error alone included", () => {
    expect(liveness({ active: false, error: null }, 0)).toBe("idle");
    expect(liveness({ active: false, error: "no Output" }, 0)).toBe("idle");
  });

  test("a host that can't render says so, whatever else is true", () => {
    const unavailable = { label: "no WebGPU", reason: "This browser does not support WebGPU." };
    expect(liveness({ active: false, error: null, unavailable }, 0)).toBe("unavailable");
    expect(liveness({ active: false, error: "no Output", unavailable }, 0)).toBe("unavailable");
  });
});
