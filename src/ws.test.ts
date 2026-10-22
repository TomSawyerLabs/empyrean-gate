// The mini-preview batch as the gate encodes it (`encode_minis` in
// src-tauri/src/server.rs, layout at MINI_PREVIEW_MAGIC in protocol.rs).

import { describe, expect, test } from "bun:test";
import { parseMiniBatch } from "./ws";

/** A patch batch of 2 spokes × 1 pixel: one cell, one meter, and with
 * `detail`, a tail of one Full detail cell at 3 pixels. */
function encoded(detail: boolean): ArrayBuffer {
  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 0xff, v >> 8);
  const u32 = (v: number) => {
    u16(v & 0xffff);
    u16(v >>> 16);
  };
  u32(0x45474d56);
  u32(7);
  u16(2);
  u16(1);
  bytes.push(1, 0);
  u16(1);
  u16(1);
  u16(0);
  u16(0);
  u16(0);
  bytes.push(1, 2, 3, 4, 5, 6);
  u16(0);
  u16(0);
  bytes.push(...new Uint8Array(new Float32Array([0.5]).buffer));
  if (detail) {
    u16(3);
    u16(1);
    u16(0);
    u16(0);
    bytes.push(...Array.from({ length: 18 }, (_, i) => 100 + i));
  }
  return new Uint8Array(bytes).buffer;
}

describe("a mini-preview batch", () => {
  test("without a tail has no Full detail cells", () => {
    const batch = parseMiniBatch(encoded(false))!;
    expect(batch.kind).toBe(1);
    expect(Array.from(batch.cells[0]!.rgb)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(batch.scalars).toEqual([{ id: 0, value: 0.5 }]);
    expect(batch.detail).toBeUndefined();
  });

  test("with one carries its cells at their own pixel count", () => {
    const batch = parseMiniBatch(encoded(true))!;
    expect(batch.detail?.pixels).toBe(3);
    expect(batch.detail?.cells).toHaveLength(1);
    expect(batch.detail?.cells[0]!.id).toBe(0);
    expect(Array.from(batch.detail!.cells[0]!.rgb)).toEqual(Array.from({ length: 18 }, (_, i) => 100 + i));
  });

  test("a cut-off tail is refused, not misread", () => {
    expect(parseMiniBatch(encoded(true).slice(0, -1))).toBeNull();
  });
});
