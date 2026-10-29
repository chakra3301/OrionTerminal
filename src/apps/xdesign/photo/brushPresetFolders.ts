/** Groups brush presets into Photoshop's picker folders in library order; group "" holds the ungrouped presets. Listed groups with no presets follow, so a new group shows while empty. */
export function brushPresetFolders<P extends { group: string }>(presets: P[], groups: readonly string[] = []): { group: string; presets: P[] }[] {
  const folders = new Map<string, P[]>();
  for (const preset of presets) folders.set(preset.group, [...folders.get(preset.group) ?? [], preset]);
  for (const group of groups) if (group && !folders.has(group)) folders.set(group, []);
  return [...folders].map(([group, members]) => ({ group, presets: members }));
}
