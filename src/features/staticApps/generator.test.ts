// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import fixture from "./__fixtures__/source2048.json";
import { validateStaticSource, sourceForPreparation } from "./source";
import { prepareStaticCandidate, verifyPreparedCandidate } from "./generator";
import { RECIPE_2048 } from "./recipe";
import { decodeText, digest, encodeText, fromBase64, toBase64 } from "./hash";
import { escapeNotice } from "./template";
import { validatePluginManifest } from "@/plugins/manifest";
const ID = "01M3R357PETNKJ71CQ5M5F0B2X";
const packet = () => structuredClone(fixture.sourcePacket);
const goldenPath = resolve("src/features/staticApps/__fixtures__/candidate2048-golden.json");
const text = (candidate: Awaited<ReturnType<typeof prepareStaticCandidate>>, path: string) => {
  const f = candidate.files.find((f) => f.path === path)!;
  return decodeText(fromBase64(f.dataBase64, f.bytes));
};
describe("pinned static-app preparation without source execution", () => {
  it("binds the exact complete source and deterministic golden output", async () => {
    const source = await validateStaticSource(packet()), a = await prepareStaticCandidate(source, ID), b = await prepareStaticCandidate(source, ID);
    expect(a).toEqual(b); expect(source.totalBytes).toBe(172077); expect(a.files).toHaveLength(35);
    const summary = { sourceHash: a.sourceHash, recipeHash: a.recipeHash, outputHash: a.outputHash, totalBytes: a.totalBytes, files: a.files.map(({ dataBase64: _, ...f }) => f) };
    if (process.env.ORION_UPDATE_RECIPE_GOLDEN === "1") writeFileSync(goldenPath, JSON.stringify(summary, null, 2) + "\n");
    expect(summary).toEqual(JSON.parse(readFileSync(goldenPath, "utf8")));
    expect(await verifyPreparedCandidate(JSON.parse(JSON.stringify(a)), source)).toEqual(a);
  });
  it("is independent of caller source ordering", async () => {
    const a = packet(), b = packet(); b.files.reverse();
    expect(await validateStaticSource(a)).toEqual(await validateStaticSource(b));
  });
  it("validates a storage-only UI manifest with a distinct host identity", async () => {
    const a = await prepareStaticCandidate(await validateStaticSource(packet()), ID), manifest = JSON.parse(text(a, "orion-plugin.json"));
    expect(validatePluginManifest(manifest).ok).toBe(true); expect(manifest.id).toBe("dev.orion.prepared2048.01m3r357petnkj71cq5m5f0b2x");
    expect(manifest.permissions).toEqual(["storage.plugin"]); expect(manifest.dependencies).toEqual({}); expect(manifest.entrypoints).toEqual({ ui: "ui.html" });
    expect(manifest.contributes.aiTools).toEqual([]); expect(manifest.activationEvents).toEqual(["onApp:game2048"]);
  });
  it("retains every source/font/notice byte and verbatim engine body, with no QA", async () => {
    const source = await validateStaticSource(packet()), a = await prepareStaticCandidate(source, ID), document = text(a, "ui.html");
    for (const spec of RECIPE_2048.files) {
      const f = a.files.find((f) => f.path === spec.packagePath)!;
      expect(f.sha256).toBe(spec.sha256); expect(f.bytes).toBe(spec.bytes); expect(await digest(fromBase64(f.dataBase64, f.bytes))).toBe(spec.sha256);
    }
    for (const path of RECIPE_2048.enginePaths) expect(document).toContain(`<script>\n${text(a, `original/${path}`)}\n</script>`);
    expect(document.match(/<script>/g)).toHaveLength(10); expect(document.match(/data:font\/woff;base64,/g)).toHaveLength(3);
    expect(document).toContain('data-orion-appearance="v1" data-orion-skin="2048"'); expect(document).toContain("Gabriele Cirulli");
    expect(document).not.toMatch(/<(?:iframe|object|embed|link|base|img)\b/i); expect(document).not.toContain("Synthetic QA");
    expect(a.files.some((f) => /(?:qa\.js|Rakefile|\.svg$|\.eot$)/.test(f.path))).toBe(false);
    expect(text(a, "adapter/boot.js")).toContain("Close and reopen this app");
    expect(text(a, "APPEARANCE.md")).toContain("Original remains");
  });
  it("carries complete source/implementation/output lineage without authority", async () => {
    const source = await validateStaticSource(packet()), a = await prepareStaticCandidate(source, ID), p = JSON.parse(text(a, "PROVENANCE.json"));
    expect(p.sourceHash).toBe(source.sourceHash); expect(p.sourceInventory).toEqual(source.files); expect(p.recipeHash).toBe(a.recipeHash);
    expect(p.adapterHashes).toHaveLength(3); expect(p.implementationHashes).toHaveLength(8); expect(p.payloadBeforeProvenance).toHaveLength(34);
    expect(p.authority).toContain("separate review"); expect(p.limitations.join(" ")).toContain("not publisher authentication");
  });
  it("does not perform fetch, code evaluation or UI construction", async () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected fetch"); }); vi.stubGlobal("fetch", fetch);
    try { await prepareStaticCandidate(await validateStaticSource(packet()), ID); expect(fetch).not.toHaveBeenCalled(); expect(globalThis).not.toHaveProperty("GameManager"); expect(globalThis).not.toHaveProperty("Orion2048Adapter"); }
    finally { vi.unstubAllGlobals(); }
  });
  it.each(["version", "recipe", "repository", "commit", "path", "mode", "missing", "extra", "duplicate", "bytes", "base64", "metadata"])("refuses %s changes without a candidate", async (kind) => {
    const p = packet();
    if (kind === "version") p.version = 999;
    if (kind === "recipe") p.recipeId = "universal";
    if (kind === "repository") p.files[0]!.repository = "hostile/2048";
    if (kind === "commit") p.files[0]!.commit = "HEAD";
    if (kind === "path") p.files[0]!.path = "../index.html";
    if (kind === "mode") p.files[0]!.sourceMode = "120000";
    if (kind === "missing") p.files.pop();
    if (kind === "extra") p.files.push(p.files[0]!);
    if (kind === "duplicate") p.files[0] = p.files[1]!;
    if (kind === "bytes") { const f = p.files[0]!, bytes = fromBase64(f.dataBase64, RECIPE_2048.files[0]!.bytes); bytes[3] = bytes[3]! ^ 1; f.dataBase64 = toBase64(bytes); }
    if (kind === "base64") p.files[0]!.dataBase64 = "!".repeat(p.files[0]!.dataBase64.length);
    if (kind === "metadata") Object.assign(p.files[0]!, { permissions: ["process"] });
    await expect(validateStaticSource(p)).rejects.toThrow();
  });
  it("rejects sparse, accessor, inherited and symbol records without invoking getters", async () => {
    const getter = vi.fn(() => "bad"), p = packet(); Object.defineProperty(p.files[0], "dataBase64", { get: getter });
    await expect(validateStaticSource(p)).rejects.toThrow("accessors"); expect(getter).not.toHaveBeenCalled();
    const sparse = packet(); delete sparse.files[0]; await expect(validateStaticSource(sparse)).rejects.toThrow();
    const symbol = packet(); Object.assign(symbol, { [Symbol("authority")]: true }); await expect(validateStaticSource(symbol)).rejects.toThrow();
    await expect(validateStaticSource(Object.create(fixture.sourcePacket))).rejects.toThrow();
  });
  it("captures bytes before await and isolates preparation copies", async () => {
    const p = packet(), pending = validateStaticSource(p); p.files[0]!.dataBase64 = "invalid";
    const source = await pending, map = sourceForPreparation(source); map.values().next().value!.fill(0);
    const a = await prepareStaticCandidate(source, ID); expect(a.files).toHaveLength(35); expect(Object.isFrozen(source.files[0])).toBe(true);
    await expect(prepareStaticCandidate(structuredClone(source), ID)).rejects.toThrow("Validate the exact");
  });
  it("binds identity independently of source, and rejects existing/forged candidate edits", async () => {
    const source = await validateStaticSource(packet()), a = await prepareStaticCandidate(source, ID), b = await prepareStaticCandidate(source, "01M3R357PETNKJ71CQ5M5F0B2Y");
    expect(b.sourceHash).toBe(a.sourceHash); expect(b.outputHash).not.toBe(a.outputHash); expect(b.pluginId).not.toBe(a.pluginId);
    await expect(prepareStaticCandidate(source, "dev.orion.2048-proof")).rejects.toThrow("host-generated");
    for (const field of ["sourceHash", "recipeHash", "outputHash", "pluginId"] as const) {
      const changed = structuredClone(a); changed[field] = field === "pluginId" ? "dev.orion.2048-proof" : "f".repeat(64);
      await expect(verifyPreparedCandidate(changed, source)).rejects.toThrow("changed");
    }
    const changed = structuredClone(a); changed.files[0]!.dataBase64 = changed.files[0]!.dataBase64.replace(/^./, "Z");
    await expect(verifyPreparedCandidate(changed, source)).rejects.toThrow("changed");
    const extra = structuredClone(a); Object.assign(extra, { enabled: true }); await expect(verifyPreparedCandidate(extra, source)).rejects.toThrow();
  });
  it("refuses candidate inventory overflow, sparse arrays, accessors and traversal", async () => {
    const source = await validateStaticSource(packet()), a = await prepareStaticCandidate(source, ID);
    const overflow = structuredClone(a); overflow.totalBytes = 1; await expect(verifyPreparedCandidate(overflow, source)).rejects.toThrow("aggregate bounds");
    const sparse = structuredClone(a); delete sparse.files[0]; await expect(verifyPreparedCandidate(sparse, source)).rejects.toThrow();
    const traversal = structuredClone(a); traversal.files[0]!.path = "../escape.js"; await expect(verifyPreparedCandidate(traversal, source)).rejects.toThrow("changed");
    const getter = vi.fn(() => "bad"), access = structuredClone(a); Object.defineProperty(access.files[0], "dataBase64", { get: getter });
    await expect(verifyPreparedCandidate(access, source)).rejects.toThrow("accessors"); expect(getter).not.toHaveBeenCalled();
  });
  it("binds allowed ancillary mode metadata without pretending native tree verification", async () => {
    const p = packet(), index = RECIPE_2048.files.findIndex((f) => f.sourceMode === undefined);
    p.files[index]!.sourceMode = "100755";
    const a = await validateStaticSource(packet()), b = await validateStaticSource(p);
    expect(b.sourceHash).not.toBe(a.sourceHash); expect(b.totalBytes).toBe(a.totalBytes);
  });
  it("escapes notices and refuses noncanonical bounded base64", () => {
    expect(escapeNotice('<script x="\'">&</script>')).toBe("&lt;script x=&quot;&#x27;&quot;&gt;&amp;&lt;/script&gt;");
    expect(() => fromBase64("AB==", 1)).toThrow("Non-canonical"); expect(toBase64(encodeText("safe"))).toBe("c2FmZQ==");
  });
});
