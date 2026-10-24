# Archives Downloads — optional SponsorBlock

Continuation of the approved Stacher-parity rebuild. This is a bounded feature slice, not whole-tool parity or real-site acceptance.

## Controls and privacy

- Default **Off**. Select **Mark chapters · keep all media** or **Remove segments · edits this copy** in the inspected source or future-link defaults. Saving/changing controls does not inspect or download anything. Queue/playlist jobs retain frozen options; old jobs/defaults stay off.
- YouTube videos only. Every lookup is an additional third-party request to **https://sponsor.ajay.app**, using the first four hexadecimal characters of the video ID's SHA256 hash and selected categories. Hash-prefix lookup is not anonymity: the service sees the request/IP and can correlate candidate video IDs. No browser cookies, model request, source-media upload or whole browser profile is sent to this service. Ordinary source downloading has its separate existing cookie consent rules.
- Inspection does not make the SponsorBlock lookup. It occurs only after explicit Download/Run authority. No configurable API URL/raw CLI field is exposed.
- Categories: sponsor, self-promotion, interaction reminders, intros, outros, previews/recaps, non-music sections, filler, hooks, highlight points and community chapters. Highlights/chapters can only be marked. Only sponsors are initially selected; aggressive filler is never silently selected.
- Marking embeds chapters into video or M4A. Removal supports video/audio but currently refuses source clip ranges and embedded captions instead of misapplying their timestamps. Marking can coexist with captions and clips; clipped markers must be rebased correctly.
- The two actions are mutually exclusive per job: mixed mark-some/remove-other category policies are not implemented. No new scene, transcript or SponsorBlock search UI is claimed.

## Native execution and verification

`src-tauri/src/media_download/sponsor.rs` validates literal distinct categories and native inspected source identity. `preferences.rs` includes enabled mode and sorted categories in the archive variant; order changes and Off-only unused categories do not create distinct outputs. Older missing variant fields match plain Off jobs. Source defaults never mutate existing queued snapshots.

The pinned engine's `--no-sponsorblock` is a **latched global disable**, not an ordinary last-flag-wins pair. It is emitted only in Off mode; positive modes have no negative flag. Generated installed-engine testing caught this difference before feature acceptance.

Positive modes use a native loopback gateway with a random per-operation path. Only the fixed production SponsorBlock origin and validated hash-prefix/category/action query are forwarded, without browser headers/cookies and without redirects. Native response bytes are bounded before JSON decoding; malformed successful responses (including `null`, `{}`, `false` or `0`), duplicate video-ID rows, excessive entries and HTTP failures are rejected instead of being misreported as empty. Off creates no gateway/network activity. Dropping the operation aborts the gateway task; this does not turn the downloader into a general network sandbox.

Before transfer, stale bounded receipt files are cleared only when they are regular, non-linked private files. A pre-download source-duration receipt and postprocessing segment/duration receipt are bounded and validated; missing/unsupported/error results are not silently reported as successfully removed segments. A valid empty/404 result keeps the whole file and reports zero segments. The per-job engine limits/cancellation and ordinary private publication/archive transaction remain in force.

Removal validates union-of-overlapping selected segment durations against both reported processed duration and the actual file probe, allowing bounded keyframe drift rather than claiming frame-accurate cuts. Marking validates source/processed/probed duration and compares category-specific merged interval coverage with actual chapter timestamps. After local compatible conversion or clipping, verification compares the complete expected clipped/rebased category timeline, not merely a chapter count. A finite final duration is mandatory and must stay within one second of the processed/post-clip span; the generic conversion tolerance (two seconds/one percent) cannot weaken this SponsorBlock check. Chapter titles contain literal category identifiers for unambiguous native verification. Files that cannot satisfy the checks remain working media rather than being falsely published as verified.

Existing owner originals are never edited. SponsorBlock modifies only new private downloads; local playable-copy recovery does not invoke the service or inherit its policy.

## Evidence and limitations

Private evidence: `~/.local/share/orion-proof/downloads-20261005-owner-feedback/p2-sponsor-01/`. Generated twelve-second H.264/Opus media and a loopback synthetic API exercise the real pinned engine and production normalization: Off makes zero lookup requests; marking embeds chapters; a 1–6s local clip rebases a 2–4s sponsor marker to 1–3s; removal creates approximately10s video and MP3; empty/404 responses keep the whole file; lookup failures, malformed scalar/object/duplicate-row and over256KiB responses, and unsupported extraction refuse; source bytes stay identical. The test enables file URLs and replaces only the service location inside a test-only private fixture. No Internet, credentials or owner content are required. This is not an OS network sandbox.

Passing gates: **76 focused frontend tests, 100 ordinary native tests, six opted-in installed synthetic fixtures**, typecheck, notices (413native/8sourcearchives), and diff checks. Thirteen gateway tests include structural/byte bounds, valid/404 paths, latched failure despite later success, incoming credential/header suppression, no redirects and Drop cancellation; durations/merged-marker/duplicate-row regressions are covered separately.

Six seeded-store, blocked-IPC nonpersistent background WK renders cover Liquid/Ivory/420px source/default controls. They prove rendered UI/theme layout, not actual native dialogs, source transfer, chapter player behavior or owner acceptance. Community annotations can be wrong/missing; codecs/keyframes may affect cuts. Actual live YouTube/SponsorBlock service compatibility, EJS/authentication, audible/chapter playback, owner visual review and whole-shell race/fault acceptance remain open. Standalone sidecars/search, remote thumbnails, reusable/pre-download destinations and subscriptions/scheduling remain approved separate backlog.
