//! RepoLens — the thin Rust surface for the Archives RepoLens section.
//! Three jobs: (1) drive the `claude` CLI for an AI call returning a JSON
//! envelope (model-parameterized, draws on the Max subscription), and
//! (2) fetch public registry data (github/gitlab/npm/pypi) + (3) a GitHub file
//! tree for the source-aware lenses. All product logic (prompts, parsers,
//! taxonomy, verdict) lives in TypeScript; this module is just I/O.

use serde::Serialize;
use tokio::process::Command;

// ── select_key_files (mirrors deepdive.js) ───────────────────────────────────

const PRIORITY_FILES: &[&str] = &[
    "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "requirements.txt",
    "setup.py", "pom.xml", "build.gradle", "composer.json", "Gemfile",
    "src/index.ts", "src/index.js", "src/index.tsx", "index.ts", "index.js",
    "src/main.ts", "src/main.js", "src/main.py", "main.py", "app.py",
    "src/lib.rs", "src/main.rs", "main.go", "src/app.ts", "src/App.tsx",
];
const MAX_KEY_FILES: usize = 8;
const CODE_EXT: &[&str] = &[
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb", "php", "c", "cc",
    "cpp", "h", "hpp", "kt", "swift",
];

fn is_code(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .map(|e| CODE_EXT.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Pick the most revealing files present in the tree: priority list first, then
/// shallow (depth ≤ 2) source files.
pub fn select_key_files(paths: &[String]) -> Vec<String> {
    let set: std::collections::HashSet<&str> = paths.iter().map(|s| s.as_str()).collect();
    let mut picked: Vec<String> = Vec::new();
    for p in PRIORITY_FILES {
        if set.contains(p) && !picked.iter().any(|x| x == p) {
            picked.push((*p).to_string());
        }
        if picked.len() >= MAX_KEY_FILES {
            return picked;
        }
    }
    let mut shallow: Vec<&String> = paths
        .iter()
        .filter(|p| is_code(p) && p.split('/').count() <= 2 && !picked.iter().any(|x| x == *p))
        .collect();
    shallow.sort_by(|a, b| {
        a.split('/')
            .count()
            .cmp(&b.split('/').count())
            .then(a.len().cmp(&b.len()))
    });
    for p in shallow {
        picked.push(p.clone());
        if picked.len() >= MAX_KEY_FILES {
            break;
        }
    }
    picked
}

// ── shapes ───────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct RepoLensReply {
    pub result: String,
    pub cost: f64,
    pub model: String,
}

#[derive(Serialize)]
pub struct LangPct {
    pub name: String,
    pub pct: u32,
}

#[derive(Serialize)]
pub struct Dep {
    pub name: String,
    pub version: String,
}

#[derive(Serialize)]
pub struct RepoData {
    pub platform: String,
    pub repo_id: String,
    pub description: String,
    pub language: String,
    pub license: String,
    pub stars: u64,
    pub readme: String,
    pub languages: Vec<LangPct>,
    pub dependencies: Vec<Dep>,
}

#[derive(Serialize)]
pub struct SourceFile {
    pub path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct RepoSource {
    pub tree: Vec<String>,
    pub files: Vec<SourceFile>,
    pub degraded: bool,
}

// ── helpers ──────────────────────────────────────────────────────────────────

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

async fn get_json(url: &str) -> Result<serde_json::Value, String> {
    let r = http().get(url).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {} for {url}", r.status()));
    }
    r.json().await.map_err(|e| e.to_string())
}

async fn gh_get_json(url: &str) -> Result<serde_json::Value, String> {
    let r = gh_headers(http().get(url))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {} for {url}", r.status()));
    }
    r.json().await.map_err(|e| e.to_string())
}

fn b64_decode(s: &str) -> Option<String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s.replace('\n', ""))
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn bytes_to_comp(langs: &serde_json::Map<String, serde_json::Value>) -> Vec<LangPct> {
    let total: f64 = langs.values().filter_map(|v| v.as_f64()).sum();
    if total == 0.0 {
        return vec![];
    }
    let mut v: Vec<(&String, f64)> = langs
        .iter()
        .map(|(k, b)| (k, b.as_f64().unwrap_or(0.0)))
        .collect();
    v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    v.into_iter()
        .take(5)
        .map(|(name, b)| LangPct {
            name: name.clone(),
            pct: (b / total * 100.0).round() as u32,
        })
        .collect()
}

// ── the model call (stdin + json envelope) ───────────────────────────────────

