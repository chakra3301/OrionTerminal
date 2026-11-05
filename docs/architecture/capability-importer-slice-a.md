# Orion Intake — Slice A implementation receipt

2026-09-16. Owner approved Slice A after the [Phase 0 plan](capability-importer-phase0.md). **Code and focused tests complete; native UI/owner smoke acceptance pending.**

**Subsequent owner request implemented:** [Incubator app + public GitHub link intake](incubator-repository-intake.md), retaining Settings and one shared staged collection. The local-only description below records the original Slice A boundary. Installation/activation is still not implemented or implicitly approved.

## Delivered

Control Panel → Skill Codex now includes **Local skill intake**:

1. Choose a physical local skill folder, directory of skill folders, or repository with `skills/`.
2. Select one discovered `SKILL.md` entrypoint. Root LICENSE/NOTICE files are explicit opt-in selections; standalone skill folders never read their parents.
3. Inspect the bounded subtree without execution. Review preserved bytes, original entrypoint, source/candidate SHA-256, directory-name adapter, tool requests (never grants), warnings and escaped resource previews.
4. **Keep staged snapshot** writes immutable candidate metadata and resource BLOBs atomically to SQLite. It does not create an installed `skills` row.
5. Reopen/reload the staged collection, read resources, or **Discard snapshot**. Up to four candidates; no automatic eviction, install, update, activation, upload or script execution.

The directory adapter uses the declared skill name as the candidate root, preserves original paths in the manifest and does not rewrite instruction bytes. Explicit root attribution is copied into `__orion_attribution/` inside that root. This is a disclosed packaging adaptation, not a claim the upstream directory already meets the Agent Skills naming rule.

## Code map

- `src-tauri/src/intake/{mod,safe_dir,frontmatter,tests}.rs`: pinned-descriptor discovery/inspection, restricted frontmatter parser, local snapshots, measured hashes/warnings, transactional staging, read/discard and tests.
- `src-tauri/migrations/0030_skill_intake_staging.sql`: append-only candidate/file tables. No changes to prior migrations, hand-authored skill IDs or agent records.
- `src/features/intake/{contracts,api,SkillIntakePanel}.ts[x]`, `skillIntake.css`: strict v1 native response parsing, Skill Codex review and stale-callback cleanup. Existing Control Panel typography, tokens and soft radii; no imported taste rules applied to Orion's own chrome.
- `src/store/skillsStore.ts`: ordered durable-before-visible save/remove/load, immutable save snapshots, failed-load write blocking without replacing existing data. Existing skill composition unchanged.
- `src/features/controlpanel/SkillEditor.tsx`: await successful save/delete before closing; keep drafts/errors on failure and prevent duplicate in-flight writes.

## Implemented boundary and deliberate limits

- Native discovery opens the selected root component-by-component with `openat`, no-follow/directory/close-on-exec flags; enumeration uses the pinned descriptor. Child reads remain relative to pinned directory descriptors, including after root-path substitution. No source scripts/hooks/submodules/dev servers are launched.
- macOS implementation and filesystem tests passed. A Linux-specific ABI/flag branch exists but has **not** been exercised; other platforms fail closed. Symbolic links in picker paths are rejected (choose the physical directory). No external sandbox claim.
- Package-relative paths are an intentionally restricted **ASCII** subset, maximum 240 bytes, without traversal, control characters, Unicode normalization ambiguity, trailing spaces/dots or case-fold collisions. Root labels may be Unicode, bounded to 240 bytes. Selected symlinks, hardlinks and special files are rejected; executable source modes are recorded but candidate modes normalize to non-executable regular files.
- Limits: 128 files, 256 walked entries, depth 8, 8 MiB/package; SKILL.md 128 KiB, frontmatter 16 KiB, other files 1 MiB, text preview 256 KiB. Directory enumeration caps at 512 entries; discovery caps at 64 skill entrypoints. Four staged candidates imply at most 32 MiB of staged bytes. Installed/retained-version storage is not implemented yet, so the proposed later 128 MiB installed quota is not an active subsystem.
- Four live discovery handles and four live previews, each expiring after 15 minutes and released on replacement/unmount. Cooperative 10-second discovery/walk checks bound normal traversal; a blocked OS filesystem syscall is not forcibly interruptible. **Cancel inspection** invalidates callbacks and releases late handles; it does not terminate an already-blocked syscall. Inspection never writes persistent candidates. An explicitly requested staging transaction can complete after unmount; reload reconciles it.
- Restricted frontmatter: known scalar string fields plus a bounded string-to-string metadata map; plain strings, JSON-compatible double quotes and YAML single quotes. Duplicate/unknown authority-bearing fields, anchors/tags/merge keys and complex/multiline YAML fail with an unsupported-syntax error. No YAML dependency added; this is **not full Agent Skills YAML compatibility**.
- Secret-risk rules cover specific credential filenames, private-key markers and selected token prefixes. A match aborts inspection without displaying/persisting the matched value. False positives are possible; inspect a separately reviewed/redacted local copy. Binary/obfuscated secrets, malware, dependencies/advisories, license obligations and functional behavior remain unknown/unverified. No AI assessment was added.
- Scripts, code, HTML/SVG and opaque resources remain bytes. Preview is React text inside `<pre>`, never raw HTML/Markdown with remote image loading. Binary resources can be preserved but have no decoder/execution path. Manifests/lockfiles trigger a dependency-scan-not-run warning.
- The actual implemented v1 contract is the local discovery/candidate/resource snapshot DTO, with strict native/TS parsing and a review-bound candidate ID/hash. The broader Phase 0 AnalysisEvidence/IntegrationPlan/upload-consent contracts remain design proposals until their consuming analyzer/activation slices; no unused authorization service or parallel install registry was scaffolded.

