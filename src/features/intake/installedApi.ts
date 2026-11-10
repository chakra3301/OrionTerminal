import { invoke } from "@tauri-apps/api/core";
import { parseInstalledSkill, parseInstalledSkills, parseSkillContext, type SkillContextSelection } from "./contracts";

export const installedSkills = {
  list: async () => parseInstalledSkills(await invoke("intake_installed")),
  install: async (candidateId: string, expectedHash: string, targetId: string | null, expectedVersion: string | null, acknowledged: boolean) =>
    parseInstalledSkill(await invoke("intake_install", { candidateId, expectedHash, targetId, expectedVersion, acknowledged })),
  change: (skillId: string, expectedVersion: string, action: "enable" | "disable" | "rollback" | "remove", version: string | null = null) =>
    invoke<void>("intake_skill_change", { skillId, expectedVersion, action, version }),
  read: async (skillId: string, expectedVersion: string, path: string) => {
    const result = await invoke<unknown>("intake_installed_read", { skillId, expectedVersion, path });
    if (typeof result !== "string" || new TextEncoder().encode(result).length > 256 * 1024 || result.includes("\0")) throw new Error("Invalid installed resource preview");
    return result;
  },
  context: async (selections: SkillContextSelection[]) => parseSkillContext(await invoke("intake_skill_context", { selections })),
};
