import { afterEach, expect, it } from "vitest";
import { useRosie } from "@/features/rosie/rosieStore";
import { useShell } from "@/shell/store/useShell";
import { useCharacterStore } from "@/store/characterStore";
import { companionOnScreen } from "./companionPresence";

const appWindow = (minimized: boolean) => ({ id: "w", app: "xdesign", minimized }) as unknown as ReturnType<typeof useShell.getState>["windows"][number];

afterEach(() => {
  useRosie.setState({ companionVisible: true });
  useShell.setState({ windows: [] });
  useCharacterStore.setState({ showInApps: false });
});

it("shows the companion on the bare desktop but parks her while an app is open", () => {
  expect(companionOnScreen()).toBe(true);
  useShell.setState({ windows: [appWindow(false)] });
  expect(companionOnScreen()).toBe(false);
  useShell.setState({ windows: [appWindow(true)] });
  expect(companionOnScreen()).toBe(true);
});

it("keeps her in apps when opted in, and never shows her once dismissed", () => {
  useShell.setState({ windows: [appWindow(false)] });
  useCharacterStore.setState({ showInApps: true });
  expect(companionOnScreen()).toBe(true);
  useRosie.setState({ companionVisible: false });
  expect(companionOnScreen()).toBe(false);
});

it("restores the saved preference and defaults it off", () => {
  useCharacterStore.getState().hydrate({});
  expect(useCharacterStore.getState().showInApps).toBe(false);
  useCharacterStore.getState().hydrate({ showInApps: true });
  expect(useCharacterStore.getState().showInApps).toBe(true);
});
