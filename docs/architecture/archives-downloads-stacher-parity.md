# Archives Downloads — Stacher parity correction

**Current direction (2026-10-19):** the owner explicitly cut exhaustive Stacher parity and requested a cost-conscious finish around thumbnails, library, queue/lifecycle, playback/extras, search/organization, resource/recovery and integration. That practical construction scope is complete; see [closeout and exact acceptance limits](archives-downloads-closeout.md). Subscriptions/scheduling, reusable/pre-download destinations, acquisition-time unembedded sidecars and extra advanced combinations are deferred, **not active approved backlog**. Remaining live/native/owner acceptance and release permissions are separate. Historical requirements/evidence below do not override this scope cut.

Historical status: owner rejected the minimal downloader and approved the full P0 → P1 → P2 correction (“go yes”, “okay continue”, “okay lets get it done”). P0, part of P1 and the bounded P2 queue/batch/playlist, metadata/chapter/caption/audio-art embedding, storage/time limits, SponsorBlock and saved-file sidecars/caption-search slices are implemented with focused synthetic/native-WebKit evidence below and [queue acceptance](archives-downloads-queue.md). Full parity and visual/new-control acceptance remain open. The owner subsequently completed the main-library existing-clip recovery and explicitly confirmed it worked; that reported repair is closed. A subsequent actual-clip private native check now passes asset-protocol play/seek/reopen; see the linked recovery evidence below. No renewed scope approval is needed.

## Owner's actual target

“i gave u stacher 7 it needs to atleast be as good as that” (2026-10-05).

Stacher7 is the functional baseline, not merely evidence of which engine to invoke. Keep Orion's active theme and integration, but match the useful download, format, queue, authentication-choice, clipping and library workflows. Do not substitute static controls, disabled placeholders or a marketing-style empty page for working tools. No claim of parity based only on unit tests or a short synthetic MP4.

Eight owner-supplied screenshots were read in full and retained privately (not committed) at:

`~/.local/share/orion-proof/downloads-20261005-owner-feedback/references/`

Read-only local bundle inspection covered Stacher7 **7.1.12**, its configuration labels and renderer feature strings. No Stacher profile, cookies or credentials were read; no Stacher code/assets copied into Orion. Package-level license metadata alone is not whole-bundle provenance clearance.

## Confirmed playback failure

The owner's active process was `src-tauri/target/debug/orion-terminal`. A read-only, title-filtered query against **only the reported asset** in the active app database found:

- Asset `01M46ZNS6SX2THTZE99YXVFE5S`
- Title: `Marathon - Cryo Archive Durandal Override Intro Cinematic`
- File: `$APPDATA/assets/01M46ZNS6SX2THTZE99YXVFE5S.mkv`
- Size: **40,162,788 bytes**; duration **123.188 seconds**
- Container: **Matroska**
- Video: **AV1 Main**, **1920×1080**, **yuv420p**
- Audio: **Opus**

This is not the H.264/AAC MP4 combination used in the previous synthetic test. `Preset::Video1080` selects arbitrary best codecs, and `--merge-output-format mp4/mkv` does not guarantee an inline-playable result. The final MKV is outside the native HTML media player's supported container path. Changing a MIME type/extension alone is not a fix. AV1/Opus in a different container also needs capability checks rather than a blanket claim.

`AssetPreviewModal.tsx` then renders an unguarded `<video>` without an error/recovery state. When metadata never loads, its intrinsic 300×150 dimensions explain the tiny crossed-out player shown in the screenshot. It is mounted in the DOM and does not set `crossOrigin`, so the earlier FX detached-video/CORS bug is **not** the observed code path here.

**No owner file, Media row, settings or running process was modified during diagnosis.** This targeted read is not a broader production-profile audit.

## Product/UI audit — rejected first slice

At audit time, Downloads was an oversized introductory form with setup prose and generic text rows. It lacks the compact control bar, mode clarity, visual media identity, queue management, per-item inspection and direct file actions expected of a mature desktop tool. Native technical details compete with the primary task. The chosen format's codecs and preview compatibility are not visible. A successful transfer is presented as a successful end-to-end outcome without a player check.

