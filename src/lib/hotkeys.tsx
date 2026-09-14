import { useSyncExternalStore } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { registry } from "@/commands/registry";
import { log } from "@/lib/log";

function HotkeyBinding({ hotkey, commandId }: { hotkey: string; commandId: string }) {
  const capture = ["palette.open", "palette.openCommands", "controlpanel.open"].includes(commandId);
  useHotkeys(
    hotkey,
    (event) => {
      const cmd = registry.get(commandId);
      if (!cmd) return;
      if (cmd.when && !cmd.when()) return;
      // Native modals own the interaction; background save/close commands are
      // just as unsafe here as opening an inert palette behind the dialog.
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      if (capture) event.stopPropagation();
      registry.run(commandId).catch((err) =>
        log.error("hotkey run failed", commandId, err),
      );
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: capture,
      // Monaco consumes its own chords before a bubbling document listener.
      eventListenerOptions: { capture },
      // Registry entries are single chords; comma must not split the binding.
      splitKey: "\u0000",
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
