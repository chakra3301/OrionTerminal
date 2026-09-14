# Orion Terminal — Beta v1

Thanks for testing Orion Terminal. This is an early personal-use build — expect rough edges, and please report anything that feels off. **The current source is still under pre-release validation, not signed off for important work.** Published assets may predate these changes. See the [current evidence and remaining gates](docs/aaa-rebuild/2026-09-11-release-closure.md).

---

## Install (macOS, Apple Silicon)

Personal builds are **ad-hoc signed but not notarized**, so macOS Gatekeeper may warn on first launch. A warning—or an ad-hoc signature—does not establish whether a download is safe. Only open builds from a source you trust.

1. Open the `.dmg` and drag **Orion Terminal** to **Applications**.
2. First launch is blocked with an “unverified developer” warning. To get past it once:
   - **macOS 14 Sonoma & earlier:** right-click the app → **Open** → confirm **Open**.
   - **macOS 15 Sequoia & later:** double-click once (it’s blocked), then **System Settings → Privacy & Security** → scroll down → **Open Anyway**.
3. Only if you have verified and trust this particular build, you can remove its quarantine flag in **Terminal**:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Orion Terminal.app"
   ```

> **Apple Silicon only.** This DMG is `aarch64` — it will not run on Intel Macs.

## Optional setup

- **Shared AI** can use supported Claude/ChatGPT/Gemini CLI subscription accounts or explicitly configured API/local providers through **Control Panel → Providers**. Select the intended provider/model; API billing is separate from subscriptions. Model availability varies by account.
- **Images:** eligible ChatGPT OAuth sessions can use native subscription image generation; explicitly configured OpenAI/Google image providers use their own billing. A connected chat account does not prove image entitlement.
- **Inline editing/Tab completion** use the Anthropic API. **Cursor SDK**, **Hermes**, **Command/pi**, and verified web lookup have separate capability/account constraints. Read the [capability matrix](docs/setup-and-verification.md).
- **Background AI** defaults off. Opting in sends the described data to the selected provider; changing that provider changes the recipient. Disconnect retains credentials; shared CLI sign-out is a separate action.
- **Orion code intelligence** (LSP) is optional:
  ```bash
  npm i -g typescript-language-server typescript pyright
  rustup component add rust-analyzer
  ```

## What to try

These are test suggestions, not blanket acceptance. The [bounded alpha scope and remaining release gates](docs/aaa-rebuild/2026-09-13-alpha-release-gates.md) distinguish tested core workflows from experimental specialists.

- **Shell** — drag windows, `⌘K` Spotlight, dock, true fullscreen (`⌃⌘F`) and `⌃⌘Tab` to switch apps in fullscreen.
- **Themes** — Control Panel → Appearance. Try all five, especially **Liquid**. Toggle **Reduce transparency** to confirm it strips the glass.
- **Archives 47** — notes, journal, `[[wikilinks]]`, databases, ask-your-archive search.
- **Orion** — open a folder, edit with Monaco, live preview, terminal, inline Claude edits + Tab autocomplete.
- **XDesign** — generate a design, extract a brand from a URL, edit on the canvas, export to HTML/PDF/PPTX.
- **R.O.S.I.E.** — ask it to catch you up across apps.

## Known issues / limitations

- Ad-hoc signed, not notarized → possible Gatekeeper prompt (see Install).
- Apple-Silicon-only DMG; no Intel/Windows/Linux builds yet.
- UI is dark-only (light theme cut for beta).
- XDesign multiplayer is intentionally out of scope.
- img2model, advanced FX/shader/video export, website reconstruction and untested provider combinations remain **experimental**, not universal subscription parity.
- Broader token-level streaming, accessibility, clean-machine upgrade/recovery, remote CI and final provenance/release approval remain open.

## Licenses and included source

Use Finder → Show Package Contents → `Contents/Resources/_up_/` for `THIRD_PARTY_NOTICES.md`, native notices, `dist/licenses/` main/worker notices, and `THIRD_PARTY_SOURCES/` matching MPL source archives/instructions. Original Orion code/assets are Apache-2.0; third-party code, imported content and optional runtimes retain their own terms. See the [reviewed inventory and provenance limits](docs/aaa-rebuild/2026-09-13-distribution-licenses.md).

## Protect your work

- Start with disposable projects. Back up the application data directory before testing upgrades or imports; do not overwrite your only copy.
- XDesign marks unsaved documents and provides **Retry save**. Failed name drafts remain in memory; Enter retries and Escape discards. Plugin disable is blocked while known unsaved work remains.
- Archives retains unsaved title/body changes across note navigation and failed saves. Use **Save now / Retry save** in the note before disabling Archives or quitting. Storage refreshes preserve known dirty drafts; malformed stored bodies are refused rather than opened as editable blank notes.
- Normal macOS Quit/window-close checks known unsaved notes, files, XDesign drafts and tracked operations. Choose **Keep working** to save/retry/stop; **Quit without saving** deliberately abandons memory-only drafts. This is not an automatic save-all or an exhaustive check of every surface.
- Note/file recovery journaling has **scoped macOS process-crash acceptance** for already-written snapshots. `Review local draft recovery` offers previous-session copies without automatically overwriting saved work. Startup no longer automatically deletes untitled/empty-plaintext notes. The last edits may be missing; copies are local, unencrypted and retained until discarded. XDesign and other specialist drafts remain memory-only. Do not rely on this instead of saving; transaction rollback tests do not establish physical power-loss durability.
- Invalid project state is refused rather than replaced with an empty project. Preserve the original database and report the error before attempting restoration. Restoring an old backup may lose newer work.
- Stop/timeout is not rollback: an already executing local tool may finish. Shell grants permit programs and file changes; tool grants are not a universal filesystem sandbox.

## Database backups and recovery copies

This source build creates private startup snapshots under the app configuration directory's `backups/`. It uses SQLite's online backup API (including committed WAL data), checks physical integrity and migration checksums, then retains five recognized compatible snapshots. Existing destinations are never overwritten. Invalid/unrecognized files are preserved for review, so this is not a strict disk-space cap. The limit is2GiB per database and a30-second cooperative operation deadline. A failed backup or retention cleanup produces **Database backup needs attention**; startup still proceeds. Backups are not encrypted and can contain sensitive SQLite data.

To rehearse recovery without replacing a live profile, use an executable built from this updated source:

```sh
"/path/to/Orion Terminal.app/Contents/MacOS/orion-terminal" \
  --restore-db-copy "/path/to/backups/orion-…db" "/path/to/NEW-directory"
