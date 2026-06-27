# Orion Terminal — Landing Page Design Brief & Agent Handoff

> Paste everything below into your designer agent. It is self-contained: positioning, brand tokens, real product copy, page structure, motion direction, and deliverable spec.

---

## ROLE

You are a senior product/brand designer + front-end engineer. Design and build a **single-page marketing site** for **Orion Terminal**. Output a complete, self-contained `index.html` (inline `<style>` + minimal vanilla JS, no build step) that looks like a flagship product launch — think Linear, Raycast, Vercel, Arc. Bold, dark, premium, motion-aware. It must feel like the product: a neo-Tokyo neon terminal with frosted glass.

## THE PRODUCT (what you're selling)

**Orion Terminal** is a JARVIS-style personal workstation: **one desktop OS-style shell** (wallpaper, menubar, dock, draggable in-canvas windows, a unified `⌘K` Spotlight) hosting **three deeply-integrated apps**, with **Claude embedded inside each app** as a context-aware collaborator — not bolted on in a sidebar.

The three apps (each has its own accent color — use them as the section identity):

1. **Archives 47** — personal Notion. Notes, journal, mood boards, media, databases, `[[wikilinks]]` + backlinks, AI/RAG search. **Accent: neon green `#39ff88`.**
2. **Orion** — AI-first code editor. File tree, Monaco, live preview, terminal, Git panel, real LSP, inline Claude edits + Tab autocomplete. **Accent: neon cyan `#00e0ff`.**
3. **XDesign** — design studio. Generative design engine, brand systems (URL→brand), vector boolean ops, prototypes, decks (HTML/PDF/PPTX), an editable canvas. **Accent: neon magenta `#ff3ea5`.**

One command registry, one Claude brain, cross-app memory surfaced in Spotlight. Local-first (SQLite, atomic saves, rotating backups). Built with Tauri 2 + React 19 + Rust.

> Naming rule: the **product** is "Orion Terminal." "Orion" is the editor app *inside* it. Never imply Orion Terminal is just a code editor.

## AUDIENCE & TONE

Developers, designers, and power-users who'd use Cursor, Raycast, Notion, Figma. Tone: confident, precise, a little sci-fi, never cheesy. Short declarative lines. Let the product's capability speak; don't over-explain.

## BRAND TOKENS (use these exactly)

**Backgrounds (deep space, near-black):**
```
--bg-0  #03060a   (page base, deepest)
--bg-1  #060a0f   (cards / sections)
--bg-2  #0a1015   (raised)
--bg-3  #10171d   (hover / focused)
```

**Neon accents:**
```
--neon-green   #39ff88   Archives / primary CTA / success
--neon-cyan    #00e0ff   Orion / info
--neon-yellow  #e6ff3a   warnings / highlights
--neon-magenta #ff3ea5   XDesign / errors
--neon-violet  #b14cff   aurora layer / syntax keywords
```

**Text:**
```
--t-primary    #e6f4ec
--t-secondary  #9ab0a8
--t-tertiary   #5a706a
--t-faint      #324036
```

**Radii:** `6px` / `10px` / `16px` (cards/windows) / `22px` (large) / `999px` (pills).

**Shadows / glow:**
```
--shadow-window:     0 30px 80px -20px rgba(0,0,0,0.7), 0 8px 24px -8px rgba(0,0,0,0.5)
glow-green:   0 0 24px -4px rgba(57,255,136,0.5)
glow-cyan:    0 0 24px -4px rgba(0,224,255,0.5)
glow-magenta: 0 0 24px -4px rgba(255,62,165,0.5)
```

**Type:** Headings/UI = **Space Grotesk**. Code / mono labels / eyebrows = **JetBrains Mono**. Load both from Google Fonts. Use mono uppercase + letter-spacing for eyebrow/kicker labels (e.g. `⌘K · SPOTLIGHT`).

**Texture:** subtle aurora/gradient wash (violet→cyan→green) behind the hero, a faint dot/grid, very slight film grain. Frosted-glass cards (`backdrop-filter: blur`) with a 1px bright top inner-border to read as wet glass. Keep it tasteful — depth, not noise.

