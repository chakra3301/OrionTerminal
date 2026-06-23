// Raster image generation — pure frontend logic.
//
// Capability detection (which configured providers can generate images) +
// per-kind default model + base64→bytes decode + provider selection. The Rust
// `xdesign_image_gen` command does the HTTP; placement lives in the rail.

import type { Provider, ProviderKind } from "@/features/agents/agentTypes";

/** Kinds that expose an image-generation endpoint we support. The CLI engines
 * (codex/gemini), nous_oauth, and anthropic (no image API) are excluded. */
export function imageCapableKind(kind: ProviderKind): boolean {
  return (
    kind === "openai" ||
    kind === "openai_compat" ||
    kind === "custom" ||
    kind === "google"
  );
}

/** A configured provider is usable for image gen when its kind supports it,
 * it's enabled, and it has a key reference (the actual key lives in the OS
 * keychain — presence is verified at call time, but no keyRef = no key). */
export function isImageProvider(p: Provider): boolean {
  return p.enabled && imageCapableKind(p.kind) && p.keyRef.trim().length > 0;
}

export function imageCapableProviders(providers: Provider[]): Provider[] {
  return providers.filter(isImageProvider);
}

/** Default image model per kind. OpenAI-compatible → gpt-image-1 (dall-e-3 is
 * the documented fallback if a key lacks gpt-image-1 access — overridable via
 * the Control Panel). Google → Imagen 4 (Imagen 3 is shut down). */
export function defaultImageModel(kind: ProviderKind): string {
  return kind === "google" ? "imagen-4.0-generate-001" : "gpt-image-1";
}

/** Choose the provider to generate with. Prefers the first OpenAI-ish provider
 * (broadest model support), else the first capable one. Null when none. */
export function pickImageProvider(providers: Provider[]): Provider | null {
  const capable = imageCapableProviders(providers);
  if (capable.length === 0) return null;
  return (
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

/** Aspect ratio (w/h) of a "WxH" size string; 1 when unparseable. */
export function sizeAspect(size: string): number {
  const m = size.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/);
  if (!m) return 1;
  const w = parseInt(m[1]!, 10);
  const h = parseInt(m[2]!, 10);
  return w > 0 && h > 0 ? w / h : 1;
}
