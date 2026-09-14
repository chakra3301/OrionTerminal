//! Verified boot-time snapshots, before frontend SQL migrations. These protect
//! persisted SQLite state, not unsaved drafts or files outside SQLite.

use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags,
};
use sha2::{Digest, Sha384};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const KEEP: usize = 5;
const BUDGET: Duration = Duration::from_secs(30);
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_CANDIDATES: usize = 128;

pub struct StartupBackupWarning(Option<String>);

pub fn run(app: &AppHandle) {
    let result = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .and_then(|dir| backup_and_rotate(&dir, Instant::now() + BUDGET));
    let warning = match result {
        Ok(warning) => warning,
        Err(error) => {
            eprintln!("[db_backup] {error}");
            Some("The startup database backup did not complete. Older backups were not rotated. Preserve your database and backups before attempting recovery.".into())
        }
    };
    app.manage(StartupBackupWarning(warning));
}

#[tauri::command]
pub fn database_backup_warning(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, StartupBackupWarning>,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Backup status is available only to the main window".into());
    }
    Ok(state.inner().0.clone())
}

fn private_dir(path: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|e| e.to_string())
}

fn private_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|e| e.to_string())
}

fn regular_file(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.file_type().is_file() || meta.len() == 0 || meta.len() > MAX_BYTES {
        return Err(
            "Database must be a nonempty regular file of at most 2 GiB; symlinks are refused"
                .into(),
        );
    }
    Ok(())
}

fn check_deadline(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        Err("Database recovery operation timed out".into())
    } else {
        Ok(())
    }
}

fn configure(conn: &Connection, deadline: Instant) -> Result<(), String> {
    conn.busy_timeout(Duration::from_millis(100))
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "trusted_schema", false)
        .map_err(|e| e.to_string())?;
    conn.progress_handler(10_000, Some(move || Instant::now() >= deadline));
    Ok(())
}

fn validate(conn: &Connection, deadline: Instant) -> Result<(), String> {
    check_deadline(deadline)?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check(1)", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if integrity != "ok" {
        return Err("Database integrity check failed".into());
    }
    let migrations = crate::database_migrations();
    let mut stmt = conn
        .prepare("SELECT version,success,checksum FROM _sqlx_migrations ORDER BY version")
        .map_err(|_| "Missing or invalid Orion migration history")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, bool>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut count = 0;
    for row in rows {
        let (version, success, checksum) = row.map_err(|e| e.to_string())?;
        let expected = migrations
            .get(count)
            .ok_or("Database belongs to a newer Orion version")?;
        if version != expected.version
            || !success
            || checksum != Sha384::digest(expected.sql.as_bytes()).to_vec()
        {
            return Err("Database migration history is incomplete, modified or unsupported".into());
        }
        count += 1;
    }
    if count == 0 {
        return Err("Database has no completed Orion migrations".into());
    }
    for table in ["notes", "app_state", "projects"] {
        let kind: String = conn
            .query_row(
                "SELECT type FROM sqlite_schema WHERE name=?1",
                [table],
                |r| r.get(0),
            )
            .map_err(|_| "Required Orion table is missing")?;
        if kind != "table" {
            return Err("Required Orion object is not a table".into());
        }
    }
    conn.prepare("SELECT id,title,blocks_json,created_at,updated_at FROM notes LIMIT 0")
        .map_err(|_| "Invalid Orion notes schema")?;
    conn.prepare("SELECT key,value FROM app_state LIMIT 0")
        .map_err(|_| "Invalid Orion state schema")?;
    check_deadline(deadline)
}

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

// Keep this inode permanently: unlinking an advisory lock permits two lock owners.
fn rotation_lock(dir: &Path) -> Result<File, String> {
    let path = dir.join(".rotation.lock");
    let file = match private_file(&path) {
        Ok(file) => file,
        Err(_) => {
            if !fs::symlink_metadata(&path)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_file()
            {
                return Err("Backup coordination file is not a regular file".into());
            }
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
                .map_err(|e| e.to_string())?
        }
    };
    file.try_lock()
        .map_err(|_| "Another backup operation is running or the backup lock is unavailable")?;
    Ok(file)
}

