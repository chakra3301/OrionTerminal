import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./api", () => ({ intake: m }));
import { readAnalysisSource } from "./analysisSource";
import { candidateFixture } from "./testFixture";
import { sha256 } from "@/features/repoAnalysis/sourceText";
async function candidate(body: string) { return { ...candidateFixture, totalBytes: new TextEncoder().encode(body).length, files: [{ ...candidateFixture.files[0]!, bytes: new TextEncoder().encode(body).length, sha256: await sha256(body) }] }; }
beforeEach(() => vi.resetAllMocks());
it("hash-checks selected original bytes and explicitly marks long excerpts", async () => {
  const body = "x".repeat(87_253), c = await candidate(body); m.read.mockResolvedValue(body);
  const result = await readAnalysisSource(c, [c.files[0]!.path], new AbortController().signal);
  expect(result.excerpts[0]!.text).toHaveLength(8000); expect(result.excerpts[0]!.truncated).toBe(true);
  expect(result.excerpts[0]!.originalBytes).toBe(87_253); expect(result.excerpts[0]!.sha256).toBe(await sha256(body)); expect(m.read).toHaveBeenCalledOnce();
  const unicode = `${"x".repeat(7999)}🎯tail`, unicodeCandidate = await candidate(unicode);
  m.read.mockResolvedValue(unicode);
  const clipped = await readAnalysisSource(unicodeCandidate, [unicodeCandidate.files[0]!.path], new AbortController().signal);
  expect(clipped.excerpts[0]!.text).toBe("x".repeat(7999)); expect(clipped.excerpts[0]!.truncated).toBe(true);
});
it("refuses tampered bytes, undeclared paths and duplicate selections", async () => {
  const c = await candidate("original"); m.read.mockResolvedValue("tampered");
  await expect(readAnalysisSource(c, [c.files[0]!.path], new AbortController().signal)).rejects.toThrow("changed");
  await expect(readAnalysisSource(c, ["../private"], new AbortController().signal)).rejects.toThrow("declared");
  await expect(readAnalysisSource(c, [c.files[0]!.path, c.files[0]!.path], new AbortController().signal)).rejects.toThrow("one to four");
});
it("screens the complete selected file for credential hints before excerpting", async () => {
  const body = `${"x".repeat(8500)} sk-${"a".repeat(32)}`, c = await candidate(body); m.read.mockResolvedValue(body);
  await expect(readAnalysisSource(c, [c.files[0]!.path], new AbortController().signal)).rejects.toThrow("credential");
});
it("an aborted read never yields an upload-ready source", async () => {
  const c = await candidate("original"), controller = new AbortController();
  m.read.mockImplementation(async () => { controller.abort(); return "original"; });
  await expect(readAnalysisSource(c, [c.files[0]!.path], controller.signal)).rejects.toThrow("cancelled");
});
