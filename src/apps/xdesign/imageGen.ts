// Raster image generation — pure frontend logic.
//
// Capability detection (which configured providers can generate images) +
// per-kind default model + base64→bytes decode + provider selection. The Rust
// `xdesign_image_gen` command does the HTTP; placement lives in the rail.

import type { Provider, ProviderKind } from "@/features/agents/agentTypes";
import type { DesignSystem } from "./designSystem";

export const CODEX_SUBSCRIPTION_IMAGE_MODEL = "gpt-image-2";

/** Kinds that expose an image-generation path Orion supports. Codex is
 * dynamically ready only after its ChatGPT subscription login is verified. */
export function imageCapableKind(kind: ProviderKind): boolean {
  return (
    kind === "openai" ||
    kind === "openai_compat" ||
    kind === "custom" ||
    kind === "google" ||
    kind === "codex_cli"
  );
}

export function isImageProvider(p: Provider, codexReady = false): boolean {
  if (!p.enabled || !imageCapableKind(p.kind)) return false;
  if (p.kind === "codex_cli") return codexReady;
  return p.keyRef.trim().length > 0;
}

export function imageCapableProviders(providers: Provider[], codexReady = false): Provider[] {
  return providers.filter((provider) => isImageProvider(provider, codexReady));
}

export function hasPotentialImageProvider(providers: Provider[]): boolean {
  return providers.some((provider) =>
    provider.enabled && (provider.kind === "codex_cli" || isImageProvider(provider)),
  );
}

/** Default image model per kind. OpenAI-compatible → gpt-image-1 (dall-e-3 is
 * the documented fallback if a key lacks gpt-image-1 access — overridable via
 * the Control Panel). Google → Imagen 4 (Imagen 3 is shut down). */
export function defaultImageModel(kind: ProviderKind): string {
  return kind === "google" ? "imagen-4.0-generate-001" : "gpt-image-1";
}

export function defaultImageModelForProvider(provider: Pick<Provider, "kind" | "baseUrl">): string {
  return provider.kind === "codex_cli"
    ? CODEX_SUBSCRIPTION_IMAGE_MODEL
    : defaultImageModel(provider.kind);
}

/** Resolve the image model: a user override (Control Panel) wins, else the
 * per-kind default. */
export function resolveImageModel(kind: ProviderKind, override: string): string {
  return override.trim() || defaultImageModel(kind);
}

export function resolveImageModelForProvider(
  provider: Pick<Provider, "kind" | "baseUrl">,
  override: string,
): string {
  return override.trim() || defaultImageModelForProvider(provider);
}

// Per-provider image-model override (no migration — a tiny localStorage pref,
// mirroring htmlArtifactStore). Lets a user pick dall-e-3 vs gpt-image-1 or a
// specific Imagen snapshot without guessing.
const IMG_MODEL_KEY = "xdesign:imageModel:";

export function getImageModelOverride(providerId: string): string {
  try {
    return localStorage.getItem(IMG_MODEL_KEY + providerId) ?? "";
  } catch {
    return "";
  }
}

export function setImageModelOverride(providerId: string, model: string): void {
  try {
    if (model.trim()) localStorage.setItem(IMG_MODEL_KEY + providerId, model.trim());
    else localStorage.removeItem(IMG_MODEL_KEY + providerId);
  } catch {
    /* localStorage unavailable — fall back to per-kind default */
  }
}

/** Choose the provider to generate with. Prefers the first OpenAI-ish provider
 * (broadest model support), else the first capable one. Null when none. */
export function pickImageProvider(providers: Provider[], codexReady = false): Provider | null {
  const capable = imageCapableProviders(providers, codexReady);
  if (capable.length === 0) return null;
  return (
    capable.find((p) => p.kind === "codex_cli") ??
    capable.find((p) => p.kind === "openai") ??
    capable.find((p) => p.kind === "openai_compat" || p.kind === "custom") ??
    capable[0]!
  );
}

/** Decode a base64 string (no data: prefix) to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Default generation size per kind (kept square — robust across both APIs and
 * easy to resize on canvas). */
export function defaultSize(): string {
  return "1024x1024";
}

/** Fold the active brand's aesthetic + palette into a raster prompt so a
 * generated image stays on-brand. No brand → the description unchanged. */
export function styleImagePrompt(description: string, brand: DesignSystem | null): string {
  if (!brand) return description.trim();
  const bits: string[] = [];
  if (brand.aesthetic) bits.push(brand.aesthetic);
  const palette = brand.colors
    .slice(0, 4)
    .map((c) => c.value)
    .filter(Boolean)
    .join(", ");
  if (palette) bits.push(`color palette ${palette}`);
  const base = description.trim();
  return bits.length ? `${base}. Visual style — ${bits.join("; ")}.` : base;
}

/** Aspect ratio (w/h) of a "WxH" size string; 1 when unparseable. */
export function sizeAspect(size: string): number {
  const m = size.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/);
  if (!m) return 1;
  const w = parseInt(m[1]!, 10);
  const h = parseInt(m[2]!, 10);
  return w > 0 && h > 0 ? w / h : 1;
}
