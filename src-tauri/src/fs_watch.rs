//! Filesystem watcher — emits `fs:changed` to the frontend whenever anything
//! inside the active project root is created/modified/renamed/removed by ANY
//! process. Lets the file tree reflect external editor / git / Finder /
//! download activity without a restart, matching Cursor.
//!
//! - Single active watcher, swapped when the active project changes
//!   (`fs_watch_set_root`).
//! - Built on `notify` (RecommendedWatcher: FSEvents / inotify /
//!   ReadDirectoryChangesW) + `notify-debouncer-mini` (~300ms batches).
//! - Ignore-list filters noisy generated dirs at event time so `npm install`
//!   etc. doesn't pummel the frontend. Notify itself still buffers ignored
//!   events; the filter just stops them from triggering refreshes.
//! - Frontend coalesces with the existing `terminal:data` throttle, so the
//!   tree refetches at most every ~750ms even when many sources are active.

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Heavyweight generated dirs we never want to refresh the tree for. Matched
/// as a path substring with platform separators normalized.
const IGNORE_FRAGMENTS: &[&str] = &[
    "/node_modules/",
    "/.git/",
    "/target/",
    "/dist/",
    "/build/",
    "/.next/",
    "/.cache/",
    "/.turbo/",
    "/.vite/",
];

/// One active debouncer at a time; replacing this drops the previous watcher
/// and stops its FS subscriptions cleanly.
static ACTIVE: Lazy<Mutex<Option<Debouncer<notify::RecommendedWatcher>>>> =
    Lazy::new(|| Mutex::new(None));

fn is_ignored(path: &Path) -> bool {
    // Normalize Windows separators so the substring match works there too.
    let s = path.to_string_lossy().replace('\\', "/");
    IGNORE_FRAGMENTS.iter().any(|frag| s.contains(frag))
}

/// Start watching `path` (recursively) and emit `fs:changed` on relevant
/// events. Pass `None` to stop watching. Replacing the path swaps the
/// underlying watcher atomically.
#[tauri::command]
pub fn fs_watch_set_root(app: AppHandle, path: Option<String>) -> Result<(), String> {
    // Drop the previous watcher first — notify cleans up the OS resources
    // on Drop.
    *ACTIVE.lock() = None;

    let Some(root) = path.filter(|p| !p.trim().is_empty()) else {
        return Ok(());
    };
    let root_path = Path::new(&root);
    if !root_path.exists() {
        return Err(format!("fs_watch: path not found: {}", root));
    }

    let app_clone = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            // If ANY event in the batch is outside the ignore set, refresh.
            // One refresh covers the whole burst — no need to be granular.
            let relevant = events.iter().any(|e| !is_ignored(&e.path));
            if relevant {
                let _ = app_clone.emit("fs:changed", ());
            }
        },
    )
    .map_err(|e| format!("fs_watch: debouncer init: {}", e))?;

    debouncer
        .watcher()
        .watch(root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("fs_watch: watch {}: {}", root, e))?;

    *ACTIVE.lock() = Some(debouncer);
    Ok(())
}
