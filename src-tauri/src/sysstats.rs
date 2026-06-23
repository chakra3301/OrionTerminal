//! Desktop monitor widget backend: live CPU/memory via `sysinfo`, and Claude
//! token/cost usage aggregated from claude-code's local transcript logs
//! (`~/.claude/projects/**/*.jsonl`) over rolling time windows. No network, no
//! sudo — temp/GPU on Apple Silicon need powermetrics (sudo), so they're out.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;
use walkdir::WalkDir;

static SYS: Lazy<Mutex<System>> = Lazy::new(|| Mutex::new(System::new()));

#[derive(Serialize)]
pub struct SystemStats {
    cpu_percent: f32,
    mem_used: u64,
    mem_total: u64,
    cpu_count: usize,
}

/// One poll of CPU + memory. CPU% is the usage since the previous poll (the
/// shared `System` keeps the prior sample), so the first call reads ~0 and
/// every subsequent call is accurate.
#[tauri::command]
pub fn system_stats() -> SystemStats {
    let mut sys = SYS.lock();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    SystemStats {
        cpu_percent: sys.global_cpu_usage(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        cpu_count: sys.cpus().len(),
    }
}

#[derive(Serialize, Default)]
pub struct UsageWindow {
    input: u64,
    output: u64,
    cache_creation: u64,
    cache_read: u64,
    cost_usd: f64,
    messages: u64,
}

impl UsageWindow {
    fn add(&mut self, u: &Usage, model: &str) {
        self.input += u.input;
        self.output += u.output;
        self.cache_creation += u.cache_creation;
        self.cache_read += u.cache_read;
        self.messages += 1;
        self.cost_usd += estimate_cost(u, model);
    }
}

#[derive(Serialize, Default)]
pub struct ClaudeUsage {
    /// Usage in the CURRENT 5-hour limit block. Anthropic anchors the window to
    /// your first message and resets 5h later; we reconstruct that block rather
    /// than a rolling sum, so `block_start_ms + 5h` is a real "resets at" time.
    block: UsageWindow,
    block_start_ms: i64,
    /// Trailing 24h, informational.
    last_24h: UsageWindow,
}

const FIVE_H_MS: i64 = 5 * 3_600_000;

struct Usage {
    input: u64,
    output: u64,
    cache_creation: u64,
    cache_read: u64,
}

/// Per-million-token USD pricing (input, output, cache-write, cache-read),
/// matched by model family. Approximate list pricing — a reasonable estimate,
/// not a billing source of truth.
fn estimate_cost(u: &Usage, model: &str) -> f64 {
    let m = model.to_ascii_lowercase();
    let (pin, pout, pcw, pcr) = if m.contains("opus") {
        (15.0, 75.0, 18.75, 1.5)
    } else if m.contains("haiku") {
        (1.0, 5.0, 1.25, 0.1)
    } else {
        // default to Sonnet pricing (covers sonnet + unknown)
        (3.0, 15.0, 3.75, 0.3)
    };
    (u.input as f64 * pin
        + u.output as f64 * pout
        + u.cache_creation as f64 * pcw
        + u.cache_read as f64 * pcr)
        / 1_000_000.0
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Parse an ISO-8601 UTC timestamp ("YYYY-MM-DDThh:mm:ss…Z") to epoch ms.
/// claude-code stamps every transcript line in UTC; we compare against a UTC
/// `now`, so no timezone handling is needed. days_from_civil = Howard Hinnant.
fn parse_iso_ms(s: &str) -> Option<i64> {
    if s.len() < 19 {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let min: i64 = s.get(14..16)?.parse().ok()?;
    let sec: i64 = s.get(17..19)?.parse().ok()?;
    let y = if month <= 2 { year - 1 } else { year };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some((days * 86400 + hour * 3600 + min * 60 + sec) * 1000)
}

fn extract_usage(v: &serde_json::Value) -> Option<(Usage, String)> {
    let msg = v.get("message")?;
    let u = msg.get("usage")?;
    let g = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let usage = Usage {
        input: g("input_tokens"),
        output: g("output_tokens"),
        cache_creation: g("cache_creation_input_tokens"),
        cache_read: g("cache_read_input_tokens"),
    };
    if usage.input == 0 && usage.output == 0 && usage.cache_creation == 0 && usage.cache_read == 0 {
        return None;
    }
    let model = msg
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    Some((usage, model))
}

/// Aggregate Claude token/cost usage over the last 5h and 24h from local
/// claude-code transcripts. Files untouched in 24h are skipped by mtime;
/// within a file, only lines mentioning `"usage"` are JSON-parsed.
#[tauri::command]
pub fn claude_usage() -> ClaudeUsage {
    let mut out = ClaudeUsage::default();
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return out,
    };
    let root = std::path::Path::new(&home).join(".claude").join("projects");
    let now = now_ms();
    let cut_24h = now - 24 * 3_600_000;

    // Collect every usage event in the last 24h, then derive both the trailing
    // 24h total and the current 5h block from the same set.
    let mut events: Vec<(i64, Usage, String)> = Vec::new();

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "jsonl").unwrap_or(false))
    {
        // Skip files whose newest write is older than the widest window.
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if let Ok(d) = modified.duration_since(UNIX_EPOCH) {
                    if (d.as_millis() as i64) < cut_24h {
                        continue;
                    }
                }
            }
        }
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        for line in content.lines() {
            if !line.contains("\"usage\"") {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };
            let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()).and_then(parse_iso_ms)
            else {
                continue;
            };
            if ts < cut_24h {
                continue;
            }
            let Some((usage, model)) = extract_usage(&v) else {
                continue;
            };
            out.last_24h.add(&usage, &model);
            events.push((ts, usage, model));
        }
    }

    // Reconstruct the current limit block: walking oldest->newest, a new 5h
    // window opens whenever an event lands 5h+ after the open window's start.
    // The window holding the newest event is the live block.
    events.sort_by_key(|e| e.0);
    let mut block_start = 0i64;
    for (ts, _, _) in &events {
        if block_start == 0 || *ts - block_start >= FIVE_H_MS {
            block_start = *ts;
        }
    }
    // Only report a block if its window is still open (start + 5h in the
    // future); otherwise the limit has already reset and the block is empty.
    if block_start != 0 && block_start + FIVE_H_MS > now {
        out.block_start_ms = block_start;
        for (ts, usage, model) in &events {
            if *ts >= block_start {
                out.block.add(usage, model);
            }
        }
    }
    out
}

