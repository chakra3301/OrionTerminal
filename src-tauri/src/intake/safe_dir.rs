use std::{
    fs::File,
    path::{Component, Path},
};

pub fn relative(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 240
        || path.split('/').any(|p| {
            p.is_empty()
                || p == "."
                || p == ".."
                || !p
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._- ".contains(&b))
                || p.ends_with([' ', '.'])
        })
    {
        return Err("Unsupported package path (use relative ASCII names without traversal)".into());
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod platform {
    use super::*;
    use std::{
        ffi::{CStr, CString},
        os::{
            fd::{AsRawFd, FromRawFd},
            raw::{c_char, c_int, c_void},
        },
    };

    #[cfg(target_os = "macos")]
    const NOFOLLOW: c_int = 0x100;
    #[cfg(target_os = "macos")]
    const DIRECTORY: c_int = 0x100000;
    #[cfg(target_os = "macos")]
    const CLOEXEC: c_int = 0x1000000;
    #[cfg(target_os = "macos")]
    const NONBLOCK: c_int = 4;
    #[cfg(target_os = "linux")]
    const NOFOLLOW: c_int = 0x20000;
    #[cfg(target_os = "linux")]
    const DIRECTORY: c_int = 0x10000;
    #[cfg(target_os = "linux")]
    const CLOEXEC: c_int = 0x80000;
    #[cfg(target_os = "linux")]
    const NONBLOCK: c_int = 0x800;

    #[repr(C)]
    struct Dirent {
        ino: u64,
        offset: i64,
        reclen: u16,
        #[cfg(target_os = "macos")]
        namlen: u16,
        kind: u8,
        #[cfg(target_os = "macos")]
        name: [c_char; 1024],
        #[cfg(target_os = "linux")]
        name: [c_char; 256],
    }
    extern "C" {
        fn openat(fd: c_int, path: *const c_char, flags: c_int, ...) -> c_int;
        fn fdopendir(fd: c_int) -> *mut c_void;
        fn readdir(dir: *mut c_void) -> *mut Dirent;
        fn closedir(dir: *mut c_void) -> c_int;
        #[cfg(target_os = "macos")]
        fn __error() -> *mut c_int;
        #[cfg(target_os = "linux")]
        fn __errno_location() -> *mut c_int;
    }
    unsafe fn errno() -> *mut c_int {
        #[cfg(target_os = "macos")]
        {
            __error()
        }
        #[cfg(target_os = "linux")]
        {
            __errno_location()
        }
    }
    pub fn child(dir: &File, name: &str, directory: bool) -> Result<File, String> {
        if name != "." {
            relative(name)?;
            if name.contains('/') {
                return Err("Expected one path component".into());
            }
        }
        child_utf8(dir, name, directory)
    }
    pub fn child_utf8(dir: &File, name: &str, directory: bool) -> Result<File, String> {
        if name.is_empty() || name == ".." || name.contains('/') || name.contains('\0') {
            return Err("Expected one path component".into());
        }
        let name = CString::new(name).map_err(|_| "Invalid name")?;
        // Each component is opened relative to a pinned descriptor, never a checked-then-reopened path.
        let fd = unsafe {
            openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                NOFOLLOW | CLOEXEC | NONBLOCK | if directory { DIRECTORY } else { 0 },
            )
        };
        if fd < 0 {
            return Err("Cannot open package entry without following links".into());
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    struct Directory(*mut c_void);
    impl Drop for Directory {
        fn drop(&mut self) {
            unsafe {
                closedir(self.0);
            }
        }
    }
    pub fn names(dir: &File) -> Result<Vec<String>, String> {
        names_except(dir, None)
    }
    pub fn names_except(dir: &File, excluded: Option<&str>) -> Result<Vec<String>, String> {
        use std::os::fd::IntoRawFd;
        let fd = child(dir, ".", true)?.into_raw_fd();
        let ptr = unsafe { fdopendir(fd) };
        if ptr.is_null() {
            drop(unsafe { File::from_raw_fd(fd) });
            return Err("Cannot enumerate package directory".into());
        }
        let dir = Directory(ptr);
        let mut names = Vec::new();
        loop {
            unsafe {
                *errno() = 0;
            }
            let entry = unsafe { readdir(dir.0) };
            if entry.is_null() {
                if unsafe { *errno() } != 0 {
                    return Err("Package directory changed during enumeration".into());
                }
                break;
            }
            let name = unsafe { CStr::from_ptr((*entry).name.as_ptr()) }
                .to_str()
                .map_err(|_| "Non-UTF-8 package name")?;
            if name == "." || name == ".." || Some(name) == excluded {
                continue;
            }
            names.push(name.to_string());
            if names.len() > 512 {
                return Err("Directory exceeds 512 entries".into());
            }
        }
        names.sort();
        Ok(names)
    }
    pub fn root(path: &Path) -> Result<File, String> {
        if !path.is_absolute() {
            return Err("Choose an absolute local directory".into());
        }
        let mut dir = File::open("/").map_err(|_| "Cannot open filesystem root")?;
        for component in path.components() {
            match component {
                Component::RootDir => {}
                Component::Normal(name) => {
                    // Absolute picker paths may contain Unicode; package-relative paths may not.
                    let name = CString::new(name.as_encoded_bytes())
                        .map_err(|_| "Invalid directory name")?;
                    let fd = unsafe {
                        openat(
                            dir.as_raw_fd(),
                            name.as_ptr(),
                            NOFOLLOW | DIRECTORY | CLOEXEC | NONBLOCK,
                        )
                    };
                    if fd < 0 {
                        return Err(
                            "Choose a physical directory, not a symbolic link or alias path".into(),
                        );
                    }
                    dir = unsafe { File::from_raw_fd(fd) };
                }
                _ => return Err("Directory path cannot traverse parents".into()),
            }
        }
        Ok(dir)
    }
}
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub use platform::*;

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn root(_: &Path) -> Result<File, String> {
    Err("Local skill inspection is unsupported on this platform".into())
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn names(_: &File) -> Result<Vec<String>, String> {
    Err("Unsupported platform".into())
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn names_except(_: &File, _: Option<&str>) -> Result<Vec<String>, String> {
    Err("Unsupported platform".into())
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn child_utf8(_: &File, _: &str, _: bool) -> Result<File, String> {
    Err("Unsupported platform".into())
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn child(_: &File, _: &str, _: bool) -> Result<File, String> {
    Err("Unsupported platform".into())
}
