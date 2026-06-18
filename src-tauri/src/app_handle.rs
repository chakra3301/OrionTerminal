//! Process-global handle to the running Tauri app, set once at startup so
//! in-process callers (the runtime's tool dispatch) can emit `ui:action`
//! events without the TCP bridge. The `--mcp-serve` subprocess never sets
//! this, so `current()` returns `None` there and callers fall back to TCP.

use once_cell::sync::OnceCell;
use tauri::AppHandle;

static APP: OnceCell<AppHandle> = OnceCell::new();

pub fn set(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn current() -> Option<AppHandle> {
    APP.get().cloned()
}
