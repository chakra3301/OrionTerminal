import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the BlockNote editor into ONE self-contained index.html (JS + CSS
// inlined) so it can be bundled in the iOS app and loaded by WKWebView with no
// network. Copy dist/index.html → ArchivesiOS/EditorWeb/editor.html after build.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 8000,
  },
});