Direction: **a compact Archives-native download workspace**, not a landing page. Preserve Space Grotesk/JetBrains Mono, green accent, soft rounded controls and original see-through Liquid. Use a compact link/action bar, Video/Audio mode, accessible format/clipping/archive/authentication controls, queue/library navigation, media thumbnail rows with real status, and a details panel for the selected item. Hide engine diagnostics in Settings/details unless a dependency is actually broken. Responsive compact layouts must retain primary actions and keyboard access.

The Media viewer also needs a proper large media stage, bounded secondary metadata/tags, loading/error/recovery states, and working play/seek/audio controls. External-player fallback is useful, not a replacement for playable Media imports.

## Feature inventory and acceptance backlog

Evidence **S** = supplied screenshot; **B** = installed bundle configuration/renderer labels. B confirms a discoverable feature surface, not full manual acceptance of every upstream workflow.

| Capability | Evidence | Initial gap / required result |
| --- | --- | --- |
| Separate video/audio mode | S | Replace combined six-entry select with explicit mode and relevant format controls. |
| Combined best, highest-quality A/V, MP4, highest/lowest video-only | S/B | Distinct working selectors, transparent codec/container consequences. |
| 4K, 2K, 1080p, 720p, 480p, 360p, 240p, 144p, worst | S | Full resolution ladder; source availability and fallback stated. No upscaling or unavailable-resolution claims. |
| Audio formats and quality | B | Best/original plus common M4A, MP3, AAC, WAV, FLAC, Opus/Vorbis choices; actual conversion and meaningful quality/bitrate controls. |
| Exact format selection / sorting | B | Inspect real available formats, dimensions/FPS/codecs/estimated size; select real IDs through bounded native validation rather than raw arbitrary CLI. |
| Remux vs re-encode | B | Separate choices and explanations; remux never advertised as codec conversion. Compatible playback path verified independently. |
| Pre-download crop | S/B | Renderer exposes Start Time / End Time: implement temporal clipping first, not an invented spatial-crop interpretation. Review range, duration and exact-vs-keyframe behavior before download. |
| Download archive / deduplication | S/B | Durable source identity tracking distinct from visible history; explicit skip/redownload control, correct audio/video/range variant semantics. |
| Browser cookies | S/B | None by default, explicit browser/profile selection and consent for this job/source. No automatic credential access or retention in frontend/logs/history. Separate approval before any real browser-cookie test. |
| Queue / batch URLs / playlists | B | Real queued jobs, bounded explicit playlist selection, pause/resume where supported, cancel/retry/reorder and concurrency controls; restart behavior explicit. |
| Destination folder / file naming | S/B | Native folder selection, scoped export permissions, sensible naming and no-overwrite policy; Media remains a first-class destination. No arbitrary path templates escaping the approved folder. |
| Rate/retry/concurrent-fragment controls | B | Validated bounded values, actual process behavior, persistent defaults. |
| Metadata, thumbnail and chapter embedding | B | Explicit options, cover art/chapters actually included and verified; sidecars retained intentionally, not discarded. |
| Subtitles / languages / automatic captions | B | Actual selection, sidecar/embed behavior and searchable metadata, with clear source availability. |
| Library search/filter/tagging/player | S/B | Playable media, real thumbnails/previews, title/creator/source/codec/size metadata, search/type/tag filters and file actions. Keep existing local tags and consent-gated AI enrichment. |
| SponsorBlock | S | Default-off fixed-service lookup; per-job mark or remove categories, native bounded gateway, actual timing/category verification. Generated-loopback evidence; live service/owner acceptance and mixed mark/remove policies remain open. |
| Subscriptions/scheduling | B | Explicit source, bounded schedule, destination, consent and restart/lifecycle rules. Separate follow-on slice, not silently cut from the parity backlog. |

Upstream has additional advanced configuration, proxy/login fields and command hooks. A full settings inventory must be checked before declaring overall parity. An independent implementation does not need to reproduce unsafe defaults or bypass Stacher's own premium/licensing mechanisms. Shell postprocessing hooks and disabled TLS validation are not being silently added as part of a downloader UI repair.

## Ranked implementation plan

### P0 — End-to-end playback correctness

