# Themes from design Markdown

Open **Control Panel → Appearance → Create from a design document**.

1. Drop one `.md` / `.markdown` file on the import area, or choose a file. Files must be UTF-8 text, non-empty, and no larger than 64 KiB.
2. Optionally expand **Review Markdown before sending**. Importing alone makes no AI request.
3. Choose a configured model or agent. This choice is independent of the other assistants and initially uses your default AI.
4. Click **Generate theme**. Only the document text goes through Orion's selected-provider text-analysis path, with zero tool grants. Linked files, images, URLs and workspace contents are not opened or attached. Generation has a three-minute timeout and a Cancel button.
5. Review the generated name, palette and any contrast warnings. **Try on desktop** temporarily applies the theme across the workstation without recreating editors or terminals. It reverts after 30 seconds, on Revert, or when you leave Appearance.
6. **Save and use** saves the theme in Orion's SQLite-backed settings. It then selects the theme unless you selected something else while the save was pending. Failed saves remain available for retry.

Saved themes appear under **Your themes** with material spheres. Up to 24 can be saved. Removal requires confirmation and does not delete the original Markdown file. Removing an active theme returns to Liquid. The four built-ins remain unchanged.

## What to put in a design document

Ordinary Markdown works; there is no mandatory frontmatter or special schema. Be specific about colors, contrast, material and corners. For example:

```md
# Carbon workshop

A dark, precise workstation with graphite panels and clear blue controls.

## Palette
- Background: #080a0e
- Panels: #10141a; raised surfaces: #18202a
- Main text: #f1f5fa; secondary text: #bdc9d8
- Accent: #74bcff
- Success: #88d6aa; warning: #edcd78; error: #ff929d

## Material and shape
Solid surfaces, soft neutral shadows, no neon bloom.
Controls: 4–8px corners. Windows: 12px. Dock: 16px.
Keep status colors distinguishable and all controls readable.
```

## Scope and safeguards

- The model produces a bounded theme data object, **not executable CSS, JavaScript or HTML**. Only validated hex colors, bounded radii and enumerated light/dark, solid/glass and shadow-depth choices become styles.
- Orion's fonts, layout, documents, artwork, wallpaper and reference-matched monitor notch remain unchanged. This is a theme-token importer, not a way to install arbitrary design code, fonts or assets.
- Primary text and primary filled-control contrast are validated. Secondary/status color warnings and wallpaper-dependent glass still need visual review; this is not full accessibility certification.
- Existing Beam and Metal finishes work with saved custom themes. Save a generated theme before customizing its finish.
- The source Markdown is not saved in the theme registry. AI providers and local CLI sessions may retain the prompt according to their own behavior; do not include secrets in a design document.
- Malformed, unsupported-version or unreadable saved theme collections block registry writes rather than replacing existing data. Existing theme selection hydration does not write storage.
- This feature adds the native `theme_read_markdown` command. An older running native binary needs rebuilding/restarting before the new importer works; a frontend-only refresh is not sufficient.

Implementation checks cover schema rejection, token cleanup, preview rollback, persistence failure/cancellation and native file limits. Live provider generation and native visual acceptance remain separate checks.
