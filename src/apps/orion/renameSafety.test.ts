import { expect, it } from "vitest";
import { renameBlockedReason } from "./renameSafety";
const dirty = { loaded: true, contents: "unsaved", original: "saved" };
const clean = { ...dirty, contents: "saved" };
it("blocks renaming a dirty file or a directory containing dirty loaded buffers", () => {
  expect(renameBlockedReason("/work/file", { "/work/file": dirty }, [])).toContain("Save");
  expect(renameBlockedReason("/work/folder", { "/work/folder/file": dirty }, [])).toContain("Save");
  expect(renameBlockedReason("/work/folder", { "/work/folder-other/file": dirty }, [])).toBeNull();
});
it("blocks stale open descendant paths but permits the existing clean-file retab flow", () => {
  expect(renameBlockedReason("/work/folder", { "/work/folder/file": clean }, ["/work/folder/file"])).toContain("Close the files");
  expect(renameBlockedReason("/work/file", { "/work/file": clean }, ["/work/file"])).toBeNull();
  expect(renameBlockedReason("/work/folder", {}, [])).toBeNull();
});
