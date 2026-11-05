/// <reference types="vitest" />
// Vite config for the standalone Archives 47 app. Same source tree as Orion
// Terminal; `archives.html` is the entry and a few Orion-only modules are
// swapped for Archives stand-ins (the assistant defaults) so the bundle never contains the editor,
// XDesign, Command Center, Hermes, Incubator or the companions.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { frontendLicenses, excludeFinderMetadata } from "./scripts/frontend-licenses.mjs";
import { ARCHIVES_ALIASES } from "./src/standalone/archives/aliases";

const require = createRequire(import.meta.url);
const fromTransformers = createRequire(require.resolve("@huggingface/transformers"));
const onnxDist = path.dirname(fromTransformers.resolve("onnxruntime-web"));

const src = (p: string) => path.resolve(__dirname, "src", p);

/** Port for `npm run archives:dev`. Never Orion's 1420. */
export const ARCHIVES_DEV_PORT = 1447;

export default defineConfig(async () => ({
  // Own optimizer cache, inside this checkout's dist area, so it never writes
  // to node_modules/.vite (which may be shared with another checkout).
  cacheDir: path.resolve(__dirname, ".vite-archives"),
  plugins: [react(), frontendLicenses("archives"), excludeFinderMetadata()],
  worker: { format: "es", plugins: () => [frontendLicenses("archives-worker")] },
  define: { "import.meta.env.VITE_APP_TARGET": JSON.stringify("archives") },
  optimizeDeps: {
    entries: ["archives.html"],
    include: ["@huggingface/transformers"],
    exclude: ["onnx-assets"],
  },
  build: {
    outDir: "dist-archives",
    emptyOutDir: true,
    license: { fileName: "THIRD_PARTY_FRONTEND_LICENSES.md" },
    rollupOptions: { input: path.resolve(__dirname, "archives.html") },
  },
  resolve: {
    alias: [
      ...Object.entries(ARCHIVES_ALIASES).map(([find, replacement]) => ({
        find: new RegExp(`^${find.replace(/[/.]/g, "\\$&")}$`),
        replacement: src(replacement),
      })),
      { find: "onnx-assets", replacement: onnxDist },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  clearScreen: false,
  server: {
    port: ARCHIVES_DEV_PORT,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/src-tauri/**"] },
    // A worktree's node_modules may link into another checkout; let the dev
    // server read (never write) the real package directories.
    fs: { allow: [__dirname, fs.realpathSync(path.resolve(__dirname, "node_modules/@fontsource"))] },
  },
}));
