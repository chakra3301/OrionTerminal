import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ProviderLogo, providerBrand } from "./ProviderLogo";
import { monitorCells, providerCells } from "./monitorCells";
import type { Provider } from "@/features/agents/agentTypes";

const p = (kind: Provider["kind"], patch: Partial<Provider> = {}): Provider => ({ id: kind, kind, name: kind, baseUrl: "", keyRef: "", enabled: true, builtin: true, models: [], ...patch });

describe("reference provider marks", () => {
  it("uses the real Claude, OpenAI, Gemini, Cursor and Nous marks", () => {
    for (const [kind, brand] of [["anthropic", "claude"], ["codex_cli", "openai"], ["gemini_cli", "gemini"], ["cursor_sdk", "cursor"], ["nous_oauth", "nousresearch"]] as const) {
      expect(providerBrand(p(kind))).toBe(brand);
      const html = renderToStaticMarkup(<ProviderLogo brand={brand} />);
      expect(html).toContain(`data-provider-logo="${brand}"`);
      expect(html).toContain("<img");
    }
  });
  it("does not give arbitrary OpenAI-compatible endpoints the OpenAI logo", () => {
    expect(providerBrand(p("openai_compat", { name: "My endpoint", baseUrl: "https://example.com/v1" }))).toBeNull();
    expect(providerBrand(p("openai_compat", { baseUrl: "https://api.deepseek.com/v1" }))).toBe("deepseek");
    expect(providerBrand(p("openai_compat", { baseUrl: "https://api.deepseek.com.attacker.example/v1" }))).toBeNull();
  });
  it("retains exact SVG sources and uses Gemini's spark, not Antigravity", () => {
    const root = `${process.cwd()}/src/shell/notch/logos/`;
    const manifest = JSON.parse(readFileSync(`${root}sources.json`, "utf8"));
    for (const file of manifest.files) expect(createHash("sha256").update(readFileSync(root + file.file)).digest("hex")).toBe(file.sha256);
    expect(readFileSync(root + "gemini.svg", "utf8")).toContain("<title>Gemini</title>");
    expect(readFileSync(root + "cursor.svg", "utf8")).toContain("<title>Cursor</title>");
  });
  it("excludes disabled AI rows and removes Claude rather than leaving a placeholder", () => {
    expect(providerCells([p("codex_cli"), p("gemini_cli", { enabled: false })], [], {}, Date.now(), null, 0).map(c => c.id)).toEqual(["provider:codex_cli"]);
    const reading = { value: null, status: "loading" as const };
    expect(monitorCells({ system: reading, usage: reading, limits: reading }, false).map(c => c.id)).toEqual(["cpu", "memory"]);
  });
});
