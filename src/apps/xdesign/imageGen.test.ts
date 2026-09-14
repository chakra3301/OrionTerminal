import { describe, expect, it } from "vitest";
import {
  imageCapableKind,
  isImageProvider,
  imageCapableProviders,
  defaultImageModel,
  defaultImageModelForProvider,
  hasPotentialImageProvider,
  resolveImageModel,
  resolveImageModelForProvider,
  pickImageProvider,
  base64ToBytes,
  sizeAspect,
  styleImagePrompt,
} from "./imageGen";
import type { Provider } from "@/features/agents/agentTypes";
import type { DesignSystem } from "./designSystem";

function prov(p: Partial<Provider>): Provider {
  return {
    id: p.id ?? "p",
    name: p.name ?? "P",
    kind: p.kind ?? "openai",
    baseUrl: p.baseUrl ?? "",
    models: p.models ?? [],
    keyRef: p.keyRef ?? "provider:p",
    enabled: p.enabled ?? true,
    builtin: p.builtin ?? false,
  };
}

describe("imageCapableKind", () => {
  it("accepts openai-ish + google, rejects the rest", () => {
    expect(imageCapableKind("openai")).toBe(true);
    expect(imageCapableKind("openai_compat")).toBe(true);
    expect(imageCapableKind("custom")).toBe(true);
    expect(imageCapableKind("google")).toBe(true);
    expect(imageCapableKind("anthropic")).toBe(false);
    expect(imageCapableKind("codex_cli")).toBe(true);
    expect(imageCapableKind("gemini_cli")).toBe(false);
    expect(imageCapableKind("nous_oauth")).toBe(false);
  });
});

describe("isImageProvider / imageCapableProviders", () => {
  it("requires capable kind + enabled + a keyRef", () => {
    expect(isImageProvider(prov({ kind: "openai", keyRef: "provider:x" }))).toBe(true);
    expect(isImageProvider(prov({ kind: "openai", keyRef: "" }))).toBe(false);
    expect(isImageProvider(prov({ kind: "openai", enabled: false }))).toBe(false);
    expect(isImageProvider(prov({ kind: "anthropic", keyRef: "x" }))).toBe(false);
  });

  it("enables Codex images only when native subscription status is ready", () => {
    const codex = prov({ kind: "codex_cli", keyRef: "", builtin: true });
    expect(isImageProvider(codex)).toBe(false);
    expect(isImageProvider(codex, true)).toBe(true);
    expect(defaultImageModelForProvider(codex)).toBe("gpt-image-2");
    expect(resolveImageModelForProvider(codex, "")).toBe("gpt-image-2");
  });

  it("treats enabled Codex as a potential provider before runtime status resolves", () => {
    expect(hasPotentialImageProvider([
      prov({ kind: "codex_cli", keyRef: "", builtin: true }),
    ])).toBe(true);
  });

  it("filters a list", () => {
    const list = [
      prov({ id: "a", kind: "anthropic", builtin: true, keyRef: "" }),
      prov({ id: "b", kind: "openai", keyRef: "provider:b" }),
      prov({ id: "c", kind: "google", keyRef: "provider:c" }),
      prov({ id: "d", kind: "openai", keyRef: "", enabled: true }),
      prov({ id: "e", kind: "codex_cli", keyRef: "", builtin: true }),
    ];
    expect(imageCapableProviders(list).map((p) => p.id)).toEqual(["b", "c"]);
    expect(imageCapableProviders(list, true).map((p) => p.id)).toEqual(["b", "c", "e"]);
  });
});

describe("defaultImageModel", () => {
  it("maps kind to a sensible default", () => {
    expect(defaultImageModel("openai")).toBe("gpt-image-1");
    expect(defaultImageModel("openai_compat")).toBe("gpt-image-1");
    expect(defaultImageModel("google")).toBe("imagen-4.0-generate-001");
  });
});

describe("resolveImageModel", () => {
  it("prefers a non-empty override, else the kind default", () => {
    expect(resolveImageModel("openai", "dall-e-3")).toBe("dall-e-3");
    expect(resolveImageModel("openai", "  ")).toBe("gpt-image-1");
    expect(resolveImageModel("google", "")).toBe("imagen-4.0-generate-001");
  });
});

describe("pickImageProvider", () => {
  it("prefers a ready Codex subscription, then openai, compat/custom, and others", () => {
    expect(pickImageProvider([])).toBeNull();
    const g = prov({ id: "g", kind: "google", keyRef: "k" });
    expect(pickImageProvider([g])!.id).toBe("g");
    const o = prov({ id: "o", kind: "openai", keyRef: "k" });
    expect(pickImageProvider([g, o])!.id).toBe("o");
    const c = prov({ id: "c", kind: "openai_compat", keyRef: "k" });
    expect(pickImageProvider([g, c])!.id).toBe("c");
    const subscription = prov({ id: "s", kind: "codex_cli", keyRef: "", builtin: true });
    expect(pickImageProvider([o, subscription], false)!.id).toBe("o");
    expect(pickImageProvider([o, subscription], true)!.id).toBe("s");
  });
});

describe("base64ToBytes", () => {
  it("decodes plain base64", () => {
    // "PNG" → UE5H
    const bytes = base64ToBytes("UE5H");
    expect(Array.from(bytes)).toEqual([80, 78, 71]);
  });
  it("strips a data: prefix", () => {
    const bytes = base64ToBytes("data:image/png;base64,UE5H");
    expect(Array.from(bytes)).toEqual([80, 78, 71]);
  });
});

describe("styleImagePrompt", () => {
  const brand: DesignSystem = {
    id: "b",
    name: "Neo",
    aesthetic: "neo-tokyo, neon",
    colors: [
      { name: "bg", value: "#03060a" },
      { name: "accent", value: "#39ff88" },
    ],
    typography: [],
    builtin: false,
    createdAt: 0,
    updatedAt: 0,
  };
  it("passes the description through with no brand", () => {
    expect(styleImagePrompt("  a fox  ", null)).toBe("a fox");
  });
  it("folds in aesthetic + palette", () => {
    const out = styleImagePrompt("a fox", brand);
    expect(out).toContain("a fox");
    expect(out).toContain("neo-tokyo, neon");
    expect(out).toContain("#39ff88");
  });
});

describe("sizeAspect", () => {
  it("computes w/h, defaults to 1 on junk", () => {
    expect(sizeAspect("1024x1024")).toBe(1);
    expect(sizeAspect("1792x1024")).toBeCloseTo(1.75);
    expect(sizeAspect("nope")).toBe(1);
  });
});
