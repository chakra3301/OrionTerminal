import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({ root, configFile: path.join(root, '.identity-vite.config.mjs'), configLoader: 'runner', base: './' });
const dir = path.join(os.tmpdir(), 'orion-identity-build');
let html = await readFile(path.join(dir, 'icon-orb-review.html'), 'utf8');
for (const match of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
  const js = await readFile(path.resolve(dir, match[1]), 'utf8');
  html = html.replace(match[0], () => `<script type="module">${js.replaceAll('</script', '<\\/script')}</script>`);
}
for (const match of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
  const css = await readFile(path.resolve(dir, match[1]), 'utf8');
  html = html.replace(match[0], () => `<style>${css}</style>`);
}
for (const pkg of ['@fontsource/space-grotesk', '@fontsource/jetbrains-mono', 'react', 'react-dom', 'lucide-react']) {
  const license = await readFile(path.join(root, 'node_modules', pkg, 'LICENSE'), 'utf8');
  html += `\n<!-- ${pkg}\n${license.replaceAll('-->', '-- >')}\n-->`;
}
const output = process.argv[2] ?? path.join(os.homedir(), 'output/orion-alpha/orion-icons-and-orbs.html');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html);
console.log(`Standalone identity preview: ${output}`);
