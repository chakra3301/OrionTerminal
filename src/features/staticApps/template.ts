import { decodeText, toBase64 } from "./hash";
export const escapeNotice = (text: string): string => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]!);
export const ORIGINAL_RESET = 'html,body{height:auto;min-height:100%;color-scheme:light}*,*::before,*::after{box-sizing:content-box}button{font:inherit;border:0;background:none;padding:0;color:inherit;cursor:pointer}';
const EXTRA = `
button:focus-visible,.game-container:focus-visible,summary:focus-visible{outline:3px solid #776e65;outline-offset:4px}
.adapter-status,.adapter-notices{width:500px;margin:0 auto;font-size:13px;line-height:1.5}
.adapter-status{margin-bottom:12px}.adapter-status p{margin:0 0 6px}.adapter-status button{padding:3px 0;text-decoration:underline}
.adapter-notices{margin-top:28px;padding-bottom:20px}.adapter-notices summary{cursor:pointer}
.adapter-notices pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}.adapter-notices h2{font-size:15px}
[hidden]{display:none!important}
@media(max-width:520px){.adapter-status,.adapter-notices{width:280px}}
@media(prefers-reduced-motion:reduce){.tile,.tile-inner,.game-message,.score-addition{animation:none!important;-webkit-animation:none!important;transition:none!important;-webkit-transition:none!important}}
`;
export function sassyLicense(readme: string): string {
  const pieces = readme.split("## License\n");
  if (pieces.length !== 2 || !pieces[1]!.includes("Permission is hereby granted")) throw new Error("Pinned Sassy Math notice layout changed");
  return pieces[1]!.trim();
}
export function build2048Document(get: (path: string) => Uint8Array, scripts: readonly string[]): string {
  const index = decodeText(get("original/index.html")), found = index.match(/<body>([\s\S]*?)<script src="js\/bind_polyfill.js"><\/script>/);
  if (!found) throw new Error("Pinned 2048 document layout changed");
  let body = found[1]!;
  const once = (pattern: RegExp, replace: string | ((substring: string, ...args: string[]) => string)) => {
    if (Array.from(body.matchAll(new RegExp(pattern.source, "g"))).length !== 1) throw new Error("Pinned 2048 component mapping changed");
    body = typeof replace === "string" ? body.replace(pattern, replace) : body.replace(pattern, replace);
  };
  once(/<div class="container">/, '<main class="container" id="game-root" hidden inert>');
  const end = body.lastIndexOf("</div>");
  if (end < 0) throw new Error("Pinned 2048 root is missing");
  body = body.slice(0, end) + "</main>" + body.slice(end + 6);
  once(/<p>\s*<strong class="important">Note:<\/strong>[\s\S]*?<\/p>/, '<p><strong class="important">Adaptation:</strong> This is a local Orion adaptation of original 2048, not an official release or an endorsed app.</p>');
  for (const name of ["restart-button", "retry-button", "keep-playing-button"]) {
    once(new RegExp(`<a class="${name}">([\\s\\S]*?)</a>`), (_all, content) => `<button type="button" class="${name}">${content}</button>`);
  }
  body = body.replace(/<a\s+[^>]*>([\s\S]*?)<\/a>/g, (_all, content: string) => `<span>${content}</span>`);
  once(/<div class="game-container">/, '<div class="game-container" tabindex="0" role="region" aria-label="2048 board. Use arrow keys, WASD or HJKL to move; R starts a new game.">');
  once(/<div class="game-message">/, '<div class="game-message" role="status" aria-live="polite">');
  let css = decodeText(get("original/style/main.css"));
  const importRule = "@import url(fonts/clear-sans.css);";
  if (!css.startsWith(importRule)) throw new Error("Pinned font import changed");
  css = css.slice(importRule.length).replaceAll("a {", "button {").replaceAll(".game-message a", ".game-message button").replaceAll(".game-message.game-won a", ".game-message.game-won button");
  if (/url\(|@import/i.test(css)) throw new Error("External styles are not supported");
  const fonts = ([["Light", 300], ["Regular", 400], ["Bold", 700]] as const).map(([face, weight]) => `@font-face{font-family:"Clear Sans";src:url("data:font/woff;base64,${toBase64(get(`notices/ClearSans-${face}-webfont.woff`))}") format("woff");font-weight:${weight};font-style:normal;font-display:swap}`).join("\n");
  let notices = '<footer class="adapter-notices"><details><summary>Source, changes and licences</summary><p>2048 by Gabriele Cirulli. Clear Sans: Intel Corporation, Daniel Ratighan / Monotype. Sass helper: Sam Richard, Mario Valencia, Scott Kellum. Orion adaptation is not upstream endorsement.</p>';
  for (const [title, text] of [["2048 · MIT", decodeText(get("original/LICENSE.txt"))], ["Clear Sans · Apache 2.0", decodeText(get("notices/intel-LICENSE.txt"))], ["Sassy Math · MIT", sassyLicense(decodeText(get("notices/sassy-readme.md")))]]) notices += `<h2>${escapeNotice(title!)}</h2><pre>${escapeNotice(text!)}</pre>`;
  notices += "</details></footer>";
  if (scripts.length !== 10 || scripts.some((s) => /<\/script/i.test(s))) throw new Error("Unsupported inline script boundary");
  const scriptTags = scripts.map((s) => `<script>\n${s}\n</script>`).join("\n");
  const document = `<!doctype html>\n<html><head><meta charset="utf-8"><title>2048 · Orion adaptation</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${ORIGINAL_RESET}\n${fonts}\n${css}\n${EXTRA}</style></head><body data-orion-appearance="v1" data-orion-skin="2048"><section class="adapter-status" aria-label="Game storage"><p id="save-status" role="status" aria-live="polite">Loading saved game…</p><button type="button" id="save-retry" hidden disabled>Retry storage</button><p id="save-warning" hidden>Wait for Saved before closing or disabling. Unconfirmed progress can be lost.</p></section>${body}${notices}\n${scriptTags}\n</body></html>\n`;
  const markup = document.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
  if (/<(?:iframe|object|embed|link|base|img)\b|\s(?:on[a-z]+|src|href|srcdoc|http-equiv)\s*=/i.test(markup)) throw new Error("External or active document attributes are not supported");
  return document;
}
