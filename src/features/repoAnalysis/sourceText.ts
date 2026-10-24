// Extracted from Orion's MIT-attributed RepoLens port; framing is not a security boundary.
export const ANALYSIS_SYSTEM_PROMPT = [
  "You are running a text analysis call.",
  "Do not call tools, run commands, browse, or modify files.",
  "Analyze only the material in the user prompt and return exactly the requested output.",
].join(" ");
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|preceding|earlier)\s+(instructions?|prompts?|messages?)/gi,
  /disregard\s+(all\s+)?(the\s+)?(previous|prior|above|preceding|earlier)\s+(instructions?|prompts?|text|content)/gi,
  /forget\s+(all\s+)?(your\s+|the\s+)?(previous\s+|prior\s+)?instructions?/gi,
  /system\s*prompt\s*:/gi,
  /\bnew\s+instructions?\s*:/gi,
  /override\s+(your|the|all)\s+(instructions?|rules?|guidelines?|system)/gi,
  /you\s+are\s+now\s+(a\s+|an\s+)?(helpful\s+)?(assistant|ai|language\s+model|model|chatbot|claude|gpt|chatgpt)\b/gi,
];
export function sanitizeReadme(text: unknown): string {
  let s = String(text ?? "");
  s = s.replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\r" || c === "\t" ? c : ""));
  for (const re of INJECTION_PATTERNS) s = s.replace(re, "[redacted: instruction-like text]");
  return s.replace(/\n{4,}/g, "\n\n\n");
}
export function assertShareable(text: string): void {
  if (/PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{22,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})/.test(text)) {
    throw new Error("Possible credential material found. Prepare a reviewed redacted source/goal before analysis. No upload occurred.");
  }
}
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
