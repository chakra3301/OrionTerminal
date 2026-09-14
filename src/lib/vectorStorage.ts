const MAX_BYTES = 65_536;

// SQL plugin array bindings are JSON TEXT, even in a SQLite BLOB column.
// Keep that representation explicit while accepting legacy binary readers.
export function decodeVectorBytes(value: unknown): Uint8Array | null {
  if (typeof value === "string") {
    if (value.length > MAX_BYTES * 4 + 2) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (value instanceof Uint8Array) {
    return value.length > 0 && value.length <= MAX_BYTES && value.length % 4 === 0 ? value : null;
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BYTES || value.length % 4 !== 0) return null;
  if (value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
  return new Uint8Array(value);
}

export function encodeVectorBytes(value: Uint8Array): string {
  if (!decodeVectorBytes(value)) throw new Error("Invalid embedding byte buffer");
  return JSON.stringify(Array.from(value));
}