fn sync_dir(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn snapshot(src_path: &Path, target: &Path, deadline: Instant) -> Result<(), String> {
    regular_file(src_path)?;
    check_deadline(deadline)?;
    let parent = target.parent().ok_or("Missing snapshot parent")?;
    let scratch = parent.join(format!(".pending-{}", ulid::Ulid::new()));
    private_dir(&scratch)?;
    let scratch = Scratch(scratch);
    let temp = scratch.0.join("snapshot.db");
    let reserved = private_file(&temp)?;
    {
        let src = Connection::open_with_flags(src_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        configure(&src, deadline)?;
        let mut dst = Connection::open_with_flags(&temp, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|e| e.to_string())?;
        configure(&dst, deadline)?;
        {
            let backup = Backup::new(&src, &mut dst).map_err(|e| e.to_string())?;
            loop {
                check_deadline(deadline)?;
                match backup.step(256).map_err(|e| e.to_string())? {
                    StepResult::Done => break,
                    StepResult::Busy | StepResult::Locked | StepResult::More => {
                        std::thread::sleep(Duration::from_millis(2))
                    }
                    _ => return Err("Unsupported SQLite backup response".into()),
                }
                if fs::metadata(&temp).map_err(|e| e.to_string())?.len() > MAX_BYTES {
                    return Err("Snapshot exceeds 2 GiB".into());
                }
            }
        }
        // Produce a self-contained file even when the source uses WAL.
        dst.pragma_update(None, "journal_mode", "DELETE")
            .map_err(|e| e.to_string())?;
        validate(&dst, deadline)?;
        dst.close().map_err(|(_, e)| e.to_string())?;
    }
    regular_file(&temp)?;
    reserved.sync_all().map_err(|e| e.to_string())?;
    drop(reserved);
    check_deadline(deadline)?;
    // Same-filesystem hard-link publication is atomic and refuses existing names.
    fs::hard_link(&temp, target).map_err(|e| e.to_string())?;
    sync_dir(parent)
}

fn managed_name(name: &str) -> bool {
    let Some(stem) = name
        .strip_prefix("orion-")
        .and_then(|s| s.strip_suffix(".db"))
    else {
        return false;
    };
    if !stem.is_ascii() || (stem.len() != 15 && stem.len() != 42) {
        return false;
    }
    let stamp = &stem[..15];
    if stamp.as_bytes()[8] != b'-'
        || !stamp
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 8 || b.is_ascii_digit())
    {
        return false;
    }
    let number = |start, end| stamp[start..end].parse::<u32>().unwrap_or(0);
    let (y, m, d) = (number(0, 4), number(4, 6), number(6, 8));
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    if y < 1970
        || d == 0
        || d > days
        || number(9, 11) > 23
        || number(11, 13) > 59
        || number(13, 15) > 59
    {
        return false;
    }
    stem.len() == 15
        || (stem.as_bytes()[15] == b'-'
            && ulid::Ulid::from_string(&stem[16..]).is_ok_and(|id| id.to_string() == stem[16..]))
}

fn prune(dir: &Path, current: &Path, deadline: Instant) -> Result<(), String> {
    let mut valid = Vec::new();
    let mut candidates = 0;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        check_deadline(deadline)?;
        let entry = entry.map_err(|e| e.to_string())?;
        if !managed_name(&entry.file_name().to_string_lossy())
            || !entry.file_type().map_err(|e| e.to_string())?.is_file()
        {
            continue;
        }
        candidates += 1;
        if candidates > MAX_CANDIDATES {
            return Err("Too many backup candidates; retention needs manual review".into());
        }
        let path = entry.path();
        // Invalid or future-version candidates are preserved, never counted as good backups.
        if regular_file(&path).is_err()
            || ["-wal", "-shm", "-journal"].iter().any(|suffix| {
                let mut sidecar = path.as_os_str().to_os_string();
                sidecar.push(suffix);
                Path::new(&sidecar).symlink_metadata().is_ok()
            })
        {
            continue;
        }
        // Published snapshots have no live writers/sidecars; immutable avoids
        // creating WAL/SHM files while examining older WAL-header snapshots.
        let mut uri = tauri::Url::from_file_path(&path).map_err(|_| "Invalid backup path")?;
        uri.query_pairs_mut()
            .append_pair("mode", "ro")
            .append_pair("immutable", "1");
        let conn = Connection::open_with_flags(
            uri.as_str(),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| e.to_string())?;
        configure(&conn, deadline)?;
        if validate(&conn, deadline).is_ok() {
            valid.push(path);
        }
    }
    check_deadline(deadline)?;
    valid.sort();
    let remove = valid.len().saturating_sub(KEEP);
    for path in valid
        .into_iter()
        .filter(|path| path != current)
        .take(remove)
    {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    sync_dir(dir)
}

fn backup_and_rotate(dir: &Path, deadline: Instant) -> Result<Option<String>, String> {
    let source = dir.join("orion.db");
    match fs::symlink_metadata(&source) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
        Ok(_) => regular_file(&source)?,
    }
    let backups = dir.join("backups");
    if !backups.try_exists().map_err(|e| e.to_string())? {
        private_dir(&backups)?;
    }
    if !fs::symlink_metadata(&backups)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_dir()
    {
        return Err("Backup directory must not be a symlink".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&backups, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let _lock = rotation_lock(&backups)?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let target = backups.join(format!(
        "orion-{}-{}.db",
        stamp_utc(secs),
        ulid::Ulid::new()
    ));
    snapshot(&source, &target, deadline)?;
    if let Err(error) = prune(&backups, &target, deadline) {
        eprintln!("[db_backup] retention incomplete: {error}");
        return Ok(Some("A verified startup database snapshot was created, but backup retention cleanup did not complete. Preserve existing backups and review the backup directory.".into()));
    }
    Ok(None)
}

/// Offline recovery rehearsal: creates a new directory, never replaces a profile.
/// A caller must separately preserve the entire profile and stop every writer
/// before any manual promotion; external media, CLI auth and keychain files
/// are not included. Sensitive data stored inside SQLite is included.
pub fn restore_copy(source: &Path, destination: &Path) -> Result<(), String> {
    regular_file(source)?;
    private_dir(destination)?;
    let target = destination.join("orion.db");
    match snapshot(source, &target, Instant::now() + BUDGET) {
        Ok(()) => Ok(()),
        Err(error) => {
            // A directory-sync failure may leave a complete published copy: keep it.
            if !target.exists() {
                let _ = fs::remove_dir(destination);
            }
            Err(error)
        }
    }
}

fn stamp_utc(unix_secs: u64) -> String {
    let (y, m, d) = civil_from_days((unix_secs / 86_400) as i64);
    let rem = unix_secs % 86_400;
    format!(
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

// Howard Hinnant's civil_from_days (same calendar calculation as sysstats).
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
mod tests;
