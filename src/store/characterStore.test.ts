import { beforeEach, expect, it, vi } from "vitest";
import { useCharacterStore } from "./characterStore";
import { BUILTIN_CHARACTERS, DEFAULT_CHARACTER_ID, type CustomCharacter } from "@/features/characters/catalog";
import { setAppState } from "@/lib/db";
import { ipc } from "@/lib/ipc";

vi.mock("@/lib/db", () => ({ setAppState: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/ipc", () => ({ ipc: { characterClearFile: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn() } }));

const custom: CustomCharacter = { id: "custom-existing", name: "My upload", filePath: "/saved/character.glb", custom: true };
beforeEach(() => {
  useCharacterStore.setState({ selectedId: DEFAULT_CHARACTER_ID, custom: [], showInApps: false });
  vi.clearAllMocks();
});

it("migrates retired selections to R.O.S.I.E without deleting uploads or writing during hydration", () => {
  for (const selectedId of ["anthropomorphic-fox", "horned-demon", "azure-rebellion", "unknown"]) {
    useCharacterStore.getState().hydrate({ selectedId, custom: [custom] });
    expect(useCharacterStore.getState().selected()?.id).toBe(DEFAULT_CHARACTER_ID);
    expect(useCharacterStore.getState().custom).toEqual([custom]);
  }
  expect(setAppState).not.toHaveBeenCalled();
});

it("restores each new companion and saved custom selections", () => {
  for (const character of [...BUILTIN_CHARACTERS, custom]) {
    useCharacterStore.getState().hydrate({ selectedId: character.id, custom: [custom] });
    expect(useCharacterStore.getState().selected()?.id).toBe(character.id);
  }
  useCharacterStore.getState().setSelected("not-a-character");
  expect(useCharacterStore.getState().selected()?.id).toBe(custom.id);
});

it("maps the previous Rosie, Mushroom and Angel to their successors", () => {
  for (const [saved, next] of [["rosie-stylized", "rosie"], ["rosie-cybernetic", "rosie"], ["mushroom-character", "mxshy"], ["angelic-winged-figure", "ang3l"]]) {
    useCharacterStore.getState().hydrate({ selectedId: saved, custom: [] });
    expect(useCharacterStore.getState().selected()?.id).toBe(next);
  }
});

it("falls back to R.O.S.I.E when removing the selected upload and persists subsequent selections", async () => {
  useCharacterStore.getState().hydrate({ selectedId: custom.id, custom: [custom] });
  await useCharacterStore.getState().removeCustom(custom.id);
  expect(ipc.characterClearFile).toHaveBeenCalledWith(custom.filePath);
  expect(setAppState).toHaveBeenLastCalledWith("characters", { selectedId: DEFAULT_CHARACTER_ID, custom: [], showInApps: false });
  useCharacterStore.getState().setSelected("suki");
  expect(setAppState).toHaveBeenLastCalledWith("characters", { selectedId: "suki", custom: [], showInApps: false });
});
