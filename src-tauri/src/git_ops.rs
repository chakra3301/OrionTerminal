//! Git integration (Phase 1.4) — status, staging, commit/push, branches,
//! HEAD file content for gutter diffs, blame. Shells out to the `git`
//! binary — no libgit2 dependency.

use serde::Serialize;
use std::process::Command;

const DIFF_CAP: usize = 65_536;

#[derive(Serialize)]
pub struct GitFileStatus {
    /// Project-relative path.
    pub path: String,
    /// Index (staged) status letter: ' ', 'M', 'A', 'D', 'R', '?', …
    pub index: String,
    /// Worktree (unstaged) status letter.
    pub worktree: String,
}

#[derive(Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: i64,
    pub behind: i64,
    pub files: Vec<GitFileStatus>,
    pub is_repo: bool,
}

/// `git status --porcelain=v1 --branch` parsed into a structured summary.
#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String> {
    let raw = match run_git(&root, &["status", "--porcelain=v1", "--branch"]) {
        Ok(s) => s,
        Err(e) if e.contains("not a git repository") => {
            return Ok(GitStatus {
                branch: String::new(),
                ahead: 0,
                behind: 0,
                files: vec![],
                is_repo: false,
            });
        }
        Err(e) => return Err(e),
    };

    let mut branch = String::new();
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            // "main...origin/main [ahead 2, behind 1]" | "No commits yet on main"
            let name = rest.split("...").next().unwrap_or(rest);
            branch = name
                .trim_start_matches("No commits yet on ")
                .trim()
                .to_string();
            if let Some(brackets) = rest.split('[').nth(1) {
                for part in brackets.trim_end_matches(']').split(',') {
                    let part = part.trim();
                    if let Some(n) = part.strip_prefix("ahead ") {
                        ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix("behind ") {
                        behind = n.parse().unwrap_or(0);
                    }
                }
            }
        } else if line.len() >= 3 {
            let index = line[0..1].to_string();
            let worktree = line[1..2].to_string();
            // Renames look like "old -> new" — keep the new path.
            let raw_path = line[3..].trim();
            let path = raw_path.split(" -> ").last().unwrap_or(raw_path);
            files.push(GitFileStatus {
                path: unquote(path),
                index,
                worktree,
            });
        }
    }
    Ok(GitStatus {
        branch,
        ahead,
        behind,
        files,
        is_repo: true,
    })
}

/// File content at HEAD (empty string for files new since HEAD) — the
/// baseline for editor gutter diff markers.
#[tauri::command]
pub fn git_head_content(root: String, path: String) -> Result<String, String> {
    match run_git(&root, &["show", &format!("HEAD:{}", path)]) {
        Ok(s) => Ok(s),
        Err(e)
            if e.contains("does not exist")
                || e.contains("exists on disk, but not in")
                || e.contains("fatal: path") =>
        {
            Ok(String::new())
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add", "--"];
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    args.extend(refs);
    run_git(&root, &args).map(|_| ())
}

#[tauri::command]
pub fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["restore", "--staged", "--"];
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    args.extend(refs);
    run_git(&root, &args).map(|_| ())
}

/// Discard worktree changes to a file (restore from index/HEAD).
#[tauri::command]
pub fn git_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["checkout", "--"];
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    args.extend(refs);
    run_git(&root, &args).map(|_| ())
}

#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("commit message is empty".into());
    }
    run_git(&root, &["commit", "-m", &message])
}

/// Push is the only slow one — async so the UI thread of the webview isn't
/// waiting on the network through a sync invoke.
#[tauri::command]
pub async fn git_push(root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_git(&root, &["push"]))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct GitBranches {
    pub current: String,
    pub branches: Vec<String>,
}

#[tauri::command]
pub fn git_branches(root: String) -> Result<GitBranches, String> {
    let raw = run_git(&root, &["branch", "--list", "--no-color"])?;
    let mut current = String::new();
    let mut branches = Vec::new();
    for line in raw.lines() {
        let name = line.trim_start_matches('*').trim().to_string();
        if name.is_empty() || name.starts_with('(') {
            continue; // detached-HEAD pseudo entry
        }
        if line.starts_with('*') {
            current = name.clone();
        }
        branches.push(name);
    }
    Ok(GitBranches { current, branches })
}

