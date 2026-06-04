import { useSyncExternalStore } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { registry } from "@/commands/registry";
import { log } from "@/lib/log";

function HotkeyBinding({ hotkey, commandId }: { hotkey: string; commandId: string }) {
  useHotkeys(
    hotkey,
    (event) => {
      const cmd = registry.get(commandId);
      if (!cmd) return;
      if (cmd.when && !cmd.when()) return;
      event.preventDefault();
      registry.run(commandId).catch((err) =>
        log.error("hotkey run failed", commandId, err),
      );
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: false,
      preventDefault: false,
    },
    [commandId],
  );
  return null;
}

function useHotkeyBindings() {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.hotkeys(),
    () => registry.hotkeys(),
  );
}

/**
 * Mounts a binding component for every hotkey registered on the command registry.
 * Hotkeys are a *view* over the registry — never wire them separately.
 */
export function HotkeyHost() {
  const bindings = useHotkeyBindings();
  return (
    <>
      {bindings.map((b) => (
        <HotkeyBinding key={`${b.id}:${b.hotkey}`} hotkey={b.hotkey} commandId={b.id} />
      ))}
    </>
  );
}