1. Add a first-class **Play in Archives** compatibility policy. Prefer suitable H.264/AAC MP4 streams when available; probe actual completed output with ffprobe. Where conversion is necessary, expose a real converting phase with cancellation, byte/time bounds and explicit quality policy. Preserve highest-quality original mode as a distinct option.
2. Handle incompatible master formats by creating an explicitly identified playable derivative rather than pretending the original is browser-compatible. Do not silently replace an original asset.
3. Offer **Create playable copy** for the already downloaded failed asset. Preserve original bytes, title/source attribution/tags; save/link the derivative using the same native publication and recovery protections. No redownload required.
4. Fix Media viewer sizing, media-error reporting, retry/open-external affordances and accessibility/lifetime handling. Never leave an unexplained crossed-out native player.
5. Verify the exact failure class **MKV + AV1 + Opus → compatible playable copy** and the full native `asset://` load/play/seek/audio/reopen path. ffprobe success alone is not acceptance.

### P1 — Screenshot-level controls and UI rebuild

1. Implement the compact link/action workspace and selected-item details; redesign queue rows and Media handoff together, not a detached mockup.
2. Full video/audio modes, format ladder, video-only/combined/MP4 choices, real format inspection and saved preferences.
3. Temporal crop/range review, durable duplicate archive, explicit browser-cookie workflow and destination controls. Each control must change the validated native job configuration and survive the intended lifecycle.
4. Preserve clear no-network-on-paste behavior, explicit source inspection and existing AI consent. Test controls with fixtures; do not read owner browser cookies to prove the dropdown works.
5. Owner reviews the actual rebuilt screen at normal and narrow window widths in Liquid and Ivory, including keyboard and loading/error states.

### P2 — Remaining Stacher parity

**Queue/batch/playlist implementation now complete within documented bounds:** native held staging/default snapshots, explicit1–3-slot Run, anonymous immutable playlist review/selection, pause/retained-byte continuation, Stop/Retry/reorder/hold and cold no-auto-run behavior. 66frontend/59ordinary native/4installed synthetic engine tests/typecheck/notices/diff pass; full-schema38 private native publication/restart and five actual-React blocked-IPC WK renders pass. Real concurrent remote-site/playlist and active native-pause/owner acceptance remain open. [Policies, evidence and exact limitations](archives-downloads-queue.md).

**Metadata/chapters/caption/audio-art embedding now implemented within documented bounds:** optional persisted switches, exact manual/automatic language selection, actual MP3/M4A/FLAC artwork, chapter-preserving video clipping and verified file-extras receipts. All switches default off; captions+clips are explicitly refused. Subtitle verification matches a bounded keys-only extraction receipt to actual stream-language identities (including ISO aliases/regional variants), not just track counts. Metadata-only remux corrects the pinned engine's three-letter tag errors and persists regional identities even without codec conversion; missing-language sentinels and receipt cleanup are covered. Opus/Vorbis stream titles survive playable-M4A normalization. Complete inventories up to1024 languages are retained or inspection refuses rather than silently truncating. 69focused frontend/68ordinary native/5installed synthetic fixtures/typecheck/notices/diff pass; four blocked-IPC WK renders cover themes/narrow layouts. Real-site/art/caption playback, native dialogs and owner review remain open; subsequent saved-file sidecar/search implementation is described below. [Exact supported formats, policies and evidence](archives-downloads-embedding.md).

**Storage/time limits now implemented within documented bounds:** validated per-source/saved-default file16–65536 MiB, combined work32–262144 MiB (≥2× file), reserve512–65536 MiB and per-engine1–1440-minute snapshots; historical defaults remain2GiB/4GiB/512MiB/45min. Native transfer/conversion/remux/publication use chosen limits; queue work-cap cohorts, sampled aggregate/free-space checks, pending-copy headroom, ready-state preservation and responsive/cancellable local preparation are covered. 72frontend/81ordinary native/5synthetic installed fixtures/typecheck/notices/diff pass, plus six blocked-IPC WK theme/narrow source/default renders. No physical large Internet transfer, actual low-disk/native-dialog/owner acceptance claim. [Exact ranges, evidence and limitations](archives-downloads-limits.md).

**SponsorBlock now implemented within documented bounds:** default-off YouTube-only mark or remove categories with explicit third-party/hash-prefix disclosure, frozen options/archive variants, fixed-origin native bounded gateway, valid empty/404 preservation and fail-closed malformed/unsupported/error handling. Actual duration and category-specific merged interval coverage are verified through compatible normalization and clipped/rebased marking. Generated media plus loopback service exercise actual marking/removal/video/MP3/empty/error paths;76frontend/100native/6synthetic installed fixtures, typecheck/notices/diff and six blocked-IPC WK renders pass. No real service, owner, credential or chapter-player acceptance claim; mixed per-category mark/remove is not implemented. [Exact privacy, formats and evidence](archives-downloads-sponsorblock.md).

