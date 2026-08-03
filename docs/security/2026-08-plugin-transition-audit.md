# Plugin-transition security audit

Date: 2026-08-03  
Status: active  
Scope: Tauri/webview boundary, custom IPC, generated and remote content, filesystem/process/network access, AI agents, plugin threat model, and dependency health

## Security objective

Platformization must reduce authority, not merely add a plugin loader. Orion currently operates as one trusted frontend with broad native powers. That is acceptable only while every script in the webview is trusted. Generated HTML, remote content, AI-driven actions, and future community plugins invalidate that assumption.

The target is capability-based authority: an untrusted surface can request a narrow operation, but it cannot reach Tauri, SQLite, secrets, files, processes, or another plugin directly.

## Threat actors and untrusted inputs

- Generated HTML, JavaScript, SVG, and model-authored Markdown
- Imported notes, assets, repositories, and websites
- Prompt injection inside any content sent to an agent
- A buggy or malicious community plugin
- A compromised plugin update or publisher
- Malicious network responses and redirects
- Another local process attempting to reach localhost bridges

A same-user process with unrestricted filesystem access is outside the primary sandbox threat model, but Orion still avoids publishing reusable secrets or unauthenticated control ports.

## Findings

### OTSEC-001 — Generated HTML has shell-origin script authority

Severity: **Critical**  
Status: fixed in working tree; Tauri UI verification pending

`src/apps/xdesign/HtmlArtifactPreview.tsx` previously rendered model-generated HTML with:

```html
sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
```

For a `srcDoc` frame, `allow-scripts` plus `allow-same-origin` lets generated script share the application's origin. The parent intentionally reads `contentDocument`, confirming same-origin access. Tauri injects its IPC runtime into the application webview, and the main window registers broad custom commands. A generated page must therefore be treated as potentially able to attack shell state and native authority, not merely navigate its own frame.

Applied remediation:

- Preview sandbox is now exactly `allow-scripts`, producing an opaque origin with no forms, popups, modals, or same-origin authority.
- All generated inline scripts are moved to revocable blob URLs; external scripts are removed.
- A frame-local CSP denies network connections, frames, objects, forms, and base rewriting.
- Editing, selection snapshots, persistence, navigation requests, and canvas recording use a versioned `postMessage` bridge.
- Parent validates `event.source`, channel/version, schemas, paths, URLs, string sizes, and video size before handling a message.
- External links require a host confirmation, persist messages are accepted only during an editing grant, and recording results must match a pending user request.
- Regression tests lock the sandbox, CSP, script transformation, RPC validation, and size/type restrictions.

Remaining verification: run static and motion artifacts in the bundled Tauri webview, exercise editing/video export, and confirm an adversarial artifact cannot reach `parent.document` or Tauri IPC.

### OTSEC-002 — Application CSP is disabled

Severity: **Critical**  
Status: fixed in working tree; packaged-app verification pending

`src-tauri/tauri.conf.json` previously set `app.security.csp` to `null`. A successful HTML/script injection therefore had no defense-in-depth barrier.

Applied remediation:

- Production and development CSPs now define explicit defaults for IPC, assets, images/media, fonts, workers, frames, styles, and Hugging Face model downloads.
- Inline shell scripts remain forbidden; objects, base rewriting, and form actions are denied.
- Blob scripts are allowed for the isolated preview and blob workers.
- `unsafe-eval` is temporarily retained because the currently locked `onnxruntime-web` bundle contains eval-based runtime code; Vite reports the exact dependency during build. Removing it is tied to the Transformers/ONNX dependency remediation rather than silently breaking local embeddings.
- Tests assert the production policy exists, blocks inline scripts, and denies objects/base rewriting.
- A full Tauri debug build validates the configuration.

Remaining verification: launch the packaged app, test embeddings/model download, Monaco workers, asset/media rendering, Spotify artwork, Orion web preview, and inspect CSP violation logs. CSP does not replace iframe isolation or capability checks.

### OTSEC-003 — Native commands assume the entire frontend is trusted

Severity: **High** today; **Critical** before community plugins  
Status: architectural remediation required

The main webview registers 100+ custom commands, including arbitrary workspace reads/writes/deletes, terminal input, process-backed agents, provider calls, and secret-setting operations. `capabilities/default.json` also grants broad SQL and opener access.

These commands are necessary for the first-party workstation but cannot be inherited by plugin UI.

Required fix:

