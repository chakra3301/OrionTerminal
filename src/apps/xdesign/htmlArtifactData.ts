import { MAX_PREVIEW_HTML_BYTES } from "./htmlPreviewBridge";

export type HtmlArtifactData = { version: 1; html: string; title: string; open: boolean };

export function validateHtmlArtifact(value: unknown, legacy = false): HtmlArtifactData {
  const v = value as Partial<HtmlArtifactData> | null;
  if (!v || typeof v !== "object" || Array.isArray(v) ||
    (v.version !== 1 && !(legacy && v.version === undefined)) ||
    typeof v.html !== "string" || new TextEncoder().encode(v.html).byteLength > MAX_PREVIEW_HTML_BYTES ||
    (typeof v.title !== "string" && !(legacy && v.title === undefined)) ||
    (typeof v.title === "string" && v.title.length > 16_384) ||
    (typeof v.open !== "boolean" && !(legacy && v.open === undefined))) {
    throw new Error("Webpage data is invalid, unsupported or exceeds 25 MB. The original has not been overwritten.");
  }
  return { version: 1, html: v.html, title: v.title ?? "Untitled page", open: v.open ?? false };
}

export function legacyHtmlKey(id: string): string { return `xd-html-artifact.${id}`; }

export function readLegacyHtml(key: string): HtmlArtifactData | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try { return validateHtmlArtifact(JSON.parse(raw), true); }
  catch { throw new Error("Browser-stored webpage data could not be migrated. Preserve the browser profile; no original copy was removed."); }
}
