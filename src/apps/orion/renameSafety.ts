import type { FileBuffer } from "@/store/tabsStore";

export function renameBlockedReason(path: string, buffers: Record<string, FileBuffer>, openPaths: string[]): string | null {
  const prefix = path.replace(/\/+$/, "") + "/";
  if (Object.entries(buffers).some(([file, buffer]) =>
    (file === path || file.startsWith(prefix)) && buffer.loaded && buffer.contents !== buffer.original)) {
    return "Save the affected file edits before renaming this path. Nothing was renamed.";
  }
  if (openPaths.some(file => file.startsWith(prefix))) {
    return "Close the files inside this folder before renaming it, so their tabs cannot keep writing to the old paths. Nothing was renamed.";
  }
  return null;
}
