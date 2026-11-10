import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import os from 'node:os';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  plugins: [react()],
  cacheDir: path.join(os.tmpdir(), 'orion-identity-vite-cache'),
  optimizeDeps: { entries: ['icon-orb-review.html'] },
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { port: 1541, strictPort: true, host: '127.0.0.1', fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
  build: { outDir: path.join(os.tmpdir(), 'orion-identity-build'), emptyOutDir: true, assetsInlineLimit: 10000000, rollupOptions: { input: path.join(root, 'icon-orb-review.html') } },
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.{test,spec}.{ts,tsx}'] },
});