**Saved-file sidecars/caption search now implemented within documented bounds:** explicit native actual-file review, selected-track VTT/SRT and chapter/metadata JSON export through native Save authority, no-clobber copies, bounded local caption indexing/clear and shared Archives/MCP keyword search. Default keyword/no-AI sidebar preserves disabled-app filtering; existing semantic search remains explicit. Source descriptor/version guards, cancellation/publication lifetimes, stale cleanup, concurrent read-snapshot paging and profile-scoped cross-panel invalidation are covered. Schema39 is frozen;93frontend/121ordinary native/seven installed synthetic engine fixtures plus descriptor-inheritance subprocess/helper (nine ignored entries), typecheck/notices/diff pass. A hidden private full-schema1–39 host verifies actual inspect/index/search/clear IPC, native invalidation events and cold persistence with generated fixture rows and unchanged originalA; six blocked-IPC WK renders cover themes/narrow download/player controls. Actual Save dialogs, full-React/MCP/full-shell/owner acceptance remain open. This does not recover omitted source captions or implement acquisition-time unembedded sidecars. Owner profile39 was not yet applied on latest metadata-only inspection; no app/watcher was running and it was not force-launched. [Exact scope/evidence](archives-downloads-sidecars.md).

Next implementation: remote row thumbnails, richer library/file actions/reusable destinations, acquisition-time unembedded sidecars and explicit subscriptions/scheduling. Close the inventory item by item with real behavior and visible evidence; larger selected caps are not unbounded downloads or disk reservations.

No blanket “as good as Stacher” label until the agreed inventory is implemented and accepted. A P0/P1 build is a correction milestone, not completion of the whole parity request.

## Carry-forward implementation safeguards

- Independent React/Tauri implementation using the already approved external yt-dlp/EJS/FFmpeg/Node stack. No new dependency needed for the planned immediate corrections.
- Append-only migrations; preserve pre-existing dirty work, process-group cancellation, native publication receipts, retryable completed files, tags and background-AI consent.
- Retain originals and failure evidence; no in-place owner-media transcode, silent production-profile migration or application replacement.
- Active development app uses the real owner profile. Native builds/restarts/automation must be planned accordingly; use isolated native proof first rather than operating blindly on that live app.
- Authentication is optional and explicit. No cookie reading during this audit; source-specific runtime consent and no logged secrets must precede authentication acceptance.
- Existing subprocess implementation is not a network sandbox. Redirect/CDN/DNS enforcement remains separate security work; do not claim otherwise while adding options.

## Implemented correction milestone — 2026-10-05

- Append-only `0035_media_download_options.sql`: persisted native job options and source-asset linkage. Old history survives; eight commands now include `media_download_playable_copy`.
- Fourteen video choices (combined/best/MP4/video-only/lowest and 2160–144p), eight audio choices, inspected format IDs with FPS/codecs/estimated size, validated clip ranges and quality controls. Native duplicate checks compare source, preset, range, stream, compatibility and quality against retained completed history. This is **not** the durable independent archive still required by P1.
- `playback.rs` probes actual container/streams/pixel format; filename alone cannot mark an output compatible. Embedded audio cover art is not treated as the video stream. Same-resolution H.264/AAC preference precedes cancellable conversion to verified H.264/yuv420p/AAC MP4 when necessary. Clipping re-encodes after full transfer; AAC/Opus clipping quality drives bitrate, while lossless/original choices hide irrelevant quality controls.
- Existing Media originals are copied into private native work first. A separate playable-copy asset inherits tags and source attribution, records `derivedFrom`, uses the established transaction/publication protections and does not invoke AI. Same-container clipping replaces only validated native working bytes atomically; different-container publication precedes working-source retirement. Originals are never the FFmpeg output path.
- Compact link/action bar, download/completed views, filter, selected-item inspector, large Media player with loading/error/create-copy/external/retry states and explicit Stop. Native narrow rendering exposed nested shrinking scroll regions; corrected to one full-height scroll flow. Video thumbnail fallback stays visible until a real frame loads; native poster generation/source artwork remains open.

### Focused evidence and exact limits

