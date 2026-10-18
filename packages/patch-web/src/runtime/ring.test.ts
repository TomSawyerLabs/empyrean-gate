import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { contactSheet, encodePng, frameStats, renderRing, toBase64 } from "./ring";

const G = { spokes: 8, pixels: 16, innerOverOuter: 0.32 };

function frame(fill: (spoke: number, led: number) => [number, number, number]): Uint8Array {
  const rgb = new Uint8Array(G.spokes * G.pixels * 3);
  for (let s = 0; s < G.spokes; s++)
    for (let i = 0; i < G.pixels; i++) rgb.set(fill(s, i), (s * G.pixels + i) * 3);
  return rgb;
}

function at(pic: { width: number; rgba: Uint8Array }, x: number, y: number): number[] {
  const p = (y * pic.width + x) * 4;
  return [...pic.rgba.subarray(p, p + 4)];
}

describe("renderRing", () => {
  test("a dark frame is the background, opaque", () => {
    const pic = renderRing(frame(() => [0, 0, 0]), G, { size: 64 });
    expect(pic.width).toBe(64);
    expect(pic.rgba.length).toBe(64 * 64 * 4);
    expect(at(pic, 10, 10)).toEqual([0, 0, 0, 255]);
  });

  test("spoke 0 is at the bottom and LED 0 is its outer end", () => {
    // Only spoke 0's outermost LED, red.
    const pic = renderRing(
      frame((s, i) => (s === 0 && i === 0 ? [255, 0, 0] : [0, 0, 0])),
      G,
      { size: 100 },
    );
    // Outer edge at 0.96 of the half size: y = 50 + 48 = 98, centered in x.
    expect(at(pic, 50, 97)[0]).toBeGreaterThan(100);
    expect(at(pic, 50, 2)[0]).toBe(0);
    expect(at(pic, 50, 50)[0]).toBe(0);
  });

  test("the hole in the middle stays dark when everything is lit", () => {
    const pic = renderRing(frame(() => [255, 255, 255]), G, { size: 128 });
    expect(at(pic, 64, 64)).toEqual([0, 0, 0, 255]);
  });
});

describe("contactSheet", () => {
  test("lays pictures out in a grid with gaps", () => {
    const a = renderRing(frame(() => [255, 0, 0]), G, { size: 20 });
    const sheet = contactSheet([a, a, a], 2, 3);
    expect(sheet.width).toBe(43);
    expect(sheet.height).toBe(43);
    // The gap column between the first two.
    expect(at(sheet, 21, 5)).toEqual([24, 24, 24, 255]);
  });
});

describe("encodePng", () => {
  test("writes a PNG whose pixels decode back", async () => {
    const pic = { width: 2, height: 2, rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 255]) };
    const png = await encodePng(pic);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(2);
    expect(view.getUint32(20)).toBe(2);
    // IDAT follows IHDR (8 signature + 25 IHDR chunk).
    const len = view.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe("IDAT");
    const raw = inflateSync(png.subarray(41, 41 + len));
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 9, 9, 9]);
    expect(toBase64(png).startsWith("iVBORw0KGgo")).toBe(true);
  });
});

describe("frameStats", () => {
  test("black is unlit with no colors", () => {
    const s = frameStats(frame(() => [0, 0, 0]), G);
    expect(s.lit).toBe(0);
    expect(s.mean).toBe(0);
    expect(s.colors).toEqual([]);
  });

  test("names the hues and where the light is", () => {
    // Outer half red, inner half blue, only on the first half of the spokes.
    const s = frameStats(
      frame((sp, i) => (sp >= G.spokes / 2 ? [0, 0, 0] : i < G.pixels / 2 ? [255, 0, 0] : [0, 0, 255])),
      G,
    );
    expect(s.lit).toBe(0.5);
    expect(s.peak).toBe(1);
    expect(s.colors.map((c) => c.name).sort()).toEqual(["blue", "red"]);
    expect(s.angular.slice(0, 4).every((v) => v === 1)).toBe(true);
    expect(s.angular.slice(4).every((v) => v === 0)).toBe(true);
    expect(s.radial.every((v) => v === 0.5)).toBe(true);
  });

  test("unsaturated light is white", () => {
    const s = frameStats(frame(() => [200, 200, 210]), G);
    expect(s.colors[0]!.name).toBe("white");
  });
});