#[tauri::command]
pub async fn repolens_claude_call(prompt: String, model: String) -> Result<RepoLensReply, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    let model = if model.trim().is_empty() {
        "claude-sonnet-4-6".to_string()
    } else {
        model
    };
    let mut cmd = Command::new("claude");
    cmd.args(["-p", "--output-format", "json", "--model", &model]);
    if let Some(home) = std::env::var_os("HOME") {
        cmd.current_dir(home);
    }
    cmd.env("PATH", crate::claude_cli::augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
    } // stdin dropped → EOF, claude starts

    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "claude exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let env: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("bad claude envelope: {e}"))?;
    let is_error = env
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let bad_subtype = env
        .get("subtype")
        .and_then(|v| v.as_str())
        .map(|s| s != "success")
        .unwrap_or(false);
    if is_error || bad_subtype {
        return Err(format!(
            "claude returned error: {}",
            env.get("result").and_then(|v| v.as_str()).unwrap_or("unknown")
        ));
    }
    let result = env
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or("no .result in claude envelope")?
        .to_string();
    let cost = env
        .get("total_cost_usd")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    Ok(RepoLensReply {
        result,
        cost,
        model,
    })
}

// ── fetch repo data ──────────────────────────────────────────────────────────

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
    let meta = gh_get_json(&format!("https://api.github.com/repos/{repo_id}")).await?;

    let mut readme = String::new();
    if let Ok(r) = gh_headers(http().get(format!("https://api.github.com/repos/{repo_id}/readme")))
        .send()
        .await
    {
        if r.status().is_success() {
            if let Ok(j) = r.json::<serde_json::Value>().await {
                if j.get("encoding").and_then(|v| v.as_str()) == Some("base64") {
                    if let Some(c) = j.get("content").and_then(|v| v.as_str()) {
                        readme = b64_decode(c).unwrap_or_default();
                    }
                }
            }
        }
    }

    let mut languages = vec![];
    if let Ok(r) = gh_headers(http().get(format!(
        "https://api.github.com/repos/{repo_id}/languages"
    )))
    .send()
    .await
    {
        if r.status().is_success() {
            if let Ok(serde_json::Value::Object(m)) = r.json::<serde_json::Value>().await {
                languages = bytes_to_comp(&m);
            }
        }
    }
    let language = meta
        .get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();
    if languages.is_empty() && language != "Unknown" {
        languages.push(LangPct {
            name: language.clone(),
            pct: 100,
        });
    }

    Ok(RepoData {
        platform: "github".into(),
        repo_id: repo_id.into(),
        description: meta
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
        language,
        license: meta
            .pointer("/license/spdx_id")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .into(),
        stars: meta
            .get("stargazers_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        readme,
        languages,
        dependencies: vec![],
    })
}

async fn fetch_gitlab(repo_id: &str) -> Result<RepoData, String> {
    let enc = urlencode(repo_id);
    let meta = get_json(&format!("https://gitlab.com/api/v4/projects/{enc}")).await?;
    let mut readme = String::new();
    if let Ok(r) = http()
        .get(format!(
            "https://gitlab.com/api/v4/projects/{enc}/repository/files/README.md/raw?ref=HEAD"
        ))
        .send()
        .await
    {
        if r.status().is_success() {
            readme = r.text().await.unwrap_or_default();
        }
    }
    let mut languages = vec![];
    if let Ok(r) = http()
        .get(format!("https://gitlab.com/api/v4/projects/{enc}/languages"))
        .send()
        .await
    {
        if let Ok(serde_json::Value::Object(m)) = r.json::<serde_json::Value>().await {
            let mut v: Vec<(&String, f64)> = m
                .iter()
                .map(|(k, val)| (k, val.as_f64().unwrap_or(0.0)))
                .collect();
            v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            languages = v
                .into_iter()
                .take(5)
                .map(|(name, pct)| LangPct {
                    name: name.clone(),
                    pct: pct.round() as u32,
                })
                .collect();
        }
    }
    Ok(RepoData {
        platform: "gitlab".into(),
        repo_id: repo_id.into(),
        description: meta
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
        language: "Unknown".into(),
        license: "Unknown".into(),
        stars: meta.get("star_count").and_then(|v| v.as_u64()).unwrap_or(0),
        readme,
        languages,
        dependencies: vec![],
    })
}

