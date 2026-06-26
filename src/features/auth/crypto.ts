// Soft-lock auth crypto. PBKDF2 (Web Crypto) salted hash — a privacy/cosmetic
// gate, NOT disk encryption. Forgetting the password never costs data: the
// reset escape hatch wipes the hash and the vault reopens unlocked.

const PBKDF2_ITERATIONS = 210_000;
const HASH_BITS = 256;

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 16 random bytes, base64. */
export function randomSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** 32 random bytes, base64 — the remember-me session token. */
export function randomToken(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}

/** Derive a base64 PBKDF2-SHA256 hash of `password` under `saltB64`. */
export async function deriveHash(
  password: string,
  saltB64: string,
): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_BITS,
  );
  return bytesToBase64(new Uint8Array(bits));
}

/** Length-stable string compare — avoids leaking match position via timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
