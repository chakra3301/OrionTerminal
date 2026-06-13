# RepoLens → Archives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **RepoLens** section to the Archives app — paste a GitHub/GitLab/npm/PyPI repo, get an AI "should I adopt this?" briefing (core scan) plus on-demand Deep Dive / SKTPG / Synergies lenses, with per-feature model + tone switching, a saved library, and Markdown export.

**Architecture:** Pure logic ports from the friend's JS (`/Users/lucaorion/Downloads/repolens-main`) to TypeScript (testable Vitest units). Rust stays thin: one `claude -p --output-format json` subprocess command + two `reqwest` fetchers + a keychain GitHub-token. Persistence is one SQLite table (migration 0021). UI is a new `repolens` Archives view (darker-green accent).

**Tech Stack:** Tauri 2 + React 19 + TypeScript + Zustand (frontend), Rust + tokio + reqwest + keyring + tauri-plugin-sql (backend), Vitest (tests). Source of truth for prompts/parsers: `repolens-main`.

**Reference convention:** "Port `repolens-main/X.js` verbatim" = copy the file's logic exactly (it is already ESM with `export`), changing only what each task specifies (TS type annotations, `atob` → the noted helper). The prompts and validation allow-lists are tuned — do not reword them.

**Commands used throughout:**
- Types: `npx tsc --noEmit`
- A single test file: `npx vitest run <path>`
- All frontend tests: `npx vitest run`
- Rust: `cd src-tauri && cargo check` / `cargo test`
- Build: `npm run build`

---

## File structure

```
src/apps/archives/repolens/
  types.ts                  # RepoData, RepoAnalysis, lens result + config types
  detect.ts                 # url/owner-repo → {platform, repoId}        (port url-detector.js)
  taxonomy.ts               # capability vocab + normalize/derive          (port taxonomy.js)
  tone.ts                   # tone preamble                                (port tone.js)
  models.ts                 # PARTS + RepoLensModelConfig + modelFor
  verdict.ts                # deriveFit/firstSentence/verdictCopyText      (port verdict.js)
  prompt.ts                 # core buildPrompt                             (port prompt.js)
  parser.ts                 # parseClaudeResponse                          (port parser.js)
  lenses.ts                 # deepdive/sktpg/synergies prompt builders + parsers
  export.ts                 # toMarkdown                                   (port exporter.js, md only)
  claude.ts                 # serialized AI call queue → ipc.repolensClaudeCall
  fetch.ts                  # ipc.repolensFetchRepo / fetchSource wrappers
  repolensDb.ts             # migration 0021 CRUD
  useRepoLens.ts            # zustand store
  RepoLensView.tsx          # the Archives view (scan bar + library/report switch)
  RepoLensLibrary.tsx       # library grid
  RepoLensReport.tsx        # renders a RepoAnalysis (all core sections)
  lens/DeepDivePanel.tsx
  lens/SktpgPanel.tsx
  lens/SynergiesPanel.tsx
  *.test.ts                 # vitest for the pure modules

src-tauri/src/repolens.rs       # 3 commands + structs + github-token read + selectKeyFiles
src-tauri/migrations/0021_repolens.sql
```

**Modified files:** `src-tauri/src/lib.rs` (mod + migration + handler), `src-tauri/src/api_key.rs` (add github-token commands), `src/lib/ipc.ts` (5 new calls), `src/apps/archives/useArchives.ts` (view union), `src/apps/archives/ArchivesApp.tsx` (nav + view host), `src/styles/tokens.css` (accent + `.rl-*`), `src/features/settings/SettingsPanel.tsx` (token field).

---

# PHASE 1 — Walking skeleton (GitHub core scan, end-to-end)

Goal of the phase: paste a GitHub repo → full core report renders. **Requires a `tauri dev` restart at the end** (new Rust module + migration).

## Task 1: Rust — GitHub token in the keychain

**Files:**
- Modify: `src-tauri/src/api_key.rs`

- [ ] **Step 1: Add a generic entry + github-token commands**

Append to `src-tauri/src/api_key.rs` (keeps the existing anthropic key untouched, adds a second keychain account):

```rust
const GITHUB_ACCOUNT: &str = "github-token";

fn github_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, GITHUB_ACCOUNT).map_err(|e| {
        format!("Secret storage unavailable — is your OS keyring running? ({})", e)
    })
}

/// Read the stored GitHub token, if any. Used by the repolens fetchers to
/// raise GitHub's 60 req/h unauthenticated limit to 5000 req/h.
pub fn github_token() -> Option<String> {
    match github_entry() {
        Ok(e) => match e.get_password() {
            Ok(s) if !s.trim().is_empty() => Some(s),
            _ => None,
        },
        Err(_) => None,
    }
}

#[tauri::command]
pub fn github_token_set(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("github token is empty".into());
    }
    github_entry()?.set_password(token.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn github_token_clear() -> Result<(), String> {
    let e = github_entry()?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn github_token_status() -> Result<bool, String> {
    Ok(github_entry().ok().and_then(|e| e.get_password().ok()).map(|s| !s.trim().is_empty()).unwrap_or(false))
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles (warnings about unused `github_token`/commands are fine until registered in Task 4).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/api_key.rs
git commit -m "feat(repolens): github token keychain entry + set/clear/status commands"
```

## Task 2: Rust — repolens module (claude call + fetchers + selectKeyFiles)

**Files:**
- Create: `src-tauri/src/repolens.rs`

- [ ] **Step 1: Write the failing test for `select_key_files`**

Create `src-tauri/src/repolens.rs` with ONLY the priority list, the function, and its test first:

```rust
const PRIORITY_FILES: &[&str] = &[
    "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "requirements.txt",
    "setup.py", "pom.xml", "build.gradle", "composer.json", "Gemfile",
    "src/index.ts", "src/index.js", "src/index.tsx", "index.ts", "index.js",
    "src/main.ts", "src/main.js", "src/main.py", "main.py", "app.py",
    "src/lib.rs", "src/main.rs", "main.go", "src/app.ts", "src/App.tsx",
];
const MAX_KEY_FILES: usize = 8;
const CODE_EXT: &[&str] = &["ts","tsx","js","jsx","py","rs","go","java","rb","php","c","cc","cpp","h","hpp","kt","swift"];

fn is_code(path: &str) -> bool {
    path.rsplit('.').next().map(|e| CODE_EXT.contains(&e.to_lowercase().as_str())).unwrap_or(false)
}

/// Pick the most revealing files present in the tree: priority list first, then
/// shallow (depth ≤ 2) source files. Mirrors deepdive.js selectKeyFiles.
pub fn select_key_files(paths: &[String]) -> Vec<String> {
    let set: std::collections::HashSet<&str> = paths.iter().map(|s| s.as_str()).collect();
    let mut picked: Vec<String> = Vec::new();
    for p in PRIORITY_FILES {
        if set.contains(p) && !picked.iter().any(|x| x == p) {
            picked.push((*p).to_string());
        }
        if picked.len() >= MAX_KEY_FILES { return picked; }
    }
    let mut shallow: Vec<&String> = paths.iter()
        .filter(|p| is_code(p) && p.split('/').count() <= 2 && !picked.iter().any(|x| x == *p))
        .collect();
    shallow.sort_by(|a, b| a.split('/').count().cmp(&b.split('/').count()).then(a.len().cmp(&b.len())));
    for p in shallow {
        picked.push(p.clone());
        if picked.len() >= MAX_KEY_FILES { break; }
    }
    picked
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prioritizes_manifests_then_shallow() {
        let paths = vec![
            "README.md".into(), "package.json".into(), "src/index.ts".into(),
            "deep/nested/thing.ts".into(), "util.ts".into(),
        ];
        let picked = select_key_files(&paths);
        assert_eq!(picked[0], "package.json");
        assert!(picked.contains(&"src/index.ts".to_string()));
        assert!(picked.contains(&"util.ts".to_string()));
        assert!(!picked.contains(&"deep/nested/thing.ts".to_string())); // depth 3 excluded
    }
}
```

- [ ] **Step 2: Run the test to verify it fails (module not yet wired)**

Run: `cd src-tauri && cargo test repolens::tests::prioritizes 2>&1 | tail -5`
Expected: FAIL — `repolens` is not declared in `lib.rs` yet, so `cargo test` won't see it. Add a temporary `mod repolens;` line to `lib.rs` top (it will stay — Task 4 keeps it). Re-run.
Expected after adding `mod repolens;`: PASS.

- [ ] **Step 3: Add the structs + the three commands**

Append to `src-tauri/src/repolens.rs`:

