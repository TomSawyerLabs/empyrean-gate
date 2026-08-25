// The shell every hold-to-edit menu shares: a card anchored to where the gesture
// landed, pulled back inside the window, dismissed by Escape / backdrop / a
// second right-click. Extracted from LayerQuickEdit when the shape controls
// needed the same thing, so the two cannot drift apart.
//
// The backdrop is a click-catcher, not a scrim. These menus exist to be used
// *while watching the array*; dimming the thing being judged would defeat them.
// The sheet variant dims, because on a phone it covers most of the window and
// its edge needs to read as dismissable.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Below this the window has no room to anchor a popover; it becomes a sheet. */
const SHEET_WIDTH = 700;
const MARGIN = 8;

export interface PopoverAnchor {
  x: number;
  y: number;
}

export default function QuickPopover({
  anchor,
  onClose,
  label,
  className = "",
  children,
  onPointerDownInside,
  onPointerUpInside,
}: {
  anchor: PopoverAnchor;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
  /** Layer editing sets a drag flag here so an incoming config echo does not
   *  yank a slider thumb mid-gesture. */
  onPointerDownInside?: () => void;
  onPointerUpInside?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const sheet = typeof window !== "undefined" && window.innerWidth <= SHEET_WIDTH;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // Capture, so this wins over the app's show-mode Escape handler.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Anchor to the gesture, then pull back inside the window. Measured rather
  // than guessed: the card's height depends on its contents.
  useLayoutEffect(() => {
    if (sheet) return;
    const card = cardRef.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    const left = Math.min(
      Math.max(MARGIN, anchor.x - width / 2),
      window.innerWidth - width - MARGIN,
    );
    // Prefer below the finger; flip above when that would run off the bottom.
    const below = anchor.y + 14;
    const top = below + height + MARGIN <= window.innerHeight
      ? below
      : Math.max(MARGIN, anchor.y - height - 14);
    setPlaced({ left, top });
  }, [anchor.x, anchor.y, sheet, children]);

  return (
    <div
      className="quick-edit-backdrop"
      onPointerDown={onClose}
      onContextMenu={(e) => {
        // A second right-click anywhere dismisses rather than raising the
        // browser menu the rest of the app is careful to suppress.
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={cardRef}
        className={`layer-quick-edit ${sheet ? "sheet" : "popover"} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={sheet || !placed ? undefined : { left: placed.left, top: placed.top }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDownInside?.();
        }}
        onPointerUp={onPointerUpInside}
        onPointerCancel={onPointerUpInside}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
