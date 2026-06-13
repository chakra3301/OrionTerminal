import { ipc } from "@/lib/ipc";
import { detectPlatform } from "./detect";
import type { RepoData, RepoSource } from "./types";

export function resolveInput(input: string) {
  return detectPlatform(input);
}

export async function fetchRepo(input: string): Promise<RepoData> {
  const hit = detectPlatform(input);
  if (!hit) throw new Error("Not a recognized repo URL or owner/repo");
  return ipc.repolensFetchRepo(hit.platform, hit.repoId);
}

export async function fetchSource(repoId: string): Promise<RepoSource> {
  return ipc.repolensFetchSource(repoId);
}