/// The AUTHORITATIVE subscription limits, as Claude's own `/usage` panel
/// reports them (session = the 5h limit, plus the rolling weekly limits).
/// Server-side truth — unlike the locally-estimated cost gauge above, these
/// are the real percentages the user sees in `claude`. `ok` is false when the
/// CLI couldn't be run or the panel couldn't be parsed.
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct ClaudeLimits {
    ok: bool,
    session_pct: Option<u32>,
    session_reset: Option<String>,
    week_pct: Option<u32>,
    week_reset: Option<String>,
    week_sonnet_pct: Option<u32>,
    week_sonnet_reset: Option<String>,
}

/// Parse the trailing `… NN% used · resets <when>` of a `/usage` line into the
/// percentage and the raw reset phrase. `split_once(':')` upstream already
/// removed the label, so the first `%` here is always the figure.
fn parse_pct_rest(rest: &str) -> Option<(u32, Option<String>)> {
    let rest = rest.trim();
    let pct: u32 = rest.split('%').next()?.trim().parse().ok()?;
    let reset = rest
        .split_once("resets ")
        .map(|(_, r)| r.trim().to_string());
    Some((pct, reset))
}

/// Parse the plain-text `claude --print '/usage'` panel. Tolerant: only the
/// three limit lines are read; everything else (the "what's contributing"
/// breakdown) is ignored, and missing lines just stay `None`.
fn parse_usage_panel(text: &str) -> ClaudeLimits {
    let mut out = ClaudeLimits::default();
    for line in text.lines() {
        let Some((label, rest)) = line.trim().split_once(':') else {
            continue;
        };
        let Some((pct, reset)) = parse_pct_rest(rest) else {
            continue;
        };
        match label.trim() {
            "Current session" => {
                out.session_pct = Some(pct);
                out.session_reset = reset;
                out.ok = true;
            }
            "Current week (all models)" => {
                out.week_pct = Some(pct);
                out.week_reset = reset;
                out.ok = true;
            }
            "Current week (Sonnet only)" => {
                out.week_sonnet_pct = Some(pct);
                out.week_sonnet_reset = reset;
                out.ok = true;
            }
            _ => {}
        }
    }
    out
}

/// Scrape the real subscription limits by running `claude --print '/usage'`
/// (~2–4s; the monitor polls this on a slow interval). Mirrors the
/// `claude_oneshot` spawn setup so the CLI is found and no API-key env leaks
/// in. Any failure returns `ok: false` rather than erroring.
#[tauri::command]
pub async fn claude_limits() -> ClaudeLimits {
    use std::process::Stdio;
    use tokio::process::Command;
    let mut cmd = Command::new("claude");
    cmd.args(["--print", "/usage"]);
    if let Some(home) = std::env::var_os("HOME") {
        cmd.current_dir(home);
    }
    cmd.env("PATH", crate::claude_cli::augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    match cmd.output().await {
        Ok(o) if o.status.success() => parse_usage_panel(&String::from_utf8_lossy(&o.stdout)),
        _ => ClaudeLimits::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PANEL: &str = "You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 58% used · resets Jun 18 at 11:09pm (Asia/Tokyo)\nCurrent week (all models): 29% used · resets Jun 23 at 8:59am (Asia/Tokyo)\nCurrent week (Sonnet only): 7% used · resets Jun 23 at 9am (Asia/Tokyo)\n\nWhat's contributing to your limits usage?\nLast 24h · 1517 requests · 192 sessions\n  Top skills: /superpowers:executing-plans 15%, /update-config 1%\n";

    #[test]
    fn parses_all_three_limits() {
        let u = parse_usage_panel(PANEL);
        assert!(u.ok);
        assert_eq!(u.session_pct, Some(58));
        assert_eq!(u.session_reset.as_deref(), Some("Jun 18 at 11:09pm (Asia/Tokyo)"));
        assert_eq!(u.week_pct, Some(29));
        assert_eq!(u.week_sonnet_pct, Some(7));
    }

    #[test]
    fn ignores_breakdown_lines_with_colons_and_percents() {
        // "Top skills:" has a colon and percent signs but is not a limit line.
        let u = parse_usage_panel(PANEL);
        // Only the three limit fields are populated; nothing bled in from the
        // skills/sessions lines.
        assert_eq!(u.week_sonnet_pct, Some(7));
    }

    #[test]
    fn empty_or_garbage_is_not_ok() {
        assert!(!parse_usage_panel("").ok);
        assert!(!parse_usage_panel("login required\nrun /login").ok);
    }
}