```rust
use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Serialize)]
pub struct RepoLensReply { pub result: String, pub cost: f64, pub model: String }

#[derive(Serialize)]
pub struct LangPct { pub name: String, pub pct: u32 }
#[derive(Serialize)]
pub struct Dep { pub name: String, pub version: String }

#[derive(Serialize)]
pub struct RepoData {
    pub platform: String, pub repo_id: String, pub description: String,
    pub language: String, pub license: String, pub stars: u64,
    pub readme: String, pub languages: Vec<LangPct>, pub dependencies: Vec<Dep>,
}

#[derive(Serialize)]
pub struct SourceFile { pub path: String, pub content: String }
#[derive(Serialize)]
pub struct RepoSource { pub tree: Vec<String>, pub files: Vec<SourceFile>, pub degraded: bool }

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("orion-repolens")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn gh_headers(req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    let req = req.header("Accept", "application/vnd.github+json");
    match crate::api_key::github_token() {
        Some(t) => req.header("Authorization", format!("Bearer {t}")),
        None => req,
    }
}

// ── The model call (verified invocation: stdin + json envelope) ──────────────
#[tauri::command]
pub async fn repolens_claude_call(prompt: String, model: String) -> Result<RepoLensReply, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;
    let model = if model.trim().is_empty() { "claude-sonnet-4-6".to_string() } else { model };
    let mut cmd = Command::new("claude");
    cmd.args(["-p", "--output-format", "json", "--model", &model]);
    if let Some(home) = std::env::var_os("HOME") { cmd.current_dir(home); }
    cmd.env("PATH", crate::claude_cli::augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        stdin.write_all(prompt.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("claude exited {}: {}", out.status, String::from_utf8_lossy(&out.stderr).trim()));
    }
    let env: serde_json::Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("bad claude envelope: {e}"))?;
    if env.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false)
        || env.get("subtype").and_then(|v| v.as_str()).map(|s| s != "success").unwrap_or(false) {
        return Err(format!("claude returned error: {}", env.get("result").and_then(|v| v.as_str()).unwrap_or("unknown")));
    }
    let result = env.get("result").and_then(|v| v.as_str()).ok_or("no .result in claude envelope")?.to_string();
    let cost = env.get("total_cost_usd").and_then(|v| v.as_f64()).unwrap_or(0.0);
    Ok(RepoLensReply { result, cost, model })
}

async fn get_json(url: &str) -> Result<serde_json::Value, String> {
    let r = http().get(url).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() { return Err(format!("HTTP {} for {url}", r.status())); }
    r.json().await.map_err(|e| e.to_string())
}

fn bytes_to_comp(langs: &serde_json::Map<String, serde_json::Value>) -> Vec<LangPct> {
    let total: f64 = langs.values().filter_map(|v| v.as_f64()).sum();
    if total == 0.0 { return vec![]; }
    let mut v: Vec<(&String, f64)> = langs.iter().map(|(k, b)| (k, b.as_f64().unwrap_or(0.0))).collect();
    v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    v.into_iter().take(5).map(|(name, b)| LangPct { name: name.clone(), pct: (b / total * 100.0).round() as u32 }).collect()
}

#[tauri::command]
pub async fn repolens_fetch_repo(platform: String, repo_id: String) -> Result<RepoData, String> {
    match platform.as_str() {
        "github" => fetch_github(&repo_id).await,
        "gitlab" => fetch_gitlab(&repo_id).await,
        "npm" => fetch_npm(&repo_id).await,
        "pypi" => fetch_pypi(&repo_id).await,
        other => Err(format!("Unsupported platform: {other}")),
    }
}

async fn fetch_github(repo_id: &str) -> Result<RepoData, String> {
    let meta = get_json(&format!("https://api.github.com/repos/{repo_id}")).await?;
    // README (best effort)
    let mut readme = String::new();
    if let Ok(r) = gh_headers(http().get(format!("https://api.github.com/repos/{repo_id}/readme"))).send().await {
        if r.status().is_success() {
            if let Ok(j) = r.json::<serde_json::Value>().await {
                if j.get("encoding").and_then(|v| v.as_str()) == Some("base64") {
                    if let Some(c) = j.get("content").and_then(|v| v.as_str()) {
                        use base64::Engine;
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(c.replace('\n', "")) {
                            readme = String::from_utf8_lossy(&bytes).to_string();
                        }
                    }
                }
            }
        }
    }
    // Languages (best effort)
    let mut languages = vec![];
    if let Ok(r) = gh_headers(http().get(format!("https://api.github.com/repos/{repo_id}/languages"))).send().await {
        if r.status().is_success() {
            if let Ok(serde_json::Value::Object(m)) = r.json::<serde_json::Value>().await {
                languages = bytes_to_comp(&m);
            }
        }
    }
    let language = meta.get("language").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
    if languages.is_empty() && language != "Unknown" {
        languages.push(LangPct { name: language.clone(), pct: 100 });
    }
    Ok(RepoData {
        platform: "github".into(), repo_id: repo_id.into(),
        description: meta.get("description").and_then(|v| v.as_str()).unwrap_or("").into(),
        language,
        license: meta.pointer("/license/spdx_id").and_then(|v| v.as_str()).unwrap_or("Unknown").into(),
        stars: meta.get("stargazers_count").and_then(|v| v.as_u64()).unwrap_or(0),
        readme, languages, dependencies: vec![],
    })
}

// Stubs for phase 7 — return a clear error for now so the UI degrades cleanly.
async fn fetch_gitlab(_id: &str) -> Result<RepoData, String> { Err("gitlab support lands in a later slice".into()) }
async fn fetch_npm(_id: &str) -> Result<RepoData, String> { Err("npm support lands in a later slice".into()) }
async fn fetch_pypi(_id: &str) -> Result<RepoData, String> { Err("pypi support lands in a later slice".into()) }

#[tauri::command]
pub async fn repolens_fetch_source(repo_id: String) -> Result<RepoSource, String> {
    let meta = get_json(&format!("https://api.github.com/repos/{repo_id}")).await?;
    let branch = meta.get("default_branch").and_then(|v| v.as_str()).unwrap_or("main").to_string();
    let tree_json = get_json(&format!("https://api.github.com/repos/{repo_id}/git/trees/{branch}?recursive=1")).await?;
    let all_paths: Vec<String> = tree_json.get("tree").and_then(|v| v.as_array()).map(|arr| {
        arr.iter().filter(|e| e.get("type").and_then(|v| v.as_str()) == Some("blob"))
            .filter_map(|e| e.get("path").and_then(|v| v.as_str()).map(String::from)).collect()
    }).unwrap_or_default();
    let tree: Vec<String> = all_paths.iter().take(200).cloned().collect();
    let mut files = vec![];
    for path in select_key_files(&all_paths) {
        let enc = path.split('/').map(|seg| urlencoding(seg)).collect::<Vec<_>>().join("/");
        if let Ok(data) = gh_headers(http().get(format!("https://api.github.com/repos/{repo_id}/contents/{enc}"))).send().await {
            if let Ok(j) = data.json::<serde_json::Value>().await {
                if j.get("encoding").and_then(|v| v.as_str()) == Some("base64") {
                    if let Some(c) = j.get("content").and_then(|v| v.as_str()) {
                        use base64::Engine;
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(c.replace('\n', "")) {
                            let content: String = String::from_utf8_lossy(&bytes).chars().take(2500).collect();
                            files.push(SourceFile { path, content });
                        }
                    }
                }
            }
        }
    }
    let degraded = files.is_empty() && tree.is_empty();
    Ok(RepoSource { tree, files, degraded })
}

fn urlencoding(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{:02X}", b),
    }).collect()
}
```

NOTE: this uses the `base64` crate. Confirm it's a dependency (Task 3 adds it if missing).

- [ ] **Step 4: Run the selectKeyFiles test again**

Run: `cd src-tauri && cargo test repolens 2>&1 | tail -8`
Expected: PASS (1 test). If `base64` is missing it won't compile — do Task 3 first, then re-run.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/repolens.rs src-tauri/src/lib.rs
git commit -m "feat(repolens): rust module — claude json call, github fetch, source fetch, selectKeyFiles"
```

## Task 3: Rust — ensure `base64` dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Check whether base64 is already a dep**

Run: `grep -n '^base64' src-tauri/Cargo.toml || echo MISSING`

- [ ] **Step 2: Add it if MISSING**

Under `[dependencies]` in `src-tauri/Cargo.toml` add:

```toml
base64 = "0.22"
```

- [ ] **Step 3: Verify**

Run: `cd src-tauri && cargo check`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(repolens): add base64 dependency for github content decode"
```

## Task 4: Rust — migration 0021 + register module & commands

**Files:**
- Create: `src-tauri/migrations/0021_repolens.sql`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the migration**

Create `src-tauri/migrations/0021_repolens.sql`:

```sql
CREATE TABLE IF NOT EXISTS repolens_scans (
  repo_id       TEXT PRIMARY KEY,
  platform      TEXT NOT NULL,
  model         TEXT NOT NULL DEFAULT '',
  tone          TEXT NOT NULL DEFAULT 'neutral',
  analysis_json TEXT NOT NULL,
  lenses_json   TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repolens_updated ON repolens_scans(updated_at DESC);
```

- [ ] **Step 2: Register the migration**

In `src-tauri/src/lib.rs`, in the `migrations` vec right after the `0020_database_views.sql` entry (around line 142), add:

```rust
        tauri_plugin_sql::Migration {
            version: 21,
            description: "repolens: saved repo scans + on-demand lens results",
            sql: include_str!("../migrations/0021_repolens.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
```

(Match the exact struct fields used by the surrounding entries — copy the shape of the 0020 entry.)

- [ ] **Step 3: Ensure `mod repolens;` is declared**

At the top of `src-tauri/src/lib.rs` near `mod api_key;`, confirm `mod repolens;` exists (added in Task 2). If not, add it.

- [ ] **Step 4: Register the 6 new commands**

In the `tauri::generate_handler![ ... ]` list in `src-tauri/src/lib.rs`, add after the `api_key::*` entries:

```rust
            api_key::github_token_set,
            api_key::github_token_clear,
            api_key::github_token_status,
            repolens::repolens_claude_call,
            repolens::repolens_fetch_repo,
            repolens::repolens_fetch_source,
```

- [ ] **Step 5: Verify**

Run: `cd src-tauri && cargo check && cargo test repolens 2>&1 | tail -5`
Expected: compiles; repolens test passes.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/migrations/0021_repolens.sql src-tauri/src/lib.rs
git commit -m "feat(repolens): migration 0021 + register module and 6 commands"
```

## Task 5: ipc.ts — frontend bindings

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add the 5 bindings**

In `src/lib/ipc.ts`, inside the exported `ipc` object (next to `claudeOneshot`), add:

```ts
  repolensClaudeCall: (
    prompt: string,
    model: string,
  ): Promise<{ result: string; cost: number; model: string }> =>
    invoke("repolens_claude_call", { prompt, model }),
  repolensFetchRepo: (
    platform: string,
    repoId: string,
  ): Promise<import("@/apps/archives/repolens/types").RepoData> =>
    invoke("repolens_fetch_repo", { platform, repoId }),
  repolensFetchSource: (
    repoId: string,
  ): Promise<import("@/apps/archives/repolens/types").RepoSource> =>
    invoke("repolens_fetch_source", { repoId }),
  githubTokenSet: (token: string): Promise<void> => invoke("github_token_set", { token }),
  githubTokenClear: (): Promise<void> => invoke("github_token_clear"),
  githubTokenStatus: (): Promise<boolean> => invoke("github_token_status"),
```

(`repolensFetchRepo`/`repolensFetchSource` reference types created in Task 6 — TS will resolve once that file exists. Do Task 6 before `tsc`.)

- [ ] **Step 2: Commit (after Task 6 typechecks)**

```bash
git add src/lib/ipc.ts
git commit -m "feat(repolens): ipc bindings for claude call, fetchers, github token"
```

## Task 6: types.ts — shared types

**Files:**
- Create: `src/apps/archives/repolens/types.ts`

- [ ] **Step 1: Write the types**

Create `src/apps/archives/repolens/types.ts`:

```ts
export type Platform = "github" | "gitlab" | "npm" | "pypi";

export type LangPct = { name: string; pct: number };
export type Dep = { name: string; version: string };

export type RepoData = {
  platform: Platform;
  repo_id: string;
  description: string;
  language: string;
  license: string;
  stars: number;
  readme: string;
  languages: LangPct[];
  dependencies: Dep[];
};

export type RepoSource = {
  tree: string[];
  files: { path: string; content: string }[];
  degraded: boolean;
};

export type Health = {
  score: number; commit_activity: number; issue_response: number;
  pr_merge_rate: number; maintainer_count: number; summary: string;
};
export type RedFlag = { title: string; text: string; severity: "warning" | "ok" };
export type Highlight = {
  text: string; why: string;
  severity: "risk" | "insight" | "opportunity"; tab: string;
};

export type RepoAnalysis = {
  eli5: string;
  bottom_line: string;
  analogies: string[];
  technical: string;
  use_cases: { core_fit: string; good_fit: string; works_well: string; long_term: string };
  skip_if: { overkill: string; wrong_tool: string; needs_care: string; consider: string };
  enables: string;
  pros: string[];
  cons: string[];
  alternatives: { name: string; when: string }[];
  health: Health;
  red_flags: RedFlag[];
  start_here: { icon: string; title: string; desc: string; tag: string }[];
  compare_hooks: string;
  tech_stack: { built_with: string[]; key_dependencies: { name: string; purpose: string }[] };
  tags: string[];
  category: string;
  capabilities: string[];
  highlights: Highlight[];
  // carried from RepoData for rendering/export convenience (set by the store, not the parser):
  repoId?: string;
  platform?: Platform;
  language?: string;
  license?: string;
  stars?: number;
  description?: string;
  languages?: LangPct[];
};

// ── Lens result types ──
export type DeepDive = {
  atoms: { id: string; name: string; kind: string; purpose: string; files: string[] }[];
  lineage: {
    links: { from: string; to: string; relation: string; why: string }[];
    roots: string[];
    leaves: string[];
  };
  feynman: {
    explanation: string;
    gaps: string[];
    assumptions: string[];
    questions: { q: string; a: string }[];
    confidence: { claim: string; level: string; note: string }[];
  };
};