## Hash and persistence semantics

Manifest v1: SHA-256 of `orion-skill-manifest-v1\0`, then records sorted by UTF-8 path bytes; each record is little-endian u32 path byte length, path bytes, little-endian u64 content byte count, 64 ASCII lowercase hex SHA-256 bytes, little-endian u32 Git-style regular-file mode. Source manifests use original relative paths and normalized `100644`/`100755` source modes; candidate manifests use mapped paths and `100644`. File contents have independent SHA-256 checks. Git revision is intentionally absent for a local snapshot.

Preview holds immutable native bytes; subsequent source edits do not alter the approved candidate. Stage uses `BEGIN IMMEDIATE` and one transaction for metadata/all files, checks quota and existing collection integrity, and is idempotent by host-generated candidate ID plus artifact hash. Failed file inserts roll the entire candidate back. Ambiguous commit responses can be reconciled by reloading or retrying the same ID/hash. Removal is transactional. Unknown/corrupt stored records block collection loading/new staging instead of being replaced.

Every persisted read checks version, bounded JSON/file sizes, IDs, manifest consistency and content hashes. Package BLOBs live in the normal SQLite DB, so they are within its existing backup content boundary; **no packaged backup/restore UI acceptance was performed**. No installed-version pointer or agent attachment is added until Slice C.

## Focused verification

- **43 frontend tests passed** across Intake contracts/UI, skill-store persistence, SkillEditor retry/close, and existing composeAgent/resolveSend tests; TypeScript check passed.
- **21 focused native tests passed** (20 ordinary tests plus explicitly opted-in real fixture test). Covers restricted YAML/authority, 87 KB input, attribution/discovery, resource preservation, mode/hash test vector, path/root/intermediate substitution, symlinks/hardlinks/FIFO, bounds/collisions, credential hints, failed transaction/retry, idempotency, corrupt collection, quota and database reopen.
- The real fixture test read the already-fetched Phase 0 source at revision `e79ca9ec7e071eb3a3b623c4fb752e853fc3ed58`: current taste instructions hash `aa194351…`, Stitch `DESIGN.md` hash `0ab6740c…`, plus root LICENSE. Both staged/read back byte-identically in an **in-memory test DB**. The generic resource fixture separately proved a temporary on-disk SQLite close/reopen. No claim of real packaged app restart from these tests.
- UI tests prove no staging on folder selection, explicit hash-bound staging, escaped source display, failed staging/discard retry, blocked failed hydration, cancelled/stale picker/discovery and late unmount results.
- No broad suite, production/native bundle build, browser automation, live provider request, third-party execution, dependency install, account operation, production DB/app replacement, commit or release. The updated native commands/migration require a rebuilt/restarted test binary before UI use.

## Owner smoke / next boundary

Use an updated **non-production test binary/profile**:

- Skill Codex → choose the local taste repository → select current taste and explicitly include LICENSE → inspect adapter/87 KB text → keep staged snapshot.
- Stage sibling Stitch + LICENSE → open `DESIGN.md` and check resource text. No external Stitch connection should appear.
- Restart the test app, reopen both staged candidates/resources, discard one, and verify existing hand-authored skills/agents remain unchanged.
- Confirm restrained chrome and readable previews across the retained themes. This is required before marking Slice A accepted.

Next ranked work after acceptance/approval: **Slice B pinned public GitHub acquisition**, then **Slice C install + Agent Forge/plain-model activation**. RepoLens/Ripper integration, general local execution and missing stock/image-to-3D/Ripper fixture gates remain deferred. No new dependencies are needed by Slice A.
