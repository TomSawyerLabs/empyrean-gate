// Side panels and the sheets they become in the compact layout: the heading
// with its Done button, and the focus/Escape behaviour every sheet shares.

import { useEffect, useRef, type ReactNode } from "react";

/** Heading of a side panel; as a sheet it also carries the Done button. */
export function PanelHead({ title, onClose }: { title: ReactNode; onClose?: () => void }) {
  return (
    <div className="patch-panel-head">
      <h3>{title}</h3>
      {onClose && (
        <button type="button" className="patch-sheet-done" onClick={onClose}>
          Done
        </button>
      )}
    </div>
  );
}

/** A sheet closes on Escape and takes focus when it opens, so a keyboard
 * user lands inside it. */
export function useSheet(onClose: (() => void) | undefined) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (onClose) ref.current?.focus({ preventScroll: true });
  }, [onClose]);
  const onKeyDown = onClose
    ? (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }
    : undefined;
  return { ref, onKeyDown, tabIndex: onClose ? -1 : undefined };
}