**32 frontend tests**, **25 ordinary native tests**, **2 explicitly opted-in installed-engine tests**, tsc, distribution-notice checks and owned diff checks pass. Ordinary conversion-argv tests use synthetic executable paths and do not require installed engines.

The installed proof creates only agent-owned AV1/Opus MKV, accurately clips/converts to H.264/AAC MP4, verifies codecs/duration/progress and byte-identical original preservation; a second same-MP4-container clip also succeeds. The fixed yt-dlp builders separately download a synthetic loopback fixture and extract MP3. Production loopback policy is unchanged; no live site/cookie/AI request occurred.

A separate **nonpersistent macOS WKWebView** loads the actual React player with mocked stores and native IPC deliberately disabled. The converted file, served on agent-owned localhost HTTP, reaches readyState4/256×144/duration1.5s; muted `play()` resolves, time advances and seek to0.9s succeeds without a player error. Audio stream presence is ffprobe-confirmed; **audible playback was not accepted** (WebKit exposes no decoded-audio-byte receipt here). Liquid/Ivory and420px rendering/scroll screenshots are retained. This is **not the real Tauri `asset://` path**, native commands/DB lifecycle, production UI, user keyboard acceptance or owner sign-off.

Durable receipts/code/isolated harness: `~/.local/share/orion-proof/downloads-20261005-owner-feedback/parity-correction-01/`. Final installed-engine bytes: sibling `av1-codec-proof-04/`. Chromium capture later timed out; final corrected narrow evidence uses native WK snapshots, not a fabricated browser pass.

### Actual-clip continuation — 2026-10-05

Owner clarified the existing Marathon clip was still failing and approved continuation. [Private actual-clip native recovery](archives-downloads-native-recovery.md) now passes production-command conversion/import, tag/source preservation, real Tauri asset-protocol muted play/seek and cold reopen/reuse on the full1080p clip. Original owner's bytes/row/tags unchanged. The derivative is in a **separate proof profile, not the main Media library**. The running dev app already has schema35/native command (normal dev rebuild); no manual restart or direct owner DB publication. One live activation did not retain foreground and AX exposed only window chrome, so no input/import was sent there.

`MediaPlayer.tsx` now automatically opens the verified copy after explicit creation consent, only while that source preview remains current; no autoplay sound or late navigation.39focused frontend/tsc/diff checks pass; Stop/failure/source-binding also revoke or guard handoff. At that historical checkpoint, audible/full-React owner smoke and main-library repair were still open. The owner later followed the gesture and said “okay that worked now lets finish this tool”; the reported existing-clip recovery is now accepted, without a new agent read of the owner's derivative. Broader independent audible/full-React checks remain open; the earlier32/25/2 counts are historical checks, not a newly rerun broad suite.

### Historical next gates — superseded by practical closeout

The following records the earlier full-parity plan. Do not execute its feature backlog: the owner scope cut and [closeout](archives-downloads-closeout.md) above are authoritative.

1. **Reported existing-clip repair accepted by owner.** Broader audible/full-React/Stop/race/fault acceptance remains independent; do not repeat conversion or inspect owner media unnecessarily.
2. Current P1 controls milestone below needs real dialog/export/defaults/visual workflow acceptance. Browser credential extraction requires separate explicit owner test consent; a working dropdown is not evidence of actual cookie decryption. Saved/pre-download external destinations and remote row thumbnails remain open, not silently covered by manual export/local video posters. Audio file artwork now has bounded embedding evidence, not live-site acceptance.
3. Continue the already-approved P2 work: standalone sidecars/search, remote thumbnails/richer library actions, reusable destinations and subscriptions/scheduling. Queue/batch/playlists/concurrency/pause/resume, bounded embedding, configurable resource safeguards and bounded SponsorBlock are implemented, not fully owner/live-site accepted. Rate/retry/fragment controls are implemented below. No renewed scope approval needed and no blanket Stacher parity/completed-product claim.

## P1 controls continuation — 2026-10-05

