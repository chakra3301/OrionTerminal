import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8");
it("keeps legacy automatic and explicit analysis callers on scoped selection", () => {
  for (const file of ["src/store/assetsStore.ts", "src/features/notes/noteAutoTag.ts", "src/features/notes/noteInlineAi.ts", "src/features/notes/askArchive.ts", "src/apps/orion/ChangesPanel.tsx", "src/features/rosie/avatar/useProactiveCompanion.ts"]) {
    const source = read(file);
    expect(source, file).toContain("runSurfaceAnalysis");
    expect(source, file).not.toContain("ipc.claudeOneshot");
  }
  for (const file of ["src/store/assetsStore.ts", "src/features/notes/noteAutoTag.ts", "src/features/rosie/avatar/useProactiveCompanion.ts"]) {
    expect(read(file), file).toContain("withBackgroundConsent");
  }
  expect(read("src-tauri/src/lib.rs")).not.toContain("claude_cli::claude_oneshot");
  expect(read("src/lib/ipc.ts")).not.toContain('invoke("claude_oneshot');
});
it("never invokes a print-mode model from the quota monitor", () => {
  const source = read("src-tauri/src/sysstats.rs");
  expect(source).not.toContain('cmd.args(["--print", "/usage"])');
  expect(source).toContain('cli_auth::cli_auth_scope("claude".into())');
});
