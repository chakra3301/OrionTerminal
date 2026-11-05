/** Orion-only modules → Archives stand-ins for the standalone build, as paths
 * relative to `src/`. Read by vite.archives.config.ts, tsconfig.archives.json
 * (kept in sync by hand) and boundary.test.ts. */
export const ARCHIVES_ALIASES: Record<string, string> = {
  "@/store/appDefaults": "standalone/archives/appDefaults.ts",
};