- Community UI must run in a separate opaque origin with no Tauri IPC object.
- Introduce a native capability broker keyed by plugin identity and stored grants.
- Commands exposed to plugins accept broker-issued resource handles, not arbitrary host paths or key references.
- Keep the existing broad IPC facade private to the trusted compatibility layer while first-party migration proceeds.
- Add audit events for privileged plugin actions.

### OTSEC-004 — Embedded agents bypass permission prompts

Severity: **High**  
Status: open

Several Claude subprocess paths use `--permission-mode bypassPermissions`. Chat agents retain built-in Bash/Read capabilities while consuming notes, repositories, websites, and other prompt-injectable content. Disallowing Edit/Write alone does not prevent destructive shell commands or data exfiltration.

Required fix:

- Define per-surface agent capability profiles.
- Prefer Orion-owned MCP tools with validation and review over broad built-in Bash/filesystem tools.
- Treat retrieved content as untrusted data in system prompts and tool policy.
- Require confirmation for destructive, secret-bearing, external-network, and process actions.
- Apply permissions at tool execution; model tool visibility is not authorization.

### OTSEC-005 — Frontend dependency audit is not clean

Severity: **High**  
Status: open

`npm audit --omit=dev` reports 14 advisories: 1 critical, 5 high, and 8 moderate.

Primary chains:

- `@xenova/transformers` → `onnxruntime-web` → `onnx-proto` → vulnerable `protobufjs`
- `@xenova/transformers` → vulnerable `sharp`
- Monaco → pinned vulnerable `dompurify`
- Cursor SDK → Connect → vulnerable `undici`
- BlockNote → vulnerable `uuid`

Some automated recommendations are unsafe downgrades or have no upstream fix. Do not run a blind force fix.

Required fix:

- Establish reachability for each chain.
- Update direct packages where compatible.
- Test narrow overrides only where upstream semver/API compatibility is proven.
- Isolate model parsing from untrusted model files until the protobuf chain is patched.
- Add `npm audit --omit=dev` to the release checklist with reviewed temporary exceptions that include owner and expiry.

### OTSEC-006 — URL-to-brand fetch allowed SSRF and unbounded buffering

Severity: **High**  
Status: fixed in working tree; verification pending

`src-tauri/src/xdesign_web.rs` accepted arbitrary HTTP(S) targets, followed redirects automatically, and buffered the full body before applying its nominal 2 MB cap. This could reach loopback/private services and exhaust memory.

Applied remediation:

- HTTP(S)-only URL parsing with credential rejection and length cap
- DNS resolution and rejection of private, loopback, link-local, multicast, documentation, and reserved addresses
- Redirects disabled at the client and revalidated manually per hop
- Resolved public addresses pinned into each request client
- Streaming response cap enforced before allocation grows past 2 MB
- Pure tests for IPv4, IPv6, mapped addresses, schemes, and credentials

### OTSEC-007 — MCP configuration contained bridge capability in an ordinary file

Severity: **Medium**  
Status: fixed in working tree; verification pending

`orion-mcp.json` contains the launch-scoped UI bridge token and may also contain user MCP environment configuration. It was written with default filesystem permissions and non-atomically.

Applied remediation:

- Unique temporary file
- mode `0600` on Unix
- flush/sync then atomic rename
- final permission repair for previously broad files
- replacement and mode regression test

### OTSEC-008 — UI bridge had a predictable Windows token fallback

Severity: **Medium**  
Status: fixed in working tree; verification pending

The bridge used `/dev/urandom`; on Windows it fell back to a timestamp-derived token. The crate already depends on the cross-platform `getrandom` implementation.

Applied remediation:

- 256-bit token from `getrandom::getrandom`
- bridge startup fails closed if the OS RNG fails
- no predictable fallback
- length, format, and uniqueness regression test

### OTSEC-009 — Provider execution can become a credential confused deputy

Severity: **High** before untrusted code  
Status: open

Provider runtime calls accept a frontend-supplied `base_url` and `key_ref`. Rust reads the secret and sends it to the selected endpoint. A future plugin—or a compromised trusted webview—must not be able to pair another provider's key reference with an attacker-controlled URL.

Required fix:

- Store credential binding metadata in the native broker.
- Resolve endpoint and key together from one opaque provider handle.
- Do not accept raw key references from community plugin RPC.
- Require explicit user approval when a provider's credential origin changes.
- Restrict custom-provider network permission to approved origins.

### OTSEC-010 — File and byte ingestion lacks consistent resource limits

