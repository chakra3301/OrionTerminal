use std::path::Path;

#[cfg(unix)]
use {
    sha2::{Digest, Sha256},
    std::{
        fs::{self, File, Metadata},
        os::unix::fs::MetadataExt,
        path::PathBuf,
    },
};

const UNSUPPORTED: &str = "Seekable descriptor pinning is unsupported on this platform.";
#[cfg(unix)]
const CHANGED: &str = "The saved media file changed; inspect it again before extracting sidecars.";

// A metadata version guard, not a content digest or a sandbox. Keep only revision tokens
// between operations; callers must check again after probing/extraction before publication.
pub(super) struct Source {
    #[cfg(unix)]
    file: File,
    #[cfg(unix)]
    path: PathBuf,
    #[cfg(unix)]
    identity: Identity,
}

#[cfg(unix)]
#[derive(Debug, PartialEq, Eq)]
struct Identity {
    dev: u64,
    ino: u64,
    len: u64,
    mtime: i64,
    mtime_nsec: i64,
    ctime: i64,
    ctime_nsec: i64,
}

#[cfg(unix)]
impl Identity {
    fn capture(meta: &Metadata) -> Result<Self, String> {
        if !meta.is_file()
            || meta.is_symlink()
            || meta.nlink() != 1
            || meta.len() == 0
            || meta.len() > super::policy::ABSOLUTE_FILE
        {
            return Err(CHANGED.into());
        }
        Ok(Self {
            dev: meta.dev(),
            ino: meta.ino(),
            len: meta.len(),
            mtime: meta.mtime(),
            mtime_nsec: meta.mtime_nsec(),
            ctime: meta.ctime(),
            ctime_nsec: meta.ctime_nsec(),
        })
    }

    fn revision(&self) -> String {
        let mut hash = Sha256::new();
        hash.update(b"orion-sidecar-source-v1\0");
        hash.update(self.dev.to_be_bytes());
        hash.update(self.ino.to_be_bytes());
        hash.update(self.len.to_be_bytes());
        hash.update(self.mtime.to_be_bytes());
        hash.update(self.mtime_nsec.to_be_bytes());
        hash.update(self.ctime.to_be_bytes());
        hash.update(self.ctime_nsec.to_be_bytes());
        format!("{:x}", hash.finalize())
    }
}

impl Source {
    pub(super) fn open(path: &Path) -> Result<Self, String> {
        #[cfg(unix)]
        {
            if !cfg!(all(
                any(target_os = "macos", target_os = "linux"),
                target_pointer_width = "64"
            )) {
                return Err(UNSUPPORTED.into());
            }
            let file = super::publication::regular(path)?;
            let identity = Identity::capture(&file.metadata().map_err(|e| e.to_string())?)?;
            let source = Self {
                file,
                path: path.to_path_buf(),
                identity,
            };
            source.check()?;
            Ok(source)
        }
        #[cfg(not(unix))]
        {
            let _ = path;
            Err(UNSUPPORTED.into())
        }
    }

    pub(super) fn revision(&self) -> String {
        #[cfg(unix)]
        {
            self.identity.revision()
        }
        #[cfg(not(unix))]
        {
            // No Source can be constructed on these platforms.
            String::new()
        }
    }

    pub(super) fn check(&self) -> Result<(), String> {
        #[cfg(unix)]
        {
            let path_meta = fs::symlink_metadata(&self.path).map_err(|_| CHANGED.to_string())?;
            let held_meta = self.file.metadata().map_err(|_| CHANGED.to_string())?;
            if Identity::capture(&path_meta)? != self.identity
                || Identity::capture(&held_meta)? != self.identity
            {
                return Err(CHANGED.into());
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            Err(UNSUPPORTED.into())
        }
    }

    pub(super) fn command(
        &self,
        program: &Path,
    ) -> Result<(tokio::process::Command, String), String> {
        #[cfg(all(
            unix,
            any(target_os = "macos", target_os = "linux"),
            target_pointer_width = "64"
        ))]
        {
            use std::{os::unix::process::CommandExt, process::Stdio};

            self.check()?;
            let pinned = native::clone_above_stdio(&self.file).map_err(|e| e.to_string())?;
            use std::os::fd::AsRawFd;
            let input = format!("/dev/fd/{}", pinned.as_raw_fd());
            let mut command = tokio::process::Command::new(program);
            command
                .env_clear()
                .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
                .env("LANG", "C.UTF-8")
                .env("AV_LOG_FORCE_NOCOLOR", "1")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            // The owned File reserves its fd before spawn allocates stdio/error pipes.
            // Capturing only the fd number would allow reuse after this method returns.
            // pre_exec appends, so process_group::spawn can add its own setup as well.
            unsafe {
                command
                    .as_std_mut()
                    .pre_exec(move || native::prepare_child(&pinned));
            }
            Ok((command, input))
        }
        #[cfg(not(all(
            unix,
            any(target_os = "macos", target_os = "linux"),
            target_pointer_width = "64"
        )))]
        {
            let _ = program;
            Err(UNSUPPORTED.into())
        }
    }
}

