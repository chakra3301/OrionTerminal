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
    /// The branch tracks a remote branch (else Push publishes it).
    pub upstream: bool,
    /// At least one remote is configured.
    pub has_remote: bool,
}

/// `git status --porcelain=v1 --branch` parsed into a structured summary.
#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String> {
    // -uall lists files inside new folders, so each row opens and stages one file.
    let raw = match run_git(&root, &["status", "--porcelain=v1", "--branch", "--untracked-files=all"]) {
        Ok(s) => s,
        Err(e) if e.contains("not a git repository") => {
            return Ok(GitStatus {
                branch: String::new(),
                ahead: 0,
                behind: 0,
                files: vec![],
                is_repo: false,
                upstream: false,
                has_remote: false,
            });
        }
        Err(e) => return Err(e),
    };

    let mut branch = String::new();
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();
    let mut upstream = false;
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            upstream = rest.contains("...");
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
    let has_remote = run_git(&root, &["remote"]).is_ok_and(|r| !r.trim().is_empty());
    Ok(GitStatus {
        branch,
        ahead,
        behind,
        files,
        is_repo: true,
        upstream,
        has_remote,
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

/// Discard worktree changes: tracked files go back to the index/HEAD version,
/// untracked files are deleted (`checkout` can't see them and used to fail).
#[tauri::command]
pub fn git_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    let (tracked, untracked): (Vec<&str>, Vec<&str>) = paths
        .iter()
        .map(String::as_str)
        .partition(|p| run_git(&root, &["ls-files", "--error-unmatch", "--", p]).is_ok());
    if !tracked.is_empty() {
        let mut args = vec!["checkout", "--"];
        args.extend(tracked);
        run_git(&root, &args)?;
    }
    if !untracked.is_empty() {
        let mut args = vec!["clean", "-f", "--"];
        args.extend(untracked);
        run_git(&root, &args)?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("commit message is empty".into());
    }
    run_git(&root, &["commit", "-m", &message])
}

/// Push the current branch. A branch with no upstream is published to the
/// only (or `origin`) remote and tracked, like Cursor's "Publish Branch".
/// Async so the webview isn't waiting on the network through a sync invoke.
#[tauri::command]
pub async fn git_push(root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if has_upstream(&root) {
            return run_git_all(&root, &["push"]);
        }
        let remote = push_remote(&root)?;
        run_git_all(&root, &["push", "-u", &remote, "HEAD"])
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Fast-forward-only pull, so a diverged branch reports instead of merging.
#[tauri::command]
pub async fn git_pull(root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !has_upstream(&root) {
            return Err("This branch isn't tracking a remote branch yet. Push it first.".into());
        }
        run_git_all(&root, &["pull", "--ff-only"])
    })
    .await
    .map_err(|e| e.to_string())?
}

fn has_upstream(root: &str) -> bool {
    run_git(root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_ok()
}

fn push_remote(root: &str) -> Result<String, String> {
    let remotes = run_git(root, &["remote"])?;
    let names: Vec<&str> = remotes.lines().map(str::trim).filter(|r| !r.is_empty()).collect();
    match names.as_slice() {
        [] => Err("This repository has no remote to push to. Add one with `git remote add origin <url>`.".into()),
        [only] => Ok(only.to_string()),
        many if many.contains(&"origin") => Ok("origin".into()),
        many => Err(format!("Several remotes ({}) and none is named origin. Push once from the terminal to choose.", many.join(", "))),
    }
}

/// Create a branch from HEAD and switch to it (uncommitted changes come along).
#[tauri::command]
pub fn git_create_branch(root: String, name: String) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('-') {
        return Err("Enter a branch name.".into());
    }
    run_git(&root, &["check-ref-format", "--branch", name])
        .map_err(|_| format!("“{name}” isn't a valid branch name."))?;
    run_git_all(&root, &["switch", "-c", name])
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
    if branch.starts_with('-') {
        return Err("Invalid branch name.".into());
    }
    run_git_all(&root, &["switch", &branch])
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

/// Like `run_git`, but success returns stderr when stdout is empty: push,
/// pull and switch report everything there.
fn run_git_all(root: &str, args: &[&str]) -> Result<String, String> {
    let output = git_command(root, args)?;
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(if err.is_empty() { out } else { err });
    }
    Ok(if out.is_empty() { err } else { out })
}

