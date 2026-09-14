// Regression guard for the Zustand v5 infinite-render crash: selectors that
// return a fresh reference each call (e.g. `s.list()` / `Array.from(...)` /
// `.filter(...)`) make React's useSyncExternalStore snapshot check always
// differ → "Maximum update depth exceeded". These components must select a
// stable slice and derive in the render body. We mount each and assert it
// renders without the loop error.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";

import { AgentForge } from "./AgentForge";
import { SkillLibraryPanel } from "./SkillLibraryPanel";
import { SkillEditor } from "./SkillEditor";
import { ProvidersPanel } from "./ProvidersPanel";
import { PluginManagerPanel } from "./PluginManagerPanel";
import { ModelSelect } from "@/components/ModelSelect";
import type { Skill } from "@/features/agents/agentTypes";
import { useProvidersStore } from "@/store/providersStore";
import { useCommunityPlugins } from "@/store/communityPluginStore";
import { CODEX_CLI_PROVIDER, CURSOR_SDK_PROVIDER, GEMINI_CLI_PROVIDER } from "@/features/agents/seedData";

// Tauri modules pulled in by these components (only called in handlers).
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (s: string) => s,
  invoke: vi.fn(async (command: string) => {
    if (command === "cli_status") {
      return {
        installed: true,
        loggedIn: false,
        version: "test",
        detail: "Installed. Run login.",
        authMode: null,
        subscriptionReady: false,
        imageReady: false,
      };
    }
    if (command === "cli_auth_scope") return { directory: "/test/codex", shared: true };
    if (command === "plugin_list_installed") return [];
    if (command === "provider_key_status") return true;
    if (command === "cursor_status") {
      return { installed: true, keySaved: true, ready: true, version: "test", detail: "Ready." };
    }
    if (command === "cursor_api_key_status") return true;
    if (command === "nous_oauth_status") return false;
    return null;
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** Mount `el` and return whether it rendered without an infinite-loop error
 *  (either a thrown "Maximum update depth" or the same logged to console). */
function rendersWithoutLoop(el: React.ReactElement): { ok: boolean; detail: string } {
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errors.push(a.map(String).join(" "));
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  let threw: unknown = null;
  try {
    act(() => {
      root.render(el);
    });
    act(() => {
      root.unmount();
    });
  } catch (e) {
    threw = e;
  }
  spy.mockRestore();
  const loop =
    /Maximum update depth/i.test(String(threw ?? "")) ||
    errors.some((e) => /Maximum update depth/i.test(e));
  return { ok: !loop && !threw, detail: loop ? "infinite render loop" : String(threw ?? "") };
}

const sampleSkill: Skill = {
  id: "s1",
  name: "Test Skill",
  icon: "",
  accent: "#b14cff",
  instructions: "",
  tools: [],
  builtin: false,
};

describe("Control Panel surfaces render without a Zustand v5 selector loop", () => {
  it("AgentForge mounts", () => {
    expect(rendersWithoutLoop(<AgentForge />)).toEqual({ ok: true, detail: "" });
  });
  it("SkillLibraryPanel mounts", () => {
    expect(rendersWithoutLoop(<SkillLibraryPanel />)).toEqual({ ok: true, detail: "" });
  });
  it("SkillEditor mounts", () => {
    expect(rendersWithoutLoop(<SkillEditor skill={sampleSkill} onClose={() => {}} />)).toEqual({ ok: true, detail: "" });
  });
  it("ProvidersPanel mounts", () => {
    useProvidersStore.setState({
      providers: [
        CODEX_CLI_PROVIDER,
        GEMINI_CLI_PROVIDER,
        CURSOR_SDK_PROVIDER,
        {
          id: "p-openai",
          name: "OpenAI",
          kind: "openai",
          baseUrl: "",
          models: [{ id: "gpt-test", label: "gpt-test" }],
          keyRef: "p-openai",
          enabled: true,
          builtin: false,
        },
      ],
      loaded: true,
    });
    expect(rendersWithoutLoop(<ProvidersPanel />)).toEqual({ ok: true, detail: "" });
  });
  it("ModelSelect mounts", () => {
    expect(rendersWithoutLoop(<ModelSelect surface="orion" />)).toEqual({ ok: true, detail: "" });
  });
  it("PluginManagerPanel mounts", () => {
    expect(rendersWithoutLoop(<PluginManagerPanel />)).toEqual({ ok: true, detail: "" });
  });
});

describe("Plugin Manager resource grants", () => {
  it("shows workspace labels and modes without exposing opaque IDs", async () => {
    const handle = "b".repeat(64);
    const refreshResources = useCommunityPlugins.getState().refreshResources;
    act(() => useCommunityPlugins.setState({
      refreshResources: async () => {},
      installed: [{
        manifest: {
          id: "dev.orion.workspace-lens",
          name: "Workspace Lens",
          version: "1.0.0",
          apiVersion: "1",
          engines: { orion: "*" },
          publisher: "Orion SDK Examples",
          permissions: ["workspace.read"],
        },
        enabled: false,
        grantedPermissions: ["workspace.read"],
        fingerprint: "a".repeat(64),
        installedAt: 1,
        quarantined: false,
        quarantineReason: null,
        workspaceHandles: [{ id: handle, label: "Notes", read: true, write: false }],
      }],
    }));
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<PluginManagerPanel />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Approved workspaces");
    expect(container.textContent).toContain("Notes");
    expect(container.textContent).toContain("Read only");
    expect(container.textContent).not.toContain(handle);
    await act(async () => {
      root.unmount();
    });
    act(() => useCommunityPlugins.setState({ installed: [], refreshResources }));
  });
});

describe("ProvidersPanel API keys", () => {
  it("can attach a keyRef to an existing OpenAI provider so XDesign can use it", async () => {
    vi.clearAllMocks();
    const provider = {
      id: "p-openai-existing",
      name: "OpenAI",
      kind: "openai" as const,
      baseUrl: "",
      models: [{ id: "gpt-image-1", label: "gpt-image-1" }],
      keyRef: "",
      enabled: true,
      builtin: false,
    };
    const save = vi.fn(async (p) => {
      useProvidersStore.setState({ providers: [p], loaded: true });
    });
    useProvidersStore.setState({
      providers: [provider],
      loaded: true,
      save,
    });

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<ProvidersPanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="API key"]');
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "sk-test");
      input!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "sk-test" }));
    });

    const saveButton = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Save key");
    expect(saveButton).toBeTruthy();
    expect(saveButton!.disabled).toBe(false);
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(invoke).toHaveBeenCalledWith("provider_key_set", {
      keyRef: provider.id,
      key: "sk-test",
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ keyRef: provider.id }));
    expect(useProvidersStore.getState().providers[0]?.keyRef).toBe(provider.id);

    await act(async () => {
      root.unmount();
    });
  });
});
