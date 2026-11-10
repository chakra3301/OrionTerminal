# Archives Downloads — verified file extras

Status: bounded P2 embedding implementation, **not whole-tool Stacher parity or owner acceptance**. Existing queue/publication/authentication policies remain in [queue acceptance](archives-downloads-queue.md) and [parity inventory](archives-downloads-stacher-parity.md). No migration, dependency, engine update, owner-media operation or manual application replacement in this slice.

## Working controls

**Metadata, chapters & captions** is available for the selected source and in saved new-link defaults. All new switches default off, including on historical job/preferences JSON. Inspection reports sanitized manual and automatic language codes, chapter count and artwork availability, not remote caption/artwork URLs. Editing these controls performs no network/AI request; explicit inspection/download/Run retains existing consent and queue authority.

- **Embed source metadata** invokes the engine's metadata postprocessor for title/creator/supported source tags. It is independent of chapters, and does not silently embed the complete extractor info JSON. Existing source-embedded tags are not stripped by an off switch.
- **Embed chapters** supports video and M4A. Source availability can be zero. A clipped video retains overlapping chapters shifted onto the output timeline. No manual chapter editor or player chapter navigation is claimed.
- **Embed audio cover art** fetches source artwork for MP3/M4A/FLAC during the explicit download and embeds it in that file. AAC/WAV/Opus/Vorbis/original and video are refused for this option. Local video posters remain a separate mechanism. Missing requested artwork refuses completion rather than reporting a successful embed.
- **Embed subtitles** supports full video with one to five exact bounded language codes (for example `en`, `fr`, `pt-BR`). No wildcards, arbitrary expressions or CLI. **Allow automatic captions** is opt-in; manual captions take priority for a language and automatic captions fill missing requested languages. Inspection rejects unavailable choices; normalization also refuses missing requested tracks after the transfer.
- Caption embedding currently **rejects clip ranges**. Copying unshifted timed text into trimmed video would be wrong. Caption-preserving clipping remains a separate implementation item, not silently inaccurate output.
- MP4 caption conversion uses selectable `mov_text` tracks and can lose original caption styling. It does not burn captions into the image or implement transcript search. The Media native player may not expose every embedded track; external-player fallback remains available.
- Only the verified media file enters Media. Caption/thumbnail working files are not standalone Library assets or exported sidecars. Engine temporary caption cleanup is explicitly selected, including on the pinned engine whose newer default otherwise retains them. Standalone sidecar retention/export remains approved backlog.

Incompatible mode/format changes clear unsupported chapter/caption/artwork switches. Native validation independently enforces the same combinations for commands, defaults and queue snapshots. Existing clips/exact stream IDs/browser choice remain source-specific, never defaults.

## Conversion, receipts and archive

`playback.rs` probes actual container/audio-stream title tags case-insensitively, chapter count, subtitle stream count/language tags and attached artwork. Up to1024 language inventory entries are retained in full; over-limit inspection refuses rather than silently losing available selections. New output receipts expose **Verified file extras** from ffprobe facts, not requested switches. Old receipts without these facts stay unknown; a default empty record is not fabricated as fresh verification.

Caption downloads stage Matroska and a private ≤512-byte, keys-only `media.caption-languages.txt` extractor receipt (`requested_subtitles` list conversion), containing no caption URLs. Missing selections use an explicitly invalid sentinel, not the engine's ambiguous `NA` (Nauru) default. The checked no-follow file handle is reused for the bounded read. The receipt remains eligible for Retry/Remove/import cleanup; the early unprefixed receipt name is also cleanable with the same non-link/regular-file checks.

Every requested language must be represented by the extraction receipt and actual stream identities/counts. ISO639-1/2 terminological/bibliographic aliases are normalized. The pinned engine incorrectly tags some three-letter source keys by their first two letters (`fil`→`fin`, `slo`→`slv`); these exact engine aliases are recognized only during receipt reconciliation, followed by a metadata-only `-c copy` remux to correct and reprobe the actual track language. Regional variants also receive persistent precise handler/title markers checked against their base-language tag. This correction runs even with compatible playback **off**, preserving codecs and exported/reopened regional identity. Synced atomic replacement applies only to the private working source, after checking tracks/languages/chapters/title/codecs/duration/size/cancellation. Unrelated preexisting captions and forged conflicting handler labels cannot satisfy a missing selection. This verifies extraction selection and track identity, not human semantic accuracy of caption text.

