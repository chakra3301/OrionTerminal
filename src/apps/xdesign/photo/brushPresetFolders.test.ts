import { describe, expect, it } from "vitest";
import { brushPresetFolders } from "./brushPresetFolders";

const preset = (name: string, group: string) => ({ name, group, size: 10, hardness: 1 });

describe("brushPresetFolders", () => {
  it("keeps the library's group order and each group's preset order, ungrouped presets in place without a folder", () => {
    const presets = [preset("Soft", "General"), preset("Loose", ""), preset("Chalk", "Dry"), preset("Hard", "General"), preset("Ink", "Dry"), preset("Spare", "")];
    expect(brushPresetFolders(presets).map(folder => [folder.group, folder.presets.map(entry => entry.name)])).toEqual([
      ["General", ["Soft", "Hard"]], ["", ["Loose", "Spare"]], ["Dry", ["Chalk", "Ink"]],
    ]);
  });
  it("adds the listed groups that hold no presets after the library's folders, in the listed order", () => {
    const presets = [preset("Soft", "General"), preset("Loose", ""), preset("Chalk", "Dry")];
    expect(brushPresetFolders(presets, ["General", "Dry", "Mine", "Later"]).map(folder => [folder.group, folder.presets.length])).toEqual([["General", 1], ["", 1], ["Dry", 1], ["Mine", 0], ["Later", 0]]);
    expect(brushPresetFolders([], ["Mine"])).toEqual([{ group: "Mine", presets: [] }]);
  });
  it("returns no folders for an empty library", () => {
    expect(brushPresetFolders([])).toEqual([]);
  });
});
