// Long-press / right-click as one gesture: "open this thing's detail".
//
// A show surface is driven by fingers in the dark and by a mouse from the booth,
// so the same affordance has to answer both. `touch.ts` already suppresses the
// browser's own press-and-hold callout app-wide (it used to abort strokes
// mid-gesture), and its `preventDefault` does not stop propagation — so an
// element's own `onContextMenu` still fires and is ours to use.

import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

/** How long a finger has to rest before the press counts as a hold. */
const HOLD_MS = 450;
/** Movement that means the operator is scrolling or drawing, not holding. */
const SLOP_PX = 10;

export interface HoldMenuOptions {
  /** Where the gesture landed, in client coordinates. */
  onOpen: (x: number, y: number) => void;
  /** The control's ordinary activation. Skipped for the click a hold produces. */
  onClick?: () => void;
  /**
   * Open on a plain click too. For a control whose only job is to raise the
   * menu — Control's layer name — a tap should not have to become a hold. Live's
   * layer chips do not set this: there a tap already means "toggle".
   */
  openOnClick?: boolean;
  disabled?: boolean;
}

export interface HoldMenuProps {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
  onPointerLeave: (e: PointerEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
  onClick: (e: MouseEvent) => void;
}

/**
 * Props to spread onto a button so that holding it — or right-clicking it —
 * opens something, while a plain tap still does whatever it did before.
 */
export function useHoldMenu({
  onOpen,
  onClick,
  openOnClick,
  disabled,
}: HoldMenuOptions): HoldMenuProps {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  // Set when a hold fires, so the `click` that follows the finger lifting does
  // not also toggle the layer. Owning the click handler here is deliberate:
  // cancelling it from a capture-phase listener depends on how React simulates
  // propagation to a target's own handlers, which is not worth relying on.
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => cancel, []);

  return {
    onPointerDown: (e) => {
      // Right and middle buttons arrive as `contextmenu` / nothing; only a
      // primary contact can be a hold.
      if (disabled || e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        // A show surface is looked at, not felt, so confirm the hold landed.
        navigator.vibrate?.(12);
        onOpen(start.current.x, start.current.y);
      }, HOLD_MS);
    },
    onPointerMove: (e) => {
      if (!timer.current) return;
      if (
        Math.abs(e.clientX - start.current.x) > SLOP_PX ||
        Math.abs(e.clientY - start.current.y) > SLOP_PX
      ) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e) => {
      if (disabled) return;
      e.preventDefault();
      // A touch long-press raises `contextmenu` as well on Windows and iPadOS.
      // The hold already opened at the right place; don't reopen at this one.
      if (fired.current) return;
      cancel();
      onOpen(e.clientX, e.clientY);
    },
    onClick: (e: MouseEvent) => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      if (openOnClick) {
        onOpen(e.clientX, e.clientY);
        return;
      }
      onClick?.();
    },
  };
}
