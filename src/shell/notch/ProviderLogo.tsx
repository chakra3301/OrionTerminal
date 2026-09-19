import type { CSSProperties } from "react";
import type { Provider } from "@/features/agents/agentTypes";
import claude from "./logos/claude.svg";
import openai from "./logos/openai.svg";
import gemini from "./logos/gemini.svg";
import cursor from "./logos/cursor.svg";
import nousresearch from "./logos/nousresearch.svg";
import ollama from "./logos/ollama.svg";
import lmstudio from "./logos/lmstudio.svg";
import deepseek from "./logos/deepseek.svg";
import mistral from "./logos/mistral.svg";
import qwen from "./logos/qwen.svg";
import meta from "./logos/meta.svg";
import gemma from "./logos/gemma.svg";

const logos = { claude, openai, gemini, cursor, nousresearch, ollama, lmstudio, deepseek, mistral, qwen, meta, gemma };
export type ProviderBrand = keyof typeof logos;
export function providerBrand(p: Pick<Provider, "kind" | "name" | "baseUrl">): ProviderBrand | null {
  switch (p.kind) {
    case "anthropic": return "claude";
    case "codex_cli": case "openai": return "openai";
    case "gemini_cli": case "google": return "gemini";
    case "cursor_sdk": return "cursor";
    case "nous_oauth": return "nousresearch";
  }
  let host = "";
  try { host = new URL(p.baseUrl).hostname; } catch { /* Custom endpoints can be incomplete while being edited. */ }
  if (host === "api.deepseek.com") return "deepseek";
  if (host === "api.mistral.ai") return "mistral";
  if (host === "ollama.com") return "ollama";
  if (/^ollama\b/i.test(p.name)) return "ollama";
  if (/^lm\s?studio\b/i.test(p.name)) return "lmstudio";
  return null;
}

export function ProviderLogo({ brand, name = "" }: { brand: ProviderBrand | null; name?: string }) {
  if (!brand) return <span className="ot-notch-provider-initials" aria-hidden="true">{name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toUpperCase()}</span>;
  const opticalScale = brand === "claude" || brand === "cursor" ? .97 : brand === "openai" ? .94 : brand === "ollama" ? .98 : brand === "lmstudio" ? .96 : 1;
  return <img className="ot-notch-provider-logo" data-provider-logo={brand} src={logos[brand]} alt="" aria-hidden="true" draggable={false} style={{ "--logo-scale": opticalScale } as CSSProperties} />;
}
