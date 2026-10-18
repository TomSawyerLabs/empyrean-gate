// What the mini visualizers read, without the visualizers: the source
// interface and the meter history. Kept apart from minis.tsx (React, CSS) so
// a runtime with no editor, such as the command line's, can be a MiniSource.

/** How many scalar samples a meter keeps (~4 s at a 10 Hz batch rate). */
export const SCALAR_HISTORY = 40;

export interface MiniScalar {
  values: number[];
  latest: number;
}

/** Thumbnails and meters for whatever is rendering. Keys: `node:<id>` /
 * `layer:<index>` cells (3-byte RGB, `spokes × pixels`) and
 * `scalar:<node>:<port>` meters. Mounting a widget retains the source;
 * unmounting the last one releases it, so sources only work while watched. */
export interface MiniSource {
  spokes: number;
  pixels: number;
  cells: Map<string, Uint8Array>;
  scalars: Map<string, MiniScalar>;
  retain(): void;
  release(): void;
  onChange(listener: () => void): () => void;
}

/** Append a meter sample, keeping [`SCALAR_HISTORY`] of them. */
export function pushScalar(scalars: Map<string, MiniScalar>, key: string, value: number) {
  let entry = scalars.get(key);
  if (!entry) {
    entry = { values: [], latest: 0 };
    scalars.set(key, entry);
  }
  entry.latest = value;
  entry.values.push(value);
  if (entry.values.length > SCALAR_HISTORY) entry.values.shift();
}
