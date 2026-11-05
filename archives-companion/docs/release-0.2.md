# Archives 0.2 (3) — internal TestFlight upload

## Apple delivery

- Bundle: `com.lucaorion.archives.ios`
- App Store Connect app: `6775891113`
- Version / uploaded build: **0.2 / 3**
- Apple receipt: **Uploaded to Apple — success**, `2026-09-15T17:29:02Z`.
- Receipt errors / warnings: **none**.
- Distribution restricted to **internal TestFlight** (`testFlightInternalTestingOnly=true`).
- Last server progress: **Uploaded package is processing.** Processing completion and
  internal tester assignment have **not** been verified. The browser has no authenticated
  App Store Connect session (redirected to login with `authResult=FAILED`); the temporary
  status-check tab was closed. No credentials or account settings were changed.
- [App Store Connect / TestFlight](https://appstoreconnect.apple.com/apps/6775891113/testflight/ios)

This is an accepted upload, **not evidence that the build is already installable by testers**.

## Delivered artifacts

Ignored local folder: `archives-companion/release/0.2/`

| Artifact | SHA-256 |
| --- | --- |
| `export/ArchivesiOS.ipa` | `4ab430c1cbce13d361f533c500ed09d65a351f583f3dfa7f7b0b689ccb625887` |
| `ArchivesSyncHelper-0.2.zip` | `1cfbb13e00b61f0a4fa91068a3b2cd8d8bad3cc7b713f752ffa1075d7512622b` |

The local exported IPA fingerprint is not a claim about Apple's re-signed/thinned delivery.
The archive's distribution receipt independently records successful upload of build 3.
The matching Mac helper is Apple Development-signed, arm64, and **not notarized**; it is
personal/internal infrastructure, not a public Mac installer. No production app was replaced.

## Scope

- Coordinated native iOS and Mac-helper update, not a desktop shell rebuild.
- Keychain pairing + direction-bound authenticated AES-GCM protocol v2; no v1 fallback.
- Private opt-in library access, human import review, closed-desktop import guard.
- Validated snapshots, deterministic timestamp ties, deletion tracking, note/media
  atomic imports, verified pre-import SQLite backups and ten-copy retention.
- Bounded, acknowledged image transfer; traversal/symlink/no-overwrite protections.
- Journal-before-save phone edits; visible failures and new-note draft recovery.
- Immediate editor callbacks, retained-editor sync guard, protected unsupported documents,
  desktop callout schema parity and network-blocked WKWebView.
- Resized/normalized photo intake, pairing/connection and privacy screens, accessible chat
  controls with Stop and draft restoration.
- Opt-in Claude-subscription text chat with sign-in preflight, zero tools/MCP, private work
  directory, fresh sessions, bounded output/time and cancellation. No API billing fallback.
- Updated existing frontend dependency families; 194 dependency notices, GRDB and font
  notices, privacy manifest and three integrity-matching BlockNote MPL source archives.

## Executed gates

- **30 Swift tests passed**, including migration of a synthetic database through all 29
  current desktop SQL migrations, phone round-trip, stale deletion suppression, board-member
  removal/re-addition, transaction rollback, backup no-overwrite, stale draft refusal,
  AES authentication/replay/reflection/tamper checks and filesystem traversal/symlink refusal.
- Standalone editor Vite build passed; production npm audit **0 vulnerabilities**.
- iOS Release archive and App Store distribution export passed (Xcode 26.3 / iOS SDK 26.2).
- Mac helper Release build and deep/strict code-signature verification passed.
- Signed iOS bundle verification passed: exact editor, privacy manifest, notices and MPL
  source bytes; both fonts present.
- Apple's upload/analysis pipeline accepted the package; receipt has no warnings/errors.

Evidence: `release/0.2/{prepare,tests,archive,export,helper,upload}.log`,
`Archives-0.2.xcarchive/Info.plist` → `Distributions`, and `SHA256SUMS`.
Early failures were corrected: old dangling-tag test fixture, dangling-symlink resolution,
manual use of an Xcode-managed provisioning profile, and vendor-text whitespace checks.

## Not claimed

No real-device two-peer Multipeer session, owner UI acceptance, live Claude reply, clean-Mac
helper installation, or full-profile recovery was performed. No production database was
opened by the new helper, and no paid model call was made. Local Claude auth status reported
signed out; the app will require subscription sign-in before AI use. These acceptance checks
remain appropriate for the internal beta, with the limitations stated in the in-app privacy
screen and README. Notes still use last-write-wins, not collaborative conflict-free editing;
image transfer is capped at 8 MB, and video/audio bytes are not synchronized.

Concurrent desktop theme/orb changes elsewhere in the repository were preserved and are
outside this mobile release. Do not interpret this mobile build as validation of those changes.
