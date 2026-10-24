use super::{db, id_check, playback, publication};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

pub(super) fn filename(title: &str, ext: &str) -> String {
    let mut name = String::new();
    for c in title.chars() {
        if name.len() + c.len_utf8() > 160 {
            break;
        }
        name.push(if c.is_control() || matches!(c, '/' | '\\' | ':') {
            '-'
        } else {
            c
        });
    }
    let name = name.trim().trim_matches('.').trim();
    format!("{}.{}", if name.is_empty() { "Media" } else { name }, ext)
}
pub(super) fn source(app: &AppHandle, id: &str) -> Result<(PathBuf, String), String> {
    id_check(id)?;
    let c = db(app)?;
    let (path, title): (String, String) = c
        .query_row(
            "SELECT file_path,title FROM assets WHERE id=?1 AND kind IN ('video','audio')",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "This audio/video asset is no longer in Media.")?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("assets");
    let path = playback::owned_source(&root, &path)?;
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("Missing media extension.")?;
    if !ext.bytes().all(|b| b.is_ascii_alphanumeric()) || ext.len() > 8 {
        return Err("Unexpected media extension.".into());
    }
    Ok((path.clone(), filename(&title, ext)))
}
#[tauri::command]
pub async fn media_download_export(
    app: AppHandle,
    asset_id: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (original,name)=source(&app,&asset_id)?;
        let Some(chosen)=app.dialog().file().set_title("Export a copy · existing files are never replaced").set_file_name(name).blocking_save_file() else { return Ok(None); };
        let target=chosen.into_path().map_err(|_|"Choose a local file destination.")?;
        let data=app.path().app_data_dir().map_err(|e|e.to_string())?;
        if ["media-downloads","media-download-auth"].iter().any(|root|target.starts_with(data.join(root))) {return Err("Choose a folder outside Orion’s disposable download/authentication scratch storage.".into());}
        let (current,_)=source(&app,&asset_id)?;
        if current!=original { return Err("The source changed while choosing a destination. Try again.".into()); }
        if target.extension()!=current.extension() { return Err("Keep the original extension when exporting; renaming does not convert the codecs.".into()); }
        export_file(&current,&target)?;
        Ok(Some(target.to_string_lossy().into_owned()))
    }).await.map_err(|e|e.to_string())?
}

#[cfg(unix)]
fn export_file(source: &Path, target: &Path) -> Result<(), String> {
    let mut input = publication::regular(source)?;
    let length = input.metadata().map_err(|e| e.to_string())?.len();
    export_reader(&mut input, length, target)
}

pub(super) fn export_bytes(bytes: &[u8], target: &Path) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > 4 * 1024 * 1024 {
        return Err("Sidecar output must contain 1 byte–4 MiB.".into());
    }
    #[cfg(unix)]
    {
        export_reader(&mut &bytes[..], bytes.len() as u64, target)
    }
    #[cfg(not(unix))]
    {
        let _ = target;
        Err("Safe sidecar export is not supported on this platform yet.".into())
    }
}

