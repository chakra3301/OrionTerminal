import { afterEach, describe, expect, it } from "vitest";
import { registry } from "@/commands/registry";
import { appRegistry } from "@/plugins/appRegistry";
import {
  activateCommunityPlugin,
  communityAppId,
  deactivateCommunityPlugin,
} from "@/plugins/communityRuntime";
import type { InstalledCommunityPlugin } from "@/plugins/communityTypes";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generateGlyph } from "@/identity/glyph";
import { identityAccent } from "@/identity/color";

const record: InstalledCommunityPlugin = {
  manifest: {
    id: "dev.orion.hello",
    name: "Hello Orion",
    version: "1.0.0",
    apiVersion: "1",
    engines: { orion: "*" },
    publisher: "test",
    entrypoints: { ui: "ui.html" },
    contributes: {
      apps: [{ id: "hello", name: "Hello", accent: "violet" }],
      commands: [{ id: "hello.open", title: "Open Hello", app: "hello" }],
    },
    permissions: [],
  },
  enabled: true,
  grantedPermissions: [],
  fingerprint: "a".repeat(64),
  installedAt: 1,
  quarantined: false,
  quarantineReason: null,
  workspaceHandles: [],
};

afterEach(() => {
  deactivateCommunityPlugin(record.manifest.id);
});

describe("community declarative contribution runtime", () => {
  it("registers and owner-disposes app and command surfaces", () => {
    activateCommunityPlugin(record);
    const appId = communityAppId(record.manifest.id, "hello");
    const Icon = appRegistry.get(appId)!.dock.Icon;
    expect(renderToStaticMarkup(createElement(Icon))).toContain(generateGlyph(`app:${appId}`).path);
    expect(appRegistry.get(appId)?.renderer).toEqual({
      kind: "sandboxed-plugin",
      pluginId: record.manifest.id,
      contributionId: "hello",
    });
    const command = registry.list().find((item) => item.label === "Open Hello");
    expect(command).toBeTruthy();
    expect(registry.ownerOf(command!.id)).toBe(record.manifest.id);

    expect(deactivateCommunityPlugin(record.manifest.id)).toEqual([]);
    expect(appRegistry.has(appId)).toBe(false);
    expect(registry.list().some((item) => item.label === "Open Hello")).toBe(false);
  });

  it("rejects activation before any malformed manifest contribution registers", () => {
    const invalid = {
      ...record,
      manifest: {
        ...record.manifest,
        contributes: { apps: [{ id: "bad", name: "Bad", invoke: true }] },
      },
    } as unknown as InstalledCommunityPlugin;
    expect(() => activateCommunityPlugin(invalid)).toThrow("invoke is not supported");
    expect(appRegistry.has(communityAppId(record.manifest.id, "bad"))).toBe(false);
  });

  it("generates identity colours for apps without a requested accent", () => {
    activateCommunityPlugin({ ...record, manifest: { ...record.manifest, contributes: {
      apps: [{ id: "hello", name: "Hello" }, { id: "second", name: "Second" }],
    } } });
    const first = communityAppId(record.manifest.id, "hello"), second = communityAppId(record.manifest.id, "second");
    expect(appRegistry.get(first)?.accent).toBe(identityAccent(`app:${first}`));
    expect(appRegistry.get(second)?.accent).not.toBe(appRegistry.get(first)?.accent);
  });
});
