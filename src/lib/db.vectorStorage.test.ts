import { beforeEach, expect, it, vi } from "vitest";
import { listEmbeddings, listCodeChunks, upsertEmbedding, replaceCodeChunks } from "./db";

const db = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn(async (..._args: unknown[]) => ({})) }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: async () => db } }));
beforeEach(() => vi.clearAllMocks());
const bytes = new Uint8Array(new Float32Array([1, 0.5]).buffer);
const stored = JSON.stringify(Array.from(bytes));

it("recovers existing JSON-text archive vectors and skips malformed rows", async () => {
  db.select.mockResolvedValue([
    { entity_kind: "note", entity_id: "valid", vector: stored, text_hash: "h" },
    { entity_kind: "note", entity_id: "invalid", vector: "broken", text_hash: "h" },
  ]);
  expect(await listEmbeddings()).toEqual([{ kind: "note", id: "valid", vector: bytes, textHash: "h" }]);
});

it("normalizes codebase vectors at the same database boundary", async () => {
  const row = { path: "example.ts", chunk_idx: 0, start_line: 1, end_line: 2, hash: "h", vector: stored };
  db.select.mockResolvedValue([row]);
  expect(await listCodeChunks("project")).toEqual([{ ...row, vector: bytes }]);
});

it("writes explicit JSON text rather than relying on implicit array binding", async () => {
  await upsertEmbedding("note", "id", bytes, "h");
  expect((db.execute.mock.calls[0]![1] as unknown[])[2]).toBe(stored);
  db.execute.mockClear();
  await replaceCodeChunks("p", "example.ts", "h", [{ idx: 0, startLine: 1, endLine: 2, vector: bytes }]);
  expect((db.execute.mock.calls[1]![1] as unknown[])[6]).toBe(stored);
});