Compatible video normalization maps all subtitle streams through `mov_text`, preserves metadata/chapters, and rejects lost subtitle identities/counts/title or audio artwork before publishing/replacing private working input. Audio stream tags are additionally mapped into global output metadata so Ogg/Opus/Vorbis titles/artists survive M4A conversion. It never transcodes a Library original in place. Audio cover frames are excluded from playable-video codec classification. Audio trimming uses accurate input-side decoded seeking because output-side `-ss` drops the attached cover packet; video retains output-side re-encoding. Audio fixtures verify covers after MP3/M4A/FLAC trimming.

Saved defaults include the optional switches/languages. Independent duplicate archive identity includes metadata/chapter/artwork/caption/automatic-caption/language variants. Language order does not change identity. Old six-field archive variants still match extras-off jobs through backwards-compatible comparisons; no applied migration was changed. Queue reservations use the same output identity.

## Evidence

Checks: **69 focused frontend tests, 68 ordinary native tests, five explicitly opted-in installed-engine fixtures**, typecheck and diff checks. The five include existing poster, AV1/Opus preservation, synthetic loopback download/extraction, retained-byte pause/resume, plus the new embedding fixture. The current notice gate verifies413 native notices/eight source archives for aarch64-apple-darwin; this slice adds no dependency or distribution input, and the gate is not blanket redistribution rights.

`src-tauri/src/media_download/embedding_fixture.rs` creates only generated local lavfi video/audio, a JPEG, WebVTT and extractor JSON. Test-only file-URL permission and `--load-info-json` replace public-site extraction; production source validation is unchanged. It invokes the production option/postprocessor builder, process supervision and normalization with the existing installed yt-dlp/FFmpeg/ffprobe. It proves:

1. Manual English captions win over same-language automatic captions.
2. Automatic English captions are embedded when manual captions are absent and fallback is opted in.
3. Both survive actual Opus-to-AAC/H.264 MP4 normalization; extracting the final subtitle track yields the expected distinct text. Additional cases verify exact `pt-BR` identity through base-tag normalization and retained handler metadata, `fil`/`slo` actual corrected language tags, and codec-opt-out `pt-BR` after direct file reprobe. Title and two chapter tags persist; temporary VTT sidecars are absent.
4. MP3, M4A and FLAC covers/title survive actual 0.5–3.0s trim with measured duration near 2.5s.
5. Two source chapters `[0,2]` and `[2,4]` become `[0,1]` and `[1,2]` in a 1–3s video clip.
6. Opus and Vorbis stream-level title/artist tags survive real playable-M4A conversion; final container values are checked exactly.
7. Missing requested English is refused even with an existing Spanish subtitle track; missing requested Nauru is also refused with a preexisting `nau` track rather than accepting default `NA`. No MP4 is published in either refusal and source bytes remain identical. All other generated source bytes also remain identical.
8. Ordinary cleanup regression exercises both receipt filenames plus media/partial files through the shared cleanup helper used by Retry, Remove and import, including receipt-symlink refusal without touching other files. This is helper coverage, not native lifecycle/gesture acceptance.

Private reports, actual output media/probes, source snapshots and logs:
`~/.local/share/orion-proof/downloads-20261005-owner-feedback/p2-embedding-01/`.

Four nonpersistent background WK renders load actual React/theme CSS in Liquid/Ivory and 420px video/audio layouts, with seeded stores and native IPC/actions/model access blocked. Expanded controls have no horizontal overflow; a generated local poster decodes. These are UI-fixture renders, not native user gestures/dialogs, real source downloads, full-shell lifecycle, caption playback, audible output or owner visual sign-off. The first fixture wait incorrectly expected a queue bar even with no queued jobs; corrected to await the actual embedding controls. No owner-app activation/input.

## Open acceptance and backlog

Real site/EJS/caption/artwork availability, authenticated sources, native dialogs/default reopening, Library receipt cold reopening/full-shell failure races, actual caption selection/playback, broad chapter clipping shapes and owner visual/audible review remain unaccepted. Real-cookie/keychain testing still needs separate explicit owner test consent. Source artwork fetching follows extractor URLs and the existing unsandboxed process/network model; this is not a security sandbox or arbitrary hostile-link ingestion clearance.

Standalone sidecars/transcript search, remote row thumbnails, reusable/pre-download destinations, configurable large-file/work limits, richer Library actions, optional SponsorBlock and subscriptions/scheduling remain approved work. No blanket completion/parity claim.
