// The gate's mini visualizers: the shared MiniRing/MiniMeter (packages/patch-web)
// fed by this client's mini-preview stream. Mounting any of them starts the
// stream; unmounting the last one stops it.

import {
  MiniMeter as SharedMeter,
  MiniRing as SharedRing,
  MiniTap as SharedTap,
  type PatchShape,
} from "@empyrean-gate/patch-web/editor";
import { getMiniHub } from "./miniPreview";
import { useGate } from "./state";

/** Ring thumbnail for `layer:<config index>` or `node:<patch node id>`. */
export function MiniRing({ mini, label }: { mini: string; label?: string }) {
  const { client } = useGate();
  return <SharedRing source={getMiniHub(client)} mini={mini} label={label} />;
}

/** Amplitude meter for one patch scalar output (`scalar:<node>:<port>`). */
export function MiniMeter({ mini, label }: { mini: string; label: string }) {
  const { client } = useGate();
  return <SharedMeter source={getMiniHub(client)} mini={mini} label={label} />;
}

/** A Debug node's view of what it watches: a ring, or a large meter. */
export function MiniTap({ id, shape, label }: { id: string; shape: PatchShape; label: string }) {
  const { client } = useGate();
  return <SharedTap source={getMiniHub(client)} id={id} shape={shape} label={label} />;
}
