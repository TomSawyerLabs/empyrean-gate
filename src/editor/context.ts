// What node views and side panels need from the editor without threading it
// through React Flow's node data: which patch is on air (minis flow only for
// it), the mini source, the wire being dragged, and the node actions a node
// view offers itself (minimize).

import { createContext } from "react";
import type { DragFrom } from "./connect";
import type { MiniSource } from "./minis";

/** A wire being dragged: where it started, so every port can say whether it
 * would take the other end. */
export type WireDrag = DragFrom & { node: string; port: string };

export const NodeContext = createContext<{
  activeId: string | null;
  minis: MiniSource | null;
  drag: WireDrag | null;
  /** Whether an input that already has a wire would take the one being
   * dragged by putting a combiner in between (see combine.ts). */
  combines: (node: string, port: string) => boolean;
  /** Minimize or expand a node; null when the patch can't be edited. */
  setCollapsed: ((node: string, collapsed: boolean) => void) | null;
  /** Remove a wire by its flow edge id; null when the patch can't be edited. */
  deleteWire: ((edge: string) => void) | null;
}>({
  activeId: null,
  minis: null,
  drag: null,
  combines: () => false,
  setCollapsed: null,
  deleteWire: null,
});
