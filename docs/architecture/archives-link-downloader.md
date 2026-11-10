# Archives link downloader — inspection and proposed scope

Status: **owner rejected first-slice UI/capability and reported real Media playback failure.** The earlier minimal interpretation is superseded by the [Stacher parity correction](archives-downloads-stacher-parity.md). Real target file is MKV/AV1/Opus, not the synthetic H.264/AAC MP4 used in initial tests. Existing source work and approved engine dependency are retained; no completed-product/parity claim. [Setup and bounded earlier evidence](../setup-media-downloads.md).

## Owner request

Use `/Applications/Stacher7.app` as a functional reference and add a video/audio link downloader as another tool inside Archives. This is a native Archives feature, not an Incubator import or another Electron runtime.

## Read-only findings

- Installed Stacher: `7.1.12`, bundle identifier `com.electron.stacher7`.
- Read Info.plist and the ASAR directory/package metadata without launching or modifying Stacher. Inspected bounded CLI-option/engine-URL strings in `.vite/build/main.js`; did not extract application code into Orion, inspect user profiles, or run the bundle.
- Package description explicitly calls Stacher a frontend for yt-dlp. Main bundle references yt-dlp release discovery, FFmpeg/ffprobe, format selection, audio extraction, progress templates, playlists, subtitles and download archives. Static strings establish implementation clues, not runtime acceptance.
- Stacher package metadata declares MIT, but that alone is not verified provenance/permission for every bundled component. No Stacher code/assets are needed for the proposed independent implementation.
- `/opt/homebrew/bin/ffmpeg` and `ffprobe` exist on the current PATH; yt-dlp was not found there. Their execution/versions were not tested. Existing Node is v24.16.0.
- Upstream yt-dlp docs describe FFmpeg/ffprobe for merging/extraction and yt-dlp-ejs plus a supported JS engine for full YouTube support. Prefer explicit reuse of compatible installed Node over adding Deno. Verify the selected engine distribution includes the required EJS component; no silent remote-component downloads.
- Licensing depends on distribution: yt-dlp source is Unlicense, but its standalone PyInstaller distributions include GPLv3+ components. FFmpeg licensing depends on the build. Do not silently bundle either into Orion's Apache distribution.

## Existing integration points

- `src/apps/archives/ArchivesApp.tsx`: sidebar navigation and view rendering.
- `src/apps/archives/useArchives.ts`: `ArchivesView` union and current view.
- `src/apps/archives/Media.tsx`: existing video/audio library and asset operations.
- `src/store/assetsStore.ts`: current imports call native file copy, insert asset row, then schedule indexing and consent-gated AI tagging. Downloader must not silently trigger a new AI upload.
- `src-tauri/src/asset.rs`: current regular-file import is capped at **512 MiB**. Large downloads need an explicit bounded streaming/publication path, not a blanket cap increase or JS byte-array transfer.
- Existing asset rows have `url` and `metadata_json`; preserve source attribution using these, and expose useful metadata instead of discarding it.
- `src-tauri/src/process_group.rs`: existing descendant termination mechanism suitable for yt-dlp/FFmpeg cancellation after lifecycle review.
- `src/apps/archives/runtimeActivity.ts`, plugin disable gating and `src/features/recovery/quitRisks.ts`: integrate active transfers/imports so navigation can continue but disabling Archives/quitting cannot silently abandon work.
- `src/lib/ipc.ts` and `src-tauri/src/lib.rs` already contain unrelated dirty work. Preserve it; append narrowly scoped integration changes only after approval.

## Ranked implementation proposal

### 1. Engine and single-link vertical slice

