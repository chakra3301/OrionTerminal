import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/app/App";
import { ErrorBoundary } from "@/app/ErrorBoundary";

import "@fontsource/space-grotesk/300.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/300.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";

import "@/styles/tokens.css";
import "@/styles/themes.css";
import "@/styles.css";

window.addEventListener("error", (e) => {
  // eslint-disable-next-line no-console
  console.error("[orion] uncaught", e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  // eslint-disable-next-line no-console
  console.error("[orion] unhandled rejection", e.reason);
});

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

// Orion Terminal is a top-level app and must never run inside a frame. The
// XDesign webpage preview renders generated HTML in a same-origin srcDoc
// iframe; if that page navigates itself (a link/form/JS redirect) it would
// load THIS app's URL inside the frame and boot a second, broken instance
// that crashes the host. Refuse to mount when framed.
if (window.top !== window.self) {
  document.documentElement.style.background = "#03060a";
  root.innerHTML =
    '<div style="display:grid;place-items:center;height:100vh;color:#5a706a;' +
    'font:13px/1.5 ui-sans-serif,system-ui,sans-serif;text-align:center;padding:24px">' +
    "Orion Terminal can\u2019t run inside a frame.</div>";
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
