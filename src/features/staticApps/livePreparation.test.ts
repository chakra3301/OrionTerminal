// @vitest-environment node
import { expect, it } from "vitest";
import { readFileSync, writeFileSync, lstatSync } from "node:fs";
import { join, basename, isAbsolute } from "node:path";
import { ulid } from "ulid";
import { validateCapture } from "./capture";
import { prepareStaticCandidate, verifyPreparedCandidate } from "./generator";
const root = process.env.ORION_INTAKE_PROOF_ROOT;
it.skipIf(!root)("regenerates a fresh candidate from actual native-captured pinned bytes without evaluating source", async () => {
  if (!root || !isAbsolute(root) || !basename(root).startsWith("incubator-v1-") || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error("Explicit private proof root required");
  const captured = await validateCapture(JSON.parse(readFileSync(join(root, "live-capture.json"), "utf8")));
  const candidate = await prepareStaticCandidate(captured.source, ulid());
  expect(await verifyPreparedCandidate(candidate, captured.source)).toEqual(candidate);
  expect(candidate.files).toHaveLength(35); expect(candidate.sourceHash).toBe(captured.summary.sourceHash);
  writeFileSync(join(root, "live-candidate.json"), JSON.stringify(candidate), { flag: "wx", mode: 0o600 });
  writeFileSync(join(root, "live-generation-receipt.json"), JSON.stringify({ source: captured.summary, candidateId: candidate.candidateId, pluginId: candidate.pluginId, recipeHash: candidate.recipeHash, outputHash: candidate.outputHash, totalBytes: candidate.totalBytes, fileCount: candidate.files.length, authority: "Backend test data only; no imported execution, UI review, installation, activation or provider call" }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
});
