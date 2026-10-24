import { cp, mkdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'dist');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const styles = await Promise.all(['styles.css', 'sharp.css', 'motion.css'].map(file => readFile(path.join(root, file), 'utf8')));
const references = [
  ...[...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(match => match[1]),
  ...[...styles.join('\n').matchAll(/url\('([^']+)'\)/g)].map(match => match[1]),
];
for (const reference of references) {
  if (reference.startsWith('#') || reference.startsWith('https://')) continue;
  await access(path.join(root, reference.split('#')[0]));
}
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'sharp.css', 'motion.css', 'site.js', 'motion.js', 'assets', 'licenses']) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
console.log(`Built static website: ${output}`);
