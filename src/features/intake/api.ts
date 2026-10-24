import { invoke } from "@tauri-apps/api/core";
import { parseCandidate, parseCandidates, parseDiscovery, parseRepositoryReview, repositoryUrl } from "./contracts";

export const intake = {
  discoverRepo: async (url: string, jobId: string) => parseDiscovery(await invoke("intake_github_discover", { url: repositoryUrl(url), jobId })),
  inspectRepo: async (discoveryId: string, entrypoint: string, attribution: string[], jobId: string) => parseCandidate(await invoke("intake_github_inspect", { discoveryId, entrypoint, attribution, jobId })),
  reviewRepo: async (discoveryId: string, paths: string[], jobId: string) => parseRepositoryReview(await invoke("intake_github_review", { discoveryId, paths, jobId })),
  cancelRepo: async (jobId: string) => { await invoke("intake_github_cancel", { jobId }); },
  discover: async (path: string) => parseDiscovery(await invoke("intake_discover", { path })),
  inspect: async (discoveryId: string, entrypoint: string, attribution: string[]) => parseCandidate(await invoke("intake_inspect", { discoveryId, entrypoint, attribution })),
  stage: async (id: string, expectedHash: string) => parseCandidate(await invoke("intake_stage", { id, expectedHash })),
  list: async () => parseCandidates(await invoke("intake_list")),
  release: async (id: string) => { await invoke("intake_release", { id }); },
  discard: async (id: string) => { await invoke("intake_discard", { id }); },
  read: async (id: string, path: string): Promise<string> => {
    const value: unknown = await invoke("intake_read", { id, path });
    if (typeof value !== "string" || new TextEncoder().encode(value).length > 256 * 1024 || value.includes("\0")) throw new Error("Invalid resource preview");
    return value;
  },
};