- Add **Downloads** inside Archives, styled with existing theme typography, soft radii, transparent Liquid surfaces and Archives green; no copied Stacher branding or foreign UI toolkit.
- Explicit dependency readiness: show missing/incompatible engine, FFmpeg/ffprobe and JS support. No installs or automatic engine updates without approval.
- Paste URL → explicit Inspect action → escaped title/site/duration and available format information → Video/Audio choice → explicit Download action.
- Start with single non-live items. Video best/1080p/720p when available; audio original/M4A/MP3 with accurate conversion/quality labels. Do not imply remuxing guarantees MP4 codec compatibility or conversion improves source fidelity.
- Rust-owned job continues across Archives view unmounts. Structured progress, merging/conversion state, speed/ETA when known, Stop, Retry and honest errors.
- Finished file can be saved to Media through an idempotent publication step, retaining source metadata. A failed DB/import step retains the completed file and offers import retry without downloading again.
- Owner-approved organization: native Video/Audio classification and local type/site/source tags; optional existing consent-gated AI topic enrichment from bounded title/description/creator metadata, never video/audio upload. Do not enable background AI or overwrite manual tags.
- First implementation uses approved external engines, not binaries borrowed from Stacher's private profile and not redistributed engines.

### 2. Durable queue and library polish

- Bounded queue/history with stable job IDs, sequential default, explicit retry after restart; never silently resume network activity.
- Append-only migration for job/history state after checking current migration head.
- Distinguish downloading, postprocessing, ready-to-import, importing, completed, stopped, interrupted and failed.
- Reveal/export completed file using existing safe native affordances; source link, Media navigation and collection/board flows where appropriate.
- Multi-link input can follow the first working slice. Playlist selection, subscriptions, clipping, subtitles and advanced format controls are later additions, not first-slice promises.

### 3. Focused validation and isolated native acceptance

- Unit tests: URL/option validation, fixed argument construction, bounded parsers, progress/state transitions, late events, cancellation, retry, missing dependencies and import failures.
- Native process fixtures: timeouts, child termination, oversized output, path/symlink refusal, no-overwrite publication and interrupted-job recovery.
- Focused frontend tests + tsc; avoid repeated broad suites/builds.
- Approved isolated native build: one permitted test video and audio extraction, real Stop/retry, navigate away/back, restart and Media persistence. No production bundle replacement or real-profile modification.

## Safety and operational boundaries

- Only download content the owner is authorized to save. No DRM/paywall bypass or authentication/cookie extraction in v1.
- Strict HTTP(S) input, reject credentials/control characters/local-file and private-network targets. Initial URL validation alone does **not** constrain extractor redirects/subrequests; document and test actual enforcement rather than claiming subprocess network sandboxing.
- Fixed argv via native process APIs; no shell, arbitrary flags, `--exec`, postprocessor arguments, imported configs, plugins, automatic updates or remotely fetched executable components. Review minimal child environment and explicit engine paths.
- Native-owned private per-job directories, generated filenames, bounded bytes/duration/retries/stdout/stderr and no-follow regular-file checks. Never trust a printed output path as filesystem authority.
- Cancel the full process group, await exit and resolve cancellation/publication races before declaring stopped. Never delete a successfully published Media asset during job cleanup.
- Do not send source URLs or media files to AI as part of this downloader. Owner approved optional metadata-only topic enrichment through existing Background AI consent. Source-site network access occurs on explicit inspect/download actions, not paste, mount or history reload. Do not load remote thumbnails prematurely.
- Protected existing work, Stacher installation/profile and production Orion remain untouched. No commit/release implied by this proposal.

## Approved implementation slice

Owner approved this scope and adding **yt-dlp (including EJS support)** as an external runtime dependency, using existing FFmpeg/ffprobe and compatible Node. Installed a separate private CPython 3.13 environment with yt-dlp 2026.8.19/EJS 0.8.0 from a reviewed, hash-locked wheel plan; global tools and Stacher untouched. No redistributed binaries.

Implemented `src/apps/archives/downloads/`, `src-tauri/src/media_download/`, append-only migration34, Downloads sidebar/Spotlight entry and `assetsStore.acceptDownload` text-only consent-gated enrichment. The native transaction owns Media publication/local tags/completion; the UI owns optional AI enrichment after an explicit session-started download/import. History is durable, queue concurrency is one; batch enqueue and automatic resumption are not implemented. See the setup guide for limitations and pending acceptance.

## References

- Local Stacher Info.plist and `Contents/Resources/app.asar` package metadata (read-only).
- https://github.com/yt-dlp/yt-dlp#dependencies
- https://github.com/yt-dlp/yt-dlp#licensing
- https://github.com/yt-dlp/yt-dlp/wiki/EJS
