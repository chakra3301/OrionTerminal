import { useRosie } from "@/features/rosie/rosieStore";
import { useShell } from "@/shell/store/useShell";
import { useCharacterStore } from "@/store/characterStore";

// Rendering her over an open app costs that app frame time (XDesign photo pan fell to
// 32-54fps with her visible vs 60fps hidden), so by default she only appears on the
// bare desktop. "Show in apps" opts back in on machines with headroom.
const inApp = (windows: readonly { minimized: boolean }[]) => windows.some((w) => !w.minimized);

export function companionOnScreen(): boolean {
  return useRosie.getState().companionVisible &&
    (useCharacterStore.getState().showInApps || !inApp(useShell.getState().windows));
}

export function useCompanionOnScreen(): boolean {
  const visible = useRosie((s) => s.companionVisible);
  const showInApps = useCharacterStore((s) => s.showInApps);
  const appOpen = useShell((s) => inApp(s.windows));
  return visible && (showInApps || !appOpen);
}
