// What node views and side panels need from the editor without threading it
// through React Flow's node data: which patch is on air (minis flow only for
// it), the mini source, and the wire being dragged.

import { createContext } from "react";
import type { DragFrom } from "./connect";
import type { MiniSource } from "./minis";

/** A wire being dragged: where it started, so every port can say whether it
 * would take the other end. */
export type WireDrag = DragFrom & { node: string };

export const NodeContext = createContext<{
  activeId: string | null;
  minis: MiniSource | null;
  drag: WireDrag | null;
}>({
  activeId: null,
  minis: null,
  drag: null,
});
