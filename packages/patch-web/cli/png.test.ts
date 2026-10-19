import { expect, test } from "bun:test";
import { encodePng, toBase64 } from "../src/runtime/ring";
import { decodeDataUrl, decodePng } from "./png";

test("a PNG the runtime encodes decodes back to the same pixels", async () => {
  const width = 7;
  const height = 5;
  const rgba = new Uint8Array(width * height * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
  const png = await encodePng({ width, height, rgba });
  expect(decodePng(png)).toEqual({ width, height, rgba });
});

test("a data URL picture comes out square at the asked size", async () => {
  const rgba = new Uint8Array(4 * 2 * 4).fill(200);
  const png = await encodePng({ width: 4, height: 2, rgba });
  const out = await decodeDataUrl(`data:image/png;base64,${toBase64(png)}`, 3);
  expect(out.length).toBe(3 * 3 * 4);
  expect(out[0]).toBe(200);
  await expect(decodeDataUrl("data:image/webp;base64,AAAA", 3)).rejects.toThrow();
});
