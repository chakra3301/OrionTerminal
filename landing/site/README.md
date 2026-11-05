# Orion Terminal · consumer site (`landing/site/`)

A third, standalone site. `landing/index.html` (classic) and `landing/consumer/` (icy-reference build) are untouched. Static HTML/CSS/vanilla ES modules, no build step, no dependencies, CDNs, trackers or remote requests. About 820 KB total.

## Preview

```sh
python3 -m http.server 4319 --bind 127.0.0.1 --directory landing
```

Open **http://127.0.0.1:4319/site/**. ES modules need HTTP; `file://` won't run the JavaScript, though all content still shows.

## What's on the page

| Section | What it does |
| --- | --- |
| Hero | The real stock wallpaper (`public/wallpapers/stock.png`) rendered as a live liquid surface in raw WebGL2: cursor-trail ripples, refraction with chromatic edges, cyan/green specular on the chrome. The orb tilts toward the cursor. Owner copy: *Think. Make. Connect.* |
| Interactive desktop | A working mini Orion Terminal: draggable windows, traffic lights, double-click maximize, dock focus/minimize, live clock, scroll-driven 3D settle. Scripted scenes (Archives chat, Orion ⌘K inline-edit diff, XDesign live aurora layer) only run while visible. Phones get a dedicated one-app-at-a-time layout. |
| Apps | Three cards using the real Dock glyphs/gradients (Lucide `Archive`, `Code2`, `Palette`). "Open in the demo" jumps up and focuses that window. |
| One brain | A 3D force-directed knowledge graph (canvas 2D, additive glow, signal pulses), with drag-to-orbit and hover neighborhoods. |
| Spotlight | **⌘K / Ctrl K or `/` opens a real site-wide Spotlight.** It fuzzy-matches sections, apps and FAQ, and `>` limits results to commands, as in the app. |
| AI | Provider preview (Claude / ChatGPT / Gemini / Cursor) that retitles every `… · listening` label and replays the chat. |
| FX | Full-bleed live shader studio: Aurora, Nebula, Glyph (runtime JetBrains Mono atlas) and Synthwave, all cursor-reactive. Labeled Experimental. |
| Privacy / Download / FAQ | Plain-language local-first claims with fine print, a 3-step install including Open Anyway, and searchable FAQ. |

Handoff copy used verbatim: `Ready when you are.`, `claude · listening`, `status : saved`, window titles `ARCHIVES 47 today`, `ORION orix47`.

## Accessibility and performance

- All content is real HTML and visible without JavaScript. Reveal classes are added by JS only.
- Shaders render only while on screen and in a visible tab, at capped DPR and resolution. With reduced motion (OS setting or the footer/Spotlight toggle, which persists), every animation stops and the shaders draw one still frame.
- Native `<dialog>` for Spotlight (Esc, inert background, focus restored to the opener), combobox/listbox semantics, radiogroup/tablist arrow keys. `prefers-reduced-transparency` removes glass blur.

## Verified (headless Chromium via Playwright, SwiftShader WebGL)

- Rendered screenshots reviewed at 1440, 1024, 768 and 390px. Zero horizontal overflow at 1440/1024/768/600/360.
- Drag, focus, menubar app name, dock minimize/restore, maximize, reset; Spotlight open, `>` filtering, ranking (e.g. "notary" → Gatekeeper FAQ, "xdes" → XDesign), Enter, Esc, `/`; provider switch; FX tab switching; motion toggle persistence; reduced-motion emulation. No page errors.
- The download link points at the pinned `v0.1.0-alpha.1` asset `Orion-Terminal_aarch64.dmg`, 55,767,670 bytes, checked against the GitHub API. Nothing was downloaded.

**Not verified:** real Safari/WebKit, real GPU frame rates, VoiceOver, Lighthouse, owner visual sign-off. Headless WebGL ran on SwiftShader (software), so real-hardware appearance may be sharper.

## Honesty notes

Claims are limited to the public alpha (release notes `docs/releases/v0.1.0-alpha.1.md`): Apple Silicon only, ad-hoc signed and not notarized, unencrypted local data, FX/3D experimental, inline edits/Tab need an Anthropic API key, Cursor via key. Post-alpha working-tree features (Incubator, Downloads, custom themes) are deliberately not advertised. The demo is labeled as an illustrative recreation.

## Assets and licenses

- `assets/wallpaper*.webp`: repository stock wallpaper (creator-owned, Apache-2.0 per release notes).
- `assets/orb-*.webp`, favicons, `social.jpg`: derived from repository `app-icon.png` (owner-confirmed authorship).
- Fonts: Space Grotesk and JetBrains Mono from the repo's `@fontsource` packages (SIL OFL; `licenses/`).
- Icons: Lucide 0.475.0 paths, inlined as an SVG sprite (ISC; `licenses/`).
- All shaders, noise and graph code are original to this site.

## Before publishing

Set absolute `og:image`/canonical URLs for the production domain. Deploy all of `landing/` to keep the footer's "Classic site" link working (or repoint it). Keep the pinned release link in sync with future releases.
