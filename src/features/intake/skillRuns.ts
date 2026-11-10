const runs = new Map<string, Set<string>>();

export function holdImportedSkills(chatId: string, ids: string[]): void { runs.set(chatId, new Set(ids)); }
export function releaseImportedSkills(chatId: string): void { runs.delete(chatId); }
export function hasImportedSkills(chatId: string): boolean { return runs.has(chatId); }
export function assertImportedSkillsIdle(ids: string[]): void {
  if ([...runs.values()].some((skills) => ids.some((id) => skills.has(id)))) {
    throw new Error("Stop the response using this skill before updating, disabling or removing it.");
  }
}