export type Sktpg = {
  thesis: { becoming: string; forced_next: string; opportunity: string; before_consensus: string; wrong_if: string };
  score: { value: number; band: string };
  base_rate: { reference_class: string; rate: string; cause_of_death: string; prior: string; evidence: string };
  weak_signals: { signal: string; why: string; evidence: string; forces_next: string }[];
  hype_vs_motion: { claim: string; verdict: string; evidence: string }[];
  bottleneck: { current: string; weakening: string; next: string; who_profits: string };
  forecast: { base: string; bull: string; bear: string; wildcard: string };
  becomes_obvious: string[];
  actions: { action: string; timeframe: string; why_now: string }[];
  premortem: { kill_path: string; likelihood: string; survives: boolean }[];
  tracking: { signal: string; flag: string; why: string }[];
};

export type Synergies = {
  synergies: { repoId: string; category: string; synergy: string; in_library: boolean }[];
};

export type Lenses = { deepdive?: DeepDive; sktpg?: Sktpg; synergies?: Synergies };

export type PartId = "core" | "deepdive" | "sktpg" | "synergies";
export type RepoLensModelConfig = { default_model: string; per_part: Record<string, string> };
export type RepoLensPrefs = { model: RepoLensModelConfig; tone: string };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (ipc.ts from Task 5 now resolves its type imports).

- [ ] **Step 3: Commit**

```bash
git add src/apps/archives/repolens/types.ts src/lib/ipc.ts
git commit -m "feat(repolens): shared types (RepoData, RepoAnalysis, lens results, config)"
```

## Task 7: detect.ts (port url-detector.js) + test

**Files:**
- Create: `src/apps/archives/repolens/detect.ts`
- Test: `src/apps/archives/repolens/detect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/apps/archives/repolens/detect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectPlatform } from "./detect";

describe("detectPlatform", () => {
  it("github url", () => {
    expect(detectPlatform("https://github.com/facebook/react")).toEqual({ platform: "github", repoId: "facebook/react" });
  });
  it("github url with extra path", () => {
    expect(detectPlatform("https://github.com/facebook/react/tree/main/packages")).toEqual({ platform: "github", repoId: "facebook/react" });
  });
  it("bare owner/repo assumed github", () => {
    expect(detectPlatform("facebook/react")).toEqual({ platform: "github", repoId: "facebook/react" });
  });
  it("npm package", () => {
    expect(detectPlatform("https://www.npmjs.com/package/zustand")).toEqual({ platform: "npm", repoId: "zustand" });
  });
  it("pypi project", () => {
    expect(detectPlatform("https://pypi.org/project/requests/")).toEqual({ platform: "pypi", repoId: "requests" });
  });
  it("gitlab project", () => {
    expect(detectPlatform("https://gitlab.com/gitlab-org/gitlab")).toEqual({ platform: "gitlab", repoId: "gitlab-org/gitlab" });
  });
  it("junk returns null", () => {
    expect(detectPlatform("not a url")).toBeNull();
    expect(detectPlatform("https://example.com/x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/detect.test.ts`
Expected: FAIL — cannot find `./detect`.

- [ ] **Step 3: Write detect.ts**

Port `repolens-main/url-detector.js` to `src/apps/archives/repolens/detect.ts`, adding TS types and the bare-`owner/repo` ergonomic case:

```ts
import type { Platform } from "./types";

export function detectPlatform(input: string): { platform: Platform; repoId: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare "owner/repo" → assume github (terminal ergonomics).
  if (!/^https?:\/\//i.test(raw) && /^[\w.-]+\/[\w.-]+$/.test(raw)) {
    return { platform: "github", repoId: raw.replace(/\/+$/, "") };
  }

  let u: URL;
  try { u = new URL(raw); } catch { return null; }

  if (u.hostname === "github.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { platform: "github", repoId: `${parts[0]}/${parts[1]}` };
  }
  if (u.hostname === "gitlab.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { platform: "gitlab", repoId: `${parts[0]}/${parts[1]}` };
  }
  if (u.hostname === "www.npmjs.com" && u.pathname.startsWith("/package/")) {
    const name = u.pathname.slice("/package/".length).split("/v/")[0];
    if (name) return { platform: "npm", repoId: name };
  }
  if (u.hostname === "pypi.org" && u.pathname.startsWith("/project/")) {
    const name = u.pathname.slice("/project/".length).replace(/\/$/, "").split("/")[0];
    if (name) return { platform: "pypi", repoId: name };
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/detect.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/detect.ts src/apps/archives/repolens/detect.test.ts
git commit -m "feat(repolens): detectPlatform (port url-detector) + tests"
```

## Task 8: taxonomy.ts (port taxonomy.js) + test

**Files:**
- Create: `src/apps/archives/repolens/taxonomy.ts`
- Test: `src/apps/archives/repolens/taxonomy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/apps/archives/repolens/taxonomy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidTag, layersAdjacent, layerOf, normalizeCapabilities, deriveCapabilities } from "./taxonomy";

describe("taxonomy", () => {
  it("validates known tags", () => {
    expect(isValidTag("rag")).toBe(true);
    expect(isValidTag("nonsense")).toBe(false);
    expect(isValidTag("other")).toBe(true);
  });
  it("layerOf", () => {
    expect(layerOf("rag")).toBe("ml");
    expect(layerOf("nope")).toBe("other");
  });
  it("layersAdjacent symmetric + same-layer", () => {
    expect(layersAdjacent("ml", "ml")).toBe(true);
    expect(layersAdjacent("ml", "compute")).toBe(true);
    expect(layersAdjacent("ui", "storage")).toBe(false);
  });
  it("normalizeCapabilities filters + caps + lowercases", () => {
    expect(normalizeCapabilities(["RAG", "rag", "bogus", "embeddings"])).toEqual(["rag", "embeddings"]);
    expect(normalizeCapabilities(["a","b","c","d","e","f","g"]).length).toBeLessThanOrEqual(5);
  });
  it("deriveCapabilities keyword fallback", () => {
    const caps = deriveCapabilities({ category: "CLI Tool", tech_stack: { built_with: [] }, tags: [], eli5: "a command-line tool" });
    expect(caps).toContain("cli");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/taxonomy.test.ts`
Expected: FAIL — cannot find `./taxonomy`.

- [ ] **Step 3: Port taxonomy.js verbatim with TS types**

Port `repolens-main/taxonomy.js` to `src/apps/archives/repolens/taxonomy.ts` **verbatim** (it is already ESM). The ONLY edits:
- Add type annotations to the exported signatures:
  - `export function layerOf(tag: string): string`
  - `export function isValidTag(tag: string): boolean`
  - `export function layersAdjacent(a: string, b: string): boolean`
  - `export function normalizeCapabilities(raw: unknown, max = 5): string[]`
  - `export function deriveCapabilities(meta: { category?: string; tech_stack?: { built_with?: string[] }; tags?: string[]; eli5?: string } = {}, max = 5): string[]`
- Type the module-level constants: `export const TAXONOMY: Record<string, string[]> = { ... }` and `const KEYWORD_HINTS: Record<string, string[]> = { ... }`.
- Copy the `TAXONOMY` table, `ALL_TAGS`, `TAG_LAYER`, `NEIGHBOURS`, and `KEYWORD_HINTS` exactly — all ~60 tags and the keyword lists. Do not paraphrase the keyword hints; they are tuned.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/taxonomy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/taxonomy.ts src/apps/archives/repolens/taxonomy.test.ts
git commit -m "feat(repolens): taxonomy (port taxonomy.js verbatim) + tests"
```

## Task 9: tone.ts + models.ts + tests

**Files:**
- Create: `src/apps/archives/repolens/tone.ts`, `src/apps/archives/repolens/models.ts`
- Test: `src/apps/archives/repolens/tone.test.ts`, `src/apps/archives/repolens/models.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/apps/archives/repolens/tone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTone, tonePreamble, TONES, DEFAULT_TONE } from "./tone";

describe("tone", () => {
  it("neutral has no preamble", () => {
    expect(tonePreamble("neutral")).toBe("");
    expect(withTone("neutral", "BODY")).toBe("BODY");
  });
  it("director prepends a voice directive", () => {
    const out = withTone("director", "BODY");
    expect(out.endsWith("BODY")).toBe(true);
    expect(out.length).toBeGreaterThan("BODY".length);
  });
  it("exposes the 6 tones with neutral default", () => {
    expect(DEFAULT_TONE).toBe("neutral");
    expect(TONES.map(t => t.key)).toContain("copilot");
  });
});
```

Create `src/apps/archives/repolens/models.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { modelFor, defaultModelConfig, PARTS } from "./models";

