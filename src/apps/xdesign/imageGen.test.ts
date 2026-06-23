import { describe, expect, it } from "vitest";
import {
  imageCapableKind,
  isImageProvider,
  imageCapableProviders,
  defaultImageModel,
  resolveImageModel,
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
    expect(imageCapableKind("codex_cli")).toBe(false);
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

  it("filters a list", () => {
    const list = [
      prov({ id: "a", kind: "anthropic", builtin: true, keyRef: "" }),
      prov({ id: "b", kind: "openai", keyRef: "provider:b" }),
      prov({ id: "c", kind: "google", keyRef: "provider:c" }),
      prov({ id: "d", kind: "openai", keyRef: "", enabled: true }),
    ];
    expect(imageCapableProviders(list).map((p) => p.id)).toEqual(["b", "c"]);
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
  it("prefers openai, then compat/custom, then anything capable", () => {
    expect(pickImageProvider([])).toBeNull();
    const g = prov({ id: "g", kind: "google", keyRef: "k" });
    expect(pickImageProvider([g])!.id).toBe("g");
    const o = prov({ id: "o", kind: "openai", keyRef: "k" });
    expect(pickImageProvider([g, o])!.id).toBe("o");
    const c = prov({ id: "c", kind: "openai_compat", keyRef: "k" });
    expect(pickImageProvider([g, c])!.id).toBe("c");
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