fn git_command(root: &str, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        // Never block on a credential prompt the app can't show.
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("failed to run git: {e}"))
}

fn run_git(root: &str, args: &[&str]) -> Result<String, String> {
    let output = git_command(root, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod git_tests {
    use super::*;

    fn repo() -> (std::path::PathBuf, String) {
        let base = std::env::temp_dir().join(format!("orion-git-{}", ulid::Ulid::new()));
        let work = base.join("work");
        std::fs::create_dir_all(&work).unwrap();
        let root = work.to_string_lossy().to_string();
        Command::new("git").args(["init", "-q", "--bare"]).arg(base.join("remote.git")).output().unwrap();
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            run_git(&root, &args).unwrap();
        }
        std::fs::write(work.join("a.txt"), "one\n").unwrap();
        git_stage(root.clone(), vec!["a.txt".into()]).unwrap();
        git_commit(root.clone(), "init".into()).unwrap();
        (base, root)
    }

    #[test]
    fn stage_commit_discard_and_branch_round_trip() {
        let (base, root) = repo();
        let work = base.join("work");
        std::fs::write(work.join("a.txt"), "two\n").unwrap();
        std::fs::create_dir_all(work.join("new dir")).unwrap();
        std::fs::write(work.join("new dir/n.txt"), "n\n").unwrap();
        let st = git_status(root.clone()).unwrap();
        let paths: Vec<_> = st.files.iter().map(|f| (f.path.as_str(), f.worktree.as_str())).collect();
        assert!(paths.contains(&("a.txt", "M")));
        assert!(paths.contains(&("new dir/n.txt", "?")), "{paths:?}");

        git_discard(root.clone(), vec!["a.txt".into(), "new dir/n.txt".into()]).unwrap();
        assert!(git_status(root.clone()).unwrap().files.is_empty());
        assert_eq!(std::fs::read_to_string(work.join("a.txt")).unwrap(), "one\n");

        assert!(git_create_branch(root.clone(), "bad name..".into()).is_err());
        git_create_branch(root.clone(), "feature/x".into()).unwrap();
        assert_eq!(git_branches(root.clone()).unwrap().current, "feature/x");
        git_checkout(root.clone(), "main".into()).unwrap();
        assert_eq!(git_status(root.clone()).unwrap().branch, "main");
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn push_publishes_a_branch_without_upstream_and_explains_a_missing_remote() {
        let (base, root) = repo();
        let err = tauri::async_runtime::block_on(git_push(root.clone())).unwrap_err();
        assert!(err.contains("no remote"), "{err}");
        assert!(tauri::async_runtime::block_on(git_pull(root.clone())).unwrap_err().contains("Push it first"));
        run_git(&root, &["remote", "add", "origin", &base.join("remote.git").to_string_lossy()]).unwrap();
        assert!(!git_status(root.clone()).unwrap().upstream);
        tauri::async_runtime::block_on(git_push(root.clone())).unwrap();
        assert!(has_upstream(&root));
        let st = git_status(root.clone()).unwrap();
        assert!(st.upstream && st.has_remote);
        std::fs::write(base.join("work/a.txt"), "three\n").unwrap();
        git_stage(root.clone(), vec!["a.txt".into()]).unwrap();
        git_commit(root.clone(), "next".into()).unwrap();
        assert_eq!(git_status(root.clone()).unwrap().ahead, 1);
        tauri::async_runtime::block_on(git_push(root.clone())).unwrap();
        assert_eq!(git_status(root.clone()).unwrap().ahead, 0);
        tauri::async_runtime::block_on(git_pull(root.clone())).unwrap();
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn unquotes_special_paths() {
        assert_eq!(unquote("plain/path.ts"), "plain/path.ts");
        assert_eq!(unquote("\"with \\\"q\\\".ts\""), "with \"q\".ts");
        assert_eq!(unquote("\"back\\\\slash\""), "back\\slash");
    }
}
