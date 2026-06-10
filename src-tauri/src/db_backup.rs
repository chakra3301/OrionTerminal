//! Boot-time safety net for orion.db. Before the frontend opens the database
//! (and before tauri-plugin-sql runs any pending migration), snapshot it into
//! `<app-config>/backups/orion-<utc-stamp>.db` and keep the newest few — so a
//! bad migration or corruption never costs more than one session of data.
//!
//! Uses SQLite's online backup API instead of a file copy: the iOS sync
//! helper writes to orion.db out-of-band, so a raw copy could tear a
//! mid-write WAL state. The backup API takes the proper locks.

use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};

const KEEP: usize = 5;

pub fn run(app: &AppHandle) {
    if let Err(e) = backup_and_rotate(app) {
        // Non-fatal by design — never block launch on the safety net.
        eprintln!("[db_backup] skipped: {e}");
    }
}

fn backup_and_rotate(app: &AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let db = dir.join("orion.db");
    if !db.exists() {
        return Ok(()); // first launch — nothing to protect yet
    }
    let backups = dir.join("backups");
    fs::create_dir_all(&backups).map_err(|e| e.to_string())?;

    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let target = backups.join(format!("orion-{}.db", stamp_utc(secs)));
    snapshot(&db, &target)?;

    for name in prune_list(list_backups(&backups)?, KEEP) {
        let _ = fs::remove_file(backups.join(name));
    }
    Ok(())
}

fn snapshot(src_path: &Path, dst_path: &Path) -> Result<(), String> {
    let src = rusqlite::Connection::open_with_flags(
        src_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;
    let mut dst = rusqlite::Connection::open(dst_path).map_err(|e| e.to_string())?;
    let bk = rusqlite::backup::Backup::new(&src, &mut dst).map_err(|e| e.to_string())?;
    bk.run_to_completion(256, std::time::Duration::from_millis(5), None)
        .map_err(|e| e.to_string())
}

fn list_backups(dir: &Path) -> Result<Vec<String>, String> {
    let mut names = vec![];
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("orion-") && name.ends_with(".db") {
            names.push(name);
        }
    }
    Ok(names)
}

/// Which backup filenames to delete, keeping the `keep` newest. Stamped names
/// sort lexicographically by age, so plain sort order is age order.
fn prune_list(mut names: Vec<String>, keep: usize) -> Vec<String> {
    if names.len() <= keep {
        return vec![];
    }
    names.sort();
    let cut = names.len() - keep;
    names.truncate(cut);
    names
}

/// `YYYYMMDD-HHMMSS` in UTC — sortable and readable in Finder.
fn stamp_utc(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let rem = unix_secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant's `civil_from_days` — inverse of the `days_from_civil` used
/// in sysstats. Days since 1970-01-01 → (year, month, day).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamp_known_moments() {
        // cross-checked with `date -u -r <secs>`
        assert_eq!(stamp_utc(0), "19700101-000000");
        assert_eq!(stamp_utc(1_770_000_000), "20260202-024000");
        // leap day
        assert_eq!(stamp_utc(1_709_164_800), "20240229-000000");
    }

    #[test]
    fn prune_keeps_the_newest() {
        let names = vec![
            "orion-20260601-120000.db".to_string(),
            "orion-20260603-120000.db".to_string(),
            "orion-20260602-120000.db".to_string(),
            "orion-20260605-120000.db".to_string(),
            "orion-20260604-120000.db".to_string(),
            "orion-20260606-120000.db".to_string(),
        ];
        let doomed = prune_list(names, 5);
        assert_eq!(doomed, vec!["orion-20260601-120000.db".to_string()]);
    }

    #[test]
    fn prune_noop_under_cap() {
        let names = vec!["orion-20260601-120000.db".to_string()];
        assert!(prune_list(names, 5).is_empty());
    }

    #[test]
    fn snapshot_round_trips_data() {
        let dir = std::env::temp_dir().join(format!("otdbk-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.db");
        let dst = dir.join("dst.db");
        {
            let conn = rusqlite::Connection::open(&src).unwrap();
            conn.execute_batch(
                "CREATE TABLE t(x TEXT); INSERT INTO t VALUES('hello'),('world');",
            )
            .unwrap();
        }
        snapshot(&src, &dst).unwrap();
        let conn = rusqlite::Connection::open(&dst).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
