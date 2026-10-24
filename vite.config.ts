/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createRequire } from "node:module";
import { openPencilWorkers } from "./scripts/open-pencil-vite.mjs";
import { xdesignScriptWorker } from "./scripts/xdesign-script-worker.mjs";
import { xdesignNativeReactWorker } from "./scripts/xdesign-native-react-worker.mjs";
import { frontendLicenses, excludeFinderMetadata } from "./scripts/frontend-licenses.mjs";

const require = createRequire(import.meta.url);
const fromTransformers = createRequire(require.resolve("@huggingface/transformers"));
const onnxDist = path.dirname(fromTransformers.resolve("onnxruntime-web"));

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const scriptWorker = xdesignScriptWorker();
const nativeReactWorker = xdesignNativeReactWorker();

export default defineConfig(async () => ({
  plugins: [openPencilWorkers(), scriptWorker, nativeReactWorker, react(), frontendLicenses("main", undefined, () => new Set([...scriptWorker.api.modules(), ...nativeReactWorker.api.modules()])), excludeFinderMetadata()],
  worker: { format: "es", plugins: () => [openPencilWorkers(), frontendLicenses("worker")] },
  optimizeDeps: {
    entries: ["index.html"],
    include: ["@huggingface/transformers", "css-tree", "source-map-js/lib/source-map-generator.js", "canvaskit-wasm", "canvaskit-wasm/bin/canvaskit.js", "canvaskit-wasm/bin/full/canvaskit.js", "@xmldom/xmldom", "fontoxpath", "opentype.js", "pptxgenjs", "jspdf", "svgpath", "@open-pencil/core > expr-eval", "@open-pencil/core > sucrase"],
    exclude: ["onnx-assets", "@open-pencil/core", "@open-pencil/vue"],
  },
  build: {
    license: { fileName: "THIRD_PARTY_FRONTEND_LICENSES.md" },
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
      "onnx-assets": onnxDist,
      "open-pencil-fonts": path.resolve(__dirname,"node_modules/@open-pencil/core/assets"),
      "open-pencil-pdf": path.resolve(__dirname,"node_modules/@open-pencil/core/dist/io/formats/pdf/index.js"),
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
    server: { deps: { inline: [/\/@open-pencil\/core\//] } },
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
}));
