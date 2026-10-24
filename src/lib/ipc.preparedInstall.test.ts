import { expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { ipc } from "./ipc";
import type { PreparedInstallSelection } from "@/plugins/communityTypes";
it("sends only selected candidate/capture/output/fingerprint plus explicit rights/grants, never a directory or enable flag", async () => {
  const s: PreparedInstallSelection = { id: "01M3R357PETNKJ71CQ5M5F0B2X", outputHash: "a".repeat(64), captureHash: "b".repeat(64), inspection: { manifest: { id: "dev.orion.prepared2048.01m3r357petnkj71cq5m5f0b2x", name: "2048", version: "0.1.0", apiVersion: "1", engines: { orion: "*" }, publisher: "local adapter", permissions: ["storage.plugin"] }, fingerprint: "c".repeat(64), fileCount: 35, totalBytes: 404807 } };
  invoke.mockResolvedValueOnce(undefined); await ipc.pluginInstallPrepared(s, true);
  expect(invoke.mock.calls).toEqual([["intake_prepared_install", { approval: { schemaVersion: 1, id: s.id, outputHash: s.outputHash, captureHash: s.captureHash, fingerprint: s.inspection.fingerprint, permissions: ["storage.plugin"], rightsReviewed: true } }]]);
});