Severity: **Medium**  
Status: open

Some commands cap reads, but asset copy and bytes-in paths can allocate or accept arbitrarily large payloads. Recursive tree/search/watch operations also need broker-level quotas before plugins can request them.

Required fix:

- Stream copied assets instead of reading the entire file.
- Set per-operation and per-plugin limits.
- Cap tree depth, result counts, payload size, concurrent watches, and background tasks.
- Reject special files and re-check symlink/canonical path boundaries at execution time.

### OTSEC-011 — Release builds include Tauri devtools support

Severity: **Low/Medium**  
Status: open

The Tauri dependency enables the `devtools` feature. Orion has an intentional development command, but production bundles should not expose debugging authority accidentally.

Required fix:

- Separate development and release feature sets or gate the command to debug builds.
- Verify the packaged personal build cannot open devtools unless explicitly intended.

### OTSEC-012 — Rust dependency audit is not clean

Severity: **High**  
Status: open

`cargo audit` reports 6 vulnerabilities plus unmaintained/unsound/yanked warnings. Reported vulnerable packages include `crossbeam-epoch`, `quick-xml`, `quinn-proto`, `rsa`, `sqlx`, and transitive warnings such as `anyhow` and `event-listener`. Some are target-specific or transitive through Tauri/plugin crates; that affects reachability, not the need to track them.

Required fix:

- Update patch-compatible locks first.
- Map target-specific chains with `cargo tree --target all`.
- Upgrade Tauri plugins where necessary to move `sqlx`.
- Record reviewed exceptions with affected target, reachability, owner, and expiry.
- Gate release on `cargo audit` with explicit exceptions rather than silently ignoring failures.

## Existing positive controls

- Secret values are stored in the OS keyring rather than React state/SQLite.
- The localhost UI bridge uses a per-launch shared token and loopback-only listener.
- Storage-specific deletion commands canonicalize and scope paths.
- General text file reads and several media reads have size caps.
- Atomic editor saves are preserved.
- Hermes Markdown escapes model output before generating HTML.
- Archives search highlighting escapes database content before adding `<mark>` tags.
- Per-window error boundaries reduce crash propagation.

## Plugin security invariants

1. A plugin identity is assigned by the host, never claimed by runtime code.
2. Package validation happens before execution.
3. Unknown manifest fields that affect authority fail closed.
4. UI sandboxes never inherit the shell origin or Tauri IPC.
5. Permission checks happen at execution, not only installation.
6. Files are represented by granted handles/scopes, not arbitrary paths.
7. Credentials are opaque handles bound to approved provider origins.
8. Network redirects are re-authorized.
9. AI tool calls pass through the same broker as human actions.
10. Every registration and background task has an owner and disposable lifecycle.
11. Disable prevents activation; quarantine prevents startup loops.
12. Update permission changes require review before new code activates.
13. Plugin data and code are separately removable.
14. Core database migrations remain host-owned and append-only.
15. Safe mode works without loading third-party code.

## Ranked remediation plan

### Security slice A — immediate hardening

- Verify and land OTSEC-006, OTSEC-007, and OTSEC-008.
- Add dependency audit scripts/reporting without force-upgrading.

### Security slice B — isolate generated content

- Build the opaque-origin XDesign preview bridge.
- Add adversarial HTML fixtures.
- Introduce and tune production CSP.
- Re-test visual editing, navigation, canvas animation, video export, and HTML export.

### Security slice C — privilege architecture

- Introduce plugin identity, grants, resource handles, and native capability broker.
- Bind provider credentials to origins.
- Make registries owner-aware and auditable.

### Security slice D — AI authority

- Inventory every agent surface and its current tools.
- Replace broad bypass profiles with least-privilege profiles and confirmations.
- Add prompt-injection regression scenarios.

### Security slice E — supply chain and limits

- Resolve reachable npm and Cargo advisories.
- Add file/network/task quotas.
- Separate devtools from release.
- Add signed package and update verification before marketplace work.

## Release gates for community plugins

Community plugin loading remains disabled until:

- OTSEC-001 and OTSEC-002 are closed and human-smoke-tested in the bundled app.
- Community frames cannot invoke Tauri in an adversarial test.
- Native broker tests prove deny-by-default behavior.
- Safe mode and quarantine are human-smoke-tested.
- Package traversal, zip-bomb, signature, downgrade, dependency-cycle, and permission-diff tests pass.
- Dependency audit exceptions are documented and time-bounded.