```

The destination must not exist. Success creates verified `orion.db` only: it does not copy external media, CLI auth files or keychains, or recover unsaved drafts. Sensitive data already inside SQLite is included. Do not share these files publicly. Before any actual profile replacement, stop **all** app/CLI/MCP/sync writers and preserve the original database and its WAL/SHM together. Never attach stale sidecars to a restored database. A repeatable synthetic rehearsal now checks cold DB/WAL/SHM copies, associated files, 26 generated historical schema upgrades and same-path rollback. It does not establish real-user full-profile promotion, WebKit restoration or power-loss recovery. Saved webpage HTML now lives in SQLite project documents; matching registered legacy pages migrate without deleting their browser originals. Native failure/retry/restart and backup-copy checks passed ([scope](docs/aaa-rebuild/2026-09-13-webpage-durability.md)). Orphaned browser entries need separate review; workspaces, browser preferences and credentials remain separate. This is not an HTML crash journal. A separate generated core profile has now also passed [native opening/editing/restart and rollback](docs/aaa-rebuild/2026-09-13-native-profile-recovery.md), including a real Tauri schema28→29 upgrade; that does not certify every user's profile or a clean machine. See the [recovery boundaries and release gates](docs/aaa-rebuild/2026-09-13-alpha-release-gates.md).

## Reporting bugs

Please include:

1. **What you did** (the steps, the app/surface).
2. **What you expected** vs **what happened**.
3. **Screenshot** if visual.
4. **Theme** in use (Neon/Liquid/…) — some issues are theme-specific.
5. The app version/build, provider/model and relevant error text. **Redact credentials, private prompts, paths and personal information** before sharing screenshots or logs. Never upload auth.json, API keys, your full database or session transcripts to a public issue.

File issues on the GitHub repo. Thank you for helping shape the beta. 🛰️
