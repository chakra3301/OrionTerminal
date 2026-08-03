import { registry } from "@/commands/registry";
import { useShell } from "@/shell/store/useShell";

let installed = false;

export function installShellCommands() {
  if (installed) return;
  installed = true;

  registry.register({
    id: "window.close",
    label: "Close Focused Window",
    keywords: ["close", "window"],
    group: "View",
    when: () => useShell.getState().focusedWindowId !== null,
    run: () => {
      const id = useShell.getState().focusedWindowId;
      if (id) useShell.getState().minimizeWindow(id);
    },
  });

  registry.register({
    id: "window.minimize",
    label: "Minimize Focused Window",
    hotkey: "mod+m",
    group: "View",
    when: () => useShell.getState().focusedWindowId !== null,
    run: () => {
      const id = useShell.getState().focusedWindowId;
      if (id) useShell.getState().minimizeWindow(id);
    },
  });

  registry.register({
    id: "window.toggleMaximize",
    label: "Toggle Maximize Focused Window",
    group: "View",
    when: () => useShell.getState().focusedWindowId !== null,
    run: () => {
      const id = useShell.getState().focusedWindowId;
      if (id) useShell.getState().toggleMaximize(id);
    },
  });

  registry.register({
    id: "window.toggleFullscreen",
    label: "Toggle Full Screen",
    hotkey: "ctrl+meta+f",
    keywords: ["fullscreen", "full screen", "present"],
    group: "View",
    when: () => useShell.getState().focusedWindowId !== null,
    run: () => {
      const id = useShell.getState().focusedWindowId;
      if (id) useShell.getState().toggleFullscreen(id);
    },
  });

  registry.register({
    id: "window.fullscreenNext",
    label: "Full Screen: Next App",
    keywords: ["fullscreen", "switch", "next", "tab"],
    group: "View",
    when: () =>
      useShell.getState().windows.some((w) => w.fullscreen && !w.minimized),
    run: () => useShell.getState().cycleFullscreen(1),
  });

  registry.register({
    id: "window.fullscreenPrev",
    label: "Full Screen: Previous App",
    keywords: ["fullscreen", "switch", "previous", "tab"],
    group: "View",
    when: () =>
      useShell.getState().windows.some((w) => w.fullscreen && !w.minimized),
    run: () => useShell.getState().cycleFullscreen(-1),
  });

  registry.register({
    id: "spotlight.open",
    label: "Spotlight: Open",
    keywords: ["search", "everything", "go to"],
    group: "View",
    run: () => {
      useShell.getState().openSpotlight();
    },
  });
}
