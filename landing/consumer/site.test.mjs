import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const css = readFileSync(path.join(root, 'styles.css'), 'utf8') + readFileSync(path.join(root, 'sharp.css'), 'utf8') + readFileSync(path.join(root, 'motion.css'), 'utf8');
const script = readFileSync(path.join(root, 'site.js'), 'utf8') + readFileSync(path.join(root, 'motion.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

test('semantic page, unique ids and working local anchors', () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.equal(ids.length, new Set(ids).size);
  assert.match(html, /class="skip-link" href="#main"/);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), id);
});

test('all HTML and CSS local assets exist', () => {
  const urls = [
    ...[...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(match => match[1]),
    ...[...css.matchAll(/url\('([^']+)'\)/g)].map(match => match[1]),
  ];
  for (const url of urls) {
    if (url.startsWith('#') || url.startsWith('https://')) continue;
    assert.ok(existsSync(path.resolve(root, url.split('#')[0])), url);
  }
});

test('each referenced SVG symbol exists and has a license', () => {
  const sprite = readFileSync(path.join(root, 'assets/icons.svg'), 'utf8');
  for (const [, name] of html.matchAll(/assets\/icons\.svg#([^"]+)/g)) {
    assert.ok(sprite.includes(`id="${name}"`), name);
  }
  assert.ok(existsSync(path.join(root, 'licenses/Lucide-ISC.txt')));
});

test('external links are HTTPS and new tabs have opener protection', () => {
  for (const [, attributes] of html.matchAll(/<a\s([^>]+)>/g)) {
    assert.doesNotMatch(attributes, /href="http:/);
    if (attributes.includes('target="_blank"')) assert.match(attributes, /rel="noopener noreferrer"/);
  }
});

test('download is pinned to the verified public alpha, not a fabricated latest asset', () => {
  assert.match(html, /releases\/download\/v0\.1\.0-alpha\.1\/Orion-Terminal_aarch64\.dmg/);
  assert.doesNotMatch(html, /releases\/latest\/download/);
  assert.match(html, /not notarized/);
  assert.match(html, /Apple Silicon/);
  assert.match(html, /never disable Gatekeeper/);
});

test('native modal semantics, disclosures and capture provenance are retained', () => {
  assert.equal((html.match(/<dialog\b/g) || []).length, 2);
  assert.match(html, /id="download-dialog" aria-labelledby="download-title"/);
  assert.match(html, /id="app-dialog" aria-labelledby="app-dialog-title"/);
  assert.match(html, /Actual app captures shown/);
  assert.match(html, /public alpha’s interface and feature set may differ/);
  assert.match(script, /if \(appDialog.open\) appDialog.close\(\)/);
});

test('runtime has no external imports, trackers or network sends', () => {
  assert.doesNotMatch(script, /\b(?:import|fetch|XMLHttpRequest|sendBeacon)\s*\(/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.doesNotMatch(html, /<(?:img|iframe)[^>]+src="https?:/);
  assert.match(script, /orion-consumer-theme/);
});

test('motion respects preferences, visibility and event-driven scheduling', () => {
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(script, /IntersectionObserver/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /cancelAnimationFrame/);
  assert.match(script, /passive: true/);
  assert.doesNotMatch(script, /setInterval\s*\(/);
  assert.match(css, /animation-play-state:paused/);
});

test('self-hosted font licenses and lightweight section artwork', () => {
  for (const name of ['Tektur-OFL.txt', 'Space-Grotesk-OFL.txt', 'JetBrains-Mono-OFL.txt']) {
    assert.ok(statSync(path.join(root, 'licenses', name)).size > 1000);
  }
  assert.ok(statSync(path.join(root, 'assets/hero-art.webp')).size < 600_000);
  for (const name of ['archives','orion','xdesign']) {
    assert.ok(statSync(path.join(root, `assets/${name}-capture.webp`)).size < 400_000);
  }
});

function contrast(a, b) {
  const luminance = hex => {
    const channels = hex.match(/[\da-f]{2}/gi).map(value => {
      const channel = parseInt(value, 16) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((x,y) => y-x);
  return (values[0] + .05) / (values[1] + .05);
}

test('day and night text and filled buttons exceed AA contrast', () => {
  for (const block of [css.match(/:root\{([^}]+)\}/)[1], css.match(/:root\[data-theme=dark\]\{([^}]+)\}/)[1]]) {
    const token = name => block.match(new RegExp(`--${name}:(#[a-f0-9]{6})`))[1];
    assert.ok(contrast(token('paper'), token('ink')) >= 7);
    assert.ok(contrast(token('paper'), token('body')) >= 7);
    assert.ok(contrast(token('paper'), token('muted')) >= 4.5);
    assert.ok(contrast(token('button'), token('button-text')) >= 7);
  }
});
