use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    sync::{Arc, Weak},
};
use tauri::{AppHandle, Manager};

pub(super) struct Owner {
    file: File,
}
impl Drop for Owner {
    fn drop(&mut self) {
        // Unrelated concurrent spawns can briefly inherit this descriptor before exec.
        let _ = self.file.unlock();
    }
}
static OWNERS: Lazy<Mutex<BTreeMap<PathBuf, Weak<Owner>>>> =
    Lazy::new(|| Mutex::new(BTreeMap::new()));

pub(super) fn acquire(app: &AppHandle) -> Result<Arc<Owner>, String> {
    let root = app.path().app_config_dir().map_err(|e| e.to_string())?;
    acquire_at(&root.join(".media-downloads.lease"))
}
fn acquire_at(path: &Path) -> Result<Arc<Owner>, String> {
    let mut owners = OWNERS.lock();
    owners.retain(|_, owner| owner.strong_count() > 0);
    if let Some(owner) = owners.get(path).and_then(Weak::upgrade) {
        return Ok(owner);
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os = "macos")]
        const NOFOLLOW: i32 = 0x100;
        #[cfg(not(target_os = "macos"))]
        const NOFOLLOW: i32 = 0x20000;
        options.mode(0o600).custom_flags(NOFOLLOW);
    }
    let file = options
        .open(path)
        .map_err(|_| "Download coordination file is unavailable.")?;
    let meta = file
        .metadata()
        .map_err(|_| "Cannot check the download coordination file.")?;
    if !meta.is_file() || meta.len() != 0 {
        return Err("Unexpected download coordination file.".into());
    }
    file.try_lock().map_err(|_| {
        "Another Orion process owns Downloads. Finish its work before continuing here."
    })?;
    // Never unlink the lease: two inodes would permit two publishers for the same profile.
    let owner = Arc::new(Owner { file });
    owners.insert(path.to_owned(), Arc::downgrade(&owner));
    Ok(owner)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lifetime_covers_shared_workers_and_releases_after_last_owner() {
        let dir = std::env::temp_dir().join(format!("orion-media-lease-{}", ulid::Ulid::new()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("lease");
        let a = acquire_at(&path).unwrap();
        let b = acquire_at(&path).unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        let other = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        assert!(other.try_lock().is_err());
        drop(a);
        assert!(other.try_lock().is_err());
        drop(b);
        other.try_lock().unwrap();
        drop(other);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn refuses_link_without_changing_target() {
        let dir = std::env::temp_dir().join(format!("orion-media-lease-{}", ulid::Ulid::new()));
        std::fs::create_dir(&dir).unwrap();
        let target = dir.join("target");
        std::fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, dir.join("lease")).unwrap();
        assert!(acquire_at(&dir.join("lease")).is_err());
        assert_eq!(std::fs::read(target).unwrap(), b"keep");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
