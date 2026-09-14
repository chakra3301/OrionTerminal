# XDesign webpage durability — scoped native acceptance

## Closed gap

Generated/edited webpages now live in the existing SQLite design-project document (`xdesign.project.<id>.htmlArtifact`), not a second browser-only save path. They share project autosave, revision acknowledgment, retry/quit guards, atomic project deletion and verified database backups. No SQL migrations, dependencies, provider choices or preview CSP changed.

- `htmlArtifactData.ts`: versioned, validated HTML/title/open state, 25 MiB UTF-8 HTML bound.
- `htmlArtifactStore.ts`: explicit project ownership; stale results cannot publish into another project.
- `projectsStore.ts`: migrates matching **registered design projects**, including unopened ones. Global legacy HTML is adopted with the legacy canvas. Original browser entries remain untouched. Existing SQLite values, including explicit null, win over stale legacy copies. Invalid data or failed writes preserve originals and block migration rather than replace content with an empty page.
- `pluginContributions.ts` / `HtmlArtifactPreview.tsx`: webpage-only edits autosave; visible Page saved / Page not saved / Retry save feedback. Project changes recreate the iframe; reopening uses edited HTML rather than the old initial source. Generation preparation holds the existing project activity guard.

## Native proof

Validation executable SHA256 `90fafa6d8c155ac7fd51d842a120835969b28434b6cac4fa18796e62d9c04f45`; tested PID54675 → normal quit → PID54995. Production was not replaced.

1. Seeded one synthetic project and its legacy value in **actual isolated WebKit localStorage**, with storage closed. Checked UTF-16LE browser bytes, not a JSON stand-in.
2. Packaged startup migrated that page plus an existing matching Validation page exactly into SQLite. Browser originals and existing canvas fields remained unchanged.
3. Opened `Webpage recovery proof`; changed the heading from36px to38px. A bounded trigger rejected writes **only to this fixture**. Native Page not saved / Retry save appeared; the edited page remained visible and SQLite still held the prior HTML.
4. Removed the trigger; clicked Retry save. The native saved indicator and stored38px HTML confirmed success.
5. Normally quit, verified closed storage, removed **only the synthetic browser key**, restarted and reopened the edited webpage successfully from SQLite.
6. Verified the exact edited artifact in a real startup backup and a fresh copy produced by the packaged `--restore-db-copy`. Integrity passed; disposable restored copy removed.
7. Confirmed deletion of the synthetic project through its UI. Fixture DB/browser entries and fault trigger are absent. Original three notes, other project fields, original browser entries and background preferences are preserved; only the expected HTML migration changed an existing document. No nonempty recovery journals, cloud AI calls or production binary changes.

The automation helper initially did not verify foreground/onscreen state before input; one capture found no onscreen window despite a live process. The cause was not established, and this is not a crash result. Added a foreground/onscreen wait and argument validation to the **temporary helper**, without replaying an uncertain action. Final native proof used an inspected fullscreen XDesign window. No product fix is inferred from that automation issue.

## Evidence and limits

Under `/tmp/orion-release-next/`:

- `verify-html-durability-final.log`: TypeScript/Vite,195 frontend files/1241 tests,23 Node,240 Rust passed/1 ignored. A subsequent toolbar class/CSS-only adjustment is included in the final package and `html-durability-final-focused.log`; the earlier failed fixture test remains recorded.
- `html-durability-build-final.log`, `html-durability-signature-final.log`, `html-durability-mcp-final.json`: packaged build, deep/strict ad-hoc signature, packaged policy smoke.
- `html-durability-migration.json`, `html-durability-failure.json`, `html-durability-restored-result.json`, `html-durability-live-result.json`: migration, native failure/retry/restart, real backup/copy and cleanup evidence.
- `html-durability-rehearsal-final.json`: synthetic cold-profile/migration/rollback rehearsal now also preserves webpage data **inside the project document**. Earlier build reports retain their own attribution.
- `html-durability-dmg-result.json`: fresh DMG verified/mounted read-only, signature and executable hash matched, then detached.
- Screenshots: `/tmp/orion-release-closure/html-durability-*`.

**Not full-profile restoration:** the restored database copy was inspected, not promoted into a running profile. No real historical user/Tauri upgrade, raw WebKit restoration, external-path rebasing or clean-machine installation is claimed. This is primary webpage persistence, not an HTML crash journal or every-keystroke guarantee. Remote dependencies referenced by HTML are not automatically archived. Orphaned/unregistered browser entries remain for separate review; legacy copies and backups may retain deleted content and sensitive data. Database backups are unencrypted.

Unchanged dependency audit evidence is reused from the preceding recovery build, not represented as a new security/privacy clearance. Generation and specialist media features remain experimental. [Remaining release gates](2026-09-13-alpha-release-gates.md) still apply; no commit, publication or sign-off occurred.