#[tauri::command]
pub fn git_checkout(root: String, branch: String) -> Result<String, String> {
    run_git(&root, &["checkout", &branch])
}

/// Staged + unstaged patch for one file (Changes panel preview / AI commit
/// message context).
#[tauri::command]
pub fn git_file_diff(root: String, path: String) -> Result<String, String> {
    let unstaged = run_git(&root, &["diff", "--", &path]).unwrap_or_default();
    let staged = run_git(&root, &["diff", "--cached", "--", &path]).unwrap_or_default();
    let mut out = String::new();
    if !staged.trim().is_empty() {
        out.push_str(&staged);
    }
    if !unstaged.trim().is_empty() {
        out.push_str(&unstaged);
    }
    if out.len() > DIFF_CAP {
        let mut cut = DIFF_CAP;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out.push_str("\n… (truncated)");
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct GitBlameLine {
    pub author: String,
    pub time: i64,
    pub summary: String,
    pub sha: String,
}

/// Porcelain blame for ONE line — feeds the subtle end-of-line annotation.
/// None for uncommitted lines (all-zero sha) and out-of-range requests.
#[tauri::command]
pub fn git_blame_line(
    root: String,
    path: String,
    line: u32,
) -> Result<Option<GitBlameLine>, String> {
    let spec = format!("{},{}", line, line);
    let raw = match run_git(&root, &["blame", "-p", "-L", &spec, "--", &path]) {
        Ok(s) => s,
        // Untracked file / line past EOF / shallow history — just no blame.
        Err(e)
            if e.contains("no such path")
                || e.contains("has only")
                || e.contains("bad revision") =>
        {
            return Ok(None)
        }
        Err(e) => return Err(e),
    };

    let mut sha = String::new();
    let mut author = String::new();
    let mut time: i64 = 0;
    let mut summary = String::new();
    for l in raw.lines() {
        if sha.is_empty() {
            sha = l.split(' ').next().unwrap_or("").to_string();
        } else if let Some(a) = l.strip_prefix("author ") {
            author = a.to_string();
        } else if let Some(t) = l.strip_prefix("author-time ") {
            time = t.parse().unwrap_or(0);
        } else if let Some(s) = l.strip_prefix("summary ") {
            summary = s.to_string();
        }
    }
    if sha.is_empty() || sha.chars().all(|c| c == '0') {
        return Ok(None);
    }
    Ok(Some(GitBlameLine {
        author,
        time,
        summary,
        sha,
    }))
}

/// Strip git's C-style quoting on paths with special chars.
fn unquote(p: &str) -> String {
    if p.len() >= 2 && p.starts_with('"') && p.ends_with('"') {
        p[1..p.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\")
    } else {
        p.to_string()
    }
}

/// `git status --short` header + `git diff HEAD` patch, capped. Used by the
/// @-context "Working diff" provider in the Orion chat rail.
#[tauri::command]
pub fn git_working_diff(root: String) -> Result<String, String> {
    let status = run_git(&root, &["status", "--short"])?;
    // `diff HEAD` fails on a repo with zero commits — fall back to plain
    // `diff` (staged-vs-worktree) so brand-new repos still work.
    let diff = run_git(&root, &["diff", "HEAD"])
        .or_else(|_| run_git(&root, &["diff"]))?;

    let mut out = String::new();
    if !status.trim().is_empty() {
        out.push_str("# git status --short\n");
        out.push_str(status.trim_end());
        out.push_str("\n\n");
    }
    out.push_str(&diff);
    if out.trim().is_empty() {
        out = "(working tree clean — no uncommitted changes)".to_string();
    }
    if out.len() > DIFF_CAP {
        let mut cut = DIFF_CAP;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out.push_str("\n… (diff truncated)");
    }
    Ok(out)
}

fn run_git(root: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod git_tests {
    use super::unquote;

    #[test]
    fn unquotes_special_paths() {
        assert_eq!(unquote("plain/path.ts"), "plain/path.ts");
        assert_eq!(unquote("\"with \\\"q\\\".ts\""), "with \"q\".ts");
        assert_eq!(unquote("\"back\\\\slash\""), "back\\slash");
    }
}
