export async function digest(bytes: Uint8Array, algorithm: "SHA-256" | "SHA-1" = "SHA-256"): Promise<string> {
  const result = await crypto.subtle.digest(algorithm, new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(result), (b) => b.toString(16).padStart(2, "0")).join("");
}
export const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);
export const decodeText = (bytes: Uint8Array): string => {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error("NUL is not supported in preparation text");
  return text;
};
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function fromBase64(value: unknown, bytes: number): Uint8Array {
  if (typeof value !== "string" || value.length !== 4 * Math.ceil(bytes / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Invalid bounded preparation bytes");
  const binary = atob(value), result = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (result.length !== bytes || toBase64(result) !== value) throw new Error("Non-canonical preparation bytes");
  return result;
}
export async function gitBlobDigest(bytes: Uint8Array): Promise<string> {
  const prefix = encodeText(`blob ${bytes.length}\0`), blob = new Uint8Array(prefix.length + bytes.length);
  blob.set(prefix); blob.set(bytes, prefix.length);
  return digest(blob, "SHA-1");
}