describe("models", () => {
  it("falls back to default when part unset or 'default'", () => {
    const cfg = { default_model: "claude-sonnet-4-6", per_part: { deepdive: "default", core: "claude-opus-4-8" } };
    expect(modelFor(cfg, "deepdive")).toBe("claude-sonnet-4-6");
    expect(modelFor(cfg, "sktpg")).toBe("claude-sonnet-4-6");
    expect(modelFor(cfg, "core")).toBe("claude-opus-4-8");
  });
  it("default config uses sonnet", () => {
    expect(defaultModelConfig().default_model).toBe("claude-sonnet-4-6");
  });
  it("PARTS covers the v1 features", () => {
    expect(PARTS.map(p => p.id)).toEqual(["core", "deepdive", "sktpg", "synergies"]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/apps/archives/repolens/tone.test.ts src/apps/archives/repolens/models.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Port tone.js + write models.ts**

Port `repolens-main/tone.js` to `src/apps/archives/repolens/tone.ts` verbatim, adding types:
- `export function isTone(key: string): boolean`
- `export function tonePreamble(toneKey: string): string`
- `export function withTone(toneKey: string, prompt: string): string`
- `export const TONES: { key: string; label: string; blurb: string }[]` and `const DIRECTIVES: Record<string, string>`.
Copy `DEFAULT_TONE`, `TONES`, `DIRECTIVES` exactly.

Create `src/apps/archives/repolens/models.ts`:

```ts
import { MODELS } from "@/lib/models";
import type { RepoLensModelConfig } from "./types";

export const PARTS: { id: string; label: string }[] = [
  { id: "core", label: "Core scan" },
  { id: "deepdive", label: "Deep Dive" },
  { id: "sktpg", label: "SKTPG" },
  { id: "synergies", label: "Synergies" },
];

// Anthropic-only catalog, reusing the app's canonical model list.
export const REPOLENS_MODELS = MODELS;

export function defaultModelConfig(): RepoLensModelConfig {
  return { default_model: "claude-sonnet-4-6", per_part: {} };
}

export function modelFor(cfg: RepoLensModelConfig, part: string): string {
  const m = cfg.per_part[part];
  return m && m !== "default" ? m : cfg.default_model;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/apps/archives/repolens/tone.test.ts src/apps/archives/repolens/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/tone.ts src/apps/archives/repolens/tone.test.ts src/apps/archives/repolens/models.ts src/apps/archives/repolens/models.test.ts
git commit -m "feat(repolens): tone (port) + model config/modelFor + tests"
```

## Task 10: verdict.ts (port verdict.js) + test

**Files:**
- Create: `src/apps/archives/repolens/verdict.ts`
- Test: `src/apps/archives/repolens/verdict.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/apps/archives/repolens/verdict.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveFit, firstSentence } from "./verdict";

describe("verdict", () => {
  it("strong: high health, no warns", () => {
    expect(deriveFit({ health: { score: 90 }, red_flags: [], pros: ["a"], cons: [] }).level).toBe("strong");
  });
  it("solid: 70s, one warn", () => {
    expect(deriveFit({ health: { score: 75 }, red_flags: [{ severity: "warning" }], pros: [], cons: [] }).level).toBe("solid");
  });
  it("care: 50s", () => {
    expect(deriveFit({ health: { score: 55 }, red_flags: [{ severity: "warning" }], pros: [], cons: [] }).level).toBe("care");
  });
  it("risky: low health", () => {
    expect(deriveFit({ health: { score: 30 }, red_flags: [{ severity: "warning" }], pros: [], cons: [] }).level).toBe("risky");
  });
  it("firstSentence", () => {
    expect(firstSentence("Hello world. Second.")).toBe("Hello world.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/verdict.test.ts`
Expected: FAIL.

- [ ] **Step 3: Port verdict.js verbatim with types**

Port `repolens-main/verdict.js` to `src/apps/archives/repolens/verdict.ts` verbatim. Types:
- `export function firstSentence(text: string): string`
- `export function deriveFit(d: any): { level: "strong"|"solid"|"care"|"risky"; label: string; why: string }`
- `export function verdictCopyText(d: any): string`
Keep the threshold logic exactly (≥85 & 0 warns → strong; ≥70 & ≤1 → solid; ≥50 & ≤3 → care; else risky).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/verdict.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/verdict.ts src/apps/archives/repolens/verdict.test.ts
git commit -m "feat(repolens): verdict deriveFit (port) + tests"
```

## Task 11: prompt.ts (port prompt.js core) + parser.ts (port parser.js) + test

**Files:**
- Create: `src/apps/archives/repolens/prompt.ts`, `src/apps/archives/repolens/parser.ts`
- Test: `src/apps/archives/repolens/parser.test.ts`

- [ ] **Step 1: Write the failing parser test**

Create `src/apps/archives/repolens/parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseClaudeResponse } from "./parser";

const minimal = JSON.stringify({
  eli5: "x", bottom_line: "y", technical: "t",
  health: { score: 80, summary: "ok" },
  pros: ["p"], cons: ["c"], capabilities: ["rag", "bogus"],
  highlights: [{ text: "h", why: "w", severity: "weird", tab: "not_a_tab" }],
});

describe("parser", () => {
  it("parses clean JSON", () => {
    const a = parseClaudeResponse(minimal);
    expect(a.eli5).toBe("x");
    expect(a.health.score).toBe(80);
  });
  it("salvages fenced + prose-wrapped JSON", () => {
    const a = parseClaudeResponse("Sure!\n```json\n" + minimal + "\n```\nHope that helps");
    expect(a.bottom_line).toBe("y");
  });
  it("clamps capabilities to the taxonomy", () => {
    expect(parseClaudeResponse(minimal).capabilities).toEqual(["rag"]);
  });
  it("clamps highlight severity + tab to allow-lists", () => {
    const h = parseClaudeResponse(minimal).highlights[0];
    expect(h.severity).toBe("insight"); // invalid → default
    expect(h.tab).toBe("");             // invalid → empty
  });
  it("throws on no JSON", () => {
    expect(() => parseClaudeResponse("no json here")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/parser.test.ts`
Expected: FAIL.

- [ ] **Step 3: Port prompt.js and parser.js**

Port `repolens-main/prompt.js` to `src/apps/archives/repolens/prompt.ts` verbatim — `export function buildPrompt(repoData: RepoData): string`. **Copy the entire prompt template string exactly** (the senior-staff-engineer briefing + embedded JSON schema). It imports `TAXONOMY` from `./taxonomy`. Add `import type { RepoData } from "./types";`.

Port `repolens-main/parser.js` to `src/apps/archives/repolens/parser.ts` verbatim — `export function parseClaudeResponse(rawText: string): RepoAnalysis`. Keep `HL_SEVERITIES`, `HL_SECTIONS`, `normalizeHighlights`, the fence-strip + `{…}` slice, and the `?? ''` defaulting exactly. Imports `normalizeCapabilities, deriveCapabilities` from `./taxonomy`. Add `import type { RepoAnalysis } from "./types";` and annotate the return.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/parser.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/prompt.ts src/apps/archives/repolens/parser.ts src/apps/archives/repolens/parser.test.ts
git commit -m "feat(repolens): core buildPrompt + parseClaudeResponse (ports) + tests"
```

## Task 12: claude.ts (serialized AI queue) + fetch.ts

**Files:**
- Create: `src/apps/archives/repolens/claude.ts`, `src/apps/archives/repolens/fetch.ts`

- [ ] **Step 1: Write the serialized queue**

Create `src/apps/archives/repolens/claude.ts`:

```ts
import { ipc } from "@/lib/ipc";
import { modelFor } from "./models";
import type { RepoLensModelConfig } from "./types";

const MIN_GAP_MS = 1200;

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;

/**
 * Enqueue a Claude call. All RepoLens AI calls run through this single chain
 * with a minimum gap, so a 3-call Deep Dive never spawns parallel `claude`
 * processes. Resolves the model per part from the config.
 */
export function enqueueClaude(cfg: RepoLensModelConfig, part: string, prompt: string): Promise<string> {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const reply = await ipc.repolensClaudeCall(prompt, modelFor(cfg, part));
    return reply.result;
  });
  // keep the chain alive even if a call rejects
  chain = run.catch(() => undefined);
  return run;
}
```

Create `src/apps/archives/repolens/fetch.ts`:

```ts
import { ipc } from "@/lib/ipc";
import { detectPlatform } from "./detect";
import type { RepoData, RepoSource } from "./types";

export function resolveInput(input: string) {
  return detectPlatform(input);
}

export async function fetchRepo(input: string): Promise<RepoData> {
  const hit = detectPlatform(input);
  if (!hit) throw new Error("Not a recognized repo URL or owner/repo");
  return ipc.repolensFetchRepo(hit.platform, hit.repoId);
}

export async function fetchSource(repoId: string): Promise<RepoSource> {
  return ipc.repolensFetchSource(repoId);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/apps/archives/repolens/claude.ts src/apps/archives/repolens/fetch.ts
git commit -m "feat(repolens): serialized claude queue + fetch wrappers"
```

## Task 13: useRepoLens.ts (store) — core scan only

**Files:**
- Create: `src/apps/archives/repolens/useRepoLens.ts`

- [ ] **Step 1: Write the store (core-scan scope; library/lenses/prefs added in later phases)**

Create `src/apps/archives/repolens/useRepoLens.ts`:

```ts
import { create } from "zustand";
import { fetchRepo } from "./fetch";
import { buildPrompt } from "./prompt";
import { withTone } from "./tone";
import { parseClaudeResponse } from "./parser";
import { enqueueClaude } from "./claude";
import { defaultModelConfig } from "./models";
import { log } from "@/lib/log";
import type { RepoAnalysis, RepoLensModelConfig } from "./types";

type RunningPart = null | "core" | "deepdive" | "sktpg" | "synergies";

type State = {
  input: string;
  setInput: (s: string) => void;
  current: RepoAnalysis | null;
  running: RunningPart;
  error: string | null;
  model: RepoLensModelConfig;
  tone: string;
  setDefaultModel: (id: string) => void;
  setTone: (t: string) => void;
  scan: (input: string) => Promise<void>;
  closeReport: () => void;
};

export const useRepoLens = create<State>((set, get) => ({
  input: "",
  setInput: (input) => set({ input }),
  current: null,
  running: null,
  error: null,
  model: defaultModelConfig(),
  tone: "neutral",
  setDefaultModel: (id) => set((s) => ({ model: { ...s.model, default_model: id } })),
  setTone: (tone) => set({ tone }),
  closeReport: () => set({ current: null, error: null }),

  scan: async (input) => {
    set({ running: "core", error: null });
    try {
      const repo = await fetchRepo(input);
      const prompt = withTone(get().tone, buildPrompt(repo));
      const raw = await enqueueClaude(get().model, "core", prompt);
      const analysis = parseClaudeResponse(raw);
      // carry repo metadata for rendering/export
      analysis.repoId = repo.repo_id;
      analysis.platform = repo.platform;
      analysis.language = repo.language;
      analysis.license = repo.license;
      analysis.stars = repo.stars;
      analysis.description = repo.description;
      analysis.languages = repo.languages;
      set({ current: analysis, running: null });
    } catch (e) {
      log.error("repolens scan failed", e);
      set({ running: null, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/apps/archives/repolens/useRepoLens.ts
git commit -m "feat(repolens): zustand store — core scan flow"
```

## Task 14: Accent token + base CSS

**Files:**
- Modify: `src/styles/tokens.css`

- [ ] **Step 1: Add the accent + minimal layout classes**

In `src/styles/tokens.css`, add to `:root` (near the other `--neon-*` tokens):

```css
  --repolens-green: #1fb85f;
  --repolens-green-rgb: 31, 184, 95;
```

Then append a RepoLens block at the end of the file:

```css
/* ── RepoLens (Archives section) ───────────────────────────── */
.rl-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.rl-scanbar { display: flex; gap: 8px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--glass-border); }
.rl-scanbar input.rl-url { flex: 1; min-width: 0; background: var(--bg-2); border: 1px solid var(--glass-border); border-radius: var(--r-sm); padding: 8px 10px; color: var(--t-primary); font: inherit; }
.rl-scanbar input.rl-url:focus { outline: none; border-color: rgba(var(--repolens-green-rgb), 0.6); }
.rl-btn { background: rgba(var(--repolens-green-rgb), 0.14); color: var(--repolens-green); border: 1px solid rgba(var(--repolens-green-rgb), 0.4); border-radius: var(--r-sm); padding: 8px 14px; font: inherit; cursor: pointer; white-space: nowrap; }
.rl-btn:disabled { opacity: 0.5; cursor: default; }
.rl-body { flex: 1; min-height: 0; overflow: auto; padding: 18px; }
.rl-error { color: var(--neon-magenta); padding: 8px 14px; font-size: 13px; }
.rl-spinner { color: var(--repolens-green); padding: 18px; }
.rl-section { margin: 0 0 22px; }
.rl-section h3 { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-tertiary); margin: 0 0 8px; }
.rl-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: var(--r-pill); font-size: 12px; border: 1px solid var(--glass-border); }
.rl-verdict-strong { color: var(--repolens-green); border-color: rgba(var(--repolens-green-rgb), 0.5); }
.rl-verdict-solid  { color: var(--neon-cyan); border-color: rgba(var(--neon-cyan-rgb), 0.5); }
.rl-verdict-care   { color: var(--neon-yellow); border-color: rgba(var(--neon-yellow-rgb), 0.5); }
.rl-verdict-risky  { color: var(--neon-magenta); border-color: rgba(var(--neon-magenta-rgb), 0.5); }
.rl-bar { height: 6px; border-radius: 3px; background: var(--bg-3); overflow: hidden; }
.rl-bar > span { display: block; height: 100%; background: var(--repolens-green); }
.rl-lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.rl-lib-card { background: var(--bg-1); border: 1px solid var(--glass-border); border-radius: var(--r-md); padding: 14px; cursor: pointer; }
.rl-lib-card:hover { border-color: rgba(var(--repolens-green-rgb), 0.4); }
.rl-lens-rail { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0 18px; }
```

If `--neon-cyan-rgb` / `--neon-yellow-rgb` / `--neon-magenta-rgb` don't exist, use the literal triplets from the design tokens (cyan `0,224,255`; yellow `230,255,58`; magenta `255,62,165`).

- [ ] **Step 2: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(repolens): darker-green accent token + base .rl-* styles"
```

## Task 15: RepoLensReport.tsx — render the core analysis

**Files:**
- Create: `src/apps/archives/repolens/RepoLensReport.tsx`

- [ ] **Step 1: Write the report component**

Create `src/apps/archives/repolens/RepoLensReport.tsx`. Render every core section. Keep it presentational (takes the analysis as a prop):

```tsx
import type { RepoAnalysis } from "./types";
import { deriveFit } from "./verdict";

function Para({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <div className="rl-section">
      <h3>{title}</h3>
      <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{body}</p>
    </div>
  );
}

function Bullets({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="rl-section">
      <h3>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

function KV({ title, obj }: { title: string; obj?: Record<string, string> }) {
  if (!obj || !Object.values(obj).some(Boolean)) return null;
  return (
    <div className="rl-section">
      <h3>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {Object.entries(obj).filter(([, v]) => v).map(([k, v]) => (
          <li key={k}><strong>{k.replace(/_/g, " ")}:</strong> {v}</li>
        ))}
      </ul>
    </div>
  );
}

export function RepoLensReport({ a }: { a: RepoAnalysis }) {
  const fit = deriveFit(a);
  return (
    <div>
      <div className="rl-section">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{a.repoId}</h2>
          <span className={`rl-chip rl-verdict-${fit.level}`}>{fit.label} · {fit.why}</span>
        </div>
        {a.bottom_line && <p style={{ marginTop: 8 }}>{a.bottom_line}</p>}
      </div>

      <Para title="ELI5" body={a.eli5} />
      <Bullets title="Analogies" items={a.analogies} />
      <Para title="Technical" body={a.technical} />
      <KV title="Use cases" obj={a.use_cases} />
      <KV title="Skip if" obj={a.skip_if} />
      <Para title="Enables" body={a.enables} />
      <Bullets title="Pros" items={a.pros} />
      <Bullets title="Cons" items={a.cons} />

      {a.alternatives?.length > 0 && (
        <div className="rl-section">
          <h3>Alternatives</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.alternatives.map((alt, i) => <li key={i}><strong>{alt.name}</strong> — {alt.when}</li>)}
          </ul>
        </div>
      )}

      <div className="rl-section">
        <h3>Health — {a.health.score}/100</h3>
        {(["commit_activity", "issue_response", "pr_merge_rate", "maintainer_count"] as const).map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
            <span style={{ width: 130, fontSize: 12, color: "var(--t-tertiary)" }}>{k.replace(/_/g, " ")}</span>
            <div className="rl-bar" style={{ flex: 1 }}><span style={{ width: `${a.health[k]}%` }} /></div>
          </div>
        ))}
        {a.health.summary && <p style={{ marginTop: 6 }}>{a.health.summary}</p>}
      </div>

      {a.red_flags?.length > 0 && (
        <div className="rl-section">
          <h3>Red flags</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.red_flags.map((f, i) => <li key={i}>{f.severity === "ok" ? "✅" : "⚠️"} <strong>{f.title}</strong> — {f.text}</li>)}
          </ul>
        </div>
      )}

      {a.start_here?.length > 0 && (
        <div className="rl-section">
          <h3>Start here</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.start_here.map((s, i) => <li key={i}>{s.icon} <strong>{s.title}</strong> ({s.tag}) — {s.desc}</li>)}
          </ul>
        </div>
      )}

      {(a.tech_stack?.built_with?.length || a.tech_stack?.key_dependencies?.length) ? (
        <div className="rl-section">
          <h3>Tech stack</h3>
          {a.tech_stack.built_with?.length > 0 && <p style={{ margin: "0 0 6px" }}>Built with: {a.tech_stack.built_with.join(", ")}</p>}
          {a.languages?.length ? (
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", margin: "6px 0" }}>
              {a.languages.map((l) => <span key={l.name} title={`${l.name} ${l.pct}%`} style={{ width: `${l.pct}%`, background: "var(--repolens-green)" , opacity: 0.5 + l.pct / 200 }} />)}
            </div>
          ) : null}
          {a.tech_stack.key_dependencies?.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {a.tech_stack.key_dependencies.map((d, i) => <li key={i}><code>{d.name}</code> — {d.purpose}</li>)}
            </ul>
          )}
        </div>
      ) : null}

      {(a.tags?.length || a.capabilities?.length) ? (
        <div className="rl-section">
          <h3>Tags</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {a.capabilities.map((c) => <span key={`c-${c}`} className="rl-chip rl-verdict-strong">{c}</span>)}
            {a.tags.map((t) => <span key={`t-${t}`} className="rl-chip">{t}</span>)}
          </div>
        </div>
      ) : null}

      {a.highlights?.length > 0 && (
        <div className="rl-section">
          <h3>Highlights</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {a.highlights.map((h, i) => <li key={i}><strong>{h.text}</strong>{h.why ? ` — ${h.why}` : ""}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/apps/archives/repolens/RepoLensReport.tsx
git commit -m "feat(repolens): RepoLensReport — render all core sections"
```

## Task 16: RepoLensView.tsx — scan bar + report; nav wiring

**Files:**
- Create: `src/apps/archives/repolens/RepoLensView.tsx`
- Modify: `src/apps/archives/useArchives.ts`, `src/apps/archives/ArchivesApp.tsx`

- [ ] **Step 1: Add the view to the union**

In `src/apps/archives/useArchives.ts`, add `"repolens"` to the `ArchivesView` union (after `"database"`).

- [ ] **Step 2: Write the view (scan bar + report; model/tone pickers + library land in later phases)**

Create `src/apps/archives/repolens/RepoLensView.tsx`:

```tsx
import { useRepoLens } from "./useRepoLens";
import { RepoLensReport } from "./RepoLensReport";
import { resolveInput } from "./fetch";

export function RepoLensView() {
  const { input, setInput, current, running, error, scan, closeReport } = useRepoLens();
  const hit = resolveInput(input);

  return (
    <div className="rl-view">
      <div className="rl-scanbar">
        <input
          className="rl-url"
          placeholder="Paste a GitHub/GitLab/npm/PyPI URL or owner/repo…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && hit && !running) void scan(input); }}
        />
        <button className="rl-btn" disabled={!hit || running !== null} onClick={() => void scan(input)}>
          {running === "core" ? "Scanning…" : "Scan"}
        </button>
        {current && <button className="rl-btn" onClick={closeReport}>Library</button>}
      </div>

      {error && <div className="rl-error">{error}</div>}

      <div className="rl-body">
        {running === "core" && !current && <div className="rl-spinner">Scanning {hit?.repoId}… (this takes a few seconds)</div>}
        {current ? <RepoLensReport a={current} /> : !running && (
          <p style={{ color: "var(--t-tertiary)" }}>
            Paste a repository above and hit Scan to get an adoption briefing.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into ArchivesApp**

In `src/apps/archives/ArchivesApp.tsx`:
- Add an import: `import { RepoLensView } from "@/apps/archives/repolens/RepoLensView";`
- Add a `lucide-react` icon import: add `ScanSearch` to the existing `lucide-react` import block.
- Add to the `LIBRARY` array after the Projects entry: `{ key: "repolens", label: "RepoLens", Icon: ScanSearch },`
- Add to the view host (after the `database` line): `{view === "repolens" && <RepoLensView />}`

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/RepoLensView.tsx src/apps/archives/useArchives.ts src/apps/archives/ArchivesApp.tsx
git commit -m "feat(repolens): RepoLensView + Archives nav wiring (sidebar section)"
```

## Task 17: Phase 1 verification

- [ ] **Step 1: Full green check**

Run: `npx tsc --noEmit && npx vitest run && npm run build && (cd src-tauri && cargo check && cargo test)`
Expected: all pass.

- [ ] **Step 2: User smoke test (manual — needs a `tauri dev` restart)**

Tell the user: restart `tauri dev` (new Rust module + migration 0021). Then Archives → sidebar → **RepoLens** → paste e.g. `facebook/react` → Scan → core report renders. (Agent can't run Tauri.)

---

# PHASE 2 — Model + tone pickers + persistence

## Task 18: Persist prefs in app_state + hydrate

**Files:**
- Modify: `src/apps/archives/repolens/useRepoLens.ts`

- [ ] **Step 1: Add hydrate + persist**

In `useRepoLens.ts`, import `getAppState, setAppState` from `@/lib/db` and `defaultModelConfig` (already imported). Add to state:

```ts
  setPartModel: (part: string, id: string) => void;
  hydratePrefs: () => Promise<void>;
```

Implement:

```ts
  setDefaultModel: (id) => { const m = { ...get().model, default_model: id }; set({ model: m }); void setAppState("repolens", { model: m, tone: get().tone }); },
  setPartModel: (part, id) => { const m = { ...get().model, per_part: { ...get().model.per_part, [part]: id } }; set({ model: m }); void setAppState("repolens", { model: m, tone: get().tone }); },
  setTone: (tone) => { set({ tone }); void setAppState("repolens", { model: get().model, tone }); },
  hydratePrefs: async () => {
    const saved = await getAppState<{ model?: RepoLensModelConfig; tone?: string }>("repolens");
    if (saved) set({ model: saved.model ?? defaultModelConfig(), tone: saved.tone ?? "neutral" });
  },
```

- [ ] **Step 2: Call hydrate on view mount**

In `RepoLensView.tsx`, add `useEffect(() => { void useRepoLens.getState().hydratePrefs(); }, []);` (import `useEffect`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/apps/archives/repolens/useRepoLens.ts src/apps/archives/repolens/RepoLensView.tsx
git commit -m "feat(repolens): persist model + tone prefs in app_state"
```

## Task 19: Model + tone picker UI in the scan bar

**Files:**
- Create: `src/apps/archives/repolens/RepoLensPickers.tsx`
- Modify: `src/apps/archives/repolens/RepoLensView.tsx`

- [ ] **Step 1: Write the pickers**

Create `src/apps/archives/repolens/RepoLensPickers.tsx`:

```tsx
import { useRepoLens } from "./useRepoLens";
import { REPOLENS_MODELS } from "./models";
import { TONES } from "./tone";

export function RepoLensPickers() {
  const { model, tone, setDefaultModel, setTone } = useRepoLens();
  return (
    <>
      <select className="rl-url" style={{ flex: "0 0 auto", maxWidth: 160 }} value={model.default_model} onChange={(e) => setDefaultModel(e.target.value)} title="Model">
        {REPOLENS_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <select className="rl-url" style={{ flex: "0 0 auto", maxWidth: 150 }} value={tone} onChange={(e) => setTone(e.target.value)} title="Tone">
        {TONES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
    </>
  );
}
```

- [ ] **Step 2: Mount it in the scan bar**

In `RepoLensView.tsx`, import `RepoLensPickers` and render `<RepoLensPickers />` inside `.rl-scanbar` between the input and the Scan button.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/apps/archives/repolens/RepoLensPickers.tsx src/apps/archives/repolens/RepoLensView.tsx
git commit -m "feat(repolens): global model + tone pickers in the scan bar"
```

---

# PHASE 3 — Library + Markdown export (shippable after this)

## Task 20: repolensDb.ts (migration 0021 CRUD)

**Files:**
- Create: `src/apps/archives/repolens/repolensDb.ts`

- [ ] **Step 1: Write the DB layer**

Look at `src/apps/archives/database/databaseDb.ts` for the exact `getDb()`/query helper pattern used in the codebase, then create `src/apps/archives/repolens/repolensDb.ts` matching it:

```ts
import { getDb } from "@/lib/db"; // use whatever the codebase exposes; mirror databaseDb.ts
import type { RepoAnalysis, Lenses, Platform } from "./types";

export type ScanRow = {
  repo_id: string;
  platform: Platform;
  model: string;
  tone: string;
  analysis: RepoAnalysis;
  lenses: Lenses;
  created_at: number;
  updated_at: number;
};

export async function saveScan(row: { repo_id: string; platform: Platform; model: string; tone: string; analysis: RepoAnalysis; lenses?: Lenses }): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO repolens_scans (repo_id, platform, model, tone, analysis_json, lenses_json, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT(repo_id) DO UPDATE SET platform=$2, model=$3, tone=$4, analysis_json=$5, lenses_json=$6, updated_at=$7`,
    [row.repo_id, row.platform, row.model, row.tone, JSON.stringify(row.analysis), JSON.stringify(row.lenses ?? {}), now],
  );
}

export async function updateLenses(repoId: string, lenses: Lenses): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE repolens_scans SET lenses_json=$2, updated_at=$3 WHERE repo_id=$1`, [repoId, JSON.stringify(lenses), Date.now()]);
}

export async function getScan(repoId: string): Promise<ScanRow | null> {
  const db = await getDb();
  const rows = await db.select<any[]>(`SELECT * FROM repolens_scans WHERE repo_id=$1`, [repoId]);
  return rows[0] ? hydrate(rows[0]) : null;
}

export async function listScans(limit = 100): Promise<ScanRow[]> {
  const db = await getDb();
  const rows = await db.select<any[]>(`SELECT * FROM repolens_scans ORDER BY updated_at DESC LIMIT $1`, [limit]);
  return rows.map(hydrate);
}

export async function deleteScan(repoId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM repolens_scans WHERE repo_id=$1`, [repoId]);
}

function hydrate(r: any): ScanRow {
  return {
    repo_id: r.repo_id, platform: r.platform, model: r.model, tone: r.tone,
    analysis: JSON.parse(r.analysis_json), lenses: JSON.parse(r.lenses_json || "{}"),
    created_at: r.created_at, updated_at: r.updated_at,
  };
}
```

NOTE: match the actual db accessor (`getDb`, `db.execute`, `db.select`) to what `databaseDb.ts` uses — adjust names if the codebase differs.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/apps/archives/repolens/repolensDb.ts
git commit -m "feat(repolens): repolensDb CRUD over migration 0021"
```

## Task 21: Save scans + library list/open in the store

**Files:**
- Modify: `src/apps/archives/repolens/useRepoLens.ts`

- [ ] **Step 1: Extend the store**

Add to state: `library: ScanRow[]`, `loadLibrary: () => Promise<void>`, `openFromLibrary: (repoId: string) => Promise<void>`, `removeFromLibrary: (repoId: string) => Promise<void>`. After a successful `scan`, persist via `saveScan` and refresh `library`. Implementation:

```ts
// imports
import { saveScan, listScans, getScan, deleteScan, type ScanRow } from "./repolensDb";

// in state shape
  library: ScanRow[];
  loadLibrary: () => Promise<void>;
  openFromLibrary: (repoId: string) => Promise<void>;
  removeFromLibrary: (repoId: string) => Promise<void>;

// in create()
  library: [],
  loadLibrary: async () => set({ library: await listScans(100) }),
  openFromLibrary: async (repoId) => {
    const row = await getScan(repoId);
    if (row) set({ current: row.analysis, error: null });
  },
  removeFromLibrary: async (repoId) => { await deleteScan(repoId); await get().loadLibrary(); },

// at the end of a successful scan(), before set({ current: analysis, running: null }):
    await saveScan({ repo_id: repo.repo_id, platform: repo.platform, model: get().model.default_model, tone: get().tone, analysis });
    await get().loadLibrary();
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/apps/archives/repolens/useRepoLens.ts
git commit -m "feat(repolens): persist scans + library load/open/remove in store"
```

## Task 22: RepoLensLibrary.tsx + wire into the view

**Files:**
- Create: `src/apps/archives/repolens/RepoLensLibrary.tsx`
- Modify: `src/apps/archives/repolens/RepoLensView.tsx`

- [ ] **Step 1: Write the library grid**

Create `src/apps/archives/repolens/RepoLensLibrary.tsx`:

```tsx
import { useEffect } from "react";
import { useRepoLens } from "./useRepoLens";
import { deriveFit } from "./verdict";

export function RepoLensLibrary() {
  const { library, loadLibrary, openFromLibrary, removeFromLibrary } = useRepoLens();
  useEffect(() => { void loadLibrary(); }, [loadLibrary]);

  if (library.length === 0) {
    return <p style={{ color: "var(--t-tertiary)" }}>No scans yet. Paste a repository above and hit Scan.</p>;
  }
  return (
    <div className="rl-lib-grid">
      {library.map((row) => {
        const fit = deriveFit(row.analysis);
        return (
          <div key={row.repo_id} className="rl-lib-card" onClick={() => void openFromLibrary(row.repo_id)}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ wordBreak: "break-word" }}>{row.repo_id}</strong>
              <span className={`rl-chip rl-verdict-${fit.level}`}>{fit.label}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--t-tertiary)", margin: "6px 0" }}>
              {row.analysis.category || row.platform}{row.analysis.stars ? ` · ${row.analysis.stars}★` : ""}
            </div>
            <p style={{ fontSize: 13, margin: 0, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {row.analysis.eli5}
            </p>
            <button className="rl-btn" style={{ marginTop: 8, fontSize: 12, padding: "4px 8px" }}
              onClick={(e) => { e.stopPropagation(); void removeFromLibrary(row.repo_id); }}>Delete</button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Show library when no report is open**

In `RepoLensView.tsx`, replace the "Paste a repository above…" placeholder with `<RepoLensLibrary />` (import it). So `.rl-body` shows the report when `current`, else the library.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/apps/archives/repolens/RepoLensLibrary.tsx src/apps/archives/repolens/RepoLensView.tsx
git commit -m "feat(repolens): library grid of saved scans with verdict chips"
```

## Task 23: export.ts (port exporter.js, markdown) + test + export button

**Files:**
- Create: `src/apps/archives/repolens/export.ts`
- Test: `src/apps/archives/repolens/export.test.ts`
- Modify: `src/apps/archives/repolens/RepoLensReport.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/apps/archives/repolens/export.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toMarkdown, slugify } from "./export";

describe("export", () => {
  it("emits markdown with title + sections", () => {
    const md = toMarkdown({ repoId: "a/b", eli5: "hello", pros: ["p1"], cons: ["c1"], health: { score: 80 } });
    expect(md).toContain("# a/b");
    expect(md).toContain("## ELI5");
    expect(md).toContain("- p1");
    expect(md).toContain("_Generated by RepoLens._");
  });
  it("slugify", () => {
    expect(slugify("Facebook/React!")).toBe("facebook-react");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/export.test.ts`
Expected: FAIL.

- [ ] **Step 3: Port the markdown half of exporter.js**

Create `src/apps/archives/repolens/export.ts` — port `toMarkdown` and `slugify` from `repolens-main/exporter.js` verbatim (skip `toHtml`/`mdToHtml`/CSS — out of scope). Signatures: `export function toMarkdown(d: any): string` and `export function slugify(s: string): string`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Add an Export button to the report**

In `RepoLensReport.tsx`, add at the top of the returned tree (inside the header section) a button:

```tsx
import { toMarkdown, slugify } from "./export";
// ...
<button className="rl-btn" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => {
  const blob = new Blob([toMarkdown(a)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `${slugify(a.repoId || "repo")}.md`; link.click();
  URL.revokeObjectURL(url);
}}>Export .md</button>
```

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/apps/archives/repolens/export.ts src/apps/archives/repolens/export.test.ts src/apps/archives/repolens/RepoLensReport.tsx
git commit -m "feat(repolens): markdown export (port exporter.js) + report download button"
```

## Task 24: Settings — GitHub token field

**Files:**
- Modify: `src/features/settings/SettingsPanel.tsx`

- [ ] **Step 1: Add a GitHub token block under the Anthropic key**

Read `APIKeySection` in `src/features/settings/SettingsPanel.tsx` (around line 112). Below the existing API-key UI within that section, add a parallel block backed by `ipc.githubTokenStatus/Set/Clear`, mirroring the API-key field's status/draft/save/clear handlers. Minimal version:

```tsx
function GithubTokenField() {
  const [status, setStatus] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => { ipc.githubTokenStatus().then(setStatus).catch(() => setStatus(false)); }, []);
  return (
    <div style={{ marginTop: 18 }}>
      <label style={{ fontSize: 13, color: "var(--t-secondary)" }}>GitHub token (optional — raises RepoLens scan rate limit 60→5000/hr)</label>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input type="password" placeholder={status ? "token set" : "ghp_…"} value={draft}
          onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
        <button onClick={async () => { await ipc.githubTokenSet(draft.trim()); setDraft(""); setStatus(true); }}>Save</button>
        <button onClick={async () => { await ipc.githubTokenClear(); setStatus(false); }}>Clear</button>
      </div>
    </div>
  );
}
```

Render `<GithubTokenField />` at the end of `APIKeySection`'s JSX. (Match the existing section's input/button styling/classes rather than inline styles where the section already has them.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/SettingsPanel.tsx
git commit -m "feat(repolens): GitHub token field in Settings (keychain-backed)"
```

---

# PHASE 4 — Deep Dive lens

## Task 25: lenses.ts — Deep Dive prompt builders + parsers + tests

**Files:**
- Create: `src/apps/archives/repolens/lenses.ts`
- Test: `src/apps/archives/repolens/lenses.test.ts`

- [ ] **Step 1: Write the failing test (deepdive parsers)**

Create `src/apps/archives/repolens/lenses.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAtoms, parseLineage, parseFeynman } from "./lenses";

describe("deepdive parsers", () => {
  it("parseAtoms fills ids + defaults", () => {
    const r = parseAtoms(JSON.stringify({ atoms: [{ name: "Core", purpose: "p" }] }));
    expect(r.atoms[0].id).toBe("atom-1");
    expect(r.atoms[0].kind).toBe("module");
    expect(r.atoms[0].files).toEqual([]);
  });
  it("parseLineage drops links missing from/to", () => {
    const r = parseLineage(JSON.stringify({ links: [{ from: "a", to: "b" }, { from: "a" }], roots: ["a"], leaves: ["b"] }));
    expect(r.links.length).toBe(1);
    expect(r.links[0].relation).toBe("depends-on");
  });
  it("parseFeynman shapes questions + confidence", () => {
    const r = parseFeynman(JSON.stringify({ explanation: "e", questions: [{ q: "Q", a: "A" }], confidence: [{ claim: "c" }] }));
    expect(r.explanation).toBe("e");
    expect(r.questions[0].q).toBe("Q");
    expect(r.confidence[0].level).toBe("medium");
  });
  it("salvages fenced JSON", () => {
    expect(parseAtoms("```json\n{\"atoms\":[]}\n```").atoms).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/lenses.test.ts`
Expected: FAIL.

- [ ] **Step 3: Port the deepdive builders/parsers**

Create `src/apps/archives/repolens/lenses.ts`. Port from `repolens-main/deepdive.js` verbatim (the parser/prompt half — we do NOT port `fetchSource`, that's the Rust `repolens_fetch_source`):
- `extractJsonObject(rawText: string): any`
- `buildAtomsPrompt(repoData: RepoData, source: RepoSource, facts: null): string` (pass `facts = null`; `factsBlock(null)` returns "")
- `factsBlock(facts: any): string`
- `parseAtoms(rawText: string): DeepDive["atoms_result"]` — return `{ atoms: [...] }`
- `buildLineagePrompt(atoms): string`, `parseLineage(rawText): { links, roots, leaves }`
- `buildFeynmanPrompt(repoData, atoms, lineage): string`, `parseFeynman(rawText): {...}`
- `selectKeyFiles` is NOT needed in TS (Rust does it).

Add `import type { RepoData, RepoSource } from "./types";`. Copy all prompt strings exactly.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/lenses.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/lenses.ts src/apps/archives/repolens/lenses.test.ts
git commit -m "feat(repolens): Deep Dive prompt builders + parsers (port deepdive.js) + tests"
```

## Task 26: Deep Dive runner in the store + panel

**Files:**
- Modify: `src/apps/archives/repolens/useRepoLens.ts`
- Create: `src/apps/archives/repolens/lens/DeepDivePanel.tsx`
- Modify: `src/apps/archives/repolens/RepoLensReport.tsx`

- [ ] **Step 1: Add a `runLens` action + lens state**

In `useRepoLens.ts` add `lenses: Lenses` to state, reset to `{}` on each scan/open, and:

```ts
import { fetchSource } from "./fetch";
import { buildAtomsPrompt, parseAtoms, buildLineagePrompt, parseLineage, buildFeynmanPrompt, parseFeynman } from "./lenses";
import { updateLenses } from "./repolensDb";
import type { Lenses } from "./types";

// state
  lenses: Lenses;
  runDeepDive: () => Promise<void>;

// create()
  lenses: {},

  runDeepDive: async () => {
    const cur = get().current; if (!cur?.repoId) return;
    set({ running: "deepdive", error: null });
    try {
      const source = await fetchSource(cur.repoId);
      const atomsRaw = await enqueueClaude(get().model, "deepdive", withTone(get().tone, buildAtomsPrompt(asRepoData(cur), source, null)));
      const atomsRes = parseAtoms(atomsRaw);
      const lineageRaw = await enqueueClaude(get().model, "deepdive", buildLineagePrompt(atomsRes.atoms));
      const lineage = parseLineage(lineageRaw);
      const feynRaw = await enqueueClaude(get().model, "deepdive", buildFeynmanPrompt(asRepoData(cur), atomsRes.atoms, lineage));
      const feynman = parseFeynman(feynRaw);
      const deepdive = { atoms: atomsRes.atoms, lineage, feynman };
      const lenses = { ...get().lenses, deepdive };
      set({ lenses, running: null });
      await updateLenses(cur.repoId, lenses);
    } catch (e) { set({ running: null, error: e instanceof Error ? e.message : String(e) }); }
  },
```

Add a small helper near the top of the file (the lens prompts only read a few RepoData fields off the analysis):

```ts
function asRepoData(a: RepoAnalysis) {
  return { platform: a.platform ?? "github", repo_id: a.repoId ?? "", description: a.description ?? "", language: a.language ?? "", license: a.license ?? "", stars: a.stars ?? 0, readme: "", languages: a.languages ?? [], dependencies: [] } as any;
}
```

Also set `lenses: row.lenses` in `openFromLibrary` (so saved lens results reappear) and `lenses: {}` at the start of `scan`.

- [ ] **Step 2: Write the panel**

Create `src/apps/archives/repolens/lens/DeepDivePanel.tsx`:

```tsx
import type { DeepDive } from "../types";

export function DeepDivePanel({ d }: { d: DeepDive }) {
  return (
    <div className="rl-section">
      <h3>Deep Dive — Feynman explanation</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{d.feynman.explanation}</p>

      <h3 style={{ marginTop: 16 }}>Atoms</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {d.atoms.map((a) => <li key={a.id}><strong>{a.name}</strong> <em>({a.kind})</em> — {a.purpose}{a.files.length ? ` · ${a.files.join(", ")}` : ""}</li>)}
      </ul>

      <h3 style={{ marginTop: 16 }}>Lineage</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {d.lineage.links.map((l, i) => <li key={i}>{l.from} <span style={{ color: "var(--repolens-green)" }}>{l.relation}</span> {l.to}{l.why ? ` — ${l.why}` : ""}</li>)}
      </ul>

      {d.feynman.questions.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Self-test</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {d.feynman.questions.map((q, i) => <li key={i}><strong>{q.q}</strong> — {q.a}</li>)}
          </ul>
        </>
      )}
      {d.feynman.gaps.length > 0 && <p style={{ marginTop: 12, color: "var(--t-tertiary)" }}>Gaps: {d.feynman.gaps.join("; ")}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Add a lens rail to the report**

In `RepoLensReport.tsx`, read lens state + actions from the store (import `useRepoLens`) and the panel. After the header, render a rail:

```tsx
import { useRepoLens } from "./useRepoLens";
import { DeepDivePanel } from "./lens/DeepDivePanel";
// inside the component:
const { lenses, running, runDeepDive } = useRepoLens();
// after the header section JSX:
<div className="rl-lens-rail">
  <button className="rl-btn" disabled={running !== null} onClick={() => void runDeepDive()}>
    {running === "deepdive" ? "Running Deep Dive…" : lenses.deepdive ? "Re-run Deep Dive" : "Deep Dive"}
  </button>
</div>
{lenses.deepdive && <DeepDivePanel d={lenses.deepdive} />}
```

(Convert `RepoLensReport` to read `a` from `useRepoLens(s => s.current)` OR keep the `a` prop and additionally pull lens state from the store — either is fine; if keeping the prop, just add the store hooks for lenses/running/actions.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/useRepoLens.ts src/apps/archives/repolens/lens/DeepDivePanel.tsx src/apps/archives/repolens/RepoLensReport.tsx
git commit -m "feat(repolens): Deep Dive runner (3-call chain) + panel + lens rail"
```

---

# PHASE 5 — SKTPG lens

## Task 27: SKTPG prompt + parser (extend lenses.ts) + test

**Files:**
- Modify: `src/apps/archives/repolens/lenses.ts`, `src/apps/archives/repolens/lenses.test.ts`

- [ ] **Step 1: Add the failing SKTPG parser test**

Append to `lenses.test.ts`:

```ts
import { parseSktpg } from "./lenses";
describe("sktpg parser", () => {
  it("clamps score 0-100 + derives band", () => {
    const r = parseSktpg(JSON.stringify({ score: { value: 250 }, thesis: { becoming: "x" } }));
    expect(r.score.value).toBe(100);
    expect(r.score.band).toBe("Urgent");
    expect(r.thesis.becoming).toBe("x");
  });
  it("defaults evidence to Unknown", () => {
    const r = parseSktpg(JSON.stringify({ base_rate: { evidence: "bogus" } }));
    expect(r.base_rate.evidence).toBe("Unknown");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/lenses.test.ts`
Expected: FAIL — `parseSktpg` not exported.

- [ ] **Step 3: Port sktpg.js into lenses.ts**

Append to `src/apps/archives/repolens/lenses.ts` the port of `repolens-main/sktpg.js`:
- `export const SKTPG_BANDS = ['Noise','Interesting','Watchlist','Actionable','Urgent'];`
- `export function buildSktpgPrompt(repoData: RepoData, source: RepoSource): string` (copy `sourceContext` + prompt verbatim)
- `export function parseSktpg(rawText: string): Sktpg` (copy the validation: `EVIDENCE`/`FLAGS` sets, score clamp, band derive). Reuse the local `extractJsonObject` already in the file.

Add `import type { Sktpg } from "./types";`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/lenses.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/lenses.ts src/apps/archives/repolens/lenses.test.ts
git commit -m "feat(repolens): SKTPG prompt + parser (port sktpg.js) + tests"
```

## Task 28: SKTPG runner + panel

**Files:**
- Modify: `src/apps/archives/repolens/useRepoLens.ts`, `src/apps/archives/repolens/RepoLensReport.tsx`
- Create: `src/apps/archives/repolens/lens/SktpgPanel.tsx`

- [ ] **Step 1: Add `runSktpg` to the store**

In `useRepoLens.ts`:

```ts
import { buildSktpgPrompt, parseSktpg } from "./lenses";

  runSktpg: () => Promise<void>;

  runSktpg: async () => {
    const cur = get().current; if (!cur?.repoId) return;
    set({ running: "sktpg", error: null });
    try {
      const source = await fetchSource(cur.repoId);
      const raw = await enqueueClaude(get().model, "sktpg", withTone(get().tone, buildSktpgPrompt(asRepoData(cur), source)));
      const sktpg = parseSktpg(raw);
      const lenses = { ...get().lenses, sktpg };
      set({ lenses, running: null });
      await updateLenses(cur.repoId, lenses);
    } catch (e) { set({ running: null, error: e instanceof Error ? e.message : String(e) }); }
  },
```

- [ ] **Step 2: Write the panel**

Create `src/apps/archives/repolens/lens/SktpgPanel.tsx`:

```tsx
import type { Sktpg } from "../types";

export function SktpgPanel({ s }: { s: Sktpg }) {
  return (
    <div className="rl-section">
      <h3>SKTPG — {s.score.value}/100 · {s.score.band}</h3>
      <p><strong>Becoming:</strong> {s.thesis.becoming}</p>
      <p><strong>Forced next:</strong> {s.thesis.forced_next}</p>
      <p><strong>Opportunity:</strong> {s.thesis.opportunity}</p>
      <p><strong>Before consensus:</strong> {s.thesis.before_consensus}</p>
      <p><strong>Wrong if:</strong> {s.thesis.wrong_if}</p>

      {s.forecast && (
        <>
          <h3 style={{ marginTop: 14 }}>Forecast</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Base:</strong> {s.forecast.base}</li>
            <li><strong>Bull:</strong> {s.forecast.bull}</li>
            <li><strong>Bear:</strong> {s.forecast.bear}</li>
            <li><strong>Wildcard:</strong> {s.forecast.wildcard}</li>
          </ul>
        </>
      )}
      {s.premortem.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Pre-mortem</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {s.premortem.map((p, i) => <li key={i}>[{p.likelihood}] {p.kill_path}{p.survives ? " (survivable)" : ""}</li>)}
          </ul>
        </>
      )}
      {s.actions.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Actions</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {s.actions.map((a, i) => <li key={i}><strong>{a.timeframe}:</strong> {a.action} — {a.why_now}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add to the lens rail**

In `RepoLensReport.tsx` add a SKTPG button next to Deep Dive and render `{lenses.sktpg && <SktpgPanel s={lenses.sktpg} />}` (import `SktpgPanel`, pull `runSktpg` from the store).

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/useRepoLens.ts src/apps/archives/repolens/lens/SktpgPanel.tsx src/apps/archives/repolens/RepoLensReport.tsx
git commit -m "feat(repolens): SKTPG runner + forecast panel"
```

---

# PHASE 6 — Synergies lens

## Task 29: Synergies prompt + parser (extend lenses.ts) + test

**Files:**
- Modify: `src/apps/archives/repolens/lenses.ts`, `src/apps/archives/repolens/lenses.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `lenses.test.ts`:

```ts
import { buildSynergiesPrompt, parseSynergies } from "./lenses";
describe("synergies", () => {
  it("builds a prompt listing candidates", () => {
    const p = buildSynergiesPrompt({ repoId: "a/b", eli5: "x", category: "DB", language: "Rust" } as any, [{ repoId: "c/d", category: "UI", eli5: "ui" }] as any);
    expect(p).toContain("a/b");
    expect(p).toContain("c/d");
  });
  it("parses synergies array", () => {
    const r = parseSynergies(JSON.stringify({ synergies: [{ repoId: "x/y", category: "C", synergy: "S", in_library: true }] }));
    expect(r.synergies[0].repoId).toBe("x/y");
    expect(r.synergies[0].in_library).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/lenses.test.ts`
Expected: FAIL.

- [ ] **Step 3: Port synergies.js**

Append to `lenses.ts` the port of `repolens-main/synergies.js`:
- `export function buildSynergiesPrompt(repoData: { repoId: string; eli5?: string; description?: string; category?: string; language?: string }, candidates: { repoId: string; category?: string; eli5?: string }[]): string` (copy prompt verbatim)
- `export function parseSynergies(rawText: string): Synergies`

Add `import type { Synergies } from "./types";`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/lenses.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/lenses.ts src/apps/archives/repolens/lenses.test.ts
git commit -m "feat(repolens): Synergies prompt + parser (port synergies.js) + tests"
```

## Task 30: Synergies runner (library-grounded) + panel

**Files:**
- Modify: `src/apps/archives/repolens/useRepoLens.ts`, `src/apps/archives/repolens/RepoLensReport.tsx`
- Create: `src/apps/archives/repolens/lens/SynergiesPanel.tsx`

- [ ] **Step 1: Add `runSynergies` (candidates = other library scans)**

In `useRepoLens.ts`:

```ts
import { buildSynergiesPrompt, parseSynergies } from "./lenses";

  runSynergies: () => Promise<void>;

  runSynergies: async () => {
    const cur = get().current; if (!cur?.repoId) return;
    set({ running: "synergies", error: null });
    try {
      const candidates = get().library
        .filter((r) => r.repo_id !== cur.repoId)
        .slice(0, 30)
        .map((r) => ({ repoId: r.repo_id, category: r.analysis.category, eli5: r.analysis.eli5 }));
      const target = { repoId: cur.repoId, eli5: cur.eli5, description: cur.description, category: cur.category, language: cur.language };
      const raw = await enqueueClaude(get().model, "synergies", withTone(get().tone, buildSynergiesPrompt(target, candidates)));
      const synergies = parseSynergies(raw);
      const lenses = { ...get().lenses, synergies };
      set({ lenses, running: null });
      await updateLenses(cur.repoId, lenses);
    } catch (e) { set({ running: null, error: e instanceof Error ? e.message : String(e) }); }
  },
```

- [ ] **Step 2: Write the panel**

Create `src/apps/archives/repolens/lens/SynergiesPanel.tsx`:

```tsx
import type { Synergies } from "../types";

export function SynergiesPanel({ s }: { s: Synergies }) {
  return (
    <div className="rl-section">
      <h3>Synergies — pairs well with</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {s.synergies.map((x, i) => (
          <li key={i}>
            <strong>{x.repoId}</strong> <em>({x.category})</em>{x.in_library ? " · in your library" : ""} — {x.synergy}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Add to the lens rail**

In `RepoLensReport.tsx` add a Synergies button + `{lenses.synergies && <SynergiesPanel s={lenses.synergies} />}`.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/apps/archives/repolens/useRepoLens.ts src/apps/archives/repolens/lens/SynergiesPanel.tsx src/apps/archives/repolens/RepoLensReport.tsx
git commit -m "feat(repolens): Synergies runner (library-grounded) + panel"
```

---

# PHASE 7 — GitLab / npm / PyPI platforms

## Task 31: Implement the three remaining fetchers in Rust

**Files:**
- Modify: `src-tauri/src/repolens.rs`

- [ ] **Step 1: Replace the `fetch_gitlab/npm/pypi` stubs**

In `src-tauri/src/repolens.rs`, replace the three stub fns with real implementations porting `fetcher.js` (`fetchGitLab`/`fetchNpm`/`fetchPyPI` + `parsePyDep`):

```rust
async fn fetch_gitlab(repo_id: &str) -> Result<RepoData, String> {
    let enc = urlencoding(repo_id);
    let meta = get_json(&format!("https://gitlab.com/api/v4/projects/{enc}")).await?;
    let mut readme = String::new();
    if let Ok(r) = http().get(format!("https://gitlab.com/api/v4/projects/{enc}/repository/files/README.md/raw?ref=HEAD")).send().await {
        if r.status().is_success() { readme = r.text().await.unwrap_or_default(); }
    }
    let mut languages = vec![];
    if let Ok(r) = http().get(format!("https://gitlab.com/api/v4/projects/{enc}/languages")).send().await {
        if let Ok(serde_json::Value::Object(m)) = r.json::<serde_json::Value>().await {
            let mut v: Vec<(&String, f64)> = m.iter().map(|(k, val)| (k, val.as_f64().unwrap_or(0.0))).collect();
            v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            languages = v.into_iter().take(5).map(|(name, pct)| LangPct { name: name.clone(), pct: pct.round() as u32 }).collect();
        }
    }
    Ok(RepoData {
        platform: "gitlab".into(), repo_id: repo_id.into(),
        description: meta.get("description").and_then(|v| v.as_str()).unwrap_or("").into(),
        language: "Unknown".into(), license: "Unknown".into(),
        stars: meta.get("star_count").and_then(|v| v.as_u64()).unwrap_or(0),
        readme, languages, dependencies: vec![],
    })
}

async fn fetch_npm(repo_id: &str) -> Result<RepoData, String> {
    let data = get_json(&format!("https://registry.npmjs.org/{repo_id}")).await?;
    let latest = data.pointer("/dist-tags/latest").and_then(|v| v.as_str()).unwrap_or("");
    let deps = data.pointer(&format!("/versions/{latest}/dependencies")).and_then(|v| v.as_object());
    let dependencies = deps.map(|m| m.iter().take(30).map(|(name, ver)| Dep { name: name.clone(), version: ver.as_str().unwrap_or("").to_string() }).collect()).unwrap_or_default();
    let readme: String = data.get("readme").and_then(|v| v.as_str()).unwrap_or("").chars().take(8000).collect();
    Ok(RepoData {
        platform: "npm".into(), repo_id: repo_id.into(),
        description: data.get("description").and_then(|v| v.as_str()).unwrap_or("").into(),
        language: "JavaScript".into(),
        license: data.pointer(&format!("/versions/{latest}/license")).and_then(|v| v.as_str()).unwrap_or("Unknown").into(),
        stars: 0, readme, languages: vec![LangPct { name: "JavaScript".into(), pct: 100 }], dependencies,
    })
}

fn parse_py_dep(spec: &str) -> Option<Dep> {
    let head = spec.split(';').next().unwrap_or("").trim();
    let name: String = head.chars().take_while(|c| c.is_alphanumeric() || "._-".contains(*c)).collect();
    if name.is_empty() { return None; }
    let version = head[name.len()..].replace(['(', ')'], "").trim().to_string();
    Some(Dep { name, version })
}

async fn fetch_pypi(repo_id: &str) -> Result<RepoData, String> {
    let data = get_json(&format!("https://pypi.org/pypi/{repo_id}/json")).await?;
    let info = data.get("info").cloned().unwrap_or(serde_json::Value::Null);
    let dependencies = info.get("requires_dist").and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).filter_map(parse_py_dep).take(30).collect())
        .unwrap_or_default();
    let readme: String = info.get("description").and_then(|v| v.as_str()).unwrap_or("").chars().take(8000).collect();
    Ok(RepoData {
        platform: "pypi".into(), repo_id: repo_id.into(),
        description: info.get("summary").and_then(|v| v.as_str()).unwrap_or("").into(),
        language: "Python".into(),
        license: info.get("license").and_then(|v| v.as_str()).unwrap_or("Unknown").into(),
        stars: 0, readme, languages: vec![LangPct { name: "Python".into(), pct: 100 }], dependencies,
    })
}
```

- [ ] **Step 2: Add a parse_py_dep unit test**

In the `#[cfg(test)] mod tests`, add:

```rust
    #[test]
    fn parses_pypi_deps() {
        assert_eq!(parse_py_dep("numpy (>=1.20)").unwrap().name, "numpy");
        assert_eq!(parse_py_dep("requests>=2.0").unwrap().name, "requests");
        assert!(parse_py_dep("; extra=='dev'").is_none());
    }
```

- [ ] **Step 3: Verify**

Run: `cd src-tauri && cargo test repolens 2>&1 | tail -6`
Expected: PASS (selectKeyFiles + parse_py_dep).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/repolens.rs
git commit -m "feat(repolens): gitlab/npm/pypi fetchers (port fetcher.js)"
```

NOTE: Deep Dive/SKTPG still degrade to README-only for non-GitHub (the Rust `repolens_fetch_source` returns `degraded` for them) — prompts already handle empty source.

---

# PHASE 8 — Final verification + log

## Task 32: Full green + project log

**Files:**
- Modify: `CLAUDE.md` (session log entry)

- [ ] **Step 1: Full suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build && (cd src-tauri && cargo check && cargo test)`
Expected: all green. Note the new frontend test count.

- [ ] **Step 2: Add a CLAUDE.md session-log entry**

Prepend a dated entry under "## Session log" summarizing: RepoLens added as an Archives section (darker-green accent), TS logic + 3 thin Rust commands, GitHub-token keychain, migration 0021, core scan + Deep Dive/SKTPG/Synergies, library + Markdown export, model/tone switching. Note the **`tauri dev` restart** requirement (Rust module + migration 0021) and that full feature set is the eventual roadmap (spec at `docs/superpowers/specs/2026-06-13-repolens-archives-design.md`).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: log RepoLens Archives section (core + Deep Dive/SKTPG/Synergies)"
```

- [ ] **Step 4: User smoke test (manual)**

Restart `tauri dev`. Archives → RepoLens → scan a GitHub repo → core report → run each lens → export .md → reopen from library. Try an npm/pypi/gitlab repo. Set a GitHub token in Settings if rate-limited.

---

## Notes for the implementer

- **Verbatim ports**: the prompt strings and validation allow-lists in `prompt.js`, `parser.js`, `taxonomy.js`, `tone.js`, the lens files, and `exporter.js` are tuned — copy them exactly, only adding TS types. Keep `repolens-main` open alongside.
- **DB accessor**: Task 20 assumes `getDb()`/`db.execute`/`db.select`. Before writing it, open `src/apps/archives/database/databaseDb.ts` and match the codebase's actual accessor names.
- **RepoLensReport store coupling**: Tasks 26/28/30 add lens buttons. Simplest is to have `RepoLensReport` pull `lenses/running/runDeepDive/runSktpg/runSynergies` from `useRepoLens` while still receiving `a` (the analysis) as a prop.
- **No parallel claude**: every AI call goes through `enqueueClaude` — never call `ipc.repolensClaudeCall` directly from components.
