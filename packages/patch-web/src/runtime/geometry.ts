// The array's shape, on its own so code that only draws it (ring.ts, the
// editor's thumbnails) does not pull in the patch core and its wasm.

export interface Geometry {
  spokes: number;
  pixels: number;
  /** Inner radius over outer radius. */
  innerOverOuter: number;
}