## REAL PRODUCT COPY (use verbatim where natural — these are canonical strings)

- `Ready when you are.`
- `⌘K claude`
- `claude · listening`
- Suggested hero headline directions (pick/refine one): *"One terminal. One brain."* · *"Your whole workflow, and Claude lives inside it."* · *"The workstation that thinks with you."*
- Suggested sub: *"A desktop shell with a code editor, a personal Notion, and a design studio — each one Claude-native. Local-first. Yours."*

## PAGE STRUCTURE (sections, in order)

1. **Sticky nav** — small wordmark/logo left; links (Apps, Features, Tech, Download) center/right; a glowing green **"Get the beta"** button. Glass bar, blurs content on scroll.
2. **Hero** — big headline + sub, two CTAs ("Get the beta" → GitHub release, "View on GitHub"). Behind it: aurora wash + a faux **desktop mockup** (you build this in pure HTML/CSS — a dark window with a menubar, a dock of 3 glowing app icons in green/cyan/magenta, and a Spotlight bar showing `⌘K claude`). Make the mockup the showpiece.
3. **The three apps** — three alternating feature rows, each in its app's accent: name, one-line promise, 3–4 capability bullets, and a small stylized UI snippet (faux editor/notes/canvas — CSS only). Archives (green) → Orion (cyan) → XDesign (magenta).
4. **"One brain" section** — explain the embedded-Claude + unified Spotlight + cross-app memory idea. A central Spotlight visual with fuzzy results across apps/notes/files/commands.
5. **Feature grid** — 6–8 glass cards: In-canvas windowing (60fps), Tab autocomplete, Real LSP, `[[wikilinks]]` + backlinks, Generative design + brand systems, Decks export, Local-first SQLite, 5 themes (incl. Liquid glass).
6. **Tech strip** — quiet mono row of the stack: Tauri 2 · React 19 · Rust · Monaco · SQLite · Three.js.
7. **Download / CTA** — repeat the beta CTA; note **macOS (Apple Silicon), unsigned beta** with a one-line "right-click → Open" hint; link to BETA.md.
8. **Footer** — minimal, mono, GitHub link, "Personal project · © 2026 Orion Terminal."

## MOTION & INTERACTION

- Scroll-reveal (fade + 12px rise) on sections via `IntersectionObserver`.
- Hero mockup: gentle parallax / float; dock icons pulse-glow on hover.
- Accent glow intensifies on CTA + card hover.
- Respect `prefers-reduced-motion` — kill non-essential animation.
- Fully responsive; mobile stacks cleanly, mockup scales down gracefully.

## LINKS & ASSETS

- GitHub: `https://github.com/chakra3301/OrionTerminal`
- Beta release (DMG): `https://github.com/chakra3301/OrionTerminal/releases/tag/v0.1.0-beta.1`
- Install/known-issues: `https://github.com/chakra3301/OrionTerminal/blob/main/BETA.md`
- App icon available at `docs/assets/icon.png` (use for the logo/favicon; recreate the dock icons in CSS).

## CONSTRAINTS

- **One file** (`index.html`), no framework, no build, no external JS libs. Google Fonts is fine.
- All "UI" mockups are **CSS/HTML you draw** — do not use screenshots (none exist yet).
- Accessible: real headings, alt text, focus states, AA contrast on text.
- Fast: no heavy images; effects via CSS gradients/blur/shadow.

## DON'TS

- Don't make it a generic SaaS template. It should feel bespoke and a little sci-fi.
- Don't call the whole product "Orion" or imply it's only a code editor.
- Don't use stock photography or emoji-as-icons in the chrome (subtle inline SVG or CSS shapes instead).
- Don't overcrowd — generous spacing (scale: 8 / 12 / 18 / 28 / 44 / 80), lots of black, neon used as punctuation not paint.

## DELIVERABLE

A single polished `index.html` that runs by double-clicking. Include a short comment block at top listing the fonts used and any section IDs. Optimize for "screenshot-worthy hero" on first paint.
