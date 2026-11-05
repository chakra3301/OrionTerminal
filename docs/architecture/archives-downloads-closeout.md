# Archives Downloads — practical closeout

## Current scope

Owner direction (2026-10-19): prioritize thumbnails, a richer library, queue/lifecycle, playback/extras, search/organization, large-file/failure recovery and integration. This is a secondary Orion feature; stop extending it toward exhaustive Stacher parity.

**Construction for that practical scope is complete.** Full Stacher parity is no longer the acceptance target. Reusable/pre-download destination systems, subscriptions/scheduling, acquisition-time unembedded sidecar retention and additional advanced option combinations are **deferred, not an active implementation backlog**. Existing scoped manual export and saved-file sidecars remain supported. Historical parity inventories are reference material, not renewed authorization to implement everything in them.

## What this closeout adds

- **Source thumbnails:** inspection can fetch one optional public HTTPS JPEG/PNG preview natively. DNS addresses are validated and pinned for that request; private addresses, redirects, proxy inheritance and browser credentials/headers are refused. The source thumbnail URL is not stored in job/default JSON or passed to models. Timeout6s, body256KiB, dimension4096 per edge/4MiPixels, maximum16 process-memory/profile-path-bound entries, expiry30minutes. No WebView remote image loading. Fetch/format failures leave the normal icon; this is a best-effort preview, not a site-availability guarantee or network sandbox.
- **Persistent saved artwork:** existing local video posters remain. MP3/M4A/FLAC with actual embedded cover art now also generate the existing320px identity-bound JPEG poster, shown in Media/Downloads/audio preview and removed with its asset. Audio poster extraction must not seek, even to zero, because FFmpeg can drop attached pictures. Missing/unreadable art uses the icon. Source previews are session caches; saved local posters persist. No original media is altered.
- **Library controls:** rename the library title without renaming bytes/source filenames, favorite/unfavorite, copy a validated source link, and review creator/file/type/source description. Rename/favorite persistence precedes local state changes; failed SQL cannot leave a false successful edit. Title edits update existing lexical search through schema39 triggers and invalidate search views; they do not call a model. Existing preview, native export, reveal/open and history-only removal remain.
- **Organization:** Downloads filters Video/Audio/Favorites and searches current library title, tags and original filename as well as source metadata. A filtered-out selection no longer leaves an unrelated inspector visible.
- **Playback/extras:** the player exposes caption tracks actually reported by its media element, with explicit Off/showing. After an explicit saved-file inspection, chapter buttons seek within the existing player without starting playback or sound. Absent browser track support does not invent tracks; use saved-track export/external-player fallback. Poster-backed video and audio cover stages retain loading/recovery behavior.
- **Queue/recovery fixes:** native Run clears old queued-ready publication errors before returning its run receipt and again on admission. Rejected Stop requests retain frontend completion tracking until native success, so a saving download can still appear in Media. Ready publication failure still retains retryable media bytes; no second download is required.

## Existing bounded behavior retained

- Held-on-restart queue, explicit Run, batch/playlist review,1–3 slots, transfer-only retained-byte Pause/Resume, cancel/retry/reorder.
- Automatic verified compatible output; original-preserving playable copies; compatible-copy handoff only for the explicitly requested current preview.
- Optional metadata/chapters/captions/cover embedding and actual-probe receipts. Captions+clips and incompatible formats refuse explicitly rather than publish broken timelines.
- Native no-overwrite export and saved-file VTT/SRT/chapter/metadata extraction, local caption index/clear, keyword-first shared Archives search. No automatic caption indexing or AI invocation.
- Frozen limits: file16–65536MiB; shared work32–262144MiB and at least2× file; free reserve512–65536MiB; per-engine1–1440minutes. Defaults2GiB/4GiB/512MiB/45minutes. Shared-budget scans tolerate peer rename/disappearance but reject links/special files/other errors; guard checks are sampled, not disk reservations.
- Operation-specific native cookie consent, isolated bounded scratch and redacted diagnostics. No real browser/keychain extraction was performed for this closeout.

## Verification and delivery

Current focused gate: **103 frontend tests,125 ordinary native tests**, typecheck, **259 bridge tests**, production frontend build, license-material check413native notices/8archives and whitespace checks pass. The updated installed-engine embedding fixture passes all its generated cases, additionally proving320px MJPEG poster extraction from clipped MP3/M4A/FLAC and byte-identical source audio. Two read-only review passes identified the queue fixes above, then reported no further concrete scoped defects. Other seven-fixture/full-schema/private-native acceptance remains the separately recorded historical evidence, not a new live-site claim.

Five nonpersistent background WK renders use actual current React/theme CSS with seeded stores, generated media and blocked native/model actions: Liquid source overview/library, Ivory library,420px library and player. Raster previews decode and recorded layouts have no horizontal overflow. This is not owner visual acceptance, native Save/Allow dialogs, audible playback or proof of real remote thumbnail service behavior.

Private evidence: `~/.local/share/orion-proof/downloads-20261005-owner-feedback/p2-closeout-01/`. Initial build was killed by the160s tool timeout while computing compressed sizes; the single authorized retry completed. No code workaround was needed. Existing Vite mixed-import/chunk-size warnings remain.

Schema39 is already registered and frozen (`795e74c7030c3f459b9c04ac2aec7d2332d49e27df603c777e7ed70287650dc31b05de0d1618d79f07f08401ab58ab5d`, SHA384). Full1–39 startup/cold reopen passed in the previous private native host. The last owner-profile metadata-only check found39 absent; this closeout did not inspect/change the owner DB or force-launch the app. The **next normal updated native launch** applies it; an older installed native binary cannot gain these commands from frontend refresh alone.

No new migrations/dependencies/engine installation, owner-media recovery redo, credential operation, forced activation, installed-app replacement, commit/push/package/release. Changes remain uncommitted on `validation/alpha-2026-09-14`, preserving unrelated dirty work.

## Remaining acceptance, not feature expansion

Normal owner use still needs to confirm the updated full app opens/migrates, one permitted real source previews/downloads/plays/seeks, optional browser track/audio behavior, native Save/Cancel and any chosen queue/failure workflow. Physical large transfers/low-disk/full-shell fault races and live EJS/site variability are not established by synthetic tests. Real-cookie smoke requires separate explicit test consent. Packaging, committing or replacing the installed app requires specific authorization. These are honest delivery/acceptance limits, not reasons to reopen the deferred feature backlog.