async fn fetch_npm(repo_id: &str) -> Result<RepoData, String> {
    let data = get_json(&format!("https://registry.npmjs.org/{repo_id}")).await?;
    let latest = data
        .pointer("/dist-tags/latest")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let dependencies = data
        .pointer(&format!("/versions/{latest}/dependencies"))
        .and_then(|v| v.as_object())
        .map(|m| {
            m.iter()
                .take(30)
                .map(|(name, ver)| Dep {
                    name: name.clone(),
                    version: ver.as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let readme: String = data
        .get("readme")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(8000)
        .collect();
    Ok(RepoData {
        platform: "npm".into(),
        repo_id: repo_id.into(),
        description: data
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
        language: "JavaScript".into(),
        license: data
            .pointer(&format!("/versions/{latest}/license"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .into(),
        stars: 0,
        readme,
        languages: vec![LangPct {
            name: "JavaScript".into(),
            pct: 100,
        }],
        dependencies,
    })
}

fn parse_py_dep(spec: &str) -> Option<Dep> {
    let head = spec.split(';').next().unwrap_or("").trim();
    let name: String = head
        .chars()
        .take_while(|c| c.is_alphanumeric() || "._-".contains(*c))
        .collect();
    if name.is_empty() {
        return None;
    }
    let version = head[name.len()..].replace(['(', ')'], "").trim().to_string();
    Some(Dep { name, version })
}

async fn fetch_pypi(repo_id: &str) -> Result<RepoData, String> {
    let data = get_json(&format!("https://pypi.org/pypi/{repo_id}/json")).await?;
    let info = data.get("info").cloned().unwrap_or(serde_json::Value::Null);
    let dependencies = info
        .get("requires_dist")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .filter_map(parse_py_dep)
                .take(30)
                .collect()
        })
        .unwrap_or_default();
    let readme: String = info
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(8000)
        .collect();
    Ok(RepoData {
        platform: "pypi".into(),
        repo_id: repo_id.into(),
        description: info
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
        language: "Python".into(),
        license: info
            .get("license")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .into(),
        stars: 0,
        readme,
        languages: vec![LangPct {
            name: "Python".into(),
            pct: 100,
        }],
        dependencies,
    })
}

// ── fetch source (GitHub only; degrades otherwise) ───────────────────────────

#[tauri::command]
pub async fn repolens_fetch_source(repo_id: String) -> Result<RepoSource, String> {
    let meta = gh_get_json(&format!("https://api.github.com/repos/{repo_id}")).await?;
    let branch = meta
        .get("default_branch")
        .and_then(|v| v.as_str())
        .unwrap_or("main")
        .to_string();
    let tree_json = gh_get_json(&format!(
        "https://api.github.com/repos/{repo_id}/git/trees/{branch}?recursive=1"
    ))
    .await?;
    let all_paths: Vec<String> = tree_json
        .get("tree")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|e| e.get("type").and_then(|v| v.as_str()) == Some("blob"))
                .filter_map(|e| e.get("path").and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let tree: Vec<String> = all_paths.iter().take(200).cloned().collect();

    let mut files = vec![];
    for path in select_key_files(&all_paths) {
        let enc = path
            .split('/')
            .map(urlencode)
            .collect::<Vec<_>>()
            .join("/");
        if let Ok(resp) = gh_headers(http().get(format!(
            "https://api.github.com/repos/{repo_id}/contents/{enc}"
        )))
        .send()
        .await
        {
            if let Ok(j) = resp.json::<serde_json::Value>().await {
                if j.get("encoding").and_then(|v| v.as_str()) == Some("base64") {
                    if let Some(c) = j.get("content").and_then(|v| v.as_str()) {
                        if let Some(decoded) = b64_decode(c) {
                            let content: String = decoded.chars().take(2500).collect();
                            files.push(SourceFile { path, content });
                        }
                    }
                }
            }
        }
    }
    let degraded = files.is_empty() && tree.is_empty();
    Ok(RepoSource {
        tree,
        files,
        degraded,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prioritizes_manifests_then_shallow() {
        let paths = vec![
            "README.md".to_string(),
            "package.json".to_string(),
            "src/index.ts".to_string(),
            "deep/nested/thing.ts".to_string(),
            "util.ts".to_string(),
        ];
        let picked = select_key_files(&paths);
        assert_eq!(picked[0], "package.json");
        assert!(picked.contains(&"src/index.ts".to_string()));
        assert!(picked.contains(&"util.ts".to_string()));
        assert!(!picked.contains(&"deep/nested/thing.ts".to_string()));
    }

    #[test]
    fn parses_pypi_deps() {
        assert_eq!(parse_py_dep("numpy (>=1.20)").unwrap().name, "numpy");
        assert_eq!(parse_py_dep("requests>=2.0").unwrap().name, "requests");
        assert!(parse_py_dep("; extra=='dev'").is_none());
    }
}
