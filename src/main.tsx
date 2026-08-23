import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { GateProvider } from "./state";
import { installTouchHardening } from "./touch";
import "./styles.css";

// Before React mounts: the show display is a touch screen, and the browser's own
// gestures (press-and-hold menu, pinch-zoom, overscroll) otherwise interrupt
// drawing and effect taps.
installTouchHardening();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GateProvider>
      <App />
    </GateProvider>
  </React.StrictMode>,
);

// PWA: register the service worker when served over http(s) by the backend —
// not inside the Tauri webview and not on the vite dev server.
if (
  "serviceWorker" in navigator &&
  !("__TAURI_INTERNALS__" in window) &&
  !import.meta.env.DEV
) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
