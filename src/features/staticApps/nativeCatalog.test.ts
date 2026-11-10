// @vitest-environment node
import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import fixture from "./__fixtures__/source2048.json";
import { validateStaticSource } from "./source";
import { prepareStaticCandidate } from "./generator";
import { decodeText, fromBase64 } from "./hash";
it("checks the native fixed-output contract without evaluating upstream code", async () => {
  const candidate = await prepareStaticCandidate(await validateStaticSource(structuredClone(fixture.sourcePacket)), "00000000000000000000000000");
  const manifest = candidate.files.find((f) => f.path === "orion-plugin.json")!;
  const catalog = { version: 1, recipeId: candidate.recipeId, files: candidate.files.filter((f) => !["orion-plugin.json", "PROVENANCE.json"].includes(f.path)).map(({ dataBase64: _, ...f }) => f), manifestTemplate: decodeText(fromBase64(manifest.dataBase64, manifest.bytes)) };
  const path = "src/features/staticApps/output2048.json";
  if (process.env.ORION_UPDATE_NATIVE_CATALOG === "1") {
    writeFileSync(path, JSON.stringify(catalog, null, 2) + "\n");
    writeFileSync("src/features/staticApps/__fixtures__/prepared2048.json", JSON.stringify(candidate) + "\n");
  }
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(catalog);
});
