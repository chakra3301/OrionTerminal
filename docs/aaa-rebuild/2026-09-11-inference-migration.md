# Approved licensing and local-inference migration — 2026-09-11

**Original-work licensing is settled. The critical npm finding is removed. The whole release is not yet cleared.** Continuation of [release closure](2026-09-11-release-closure.md).

## Owner decisions applied

The owner delegated the license recommendation, confirmed they created all bundled GLBs in response to the redistribution question, and approved the recommended inference-library migration.

- **Apache-2.0** for original Orion Terminal code and creator-owned models in `public/characters/` and `public/companion/`.
- Root `LICENSE` and `NOTICE`, npm/Cargo license metadata, README, and model-subsystem attribution updated. Root licenses/notices ship in the app.
- Third-party software/adaptations retain their own terms. User-imported content is not relicensed. Cursor SDK redistribution, comprehensive notices, and exact older derivative provenance still need review.

## Runtime migration

`@xenova/transformers` 2 was replaced by pinned **`@huggingface/transformers` 4.2.0**. Model IDs remain `Xenova/all-MiniLM-L6-v2` and `Xenova/whisper-tiny.en`; the new API uses `dtype: "q8"` and explicit `device: "wasm"`.

`src/lib/inferencePipelines.ts` owns model options. `transformersEnv.ts` configures the environment per worker realm. Vite resolves ONNX assets through Transformers' own dependency, emitting the matching Safari-compatible `.mjs` factory and `.wasm` with hashed filenames. The runtime no longer depends on CDN executable downloads. Single-threaded WASM avoids a cross-origin-isolation requirement; model files still download from Hugging Face and use the browser Cache API where available. Model weights are not bundled.

The upstream package pins ONNX Web `1.26.0-dev.20260416-b7804b056c`; this is not represented as an independent stable ONNX release. ONNX's MIT license and third-party notices, plus Hugging Face license texts, are retained and packaged.

### Real inference found migration defects

1. ONNX's extended optimizer rejected Whisper's older merged q8 decoder: `TransposeDQWeightsForMatMulNBits Missing required scale ...`. Whisper uses **basic graph optimization**, retaining its existing weights rather than silently switching precision/model.
2. Transformers 4 rejects `task`/`language` overrides for English-only Whisper. The worker calls this English model without those overrides.
3. ONNX's realm-wide initialization/inference promise chains can remain rejected after failure. `InferenceClient` terminates failed workers, rejects pending work, clears readiness, and starts a fresh realm on retry. It also handles startup/postMessage failures, crashes, malformed-message events, timeouts, and stale replies. Both embedding and speech inference now stay off the UI thread. Wake-word prewarming now actually loads the speech model.
4. Vite's default IIFE worker format cannot code-split dynamic imports. Workers now emit ES modules. Dependency scanning is confined to the application entry, avoiding unrelated landing-page dependencies, and raw ONNX asset imports are excluded from prebundling.

### Packaged testing found a pre-existing vector-storage defect

SQLite's array parameter binding produces **JSON TEXT**, even in the declared BLOB column. Existing readers treated that string as byte-array input and could silently create empty vectors. `vectorStorage.ts` now accepts bounded, validated JSON byte arrays as well as legacy binary/array values. `db.ts` normalizes both archive and codebase rows, skips malformed vectors, and writes explicit JSON text. Existing valid rows are recoverable without deletion or schema changes; prior migrations were not edited.

## Evidence

Latest `npm run verify`: **exit 0** (`/tmp/orion-release-closure/verify-inference-storage.log`).

| Gate | Result |
|---|---|
| TypeScript / Vite production build | passed |
| Frontend | **166 files / 1,072 tests passed** |
| Node contracts | **8 passed** |
| Rust | **178 passed / 1 ignored** |

New contracts cover runtime options, environment initialization/retry, worker failure recovery, and stored-vector normalization. Scoped dependency overrides use **sharp 0.35.4** and **adm-zip 0.6.1**; real Node contracts verify PNG creation/metadata/resize, ZIP decoding, and rejection of extraction through a destination symlink.

**Browser execution, not mocks:** production-built embedding and speech workers ran in Chromium with the configured production CSP. Three embedding outputs were finite, normalized **384-dimensional** vectors; related-sentence cosine was **0.65027**, versus **−0.05290** for the unrelated sentence. Whisper transcribed locally synthesized audio as **“the quick brown fox jumps over the lazy dog.”** No microphone recording, private speech, or paid provider call was needed. Representative cold runs were approximately 3 seconds per model, including loading; these are observations, not latency guarantees. Development HMR websocket errors were separate from inference; the production-built worker run passed.

**Actual packaged WebView:** a separately identified validation `.app` built and passed ad-hoc signature verification. A new note entered through its UI produced a persisted vector with **384 dimensions**, norm **1.00000004**, and a fresh timestamp. Readonly inspection of that row exposed the JSON-text storage mismatch above. Production account/data were not reset or used for test edits.

**Native semantic-only retrieval passed after the storage fix:** created a second note, `Kitten`, with body `A kitten rests on a rug.` through the rebuilt validation UI. Spotlight query **`A cat sits on a mat`** returned that note. The same query's exact FTS expression returned **zero** rows in a readonly database check, confirming this was semantic retrieval rather than a keyword hit. Screenshot: `storage-semantic-hit.png`; evidence: `native-semantic-retrieval.json`. The validation app closed normally, and temporary test servers were stopped.

Browser speech inference is verified; packaged microphone/recording/wake-word acceptance and full offline/recovery tests are not claimed.

Private evidence: `inference-production-result.json`, `inference-native-result.json`, `transformers-contracts.log`, verification/build logs, and screenshots under `/tmp/orion-release-closure/`. Temporary browser scripts use an already-installed Playwright; no new browser-testing package was added to the application.

## Remaining release gates

- Production npm audit: **0 critical / 2 high**, both in the **PPTXGenJS → image-size** chain. Latest image-size 2.0.2 remains affected; no force-downgrade or blanket advisory ignore was applied. Release CI now blocks **high or critical** production findings so the remaining issue is not quietly released.
- Fresh `cargo audit --json` still exits **1** (`inference-cargo-audit.json`): rsa plus separately reported unsoundness/maintenance warnings remain. Authority/credential-origin isolation is still open; this migration does not certify it.
- Standalone Cursor SDK installation/distribution, complete app/provider workflows, normal-product app/DMG acceptance, remote CI, and remaining third-party licensing/provenance work remain open.
- Normal production bundle was not replaced during isolated testing. Existing WIP remains preserved and uncommitted.

Final bounded secret-pattern rescan: **2,057 historical blobs / 2,931 text versions, zero matches, 127 binary/large versions skipped**. This is not comprehensive credential/personal-data clearance. Report links/IDs and license metadata checks passed; `git diff --check` was clean. Final machine-readable handoff: `/tmp/orion-release-closure/inference-closure-summary.json` (`releaseSignedOff: false`).
