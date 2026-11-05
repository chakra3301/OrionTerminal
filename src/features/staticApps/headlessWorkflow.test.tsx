// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, webcrypto } from "node:crypto";
import { ulid } from "ulid";
const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: m.invoke }));
vi.mock("@/components/ConfirmModal", () => ({ confirmAction: async () => true }));
import { StaticAppPreparation } from "./StaticAppPreparation";
import { useCommunityPlugins } from "@/store/communityPluginStore";
import { resetCommunityActivity } from "@/plugins/communityActivity";
import { staticCaptures } from "./capture";
import { preparedApps } from "./prepared";
const rootPath = process.env.ORION_INTAKE_PROOF_ROOT, executable = process.env.ORION_INTAKE_TEST_EXECUTABLE, executableHash = process.env.ORION_INTAKE_TEST_SHA256;
it.skipIf(!rootPath || !executable || !executableHash)("drives shared preparation UI through actual native-core persistence and disabled publication without a screen", async () => {
  const root = rootPath!, exe = executable!;
  expect(createHash("sha256").update(readFileSync(exe)).digest("hex")).toBe(executableHash);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal("crypto", webcrypto); resetCommunityActivity();
  const commands: { id: string; command: string; ok: boolean }[] = [];
  async function native(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const id = ulid(); writeFileSync(join(root, `${id}.request.json`), JSON.stringify({ command, ...args }), { mode: 0o600, flag: "wx" });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TOKEN|PASSWORD|SECRET|API_KEY|NODE_OPTIONS|NODE_PATH|DYLD_|LD_PRELOAD/i.test(k)));
    await promisify(execFile)(exe, ["intake::github::static_apps::prepared::install::tests::headless::exchange_one_owned_request", "--ignored", "--exact", "--test-threads=1"], { env: { ...env, ORION_INTAKE_PROOF_ROOT: root, ORION_INTAKE_BRIDGE_ID: id }, timeout: 20_000, maxBuffer: 1024 * 1024 });
    const response = JSON.parse(readFileSync(join(root, `${id}.response.json`), "utf8")); commands.push({ id, command, ok: response.ok });
    if (!response.ok) throw new Error(response.error); return response.value;
  }
  await native("init"); m.invoke.mockImplementation(native);
  useCommunityPlugins.setState({ installed: [], hydrated: true, recoveryBlocked: false, busyIds: [], error: null });
  const host = document.createElement("div"); document.body.append(host); const react = createRoot(host);
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  async function click(text: string) { await act(async () => button(text).click()); }
  async function settled() {
    const deadline = Date.now() + 30_000;
    do { await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); if (!host.querySelector('[aria-busy="true"]')) return; } while (Date.now() < deadline);
    throw new Error("Headless preparation did not settle within 30s");
  }
  try {
    await act(async () => react.render(<StaticAppPreparation />)); await settled(); expect(host.textContent).toContain("Saved sources · 1/8");
    expect(commands.some((r) => r.command === "intake_prepared_install")).toBe(false);
    await click("Prepare and save"); await settled(); expect(host.textContent).toContain("Candidate saved locally");
    const summaries = await preparedApps.list(); expect(summaries).toHaveLength(1); const summary = summaries[0]!;
    await act(async () => react.render(null)); await act(async () => react.render(<StaticAppPreparation />)); await settled();
    await click("Review candidate"); await settled(); expect(host.textContent).toContain(summary.inspection.fingerprint); expect(button("Install disabled").disabled).toBe(true);
    await click("ui.html"); expect(host.querySelector("pre")?.textContent).toContain("<script>"); expect(host.querySelector("script")).toBeNull(); expect(host.querySelector("iframe")).toBeNull();
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Prepared app review"] input')!.click()); await click("Install disabled"); await settled();
    expect(host.textContent).toContain("Installed disabled. Enable explicitly in Plugin Manager"); const installed = useCommunityPlugins.getState().installed[0]!;
    expect(installed.enabled).toBe(false); expect(installed.fingerprint).toBe(summary.inspection.fingerprint); expect(installed.grantedPermissions).toEqual(["storage.plugin"]); expect(installed.workspaceHandles).toEqual([]);
    await expect(staticCaptures.discard(summary.source)).rejects.toThrow();
    await click("Review candidate"); await settled(); expect(host.textContent).toContain("already installed disabled");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Install disabled")).toBe(false);
    await click("Close candidate review"); await click("Discard candidate"); await settled(); expect(await preparedApps.list()).toHaveLength(0);
    await click("Discard source"); await settled(); expect(await staticCaptures.list()).toHaveLength(0);
    const snapshot = await native("snapshot") as { sources: unknown[]; candidates: unknown[]; states: { enabled: boolean; grantedPermissions: string[]; workspaceGrants: unknown[] }[] };
    expect(snapshot.sources).toHaveLength(0); expect(snapshot.candidates).toHaveLength(0); expect(snapshot.states).toHaveLength(1); expect(snapshot.states[0]!.enabled).toBe(false);
    expect(useCommunityPlugins.getState().installed).toHaveLength(1);
    writeFileSync(join(root, "headless-workflow-receipt.json"), JSON.stringify({ schemaVersion: 1, summary, installed, snapshot, commands, testExecutableSha256: executableHash, authority: "Shared real frontend validators/generator/UI/Manager store over test-only file transport to production native-core functions in scratch. Actual previously acquired public source. Mocked transport, test-only acknowledgement, no packaged Tauri IPC/GUI/human consent/enable/imported source execution/provider or app-profile write." }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  } finally {
    await act(async () => react.unmount()); host.remove(); vi.unstubAllGlobals();
    writeFileSync(join(root, "headless-command-log.json"), JSON.stringify(commands, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  }
}, 120_000);
