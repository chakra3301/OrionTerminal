/**
 * Standalone replacement for `@/store/appDefaults` (aliased in
 * vite.archives.config.ts). Only Archives has an assistant here; the other
 * ids reuse its defaults so shared code that indexes by AppId stays valid
 * without importing the Orion editor or XDesign.
 */
import { archivesClaude } from "@/apps/archives/claude";
// Relative on purpose: the alias points `@/store/appDefaults` at this file.
import type { AppDefaults, AppId } from "../../store/appDefaults";

export type { AppDefaults, AppId };

const archives: AppDefaults = {
  name: archivesClaude.name,
  subtitle: archivesClaude.subtitle,
  accentColor: archivesClaude.accentColor,
  systemPrompt: archivesClaude.systemPrompt,
  openingLine: archivesClaude.openingLine,
  suggestionChips: archivesClaude.suggestionChips,
};

export const APP_DEFAULTS: Record<AppId, AppDefaults> = {
  orion: archives,
  archives,
  xdesign: archives,
};
