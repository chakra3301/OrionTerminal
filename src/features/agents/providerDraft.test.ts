import { describe, it, expect } from "vitest";
import {
  requiresBaseUrl,
  usesOAuth,
  validateProviderDraft,
  PROVIDER_PRESETS,
} from "./providerDraft";

describe("usesOAuth", () => {
  it("is true only for nous_oauth", () => {
    expect(usesOAuth("nous_oauth")).toBe(true);
    expect(usesOAuth("openai")).toBe(false);
    expect(usesOAuth("openai_compat")).toBe(false);
  });
});

describe("requiresBaseUrl", () => {
  it("requires a base URL for openai_compat / custom / google", () => {
    expect(requiresBaseUrl("openai_compat")).toBe(true);
    expect(requiresBaseUrl("custom")).toBe(true);
    expect(requiresBaseUrl("google")).toBe(true);
  });
  it("does not require one for openai or the CLI engines", () => {
    expect(requiresBaseUrl("openai")).toBe(false);
    expect(requiresBaseUrl("anthropic")).toBe(false);
    expect(requiresBaseUrl("codex_cli")).toBe(false);
    expect(requiresBaseUrl("gemini_cli")).toBe(false);
  });
});

describe("validateProviderDraft", () => {
  it("rejects an empty name", () => {
    expect(validateProviderDraft({ name: "  ", kind: "openai", baseUrl: "" })).toMatch(/name/i);
  });
  it("rejects a blank base URL when the kind needs one", () => {
    expect(
      validateProviderDraft({ name: "NVIDIA", kind: "openai_compat", baseUrl: "  " }),
    ).toMatch(/base url/i);
  });
  it("accepts openai with no base URL (implicit api.openai.com)", () => {
    expect(validateProviderDraft({ name: "OpenAI", kind: "openai", baseUrl: "" })).toBeNull();
  });
  it("accepts openai_compat with a base URL", () => {
    expect(
      validateProviderDraft({
        name: "NVIDIA",
        kind: "openai_compat",
        baseUrl: "https://integrate.api.nvidia.com/v1",
      }),
    ).toBeNull();
  });
});

describe("PROVIDER_PRESETS", () => {
  it("includes NVIDIA pointing at integrate.api.nvidia.com", () => {
    const nv = PROVIDER_PRESETS.find((p) => p.label === "NVIDIA");
    expect(nv?.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(nv?.kind).toBe("openai_compat");
  });
  it("includes NousResearch as an OAuth provider", () => {
    const nr = PROVIDER_PRESETS.find((p) => p.label === "NousResearch");
    expect(nr?.baseUrl).toBe("https://inference-api.nousresearch.com/v1");
    expect(nr?.kind).toBe("nous_oauth");
    expect(usesOAuth(nr!.kind)).toBe(true);
  });
  it("every preset that names a non-openai host carries a base URL", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.baseUrl.trim().length).toBeGreaterThan(0);
      expect(p.exampleModel.trim().length).toBeGreaterThan(0);
    }
  });
});
