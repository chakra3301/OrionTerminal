import type { Platform } from "./types";

/**
 * Detects whether an input is a supported repo and extracts its identity.
 * Accepts a full URL (github/gitlab/npm/pypi) or a bare `owner/repo`
 * (assumed github, for terminal ergonomics). Ported from url-detector.js.
 */
export function detectPlatform(
  input: string,
): { platform: Platform; repoId: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  // Strip a trailing ".git" (clone URLs) and trailing slashes from a repo id.
  const clean = (id: string) => id.replace(/\/+$/, "").replace(/\.git$/i, "");

  // Bare "owner/repo" → assume github.
  if (!/^https?:\/\//i.test(raw) && /^[\w.-]+\/[\w.-]+$/.test(raw)) {
    return { platform: "github", repoId: clean(raw) };
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  if (u.hostname === "github.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { platform: "github", repoId: clean(`${parts[0]}/${parts[1]}`) };
  }
  if (u.hostname === "gitlab.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { platform: "gitlab", repoId: clean(`${parts[0]}/${parts[1]}`) };
  }
  if (u.hostname === "www.npmjs.com" && u.pathname.startsWith("/package/")) {
    const name = u.pathname.slice("/package/".length).split("/v/")[0];
    if (name) return { platform: "npm", repoId: name };
  }
  if (u.hostname === "pypi.org" && u.pathname.startsWith("/project/")) {
    const name = u.pathname.slice("/project/".length).replace(/\/$/, "").split("/")[0];
    if (name) return { platform: "pypi", repoId: name };
  }
  return null;
}
