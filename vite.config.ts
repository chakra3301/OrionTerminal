/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  build: {
    // Tauri loads these from disk, so total size matters less than keeping the
    // initial parse small and vendors in their own cacheable chunks. Split the
    // heavy, rarely-changing libs out of the main entry so a cold boot parses
    // app code without dragging three/monaco/markdown through the same chunk.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // Only split heavy, self-contained leaf vendors. react and the
          // markdown stack are entangled (react-three needs react, the markdown
          // tree cross-references) — grouping them produces circular chunks, so
          // they stay in the main bundle. three is the single biggest win.
          if (/[\\/]monaco-editor[\\/]/.test(id)) return "vendor-monaco";
          if (/[\\/]@xterm[\\/]/.test(id)) return "vendor-xterm";
          if (/[\\/]three[\\/]/.test(id)) return "vendor-three";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
}));
