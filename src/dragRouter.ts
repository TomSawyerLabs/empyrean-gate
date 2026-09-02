// Drag-across triggering for the Live control pads.
//
// A `click` needs pointer-down and -up on the SAME element, so dragging a
// finger across a row of pads fires nothing. This router makes every element
// marked `data-drag-fire` also fire when a pressed pointer slides onto it:
// drumming across the effect pads, sweeping through colors, sliding onto a
// pen. It dispatches through `el.click()`, so each pad keeps exactly one code
// path and tap behavior is untouched.
//
// Rules per pointer:
// - Entering a marked element (that isn't the last one fired) fires it.
// - The element the gesture STARTED on is special: its native click only
//   happens if the pointer is released there, so the router fires it the
//   moment the pointer leaves it instead. A plain tap stays a native click —
//   the router only acts once the pointer moves off the origin.
// - Elements are found with elementFromPoint, which only ever sees rendered
//   elements — the CSS-hidden duplicate control clusters can't double-fire.

const MARKER = "data-drag-fire";

type Track = {
  /** Marked element the gesture started on, if any. */
  origin: Element | null;
  /** It fired via the router (left before release) — don't rely on click. */
  originFired: boolean;
  /** Last marked element fired (or the untouched origin), to debounce. */
  last: Element | null;
};

function markedAt(x: number, y: number): Element | null {
  return document.elementFromPoint(x, y)?.closest(`[${MARKER}]`) ?? null;
}

function fire(el: Element) {
  (el as HTMLElement).click();
}

/** Install on the Live page root. Returns the teardown. */
export function installDragRouter(root: HTMLElement): () => void {
  const tracks = new Map<number, Track>();

  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // Sliders, selects, and text inputs own their own drag semantics.
    const target = e.target as Element;
    if (target.closest("input, select, textarea, canvas")) return;
    const origin = target.closest(`[${MARKER}]`);
    tracks.set(e.pointerId, { origin, originFired: false, last: origin });
  };

  const move = (e: PointerEvent) => {
    const track = tracks.get(e.pointerId);
    if (!track) return;
    const el = markedAt(e.clientX, e.clientY);
    if (el === track.last) return;
    // Left the origin without releasing: its native click is off the table.
    if (track.origin && !track.originFired) {
      fire(track.origin);
      track.originFired = true;
    }
    track.last = el;
    if (el) fire(el);
  };

  const end = (e: PointerEvent) => {
    tracks.delete(e.pointerId);
  };

  // Capture phase, so element-level handlers (and pointer capture on the
  // sliders and hold-pads) can't hide the gesture from the router.
  root.addEventListener("pointerdown", down, true);
  root.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
  return () => {
    root.removeEventListener("pointerdown", down, true);
    root.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
  };
}
