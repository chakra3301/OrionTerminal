import { Suspense } from "react";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { useOverlayDescriptors } from "@/plugins/overlayRegistry";

export function PluginOverlays() {
  const overlays = useOverlayDescriptors();
  return overlays.map(({ id, component: Component }) => (
    <ErrorBoundary key={id} label={id} compact>
      <Suspense fallback={null}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  ));
}
