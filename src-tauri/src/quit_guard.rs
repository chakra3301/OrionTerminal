use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Default)]
pub struct QuitGuard(Mutex<Decision>);

#[derive(Default)]
struct Decision {
    pending: Option<String>,
    approved: bool,
}

impl Decision {
    fn request(&mut self) -> String {
        self.pending.get_or_insert_with(|| ulid::Ulid::new().to_string()).clone()
    }

    fn resolve(&mut self, id: &str, allow: bool) -> Result<(), String> {
        if self.pending.as_deref() != Some(id) {
            return Err("Expired quit request".into());
        }
        self.pending = None;
        self.approved = allow;
        Ok(())
    }

    fn take_approval(&mut self) -> bool {
        std::mem::take(&mut self.approved)
    }
}

pub fn request(app: &AppHandle) {
    let guard = app.state::<QuitGuard>();
    let id = guard.0.lock().unwrap_or_else(|e| e.into_inner()).request();
    // Startup/listener failure must not silently authorize data loss. The UI can
    // recover this pending request after registering its listener.
    let _ = app.emit_to("main", "app:quit-requested", id);
}

pub fn take_approval(app: &AppHandle) -> bool {
    app.state::<QuitGuard>().0.lock().unwrap_or_else(|e| e.into_inner()).take_approval()
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("Quit decisions require the main window".into()) }
}

#[tauri::command]
pub fn app_quit_pending(window: WebviewWindow, app: AppHandle) -> Result<Option<String>, String> {
    main_only(&window)?;
    Ok(app.state::<QuitGuard>().0.lock().map_err(|_| "Quit state unavailable")?.pending.clone())
}

#[tauri::command]
pub fn app_quit_decide(window: WebviewWindow, app: AppHandle, request_id: String, allow: bool) -> Result<(), String> {
    main_only(&window)?;
    app.state::<QuitGuard>().0.lock().map_err(|_| "Quit state unavailable")?.resolve(&request_id, allow)?;
    if allow { app.exit(0); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_requests_share_identity_until_cancelled() {
        let mut state = Decision::default();
        let id = state.request(); assert_eq!(id, state.request());
        state.resolve(&id, false).unwrap(); assert!(!state.take_approval());
        assert_ne!(id, state.request());
    }
    #[test]
    fn only_current_request_can_approve_and_approval_is_one_shot() {
        let mut state = Decision::default();
        assert!(state.resolve("unknown", true).is_err()); assert!(!state.take_approval());
        let old = state.request(); state.resolve(&old, false).unwrap();
        let current = state.request(); assert!(state.resolve(&old, true).is_err());
        assert!(!state.take_approval()); state.resolve(&current, true).unwrap();
        assert!(state.take_approval()); assert!(!state.take_approval());
        assert!(state.resolve(&current, true).is_err());
    }
}
