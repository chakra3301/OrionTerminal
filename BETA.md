# Orion Terminal — Beta v1

Thanks for testing Orion Terminal. This is an early personal-use build — expect rough edges, and please report anything that feels off.

---

## Install (macOS, Apple Silicon)

The build is **ad-hoc signed but not notarized** (no Apple Developer account on the build), so macOS Gatekeeper warns on first launch. This is expected — it is *not* malware.

1. Open the `.dmg` and drag **Orion Terminal** to **Applications**.
2. First launch is blocked with an “unverified developer” warning. To get past it once:
   - **macOS 14 Sonoma & earlier:** right-click the app → **Open** → confirm **Open**.
   - **macOS 15 Sequoia & later:** double-click once (it’s blocked), then **System Settings → Privacy & Security** → scroll down → **Open Anyway**.
3. If either is fiddly, this clears it on any macOS version — open **Terminal** (⌘Space → “Terminal”) and paste:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Orion Terminal.app"
   ```

> After the first successful open, it launches normally forever — no warnings.

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
