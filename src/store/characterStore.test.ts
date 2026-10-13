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
  useCharacterStore.setState({ selectedId: DEFAULT_CHARACTER_ID, custom: [] });
  vi.clearAllMocks();
});

it("migrates retired selections to Fox without deleting uploads or writing during hydration", () => {
  for (const selectedId of ["rosie", "azure-rebellion", "unknown"]) {
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

it("falls back to Fox when removing the selected upload and persists subsequent selections", async () => {
  useCharacterStore.getState().hydrate({ selectedId: custom.id, custom: [custom] });
  await useCharacterStore.getState().removeCustom(custom.id);
  expect(ipc.characterClearFile).toHaveBeenCalledWith(custom.filePath);
  expect(setAppState).toHaveBeenLastCalledWith("characters", { selectedId: DEFAULT_CHARACTER_ID, custom: [] });
  useCharacterStore.getState().setSelected("angelic-winged-figure");
  expect(setAppState).toHaveBeenLastCalledWith("characters", { selectedId: "angelic-winged-figure", custom: [] });
});
