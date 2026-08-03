import { describe, expect, it } from "vitest";
import { validatePluginManifest } from "./manifest";

function validManifest() {
  return {
    id: "com.orion.git",
    name: "Git",
    version: "1.0.0",
    apiVersion: "1",
    engines: { orion: ">=1.0.0 <2" },
    publisher: "orion",
    entrypoints: { background: "dist/background.js", ui: "dist/ui/index.html" },
    activationEvents: ["onApp:orion", "onCommand:git.open"],
    dependencies: { "@orion/editor": ">=1.0.0 <2" },
    contributes: { commands: [], views: [] },
    permissions: ["workspace.read", "process.git", "network:https://github.com"],
  };
}

describe("plugin manifest v1 validation", () => {
  it("accepts the v1 manifest contract", () => {
    const result = validatePluginManifest(validManifest());
    expect(result).toEqual({ ok: true, manifest: validManifest() });
  });

  it("fails closed on unknown authority-bearing fields", () => {
    const manifest = { ...validManifest(), invokeTauri: true };
    const result = validatePluginManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain("manifest.invokeTauri is not supported");
  });

  it("rejects unknown permissions and credential-bearing network origins", () => {
    const unknown = validatePluginManifest({ ...validManifest(), permissions: ["process.spawn"] });
    const credential = validatePluginManifest({
      ...validManifest(),
      permissions: ["network:https://user:pass@example.com"],
    });
    expect(unknown.ok).toBe(false);
    expect(credential.ok).toBe(false);
  });

  it("rejects absolute and traversal entrypoints", () => {
    const traversal = validatePluginManifest({
      ...validManifest(),
      entrypoints: { ui: "../shell/index.html" },
    });
    const absolute = validatePluginManifest({
      ...validManifest(),
      entrypoints: { background: "/tmp/plugin.js" },
    });
    const remote = validatePluginManifest({
      ...validManifest(),
      entrypoints: { ui: "https://attacker.example/plugin.js" },
    });
    expect(traversal.ok).toBe(false);
    expect(absolute.ok).toBe(false);
    expect(remote.ok).toBe(false);
  });

  it("rejects unknown contribution and activation keys", () => {
    const contribution = validatePluginManifest({
      ...validManifest(),
      contributes: { tauriCommands: [] },
    });
    const activation = validatePluginManifest({
      ...validManifest(),
      activationEvents: ["onAnything"],
    });
    expect(contribution.ok).toBe(false);
    expect(activation.ok).toBe(false);
  });
});
