# Orion Terminal — Beta v1

Thanks for testing Orion Terminal. This is an early personal-use build — expect rough edges, and please report anything that feels off.

---

## Install (macOS, Apple Silicon)

The build is **unsigned** (no Apple notarization), so macOS Gatekeeper will block it on first launch. This is expected.

1. Open `Orion Terminal_0.1.0_aarch64.dmg` and drag **Orion Terminal** to Applications.
2. **First launch:** right-click the app → **Open** → confirm **Open** in the dialog. (Double-clicking will just say "can't be opened" — use right-click → Open the first time.)
3. If it still won't open, run once in Terminal:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Orion Terminal.app"
   ```

> **Apple Silicon only.** This DMG is `aarch64` — it will not run on Intel Macs.

## Optional setup

- **AI features** need a key. Open **Control Panel → Providers** (or **Settings → API Keys**) and add an Anthropic key, plus an OpenAI/Google key if you want image generation in XDesign.
- **Orion code intelligence** (LSP) is optional:
  ```bash
  npm i -g typescript-language-server typescript pyright
  rustup component add rust-analyzer
  ```

## What to try

- **Shell** — drag windows, `⌘K` Spotlight, dock, true fullscreen (`⌃⌘F`) and `⌃⌘Tab` to switch apps in fullscreen.
- **Themes** — Control Panel → Appearance. Try all five, especially **Liquid**. Toggle **Reduce transparency** to confirm it strips the glass.
- **Archives 47** — notes, journal, `[[wikilinks]]`, databases, ask-your-archive search.
- **Orion** — open a folder, edit with Monaco, live preview, terminal, inline Claude edits + Tab autocomplete.
- **XDesign** — generate a design, extract a brand from a URL, edit on the canvas, export to HTML/PDF/PPTX.
- **R.O.S.I.E.** — ask it to catch you up across apps.

## Known issues / limitations

- Unsigned build → Gatekeeper prompt on first launch (see Install).
- Apple-Silicon-only DMG; no Intel/Windows/Linux builds yet.
- UI is dark-only (light theme cut for beta).
- XDesign multiplayer is intentionally out of scope.
- Image generation requires your own OpenAI/Google key; without one you'll see a "No image provider" prompt (working as designed).

## Reporting bugs

Please include:

1. **What you did** (the steps, the app/surface).
2. **What you expected** vs **what happened**.
3. **Screenshot** if visual.
4. **Theme** in use (Neon/Liquid/…) — some issues are theme-specific.
5. Anything in the toast/error message verbatim.

File issues on the GitHub repo. Thank you for helping shape the beta. 🛰️
