// Touch-screen hardening for the Gate machine's multi-touch display.
//
// Multiple simultaneous contacts already work (GateCanvas tracks per-pointer
// state). What broke live operation was the *other* things a touch screen does:
// a resting finger becomes press-and-hold → context menu, a second contact
// becomes pinch-zoom, a drag becomes a scroll/back-swipe. Every one of those
// steals pointer events from the canvas mid-gesture.
//
// The suppressions here are deliberately global rather than canvas-scoped: on a
// show surface there is no gesture we want the browser to interpret anywhere.
// Real text fields are the one exception — the context menu is how you paste an
// IP address into Settings.

function inTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function inPatchCanvas(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".patch-canvas") !== null;
}

export function installTouchHardening(): () => void {
  const offs: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(
    type: K,
    handler: (e: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => {
    window.addEventListener(type, handler, options);
    offs.push(() => window.removeEventListener(type, handler, options));
  };
  // Events with no lib.dom typing (Safari's gesture* family) go through this.
  const onRaw = (type: string, handler: (e: Event) => void) => {
    window.addEventListener(type, handler, { passive: false });
    offs.push(() => window.removeEventListener(type, handler));
  };

  // Press-and-hold on Windows and the long-press callout on iPadOS both arrive
  // as `contextmenu`. Suppressing it also stops the press-and-hold ring from
  // aborting an in-progress stroke.
  on(
    "contextmenu",
    (e) => {
      if (!inTextField(e.target)) e.preventDefault();
    },
    { capture: true },
  );

  // Ctrl/⌘ + wheel is the pinch-zoom gesture a trackpad or touch screen sends.
  // The Patch graph owns that gesture; elsewhere it must not resize the show UI.
  // Non-modified wheel is left alone so pages and the Patch graph can scroll or
  // zoom according to their own local behavior.
  on(
    "wheel",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && !inPatchCanvas(e.target)) {
        e.preventDefault();
      }
    },
    { passive: false, capture: true },
  );

  // Safari/iPadOS pinch, which is not a wheel event at all.
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    onRaw(type, (e) => e.preventDefault());
  }

  // Keyboard zoom. An operator reaching for the numeric keypad in the dark
  // should not be able to resize the whole show UI by a stray Ctrl.
  on(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key)) {
        e.preventDefault();
      }
    },
    { capture: true },
  );

  return () => offs.forEach((off) => off());
}
