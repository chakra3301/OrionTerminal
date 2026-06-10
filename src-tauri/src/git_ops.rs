//! Minimal read-only git commands (groundwork for the Phase 1.4 git
//! integration). Shells out to the `git` binary — no libgit2 dependency.

use std::process::Command;

const DIFF_CAP: usize = 65_536;

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
