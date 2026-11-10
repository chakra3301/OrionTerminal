# Archives Downloads — actual-clip native recovery check

2026-10-05. Owner clarified the repeated playback error was on the **existing Marathon MKV**, not a new download, and approved continuation. The actual clip now has a verified MP4 derivative in a **private native proof profile**. **The agent did not publish that private derivative to the owner's main library.** The owner subsequently followed the normal main-library flow and confirmed “okay that worked now lets finish this tool”; the reported existing-clip repair is closed. The agent has not independently reread that owner-created derivative.

## What passed

The unchanged production `media_download/` and `process_group.rs` modules were compiled offline into a small, separate Tauri host with the existing dependencies. Its frontend exercises real native IPC, not mocked downloader commands. The host includes only the relevant four schema migrations, not a full Orion shell/SQL-plugin startup rehearsal. Original CSP/asset-scope configuration is retained, with a separate identifier and inert local proof frontend; no remote source, provider, authentication or cookie command is exposed.

- Own identifier/profile: `com.lucaorion.orion-terminal.downloads-codec-proof-01`.
- Read-only snapshot of exactly source asset **01M46ZNS6SX2THTZE99YXVFE5S**, its row/tags and file bytes. No other owner assets, chats, notes, credentials or profile state were copied.
- Actual `media_download_playable_copy` → conversion/progress → `media_download_import` completed for the full **123-second, 1920×1080 AV1/Opus MKV**. No yt-dlp/redownload or AI call.
- Native receipt publishes asset/local tags/completion together. All original tags and source URL are retained, with `derivedFrom` referencing the source.
- Output **103,713,716 bytes**, MP4/H.264/yuv420p/AAC, ffprobe duration **123.164s**. Larger than the AV1 master because codecs compress differently; this is not a quality upgrade.
- Actual Tauri **`asset://localhost/…`** loading: readyState4, decoded1920×1080, WebKit duration123.15s; muted `play()` resolves/time advances, seek to86.205s succeeds and playback advances afterward without an error.
- Native host exits, cold reopens, reuses the completed copy without a new asset/job/conversion, then successfully loads/plays/seeks again. Exactly two private assets (source + derivative), one completed job.
- Original owner's **40,162,788-byte** file hash/inode/mtime/mode, Media row and tags remain exactly unchanged. Private source bytes are also unchanged. Both private host processes exited.

Private derivative: `~/Library/Application Support/com.lucaorion.orion-terminal.downloads-codec-proof-01/assets/01M4790RYBB2Z0YH2NBD0DZ2AX.mp4`.

SHA-256: `937195a36defa0d28bd3199064105e24db82fbe115d1d4b72b89d081bae911d6`.

Durable code/build/test/IPC/playback/reopen/preservation receipts: `~/.local/share/orion-proof/downloads-20261005-owner-feedback/existing-clip-repair-01/`. The retained `verification.json`/module snapshots confirm the private host matched the **then-current** production source at the time of this check. P1 continuation subsequently changed downloader modules; do not mislabel this historical proof as a new run of current defaults/cookies/export/poster code or rerun the old verifier expecting newer bytes to match.

## Product handoff correction

`MediaPlayer.tsx` now opens a verified derivative automatically **after that preview explicitly confirms creation**, instead of leaving the old error screen and requiring another manual copy-selection step. It does not autoplay sound. Intent is bound to the source asset; existing copies never auto-navigate without a request. Closed/different/reused previews, late confirmation, Stop and failed conversions revoke or guard handoff. Only codec-verified same-kind derivatives qualify.

**39 focused frontend tests + tsc/diff checks pass**, including seven added handoff/navigation/Stop/failure/source-binding cases. Previously recorded25 ordinary native/2 opt-in engine tests remain their historical results; they were not needlessly rerun for this frontend-only correction. The actual-clip native check above is additional evidence, not a synthetic fixture pass or whole-product UI acceptance.

## Owner-library repair and limits

A narrow read confirmed the running development app already has **schema35**, and its executable contains the playable-copy command. The previous blanket assumption that an updated native binary was still required was stale: normal `tauri dev` had rebuilt it. No manual owner restart/build/promotion was performed in this turn.

Live UI automation could not safely target the preview: one activation did not retain foreground, and Accessibility exposed only window chrome. No input/confirmation/conversion/import was sent to that app. A failed accessibility-tree request did not enable the tree. Do not bypass this by inserting owner asset rows directly or mislabel the private proof as repaired production Media.

For the main-library repair, use the normal gesture: **Archives → Media → original Marathon clip → Create playable copy → Create copy**. The command already verified above creates/imports a separate local asset with inherited tags; the updated player opens it when ready. The owner completed that main-library flow and reported success. This closes the reported recovery workflow; broader independent full-React/progress/Stop/race/audible verification remains separate. Private proof output can be retained independently; it is not a replacement for the original.

Actual audible playback (tests were muted), whole-shell SQL-plugin startup/full-profile recovery, cancellation/Stop/UI races on this real clip, independent owner-library receipt inspection and broader fault/security/site/large-transfer acceptance remain open. Owner-reported main-library recovery is no longer a blocker. No browser-cookie access, media AI upload, new dependency, production application replacement, commit or release. Full Stacher parity remains the approved [P1/P2 backlog](archives-downloads-stacher-parity.md), not complete.
