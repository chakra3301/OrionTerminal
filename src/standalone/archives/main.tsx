import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { installPageMenuGuard } from "@/lib/pageMenuGuard";
import { installPanelDragGuard } from "@/lib/panelDragGuard";
import { setProductName } from "@/lib/productName";
import { setArchivesHost } from "@/apps/archives/host";
import { APP_NAME } from "./brand";
import { SidebarBrand } from "./chrome";

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
import "./archives.css";

// Must run before the app module loads so shared code reads the right names.
setProductName(APP_NAME);
setArchivesHost({
  productName: APP_NAME,
  SidebarHeader: SidebarBrand,
  brainStyle: "neurons",
  pinBrainNodes: true,
  // Lazy so the Settings module loads with the app, not before the host is set.
  openSettings: () => void import("./ArchivesSettings").then((m) => m.useArchivesSettings.getState().show()),
});

installPanelDragGuard();
installPageMenuGuard();

window.addEventListener("error", (e) => {
  // eslint-disable-next-line no-console
  console.error("[archives47] uncaught", e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  // eslint-disable-next-line no-console
  console.error("[archives47] unhandled rejection", e.reason);
});

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

if (window.top !== window.self) {
  root.textContent = `${APP_NAME} can't run inside a frame.`;
} else {
  void import("./ArchivesStandaloneApp").then(({ ArchivesStandaloneApp }) => {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ErrorBoundary>
          <ArchivesStandaloneApp />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  });
}
