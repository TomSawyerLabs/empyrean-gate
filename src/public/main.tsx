// The public floor page: what the internet (and the venue QR, once the public
// URL exists) gets. Mounted from public.html; served by the backend's public
// listener at its root. No operator chrome, no GateProvider — its own slim
// client speaks the allowlisted half of the protocol.

import React from "react";
import ReactDOM from "react-dom/client";
import PublicApp from "./PublicApp";
import { installTouchHardening } from "../touch";
import "../styles.css";
import "./public.css";

installTouchHardening();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PublicApp />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
