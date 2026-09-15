# Archives Companion 0.2

Native SwiftUI iPhone/iPad companion for the **Archives** side of Orion Terminal,
with a separate macOS menu-bar sync helper. Offline notes, journal, project pages,
photo capture, media, mood boards and an embedded BlockNote editor. No Orion cloud
account or analytics. **Both apps must be updated together; protocol v1 is rejected.**

## Install and pair

1. Install the iOS build through **internal TestFlight**. Install the matching
   `ArchivesSyncHelper-0.2.zip` on your Mac. This personal helper is development-signed,
   not a notarized public Mac distribution; macOS may require explicit approval.
2. Open Archives Sync on your Mac. Click **Copy pairing key** and paste it into
   **Archives → Today → Sync → Mac pairing key** on your phone, then Save pairing.
   Clipboard contents expire on the Mac after 60 seconds if unchanged. Treat the
   key as a password. Replace it in the helper if you lose a device.
3. Grant Local Network access on both devices. They must be nearby; the helper must
   be running. Select your Mac under Nearby Devices. Only authenticated peers can
   exchange library data or ask the Mac to run a model.
4. In the helper, choose **Enable library sync**. Access defaults off at each launch.
   This grants access to the existing Orion database and installs helper-owned deletion
   tracking, with a verified database backup first. SQLx migration history is untouched.
5. **Close all phone note editors and quit Orion Terminal on the Mac**, leaving the
   helper running. Tap **Sync library** on the phone, then **Approve import** in the
   helper after reviewing the changes. Reopen Orion Terminal afterward.

The first upgrade sync may include old phone items deleted before the helper began
tracking deletions. Review additions carefully. Cancel applies no phone edits to the Mac.

## Reliability and privacy

- A 256-bit key stored in each device's OS keychain authenticates AES-GCM messages;
  fresh connection challenges, direction binding and ordered counters reject tampering,
  reflection and replay. Multipeer transport also requires encryption. There is no
  unauthenticated library/chat fallback. One authenticated peer is used at a time.
- Every imported library snapshot is backed up first. Mac note/media writes are one
  transaction, so a media failure does not leave a partial note import. Desktop deletion
  tombstones survive helper restarts. Equal-timestamp merges have deterministic winners.
- Phone edits are journaled before the database write. Failed/recovered drafts expose
  **Retry saving** and **Recover as new notes**. Failed creation never opens a phantom
  note. The editor sends changes without a trailing debounce; unsupported documents stay
  uneditable instead of becoming blank saved notes. Sync waits until editors are closed.
- Incoming images use validated basenames, bounded regular-file reads, no-overwrite
  publication, and per-image acknowledgements. Existing different bytes are preserved.
  Phone photos (including HEIC input) are normalized to PNG/JPEG, at most 2048px / 8 MB.
- **R.O.S.I.E is opt-in text chat through the Mac's Claude subscription.** Authentication
  is checked before each turn; API-key billing is rejected. Tools, external MCP servers,
  project settings and session resumption are disabled. Stop/disconnect/timeout cancels
  the owned process. No notes are automatically attached. The desktop's multi-provider
  selector is not mirrored in this beta. Claude must be installed and signed in on the Mac.
- Optional chat sends the messages and recent conversation context to Anthropic under
  your Mac account. Privacy information, dependency notices and matching BlockNote MPL
  source archives are available in **Sync → Privacy**.

### Backup locations

- iPhone: app-private `sync-backups/` (10 SQLite copies), `drafts-v2/` (unsaved notes).
- Mac: `~/Library/Application Support/com.lucaorion.archives.synchelper/backups/`
  (10 SQLite copies).

These are **database backups**, not full-profile/media backups. Do not overwrite a live
Orion database to restore one. Preserve the original and recover through a separate copy.
The helper only deletes its own older backup files; it never replaces the production app.

### Beta limits

Last-write-wins sync is not collaborative editing. Avoid simultaneous edits to the same
note on both devices between syncs. Local clocks must be within five minutes. Snapshot
messages are bounded; this is for personal libraries, not bulk archival transfer. Image
transfers are capped at 8 MB each; video/audio bytes do not sync. Web content cannot make
network requests from the note editor. Mac imports require approval and a closed desktop
app to avoid stale open-editor saves. Real-device Multipeer behavior and live Claude replies
still require owner acceptance; a successful build is not evidence of those checks.

## Source layout

```
ArchivesCore/         shared Swift package: schema, merge, authenticated transport, GRDB
ArchivesiOS/          SwiftUI UI, protected WKWebView editor, recovery and privacy screens
ArchivesSyncHelper/   opt-in Mac library broker and bounded subscription chat
editor-web/          isolated Vite/BlockNote bundle (no network at runtime)
project.yml          source of truth for the generated Xcode project
scripts/             editor/license preparation, bundle verification and release pipeline
```

Use Xcode 26+ / iOS 26 SDK+, Node 22.13+, and XcodeGen. Phone deployment target is iOS 17;
Mac helper deployment target is macOS 14. Keep `DEVELOPMENT_TEAM` in `project.yml` and
regenerate with `xcodegen generate`; don't hand-edit `ArchivesCompanion.xcodeproj`.

```sh
cd archives-companion/editor-web && npm ci
cd ../ArchivesCore && swift package resolve
cd ..
# Audits dependencies, prepares editor/licenses, tests core and current desktop SQL,
# archives/signs iOS, exports IPA, builds/signs helper, verifies bundled resource bytes.
bash scripts/release.sh
# Explicit upload through the existing Xcode Apple account; internal testing only.
bash scripts/release.sh --upload
```

Artifacts and logs go to ignored `release/0.2/`. `ExportOptions.plist` restricts distribution
to internal TestFlight. Upload success, Apple processing, and tester assignment are separate
steps; never equate a local archive with an available TestFlight build.