// These constants and the 64-bit off_t ABI are scoped to the supported native targets.
#[cfg(all(
    unix,
    any(target_os = "macos", target_os = "linux"),
    target_pointer_width = "64"
))]
mod native {
    use std::{
        ffi::c_int,
        fs::File,
        io,
        os::fd::{AsRawFd, FromRawFd},
    };

    const F_GETFD: c_int = 1;
    const F_SETFD: c_int = 2;
    pub(super) const FD_CLOEXEC: c_int = 1;
    #[cfg(target_os = "macos")]
    const F_DUPFD_CLOEXEC: c_int = 67;
    #[cfg(target_os = "linux")]
    const F_DUPFD_CLOEXEC: c_int = 1030;

    unsafe extern "C" {
        fn fcntl(fd: c_int, cmd: c_int, ...) -> c_int;
        fn lseek(fd: c_int, offset: i64, whence: c_int) -> i64;
    }

    pub(super) fn flags(file: &impl AsRawFd) -> io::Result<c_int> {
        let flags = unsafe { fcntl(file.as_raw_fd(), F_GETFD) };
        if flags == -1 {
            Err(io::Error::last_os_error())
        } else {
            Ok(flags)
        }
    }

    pub(super) fn clone_above_stdio(file: &File) -> io::Result<File> {
        // Atomic CLOEXEC avoids leaking this duplicate to unrelated concurrent spawns.
        let fd = unsafe { fcntl(file.as_raw_fd(), F_DUPFD_CLOEXEC, 3 as c_int) };
        if fd == -1 {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    pub(super) fn prepare_child(file: &File) -> io::Result<()> {
        let fd = file.as_raw_fd();
        let flags = flags(file)?;
        if unsafe { fcntl(fd, F_SETFD, flags & !FD_CLOEXEC) } == -1 {
            return Err(io::Error::last_os_error());
        }
        // Duplicates share an open-file offset. Never read from this Source in the
        // parent or reuse one Source for simultaneous commands; use one per operation.
        if unsafe { lseek(fd, 0, 0) } == -1 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(all(
    test,
    unix,
    any(target_os = "macos", target_os = "linux"),
    target_pointer_width = "64"
))]
mod tests {
    use super::*;
    use std::{
        fs::OpenOptions,
        io::{Read, Seek, SeekFrom, Write},
        os::unix::fs::{symlink, DirBuilderExt, OpenOptionsExt},
        time::{Duration, SystemTime},
    };

    struct PrivateDir(PathBuf);
    impl PrivateDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("or-s-{}", ulid::Ulid::new()));
            fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
            Self(path)
        }
        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .unwrap();
            file.write_all(bytes).unwrap();
            path
        }
    }
    impl Drop for PrivateDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn revision_is_stable_without_reading_or_changing_the_file() {
        let dir = PrivateDir::new();
        let path = dir.file("source", b"generated local bytes");
        let source = Source::open(&path).unwrap();
        let revision = source.revision();
        assert_eq!(revision.len(), 64);
        for _ in 0..3 {
            source.check().unwrap();
            assert_eq!(source.revision(), revision);
            assert_eq!(Source::open(&path).unwrap().revision(), revision);
        }
        assert_eq!((&source.file).stream_position().unwrap(), 0);
    }

    #[test]
    fn replacement_and_disappearance_are_refused() {
        let dir = PrivateDir::new();
        let path = dir.file("source", b"original");
        let source = Source::open(&path).unwrap();
        let replacement = dir.file("replacement", b"replaced");
        fs::rename(replacement, &path).unwrap();
        assert!(source.check().is_err());
        assert_ne!(Source::open(&path).unwrap().revision(), source.revision());
        let current = Source::open(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert!(current.check().is_err());
    }

    #[test]
    fn rename_is_refused() {
        let dir = PrivateDir::new();
        let path = dir.file("source", b"original");
        let source = Source::open(&path).unwrap();
        fs::rename(&path, dir.0.join("moved")).unwrap();
        assert!(source.check().is_err());
    }

    #[test]
    fn links_are_refused_both_before_and_after_open() {
        let dir = PrivateDir::new();
        let path = dir.file("source", b"original");
        let source = Source::open(&path).unwrap();
        let link = dir.0.join("link");
        symlink(&path, &link).unwrap();
        assert!(Source::open(&link).is_err());
        fs::remove_file(&link).unwrap();
        fs::hard_link(&path, &link).unwrap();
        assert!(source.check().is_err());
        assert!(Source::open(&path).is_err());
        assert!(Source::open(&link).is_err());
        fs::remove_file(&link).unwrap();
        let source = Source::open(&path).unwrap();
        let moved = dir.0.join("moved");
        fs::rename(&path, &moved).unwrap();
        symlink(&moved, &path).unwrap();
        assert!(source.check().is_err());
    }

    #[test]
    fn in_place_same_length_writes_and_size_changes_are_refused() {
        let dir = PrivateDir::new();
        let path = dir.file("source", b"original");
        let source = Source::open(&path).unwrap();
        let mut writer = OpenOptions::new().write(true).open(&path).unwrap();
        writer.write_all(b"modified").unwrap();
        // Force a distinct timestamp even on coarse-resolution fixture filesystems.
        writer
            .set_times(
                std::fs::FileTimes::new()
                    .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1)),
            )
            .unwrap();
        assert!(source.check().is_err());
        let current = Source::open(&path).unwrap();
        assert_ne!(current.revision(), source.revision());
        writer.set_len(4).unwrap();
        assert!(current.check().is_err());
    }

    #[test]
    fn empty_directory_and_special_files_are_refused() {
        let dir = PrivateDir::new();
        let empty = dir.file("empty", b"");
        assert!(Source::open(&empty).is_err());
        assert!(Source::open(&dir.0).is_err());
        let socket = dir.0.join("socket");
        let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        assert!(Source::open(&socket).is_err());
    }

    #[tokio::test]
    #[ignore = "opt-in generated-file subprocess pinning/seek test; executes only this test binary"]
    async fn command_keeps_original_seekable_and_parent_cloexec_after_rename() {
        use std::os::fd::{AsRawFd, BorrowedFd};
        let dir = PrivateDir::new();
        let bytes = b"0123original generated bytes";
        let path = dir.file("source", bytes);
        let source = Source::open(&path).unwrap();
        (&source.file).seek(SeekFrom::End(0)).unwrap();
        let source_flags = native::flags(&source.file).unwrap();
        assert_ne!(source_flags & native::FD_CLOEXEC, 0);
        let (mut command, input) = source.command(&std::env::current_exe().unwrap()).unwrap();
        let fd: i32 = input.strip_prefix("/dev/fd/").unwrap().parse().unwrap();
        assert!(fd >= 3);
        assert_ne!(fd, source.file.as_raw_fd());
        // The command owns this descriptor until explicitly dropped below.
        let borrowed = unsafe { BorrowedFd::borrow_raw(fd) };
        let command_flags = native::flags(&borrowed).unwrap();
        assert_ne!(command_flags & native::FD_CLOEXEC, 0);
        assert_eq!(native::flags(&source.file).unwrap(), source_flags);
        let moved = dir.0.join("moved");
        fs::rename(&path, &moved).unwrap();
        dir.file("source", b"replacement, never the pinned input");
        assert!(source.check().is_err());
        assert!(source.command(&std::env::current_exe().unwrap()).is_err());
        drop(source);
        // libtest names omit the crate prefix included by module_path!().
        let helper = format!(
            "{}::pinned_reader_child",
            module_path!().split_once("::").unwrap().1,
        );
        command
            .args([
                "--exact",
                &helper,
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("ORION_SIDECAR_PIN_TEST_INPUT", &input)
            .kill_on_drop(true);
        let (mut child, mut group) = crate::process_group::spawn(&mut command).unwrap();
        let status = match tokio::time::timeout(Duration::from_secs(15), child.wait()).await {
            Ok(status) => status.unwrap(),
            Err(_) => {
                group.terminate();
                let _ = child.wait().await;
                panic!("generated-file pinning subprocess timed out");
            }
        };
        group.disarm();
        let output = child.wait_with_output().await.unwrap();
        assert!(
            status.success(),
            "stdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("SIDECAR_PIN_SEEK_OK"));
        assert_eq!(native::flags(&borrowed).unwrap(), command_flags);
        drop(command);
        assert_eq!(fs::read(&moved).unwrap(), bytes);
        assert_eq!(
            fs::read(&path).unwrap(),
            b"replacement, never the pinned input"
        );
    }

    #[test]
    #[ignore = "private helper for command_keeps_original_seekable_and_parent_cloexec_after_rename"]
    fn pinned_reader_child() {
        use std::os::fd::FromRawFd;
        let Ok(input) = std::env::var("ORION_SIDECAR_PIN_TEST_INPUT") else {
            return;
        };
        let fd: i32 = input.strip_prefix("/dev/fd/").unwrap().parse().unwrap();
        assert!(fd >= 3);
        let mut inherited = unsafe { File::from_raw_fd(fd) };
        assert_eq!(native::flags(&inherited).unwrap() & native::FD_CLOEXEC, 0);
        assert_eq!(inherited.stream_position().unwrap(), 0);
        let mut via_path = File::open(&input).unwrap();
        via_path.seek(SeekFrom::Start(4)).unwrap();
        let mut bytes = Vec::new();
        via_path.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"original generated bytes");
        inherited.seek(SeekFrom::Start(0)).unwrap();
        bytes.clear();
        inherited.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"0123original generated bytes");
        println!("SIDECAR_PIN_SEEK_OK");
    }
}