#[cfg(unix)]
fn export_reader(input: &mut impl std::io::Read, length: u64, target: &Path) -> Result<(), String> {
    use std::os::raw::{c_char, c_int};
    use std::{
        ffi::CString,
        fs::File,
        io::Write,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::ffi::OsStrExt,
        },
        path::Component,
    };
    unsafe extern "C" {
        fn openat(fd: c_int, path: *const c_char, flags: c_int, ...) -> c_int;
        fn linkat(
            fd: c_int,
            path: *const c_char,
            to_fd: c_int,
            to: *const c_char,
            flags: c_int,
        ) -> c_int;
        fn unlinkat(fd: c_int, path: *const c_char, flags: c_int) -> c_int;
    }
    #[cfg(target_os = "macos")]
    const NOFOLLOW: c_int = 0x100;
    #[cfg(not(target_os = "macos"))]
    const NOFOLLOW: c_int = 0x20000;
    #[cfg(target_os = "macos")]
    const CREATE_EXCLUSIVE: c_int = 0x1 | 0x200 | 0x800 | 0x1000000 | NOFOLLOW;
    #[cfg(not(target_os = "macos"))]
    const CREATE_EXCLUSIVE: c_int = 0x1 | 0x40 | 0x80 | 0x80000 | NOFOLLOW;
    #[cfg(target_os = "macos")]
    const DIRECTORY_FLAGS: c_int = NOFOLLOW | 0x100000 | 0x1000000 | 4;
    #[cfg(not(target_os = "macos"))]
    const DIRECTORY_FLAGS: c_int = NOFOLLOW | 0x10000 | 0x80000 | 0x800;
    let parent = target.parent().ok_or("Missing export folder.")?;
    if !parent.is_absolute() {
        return Err("Choose an absolute local folder.".into());
    }
    let mut root = File::open("/").map_err(|e| e.to_string())?;
    for component in parent.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(name) => {
                let name = CString::new(name.as_bytes()).map_err(|_| "Invalid export folder.")?;
                let fd = unsafe { openat(root.as_raw_fd(), name.as_ptr(), DIRECTORY_FLAGS) };
                if fd < 0 {
                    return Err(
                        "Choose a physical local folder without symbolic links or alias paths."
                            .into(),
                    );
                }
                root = unsafe { File::from_raw_fd(fd) };
            }
            _ => return Err("The export folder cannot traverse parents.".into()),
        }
    }
    super::engine::disk_space(parent, 512 * 1024 * 1024, length)?;
    let name = target.file_name().ok_or("Missing export filename.")?;
    let name = CString::new(name.as_bytes()).map_err(|_| "Invalid export filename.")?;
    if matches!(name.to_bytes(), b"." | b"..") {
        return Err("Invalid export filename.".into());
    }
    let temp = CString::new(format!(".orion-export-{}.tmp", ulid::Ulid::new())).unwrap();
    // Descriptor-relative creation/linking pins the approved folder through rename/symlink races.
    let fd = unsafe {
        openat(
            root.as_raw_fd(),
            temp.as_ptr(),
            CREATE_EXCLUSIVE,
            0o600 as c_int,
        )
    };
    if fd < 0 {
        return Err(format!(
            "Could not create an export copy: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut output = unsafe { File::from_raw_fd(fd) };
    let result = (|| {
        let mut bytes = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            bytes += n as u64;
            if bytes > super::policy::ABSOLUTE_FILE || bytes > length {
                return Err("Export exceeded the media size limit.".into());
            }
            if bytes % (8 * 1024 * 1024) < n as u64 {
                super::engine::disk_space(parent, 512 * 1024 * 1024, n as u64)?;
            }
            output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        }
        if bytes == 0 || bytes != length {
            return Err("The export source is empty or changed while copying.".into());
        }
        output.sync_all().map_err(|e| e.to_string())?;
        super::engine::disk_space(parent, 512 * 1024 * 1024, 0)?;
        if unsafe {
            linkat(
                root.as_raw_fd(),
                temp.as_ptr(),
                root.as_raw_fd(),
                name.as_ptr(),
                0,
            )
        } != 0
        {
            return Err(format!("Export not published. Choose a new filename; existing files are never overwritten. {}",std::io::Error::last_os_error()));
        }
        root.sync_all().map_err(|e|format!("Export bytes were created but the folder sync failed. Check the chosen destination before retrying: {e}"))?;
        Ok(())
    })();
    drop(output);
    unsafe {
        unlinkat(root.as_raw_fd(), temp.as_ptr(), 0);
    }
    let _ = root.sync_all();
    result
}
#[cfg(not(unix))]
fn export_file(source: &Path, target: &Path) -> Result<(), String> {
    if fs::symlink_metadata(target).is_ok() {
        return Err("Choose a new filename; existing files are never overwritten.".into());
    }
    publication::publish_file_limited(
        source,
        target,
        &super::policy::Limits {
            file_mib: 65536,
            work_mib: 131072,
            ..Default::default()
        },
    )
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_are_bounded_without_source_paths_or_templates() {
        assert_eq!(filename("../unsafe/name:\n", "mp4"), "-unsafe-name--.mp4");
        assert_eq!(filename(" . ", "mp3"), "Media.mp3");
        assert!(filename(&"語".repeat(300), "mp4").len() <= 164);
    }
    #[test]
    fn export_is_a_synced_copy_without_overwrite_or_source_mutation() {
        let root = std::env::temp_dir().join(format!("orion-export-test-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let source = root.join("source.mp4");
        let target = root.join("copy.mp4");
        fs::write(&source, b"owned synthetic export").unwrap();
        export_file(&source, &target).unwrap();
        assert_eq!(fs::read(&source).unwrap(), fs::read(&target).unwrap());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&target).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert!(export_file(&source, &target).is_err());
        fs::write(&source, b"changed synthetic export").unwrap();
        assert!(export_file(&source, &target).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"owned synthetic export");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn export_refuses_source_destination_and_folder_links() {
        let root = std::env::temp_dir().join(format!("orion-export-links-{}", ulid::Ulid::new()));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let source = root.join("source.mp4");
        fs::write(&source, b"owned synthetic export").unwrap();
        std::os::unix::fs::symlink(&source, root.join("link.mp4")).unwrap();
        assert!(export_file(&root.join("link.mp4"), &root.join("copy.mp4")).is_err());
        assert!(export_file(&source, &root.join("link.mp4")).is_err());
        std::os::unix::fs::symlink(&root, root.join("folder")).unwrap();
        assert!(export_file(&source, &root.join("folder/copy.mp4")).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"owned synthetic export");
        fs::remove_dir_all(root).unwrap();
    }
}
