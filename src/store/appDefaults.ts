import { orionClaude } from "@/apps/orion/claude";
import { archivesClaude } from "@/apps/archives/claude";
import { xdesignClaude } from "@/apps/xdesign/claude";

export type AppId = "orion" | "archives" | "xdesign";

export type AppDefaults = {
  name: string;
  subtitle: string;
  accentColor: string;
  systemPrompt: string;
  openingLine: string;
  suggestionChips: string[];
};

function defaultsOf(c: AppDefaults): AppDefaults {
  return {
    name: c.name,
    subtitle: c.subtitle,
    accentColor: c.accentColor,
    systemPrompt: c.systemPrompt,
    openingLine: c.openingLine,
    suggestionChips: c.suggestionChips,
  };
}

// The shipped identity for each app's embedded Claude. These are the reset
// targets — overrides in AppConfig win when present. The standalone Archives
// 47 build swaps this module for `src/standalone/archives/appDefaults.ts`.
export const APP_DEFAULTS: Record<AppId, AppDefaults> = {
  orion: defaultsOf(orionClaude),
  archives: defaultsOf(archivesClaude),
  xdesign: defaultsOf(xdesignClaude),
};