- **Defaults:** `preferences.rs` + append-only0036/0037; native validated/versioned singleton, no reset/overwrite of damaged or unknown settings. New inspections snapshot format/playback/quality/duplicate/rate/retry/fragment defaults. Clip ranges, exact format IDs and browser selections stay source-specific. UI offers settings and source-level Save these defaults; stale default reads cannot overwrite a newer save.
- **Independent archive:** committed in the asset/tags/completion transaction; survives visible history and asset removal. Existing completed remote receipts backfill; local derivatives do not enter it. Source/preset/range/quality/compatibility/stream variants are distinct. Generic extractor basename collisions use URLs instead of cross-host identities. Explicit Forget source archive leaves Media/history alone, and source reinspection/redownload is available. Archive-insert failure rolls back all DB publication but retains both working/published media bytes for retry.
- **Scoped export:** a native Save dialog binds the operation to an existing audio/video asset; no client-provided destination path or saved filesystem grant. Bounded human filenames and unchanged real extensions. macOS/Linux descriptor-relative folder traversal, exclusive0600 temporary output, sync and no-clobber link; links/parent traversal/existing targets are refused, originals remain intact. Scratch destinations are rejected. This is manual post-import export, not saved external destinations or direct batch output. Native Save/Cancel keyboard/race/fault UI acceptance is still open.
- **Cookies:** separate optional source-inspection/download controls for Chrome/Chromium/Brave/Edge/Firefox/Opera/Vivaldi/Safari. Native Allow once dialog names the source/job/operation, validates only fixed browsers and bounded profile basenames/fixed Safari stores, and requires fresh approval on Retry/Download. Inspection consent is never reused. Native requests cannot supply an approved flag, raw cookie file or arbitrary CLI/path. No browser choice or cookie values are written to job/default JSON. HOME remains isolated; cookie flags precede the CLI source terminator.
- **Temporary cookie handling:** yt-dlp can read other sites’ cookies in that profile and copy the database during extraction. Dedicated0700 auth scratch, native advisory profile lease (prevents idle cleanup of leased access), sampled64MiB/128-entry budget, cancellation/reaping, RAII cleanup and idle orphan retry; no use of publication work/assets as credential storage. Authenticated diagnostics are redacted before UI/history. Tests use fabricated `/synthetic` paths/markers only, including cancel-without-staging, leases, oversize supervisor termination, cleanup and diagnostic suppression. **No real browser/cookie/keychain extraction test or actual permission-dialog acceptance was performed.** No process/network/credential-security clearance claim.
- **Transfers:** validated rate16–1048576KiB/s or unlimited,0–10 retries,1–8 concurrent fragments; the actual engine receives limits for transfer/fragment/extraction. Fragments are not concurrent jobs. Persisted defaults apply to future inspections only.At this earlier P1 checkpoint,2GiB final/4GiB sampled work/45-minute limits were not configurable; the later storage/time slice above supersedes that gap without changing historical defaults.
- **Posters:** bounded file-only FFmpeg extraction of an actual local video frame to320px JPEG. Header/end/512KiB validation, stable identity-bound poster publication/metadata, safe fallback and asset cleanup. Downloads and Media prefer that native still over per-row video decode. Optional poster failure does not fabricate artwork. Remote source thumbnails, audio cover art and embedding remain open.

### Continuation checks and limits

**53focused frontend tests,47ordinary native tests,3explicitly opted-in installed-engine fixtures**, tsc/notices/diff pass. Installed tests use only generated media and the existing loopback fixture: actual320×180 MJPEG poster publication with byte-identical video, AV1/Opus conversion/clipping regression, and yt-dlp download/MP3 extraction. No new dependency or engine installation/update.

Nonpersistent background WKWebView renders actual React components/real theme CSS with stores seeded and native IPC/actions blocked: Liquid/Ivory and420px top/bottom, expanded cookie/default/transfer fields, decoded generated poster and no horizontal overflow. No foreground activation or owner-app input. This is UI-fixture coverage, **not** actual native Save/Allow dialogs, library defaults reopening, live source/cookie/AI workflows, whole-shell faults or owner visual acceptance. Receipts/source snapshots/harness/logs: `~/.local/share/orion-proof/downloads-20261005-owner-feedback/p1-controls-01/`.

The already-running `npm run tauri dev` rebuilt/relaunched automatically and applied36/37. An initially authored36 was already applied during iteration; a narrow **read-only `_sqlx_migrations` metadata-only** check caught its checksum change. Restored36 to its exact first-applied bytes and appended37 for the generic-identity correction. Final checks show both successful/matching checksums. No asset/tag/source/cookie rows were read, no direct owner SQL writes, no manual production build/replacement or activation, commit or release. Freeze newly registered migrations immediately while this watcher runs.
